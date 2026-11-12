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
import Products from '../../client/pages/sales/products.js';
import SalesEditor from '../../client/pages/sales/edit.js';
import { RouteTreeProvider } from '../../client/routing/route-context.js';
import applicationRoutes from '../../client/routes.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
const namespace = 'sales-test';
const routes = resolveAppClientContributions([
  { packageName: namespace, source: 'application', routes: applicationRoutes },
]).routes;
const product = {
  id: '00000000-0000-4000-8100-000000000001',
  name: 'Team license',
  code: 'TEAM',
  unitPrice: 120,
};
const list = (data = [product]) => ({
  data,
  meta: { total: data.length, page: 1, pageSize: 20 },
});
function mount(
  fetch: typeof globalThis.fetch,
  route = '/products',
  fixture: CrmClientFixture = {},
) {
  return renderCrmClient(
    <RouteTreeProvider routes={routes}>
      <PageBreadcrumbProvider>
        <Routes>
          <Route path='/products' element={<Products />}>
            <Route path='new' element={<SalesEditor />} />
            <Route path=':productId/edit' element={<SalesEditor />} />
          </Route>
        </Routes>
      </PageBreadcrumbProvider>
    </RouteTreeProvider>,
    {
      fetch,
      route,
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
it('searches products while retaining focus and entered search text', async () => {
  await mount(
    answerApi(({ query }) => (query?.q === 'Missing' ? list([]) : list())),
  );
  await screen.findByText('Team license');
  const input = screen.getByRole('textbox', {
    name: 'Search products by name',
  });
  await userEvent.type(input, 'Missing');
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Missing');
  await userEvent.click(
    screen.getByRole('button', { name: 'Search', exact: true }),
  );
  await waitFor(() =>
    expect(screen.queryByText('Team license')).not.toBeInTheDocument(),
  );
});
it('saves a new product and returns to the refreshed catalogue', async () => {
  let saved = false;
  await mount(
    answerApi(({ method, json }) => {
      if (method === 'POST') {
        expect(json).toMatchObject({
          name: 'New license',
          code: 'NEW',
          unitPrice: 35.5,
        });
        saved = true;
        return { data: { ...product, name: 'New license' } };
      }
      return saved ? list([{ ...product, name: 'New license' }]) : list([]);
    }),
    '/products/new',
  );
  await screen.findByRole('textbox', { name: 'Name', exact: true });
  const dialog = screen.getByRole('dialog');
  await userEvent.type(
    await within(dialog).findByRole('textbox', { name: 'Name', exact: true }),
    'New license',
  );
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Product code' }),
    'NEW',
  );
  const price = within(dialog).getByRole('spinbutton', {
    name: 'Unit price (USD)',
  });
  await userEvent.clear(price);
  await userEvent.type(price, '35.5');
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Save', exact: true }),
  );
  await screen.findByText('New license');
  expect(saved).toBe(true);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});
it('retains a rejected product draft for correction', async () => {
  let attempted = false;
  await mount(
    answerApi(({ method }) => {
      if (method === 'POST') {
        attempted = true;
        return new Response(
          JSON.stringify({
            error: {
              status: 'ALREADY_EXISTS',
              reason: 'PRODUCT_CODE_EXISTS',
              message: 'Duplicate code',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      return list([]);
    }),
    '/products/new',
  );
  const name = await screen.findByRole('textbox', {
    name: 'Name',
    exact: true,
  });
  await userEvent.type(name, 'Retained license');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Product code' }),
    'TEAM',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Save', exact: true }),
  );
  await waitFor(() => expect(attempted).toBe(true));
  expect(name).toHaveValue('Retained license');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('keeps the product catalogue readable without showing write actions to sales', async () => {
  await mount(
    answerApi(() => list()),
    '/products',
    { productActions: ['view'] },
  );
  expect(await screen.findByText('Team license')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'New product' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit product' }),
  ).not.toBeInTheDocument();
});
it.each(['/products/new', `/products/${product.id}/edit`])(
  'guards direct product write URL %s for a reader',
  async (route) => {
    const paths: string[] = [];
    await mount(
      answerApi(({ path }) => {
        paths.push(path);
        return list();
      }),
      route,
      { productActions: ['view'] },
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        'You do not have permission to make this change.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(paths).not.toContain(`crmSales/products/${product.id}`);
  },
);
it('offers create without also granting catalogue edits', async () => {
  await mount(
    answerApi(() => list()),
    '/products',
    { productActions: ['view', 'create'] },
  );
  expect(
    await screen.findByRole('button', { name: 'New product' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit product' }),
  ).not.toBeInTheDocument();
});
