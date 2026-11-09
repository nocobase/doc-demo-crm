import { usePageBreadcrumb, resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import {
  Link,
  Outlet,
  useParams,
  useOutletContext,
  useResolvedPath,
} from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { DataTable } from '#components/data-table';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useRouteSearches } from '../../routing/route-context.js';
import { ReadError } from './shared.js';
import type {
  Customer,
  CustomerContext,
  Contact,
  FollowUp,
  ListResult,
} from './types.js';

export default function CustomerDetail() {
  const { t } = useTranslation();
  const { customerId } = useParams();
  const parent = useResolvedPath('..').pathname;
  const searches = useRouteSearches();
  const owner = useOutletContext<CustomerContext>();
  const request = useListData<{ data: Customer }>(
    `crm/customers/${customerId}`,
  );
  const customer = request.error ? undefined : request.data?.data;
  usePageBreadcrumb([
    {
      label: t('crm.title'),
      to: { pathname: parent, search: searches.get(parent) ?? '' },
    },
    { label: customer?.name ?? t('crm.detail') },
  ]);
  const [revision, setRevision] = useState(0);
  const reload = () => {
    request.reload();
    owner.reload();
    setRevision((v) => v + 1);
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={customer?.name ?? t('crm.detail')}
          actions={
            customer ? (
              <Button nativeButton={false} render={<Link to='edit' />}>
                {t('crm.editCustomer')}
              </Button>
            ) : undefined
          }
        />
        {request.error ? (
          <ReadError error={request.error} retry={request.reload} />
        ) : !customer ? (
          <Loading />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t('crm.overview')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className='grid gap-4 sm:grid-cols-2'>
                  {[
                    ['industry', customer.industry],
                    ['status', t(`crm.${customer.status}`)],
                    ['website', customer.website],
                    ['notes', customer.notes],
                  ].map(([key, value]) => (
                    <div
                      key={key}
                      className={key === 'notes' ? 'sm:col-span-2' : ''}
                    >
                      <dt className='text-sm text-muted-foreground'>
                        {t(`crm.${key}`)}
                      </dt>
                      <dd className='mt-1 whitespace-pre-wrap break-words'>
                        {value || t('crm.notProvided')}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Related
              key={`contacts-${revision}`}
              customerId={customer.id}
              kind='contacts'
            />
            <Related
              key={`followUps-${revision}`}
              customerId={customer.id}
              kind='followUps'
            />
          </>
        )}
        <Outlet context={{ customer, reload }} />
      </PageContainer>
    </RouteChildPage>
  );
}
function Related({
  customerId,
  kind,
}: {
  customerId: string;
  kind: 'contacts' | 'followUps';
}) {
  const { t, i18n } = useTranslation();
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `crm/customers/${customerId}/${kind}?page=${pagination.pageIndex + 1}`;
  const request = useListData<ListResult<Contact & FollowUp>>(path);
  const state = resolveListState(
    {
      data: request.data,
      error: request.error,
      isPending: request.loading && !request.data,
    },
    request.data?.meta.total ?? 0,
    false,
  );
  const columns: ColumnDef<Contact & FollowUp>[] =
    kind === 'contacts'
      ? [
          { accessorKey: 'name', header: t('crm.contactName') },
          { accessorKey: 'role', header: t('crm.role') },
          { accessorKey: 'email', header: t('crm.email') },
          { accessorKey: 'phone', header: t('crm.phone') },
        ]
      : [
          {
            accessorKey: 'createdAt',
            header: t('crm.recordedAt'),
            cell: ({ row }) =>
              new Date(row.original.createdAt).toLocaleString(i18n.language),
          },
          {
            accessorKey: 'channel',
            header: t('crm.channel'),
            cell: ({ row }) => t(`crm.${row.original.channel}`),
          },
          {
            accessorKey: 'content',
            header: t('crm.content'),
            cell: ({ row }) => (
              <p className='min-w-48 max-w-md whitespace-pre-wrap break-words'>
                {row.original.content}
              </p>
            ),
          },
          {
            accessorKey: 'nextStep',
            header: t('crm.nextStep'),
            cell: ({ row }) => (
              <p className='min-w-40 max-w-xs whitespace-pre-wrap break-words'>
                {row.original.nextStep || t('crm.notProvided')}
              </p>
            ),
          },
          { accessorKey: 'authorName', header: t('crm.author') },
        ];
  const action = (
    <Button
      variant='outline'
      nativeButton={false}
      render={<Link to={kind === 'contacts' ? 'newContact' : 'newFollowUp'} />}
    >
      {t(kind === 'contacts' ? 'crm.newContact' : 'crm.newFollowUp')}
    </Button>
  );
  return (
    <section className='space-y-3' aria-label={t(`crm.${kind}`)}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-lg font-semibold'>{t(`crm.${kind}`)}</h2>
        {state === 'empty' ? null : action}
      </div>
      <DataTable
        columns={columns}
        data={request.data?.data ?? []}
        getRowId={(row) => row.id}
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
        emptyAction={state === 'empty' ? action : undefined}
      />
    </section>
  );
}
