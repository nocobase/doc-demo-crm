import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import {
  mailProviderRegistryToken,
  mailServiceToken,
} from '@nocobase/app-plugin-mail/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { fixtureMailProvider } from '../fixtures/crm-mail/provider.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-mail-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
    mail: { providers: { local: { type: 'crm-test-mail' } } },
  },
});
const write = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'idempotency-key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});
async function data(r: Response) {
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b));
  return b.data;
}
test('scopes exact customer correspondence to personal mail and preserves native send idempotency', async ({
  testApp,
  request,
}) => {
  const app = testApp.application;
  const fixture = fixtureMailProvider();
  app.container.resolve(mailProviderRegistryToken).register(fixture.definition);
  const users = app.container.resolve(userManagementServiceToken);
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'mail-fixture-password',
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
    manager = await person('Morgan', 'crm-sales-manager');
  const customer = await data(
    await alex.session.fetch(
      '/crm/customers',
      write({ name: 'Harbor Services' }),
    ),
  );
  const contact = await data(
    await alex.session.fetch(
      `/crm/customers/${customer.id}/contacts`,
      write({ name: 'Casey', email: 'contact@harbor.example' }),
    ),
  );
  const mail = app.container.resolve(mailServiceToken);
  const actor = { actorId: alex.user.id };
  const account = await mail.connectAccount(actor, {
    provider: { type: 'crm-test-mail', name: 'local' },
    address: 'alex@example.test',
    password: 'fixture-only',
    initialSyncReceivedAfter: '2026-11-01T00:00:00.000Z',
  });
  await mail.startSync(actor, { accountId: account.id });
  await expect
    .poll(
      async () => {
        const runs = await mail.listSyncRuns(actor);
        if (runs.some((r) => r.status === 'failed'))
          throw new Error(JSON.stringify(runs));
        return (
          await mail.listMessages(actor, {
            participant: 'contact@harbor.example',
          })
        ).items.length;
      },
      { timeout: 15000 },
    )
    .toBe(1);
  const path = `/crmMail/customers/${customer.id}?contactId=${contact.id}`;
  expect((await request(path)).status).toBe(401);
  const rows = await data(await alex.session.fetch(path));
  expect(rows).toHaveLength(1);
  expect(rows[0].subject).toBe('Implementation requirements');
  expect((await taylor.session.fetch(path)).status).toBe(404);
  await data(
    await manager.session.fetch(
      `/crm/customers/${customer.id}/shares`,
      write({ userIds: [taylor.user.id] }, 'PUT'),
    ),
  );
  expect(await data(await taylor.session.fetch(path))).toEqual([]);
  expect(await data(await manager.session.fetch(path))).toEqual([]);
  expect(
    (
      await alex.session.fetch(
        `/crmMail/customers/${customer.id}?contactId=${randomUUID()}`,
      )
    ).status,
  ).toBe(404);
  expect((await alex.session.fetch('/mail/settings/accounts')).status).toBe(
    403,
  );
  const product = await data(
    await manager.session.fetch(
      '/crmSales/products',
      write({
        name: 'CRM implementation',
        code: randomUUID(),
        unitPrice: 12000,
      }),
    ),
  );
  const opportunity = await data(
    await alex.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Phase one' }),
    ),
  );
  const quote = await data(
    await alex.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities/${opportunity.id}/quotes`,
      write({
        name: 'Implementation proposal',
        lines: [{ productId: product.id, quantity: 1, discount: 0 }],
      }),
    ),
  );
  await data(
    await alex.session.fetch(
      `/crmApprovals/quotes/${customer.id}/${opportunity.id}/${quote.id}/submit`,
      write({ reviewerId: null }),
    ),
  );
  const issued = await data(
    await alex.session.fetch(
      `/crmFiles/quotes/${customer.id}/${opportunity.id}/${quote.id}`,
      write({}),
    ),
  );
  const download = await alex.session.fetch(
    `http://localhost${issued.file.contentUrl}`,
  );
  expect(download.status).toBe(200);
  const documentBytes = new Uint8Array(await download.arrayBuffer());
  const upload = await mail.uploadAttachment(actor, {
    fileName: issued.file.filename,
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: documentBytes.length,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(documentBytes);
        controller.close();
      },
    }),
  });
  const identities = await mail.listIdentities(actor, account.id);
  const input = {
    accountId: account.id,
    identityId: identities[0].id,
    to: [{ address: 'contact@harbor.example' }],
    subject: 'Implementation quotation',
    text: 'Please review the attached quotation.',
    attachmentIds: [upload.id],
    idempotencyKey: randomUUID(),
  };
  const first = await mail.sendMessage(actor, input);
  const again = await mail.sendMessage(actor, input);
  expect(again.id).toBe(first.id);
  await expect.poll(() => fixture.sent.length, { timeout: 15000 }).toBe(1);
  expect(fixture.sent[0].message.attachments).toHaveLength(1);
  expect(
    new Uint8Array(
      await new Response(
        await fixture.sent[0].message.attachments[0].open(),
      ).arrayBuffer(),
    ),
  ).toEqual(documentBytes);
  await expect
    .poll(async () => (await mail.listSubmissions(actor))[0]?.status)
    .toBe('accepted');
  await expect(
    mail.sendMessage(
      { actorId: taylor.user.id },
      { ...input, idempotencyKey: randomUUID() },
    ),
  ).rejects.toThrow();
  await expect(
    mail.sendMessage(actor, { ...input, subject: 'Changed' }),
  ).rejects.toThrow();
  await data(
    await manager.session.fetch(
      `/crm/customers/${customer.id}/owner`,
      write({ ownerId: taylor.user.id }, 'PUT'),
    ),
  );
  expect((await alex.session.fetch(path)).status).toBe(404);
  expect(
    (await mail.listMessages(actor, { participant: 'contact@harbor.example' }))
      .items,
  ).toHaveLength(1);
});
