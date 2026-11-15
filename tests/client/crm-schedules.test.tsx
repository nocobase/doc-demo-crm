import {
  answerApi,
  renderWithApp,
  type ApiCall,
} from '@nocobase/app-testing/client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import Schedules from '../../client/pages/reminders/schedules.js';
import enUS from '../../client/locales/en-US.js';
import metadata from '../../package.json' with { type: 'json' };
it('shows native occurrence timestamps and result counts and persists pause through the API', async () => {
  let enabled = true;
  const api = vi.fn(({ path, method }: ApiCall) => {
    const item = {
      id: 'schedule',
      title: 'Customer follow-up reminders',
      cron: '* * * * *',
      timezone: 'UTC',
      enabled,
      scheduleStatus: enabled ? 'active' : 'paused',
      nextRunAt: '2026-11-15T13:01:00.000Z',
    };
    if (path === 'scheduler/schedules')
      return { data: [item], meta: { total: 1 } };
    if (path.endsWith('/occurrences'))
      return {
        data: [
          {
            id: 'execution',
            status: 'succeeded',
            startedAt: '2026-11-15T13:00:00.000Z',
            resultSummary: { checked: 17, queued: 3, skipped: 14 },
          },
        ],
        meta: {},
      };
    if (method === 'POST' && path.endsWith('/disable')) {
      enabled = false;
      return { data: { ...item, enabled: false } };
    }
    return new Response(null, { status: 404 });
  });
  await renderWithApp(<Schedules />, {
    route: '/',
    namespace: metadata.name,
    namespaces: { [metadata.name]: enUS },
    fetch: answerApi(api),
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Customer follow-up reminders' }),
  );
  await screen.findByText('Succeeded');
  expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  expect(screen.getByText('17')).toBeInTheDocument();
  expect(screen.getByText('14')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Pause', exact: true }));
  await screen.findByRole('button', { name: 'Resume', exact: true });
  expect(enabled).toBe(false);
});
