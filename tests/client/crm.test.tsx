import { PageBreadcrumbProvider } from '@nocobase/app-client';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';
import { answerApi } from '@nocobase/app-testing/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it } from 'vitest';
import {
  renderCrmClient,
  type CrmClientFixture,
} from '../helpers/crm-client.js';
import CustomersPage from '../../client/pages/customers/index.js';
import CustomerTab from '../../client/pages/customers/detail-tab.js';
import CustomerDetail from '../../client/pages/customers/detail.js';
import CrmEditor from '../../client/pages/customers/edit.js';
import SalesEditor from '../../client/pages/sales/edit.js';
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
  fixture: CrmClientFixture = {},
) {
  return renderCrmClient(
    <RouteTreeProvider routes={routes}>
      <PageBreadcrumbProvider>
        <Routes>
          <Route path='/customers' element={<CustomersPage />}>
            <Route path='new' element={<CrmEditor />} />
            <Route path=':customerId/details' element={<CustomerDetail />}>
              {['overview', 'contacts', 'followUps', 'opportunities'].map(
                (tab) => (
                  <Route key={tab} path={tab} element={<CustomerTab />}>
                    <Route path='edit' element={<CrmEditor />} />
                    <Route path='newContact' element={<CrmEditor />} />
                    <Route path='newFollowUp' element={<CrmEditor />} />
                  </Route>
                ),
              )}
              {[
                'newOpportunity',
                'opportunities/newOpportunity',
                'opportunities/:opportunityId/edit',
                'opportunities/:opportunityId/newQuote',
                'opportunities/:opportunityId/quotes/:quoteId/edit',
              ].map((path) => (
                <Route key={path} path={path} element={<SalesEditor />} />
              ))}
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
    fixture,
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
  await screen.findByRole('button', { name: 'Save', exact: true });
  const dialog = screen.getByRole('dialog');
  await userEvent.click(
    await within(dialog).findByRole('button', { name: 'Save', exact: true }),
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
    await within(dialog).findByRole('button', { name: 'Save', exact: true }),
  );
  await screen.findByRole('link', { name: 'New account' });
  expect(saved).toBe(true);
});

