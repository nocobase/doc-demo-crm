import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  crmCustomers,
  crmQuotes,
  crmOpportunities,
} from '../../server/providers/crm-permissions.js';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createAppTest } from '@nocobase/app-testing/server';
import { expect } from 'vitest';
import { createStandaloneServer } from '../../server/standalone.js';
import { quoteApprovalServiceToken } from '../../server/providers/quote-approvals.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-quote-approval-test-secret-at-least-32-characters',
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
async function data(response: Response) {
  const body = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  expect(response.status).toBe(200);
  return body.data;
}

test('submits frozen quotes, manages tasks and rejects invalid decisions without losing earlier CRM data', async ({
  testApp,
  request,
}) => {
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const person = async (name: string, role: string) => {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'quote-approval-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  };
  const sales = await person('Alex Sales', 'crm-sales');
  const manager = await person('Morgan Manager', 'crm-sales-manager');
  const other = await person('Other Sales', 'crm-sales');
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const customer = await data(
    await sales.session.fetch(
      '/crm/customers',
      write({ name: 'Approval customer' }),
    ),
  );
  const product = await data(
    await manager.session.fetch(
      '/crmSales/products',
      write({ name: 'Implementation', code: randomUUID(), unitPrice: 100 }),
    ),
  );
  const opportunities = `/crmSales/customers/${customer.id}/opportunities`;
  const opportunity = await data(
    await sales.session.fetch(opportunities, write({ name: 'Rollout' })),
  );
  const quotes = `${opportunities}/${opportunity.id}/quotes`;
  const makeQuote = async (discount: number) =>
    data(
      await sales.session.fetch(
        quotes,
        write({
          name: `Quote ${discount}`,
          lines: [{ productId: product.id, quantity: 2, discount }],
        }),
      ),
    );
  const quote = await makeQuote(15);
  const path = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${quote.id}`;
  expect((await request(path)).status).toBe(401);
  expect((await other.session.fetch(path)).status).toBe(404);
  expect(
    (
      await sales.session.fetch(
        `${path}/submit`,
        write({ reviewerId: sales.user.id }),
      )
    ).status,
  ).toBe(403);
  const operation = `${Date.now()}.${randomUUID()}`;
  const submitted = await data(
    await sales.session.fetch(
      `${path}/submit`,
      write({ reviewerId: manager.user.id }, 'POST', operation),
    ),
  );
  expect(submitted.status).toBe('review');
  const replay = await sales.session.fetch(
    `${path}/submit`,
    write({ reviewerId: manager.user.id }, 'POST', operation),
  );
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  const view = await data(await manager.session.fetch(path));
  expect(view.runs).toHaveLength(1);
  const task = view.runs[0].tasks[0];
  expect(view.view.record.snapshot.total).toBe(170);
  const pending = await data(
    await manager.session.fetch(
      '/userTasks?status=pending&sourceType=approval.task',
    ),
  );
  expect(JSON.stringify(pending)).toContain(task.id);
  expect(
    (
      await sales.session.fetch(
        `${quotes}/${quote.id}`,
        write(
          {
            name: 'Forbidden edit',
            lines: [
              {
                productId: product.id,
                quantity: 9,
                unitPrice: 100,
                discount: 15,
              },
            ],
          },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await other.session.fetch(
        `${path}/actions`,
        write({
          taskId: task.id,
          action: 'approve',
          contentHash: view.runs[0].run.contentHash,
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await manager.session.fetch(
        `${path}/actions`,
        write({ taskId: task.id, action: 'approve', contentHash: 'stale' }),
      )
    ).status,
  ).toBe(400);
  await data(
    await manager.session.fetch(
      `${path}/actions`,
      write({
        taskId: task.id,
        action: 'return',
        contentHash: view.runs[0].run.contentHash,
        comment: 'Please adjust the discount.',
      }),
    ),
  );
  expect((await data(await sales.session.fetch(path))).status).toBe('revision');
  await data(
    await sales.session.fetch(
      `${quotes}/${quote.id}`,
      write(
        {
          name: 'Revised quote',
          lines: [
            {
              productId: product.id,
              quantity: 2,
              unitPrice: 100,
              discount: 12,
            },
          ],
        },
        'PATCH',
      ),
    ),
  );
  await data(
    await sales.session.fetch(
      `${path}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const revision = await data(await manager.session.fetch(path));
  const current =
    revision.runs.find(
      (run: { run: { status: string } }) => run.run.status === 'open',
    ) ?? revision.runs.at(-1);
  expect(current.tasks[0].id).not.toBe(task.id);
  await data(
    await manager.session.fetch(
      `${path}/actions`,
      write({
        taskId: current.tasks[0].id,
        action: 'approve',
        contentHash: current.run.contentHash,
      }),
    ),
  );
  expect((await data(await sales.session.fetch(path))).status).toBe(
    'confirmed',
  );
  expect(
    JSON.stringify(
      await data(
        await manager.session.fetch(
          '/userTasks?status=pending&sourceType=approval.task',
        ),
      ),
    ),
  ).not.toContain(current.tasks[0].id);
  const low = await makeQuote(10);
  const lowPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${low.id}`;
  expect(
    (
      await data(
        await sales.session.fetch(
          `${lowPath}/submit`,
          write({ reviewerId: null }),
        ),
      )
    ).status,
  ).toBe('confirmed');
  expect(
    (await data(await admin.fetch(`/crm/customers/${customer.id}`))).name,
  ).toBe('Approval customer');
  // A later configuration change does not reinterpret an already submitted quotation.
  expect((await sales.session.fetch('/crmWorkflows/definition')).status).toBe(
    403,
  );
  const setting = await data(await admin.fetch('/crmWorkflows/definition'));
  await data(
    await admin.fetch(
      '/crmWorkflows/parameters',
      write(
        {
          thresholdPercent: 20,
          expectedRevision: setting.parameters.revision,
          requestId: randomUUID(),
        },
        'PUT',
      ),
    ),
  );
  expect((await data(await sales.session.fetch(path))).thresholdPercent).toBe(
    10,
  );
  const configuredQuote = await makeQuote(15);
  const configuredPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${configuredQuote.id}`;
  expect(
    (
      await data(
        await sales.session.fetch(
          `${configuredPath}/submit`,
          write({ reviewerId: null }),
        ),
      )
    ).status,
  ).toBe('confirmed');
  await data(
    await admin.fetch(
      '/crmWorkflows/parameters',
      write(
        {
          thresholdPercent: 10,
          expectedRevision: setting.parameters.revision + 1,
          requestId: randomUUID(),
        },
        'PUT',
      ),
    ),
  );
  const withdrawnQuote = await makeQuote(15);
  const withdrawnPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${withdrawnQuote.id}`;
  await data(
    await sales.session.fetch(
      `${withdrawnPath}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const beforeWithdraw = await data(await sales.session.fetch(withdrawnPath));
  await data(
    await manager.session.fetch(
      `${withdrawnPath}/withdraw`,
      write({ expectVersion: beforeWithdraw.view.record.lifecycleVersion }),
    ),
  );
  expect((await data(await sales.session.fetch(withdrawnPath))).status).toBe(
    'draft',
  );
  expect(
    JSON.stringify(
      await data(
        await manager.session.fetch(
          '/userTasks?status=pending&sourceType=approval.task',
        ),
      ),
    ),
  ).not.toContain(beforeWithdraw.runs[0].tasks[0].id);
  const boundaryQuote = await makeQuote(15);
  const boundaryPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${boundaryQuote.id}`;
  await data(
    await sales.session.fetch(
      `${boundaryPath}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const boundary = await data(await manager.session.fetch(boundaryPath));
  await data(
    await manager.session.fetch(
      `/crmSales/products/${product.id}`,
      write(
        { name: 'New catalog name', code: product.code, unitPrice: 300 },
        'PATCH',
      ),
    ),
  );
  expect(
    (await data(await sales.session.fetch(boundaryPath))).view.record.snapshot
      .total,
  ).toBe(170);
  await data(
    await admin.fetch(
      `/users/${manager.user.id}/roleScopes/app`,
      write({ value: ['crm-sales'] }, 'PUT'),
    ),
  );
  expect([403, 404]).toContain(
    (
      await manager.session.fetch(
        `${boundaryPath}/actions`,
        write({
          taskId: boundary.runs[0].tasks[0].id,
          action: 'approve',
          contentHash: boundary.runs[0].run.contentHash,
        }),
      )
    ).status,
  );
  await data(
    await admin.fetch(
      `/crm/customers/${customer.id}/owner`,
      write({ ownerId: other.user.id }, 'PUT'),
    ),
  );
  expect((await sales.session.fetch(boundaryPath)).status).toBe(404);
  expect(
    (
      await sales.session.fetch(
        `${boundaryPath}/submit`,
        write({ reviewerId: manager.user.id }),
      )
    ).status,
  ).toBe(404);
  await data(
    await admin.fetch(
      `/users/${manager.user.id}/roleScopes/app`,
      write({ value: ['crm-sales-manager'] }, 'PUT'),
    ),
  );
  await data(
    await manager.session.fetch(
      `${boundaryPath}/withdraw`,
      write({ expectVersion: boundary.view.record.lifecycleVersion }),
    ),
  );
  expect((await data(await other.session.fetch(boundaryPath))).status).toBe(
    'draft',
  );
  const permissionQuote = await data(
    await other.session.fetch(
      quotes,
      write({
        name: 'Permission boundary',
        lines: [{ productId: product.id, quantity: 1, discount: 15 }],
      }),
    ),
  );
  const permissionPath = `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${permissionQuote.id}`;
  await data(
    await other.session.fetch(
      `${permissionPath}/submit`,
      write({ reviewerId: manager.user.id }),
    ),
  );
  const permissionView = await data(
    await manager.session.fetch(permissionPath),
  );
  await testApp.application.container
    .resolve(authorizationToken)
    .permissionSets.update('crm-sales-manager', {
      key: 'crm-sales-manager',
      grants: [
        crmCustomers.reference().grant({ view: { customers: 'allRecords' } }),
        crmOpportunities
          .reference()
          .grant({ view: { opportunities: 'allRecords' } }),
        crmQuotes
          .reference()
          .grant({ view: { quotes: 'allRecords', lines: 'allRecords' } }),
      ],
    });
  expect((await manager.session.fetch(permissionPath)).status).toBe(200);
  expect(
    (
      await manager.session.fetch(
        `${permissionPath}/actions`,
        write({
          taskId: permissionView.runs[0].tasks[0].id,
          action: 'approve',
          contentHash: permissionView.runs[0].run.contentHash,
        }),
      )
    ).status,
  ).toBe(403);
  const runtime = testApp.application.container.resolve(
    quoteApprovalServiceToken,
  ).runtime;
  await expect(
    runtime.fire('crmQuoteApprovals', quote.id, 'confirm', {
      actor: { id: manager.user.id },
      manual: false,
    }),
  ).rejects.toThrow();
});
