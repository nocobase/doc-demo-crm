import { answerApi } from '@nocobase/app-testing/client';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { renderSettingsClient } from '../helpers/settings-client.js';
import WorkspacePage from '../../client/pages/sales-workspace/index.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
const customer = { id: 'customer-1', name: 'Northstar Labs' };
const opportunity = {
  id: 'opportunity-1',
  name: 'Team rollout',
  customerId: customer.id,
  customer,
  stage: 'proposal',
  updatedAt: '2026-11-12T01:00:00Z',
};
const data = {
  counts: { customers: 3, opportunities: 2, quotes: 4 },
  followUps: [
    {
      id: 'followup-1',
      customerId: customer.id,
      customer,
      channel: 'meeting',
      content: 'Discussed a team rollout.',
      nextStep: 'Review the proposal.',
      authorName: 'Morgan',
      createdAt: '2026-11-12T01:00:00Z',
    },
  ],
  opportunities: [opportunity],
  quotes: [
    {
      id: 'quote-1',
      name: 'Annual rollout proposal',
      total: 1150,
      opportunity,
      updatedAt: '2026-11-12T01:00:00Z',
    },
  ],
};
function mount(fetch: typeof globalThis.fetch, locale = 'en-US') {
  return renderSettingsClient(<WorkspacePage />, {
    fetch,
    route: '/sales',
    locale,
    namespace: 'workspace-test',
    namespaces: {
      'workspace-test': {
        'en-US': async () => ({ default: enUS }),
        'zh-CN': async () => ({ default: zhCN }),
      },
    },
  });
}
it('shows business summaries and links to the actual customer, opportunity and quote', async () => {
  await mount(answerApi(() => ({ data })));
  expect(
    await screen.findByRole('heading', { name: 'Sales workspace' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('$1,150.00')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Annual rollout proposal' }),
  ).toHaveAttribute(
    'href',
    '/customers/customer-1/details/opportunities/opportunity-1/quotes/quote-1',
  );
  expect(
    screen.getAllByRole('link', { name: 'Team rollout' })[0],
  ).toHaveAttribute(
    'href',
    '/customers/customer-1/details/opportunities/opportunity-1',
  );
  expect(
    screen.getAllByRole('link', { name: 'Northstar Labs' })[0],
  ).toHaveAttribute('href', '/customers/customer-1/details/followUps');
});
it('keeps its page header during a pending read and recovers from a failed read through Retry', async () => {
  const deferred = Promise.withResolvers<Response>();
  let calls = 0;
  await mount(
    answerApi(() => {
      calls++;
      return calls === 1 ? deferred.promise : { data };
    }),
  );
  expect(
    screen.getByRole('heading', { name: 'Sales workspace' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('$1,150.00')).not.toBeInTheDocument();
  try {
    await act(async () => {
      deferred.resolve(
        Response.json({ error: { message: 'Unavailable' } }, { status: 500 }),
      );
      await deferred.promise;
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('$1,150.00')).toBeInTheDocument();
    await waitFor(() => expect(calls).toBe(2));
  } finally {
    deferred.resolve(Response.json({ data }));
  }
});
it('shows useful empty-state text in Chinese without substituting fake totals', async () => {
  await mount(
    answerApi(() => ({
      data: {
        counts: { customers: 0, opportunities: 0, quotes: 0 },
        followUps: [],
        opportunities: [],
        quotes: [],
      },
    })),
    'zh-CN',
  );
  expect(
    await screen.findByText('暂无跟进记录，请打开客户记录沟通。'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('暂无商机，请打开客户创建商机。'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('暂无报价，请打开商机创建报价。'),
  ).toBeInTheDocument();
});
