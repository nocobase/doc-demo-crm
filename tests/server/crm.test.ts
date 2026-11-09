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
      secret: 'crm-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
      emailAndPassword: { disableSignUp: false },
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const key = () => `${Date.now()}.${randomUUID()}`;
const write = (
  input: unknown,
  method = 'POST',
  operation = key(),
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': operation,
  },
  body: JSON.stringify(input),
});

test('requires authentication and explicit CRM access for every record route', async ({
  testApp,
  request,
}) => {
  const member = {
    email: 'crm-member@example.test',
    password: 'member-test-password',
    name: 'Ordinary member',
  };
  expect((await request('/auth/sign-up/email', write(member))).status).toBe(
    200,
  );
  const user = await signIn(testApp, member);
  const id = randomUUID();
  for (const [path, method, body] of [
    ['/crm/customers', 'GET', undefined],
    ['/crm/customers', 'POST', { name: 'Denied' }],
    [`/crm/customers/${id}`, 'GET', undefined],
    [`/crm/customers/${id}`, 'PATCH', { name: 'Denied' }],
    [`/crm/customers/${id}/contacts`, 'GET', undefined],
    [`/crm/customers/${id}/contacts`, 'POST', { name: 'Denied' }],
    [
      `/crm/customers/${id}/contacts/${randomUUID()}`,
      'PATCH',
      { name: 'Denied' },
    ],
    [`/crm/customers/${id}/followUps`, 'GET', undefined],
    [
      `/crm/customers/${id}/followUps`,
      'POST',
      { channel: 'call', content: 'Denied' },
    ],
  ] as const) {
    const init = method === 'GET' ? undefined : write(body, method);
    expect((await request(path, init)).status).toBe(401);
    expect((await user.fetch(path, init)).status).toBe(403);
  }
});

