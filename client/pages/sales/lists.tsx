import { resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { useListData } from '#hooks/use-list-data';
import type { ListResult } from '../customers/types.js';
import { money, type Opportunity, type Quote } from './types.js';

export function SalesRelated({
  customerId,
  opportunityId,
  revision = 0,
}: {
  customerId: string;
  opportunityId?: string;
  revision?: number;
}) {
  const { t } = useTranslation();
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const kind = opportunityId ? 'quotes' : 'opportunities';
  const base = `crmSales/customers/${customerId}/opportunities${opportunityId ? `/${opportunityId}/quotes` : ''}`;
  const path = `${base}?page=${pagination.pageIndex + 1}&revision=${revision}`;
  const request = useListData<ListResult<Opportunity & Quote>>(path);
  const state = resolveListState(
    {
      data: request.data,
      error: request.error,
      isPending: request.loading && !request.data,
    },
    request.data?.meta.total ?? 0,
    false,
  );
  const columns: ColumnDef<Opportunity & Quote>[] = [
    {
      accessorKey: 'name',
      header: t('sales.name'),
      cell: ({ row }) => (
        <Link
          className='font-medium underline underline-offset-4'
          to={`${kind}/${row.original.id}`}
        >
          {row.original.name}
        </Link>
      ),
    },
    opportunityId
      ? {
          accessorKey: 'total',
          header: t('sales.total'),
          cell: ({ row }) => money(row.original.total),
        }
      : {
          accessorKey: 'stage',
          header: t('sales.stage'),
          cell: ({ row }) => t(`sales.${row.original.stage}`),
        },
  ];
  const action = (
    <Button
      nativeButton={false}
      render={<Link to={opportunityId ? 'newQuote' : 'newOpportunity'} />}
    >
      {t(opportunityId ? 'sales.newQuote' : 'sales.newOpportunity')}
    </Button>
  );
  return (
    <section className='space-y-3' aria-label={t(`sales.${kind}`)}>
      <div className='flex flex-wrap justify-between gap-2'>
        <h2 className='text-lg font-semibold'>{t(`sales.${kind}`)}</h2>
        {state === 'empty' ? null : action}
      </div>
      <DataTable
        columns={columns}
        data={request.data?.data ?? []}
        getRowId={(r) => r.id}
        manualPagination
        rowCount={request.data?.meta.total ?? 0}
        paginationState={pagination}
        onPaginationChange={setPagination}
        pageSizeOptions={[20]}
        showSelectedCount={false}
        listState={state}
        loading={request.loading}
        loadingIdentity={path}
        onRetry={request.reload}
        emptyAction={action}
      />
    </section>
  );
}
