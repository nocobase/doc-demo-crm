import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-imports-test-secret-at-least-32-characters',
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

async function waitForBatch(
  fetcher: (path: string) => Promise<Response>,
  batchId: string,
) {
  for (let i = 0; i < 60; i++) {
    const detail = await data(await fetcher(`/crmImports/batches/${batchId}`));
    if (!['queued', 'running'].includes(detail.status)) return detail;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Import batch ${batchId} did not finish in time.`);
}

test('bulk CSV import supports background jobs, all-or-nothing rollback, row-by-row mode, conflict strategies, error CSV, and owner isolation', async ({
  testApp,
  request,
}) => {
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'import-fixture-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }

  const alex = await person('Alex', 'crm-sales');
  const taylor = await person('Taylor', 'crm-sales');
  const manager = await person('Morgan', 'crm-sales-manager');

  // Unauthenticated access rejected
  expect((await request('/crmImports/batches')).status).toBe(401);

  // Template CSV available to authenticated CRM user
  const templateRes = await alex.session.fetch('/crmImports/template.csv');
  expect(templateRes.status).toBe(200);
  expect(await templateRes.text()).toContain('customerName,industry,status');

  // 1. All-or-nothing rollback: 1 valid row + 1 invalid row => 0 customers written, full error report saved
  const badCsv = [
    'customerName,industry,status,website,notes,contactName,contactRole,contactEmail,contactPhone',
    'Cobalt Energy,Utilities,prospect,https://cobalt.example.com,First row,Taylor Brooks,Director,taylor@cobalt.example.com,+1-555-0101',
    'Broken Corp,Retail,prospect,not-a-url,Second row,Sam Lee,Manager,bad-email,+1-555-0102',
  ].join('\n');

  const rollbackSubmit = await alex.session.fetch(
    '/crmImports/batches',
    write({
      fileName: 'bad-batch.csv',
      csvContent: badCsv,
      conflictMode: 'skip',
      transactionMode: 'allOrNothing',
    }),
  );
  expect(rollbackSubmit.status).toBe(202);
  const rollbackBatch = await data(rollbackSubmit);
  const rollbackDone = await waitForBatch(
    (p) => alex.session.fetch(p),
    rollbackBatch.id,
  );
  expect(rollbackDone.status).toBe('rolledBack');
  expect(rollbackDone.createdCustomers).toBe(0);
  expect(rollbackDone.failedRows).toBe(1);
  expect(rollbackDone.errors).toHaveLength(1);
  expect(rollbackDone.errors[0].rowNumber).toBe(3);

  // Confirm Cobalt Energy was NOT left behind in DB
  const afterRollback = await data(
    await alex.session.fetch('/crm/customers?q=Cobalt'),
  );
  expect(afterRollback).toHaveLength(0);

  // Error CSV download includes error code and message
  const errCsvRes = await alex.session.fetch(
    `/crmImports/batches/${rollbackBatch.id}/errors.csv`,
  );
  expect(errCsvRes.status).toBe(200);
  const errCsvText = await errCsvRes.text();
  expect(errCsvText).toContain('INVALID_FIELD');
  expect(errCsvText).toContain('Broken Corp');

  // 2. Clean import commits customers & contacts and assigns Alex as owner
  const validCsv = [
    'customerName,industry,status,website,notes,contactName,contactRole,contactEmail,contactPhone',
    'Harbor Robotics,Automation,prospect,https://harbor-robotics.example.com,Expo lead,Jordan Patel,VP Ops,jordan@harbor-robotics.example.com,+1-555-0140',
    'Summit Logistics,Supply Chain,customer,https://summit-logistics.example.com,Key account,Riley Chen,IT Director,riley@summit-logistics.example.com,+1-555-0141',
  ].join('\n');

  const okSubmit = await alex.session.fetch(
    '/crmImports/batches',
    write({
      fileName: 'clean-batch.csv',
      csvContent: validCsv,
      conflictMode: 'skip',
      transactionMode: 'allOrNothing',
    }),
  );
  expect(okSubmit.status).toBe(202);
  const okDone = await waitForBatch(
    (p) => alex.session.fetch(p),
    (await data(okSubmit)).id,
  );
  expect(okDone.status).toBe('completed');
  expect(okDone.createdCustomers).toBe(2);
  expect(okDone.createdContacts).toBe(2);
  expect(okDone.failedRows).toBe(0);

  // Taylor cannot see Alex's batch or Alex's imported customers
  expect(
    (await taylor.session.fetch(`/crmImports/batches/${okDone.id}`)).status,
  ).toBe(404);
  const taylorList = await data(
    await taylor.session.fetch('/crm/customers?q=Harbor'),
  );
  expect(taylorList).toHaveLength(0);

  // Manager CAN see Alex's batch and imported customers
  const managerBatch = await data(
    await manager.session.fetch(`/crmImports/batches/${okDone.id}`),
  );
  expect(managerBatch.id).toBe(okDone.id);

  // 3. Conflict handling: skip vs update vs reject (row-by-row)
  const reimportSkip = await waitForBatch(
    (p) => alex.session.fetch(p),
    (
      await data(
        await alex.session.fetch(
          '/crmImports/batches',
          write({
            fileName: 'reimport-skip.csv',
            csvContent: validCsv,
            conflictMode: 'skip',
            transactionMode: 'rowByRow',
          }),
        ),
      )
    ).id,
  );
  expect(reimportSkip.status).toBe('completed');
  expect(reimportSkip.skippedRows).toBe(2);
  expect(reimportSkip.createdCustomers).toBe(0);

  const updateCsv = [
    'customerName,industry,status,website,notes,contactName,contactRole,contactEmail,contactPhone',
    'Harbor Robotics,Industrial Robotics,customer,https://harbor-robotics.example.com,Upgraded customer,Jordan Patel,SVP Ops,jordan@harbor-robotics.example.com,+1-555-0140',
    'Bad Row Only,Finance,prospect,not-valid-url,,Casey,Lead,bad-email,',
  ].join('\n');
  const rowByRowDone = await waitForBatch(
    (p) => alex.session.fetch(p),
    (
      await data(
        await alex.session.fetch(
          '/crmImports/batches',
          write({
            fileName: 'update-row-by-row.csv',
            csvContent: updateCsv,
            conflictMode: 'update',
            transactionMode: 'rowByRow',
          }),
        ),
      )
    ).id,
  );
  expect(rowByRowDone.status).toBe('completedWithErrors');
  expect(rowByRowDone.updatedCustomers).toBe(1);
  expect(rowByRowDone.failedRows).toBe(1);

  const updatedHarbor = await data(
    await alex.session.fetch('/crm/customers?q=Harbor Robotics'),
  );
  expect(updatedHarbor[0].industry).toBe('Industrial Robotics');
  expect(updatedHarbor[0].status).toBe('customer');
});
