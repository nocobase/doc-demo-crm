import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { MailMessageSummary } from '@nocobase/app-plugin-mail/client';
import type { ColumnDef } from '@tanstack/react-table';
import { resolveListState } from '@nocobase/app-client';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
import type { Contact, ListResult } from '../customers/types.js';
export default function CustomerMail({
  customerId,
  revision,
}: {
  customerId: string;
  revision: number;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [contactId, setContactId] = useState('');
  const contacts = useListData<ListResult<Contact>>(
    `crm/customers/${customerId}/contacts?page=${page}&revision=${revision}`,
  );
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-lg font-semibold'>{t('crmMail.title')}</h2>
        <Button
          nativeButton={false}
          variant='outline'
          render={<Link to='/mail' />}
        >
          {t('crmMail.workspace')}
        </Button>
      </div>
      <p className='text-sm text-muted-foreground'>{t('crmMail.scope')}</p>
      {contacts.error ? (
        <ReadError error={contacts.error} retry={contacts.reload} />
      ) : (
        <>
          <div className='flex flex-wrap gap-2'>
            {contacts.data?.data
              .filter((c) => c.email)
              .map((c) => (
                <Button
                  key={c.id}
                  variant={contactId === c.id ? 'default' : 'outline'}
                  onClick={() => setContactId(c.id)}
                >
                  {c.name} · {c.email}
                </Button>
              ))}
          </div>
          <div className='flex gap-2'>
            {page > 1 ? (
              <Button
                variant='outline'
                onClick={() => {
                  setPage((p) => p - 1);
                  setContactId('');
                }}
              >
                {t('crmMail.previous')}
              </Button>
            ) : null}
            {page * 20 < (contacts.data?.meta.total ?? 0) ? (
              <Button
                variant='outline'
                onClick={() => {
                  setPage((p) => p + 1);
                  setContactId('');
                }}
              >
                {t('crmMail.next')}
              </Button>
            ) : null}
          </div>
          {contactId ? (
            <Correspondence
              key={`${customerId}:${contactId}:${revision}`}
              customerId={customerId}
              contactId={contactId}
            />
          ) : (
            <p className='text-muted-foreground'>
              {t('crmMail.chooseContact')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function Correspondence({
  customerId,
  contactId,
}: {
  customerId: string;
  contactId: string;
}) {
  const { t } = useTranslation();
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `crmMail/customers/${customerId}?contactId=${contactId}&page=${pagination.pageIndex + 1}`;
  const request = useListData<ListResult<MailMessageSummary>>(path);
  const columns: ColumnDef<MailMessageSummary>[] = [
    { accessorKey: 'subject', header: t('crmMail.subject') },
    {
      id: 'from',
      header: t('crmMail.from'),
      cell: ({ row }) => row.original.from?.address,
    },
    { accessorKey: 'preview', header: t('crmMail.preview') },
    {
      accessorKey: 'receivedAt',
      header: t('crmMail.createdAt'),
      cell: ({ row }) =>
        row.original.receivedAt
          ? new Date(row.original.receivedAt).toLocaleString()
          : '—',
    },
  ];
  return (
    <>
      <Button variant='outline' onClick={request.reload}>
        {t('crmMail.refresh')}
      </Button>
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
    </>
  );
}
