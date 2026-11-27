import { useCan } from '@nocobase/app-plugin-authorization/client';
import { crmOperations } from '../../../server/crm-operations.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { PendingButton } from '#components/pending-button';
import { StatusBadge } from '#components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { useListData } from '#hooks/use-list-data';

interface SyncDelivery {
  id: string;
  idempotencyKey: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  httpStatus: number | null;
  externalReference: string | null;
  errorMessage: string | null;
}

export default function QuoteErpSync({
  quoteId,
  confirmed,
}: {
  quoteId: string;
  confirmed: boolean;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const read = useCan(crmOperations.readIntegrations);
  const sync = useCan(crmOperations.syncIntegrations);
  const deliveries = useListData<{ data: SyncDelivery[] }>(
    `crmIntegrations/deliveries?entityType=quote&entityId=${quoteId}`,
    { active: confirmed && read.can },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirmed || !read.can) return null;
  if (deliveries.error) return null;

  const latest = deliveries.data?.data[0];

  const triggerSync = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.request({
        path: `crmIntegrations/sync/quotes/${quoteId}`,
        method: 'POST',
      });
      window.setTimeout(() => deliveries.reload(), 300);
      deliveries.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('integrations.syncFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integrations.quoteSyncTitle')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-sm text-muted-foreground'>
          {t('integrations.quoteSyncHint')}
        </p>
        {latest ? (
          <div className='flex flex-wrap items-center gap-3 text-sm'>
            <StatusBadge
              tone={
                latest.status === 'succeeded'
                  ? 'success'
                  : latest.status === 'pending'
                    ? 'info'
                    : 'warning'
              }
            >
              {t(`integrations.delivery_${latest.status}`)}
            </StatusBadge>
            {latest.externalReference ? (
              <span className='font-mono text-xs'>
                {latest.externalReference}
              </span>
            ) : null}
            <span className='text-xs text-muted-foreground'>
              {t('integrations.attempts')}: {latest.attempts}
            </span>
          </div>
        ) : null}
        {latest?.errorMessage ? (
          <p role='alert' className='text-sm text-destructive'>
            {latest.errorMessage}
          </p>
        ) : null}
        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        {sync.can && (!latest || latest.status === 'failed') ? (
          <PendingButton busy={busy} onClick={() => void triggerSync()}>
            {latest ? (
              <RefreshCw className='mr-2 size-4' />
            ) : (
              <Send className='mr-2 size-4' />
            )}
            {latest ? t('integrations.retrySync') : t('integrations.syncToErp')}
          </PendingButton>
        ) : null}
      </CardContent>
    </Card>
  );
}
