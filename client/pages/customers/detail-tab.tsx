import { CustomerAttachments } from '../documents/files.js';
import { resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, Outlet, useOutletContext, useResolvedPath } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import { DataTable } from '#components/data-table';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { CustomerAccessPanel } from './access-panel.js';
import { ReadError } from './shared.js';
import { SalesRelated } from '../sales/lists.js';
import type {
  CustomerContext,
  Contact,
  FollowUp,
  ListResult,
} from './types.js';

export default function CustomerTab() {
  const context = useOutletContext<CustomerContext>();
  const { customer, revision = 0 } = context;
  const { t } = useTranslation();
  const tab = useResolvedPath('.').pathname.split('/').at(-1);
  if (!customer) return <Loading />;
  return (
    <>
      {tab === 'overview' ? (
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
          <CustomerAccessPanel
            customerId={customer.id}
            revision={revision}
            reload={context.reload}
          />
        </>
      ) : tab === 'attachments' ? (
        <CustomerAttachments customerId={customer.id} revision={revision} />
      ) : tab === 'opportunities' ? (
        <SalesRelated
          customerId={customer.id}
          revision={revision}
          recordPath=''
        />
      ) : (
        <Related
          customerId={customer.id}
          kind={tab === 'contacts' ? 'contacts' : 'followUps'}
          revision={revision}
        />
      )}
      <Outlet context={context} />
    </>
  );
}
function Related({
  customerId,
  kind,
  revision,
}: {
  customerId: string;
  kind: 'contacts' | 'followUps';
  revision: number;
}) {
  const { t, i18n } = useTranslation();
  const access = useCustomerOperation(
    customerId,
    kind === 'contacts' ? 'addContact' : 'recordFollowUp',
  );
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `crm/customers/${customerId}/${kind}?page=${pagination.pageIndex + 1}&revision=${revision}`;
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
  const action = access.allowed ? (
    <Button
      variant='outline'
      nativeButton={false}
      render={<Link to={kind === 'contacts' ? 'newContact' : 'newFollowUp'} />}
    >
      {t(kind === 'contacts' ? 'crm.newContact' : 'crm.newFollowUp')}
    </Button>
  ) : undefined;
  return (
    <section className='space-y-3' aria-label={t(`crm.${kind}`)}>
      {access.error ? (
        <ReadError error={access.error} retry={access.reload} />
      ) : null}
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
