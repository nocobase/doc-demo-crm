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
      secret: 'workspace-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
      emailAndPassword: { disableSignUp: false },
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const write = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'idempotency-key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

test('denies anonymous and unassigned users access to summaries and record names', async ({
  testApp,
  request,
}) => {
  expect((await request('/crm/workspace')).status).toBe(401);
  const user = {
    email: 'workspace@example.test',
    name: 'No CRM role',
    password: 'workspace-password',
  };
  expect((await request('/auth/sign-up/email', write(user))).status).toBe(200);
  expect(
    (await (await signIn(testApp, user)).fetch('/crm/workspace')).status,
  ).toBe(403);
});

test('returns accurate counts, bounded recent records and their real relationships without changing data', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const create = async (path: string, input: unknown) => {
    const response = await admin.fetch(path, write(input));
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };
  const initial = await admin.fetch('/crm/workspace');
  expect(initial.status).toBe(200);
  expect((await initial.json()).data).toEqual({
    counts: { customers: 0, opportunities: 0, quotes: 0 },
    followUps: [],
    opportunities: [],
    quotes: [],
  });
  const customer = await create('/crm/customers', {
    name: 'Workspace account',
  });
  const product = await create('/crmSales/products', {
    name: 'Team workspace',
    code: 'WORKSPACE',
    unitPrice: 100,
  });
  const opportunityIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const opportunity = await create(
      `/crmSales/customers/${customer.id}/opportunities`,
      { name: `Opportunity ${i}` },
    );
    opportunityIds.push(opportunity.id);
    await create(
      `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}/quotes`,
      {
        name: `Quote ${i}`,
        lines: [{ productId: product.id, quantity: 10, discount: 10 }],
      },
    );
    await create(`/crm/customers/${customer.id}/followUps`, {
      channel: 'call',
      content: `Follow-up ${i}`,
    });
  }
  const response = await admin.fetch('/crm/workspace');
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.counts).toEqual({ customers: 1, opportunities: 6, quotes: 6 });
  expect(data.followUps).toHaveLength(5);
  expect(data.opportunities).toHaveLength(5);
  expect(data.quotes).toHaveLength(5);
  expect(data.followUps[0]).toMatchObject({
    content: 'Follow-up 5',
    customer: { id: customer.id, name: 'Workspace account' },
  });
  for (const item of data.opportunities)
    expect(item.customer).toEqual({
      id: customer.id,
      name: 'Workspace account',
    });
  for (const item of data.quotes) {
    expect(item.total).toBe(900);
    expect(opportunityIds).toContain(item.opportunity.id);
    expect(item.opportunity.customer).toEqual({
      id: customer.id,
      name: 'Workspace account',
    });
    expect(item).not.toHaveProperty('totalCents');
  }
  expect(await connection.repository('crmFollowUps').count()).toBe(6);
  expect(await connection.repository('crmQuoteLines').count()).toBe(6);
});
