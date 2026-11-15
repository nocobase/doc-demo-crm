import { answerApi } from '@nocobase/app-testing/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { renderCrmClient } from '../helpers/crm-client.js';
import QuoteApprovalPanel from '../../client/pages/sales/approval.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
const namespace = 'approval-test';
const draft = {
  status: 'draft',
  thresholdPercent: 10,
  view: null,
  runs: [],
  actions: [],
};
async function mount(fetch: typeof globalThis.fetch, readOnly = false) {
  const onHandled = vi.fn();
  await renderCrmClient(
    <Routes>
      <Route
        path='/quotes/:customerId/:opportunityId/:quoteId'
        element={<QuoteApprovalPanel revision={0} onHandled={onHandled} />}
      />
    </Routes>,
    {
      fetch,
      route: '/quotes/customer/opportunity/quote',
      namespace,
      namespaces: {
        [namespace]: {
          'en-US': async () => ({ default: enUS }),
          'zh-CN': async () => ({ default: zhCN }),
        },
      },
    },
    readOnly
      ? { customerAccess: { edit: false }, recordActions: ['view'] }
      : {},
  );
  return onHandled;
}
it('offers submission for an editable draft and shows the server threshold', async () => {
  await mount(answerApi(() => ({ data: { ...draft, thresholdPercent: 12 } })));
  expect(
    await screen.findByRole('button', { name: 'Submit quotation' }),
  ).toBeVisible();
  expect(screen.getByText(/over 12%/)).toBeVisible();
});
it('keeps shared quotations read-only even when the status is draft', async () => {
  await mount(
    answerApi(() => ({ data: draft })),
    true,
  );
  await screen.findByText('Quote approval · Draft');
  expect(
    screen.queryByRole('button', { name: 'Submit quotation' }),
  ).not.toBeInTheDocument();
});
it('retries failed reads without sending a write', async () => {
  let failed = true;
  const methods: string[] = [];
  await mount(
    answerApi(({ method }) => {
      methods.push(method);
      return failed
        ? new Response(
            JSON.stringify({
              error: { status: 'INTERNAL', message: 'Temporary read failure' },
            }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          )
        : { data: draft };
    }),
  );
  const retry = await screen.findByRole('button', { name: /retry/i });
  failed = false;
  await userEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByText('Quote approval · Draft')).toBeVisible(),
  );
  expect(methods.every((method) => method === 'GET')).toBe(true);
});