it('opens the customer detail with related contacts and follow-ups', async () => {
  await mount(
    answerApi(({ path }) => {
      if (path.startsWith('crmSales/'))
        return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
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
  await userEvent.click(
    await screen.findByRole('tab', { name: 'Contacts', exact: true }),
  );
  expect(await screen.findByText('Emma Wilson')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('tab', { name: 'Follow-up records', exact: true }),
  );
  expect(
    await screen.findByText('Reviewed CRM requirements.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Record follow-up' }),
  ).toHaveAttribute(
    'href',
    `/customers/${customer.id}/details/followUps/newFollowUp`,
  );
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

it('combines customer name and status filters and clears an empty result', async () => {
  const queries: Record<string, unknown>[] = [];
  await mount(
    answerApi(({ query }) => {
      queries.push(query ?? {});
      return query?.q === 'Missing' ? list([]) : list();
    }),
  );
  await screen.findByRole('link', { name: 'Northstar Labs' });
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Search customers by name' }),
    'North',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Search', exact: true }),
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
  await userEvent.click(
    await screen.findByRole('option', { name: 'Prospect', exact: true }),
  );
  await waitFor(() =>
    expect(queries.at(-1)).toMatchObject({
      q: 'North',
      status: 'prospect',
      page: '1',
    }),
  );
  const input = screen.getByRole('textbox', {
    name: 'Search customers by name',
  });
  await userEvent.clear(input);
  await userEvent.type(input, 'Missing');
  await userEvent.click(
    screen.getByRole('button', { name: 'Search', exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: 'Northstar Labs' }),
    ).not.toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
  expect(
    await screen.findByRole('link', { name: 'Northstar Labs' }),
  ).toBeInTheDocument();
  expect(input).toHaveValue('');
  expect(queries.at(-1)).not.toHaveProperty('status');
});

it('opens a contact form by URL and returns to its Contacts tab after saving', async () => {
  let saved = false;
  await mount(
    answerApi(({ path, method }) => {
      if (method === 'POST') {
        saved = true;
        return { data: { id: 'contact-new', name: 'Taylor Reed' } };
      }
      if (path === `crm/customers/${customer.id}`) return { data: customer };
      if (path.endsWith('/contacts'))
        return {
          data: saved
            ? [
                {
                  id: 'contact-new',
                  name: 'Taylor Reed',
                  role: '',
                  email: '',
                  phone: '',
                },
              ]
            : [],
          meta: { total: saved ? 1 : 0 },
        };
      return list();
    }),
    `/customers/${customer.id}/details/contacts/newContact`,
  );
  await screen.findByRole('button', { name: 'Save', exact: true });
  const dialog = screen.getByRole('dialog');
  await userEvent.type(
    await within(dialog).findByRole('textbox', { name: 'Contact name' }),
    'Taylor Reed',
  );
  await userEvent.click(
    await within(dialog).findByRole('button', { name: 'Save', exact: true }),
  );
  expect(await screen.findByText('Taylor Reed')).toBeInTheDocument();
  expect(
    await screen.findByRole('tab', { name: 'Contacts', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

const sharedFixture: CrmClientFixture = {
  customerAccess: {
    edit: false,
    shared: true,
    ownerId: 'another-sales-user',
    ownerName: 'Alex Morgan',
  },
};
const detailApi = () =>
  answerApi(({ path }) => {
    if (path === `crm/customers/${customer.id}`) return { data: customer };
    if (path === 'crm/customers') return list();
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  });
it('shows shared read-only access and owner while hiding customer and related write entries', async () => {
  await mount(
    detailApi(),
    `/customers/${customer.id}/details/overview`,
    'en-US',
    sharedFixture,
  );
  expect(
    await screen.findByText(/Read-only shared access/),
  ).toBeInTheDocument();
  expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit customer' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save owner' }),
  ).not.toBeInTheDocument();
  for (const [tab, action] of [
    ['Contacts', 'Add contact'],
    ['Follow-up records', 'Record follow-up'],
    ['Opportunities', 'New opportunity'],
  ]) {
    await userEvent.click(screen.getByRole('tab', { name: tab, exact: true }));
    await screen.findByRole('heading', { name: tab, exact: true });
    expect(
      screen.queryByRole('button', { name: action, exact: true }),
    ).not.toBeInTheDocument();
  }
});
it.each([
  'edit',
  'newContact',
  'newFollowUp',
  'overview/edit',
  'contacts/newContact',
  'followUps/newFollowUp',
  'newOpportunity',
  'opportunities/newOpportunity',
  'opportunities/opp-1/edit',
  'opportunities/opp-1/newQuote',
  'opportunities/opp-1/quotes/quote-1/edit',
])(
  'blocks direct shared-customer form URL %s without mounting writable fields',
  async (suffix) => {
    await mount(
      detailApi(),
      `/customers/${customer.id}/details/${suffix}`,
      'en-US',
      sharedFixture,
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        'You do not have permission to make this change.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Save', exact: true }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  },
);
it('checks each operation independently rather than assuming editable means every write is granted', async () => {
  await mount(
    detailApi(),
    `/customers/${customer.id}/details/contacts`,
    'en-US',
    {
      recordActions: ['viewCustomer', 'addContact'],
      customerAccess: {
        edit: false,
        actions: { editCustomer: false, addContact: true },
      },
    },
  );
  expect(
    await screen.findByRole('button', { name: 'Add contact' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit customer' }),
  ).not.toBeInTheDocument();
});
it('blocks the new-customer URL when a page-only reader has no create operation', async () => {
  await mount(detailApi(), '/customers/new', 'en-US', {
    recordActions: ['viewCustomer'],
  });
  expect(
    await screen.findByText('You do not have permission to make this change.'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: 'Customer name' }),
  ).not.toBeInTheDocument();
});
