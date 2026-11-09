import {
  useApiClient,
  useSubmission,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { FeedbackForm } from '#components/feedback-form';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { PendingButton } from '#components/pending-button';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Label } from '#components/ui/label';
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
import { Loading } from '#components/loading';
import { Choice } from './shared.js';
import type { CustomerContext } from './types.js';

type Values = Record<string, string>;
export default function CrmEditor() {
  const location = useLocation();
  const { t } = useTranslation();
  const context = useOutletContext<CustomerContext>();
  const kind = location.pathname.endsWith('/newContact')
    ? 'contact'
    : location.pathname.endsWith('/newFollowUp')
      ? 'followUp'
      : 'customer';
  const editing = location.pathname.endsWith('/edit');
  if ((editing || kind !== 'customer') && !context.customer)
    return (
      <RouteDialog title={t('crm.title')}>
        <Loading />
      </RouteDialog>
    );
  return (
    <Editor
      key={`${kind}-${context.customer?.id ?? 'new'}`}
      kind={kind}
      editing={editing}
      context={context}
    />
  );
}
function Cancel({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <Button variant='outline' disabled={disabled} onClick={() => void close()}>
      {t('crm.cancel')}
    </Button>
  );
}
function Editor({
  kind,
  editing,
  context,
}: {
  kind: 'customer' | 'contact' | 'followUp';
  editing: boolean;
  context: CustomerContext;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const formId = useId();
  const navigate = useNavigate();
  const toaster = useToaster();
  const customer = context.customer;
  const initial: Values =
    kind === 'customer'
      ? {
          name: editing ? customer!.name : '',
          industry: editing ? customer!.industry : '',
          status: editing ? customer!.status : 'prospect',
          website: editing ? customer!.website : '',
          notes: editing ? customer!.notes : '',
        }
      : kind === 'contact'
        ? { name: '', role: '', email: '', phone: '' }
        : { channel: 'call', content: '', nextStep: '' };
  const form = useForm<Values>({
    defaultValues: initial,
    shouldFocusError: false,
  });
  const watched = useWatch({ control: form.control });
  const submission = useSubmission({
    scope: `${session?.user.id}:crm:${kind}:${customer?.id ?? 'new'}:${editing ? 'edit' : 'create'}`,
  });
  const [error, setError] = useState<unknown>();
  const savedRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const restoring = submission.pending && !attempted;
  const [confirm, setConfirm] = useState(false);
  const decisionRef = useRef<{
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
  } | null>(null);
  function decide(value: boolean) {
    decisionRef.current?.resolve(value);
    decisionRef.current = null;
    setConfirm(false);
  }
  useEffect(
    () => () => {
      decisionRef.current?.resolve(false);
    },
    [],
  );
  useNavigationGuard(() => {
    if (savedRef.current) return true;
    if (submission.submitting || submission.pending) return false;
    if (!form.formState.isDirty) return true;
    if (decisionRef.current) return decisionRef.current.promise;
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    decisionRef.current = { promise, resolve };
    setConfirm(true);
    return promise;
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (form.formState.isDirty || submission.pending || submission.submitting)
        event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty, submission.pending, submission.submitting]);
  const submit = async () => {
    try {
      const result = await submission.run(
        form.getValues(),
        async (key, signal, values) => {
          setError(undefined);
          let valid = false;
          await form.handleSubmit(() => {
            valid = true;
          })();
          if (!valid) return;
          setAttempted(true);
          const path =
            kind === 'customer'
              ? `crm/customers${editing ? `/${customer!.id}` : ''}`
              : `crm/customers/${customer!.id}/${kind === 'contact' ? 'contacts' : 'followUps'}`;
          return api.request({
            path,
            method: editing ? 'PATCH' : 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
            json: values,
          });
        },
      );
      if (!result) return;
      savedRef.current = true;
      toaster.show({ type: 'success', title: t('crm.saved') });
      context.reload();
      void navigate('..', { relative: 'path' });
    } catch (failure) {
      setError(failure);
    }
  };
  const title = editing
    ? 'editCustomer'
    : kind === 'customer'
      ? 'newCustomer'
      : kind === 'contact'
        ? 'newContact'
        : 'newFollowUp';
  return (
    <RouteDialog
      title={t(`crm.${title}`)}
      className={kind === 'customer' ? 'sm:max-w-2xl' : 'sm:max-w-md'}
      beforeClose={() => !submission.submitting && !submission.pending}
      footer={
        <>
          <Cancel disabled={submission.submitting || submission.pending} />
          <PendingButton
            type='submit'
            form={formId}
            busy={submission.submitting}
            disabled={!session}
            pendingLabel={t('crm.saving')}
          >
            {t('crm.save')}
          </PendingButton>
        </>
      }
    >
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
      {submission.pending ? (
        <Alert>
          <AlertDescription>
            {t(restoring ? 'crm.restoreInput' : 'crm.uncertain')}
          </AlertDescription>
        </Alert>
      ) : null}
      <FeedbackForm
        id={formId}
        error={error}
        submitting={submission.submitting}
        validationErrors={form.formState.errors}
        onSubmit={async (event) => {
          event.preventDefault();
          await submit();
        }}
      >
        <fieldset
          disabled={submission.submitting || (submission.pending && !restoring)}
          className='grid gap-4'
        >
          {Object.keys(initial).map((field) => {
            const id = `${formId}-${field}`;
            const required = field === 'name' || field === 'content';
            const max = (
              {
                name: 120,
                industry: 100,
                role: 100,
                email: 200,
                phone: 60,
                website: 200,
                content: 4000,
                notes: 4000,
                nextStep: 2000,
              } as Record<string, number>
            )[field];
            const validation = form.register(field, {
              validate: (value) =>
                required && !value.trim()
                  ? t('crm.required')
                  : max && value.trim().length > max
                    ? t('crm.tooLong', { max })
                    : field === 'email' &&
                        value &&
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                      ? t('crm.invalidEmail')
                      : field === 'website' &&
                          value &&
                          !/^https?:\/\/[^\s]+$/i.test(value)
                        ? t('crm.invalidWebsite')
                        : true,
            });
            const message = form.formState.errors[field]?.message;
            return (
              <div key={field} className='space-y-2'>
                <Label htmlFor={id}>
                  {t(
                    `crm.${field === 'name' && kind === 'contact' ? 'contactName' : field}`,
                  )}
                  {required ? <span aria-hidden='true'> *</span> : null}
                </Label>
                {field === 'status' || field === 'channel' ? (
                  <Choice
                    id={id}
                    label={t(`crm.${field}`)}
                    value={watched[field] ?? initial[field]}
                    values={
                      field === 'status'
                        ? ['prospect', 'customer', 'inactive']
                        : ['call', 'email', 'meeting', 'note']
                    }
                    onChange={(value) =>
                      form.setValue(field, value, { shouldDirty: true })
                    }
                  />
                ) : ['content', 'notes', 'nextStep'].includes(field) ? (
                  <Textarea
                    id={id}
                    rows={3}
                    aria-required={required}
                    aria-invalid={Boolean(message)}
                    aria-describedby={message ? `${id}-error` : undefined}
                    {...validation}
                  />
                ) : (
                  <Input
                    id={id}
                    type={
                      field === 'email'
                        ? 'email'
                        : field === 'website'
                          ? 'url'
                          : 'text'
                    }
                    aria-required={required}
                    aria-invalid={Boolean(message)}
                    aria-describedby={message ? `${id}-error` : undefined}
                    {...validation}
                  />
                )}
                {message ? (
                  <p
                    id={`${id}-error`}
                    data-feedback-field-error
                    className='text-sm text-destructive'
                  >
                    {String(message)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      </FeedbackForm>
    </RouteDialog>
  );
}
