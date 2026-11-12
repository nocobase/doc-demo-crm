import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { createAppTest } from '@nocobase/app-testing/server';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import samples from '../../database/main/seeds/202611120001_sales_samples.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-sales-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
      emailAndPassword: { disableSignUp: false },
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const write = (
  input: unknown,
  method = 'POST',
  key = `${Date.now()}.${randomUUID()}`,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': key,
  },
  body: JSON.stringify(input),
});

test('authenticates and authorizes every sales endpoint before exposing data', async ({
  testApp,
  request,
}) => {
  const member = {
    email: 'sales-member@example.test',
    password: 'member-test-password',
    name: 'Sales member',
  };
  await request('/auth/sign-up/email', write(member));
  const user = await signIn(testApp, member);
  const id = randomUUID();
  for (const base of [
    '/crmSales/products',
    `/crmSales/customers/${id}/opportunities`,
    `/crmSales/customers/${id}/opportunities/${id}/quotes`,
  ]) {
    for (const [path, method] of [
      [base, 'GET'],
      [`${base}/${id}`, 'GET'],
      [base, 'POST'],
      [`${base}/${id}`, 'PATCH'],
    ]) {
      const init = method === 'GET' ? undefined : write({}, method);
      expect((await request(path, init)).status).toBe(401);
      expect((await user.fetch(path, init)).status).toBe(403);
    }
  }
});

