import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
import { downloadFile } from './download.js';
import {
  useApiClient,
  useSubmission,
  useToaster,
  resolveListState,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  FilePreviewDialog,
  type FileRecord,
} from '#extensions/nocobase-file-component-ui/index';
import { Button } from '#components/ui/button';
import { DataTable } from '#components/data-table';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { PendingButton } from '#components/pending-button';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
export type BusinessFile = FileRecord & {
  uploader: string;
  createdAt: string;
  contentUrl: string;
  status: string;
};
export function CustomerAttachments({
  customerId,
  revision,
}: {
  customerId: string;
  revision: number;
}) {
  const access = useCustomerOperation(customerId, 'attachFile');
  const remove = useCustomerOperation(customerId, 'removeFile');
  const location = useLocation();
  return (
    <FilesTable
      path={`crmFiles/customers/${customerId}`}
      revision={revision}
      canRemove={remove.allowed}
      action={
        access.allowed ? (
          <Button
            nativeButton={false}
            render={
              <Link to={{ pathname: 'addFiles', search: location.search }} />
            }
          >
            {<AttachmentLabel />}
          </Button>
        ) : undefined
      }
      accessError={
        access.error ? (
          <ReadError error={access.error} retry={access.reload} />
        ) : undefined
      }
    />
  );
}
function AttachmentLabel() {
  const { t } = useTranslation();
  return <>{t('documents.add')}</>;
}
export function FilesTable({
  path,
  revision = 0,
  canRemove = false,
  action,
  accessError,
}: {
  path: string;
  revision?: number;
  canRemove?: boolean;
  action?: React.ReactNode;
  accessError?: React.ReactNode;
}) {
  const cleanup = path === 'crmDocuments/orphans';
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { session } = useAuthentication();
  const [search, setSearch] = useSearchParams();
  const status = ['staged', 'deleting'].includes(search.get('fileStatus') ?? '')
    ? search.get('fileStatus')!
    : 'all';
  const page = Math.max(1, Number(search.get('filePage')) || 1);
  const pagination = { pageIndex: page - 1, pageSize: 20 };
  const request = useListData<{
    data: BusinessFile[];
    meta: { total: number };
  }>(
    `${path}?page=${page}&revision=${revision}${cleanup && status !== 'all' ? `&status=${status}` : ''}`,
  );
  const submission = useSubmission({
    scope: `${session?.user.id}:files:${path}`,
  });
  const [preview, setPreview] = useState<BusinessFile>();
  const [remove, setRemove] = useState<BusinessFile>();
  const [failed, setFailed] = useState(false);
  const download = (file: FileRecord) =>
    downloadFile(file).catch(() => setFailed(true));
  const columns: ColumnDef<BusinessFile>[] = [
    {
      accessorKey: 'filename',
      header: t('documents.name'),
      cell: ({ row }) =>
        cleanup ? (
          <span className='break-all'>{row.original.filename}</span>
        ) : (
          <Button
            variant='link'
            onClick={() => {
              setFailed(false);
              setPreview(row.original);
            }}
            title={row.original.filename}
            id={`crm-file-${row.original.id}`}
            className='max-w-64 truncate'
          >
            {row.original.filename}
          </Button>
        ),
    },
    ...(cleanup
      ? [
          {
            accessorKey: 'status',
            header: t('documents.status'),
            cell: ({ row }: { row: { original: BusinessFile } }) =>
              t(`documents.${row.original.status}`),
          },
        ]
      : []),
    { accessorKey: 'mimeType', header: t('documents.type') },
    {
      accessorKey: 'size',
      header: t('documents.size'),
      cell: ({ row }) => `${(Number(row.original.size) / 1024).toFixed(1)} KB`,
    },
    { accessorKey: 'uploader', header: t('documents.uploader') },
    {
      accessorKey: 'createdAt',
      header: t('documents.date'),
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString(i18n.language),
    },
    {
      id: 'actions',
      header: t('documents.actions'),
      cell: ({ row }) => (
        <div className='flex gap-2'>
          {cleanup ? null : (
            <Button
              variant='outline'
              onClick={() => void download(row.original)}
            >
              {t('documents.download')}
            </Button>
          )}
          {canRemove ? (
            <Button
              variant='outline'
              onClick={() => {
                setFailed(false);
                setRemove(row.original);
              }}
            >
              {t('documents.remove')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  const state = resolveListState(
    {
      data: request.data,
      error: request.error,
      isPending: request.loading && !request.data,
    },
    request.data?.meta.total ?? 0,
    false,
  );
  return (
    <section
      className='space-y-3'
      aria-label={t(cleanup ? 'documents.cleanup' : 'documents.attachments')}
    >
      {accessError}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {cleanup ? null : (
          <h2 className='text-lg font-semibold'>
            {t(cleanup ? 'documents.cleanup' : 'documents.attachments')}
          </h2>
        )}
        {action}
        {cleanup ? (
          <Select
            value={status}
            items={['all', 'staged', 'deleting'].map((value) => ({
              value,
              label: t(`documents.${value}`),
            }))}
            onValueChange={(value) =>
              setSearch((previous) => {
                previous.set('fileStatus', value ?? 'all');
                previous.set('filePage', '1');
                return previous;
              })
            }
          >
            <SelectTrigger aria-label={t('documents.status')} className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['all', 'staged', 'deleting'].map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`documents.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {failed ? (
        <p role='alert' className='text-destructive'>
          {t('documents.failed')}
        </p>
      ) : null}
      <DataTable
        columns={columns}
        data={request.data?.data ?? []}
        getRowId={(row) => row.id}
        manualPagination
        rowCount={request.data?.meta.total ?? 0}
        paginationState={pagination}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === 'function' ? updater(pagination) : updater;
          setSearch((previous) => {
            previous.set('filePage', String(next.pageIndex + 1));
            return previous;
          });
        }}
        pageSizeOptions={[20]}
        showSelectedCount={false}
        listState={state}
        loading={request.loading}
        onRetry={request.reload}
      />
      <FilePreviewDialog
        files={preview ? [preview] : []}
        returnFocus={() =>
          preview ? document.getElementById(`crm-file-${preview.id}`) : null
        }
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
        onDownload={downloadFile}
        onError={() => setFailed(true)}
      />
      <AlertDialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open && !submission.submitting) setRemove(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('documents.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                cleanup ? 'documents.cleanupConfirm' : 'documents.removeHint',
                { name: remove?.filename },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failed ? (
            <p role='alert' className='text-destructive'>
              {t('documents.failed')}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submission.submitting}>
              {t('crm.cancel')}
            </AlertDialogCancel>
            <PendingButton
              busy={submission.submitting}
              onClick={() => {
                if (!remove) return;
                void submission
                  .run({ id: remove.id }, (key, signal, input) =>
                    api.request({
                      path: `${path}/${input.id}`,
                      method: 'DELETE',
                      signal,
                      headers: { 'Idempotency-Key': key },
                    }),
                  )
                  .then(() => {
                    setRemove(undefined);
                    setFailed(false);
                    toaster.show({
                      type: 'success',
                      title: t(
                        cleanup ? 'documents.cleaned' : 'documents.removed',
                      ),
                    });
                    if ((request.data?.data.length ?? 0) === 1 && page > 1)
                      setSearch((previous) => {
                        previous.set('filePage', String(page - 1));
                        return previous;
                      });
                    request.reload();
                  })
                  .catch(() => setFailed(true));
              }}
            >
              {t('documents.remove')}
            </PendingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
