import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  NotificationLogsView,
  type NotificationLogDetails,
} from '#extensions/nocobase-notification-logs-ui/index';
import { Button } from '#components/ui/button';
import { SettingsModulePage } from '../settings-module-page.js';
export default function NotificationLogs() {
  const { t } = useTranslation();
  const api = useApiClient();
  const [search, setSearch] = useSearchParams();
  const token = search.get('pageToken') ?? undefined;
  const logId = search.get('logId');
  const [next, setNext] = useState<string>();
  const [revision, setRevision] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        if (logId) {
          const response = await api.request<{ data: NotificationLogDetails }>({
            path: `notifications/logs/${encodeURIComponent(logId)}`,
            signal,
          });
          setNext(undefined);
          return [response.data];
        }
        const response = await api.request<{
          data: NotificationLogDetails[];
          meta: { nextPageToken?: string };
        }>({
          path: 'notifications/logs',
          query: { pageSize: 20, ...(token ? { pageToken: token } : {}) },
          signal,
        });
        setNext(response.meta.nextPageToken);
        return response.data;
      } catch {
        throw new Error(t('crmNotifications.readFailed'));
      }
    },
    [api, logId, token, t],
  );
  return (
    <SettingsModulePage title={t('crmNotifications.logs')}>
      <NotificationLogsView
        key={`${logId ?? token ?? 'first'}:${revision}`}
        loadLogs={load}
        showHeading={false}
      />
      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          onClick={() => setRevision((value) => value + 1)}
        >
          {t('crmNotifications.refresh')}
        </Button>
        <Button
          variant='outline'
          disabled={!token && !logId}
          onClick={() => setSearch({})}
        >
          {t('crmNotifications.latest')}
        </Button>
        <Button
          variant='outline'
          disabled={!next || Boolean(logId)}
          onClick={() => {
            if (next) setSearch({ pageToken: next });
          }}
        >
          {t('crmNotifications.older')}
        </Button>
      </div>
    </SettingsModulePage>
  );
}
