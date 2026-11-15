import { useState } from 'react';
import { useApiClient, resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { PendingButton } from '#components/pending-button';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
type Schedule = {
  id: string;
  title: string;
  cron: string;
  timezone: string;
  nextRunAt?: string;
  enabled: boolean;
  scheduleStatus: string;
};
type Occurrence = {
  id: string;
  status: string;
  reason?: string;
  startedAt: string;
  resultSummary?: Record<string, unknown>;
};
export default function Schedules() {
  const { t, i18n } = useTranslation();
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const [selected, setSelected] = useState('');
  const path = `scheduler/schedules?page=${pagination.pageIndex + 1}&pageSize=20`;
  const request = useListData<{ data: Schedule[]; meta: { total: number } }>(
    path,
  );
  const columns: ColumnDef<Schedule>[] = [
    {
      accessorKey: 'title',
      header: t('reminders.name'),
      cell: ({ row }) => (
        <Button variant='link' onClick={() => setSelected(row.original.id)}>
          {row.original.title}
        </Button>
      ),
    },
    { accessorKey: 'cron', header: t('reminders.cron') },
    { accessorKey: 'timezone', header: t('reminders.timezone') },
    {
      accessorKey: 'nextRunAt',
      header: t('reminders.nextRun'),
      cell: ({ row }) =>
        row.original.nextRunAt
          ? new Date(row.original.nextRunAt).toLocaleString(i18n.language)
          : '—',
    },
    {
      accessorKey: 'scheduleStatus',
      header: t('reminders.status'),
      cell: ({ row }) =>
        t(`reminders.${row.original.scheduleStatus}`, {
          defaultValue: row.original.scheduleStatus,
        }),
    },
    {
      id: 'actions',
      header: t('reminders.actions'),
      cell: ({ row }) => (
        <Toggle schedule={row.original} reload={request.reload} />
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('reminders.schedules')}
        actions={
          <Button variant='outline' onClick={request.reload}>
            {t('crmMail.refresh')}
          </Button>
        }
      />
      <p className='text-sm text-muted-foreground'>
        {t('reminders.executionHint')}
      </p>
      <DataTable
        columns={columns}
        data={request.error ? [] : (request.data?.data ?? [])}
        getRowId={(r) => r.id}
        manualPagination
        rowCount={request.data?.meta.total ?? 0}
        paginationState={pagination}
        onPaginationChange={setPagination}
        pageSizeOptions={[20]}
        showSelectedCount={false}
        listState={resolveListState(
          {
            data: request.data,
            error: request.error,
            isPending: request.loading && !request.data,
          },
          request.data?.meta.total ?? 0,
          false,
        )}
        loading={request.loading}
        loadingIdentity={path}
        onRetry={request.reload}
      />
      {selected ? <History key={selected} id={selected} /> : null}
    </PageContainer>
  );
}
function Toggle({
  schedule,
  reload,
}: {
  schedule: Schedule;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <div>
      <PendingButton
        variant='outline'
        busy={busy}
        onClick={() => {
          void (async () => {
            if (busy) return;
            setBusy(true);
            setError(undefined);
            try {
              await api.request({
                path: `scheduler/schedules/${schedule.id}/${schedule.enabled ? 'disable' : 'enable'}`,
                method: 'POST',
              });
              reload();
            } catch (failure) {
              setError(failure);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {t(schedule.enabled ? 'reminders.pause' : 'reminders.resume')}
      </PendingButton>
      {error ? <ReadError error={error} retry={reload} /> : null}
    </div>
  );
}
function History({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const [token, setToken] = useState('');
  const path = `scheduler/schedules/${id}/occurrences?pageSize=20${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
  const request = useListData<{
    data: Occurrence[];
    meta: { nextPageToken?: string };
  }>(path);
  const columns: ColumnDef<Occurrence>[] = [
    {
      accessorKey: 'startedAt',
      header: t('crmMail.createdAt'),
      cell: ({ row }) =>
        new Date(row.original.startedAt).toLocaleString(i18n.language),
    },
    {
      accessorKey: 'status',
      header: t('reminders.status'),
      cell: ({ row }) =>
        t(`reminders.${row.original.status}`, {
          defaultValue: row.original.status,
        }),
    },
    { accessorKey: 'reason', header: t('reminders.reason') },
    ...['checked', 'queued', 'skipped'].map((key): ColumnDef<Occurrence> => ({
      id: key,
      header: t(`reminders.${key}`),
      cell: ({ row }) =>
        typeof row.original.resultSummary?.[key] === 'number'
          ? String(row.original.resultSummary[key])
          : '—',
    })),
  ];
  return (
    <section className='space-y-3'>
      <div className='flex flex-wrap justify-between gap-2'>
        <h2 className='text-lg font-semibold'>{t('reminders.history')}</h2>
        <Button variant='outline' onClick={request.reload}>
          {t('crmMail.refresh')}
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={request.error ? [] : (request.data?.data ?? [])}
        getRowId={(r) => r.id}
        showSelectedCount={false}
        listState={resolveListState(
          {
            data: request.data,
            error: request.error,
            isPending: request.loading && !request.data,
          },
          request.data?.data.length ?? 0,
          false,
        )}
        loading={request.loading}
        loadingIdentity={path}
        onRetry={request.reload}
      />
      <div className='flex gap-2'>
        {token ? (
          <Button variant='outline' onClick={() => setToken('')}>
            {t('reminders.latest')}
          </Button>
        ) : null}
        {request.data?.meta.nextPageToken ? (
          <Button
            variant='outline'
            onClick={() => setToken(request.data!.meta.nextPageToken!)}
          >
            {t('reminders.older')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
