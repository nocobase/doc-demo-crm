import { resolveListState } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RecordLink } from '#components/record-link';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { useListLocation } from '#hooks/use-list-location';
import { useListData } from '#hooks/use-list-data';
import {
  readTableUrlState,
  useTableUrlState,
} from '#hooks/use-table-url-state';
import { Choice } from './shared.js';
import type { Customer, ListResult } from './types.js';

export default function CustomersPage() {
  const { t } = useTranslation();
  const { active, params, setParams } = useListLocation();
  const [draft, setDraft] = useState(params.get('q') ?? '');
  const status = ['prospect', 'customer', 'inactive'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : 'all';
  const parsed = readTableUrlState(params, {
    sortColumns: [],
    defaultPageSize: 20,
  });
  const query = new URLSearchParams({
    q: params.get('q') ?? '',
    page: String(parsed.paginationState.pageIndex + 1),
    pageSize: String(parsed.paginationState.pageSize),
  });
  if (status !== 'all') query.set('status', status);
  const path = `crm/customers?${query}`;
  const request = useListData<ListResult<Customer>>(path, { active });
  const table = useTableUrlState({
    sortColumns: [],
    defaultPageSize: 20,
    active,
    revision: request.revision,
    rowCount: request.data?.meta.total,
  });
  const state = resolveListState(
    {
      data: request.data,
      error: request.error ?? table.error,
      isPending: request.loading && !request.data,
    },
    request.data?.meta.total ?? 0,
    Boolean(query.get('q')) || status !== 'all',
  );
  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('crm.name'),
        cell: ({ row }) => (
          <RecordLink
            to={`${row.original.id}/details`}
            className='block max-w-64 truncate'
            title={row.original.name}
          >
            {row.original.name}
          </RecordLink>
        ),
      },
      { accessorKey: 'industry', header: t('crm.industry') },
      {
        accessorKey: 'status',
        header: t('crm.status'),
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.status === 'customer'
                ? 'success'
                : row.original.status === 'prospect'
                  ? 'info'
                  : 'neutral'
            }
          >
            {t(`crm.${row.original.status}`)}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );
  const create = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: params.toString() }} />}
    >
      {t('crm.newCustomer')}
    </Button>
  );
  const updateFilter = (key: string, value: string) => {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('crm.title')}
        description={t('crm.description')}
        actions={state === 'empty' ? undefined : create}
      />
      <form
        className='flex flex-wrap items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          updateFilter('q', draft.trim());
        }}
      >
        <Input
          aria-label={t('crm.search')}
          placeholder={t('crm.search')}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          className='w-full sm:max-w-xs'
        />
        <Button variant='outline' type='submit'>
          {t('crm.searchAction')}
        </Button>
        <Choice
          value={status}
          values={['all', 'prospect', 'customer', 'inactive']}
          label={t('crm.status')}
          onChange={(value) => updateFilter('status', value)}
        />
      </form>
      <DataTable
        columns={columns}
        data={request.data?.data ?? []}
        getRowId={(row) => row.id}
        manualPagination
        rowCount={request.data?.meta.total ?? 0}
        paginationState={table.paginationState}
        onPaginationChange={table.onPaginationChange}
        pageSizeOptions={table.pageSizeOptions}
        showSelectedCount={false}
        listState={state}
        loading={active && request.loading}
        loadingIdentity={path}
        onRetry={request.reload}
        onClearFilters={() => {
          setDraft('');
          setParams({});
        }}
        emptyAction={state === 'empty' ? create : undefined}
        emptyMessage={t('crm.empty')}
      />
      <Outlet context={{ reload: request.reload }} />
    </PageContainer>
  );
}
