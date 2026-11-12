import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useParams, useOutletContext } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Card, CardContent } from '#components/ui/card';
import { DataTable } from '#components/data-table';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
import {
  money,
  type Quote,
  type QuoteLine,
  type SalesContext,
} from './types.js';
export default function QuoteDetail() {
  const { t } = useTranslation();
  const { customerId, opportunityId, quoteId } = useParams();
  const access = useCustomerOperation(customerId, 'editQuote');
  const owner = useOutletContext<SalesContext>();
  const opportunityPath = `/customers/${customerId}/details/opportunities/${opportunityId}`;
  const request = useListData<{ data: Quote }>(
    `crmSales/customers/${customerId}/opportunities/${opportunityId}/quotes/${quoteId}`,
  );
  const quote = request.error ? undefined : request.data?.data;
  const reload = () => {
    request.reload();
    owner.reload();
  };
  usePageBreadcrumb([
    { label: t('crm.title'), to: '/customers' },
    { label: t('crm.detail'), to: `/customers/${customerId}/details` },
    {
      label: owner.opportunity?.name ?? t('sales.opportunities'),
      to: opportunityPath,
    },
    { label: quote?.name ?? t('sales.quotes') },
  ]);
  const columns: ColumnDef<QuoteLine>[] = [
    { accessorKey: 'productName', header: t('sales.product') },
    { accessorKey: 'productCode', header: t('sales.code') },
    { accessorKey: 'quantity', header: t('sales.quantity') },
    {
      accessorKey: 'unitPrice',
      header: t('sales.unitPrice'),
      cell: ({ row }) => money(row.original.unitPrice),
    },
    {
      accessorKey: 'discount',
      header: t('sales.discount'),
      cell: ({ row }) => `${row.original.discount}%`,
    },
    {
      accessorKey: 'amount',
      header: t('sales.amount'),
      cell: ({ row }) => money(row.original.amount),
    },
  ];
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={quote?.name ?? t('sales.quotes')}
          description={t('sales.snapshotHint')}
          actions={
            quote && access.allowed ? (
              <Button nativeButton={false} render={<Link to='edit' />}>
                {t('sales.editQuote')}
              </Button>
            ) : undefined
          }
        />
        {request.error ? (
          <ReadError error={request.error} retry={request.reload} />
        ) : !quote ? (
          <Loading />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={quote.lines}
              showSelectedCount={false}
            />
            <Card>
              <CardContent className='flex justify-between pt-6 text-xl font-semibold'>
                <span>{t('sales.total')} (USD)</span>
                <span>{money(quote.total)}</span>
              </CardContent>
            </Card>
          </>
        )}
        <Outlet context={{ quote, reload }} />
      </PageContainer>
    </RouteChildPage>
  );
}