test('creates, reads, edits and searches customers with durable receipt replay', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const operation = key();
  const input = {
    name: '  Tutorial Northstar  ',
    industry: 'Technology',
    status: 'prospect',
  };
  const created = await admin.fetch(
    '/crm/customers',
    write(input, 'POST', operation),
  );
  expect(created.status).toBe(200);
  const body = await created.json();
  expect(body.data.name).toBe('Tutorial Northstar');
  const replay = await admin.fetch(
    '/crm/customers',
    write(input, 'POST', operation),
  );
  expect(await replay.json()).toEqual(body);
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  expect(
    (
      await admin.fetch(
        '/crm/customers',
        write({ name: 'Changed' }, 'POST', operation),
      )
    ).status,
  ).toBe(409);
  const path = `/crm/customers/${body.data.id}`;
  expect(
    (
      await admin.fetch(
        path,
        write(
          {
            name: 'Tutorial Northstar',
            status: 'customer',
            notes: 'Confirmed next steps',
          },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(200);
  expect(await (await admin.fetch(path)).json()).toMatchObject({
    data: { status: 'customer', notes: 'Confirmed next steps' },
  });
  expect(
    await (
      await admin.fetch('/crm/customers?q=northstar&status=customer&pageSize=1')
    ).json(),
  ).toMatchObject({
    data: [{ id: body.data.id }],
    meta: { total: 1, pageSize: 1 },
  });
  expect(
    await (
      await admin.fetch('/crm/customers?q=northstar&status=inactive')
    ).json(),
  ).toMatchObject({ data: [], meta: { total: 0 } });
  expect(
    await connection
      .repository('crmCustomers')
      .count({ filter: { id: body.data.id } }),
  ).toBe(1);
});

test('binds contacts and append-only follow-ups to the correct customer', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const first = (
    await (
      await admin.fetch('/crm/customers', write({ name: 'First account' }))
    ).json()
  ).data.id;
  const second = (
    await (
      await admin.fetch('/crm/customers', write({ name: 'Second account' }))
    ).json()
  ).data.id;
  const path = `/crm/customers/${first}`;
  const contactResponse = await admin.fetch(
    `${path}/contacts`,
    write({ name: 'Emma Wilson', email: 'emma@example.com' }),
  );
  expect(contactResponse.status).toBe(200);
  const contact = (await contactResponse.json()).data;
  expect(
    (
      await admin.fetch(
        `/crm/customers/${second}/contacts/${contact.id}`,
        write({ name: 'Wrong customer' }, 'PATCH'),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await admin.fetch(
        `${path}/contacts/${contact.id}`,
        write({ name: 'Emma Wilson', role: 'Sales Director' }, 'PATCH'),
      )
    ).status,
  ).toBe(200);
  const operation = key();
  const follow = {
    channel: 'meeting',
    content: 'Reviewed customer requirements.',
    nextStep: 'Schedule a demonstration.',
  };
  const response = await admin.fetch(
    `${path}/followUps`,
    write(follow, 'POST', operation),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    customerId: first,
    authorName: admin.user.name,
    content: follow.content,
  });
  expect(
    (await admin.fetch(`${path}/followUps`, write(follow, 'POST', operation)))
      .status,
  ).toBe(200);
  expect(
    await connection
      .repository('crmFollowUps')
      .count({ filter: { customerId: first } }),
  ).toBe(1);
  expect(await (await admin.fetch(`${path}/contacts`)).json()).toMatchObject({
    data: [{ name: 'Emma Wilson', role: 'Sales Director' }],
  });
  expect(
    await (await admin.fetch(`/crm/customers/${second}/followUps`)).json(),
  ).toMatchObject({ data: [], meta: { total: 0 } });
  expect(
    (
      await admin.fetch(
        `/crm/customers/${randomUUID()}/contacts`,
        write({ name: 'Orphan' }),
      )
    ).status,
  ).toBe(404);
  await expect(
    connection.repository('crmContacts').createOne({
      values: {
        id: randomUUID(),
        customerId: randomUUID(),
        name: 'Orphan',
        role: '',
        email: '',
        phone: '',
        createdAt: new Date().toISOString(),
      },
    }),
  ).rejects.toThrow();
});

test('rejects invalid input, spoofed follow-up authors and malformed paging', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  for (const input of [
    { name: ' ' },
    { name: 'x'.repeat(121) },
    { name: 'Invalid', status: 'won' },
    { name: 'Invalid', website: 'javascript:alert(1)' },
    { name: 'Invalid', unknown: 'field' },
  ]) {
    expect((await admin.fetch('/crm/customers', write(input))).status).toBe(
      400,
    );
  }
  for (const query of ['page=0', 'pageSize=101', 'status=invalid'])
    expect((await admin.fetch(`/crm/customers?${query}`)).status).toBe(400);
  const id = (
    await (
      await admin.fetch('/crm/customers', write({ name: 'Validation account' }))
    ).json()
  ).data.id;
  expect(
    (
      await admin.fetch(
        `/crm/customers/${id}/contacts`,
        write({ name: 'Emma', email: 'invalid' }),
      )
    ).status,
  ).toBe(400);
  for (const input of [
    { channel: 'call', content: ' ' },
    { channel: 'fax', content: 'Hello' },
    { channel: 'call', content: 'Hello', authorName: 'Someone else' },
  ])
    expect(
      (await admin.fetch(`/crm/customers/${id}/followUps`, write(input)))
        .status,
    ).toBe(400);
  expect((await admin.fetch('/crm/customers/not-a-uuid')).status).toBe(400);
});

test('paginates the complete dataset and keeps literal search characters safe', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  for (let index = 0; index < 23; index++) {
    const response = await admin.fetch(
      '/crm/customers',
      write({ name: `Paging account ${String(index).padStart(2, '0')}` }),
    );
    expect(response.status).toBe(200);
  }
  const first = await (
    await admin.fetch('/crm/customers?q=Paging%20account&page=1&pageSize=20')
  ).json();
  const second = await (
    await admin.fetch('/crm/customers?q=Paging%20account&page=2&pageSize=20')
  ).json();
  expect(first.meta.total).toBe(23);
  expect(first.data).toHaveLength(20);
  expect(second.data).toHaveLength(3);
  expect(
    new Set(
      [...first.data, ...second.data].map((item: { id: string }) => item.id),
    ).size,
  ).toBe(23);
  expect(first.data[0].name).toBe('Paging account 00');
  expect(second.data[2].name).toBe('Paging account 22');
  expect((await admin.fetch('/crm/customers?q=%27%20OR%201%3D1')).status).toBe(
    200,
  );
});

test('rolls back failed mutations and requires operation keys', async ({
  testApp,
  connection,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const id = randomUUID();
  const operation = key();
  const followUp = {
    channel: 'call',
    content: 'Failed parent must not create a child.',
  };
  const before = await connection.repository('mutationReceipts').count();
  expect(
    (
      await admin.fetch(
        `/crm/customers/${id}/followUps`,
        write(followUp, 'POST', operation),
      )
    ).status,
  ).toBe(404);
  expect(await connection.repository('mutationReceipts').count()).toBe(before);
  expect(
    await connection
      .repository('crmFollowUps')
      .count({ filter: { customerId: id } }),
  ).toBe(0);
  const request = write({ name: 'Missing operation key' });
  const headers = new Headers(request.headers);
  headers.delete('Idempotency-Key');
  expect(
    (await admin.fetch('/crm/customers', { ...request, headers })).status,
  ).toBe(400);
  expect(
    await connection
      .repository('crmCustomers')
      .count({ filter: { name: 'Missing operation key' } }),
  ).toBe(0);
});
