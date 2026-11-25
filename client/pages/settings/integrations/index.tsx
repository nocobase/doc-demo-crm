import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { PendingButton } from '#components/pending-button';
import { StatusBadge } from '#components/status-badge';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Switch } from '#components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../../customers/shared.js';

interface SyncTarget {
  id: string;
  key: string;
  name: string;
  endpointUrl: string;
  secretHeader: string;
  enabled: boolean;
  simulateFailure: boolean;
  updatedAt: string;
}

interface SyncDelivery {
  id: string;
  idempotencyKey: string;
  entityType: 'quote' | 'opportunity';
  entityId: string;
  entityTitle: string;
  eventType: 'quote.confirmed' | 'opportunity.won';
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  httpStatus: number | null;
  externalReference: string | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  succeededAt: string | null;
}

function deliveryTone(status: SyncDelivery['status']) {
  if (status === 'succeeded') return 'success' as const;
  if (status === 'pending') return 'info' as const;
  return 'warning' as const;
}

export default function ExternalIntegrationsSettingsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const targetReq = useListData<{ data: SyncTarget }>('crmIntegrations/target');
  const deliveriesReq = useListData<{ data: SyncDelivery[] }>(
    'crmIntegrations/deliveries',
  );

  const [draft, setDraft] = useState<Partial<SyncTarget>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loaded = targetReq.data?.data;
  const name = draft.name ?? loaded?.name ?? 'ERP & Finance Order Sync';
  const endpointUrl =
    draft.endpointUrl ?? loaded?.endpointUrl ?? 'mock://erp-finance/orders';
  const secretHeader = draft.secretHeader ?? loaded?.secretHeader ?? '';
  const enabled = draft.enabled ?? loaded?.enabled ?? true;
  const simulateFailure =
    draft.simulateFailure ?? loaded?.simulateFailure ?? false;

  const handleSaveTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      await api.request({
        path: 'crmIntegrations/target',
        method: 'PUT',
        json: {
          name: name.trim(),
          endpointUrl: endpointUrl.trim(),
          secretHeader: secretHeader.trim(),
          enabled,
          simulateFailure,
        },
      });
      setDraft({});
      setMessage(t('integrations.targetSaved'));
      targetReq.reload();
    } catch (error) {
      setErrorMsg(
        error instanceof Error
          ? error.message
          : t('integrations.targetSaveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async (deliveryId: string) => {
    setErrorMsg(null);
    try {
      await api.request({
        path: `crmIntegrations/deliveries/${deliveryId}/retry`,
        method: 'POST',
      });
      window.setTimeout(() => deliveriesReq.reload(), 300);
      deliveriesReq.reload();
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : t('integrations.retryFailed'),
      );
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('integrations.title')}
        description={t('integrations.description')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.targetTitle')}</CardTitle>
          <CardDescription>{t('integrations.targetHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {targetReq.error ? (
            <ReadError error={targetReq.error} retry={targetReq.reload} />
          ) : (
            <form
              className='space-y-4'
              onSubmit={(e) => void handleSaveTarget(e)}
            >
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='erp-name'>
                    {t('integrations.targetName')}
                  </Label>
                  <Input
                    id='erp-name'
                    value={name}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='erp-url'>
                    {t('integrations.endpointUrl')}
                  </Label>
                  <Input
                    id='erp-url'
                    value={endpointUrl}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        endpointUrl: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </div>
              <div className='grid gap-4 md:grid-cols-3'>
                <div className='space-y-2'>
                  <Label htmlFor='erp-secret'>
                    {t('integrations.secretHeader')}
                  </Label>
                  <Input
                    id='erp-secret'
                    value={secretHeader}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        secretHeader: e.target.value,
                      }))
                    }
                    placeholder='Optional X-Integration-Secret'
                  />
                </div>
                <div className='flex items-center justify-between rounded-md border p-3'>
                  <Label htmlFor='erp-enabled'>
                    {t('integrations.enabled')}
                  </Label>
                  <Switch
                    id='erp-enabled'
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>
                <div className='flex items-center justify-between rounded-md border p-3'>
                  <Label htmlFor='erp-fail'>
                    {t('integrations.simulateFailure')}
                  </Label>
                  <Switch
                    id='erp-fail'
                    checked={simulateFailure}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({
                        ...prev,
                        simulateFailure: checked,
                      }))
                    }
                  />
                </div>
              </div>
              {message ? (
                <Alert>
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              ) : null}
              {errorMsg ? (
                <Alert variant='destructive'>
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              ) : null}
              <PendingButton type='submit' busy={saving}>
                {t('crm.save')}
              </PendingButton>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0'>
          <div>
            <CardTitle>{t('integrations.deliveriesTitle')}</CardTitle>
            <CardDescription>
              {t('integrations.deliveriesHint')}
            </CardDescription>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => deliveriesReq.reload()}
          >
            <RefreshCw className='mr-2 size-4' />
            {t('crmImports.refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          {deliveriesReq.error ? (
            <ReadError
              error={deliveriesReq.error}
              retry={deliveriesReq.reload}
            />
          ) : (deliveriesReq.data?.data.length ?? 0) === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('integrations.noDeliveries')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('integrations.event')}</TableHead>
                  <TableHead>{t('integrations.record')}</TableHead>
                  <TableHead>{t('integrations.idempotencyKey')}</TableHead>
                  <TableHead>{t('integrations.status')}</TableHead>
                  <TableHead>{t('integrations.attempts')}</TableHead>
                  <TableHead>{t('integrations.externalRef')}</TableHead>
                  <TableHead className='text-right'>
                    {t('integrations.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveriesReq.data!.data.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className='font-mono text-xs'>
                      {delivery.eventType}
                    </TableCell>
                    <TableCell className='max-w-44 truncate font-medium'>
                      {delivery.entityTitle || delivery.entityId}
                    </TableCell>
                    <TableCell
                      className='max-w-44 truncate font-mono text-xs text-muted-foreground'
                      title={delivery.idempotencyKey}
                    >
                      {delivery.idempotencyKey}
                    </TableCell>
                    <TableCell className='max-w-52 whitespace-normal'>
                      <StatusBadge tone={deliveryTone(delivery.status)}>
                        {t(`integrations.delivery_${delivery.status}`)}
                      </StatusBadge>
                      {delivery.errorMessage ? (
                        <div className='mt-1 text-xs leading-snug text-destructive'>
                          {delivery.errorMessage}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {delivery.attempts}
                      {delivery.httpStatus ? ` (${delivery.httpStatus})` : ''}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {delivery.externalReference ?? '—'}
                    </TableCell>
                    <TableCell className='text-right'>
                      {delivery.status === 'failed' ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => void handleRetry(delivery.id)}
                        >
                          <RotateCcw className='mr-1 size-3.5' />
                          {t('integrations.retrySync')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
