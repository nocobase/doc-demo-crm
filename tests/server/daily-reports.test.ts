import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createStandaloneServer } from '../../server/standalone.js';
import { generateDailyReport } from '../../server/providers/daily-reports.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'daily-report-test-only-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});

test('reports the previous Shanghai day at 01:00, including its first midnight but excluding the next', async ({
  testApp,
  request,
  connection,
}) => {
  const customerId = randomUUID();
  const start = '2026-11-24T16:00:00.000Z';
  await connection.repository('crmCustomers').createOne({
    values: {
      id: customerId,
      name: 'Juniper Retail',
      industry: '',
      status: 'active',
      website: '',
      notes: '',
      createdAt: start,
      updatedAt: start,
    },
  });
  await connection.repository('crmOpportunities').createOne({
    values: {
      id: randomUUID(),
      customerId,
      name: 'Retail rollout',
      stage: 'discovery',
      notes: '',
      createdAt: '2026-11-25T16:00:00.000Z',
      updatedAt: '2026-11-25T16:00:00.000Z',
    },
  });
  for (const [createdAt, content] of [
    ['2026-11-25T15:55:00.000Z', 'Confirmed delivery at 23:55'],
    ['2026-11-25T16:05:00.000Z', 'Logged the handover at 00:05'],
  ]) {
    await connection.repository('crmFollowUps').createOne({
      values: {
        id: randomUUID(),
        customerId,
        channel: 'call',
        content,
        nextStep: '',
        authorName: 'Alex',
        createdAt,
      },
    });
  }
  const runAt = new Date('2026-11-25T17:00:00.000Z');
  const expected = {
    reportDate: '2026-11-25',
    customers: 1,
    opportunities: 0,
    followUps: 1,
  };
  expect(await generateDailyReport(connection, runAt)).toEqual(expected);
  expect(await generateDailyReport(connection, runAt)).toEqual(expected);
  const next = await generateDailyReport(
    connection,
    new Date('2026-11-26T17:00:00.000Z'),
  );
  expect(next).toEqual({
    reportDate: '2026-11-26',
    customers: 0,
    opportunities: 1,
    followUps: 1,
  });
  const path = '/crm/daily-reports';
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const response = await admin.fetch(path);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({
    timezone: 'Asia/Shanghai',
    reports: [next, expected],
  });
  expect((await request(path)).status).toBe(401);
  const credentials = {
    name: 'Sales reader',
    email: 'daily-reader@example.test',
    password: 'daily-report-reader-test',
  };
  await testApp.application.container
    .resolve(userManagementServiceToken)
    .create({ ...credentials, roleScopes: { app: ['crm-sales'] } });
  const reader = await signIn(testApp, credentials);
  expect((await reader.fetch(path)).status).toBe(403);
  const manager = {
    name: 'Sales manager',
    email: 'daily-manager@example.test',
    password: 'daily-report-manager-test',
  };
  await testApp.application.container
    .resolve(userManagementServiceToken)
    .create({ ...manager, roleScopes: { app: ['crm-sales-manager'] } });
  const managerSession = await signIn(testApp, manager);
  expect((await managerSession.fetch(path)).status).toBe(200);
  expect((await managerSession.fetch('/scheduler/schedules')).status).toBe(403);
  const schedules = (await (await admin.fetch('/scheduler/schedules')).json())
    .data;
  expect(schedules).toContainEqual(
    expect.objectContaining({
      key: 'crm.daily-sales-activity',
      cron: '0 1 * * *',
      timezone: 'Asia/Shanghai',
    }),
  );
});
