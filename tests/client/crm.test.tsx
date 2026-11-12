import { PageBreadcrumbProvider } from '@nocobase/app-client';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';
import { answerApi } from '@nocobase/app-testing/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it } from 'vitest';
import { renderSettingsClient } from '../helpers/settings-client.js';
import CustomersPage from '../../client/pages/customers/index.js';
import CustomerDetail from '../../client/pages/customers/detail.js';
import CrmEditor from '../../client/pages/customers/edit.js';
import { RouteTreeProvider } from '../../client/routing/route-context.js';
import applicationRoutes from '../../client/routes.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';

const customer = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Northstar Labs',
  industry: 'Technology',
  status: 'prospect',
  website: '',
  notes: '',
  createdAt: '2026-11-10T02:00:00Z',
  updatedAt: '2026-11-10T02:00:00Z',
};
const namespace = 'crm-test';
const routes = resolveAppClientContributions([
  { packageName: namespace, source: 'application', routes: applicationRoutes },
]).routes;
function mount(
  fetch: typeof globalThis.fetch,
  route = '/customers',
  locale = 'en-US',
) {
  return renderSettingsClient(
    <RouteTreeProvider routes={routes}>
      <PageBreadcrumbProvider>
        <Routes>
          <Route path='/customers' element={<CustomersPage />}>
            <Route path='new' element={<CrmEditor />} />
            <Route path=':customerId/details' element={<CustomerDetail />}>
              <Route path='edit' element={<CrmEditor />} />
              <Route path='newContact' element={<CrmEditor />} />
              <Route path='newFollowUp' element={<CrmEditor />} />
            </Route>
          </Route>
        </Routes>
      </PageBreadcrumbProvider>
    </RouteTreeProvider>,
    {
      fetch,
      route,
      locale,
      namespace,
      namespaces: {
        [namespace]: {
          'en-US': async () => ({ default: enUS }),
          'zh-CN': async () => ({ default: zhCN }),
        },
      },
    },
  );
}
const list = (data = [customer]) => ({
  data,
  meta: { total: data.length, page: 1, pageSize: 20 },
});

it('searches without remounting the input and shows no results', async () => {
  const paths: string[] = [];
  await mount(
    answerApi(({ path, query }) => {
      paths.push(path + '?q=' + (query?.q ?? ''));
      return query?.q === 'Missing' ? list([]) : list();
    }),
  );
  await screen.findByRole('link', { name: 'Northstar Labs' });
  const input = screen.getByRole('textbox', {
    name: 'Search customers by name',
  });
  await userEvent.type(input, 'Missing');
  expect(input).toHaveValue('Missing');
  await userEvent.click(
    screen.getByRole('button', { name: 'Search', exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: 'Northstar Labs' }),
    ).not.toBeInTheDocument(),
  );
  expect(paths.some((path) => path.includes('q=Missing'))).toBe(true);
});

it('validates the customer form and submits a protected write', async () => {
  let saved = false;
  await mount(
    answerApi(({ path, method, json }) => {
      if (method === 'POST') {
        expect(path).toBe('crm/customers');
        expect(json).toMatchObject({ name: 'New account', status: 'prospect' });
        saved = true;
        return { data: { ...customer, name: 'New account' } };
      }
      return saved ? list([{ ...customer, name: 'New account' }]) : list([]);
    }),
    '/customers/new',
  );
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save', exact: true }),
  );
  expect(
    await screen.findByText('This field is required.'),
  ).toBeInTheDocument();
  expect(saved).toBe(false);
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Customer name' }),
    'New account',
  );
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save', exact: true }),
  );
  await screen.findByRole('link', { name: 'New account' });
  expect(saved).toBe(true);
});

it('opens the customer detail with related contacts and follow-ups', async () => {
  await mount(
    answerApi(({ path }) => {
      if (path.includes('/contacts'))
        return {
          data: [
            {
              id: 'c1',
              name: 'Emma Wilson',
              role: 'Operations Lead',
              email: 'emma@example.com',
              phone: '',
            },
          ],
          meta: { total: 1 },
        };
      if (path.includes('/followUps'))
        return {
          data: [
            {
              id: 'f1',
              channel: 'meeting',
              content: 'Reviewed CRM requirements.',
              nextStep: 'Prepare a demo.',
              authorName: 'Tutorial team',
              createdAt: '2026-11-10T02:00:00Z',
            },
          ],
          meta: { total: 1 },
        };
      if (path === `crm/customers/${customer.id}`) return { data: customer };
      return list();
    }),
    `/customers/${customer.id}/details`,
  );
  await screen.findByRole('heading', { name: 'Northstar Labs' });
  expect(await screen.findByText('Emma Wilson')).toBeInTheDocument();
  expect(
    await screen.findByText('Reviewed CRM requirements.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Record follow-up' }),
  ).toHaveAttribute('href', `/customers/${customer.id}/details/newFollowUp`);
});

it('keeps a failed form and its values available for retry', async () => {
  await mount(
    answerApi(({ method }) =>
      method === 'POST'
        ? new Response(
            JSON.stringify({
              error: {
                status: 'INVALID_ARGUMENT',
                reason: 'VALIDATION_FAILED',
                message: 'Rejected',
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          )
        : list([]),
    ),
    '/customers/new',
  );
  const input = await screen.findByRole('textbox', { name: 'Customer name' });
  await userEvent.type(input, 'Retained draft');
  await userEvent.click(
    screen.getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save', exact: true }),
    ).toBeEnabled(),
  );
  expect(input).toHaveValue('Retained draft');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('uses Chinese copy for the same customer entry point', async () => {
  await mount(
    answerApi(() => list([])),
    '/customers',
    'zh-CN',
  );
  expect(
    await screen.findByRole('heading', { name: '客户', exact: true }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: '新建客户' }),
  ).toBeInTheDocument();
});
