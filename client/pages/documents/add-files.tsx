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
import {
  useApiClient,
  useService,
  useSubmission,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, useId, useRef, useEffect } from 'react';
import {
  useNavigate,
  useOutletContext,
  useParams,
  useLocation,
} from 'react-router';
import {
  FileUploadField,
  clientFileRepositoryManagerToken,
  type FileRecord,
  type FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { PendingButton } from '#components/pending-button';
import { FeedbackForm } from '#components/feedback-form';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
import type { CustomerContext } from '../customers/types.js';
export default function AddFiles() {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const manager = useService(clientFileRepositoryManagerToken);
  const repository = useMemo(
    () => manager.repository('crmFileUploads'),
    [manager],
  );
  const { session } = useAuthentication();
  const { customerId } = useParams();
  const { reload } = useOutletContext<CustomerContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const access = useCustomerOperation(customerId, 'attachFile');
  const formId = useId();
  const [files, setFiles] = useState<readonly FileRecord[]>([]);
  const [status, setStatus] = useState<FileUploadStatus>('idle');
  const [error, setError] = useState<unknown>();
  const submission = useSubmission({
    scope: `${session?.user.id}:attach:${customerId}`,
  });
  const busy = submission.submitting || status === 'uploading';
  const savedRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const decisionRef = useRef<{
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
  } | null>(null);
  const decide = (value: boolean) => {
    decisionRef.current?.resolve(value);
    decisionRef.current = null;
    setConfirm(false);
  };
  useEffect(
    () => () => {
      decisionRef.current?.resolve(false);
    },
    [],
  );
  useNavigationGuard(() => {
    if (savedRef.current) return true;
    if (busy || submission.pending) return false;
    if (!files.length) return true;
    if (decisionRef.current) return decisionRef.current.promise;
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    decisionRef.current = { promise, resolve };
    setConfirm(true);
    return promise;
  });
  const close = () => {
    void navigate(
      { pathname: '..', search: location.search },
      { relative: 'path' },
    );
  };
  return (
    <RouteDialog
      title={t('documents.add')}
      beforeClose={() => !busy && !submission.pending}
      footer={
        <>
          <Button variant='outline' disabled={busy} onClick={close}>
            {t('crm.cancel')}
          </Button>
          <PendingButton
            type='submit'
            form={formId}
            busy={submission.submitting}
            disabled={
              busy || !access.allowed || !files.length || status === 'error'
            }
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
              {t('documents.cancelHint')}
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
      {access.error ? (
        <ReadError error={access.error} retry={access.reload} />
      ) : !access.allowed ? (
        <p>{t('crmAccess.deniedEdit')}</p>
      ) : (
        <FeedbackForm
          id={formId}
          error={error}
          submitting={submission.submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setError(undefined);
              await submission.run(
                { ids: files.map((file) => file.id) },
                (key, signal, input) =>
                  api.request({
                    path: `crmFiles/customers/${customerId}`,
                    method: 'POST',
                    signal,
                    json: input,
                    headers: { 'Idempotency-Key': key },
                  }),
              );
              toaster.show({ type: 'success', title: t('crm.saved') });
              savedRef.current = true;
              reload();
              close();
            } catch (failure) {
              setError(failure);
            }
          }}
        >
          <p className='text-sm text-muted-foreground'>
            {t('documents.uploadHint')}
          </p>
          <FileUploadField
            repository={repository}
            value={files}
            onChange={setFiles}
            multiple
            maxFiles={10}
            maxSize={5 * 1024 * 1024}
            onStatusChange={setStatus}
            disabled={submission.submitting}
            onError={setError}
          />
        </FeedbackForm>
      )}
    </RouteDialog>
  );
}
