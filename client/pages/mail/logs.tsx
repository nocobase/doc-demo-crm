import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useLocation } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import { useListData } from '#hooks/use-list-data';
import { resolveListState } from '@nocobase/app-client';
type Row = {
  id: string;
  accountId?: string;
  address?: string;
  subject?: string;
  status?: string;
  createdAt?: string;
};
export default function MailLogs() {
  const { t } = useTranslation();
  const admin = useLocation().pathname.includes('/mail-administration');
  const [tab, setTab] = useState('submissions');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `mail/${admin ? 'settings/' : ''}${tab}?page=${pagination.pageIndex + 1}&pageSize=20`;
  const request = useListData<{ data: Row[]; meta: { total: number } }>(path);
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: tab === 'accounts' ? 'address' : 'accountId',
      header: t('crmMail.account'),
    },
    ...(tab === 'submissions'
      ? [{ accessorKey: 'subject', header: t('crmMail.subject') }]
      : []),
    { accessorKey: 'status', header: t('crmMail.status') },
    { accessorKey: 'createdAt', header: t('crmMail.createdAt') },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t(admin ? 'crmMail.admin' : 'crmMail.logs')}
        actions={
          <Button variant='outline' onClick={request.reload}>
            {t('crmMail.refresh')}
          </Button>
        }
      />
      <p className='text-sm text-muted-foreground'>{t('crmMail.outcome')}</p>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          setPagination({ pageIndex: 0, pageSize: 20 });
        }}
      >
        <TabsList>
          {(admin
            ? ['accounts', 'syncRuns', 'submissions']
            : ['syncRuns', 'submissions']
          ).map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`crmMail.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
    </PageContainer>
  );
}
