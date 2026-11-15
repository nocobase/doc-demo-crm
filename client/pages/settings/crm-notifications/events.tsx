import { resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { SettingsModulePage } from '../settings-module-page.js';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
import { useListData } from '#hooks/use-list-data';
type Event = {
  id: string;
  scenario: string;
  status: string;
  attempts: number;
  createdAt: string;
  errorCategory: string | null;
  notificationId: string | null;
};
export default function NotificationEvents() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const status = ['queued', 'submitted', 'skipped'].includes(
    search.get('status') ?? '',
  )
    ? search.get('status')!
    : 'all';
  const page = Math.max(1, Number(search.get('page')) || 1);
  const pagination = { pageIndex: page - 1, pageSize: 20 };
  const request = useListData<{ data: Event[]; meta: { total: number } }>(
    `crmNotifications/events?page=${page}${status === 'all' ? '' : `&status=${status}`}`,
  );
  const columns: ColumnDef<Event>[] = [
    {
      accessorKey: 'scenario',
      header: t('crmNotifications.scenario'),
      cell: ({ row }) => t(`crmNotifications.${row.original.scenario}`),
    },
    {
      accessorKey: 'status',
      header: t('crmNotifications.status'),
      cell: ({ row }) => t(`crmNotifications.${row.original.status}`),
    },
    {
      accessorKey: 'createdAt',
      header: t('crmNotifications.time'),
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString(i18n.language),
    },
    { accessorKey: 'attempts', header: t('crmNotifications.attempts') },
    {
      accessorKey: 'errorCategory',
      header: t('crmNotifications.issue'),
      cell: ({ row }) =>
        row.original.errorCategory
          ? t(`crmNotifications.${row.original.errorCategory}`)
          : '—',
    },
    {
      id: 'log',
      header: t('crmNotifications.logs'),
      cell: ({ row }) =>
        row.original.notificationId ? (
          <Button
            variant='link'
            nativeButton={false}
            render={
              <Link
                to={`/settings/notifications/logs?logId=${encodeURIComponent(row.original.notificationId)}`}
              />
            }
          >
            {t('crmNotifications.openLog')}
          </Button>
        ) : (
          '—'
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
    status !== 'all',
  );
  return (
    <SettingsModulePage
      title={t('crmNotifications.events')}
      description={t('crmNotifications.handoffHint')}
      actions={
        <Button
          variant='outline'
          disabled={request.loading}
          onClick={request.reload}
        >
          {t('crmNotifications.refresh')}
        </Button>
      }
    >
      <Select
        value={status}
        items={['all', 'queued', 'submitted', 'skipped'].map((value) => ({
          value,
          label: t(`crmNotifications.${value}`),
        }))}
        onValueChange={(value) =>
          setSearch({ status: value ?? 'all', page: '1' })
        }
      >
        <SelectTrigger
          className='w-52'
          aria-label={t('crmNotifications.status')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {['all', 'queued', 'submitted', 'skipped'].map((value) => (
            <SelectItem key={value} value={value}>
              {t(`crmNotifications.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DataTable
        columns={columns}
        data={request.data?.data ?? []}
        getRowId={(row) => row.id}
        listState={state}
        loading={request.loading}
        onRetry={request.reload}
        manualPagination
        rowCount={request.data?.meta.total ?? 0}
        paginationState={pagination}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === 'function' ? updater(pagination) : updater;
          setSearch({ status, page: String(next.pageIndex + 1) });
        }}
        pageSizeOptions={[20]}
        showSelectedCount={false}
      />
    </SettingsModulePage>
  );
}
