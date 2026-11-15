import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { notificationServiceToken } from '@nocobase/app-plugin-notification/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { crmRemindersToken } from '../../server/providers/crm-reminders.js';
import { crmNotificationsToken } from '../../server/providers/crm-notifications.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-reminder-test-secret-at-least-32-characters',
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
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b));
  return b.data;
}
test('checks time boundaries, ownership, completion, cancellation and recoverable notification failures', async ({
  testApp,
  request,
  connection,
}) => {
  const app = testApp.application,
    users = app.container.resolve(userManagementServiceToken),
    service = app.container.resolve(crmRemindersToken);
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'reminder-fixture-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }
  const alex = await person('Alex', 'crm-sales'),
    taylor = await person('Taylor', 'crm-sales'),
    manager = await person('Morgan', 'crm-sales-manager'),
    admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const customer = await data(
    await alex.session.fetch(
      '/crm/customers',
      write({ name: 'Harbor Services' }),
    ),
  );
  const path = `/crmReminders/customers/${customer.id}`;
  const target = new Date(Date.now() + 3600000);
  const values = {
    title: 'Discuss proposal',
    kind: 'followUp',
    dueAt: target.toISOString(),
  };
  const key = `${Date.now()}.${randomUUID()}`;
  const plan = await data(
    await alex.session.fetch(path, write(values, 'POST', key)),
  );
  expect(
    (await data(await alex.session.fetch(path, write(values, 'POST', key)))).id,
  ).toBe(plan.id);
  expect((await request(path)).status).toBe(401);
  expect((await taylor.session.fetch(path)).status).toBe(404);
  await data(
    await manager.session.fetch(
      `/crm/customers/${customer.id}/shares`,
      write({ userIds: [taylor.user.id] }, 'PUT'),
    ),
  );
  expect(await data(await taylor.session.fetch(path))).toHaveLength(1);
  expect((await taylor.session.fetch(path, write(values))).status).toBe(404);
  expect(
    (await taylor.session.fetch(`${path}/${plan.id}/complete`, write({})))
      .status,
  ).toBe(404);
  expect(
    (
      await alex.session.fetch(
        path,
        write({ ...values, dueAt: '2030-01-01T10:00:00' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await alex.session.fetch(
        path,
        write({ ...values, kind: 'quoteExpiry', quoteId: randomUUID() }),
      )
    ).status,
  ).toBe(400);
  expect((await service.scan(new Date(target.getTime() - 1))).queued).toBe(0);
  const cancelled = await data(
    await alex.session.fetch(
      path,
      write({ ...values, title: 'Cancelled plan' }),
    ),
  );
  await data(
    await alex.session.fetch(`${path}/${cancelled.id}/cancel`, write({})),
  );
  const done = await data(
    await alex.session.fetch(
      path,
      write({ ...values, title: 'Completed plan' }),
    ),
  );
  await data(
    await alex.session.fetch(`${path}/${done.id}/complete`, write({})),
  );
  await data(
    await manager.session.fetch(
      `/crm/customers/${customer.id}/owner`,
      write({ ownerId: taylor.user.id }, 'PUT'),
    ),
  );
  expect((await service.scan(target)).queued).toBe(1);
  expect((await service.scan(target)).queued).toBe(0);
  const event = await connection
    .repository('crmNotificationEvents')
    .findOne({ filter: { scenario: 'followUpDue' } });
  expect(event?.recipientId).toBe(taylor.user.id);
  expect((await alex.session.fetch(path)).status).toBe(404);
  const inbox = await data(
    await taylor.session.fetch('/notificationInApp/messages'),
  );
  const reminderMessage = inbox.find(
    (m: { title: string }) => m.title === 'Customer follow-up due',
  );
  await expect
    .poll(async () =>
      (
        await data(await taylor.session.fetch('/notificationInApp/messages'))
      ).some((m: { title: string }) => m.title === 'Customer follow-up due'),
    )
    .toBe(true);
  if (reminderMessage)
    await data(
      await taylor.session.fetch(
        `/notificationInApp/messages/${reminderMessage.id}/markRead`,
        write({}),
      ),
    );
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: plan.id } })
    )?.status,
  ).toBe('notified');
  const retry = await data(
    await taylor.session.fetch(
      path,
      write({ ...values, title: 'Retry later' }),
    ),
  );
  const notification = app.container.resolve(notificationServiceToken);
  const failing = vi
    .spyOn(notification, 'send')
    .mockRejectedValue(new Error('test-only transport outage'));
  expect((await service.scan(target)).queued).toBe(1);
  failing.mockRestore();
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: retry.id } })
    )?.status,
  ).toBe('notified');
  expect(
    await connection
      .repository('crmNotificationEvents')
      .count({ filter: { scenario: 'followUpDue', status: 'queued' } }),
  ).toBe(1);
  await app.container.resolve(crmNotificationsToken).flush();
  await service.scan(target);
  expect(
    await connection
      .repository('crmNotificationEvents')
      .count({ filter: { scenario: 'followUpDue' } }),
  ).toBe(2);
  const dormant = await data(
    await taylor.session.fetch(
      path,
      write({ ...values, title: 'Inactive customer' }),
    ),
  );
  await data(
    await taylor.session.fetch(
      `/crm/customers/${customer.id}`,
      write({ name: 'Harbor Services', status: 'inactive' }, 'PATCH'),
    ),
  );
  expect((await service.scan(target)).queued).toBe(0);
  await data(
    await taylor.session.fetch(
      `/crm/customers/${customer.id}`,
      write({ name: 'Harbor Services', status: 'customer' }, 'PATCH'),
    ),
  );
  expect((await service.scan(target)).queued).toBe(1);
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: dormant.id } })
    )?.status,
  ).toBe('notified');

  // A deferred early page must not starve later due plans.
  const noOwner = await data(
    await manager.session.fetch(
      '/crm/customers',
      write({ name: 'Unassigned customer' }),
    ),
  );
  await data(
    await manager.session.fetch(
      `/crm/customers/${noOwner.id}/owner`,
      write({ ownerId: null }, 'PUT'),
    ),
  );
  const now = new Date().toISOString();
  for (let i = 0; i < 101; i++)
    await connection
      .repository('crmReminders')
      .createOne({
        values: {
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          customerId: noOwner.id,
          title: 'Deferred fixture',
          kind: 'followUp',
          dueAt: target.toISOString(),
          status: 'pending',
          createdBy: manager.user.id,
          createdAt: now,
          updatedAt: now,
        },
      });
  const later = await data(
    await taylor.session.fetch(
      path,
      write({ ...values, title: 'After deferred batch' }),
    ),
  );
  const batch = await service.scan(target);
  expect(batch.checked).toBe(102);
  expect(batch.queued).toBe(1);
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: later.id } })
    )?.status,
  ).toBe('notified');
  const product = await data(
    await manager.session.fetch(
      '/crmSales/products',
      write({ name: 'Implementation', code: randomUUID(), unitPrice: 100 }),
    ),
  );
  const opportunity = await data(
    await taylor.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Response deadline' }),
    ),
  );
  const quote = await data(
    await taylor.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}/quotes`,
      write({
        name: 'Response proposal',
        lines: [{ productId: product.id, quantity: 1, discount: 0 }],
      }),
    ),
  );
  await data(
    await taylor.session.fetch(
      `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${quote.id}/submit`,
      write({ reviewerId: null }),
    ),
  );
  const quotePlan = await data(
    await taylor.session.fetch(
      path,
      write({ ...values, kind: 'quoteExpiry', quoteId: quote.id }),
    ),
  );
  const expired = await data(
    await taylor.session.fetch(
      path,
      write({
        ...values,
        kind: 'quoteExpiry',
        quoteId: quote.id,
        title: 'Skip closed opportunity',
      }),
    ),
  );
  await data(
    await taylor.session.fetch(`${path}/${expired.id}/cancel`, write({})),
  );
  expect((await service.scan(target)).queued).toBe(1);
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: quotePlan.id } })
    )?.status,
  ).toBe('notified');
  const closed = await data(
    await taylor.session.fetch(
      path,
      write({
        ...values,
        kind: 'quoteExpiry',
        quoteId: quote.id,
        title: 'Closed opportunity',
      }),
    ),
  );
  await data(
    await taylor.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}`,
      write({ name: 'Response deadline', stage: 'won', notes: '' }, 'PATCH'),
    ),
  );
  expect((await service.scan(target)).queued).toBe(0);
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: closed.id } })
    )?.status,
  ).toBe('pending');
  const disabled = await data(
    await manager.session.fetch(
      path,
      write({ ...values, title: 'Disabled owner' }),
    ),
  );
  await data(await admin.fetch(`/users/${taylor.user.id}/disable`, write({})));
  expect((await service.scan(target)).queued).toBe(0);
  expect(
    (
      await connection
        .repository('crmReminders')
        .findOne({ filter: { id: disabled.id } })
    )?.status,
  ).toBe('pending');
  await data(await admin.fetch(`/users/${taylor.user.id}/enable`, write({})));
  expect((await service.scan(target)).queued).toBe(1);
  const schedules = await data(await admin.fetch('/scheduler/schedules'));
  const schedule = schedules.find(
    (s: { key: string }) => s.key === 'crm.reminders',
  );
  expect(schedule.timezone).toBe('UTC');
  expect((await alex.session.fetch('/scheduler/schedules')).status).toBe(403);
  expect(
    (
      await data(
        await admin.fetch(
          `/scheduler/schedules/${schedule.id}/disable`,
          write({}),
        ),
      )
    ).enabled,
  ).toBe(false);
  expect(
    (
      await data(
        await admin.fetch(
          `/scheduler/schedules/${schedule.id}/enable`,
          write({}),
        ),
      )
    ).enabled,
  ).toBe(true);
});
