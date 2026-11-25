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
      secret: 'crm-integrations-test-secret-at-least-32-characters',
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

async function waitForDelivery(
  fetcher: (path: string) => Promise<Response>,
  deliveryId: string,
) {
  for (let i = 0; i < 60; i++) {
    const list = await data(await fetcher('/crmIntegrations/deliveries'));
    const found = list.find((item: { id: string }) => item.id === deliveryId);
    if (found && found.status !== 'pending') return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Sync delivery ${deliveryId} did not settle in time.`);
}

test('scoped API keys, idempotent external lead intake, key rotation/revocation, and ERP sync with failure retry', async ({
  testApp,
  request,
}) => {
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'integration-fixture-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }

  const alex = await person('Alex', 'crm-sales');
  const manager = await person('Morgan', 'crm-sales-manager');
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);

  // 1. Scope options expose CRM groups and reflect user's held permissions
  const alexScopes = await data(
    await alex.session.fetch('/apiKeys/scopeOptions'),
  );
  const alexLeadsGroup = alexScopes.groups.find(
    (g: { id: string }) => g.id === 'crm.leads',
  );
  const alexSyncGroup = alexScopes.groups.find(
    (g: { id: string }) => g.id === 'crm.integrations',
  );
  expect(alexLeadsGroup.held.write).toBe(true);
  expect(alexSyncGroup.held.write).toBe(false);

  // 2. Alex issues a read-only scoped key — can read customers, cannot create leads or manage API keys
  const roCreated = await data(
    await alex.session.fetch(
      '/apiKeys',
      write({
        name: 'Read-only reporting key',
        expiresInDays: 30,
        scope: { groups: { 'crm.leads': { level: 'read' } } },
      }),
    ),
  );
  const roSecret: string = roCreated.secret;
  expect(
    (
      await request('/crmIntegrations/customers', {
        headers: { 'x-api-key': roSecret },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request('/crmIntegrations/leads', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': roSecret,
          'idempotency-key': `${Date.now()}.${randomUUID()}`,
        },
        body: JSON.stringify({
          externalId: 'WEB-100',
          source: 'website',
          name: 'Blocked Lead Corp',
        }),
      })
    ).status,
  ).toBe(403);
  // API keys cannot manage other API keys
  expect(
    (
      await request('/apiKeys', {
        headers: { 'x-api-key': roSecret },
      })
    ).status,
  ).toBe(403);
  // Browser-only CRM route rejects scoped API keys
  expect(
    (
      await request('/crm/customers', {
        headers: { 'x-api-key': roSecret },
      })
    ).status,
  ).toBe(403);

  // 3. Alex issues a lead-intake scoped key and submits an external lead with idempotency
  const leadKeyCreated = await data(
    await alex.session.fetch(
      '/apiKeys',
      write({
        name: 'Website lead intake',
        expiresInDays: 90,
        scope: { groups: { 'crm.leads': { level: 'write' } } },
      }),
    ),
  );
  const leadSecret: string = leadKeyCreated.secret;
  const leadPayload = {
    externalId: 'WEB-2026-001',
    source: 'website',
    name: 'Beacon BioLabs',
    industry: 'Biotech',
    status: 'prospect',
    website: 'https://beacon-biolabs.example.com',
    notes: 'Requested enterprise demo',
    conflictMode: 'skip',
    contact: {
      name: 'Dana Wu',
      role: 'Head of Ops',
      email: 'dana.wu@beacon-biolabs.example.com',
      phone: '+1-555-0190',
    },
  };
  const idemKey = `${Date.now()}.${randomUUID()}`;
  const firstLeadRes = await request('/crmIntegrations/leads', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': leadSecret,
      'idempotency-key': idemKey,
    },
    body: JSON.stringify(leadPayload),
  });
  expect(firstLeadRes.status).toBe(201);
  expect(firstLeadRes.headers.get('Idempotency-Replayed')).toBe('false');
  const firstLead = await data(firstLeadRes);
  expect(firstLead.action).toBe('created');
  expect(firstLead.customer.ownerId).toBe(alex.user.id);

  // Replay with the same Idempotency-Key returns the same record without creating a duplicate
  const replayRes = await request('/crmIntegrations/leads', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': leadSecret,
      'idempotency-key': idemKey,
    },
    body: JSON.stringify(leadPayload),
  });
  expect(replayRes.status).toBe(200);
  expect(replayRes.headers.get('Idempotency-Replayed')).toBe('true');
  const replayed = await data(replayRes);
  expect(replayed.customer.id).toBe(firstLead.customer.id);

  // New Idempotency-Key with conflictMode: 'reject' returns 409
  const conflictRes = await request('/crmIntegrations/leads', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': leadSecret,
      'idempotency-key': `${Date.now()}.${randomUUID()}`,
    },
    body: JSON.stringify({ ...leadPayload, conflictMode: 'reject' }),
  });
  expect(conflictRes.status).toBe(409);

  // 4. Key rotation invalidates old secret immediately; revocation disables new secret immediately
  const rotated = await data(
    await alex.session.fetch(
      `/apiKeys/${leadKeyCreated.key.id}/rotate`,
      write({}),
    ),
  );
  expect(
    (
      await request('/crmIntegrations/customers', {
        headers: { 'x-api-key': leadSecret },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request('/crmIntegrations/customers', {
        headers: { 'x-api-key': rotated.secret },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await alex.session.fetch(`/apiKeys/${leadKeyCreated.key.id}`, {
        method: 'DELETE',
        headers: { origin: 'http://localhost' },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await request('/crmIntegrations/customers', {
        headers: { 'x-api-key': rotated.secret },
      })
    ).status,
  ).toBe(401);

  // 5. Outbound ERP sync for a won opportunity: simulated HTTP 503 failure -> manual retry -> idempotent success
  const opp = await data(
    await alex.session.fetch(
      `/crmSales/customers/${firstLead.customer.id}/opportunities`,
      write({ name: 'Beacon annual rollout', stage: 'won', notes: 'Signed' }),
    ),
  );

  // Sales cannot configure ERP target or trigger ERP sync
  expect(
    (
      await alex.session.fetch(
        `/crmIntegrations/sync/opportunities/${opp.id}`,
        write({}),
      )
    ).status,
  ).toBe(403);

  // Admin turns on simulated ERP 503 failure
  await data(
    await admin.fetch('/crmIntegrations/target', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        name: 'ERP & Finance Order Sync',
        endpointUrl: 'mock://erp-finance/orders',
        secretHeader: '',
        enabled: true,
        simulateFailure: true,
      }),
    }),
  );

  // Manager issues an ERP sync scoped key and triggers sync
  const erpKey = await data(
    await manager.session.fetch(
      '/apiKeys',
      write({
        name: 'ERP order sync',
        expiresInDays: 90,
        scope: {
          groups: {
            'crm.leads': { level: 'read' },
            'crm.integrations': { level: 'write' },
          },
        },
      }),
    ),
  );

  const syncFailStart = await data(
    await request(`/crmIntegrations/sync/opportunities/${opp.id}`, {
      method: 'POST',
      headers: { 'x-api-key': erpKey.secret },
    }),
  );
  const failedDelivery = await waitForDelivery(
    (p) => manager.session.fetch(p),
    syncFailStart.id,
  );
  expect(failedDelivery.status).toBe('failed');
  expect(failedDelivery.httpStatus).toBe(503);
  expect(failedDelivery.attempts).toBe(1);

  // Admin disables simulated failure; manager retries with same idempotencyKey
  await data(
    await admin.fetch('/crmIntegrations/target', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({
        name: 'ERP & Finance Order Sync',
        endpointUrl: 'mock://erp-finance/orders',
        secretHeader: '',
        enabled: true,
        simulateFailure: false,
      }),
    }),
  );

  await data(
    await request(`/crmIntegrations/deliveries/${failedDelivery.id}/retry`, {
      method: 'POST',
      headers: { 'x-api-key': erpKey.secret },
    }),
  );
  const succeeded = await waitForDelivery(
    (p) => manager.session.fetch(p),
    failedDelivery.id,
  );
  expect(succeeded.status).toBe('succeeded');
  expect(succeeded.httpStatus).toBe(200);
  expect(succeeded.attempts).toBe(2);
  expect(succeeded.idempotencyKey).toBe(failedDelivery.idempotencyKey);
  expect(succeeded.externalReference).toMatch(/^ERP-SO-/);

  // Calling sync again on the already-synced opportunity replays the existing delivery
  const replaySyncRes = await request(
    `/crmIntegrations/sync/opportunities/${opp.id}`,
    {
      method: 'POST',
      headers: { 'x-api-key': erpKey.secret },
    },
  );
  expect(replaySyncRes.status).toBe(200);
  expect(replaySyncRes.headers.get('Idempotency-Replayed')).toBe('true');
  const replayedDelivery = await data(replaySyncRes);
  expect(replayedDelivery.externalReference).toBe(succeeded.externalReference);
});
