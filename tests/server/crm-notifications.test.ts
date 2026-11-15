import {
  crmNotificationsToken,
  enqueueCrmNotification,
} from '../../server/providers/crm-notifications.js';
import { notificationServiceToken } from '@nocobase/app-plugin-notification/server';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createAppTest } from '@nocobase/app-testing/server';
import { expect, vi } from 'vitest';

import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-file-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const write = (
  body: unknown,
  method = 'POST',
  key = `${Date.now()}.${randomUUID()}`,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'idempotency-key': key,
  },
  body: JSON.stringify(body),
});
async function data(r: Response) {
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));
  return body.data;
}
test('delivers committed customer and approval events once to their intended inboxes', async ({
  testApp,
  request,
  connection,
}) => {
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'notification-test-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }
  const sales = await person('Alex', 'crm-sales'),
    other = await person('Taylor', 'crm-sales'),
    shared = await person('Sam', 'crm-sales'),
    manager = await person('Morgan', 'crm-sales-manager');
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const service = testApp.application.container.resolve(crmNotificationsToken);
  const notification = testApp.application.container.resolve(
    notificationServiceToken,
  );
  const inbox = async (session: typeof sales.session) =>
    data(await session.fetch('/notificationInApp/messages'));
  const customer = await data(
    await sales.session.fetch(
      '/crm/customers',
      write({ name: 'Sensitive customer' }),
    ),
  );
  const ownerPath = `/crm/customers/${customer.id}/owner`;
  const key = `${Date.now()}.${randomUUID()}`;
  await data(
    await manager.session.fetch(
      ownerPath,
      write({ ownerId: other.user.id }, 'PUT', key),
    ),
  );
  await data(
    await manager.session.fetch(
      ownerPath,
      write({ ownerId: other.user.id }, 'PUT', key),
    ),
  );
  await service.flush();
  await expect.poll(async () => (await inbox(other.session)).length).toBe(1);
  expect(await inbox(sales.session)).toHaveLength(0);
  expect(await inbox(shared.session)).toHaveLength(0);
  const item = (await inbox(other.session))[0];
  expect(JSON.stringify(item)).not.toContain('Sensitive customer');
  expect(JSON.stringify(item)).toContain(
    `/customers/${customer.id}/details/overview`,
  );
  expect((await request('/notificationInApp/messages')).status).toBe(401);
  expect(
    (
      await sales.session.fetch(
        `/notificationInApp/messages/${item.id}/markRead`,
        write({}),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await other.session.fetch(
        `/notificationInApp/messages/${item.id}/markRead`,
        {
          ...write({}),
          headers: {
            origin: 'https://untrusted.example',
            'content-type': 'application/json',
          },
        },
      )
    ).status,
  ).toBe(403);
  await data(
    await manager.session.fetch(
      ownerPath,
      write({ ownerId: other.user.id }, 'PUT'),
    ),
  );
  expect(await connection.repository('crmNotificationEvents').count()).toBe(1);
  await data(
    await manager.session.fetch(
      `/crm/customers/${customer.id}/shares`,
      write({ userIds: [shared.user.id] }, 'PUT'),
    ),
  );
  expect(await connection.repository('crmNotificationEvents').count()).toBe(1);
  await data(
    await manager.session.fetch(
      ownerPath,
      write({ ownerId: sales.user.id }, 'PUT'),
    ),
  );
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(1);
  expect(
    (await other.session.fetch(`/crm/customers/${customer.id}`)).status,
  ).toBe(404);
  const product = await data(
    await manager.session.fetch(
      '/crmSales/products',
      write({ name: 'Implementation', code: randomUUID(), unitPrice: 100 }),
    ),
  );
  const opportunity = await data(
    await sales.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Private proposal' }),
    ),
  );
  const quotes = `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}/quotes`;
  const quote = await data(
    await sales.session.fetch(
      quotes,
      write({
        name: 'Private quotation',
        lines: [{ productId: product.id, quantity: 2, discount: 15 }],
      }),
    ),
  );
  const path = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${quote.id}`;
  await data(
    await sales.session.fetch(
      `${path}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const view = await data(await manager.session.fetch(path));
  const task = view.runs[0].tasks[0];
  const beforeTasks = await data(
    await manager.session.fetch(
      '/userTasks?status=pending&sourceType=approval.task',
    ),
  );
  const salesMessage = (await inbox(sales.session))[0];
  const marked = await sales.session.fetch(
    `/notificationInApp/messages/${salesMessage.id}/markRead`,
    write({}),
  );
  expect(marked.ok).toBe(true);
  expect(
    await data(
      await manager.session.fetch(
        '/userTasks?status=pending&sourceType=approval.task',
      ),
    ),
  ).toEqual(beforeTasks);
  await data(
    await manager.session.fetch(
      `${path}/actions`,
      write({
        taskId: task.id,
        action: 'return',
        comment: 'Revise',
        contentHash: view.runs[0].run.contentHash,
      }),
    ),
  );
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(2);
  await data(
    await sales.session.fetch(
      `${path}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const again = await data(await manager.session.fetch(path));
  const active =
    again.runs.find((run: { tasks: { status: string }[] }) =>
      run.tasks.some((task) => task.status === 'pending'),
    ) ?? again.runs.at(-1);
  const decision = {
    taskId: active.tasks[0].id,
    action: 'approve',
    contentHash: active.run.contentHash,
  };
  const decisionKey = `${Date.now()}.${randomUUID()}`;
  await data(
    await manager.session.fetch(
      `${path}/actions`,
      write(decision, 'POST', decisionKey),
    ),
  );
  await data(
    await manager.session.fetch(
      `${path}/actions`,
      write(decision, 'POST', decisionKey),
    ),
  );
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(3);
  await service.flush();
  expect(await inbox(sales.session)).toHaveLength(3);
  expect(await inbox(shared.session)).toHaveLength(0);
  expect(await inbox(manager.session)).toHaveLength(0);
  const low = await data(
    await sales.session.fetch(
      quotes,
      write({
        name: 'Direct',
        lines: [{ productId: product.id, quantity: 1, discount: 10 }],
      }),
    ),
  );
  await data(
    await sales.session.fetch(
      `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${low.id}/submit`,
      write({ reviewerId: null }),
    ),
  );
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(4);
  const reject = await data(
    await sales.session.fetch(
      quotes,
      write({
        name: 'Rejected',
        lines: [{ productId: product.id, quantity: 1, discount: 15 }],
      }),
    ),
  );
  const rejectPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${reject.id}`;
  await data(
    await sales.session.fetch(
      `${rejectPath}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const rejection = await data(await manager.session.fetch(rejectPath));
  await data(
    await manager.session.fetch(
      `${rejectPath}/actions`,
      write({
        taskId: rejection.runs[0].tasks[0].id,
        action: 'reject',
        comment: 'Declined',
        contentHash: rejection.runs[0].run.contentHash,
      }),
    ),
  );
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(5);
  const events = await data(await admin.fetch('/crmNotifications/events'));
  expect(
    events.every((event: { status: string }) => event.status === 'submitted'),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toContain(sales.user.id);
  for (const event of events) {
    await expect
      .poll(
        async () =>
          (await notification.getNotification(event.notificationId))?.status,
      )
      .toBe('completed');
  }
  await enqueueCrmNotification(connection, {
    id: 'retry-event',
    scenario: 'assignment',
    recipientId: sales.user.id,
    targetPath: '/customers',
  });
  const failing = vi
    .spyOn(notification, 'send')
    .mockRejectedValueOnce(new Error('simulated preacceptance outage'));
  await service.flush();
  failing.mockRestore();
  expect(
    (
      await connection
        .repository('crmNotificationEvents')
        .findOne({ filter: { id: 'retry-event' } })
    )?.status,
  ).toBe('queued');
  await service.flush();
  await expect.poll(async () => (await inbox(sales.session)).length).toBe(6);
  const accepted = await connection
    .repository('crmNotificationEvents')
    .findOne({ filter: { id: 'retry-event' } });
  await connection
    .repository('crmNotificationEvents')
    .updateOne({
      filter: { id: 'retry-event' },
      values: { status: 'queued', notificationId: null },
    });
  await service.flush();
  expect(
    (
      await connection
        .repository('crmNotificationEvents')
        .findOne({ filter: { id: 'retry-event' } })
    )?.notificationId,
  ).toBe(accepted?.notificationId);
  expect(await inbox(sales.session)).toHaveLength(6);
  const count = await connection.repository('crmNotificationEvents').count();
  await expect(
    connection.transaction(async (tx) => {
      await enqueueCrmNotification(tx, {
        id: 'rolled-back',
        scenario: 'assignment',
        recipientId: sales.user.id,
        targetPath: '/customers',
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  await service.flush();
  expect(await connection.repository('crmNotificationEvents').count()).toBe(
    count,
  );
  const templates = await data(await admin.fetch('/notifications/templates'));
  expect(
    templates.filter((value: { id: string }) => value.id.startsWith('crm.')),
  ).toHaveLength(6);
  const preview = await admin.fetch(
    '/notifications/templates/crm.confirmed/preview',
    write({ locale: 'zh-CN' }),
  );
  expect(preview.status).toBe(200);
  expect(await connection.repository('crmNotificationEvents').count()).toBe(
    count,
  );
  expect((await sales.session.fetch('/notifications/templates')).status).toBe(
    403,
  );
  expect((await sales.session.fetch('/crmNotifications/events')).status).toBe(
    403,
  );
  expect((await sales.session.fetch('/notifications/logs')).status).toBe(403);
});
