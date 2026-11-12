import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { createAppTest } from '@nocobase/app-testing/server';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
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

test('runs the lesson price prediction exercise without changing historical quote prices', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const save = async (path: string, input: unknown, method = 'POST') => {
    const response = await admin.fetch(path, write(input, method));
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const customer = await save('/crm/customers', { name: 'Northstar Labs' });
  const base = `/crmSales/customers/${customer.id}/opportunities`;
  const opportunity = await save(base, { name: 'Northstar sales workspace' });
  const license = await save('/crmSales/products', {
    name: 'Team workspace license',
    code: 'TEAM-LICENSE',
    unitPrice: 100,
  });
  const workshop = await save('/crmSales/products', {
    name: 'Onboarding workshop',
    code: 'ONBOARDING',
    unitPrice: 250,
  });
  const quotes = `${base}/${opportunity.id}/quotes`;
  const lines = [
    { productId: license.id, quantity: 10, discount: 10 },
    { productId: workshop.id, quantity: 1, discount: 0 },
  ];
  const original = await save(quotes, {
    name: 'Annual rollout proposal',
    lines,
  });
  expect(original.total).toBe(1150);
  await save(
    `/crmSales/products/${license.id}`,
    { name: license.name, code: license.code, unitPrice: 120 },
    'PATCH',
  );
  const read = async () =>
    (await (await admin.fetch(`${quotes}/${original.id}`)).json()).data;
  expect((await read()).lines[0].unitPrice).toBe(100);
  expect((await read()).total).toBe(1150);
  const fresh = await save(quotes, { name: 'Repriced rollout check', lines });
  expect(fresh.lines[0].unitPrice).toBe(120);
  expect(fresh.total).toBe(1330);
  const savedLines = lines.map((line, index) => ({
    ...line,
    unitPrice: index === 0 ? 100 : 250,
  }));
  const edit = (quantity: number) => ({
    name: original.name,
    lines: savedLines.map((line, index) => ({
      ...line,
      quantity: index === 0 ? quantity : line.quantity,
    })),
  });
  expect(
    (await save(`${quotes}/${original.id}`, edit(12), 'PATCH')).total,
  ).toBe(1330);
  expect(
    (await save(`${quotes}/${original.id}`, edit(10), 'PATCH')).total,
  ).toBe(1150);
  expect(
    (await admin.fetch(`${quotes}/${original.id}`, write(edit(0), 'PATCH')))
      .status,
  ).toBe(400);
  expect((await read()).total).toBe(1150);
});