test('keeps quote price snapshots, calculates exact rounded totals and preserves existing CRM records', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (path: string, input: unknown) => {
    const response = await admin.fetch(path, write(input));
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const customer = await create('/crm/customers', {
    name: 'Snapshot customer',
    notes: 'Keep existing notes',
  });
  await create(`/crm/customers/${customer.id}/contacts`, { name: 'Emma' });
  await create(`/crm/customers/${customer.id}/followUps`, {
    channel: 'call',
    content: 'Original conversation',
  });
  const base = `/crmSales/customers/${customer.id}/opportunities`;
  const opportunity = await create(base, { name: 'Team rollout' });
  const second = await create(base, { name: 'Another opportunity' });
  const product = await create('/crmSales/products', {
    name: 'Seat',
    code: 'SEAT',
    unitPrice: 19.99,
  });
  const quotePath = `${base}/${opportunity.id}/quotes`;
  const input = {
    name: 'Initial quote',
    lines: [
      { productId: product.id, quantity: 3, discount: 10 },
      { productId: product.id, quantity: 1, unitPrice: 0.05, discount: 50 },
    ],
  };
  const key = `${Date.now()}.${randomUUID()}`;
  const response = await admin.fetch(quotePath, write(input, 'POST', key));
  expect(response.status).toBe(200);
  const quote = (await response.json()).data;
  expect(quote.lines.map((l: { amount: number }) => l.amount)).toEqual([
    53.97, 0.03,
  ]);
  expect(quote.total).toBe(54);
  const replay = await admin.fetch(quotePath, write(input, 'POST', key));
  expect((await replay.json()).data).toEqual(quote);
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  expect(await connection.repository('crmQuotes').count()).toBe(1);
  expect(await connection.repository('crmQuoteLines').count()).toBe(2);
  expect(
    (
      await admin.fetch(
        `/crmSales/products/${product.id}`,
        write({ name: 'Renamed seat', code: 'SEAT', unitPrice: 100 }, 'PATCH'),
      )
    ).status,
  ).toBe(200);
  const saved = (await (await admin.fetch(`${quotePath}/${quote.id}`)).json())
    .data;
  expect(saved.lines[0]).toMatchObject({
    unitPrice: 19.99,
    productName: 'Seat',
    amount: 53.97,
  });
  expect(saved.total).toBe(54);
  const updated = await admin.fetch(
    `${quotePath}/${quote.id}`,
    write(
      {
        name: 'Revised quote',
        lines: [
          {
            productId: product.id,
            quantity: 4,
            unitPrice: 19.99,
            discount: 10,
          },
          { productId: product.id, quantity: 1, unitPrice: 0.05, discount: 50 },
        ],
      },
      'PATCH',
    ),
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).data.total).toBe(71.99);
  expect(
    (
      await admin.fetch(
        `${quotePath}/${quote.id}`,
        write({ ...input }, 'PATCH'),
      )
    ).status,
  ).toBe(400);
  expect(
    (await admin.fetch(`${base}/${second.id}/quotes/${quote.id}`)).status,
  ).toBe(404);
  const another = await create('/crm/customers', { name: 'Another customer' });
  expect(
    (
      await admin.fetch(
        `/crmSales/customers/${another.id}/opportunities/${opportunity.id}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (await (await admin.fetch(`/crm/customers/${customer.id}`)).json()).data
      .notes,
  ).toBe('Keep existing notes');
  expect(await connection.repository('crmContacts').count()).toBe(1);
  expect(await connection.repository('crmFollowUps').count()).toBe(1);
  const related = await connection
    .repository('crmCustomers')
    .findOne({
      filter: { id: customer.id },
      select: (s) =>
        s.fields('id').include('opportunities', (o) => o.fields('id', 'name')),
    });
  expect(related?.opportunities).toHaveLength(2);
});

test('rejects invalid amounts and rolls back complete quote mutations', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (path: string, input: unknown) =>
    (await (await admin.fetch(path, write(input))).json()).data;
  const customer = await create('/crm/customers', {
    name: 'Validation customer',
  });
  const opportunity = await create(
    `/crmSales/customers/${customer.id}/opportunities`,
    { name: 'Validation opportunity' },
  );
  const product = await create('/crmSales/products', {
    name: 'Workshop',
    code: 'WORKSHOP',
    unitPrice: 800,
  });
  expect(
    (
      await admin.fetch(
        '/crmSales/products',
        write({ name: 'Duplicate', code: 'WORKSHOP', unitPrice: 1 }),
      )
    ).status,
  ).toBe(409);
  for (const price of [-1, 1.001, 100001])
    expect(
      (
        await admin.fetch(
          '/crmSales/products',
          write({ name: 'Invalid', code: `BAD-${price}`, unitPrice: price }),
        )
      ).status,
    ).toBe(400);
  const base = `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}/quotes`;
  for (const lines of [
    [],
    [{ productId: product.id, quantity: 0 }],
    [{ productId: product.id, quantity: 1.5 }],
    [{ productId: product.id, quantity: 1, discount: 101 }],
    [{ productId: product.id, quantity: 1, unitPrice: 0.001 }],
  ])
    expect(
      (await admin.fetch(base, write({ name: 'Invalid', lines }))).status,
    ).toBe(400);
  const quote = await create(base, {
    name: 'Keep this quote',
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const before = await connection.repository('mutationReceipts').count();
  const failed = await admin.fetch(
    `${base}/${quote.id}`,
    write(
      {
        name: 'Must roll back',
        lines: [
          { productId: product.id, quantity: 2, unitPrice: 800 },
          { productId: randomUUID(), quantity: 1, unitPrice: 100 },
        ],
      },
      'PATCH',
    ),
  );
  expect(failed.status).toBe(404);
  expect(await connection.repository('mutationReceipts').count()).toBe(before);
  expect(
    (await (await admin.fetch(`${base}/${quote.id}`)).json()).data,
  ).toMatchObject({
    name: 'Keep this quote',
    total: 800,
    lines: [{ quantity: 1 }],
  });
  const noKey = write({
    name: 'No receipt',
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const headers = new Headers(noKey.headers);
  headers.delete('Idempotency-Key');
  expect((await admin.fetch(base, { ...noKey, headers })).status).toBe(400);
});

test('sample seed reruns preserve edited products, quotes and removed lines', async ({
  connection,
}) => {
  const date = '2026-11-12T00:00:00.000Z';
  await connection
    .repository('crmCustomers')
    .createOne({
      values: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Northstar Labs',
        industry: '',
        status: 'prospect',
        website: '',
        notes: '',
        createdAt: date,
        updatedAt: date,
      },
    });
  const run = () =>
    samples.run!({
      repository: connection.repository.bind(connection),
    } as Parameters<NonNullable<typeof samples.run>>[0]);
  const productsBefore = await connection.repository('crmProducts').count();
  await run();
  const quoteId = '00000000-0000-4000-8300-000000000001';
  await connection
    .repository('crmQuotes')
    .updateOne({
      filter: { id: quoteId },
      values: { name: 'Edited sample', totalCents: 0 },
    });
  await connection
    .repository('crmQuoteLines')
    .deleteMany({ filter: { quoteId } });
  await run();
  expect(await connection.repository('crmProducts').count()).toBe(
    productsBefore + 3,
  );
  expect(
    await connection
      .repository('crmQuotes')
      .findOne({ filter: { id: quoteId } }),
  ).toMatchObject({ name: 'Edited sample', totalCents: '0' });
  expect(
    await connection.repository('crmQuoteLines').count({ filter: { quoteId } }),
  ).toBe(0);
});
