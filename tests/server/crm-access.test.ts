import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createAppTest } from '@nocobase/app-testing/server';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  crmCustomers,
  crmFollowUps,
  crmOpportunities,
  crmQuotes,
} from '../../server/providers/crm-permissions.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-access-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const key = () => `${Date.now()}.${randomUUID()}`;
const write = (
  body: unknown,
  method = 'POST',
  operation = key(),
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'idempotency-key': operation,
  },
  body: JSON.stringify(body),
});
async function data(response: Response) {
  const body = await response.json();
  expect(response.status).toBe(200);
  return body.data;
}

test('enforces own, shared, reassigned and unassigned customer boundaries across descendants and workspace', async ({
  testApp,
  connection,
  request,
}) => {
  const authz = testApp.application.container.resolve(authorizationToken);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const createUser = async (name: string, role: string) => {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      name,
      password: 'permission-test-password',
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  };
  const { user: alice, session: a } = await createUser(
    'Alex Sales',
    'crm-sales',
  );
  const { user: bob, session: b } = await createUser(
    'Taylor Sales',
    'crm-sales',
  );
  const { user: manager, session: m } = await createUser(
    'Morgan Manager',
    'crm-sales-manager',
  );
  const { user: visitor, session: v } = await createUser('Visitor', 'member');
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  expect((await request('/crm/access')).status).toBe(401);
  expect((await v.fetch('/crm/customers')).status).toBe(403);
  const customer = await data(
    await a.fetch('/crm/customers', write({ name: 'Alex-owned' })),
  );
  expect(customer.ownerId).toBe(alice.id);
  const other = await data(
    await b.fetch('/crm/customers', write({ name: 'Taylor-owned' })),
  );
  const product = await data(
    await m.fetch(
      '/crmSales/products',
      write({ name: 'Consulting', code: randomUUID(), unitPrice: 100 }),
    ),
  );
  expect(
    (
      await a.fetch(
        '/crmSales/products',
        write({ name: 'Forbidden', code: randomUUID(), unitPrice: 1 }),
      )
    ).status,
  ).toBe(403);
  const customerPath = `/crm/customers/${customer.id}`;
  const salesPath = `/crmSales/customers/${customer.id}/opportunities`;
  const contact = await data(
    await a.fetch(
      `${customerPath}/contacts`,
      write({ name: 'Customer contact' }),
    ),
  );
  const follow = await data(
    await a.fetch(
      `${customerPath}/followUps`,
      write({ channel: 'call', content: 'Private follow-up' }),
    ),
  );
  const opportunity = await data(
    await a.fetch(salesPath, write({ name: 'Owned opportunity' })),
  );
  const quotesPath = `${salesPath}/${opportunity.id}/quotes`;
  const quoteInput = {
    name: 'Owned quote',
    lines: [{ productId: product.id, quantity: 2, discount: 10 }],
  };
  const quoteKey = key();
  const quote = await data(
    await a.fetch(quotesPath, write(quoteInput, 'POST', quoteKey)),
  );
  expect(quote.total).toBe(180);
  for (const path of [
    customerPath,
    `${customerPath}/contacts`,
    `${customerPath}/followUps`,
    salesPath,
    `${quotesPath}/${quote.id}`,
  ])
    expect((await b.fetch(path)).status).toBe(404);
  const before = await data(await b.fetch('/crm/workspace'));
  expect(before.counts.customers).toBe(1);
  expect(before.counts.quotes).toBe(0);
  const shareBody = { userIds: [bob.id] };
  expect(
    (await a.fetch(`${customerPath}/shares`, write(shareBody, 'PUT'))).status,
  ).toBe(403);
  expect(
    (
      await m.fetch(
        '/authorization/sharingRules',
        write({
          key: 'forged-edit-sharing',
          resource: { type: 'composite', id: 'crm.customers' },
          actions: [
            {
              action: 'edit',
              scopeKey: 'customers',
              selection: { type: 'records', ids: [customer.id] },
            },
          ],
          subjects: [{ type: 'user', id: bob.id }],
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await m.fetch(
        `${customerPath}/shares`,
        write({ userIds: [visitor.id] }, 'PUT'),
      )
    ).status,
  ).toBe(400);
  await data(await m.fetch(`${customerPath}/shares`, write(shareBody, 'PUT')));
  const access = await data(await b.fetch(`${customerPath}/access`));
  expect(access.shared).toBe(true);
  expect(access.edit).toBe(false);
  expect(access.canAssign).toBe(false);
  expect(access.ownerId).toBe(alice.id);
  expect(access.users).toEqual([]);
  expect((await data(await b.fetch(`${customerPath}/contacts`)))[0].id).toBe(
    contact.id,
  );
  expect((await data(await b.fetch(`${customerPath}/followUps`)))[0].id).toBe(
    follow.id,
  );
  expect(
    (await data(await b.fetch(`${quotesPath}/${quote.id}`))).lines,
  ).toHaveLength(1);
  for (const [path, input, method] of [
    [customerPath, { name: 'Stolen' }, 'PATCH'],
    [`${customerPath}/contacts`, { name: 'Denied' }, 'POST'],
    [`${customerPath}/contacts/${contact.id}`, { name: 'Denied' }, 'PATCH'],
    [
      `${customerPath}/followUps`,
      { channel: 'call', content: 'Denied' },
      'POST',
    ],
    [salesPath, { name: 'Denied' }, 'POST'],
    [`${salesPath}/${opportunity.id}`, { name: 'Denied' }, 'PATCH'],
    [quotesPath, quoteInput, 'POST'],
    [
      `${quotesPath}/${quote.id}`,
      {
        ...quoteInput,
        lines: [{ productId: product.id, unitPrice: 100, quantity: 1 }],
      },
      'PATCH',
    ],
  ] as const)
    expect((await b.fetch(path, write(input, method))).status).toBe(404);
  // The rule selects the customer dynamically, including children created later.
  const later = await data(
    await a.fetch(
      `${customerPath}/followUps`,
      write({ channel: 'note', content: 'Created after sharing' }),
    ),
  );
  expect(
    (await data(await b.fetch(`${customerPath}/followUps`))).some(
      (record: { id: string }) => record.id === later.id,
    ),
  ).toBe(true);
  const sharedWorkspace = await data(await b.fetch('/crm/workspace'));
  expect(sharedWorkspace.counts.customers).toBe(2);
  expect(sharedWorkspace.counts.quotes).toBe(1);
  expect(
    sharedWorkspace.followUps.some(
      (record: { customerId: string }) => record.customerId === customer.id,
    ),
  ).toBe(true);
  await data(
    await m.fetch(`${customerPath}/shares`, write({ userIds: [] }, 'PUT')),
  );
  expect((await b.fetch(`${quotesPath}/${quote.id}`)).status).toBe(404);
  expect((await data(await b.fetch('/crm/workspace'))).counts.customers).toBe(
    1,
  );
  const updateKey = key();
  await data(
    await a.fetch(
      customerPath,
      write({ name: 'Updated owned' }, 'PATCH', updateKey),
    ),
  );
  await data(
    await m.fetch(`${customerPath}/owner`, write({ ownerId: bob.id }, 'PUT')),
  );
  expect(
    (
      await a.fetch(
        customerPath,
        write({ name: 'Updated owned' }, 'PATCH', updateKey),
      )
    ).status,
  ).toBe(404);
  expect(
    (await a.fetch(quotesPath, write(quoteInput, 'POST', quoteKey))).status,
  ).toBe(404);
  expect((await data(await b.fetch(`${quotesPath}/${quote.id}`))).total).toBe(
    180,
  );
  await data(
    await m.fetch(`${customerPath}/owner`, write({ ownerId: null }, 'PUT')),
  );
  expect((await b.fetch(customerPath)).status).toBe(404);
  expect((await data(await m.fetch(customerPath))).ownerId).toBe(null);
  expect((await data(await admin.fetch(customerPath))).name).toBe(
    'Updated owned',
  );
  expect(
    (
      await m.fetch(
        `${customerPath}/owner`,
        write({ ownerId: visitor.id }, 'PUT'),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await a.fetch(
        '/crm/customers',
        write({ name: 'Cannot choose owner', ownerId: manager.id }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await data(await b.fetch(`/crm/customers/${other.id}`))).ownerId,
  ).toBe(bob.id);
  const assignments = await authz.permissionSets.listAssignments();
  expect(assignments.some((entry) => entry.subject.id === '*')).toBe(false);
  expect(await connection.repository('crmCustomers').count()).toBe(2);
});

test('separates page grants from actions and rejects replay after action revocation', async ({
  testApp,
}) => {
  const authz = testApp.application.container.resolve(authorizationToken);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const credentials = {
    email: `${randomUUID()}@example.test`,
    name: 'Page-only user',
    password: 'page-only-password',
  };
  const user = await users.create({
    ...credentials,
    roleScopes: { app: ['member'] },
  });
  const session = await signIn(testApp, credentials);
  const role = `page-only-${randomUUID()}`;
  await authz.permissionSets.create({
    key: role,
    grants: [
      {
        resource: { type: 'page', id: 'crm.customers' },
        actions: [{ action: 'access' }],
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role,
    subject: { type: 'user', id: user.id },
  });
  expect((await session.fetch('/crm/customers')).status).toBe(403);
  await authz.permissionSets.update(role, {
    key: role,
    grants: [
      crmCustomers.reference().grant({
        create: { customers: 'crm.owned' },
        view: { customers: 'crm.owned' },
      }),
    ],
  });
  expect((await session.fetch('/crm/workspace')).status).toBe(200);
  const mutation = key();
  const customer = await data(
    await session.fetch(
      '/crm/customers',
      write({ name: 'Action only' }, 'POST', mutation),
    ),
  );
  expect(customer.ownerId).toBe(user.id);
  expect(
    (await session.fetch('/crm/customers/' + customer.id + '/contacts')).status,
  ).toBe(403);
  expect(
    (
      await session.fetch(
        '/crmSales/customers/' + customer.id + '/opportunities',
      )
    ).status,
  ).toBe(403);
  expect((await session.fetch('/crmImports/batches')).status).toBe(403);
  const summary = await data(await session.fetch('/crm/workspace'));
  expect(summary.counts).toEqual({ customers: 1, opportunities: 0, quotes: 0 });
  expect(summary.followUps).toEqual([]);
  const context = authz.for({ principal: { type: 'user', id: user.id } });
  expect(
    await context.can({
      resource: { type: 'page', id: 'crm.customers' },
      action: 'access',
    }),
  ).toBe(false);
  await authz.permissionSets.update(role, {
    key: role,
    grants: [
      {
        resource: { type: 'settings', id: 'crm.documents' },
        actions: [{ action: 'read' }],
      },
    ],
  });
  expect((await session.fetch('/crmDocuments/settings')).status).toBe(200);
  expect(
    (
      await session.fetch(
        '/crmDocuments/orphans/' + randomUUID(),
        write({}, 'DELETE'),
      )
    ).status,
  ).toBe(403);
  expect((await session.fetch('/crmNotifications/events')).status).toBe(403);
  expect((await session.fetch('/crmWorkflows/definition')).status).toBe(403);
  expect(
    (
      await session.fetch(
        '/crm/customers',
        write({ name: 'Action only' }, 'POST', mutation),
      )
    ).status,
  ).toBe(403);
});

test('omits workspace counts and previews whose parents are outside independently narrowed scopes', async ({
  testApp,
}) => {
  const authz = testApp.application.container.resolve(authorizationToken);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const customer = await data(
    await admin.fetch('/crm/customers', write({ name: 'Hidden parent' })),
  );
  await data(
    await admin.fetch(
      `/crm/customers/${customer.id}/followUps`,
      write({ channel: 'call', content: 'Hidden preview' }),
    ),
  );
  await data(
    await admin.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Hidden opportunity' }),
    ),
  );
  const credentials = {
    email: `${randomUUID()}@example.test`,
    name: 'Custom scopes',
    password: 'custom-scopes-password',
  };
  const user = await users.create({
    ...credentials,
    roleScopes: { app: ['member'] },
  });
  const role = `custom-${randomUUID()}`;
  await authz.permissionSets.create({
    key: role,
    grants: [
      crmCustomers.reference().grant({ view: { customers: 'crm.owned' } }),
      crmFollowUps.reference().grant({ view: { followUps: 'allRecords' } }),
      crmOpportunities
        .reference()
        .grant({ view: { opportunities: 'allRecords' } }),
      crmQuotes
        .reference()
        .grant({ view: { quotes: 'allRecords', lines: 'allRecords' } }),
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: role,
    subject: { type: 'user', id: user.id },
  });
  const session = await signIn(testApp, credentials);
  const workspace = await data(await session.fetch('/crm/workspace'));
  expect(workspace.counts).toEqual({
    customers: 0,
    opportunities: 0,
    quotes: 0,
  });
  expect(workspace.followUps).toEqual([]);
  expect(workspace.opportunities).toEqual([]);
  expect(workspace.quotes).toEqual([]);
});
