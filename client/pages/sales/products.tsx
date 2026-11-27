import { resolveListState, usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { useListData } from '#hooks/use-list-data';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { ReadError } from '../customers/shared.js';
import type { ListResult } from '../customers/types.js';
import { money, type Product } from './types.js';
export default function Products() {
  const { t } = useTranslation();
  const create = useCan({
    resource: { type: 'composite', id: 'crm.products' },
    action: 'create',
  });
  const edit = useCan({
    resource: { type: 'composite', id: 'crm.products' },
    action: 'edit',
  });
  usePageBreadcrumb([{ label: t('sales.products') }]);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `crmSales/products?page=${pagination.pageIndex + 1}&q=${encodeURIComponent(search)}`;
  const request = useListData<ListResult<Product>>(path);
  const state = resolveListState(
    {
      data: request.data,
      error: request.error,
      isPending: request.loading && !request.data,
    },
    request.data?.meta.total ?? 0,
    Boolean(search),
  );
  const columns: ColumnDef<Product>[] = [
    { accessorKey: 'name', header: t('sales.name') },
    { accessorKey: 'code', header: t('sales.code') },
    {
      accessorKey: 'unitPrice',
      header: t('sales.unitPrice'),
      cell: ({ row }) => money(row.original.unitPrice),
    },
    {
      id: 'edit',
      header: '',
      cell: ({ row }) =>
        edit.can ? (
          <Button
            variant='ghost'
            nativeButton={false}
            render={<Link to={`${row.original.id}/edit`} />}
          >
            {t('sales.editProduct')}
          </Button>
        ) : null,
    },
  ];
  const action = create.can ? (
    <Button nativeButton={false} render={<Link to='new' />}>
      {t('sales.newProduct')}
    </Button>
  ) : undefined;
  return (
    <PageContainer>
      <PageHeader
        title={t('sales.products')}
        description={t('sales.catalogueHint')}
        actions={action}
      />
      {create.error || edit.error ? (
        <ReadError
          error={create.error ?? edit.error}
          retry={() => {
            void create.retry();
            void edit.retry();
          }}
        />
      ) : null}
      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setPagination({ pageIndex: 0, pageSize: 20 });
        }}
      >
        <Input
          aria-label={t('sales.searchProducts')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type='submit' variant='outline'>
          {t('crm.searchAction')}
        </Button>
      </form>
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
      <Outlet context={{ reload: request.reload }} />
    </PageContainer>
  );
}
