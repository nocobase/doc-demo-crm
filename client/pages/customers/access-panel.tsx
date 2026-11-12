import {
  useApiClient,
  useNavigationGuard,
  useSubmission,
  useToaster,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useAuthorizationClient,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useId, useRef, useState } from 'react';
import { useCustomerAccess, type CustomerAccess } from '#hooks/use-crm-access';
import { FeedbackForm } from '#components/feedback-form';
import { PendingButton } from '#components/pending-button';
import { Loading } from '#components/loading';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Checkbox } from '#components/ui/checkbox';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { ReadError } from './shared.js';

export function CustomerAccessPanel({
  customerId,
  revision,
  reload,
}: {
  customerId: string;
  revision: number;
  reload: () => void;
}) {
  const request = useCustomerAccess(customerId, revision);
  const { t } = useTranslation();
  if (request.error)
    return <ReadError error={request.error} retry={request.reload} />;
  if (!request.access) return <Loading />;
  const access = request.access;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('crmAccess.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div>
          <p className='text-sm text-muted-foreground'>
            {t('crmAccess.owner')}
          </p>
          <p>{access.ownerName ?? t('crmAccess.unassigned')}</p>
        </div>
        {!access.edit ? (
          <Alert>
            <AlertDescription>
              {t(
                access.shared
                  ? 'crmAccess.readOnlyShared'
                  : 'crmAccess.readOnly',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {access.manage ? (
          <AccessEditor
            key={`${customerId}:${access.ownerId}:${access.shares.map((s) => s.userId).join(',')}`}
            customerId={customerId}
            access={access}
            reload={() => {
              request.reload();
              reload();
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
function AccessEditor({
  customerId,
  access,
  reload,
}: {
  customerId: string;
  access: CustomerAccess;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const authorization = useAuthorizationClient();
  const assignPermission = useCan({
    resource: { type: 'composite', id: 'crm.records' },
    action: 'assignOwner',
  });
  const sharingPermission = useCan({
    resource: { type: 'composite', id: 'crm.records' },
    action: 'shareCustomer',
  });
  const { session } = useAuthentication();
  const toaster = useToaster();
  const id = useId();
  const [ownerId, setOwnerId] = useState(access.ownerId ?? 'unassigned');
  const [userIds, setUserIds] = useState(
    access.shares.map((share) => share.userId),
  );
  const [ownerError, setOwnerError] = useState<unknown>();
  const [shareError, setShareError] = useState<unknown>();
  const ownerSubmission = useSubmission({
    scope: `${session?.user.id}:crm:${customerId}:owner`,
  });
  const shareSubmission = useSubmission({
    scope: `${session?.user.id}:crm:${customerId}:shares`,
  });
  const busy =
    ownerSubmission.submitting ||
    ownerSubmission.pending ||
    shareSubmission.submitting ||
    shareSubmission.pending;
  const ownerDirty = ownerId !== (access.ownerId ?? 'unassigned');
  const shareDirty =
    [...userIds].sort().join(',') !==
    access.shares
      .map((s) => s.userId)
      .sort()
      .join(',');
  const [confirm, setConfirm] = useState(false);
  const decisionRef = useRef<((value: boolean) => void) | null>(null);
  const decide = (value: boolean) => {
    decisionRef.current?.(value);
    decisionRef.current = null;
    setConfirm(false);
  };
  useNavigationGuard(() => {
    if (busy) return false;
    if (!ownerDirty && !shareDirty) return true;
    return new Promise<boolean>((resolve) => {
      decisionRef.current = resolve;
      setConfirm(true);
    });
  });
  useEffect(() => () => decisionRef.current?.(false), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy || ownerDirty || shareDirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, ownerDirty, shareDirty]);
  const save = async (kind: 'owner' | 'shares') => {
    const submission = kind === 'owner' ? ownerSubmission : shareSubmission;
    const error = kind === 'owner' ? setOwnerError : setShareError;
    try {
      error(undefined);
      await submission.run(
        kind === 'owner'
          ? { ownerId: ownerId === 'unassigned' ? null : ownerId }
          : { userIds },
        (key, signal, json) =>
          api.request({
            path: `crm/customers/${customerId}/${kind}`,
            method: 'PUT',
            headers: { 'Idempotency-Key': key },
            signal,
            json,
          }),
      );
      toaster.show({ type: 'success', title: t('crm.saved') });
      authorization.invalidate();
      reload();
    } catch (failure) {
      error(failure);
    }
  };
  const choices = [
    { value: 'unassigned', label: t('crmAccess.unassigned') },
    ...access.users.map((user) => ({ value: user.id, label: user.name })),
  ];
  if (
    access.ownerId &&
    !access.users.some((user) => user.id === access.ownerId)
  )
    choices.push({
      value: access.ownerId,
      label: access.ownerName ?? access.ownerId,
    });
  return (
    <div className='grid gap-6 lg:grid-cols-2'>
      {access.canAssign && assignPermission.can ? (
        <FeedbackForm
          error={ownerError}
          submitting={ownerSubmission.submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            await save('owner');
          }}
          className='space-y-3'
        >
          <Label htmlFor={`${id}-owner`}>{t('crmAccess.assignOwner')}</Label>
          <Select
            items={choices}
            value={ownerId}
            onValueChange={(value) => {
              if (value) setOwnerId(value);
            }}
          >
            <SelectTrigger id={`${id}-owner`} disabled={busy || shareDirty}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-sm text-muted-foreground'>
            {t('crmAccess.ownerHint')}
          </p>
          {ownerSubmission.pending ? (
            <Alert>
              <AlertDescription>{t('crm.uncertain')}</AlertDescription>
            </Alert>
          ) : null}
          <div className='flex gap-2'>
            <PendingButton
              type='submit'
              busy={ownerSubmission.submitting}
              disabled={
                shareSubmission.submitting ||
                shareSubmission.pending ||
                (!ownerDirty && !ownerSubmission.pending)
              }
              pendingLabel={t('crm.saving')}
            >
              {t('crmAccess.saveOwner')}
            </PendingButton>
            <Button
              type='button'
              variant='outline'
              disabled={busy || !ownerDirty}
              onClick={() => setOwnerId(access.ownerId ?? 'unassigned')}
            >
              {t('crm.cancel')}
            </Button>
          </div>
        </FeedbackForm>
      ) : null}
      {access.canShare && sharingPermission.can ? (
        <FeedbackForm
          error={shareError}
          submitting={shareSubmission.submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            await save('shares');
          }}
          className='space-y-3'
        >
          <div>
            <p className='font-medium'>{t('crmAccess.sharedWith')}</p>
            <p className='text-sm text-muted-foreground'>
              {t('crmAccess.shareHint')}
            </p>
          </div>
          <div className='max-h-48 space-y-3 overflow-y-auto rounded-md border p-3'>
            {access.users.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('crmAccess.noUsers')}
              </p>
            ) : (
              access.users.map((user) => (
                <div className='flex items-center gap-2' key={user.id}>
                  <Checkbox
                    id={`${id}-share-${user.id}`}
                    checked={userIds.includes(user.id)}
                    disabled={busy || ownerDirty}
                    onCheckedChange={(checked) =>
                      setUserIds((current) =>
                        checked
                          ? [
                              ...current.filter((value) => value !== user.id),
                              user.id,
                            ]
                          : current.filter((value) => value !== user.id),
                      )
                    }
                  />
                  <Label htmlFor={`${id}-share-${user.id}`}>{user.name}</Label>
                </div>
              ))
            )}
          </div>
          {access.shares
            .filter(
              (share) => !access.users.some((user) => user.id === share.userId),
            )
            .map((share) => (
              <div className='flex items-center gap-2' key={share.userId}>
                <Checkbox
                  id={`${id}-former-${share.userId}`}
                  checked={userIds.includes(share.userId)}
                  disabled={busy || ownerDirty}
                  onCheckedChange={(checked) =>
                    setUserIds((current) =>
                      checked
                        ? [
                            ...current.filter(
                              (value) => value !== share.userId,
                            ),
                            share.userId,
                          ]
                        : current.filter((value) => value !== share.userId),
                    )
                  }
                />
                <Label htmlFor={`${id}-former-${share.userId}`}>
                  {share.name}
                </Label>
              </div>
            ))}
          {shareSubmission.pending ? (
            <Alert>
              <AlertDescription>{t('crm.uncertain')}</AlertDescription>
            </Alert>
          ) : null}
          <div className='flex gap-2'>
            <PendingButton
              type='submit'
              busy={shareSubmission.submitting}
              disabled={
                ownerSubmission.submitting ||
                ownerSubmission.pending ||
                (!shareDirty && !shareSubmission.pending)
              }
              pendingLabel={t('crm.saving')}
            >
              {t('crmAccess.saveSharing')}
            </PendingButton>
            <Button
              type='button'
              variant='outline'
              disabled={busy || !shareDirty}
              onClick={() =>
                setUserIds(access.shares.map((share) => share.userId))
              }
            >
              {t('crm.cancel')}
            </Button>
          </div>
        </FeedbackForm>
      ) : null}
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!open) decide(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('crm.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('crm.discardHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('crm.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => decide(true)}>
              {t('crm.discardAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
