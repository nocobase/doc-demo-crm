import { useState } from 'react';
import {
  useApiClient,
  useSubmission,
  resolveListState,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '#components/data-table';
import { FeedbackForm } from '#components/feedback-form';
import { PendingButton } from '#components/pending-button';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
type Plan = {
  id: string;
  title: string;
  kind: string;
  dueAt: string;
  status: string;
};
export default function CustomerReminders({
  customerId,
  revision,
}: {
  customerId: string;
  revision: number;
}) {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const access = useCustomerOperation(customerId, 'editCustomer');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const path = `crmReminders/customers/${customerId}?page=${pagination.pageIndex + 1}&revision=${revision}`;
  const request = useListData<{ data: Plan[]; meta: { total: number } }>(path);
  const quotes = useListData<{ data: { id: string; name: string }[] }>(
    `crmReminders/customers/${customerId}/quotes`,
  );
  const [title, setTitle] = useState(''),
    [dueAt, setDueAt] = useState(''),
    [kind, setKind] = useState('followUp'),
    [quoteId, setQuoteId] = useState(''),
    [error, setError] = useState<unknown>();
  const submission = useSubmission({
    scope: `${session?.user.id}:reminder:${customerId}`,
  });
  const columns: ColumnDef<Plan>[] = [
    { accessorKey: 'title', header: t('reminders.name') },
    {
      accessorKey: 'kind',
      header: t('reminders.kind'),
      cell: ({ row }) => t(`reminders.${row.original.kind}`),
    },
    {
      accessorKey: 'dueAt',
      header: t('reminders.dueAt'),
      cell: ({ row }) =>
        new Date(row.original.dueAt).toLocaleString(i18n.language),
    },
    {
      accessorKey: 'status',
      header: t('reminders.status'),
      cell: ({ row }) => t(`reminders.${row.original.status}`),
    },
    {
      id: 'actions',
      header: t('reminders.actions'),
      cell: ({ row }) =>
        access.allowed &&
        ['pending', 'notified'].includes(row.original.status) ? (
          <PlanActions
            customerId={customerId}
            plan={row.original}
            reload={request.reload}
          />
        ) : null,
    },
  ];
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-lg font-semibold'>{t('reminders.title')}</h2>
        <Button variant='outline' onClick={request.reload}>
          {t('crmMail.refresh')}
        </Button>
      </div>
      <p className='text-sm text-muted-foreground'>{t('reminders.hint')}</p>
      {access.error ? (
        <ReadError error={access.error} retry={access.reload} />
      ) : null}
      {access.allowed ? (
        <FeedbackForm
          error={error}
          submitting={submission.submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setError(undefined);
              await submission.run(
                {
                  title,
                  kind,
                  dueAt: new Date(dueAt).toISOString(),
                  ...(kind === 'quoteExpiry' ? { quoteId } : {}),
                },
                (key, signal, input) =>
                  api.request({
                    path: `crmReminders/customers/${customerId}`,
                    method: 'POST',
                    json: input,
                    signal,
                    headers: { 'Idempotency-Key': key },
                  }),
              );
              setTitle('');
              setDueAt('');
              request.reload();
            } catch (failure) {
              setError(failure);
            }
          }}
        >
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='reminder-title'>{t('reminders.name')}</Label>
              <Input
                id='reminder-title'
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='reminder-time'>{t('reminders.dueAt')}</Label>
              <Input
                id='reminder-time'
                type='datetime-local'
                required
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>{t('reminders.kind')}</Label>
              <Select value={kind} onValueChange={(v) => setKind(String(v))}>
                <SelectTrigger aria-label={t('reminders.kind')}>
                  <SelectValue>{t(`reminders.${kind}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {['followUp', 'quoteExpiry'].map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`reminders.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind === 'quoteExpiry' ? (
              <div className='space-y-1'>
                <Label>{t('reminders.quote')}</Label>
                <Select
                  value={quoteId}
                  onValueChange={(v) => setQuoteId(String(v))}
                >
                  <SelectTrigger aria-label={t('reminders.quote')}>
                    <SelectValue placeholder={t('reminders.chooseQuote')}>
                      {
                        quotes.data?.data.find((quote) => quote.id === quoteId)
                          ?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {quotes.data?.data.map((q) => (
                      <SelectItem value={q.id} key={q.id}>
                        {q.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quotes.error ? (
                  <ReadError error={quotes.error} retry={quotes.reload} />
                ) : null}
              </div>
            ) : null}
          </div>
          <PendingButton
            type='submit'
            busy={submission.submitting}
            disabled={
              !title.trim() || !dueAt || (kind === 'quoteExpiry' && !quoteId)
            }
          >
            {t('reminders.schedule')}
          </PendingButton>
        </FeedbackForm>
      ) : null}
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
    </section>
  );
}
function PlanActions({
  customerId,
  plan,
  reload,
}: {
  customerId: string;
  plan: Plan;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const [error, setError] = useState<unknown>();
  const submission = useSubmission({
    scope: `${session?.user.id}:reminder-action:${plan.id}`,
  });
  async function act(action: string) {
    try {
      setError(undefined);
      await submission.run({ action }, (key, signal, input) =>
        api.request({
          path: `crmReminders/customers/${customerId}/${plan.id}/${input.action}`,
          method: 'POST',
          signal,
          headers: { 'Idempotency-Key': key },
        }),
      );
      reload();
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <div className='flex flex-wrap gap-2'>
      {['complete', 'cancel'].map((action) => (
        <PendingButton
          key={action}
          variant='outline'
          busy={submission.submitting}
          onClick={() => void act(action)}
        >
          {t(`reminders.${action}`)}
        </PendingButton>
      ))}
      {error ? <ReadError error={error} retry={reload} /> : null}
    </div>
  );
}
