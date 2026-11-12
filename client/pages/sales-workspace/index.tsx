import { resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable } from '#components/data-table';
import { RecordLink } from '#components/record-link';
import { StatusBadge } from '#components/status-badge';
import { Loading } from '#components/loading';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
import { money } from '../sales/types.js';
import { customerPath, opportunityPath, type Workspace } from './types.js';

export default function SalesWorkspace() {
  const { t, i18n } = useTranslation();
  const request = useListData<{ data: Workspace }>('crm/workspace');
  const workspace = request.data?.data;
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  const followUpColumns: ColumnDef<Workspace['followUps'][number]>[] = [
    {
      accessorKey: 'customer.name',
      header: t('crm.name'),
      cell: ({ row }) => (
        <RecordLink to={`${customerPath(row.original.customerId)}/followUps`}>
          {row.original.customer.name}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'content',
      header: t('crm.content'),
      cell: ({ row }) => (
        <p className='max-w-md truncate' title={row.original.content}>
          {row.original.content}
        </p>
      ),
    },
    {
      accessorKey: 'nextStep',
      header: t('crm.nextStep'),
      cell: ({ row }) => (
        <p className='max-w-xs truncate' title={row.original.nextStep}>
          {row.original.nextStep || t('crm.notProvided')}
        </p>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('crm.recordedAt'),
      cell: ({ row }) => date(row.original.createdAt),
    },
  ];
  const opportunityColumns: ColumnDef<Workspace['opportunities'][number]>[] = [
    {
      accessorKey: 'name',
      header: t('sales.name'),
      cell: ({ row }) => (
        <RecordLink to={opportunityPath(row.original)}>
          {row.original.name}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'customer.name',
      header: t('crm.name'),
      cell: ({ row }) => (
        <RecordLink to={customerPath(row.original.customerId)}>
          {row.original.customer.name}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'stage',
      header: t('sales.stage'),
      cell: ({ row }) => (
        <StatusBadge
          tone={
            row.original.stage === 'won'
              ? 'success'
              : row.original.stage === 'lost'
                ? 'neutral'
                : 'info'
          }
        >
          {t(`sales.${row.original.stage}`)}
        </StatusBadge>
      ),
    },
  ];
  const quoteColumns: ColumnDef<Workspace['quotes'][number]>[] = [
    {
      accessorKey: 'name',
      header: t('sales.name'),
      cell: ({ row }) => (
        <RecordLink
          to={`${opportunityPath(row.original.opportunity)}/quotes/${row.original.id}`}
        >
          {row.original.name}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'opportunity.name',
      header: t('workspace.opportunity'),
      cell: ({ row }) => (
        <RecordLink to={opportunityPath(row.original.opportunity)}>
          {row.original.opportunity.name}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'total',
      header: t('sales.total'),
      cell: ({ row }) => money(row.original.total),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('workspace.title')}
        description={t('workspace.description')}
        actions={
          <Button
            nativeButton={false}
            variant='outline'
            render={<Link to='/customers' />}
          >
            {t('workspace.openCustomers')}
          </Button>
        }
      />
      {request.error ? (
        <ReadError error={request.error} retry={request.reload} />
      ) : !workspace ? (
        <Loading />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-3'>
            {(['customers', 'opportunities', 'quotes'] as const).map((kind) => (
              <Card key={kind} size='sm'>
                <CardHeader>
                  <CardTitle>{t(`workspace.${kind}`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className='text-2xl font-semibold tabular-nums'>
                    {workspace.counts[kind].toLocaleString(i18n.language)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <section
            className='flex flex-col gap-3'
            aria-label={t('workspace.recentFollowUps')}
          >
            <h2 className='text-lg font-semibold'>
              {t('workspace.recentFollowUps')}
            </h2>
            <DataTable
              columns={followUpColumns}
              data={workspace.followUps}
              pagination={false}
              showSelectedCount={false}
              listState={resolveListState(
                { data: workspace.followUps },
                workspace.followUps.length,
                false,
              )}
              emptyMessage={t('workspace.noFollowUps')}
            />
          </section>
          <div className='grid gap-6 xl:grid-cols-2'>
            <section
              className='flex min-w-0 flex-col gap-3'
              aria-label={t('workspace.recentOpportunities')}
            >
              <h2 className='text-lg font-semibold'>
                {t('workspace.recentOpportunities')}
              </h2>
              <DataTable
                columns={opportunityColumns}
                data={workspace.opportunities}
                pagination={false}
                showSelectedCount={false}
                listState={resolveListState(
                  { data: workspace.opportunities },
                  workspace.opportunities.length,
                  false,
                )}
                emptyMessage={t('workspace.noOpportunities')}
              />
            </section>
            <section
              className='flex min-w-0 flex-col gap-3'
              aria-label={t('workspace.recentQuotes')}
            >
              <h2 className='text-lg font-semibold'>
                {t('workspace.recentQuotes')}
              </h2>
              <DataTable
                columns={quoteColumns}
                data={workspace.quotes}
                pagination={false}
                showSelectedCount={false}
                listState={resolveListState(
                  { data: workspace.quotes },
                  workspace.quotes.length,
                  false,
                )}
                emptyMessage={t('workspace.noQuotes')}
              />
            </section>
          </div>
        </>
      )}
    </PageContainer>
  );
}
