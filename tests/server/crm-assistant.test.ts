import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { knowledgeToken } from '@nocobase/app-plugin-knowledge/server';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-assistant-test-secret-at-least-32-chars',
      trustedOrigins: ['http://localhost'],
    },
    secrets: {
      keys: [
        {
          version: 1,
          key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      ],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
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

async function jsonData(response: Response) {
  const payload = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload.data;
}

interface FixtureState {
  calls: number;
  toolNamesCalled: string[];
  lastToolResults: Record<string, unknown>;
}

function startFixtureModelServer(): Promise<{
  baseUrl: string;
  state: FixtureState;
  close: () => Promise<void>;
}> {
  const state: FixtureState = {
    calls: 0,
    toolNamesCalled: [],
    lastToolResults: {},
  };

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
      : {};

    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'crm-fixture-chat', object: 'model' }],
        }),
      );
      return;
    }

    state.calls += 1;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolMessages = messages.filter(
      (m: { role?: string }) => m.role === 'tool',
    ) as { tool_call_id?: string; name?: string; content?: unknown }[];

    const toolIdToName: Record<string, string> = {
      call_customer: 'crm_customer_context',
      call_knowledge: 'crm_product_knowledge',
    };
    for (const tm of toolMessages) {
      const name =
        tm.name ??
        (tm.tool_call_id ? toolIdToName[tm.tool_call_id] : undefined);
      if (name) {
        try {
          state.lastToolResults[name] =
            typeof tm.content === 'string'
              ? JSON.parse(tm.content)
              : tm.content;
        } catch {
          state.lastToolResults[name] = tm.content;
        }
      }
    }

    const calledCustomer = toolMessages.some(
      (m) =>
        m.tool_call_id === 'call_customer' || m.name === 'crm_customer_context',
    );
    const calledKnowledge = toolMessages.some(
      (m) =>
        m.tool_call_id === 'call_knowledge' ||
        m.name === 'crm_product_knowledge',
    );

    const modelId = body.model ?? 'crm-fixture-chat';
    const sendCompletion = (
      opts:
        | {
            toolCall: { id: string; name: string; arguments: string };
          }
        | { content: string },
    ) => {
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      if (body.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const emit = (chunk: Record<string, unknown>) =>
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if ('toolCall' in opts) {
          emit({
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      index: 0,
                      id: opts.toolCall.id,
                      type: 'function',
                      function: {
                        name: opts.toolCall.name,
                        arguments: opts.toolCall.arguments,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
          emit({
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          });
        } else {
          emit({
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: opts.content },
                finish_reason: null,
              },
            ],
          });
          emit({
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          });
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: modelId,
          choices: [
            {
              index: 0,
              message:
                'toolCall' in opts
                  ? {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: opts.toolCall.id,
                          type: 'function',
                          function: {
                            name: opts.toolCall.name,
                            arguments: opts.toolCall.arguments,
                          },
                        },
                      ],
                    }
                  : { role: 'assistant', content: opts.content },
              finish_reason: 'toolCall' in opts ? 'tool_calls' : 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
    };

    if (!calledCustomer) {
      state.toolNamesCalled.push('crm_customer_context');
      sendCompletion({
        toolCall: {
          id: 'call_customer',
          name: 'crm_customer_context',
          arguments: '{}',
        },
      });
      return;
    }

    if (!calledKnowledge) {
      state.toolNamesCalled.push('crm_product_knowledge');
      sendCompletion({
        toolCall: {
          id: 'call_knowledge',
          name: 'crm_product_knowledge',
          arguments: JSON.stringify({ query: 'discount' }),
        },
      });
      return;
    }

    const kbHits = Array.isArray(state.lastToolResults.crm_product_knowledge)
      ? (state.lastToolResults.crm_product_knowledge as {
          docId: string;
          title: string;
          version: number;
          excerpt?: string;
        }[])
      : [];

    const customerCtx = state.lastToolResults.crm_customer_context as
      | { customer?: { name?: string }; opportunities?: { name?: string }[] }
      | undefined;

    const draft = {
      summary: `${customerCtx?.customer?.name ?? 'Customer'} has ${customerCtx?.opportunities?.length ?? 0} tracked opportunity(s) and active follow-up history.`,
      suggestedNextStep:
        'Confirm the implementation timeline and review discount approval rules before submitting the quote.',
      channel: 'email',
      draftContent:
        'Following up on our recent discussion. Per our current pricing policy, discounts above 10% require sales manager review before formal quotation issuance.',
      citations: kbHits.slice(0, 3).map((hit) => ({
        docId: hit.docId,
        title: hit.title,
        version: hit.version,
        excerpt: hit.excerpt ?? '',
      })),
      missingEvidence: [
        'No custom SLA penalty schedule is documented in Product knowledge.',
      ],
    };

    sendCompletion({ content: JSON.stringify(draft) });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        state,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

test('enforces product knowledge permissions, proposals, version locks, and permission-scoped follow-up draft generation', async ({
  testApp,
  request,
}) => {
  const app = testApp.application;
  const users = app.container.resolve(userManagementServiceToken);
  const knowledge = app.container.resolve(knowledgeToken);
  const agents = app.container.resolve(agentsToken);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);

  async function createPerson(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'assistant-fixture-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }

  const alex = await createPerson('Alex Rivera', 'crm-sales');
  const taylor = await createPerson('Taylor Chen', 'crm-sales');
  const morgan = await createPerson('Morgan Lee', 'crm-sales-manager');

  // 1. Knowledge base permissions, proposals, optimistic lock, and restricted node isolation.
  const space = { scope: 'crm-products', scopeId: '' } as const;
  const policyDoc = await knowledge.docs.create(
    { userId: morgan.user.id },
    {
      scope: space.scope,
      scopeId: space.scopeId,
      kind: 'article',
      title: 'Quotation Discount Policy',
      slug: 'quotation-discount-policy',
      content:
        '# Quotation Discount Policy\n\nDiscounts up to 10% are confirmed automatically. Discounts above 10% require sales manager approval.',
    },
  );
  expect(policyDoc.version).toBe(1);

  // Salesperson Alex cannot edit directly, but can propose a revision.
  await expect(
    knowledge.docs.update({ userId: alex.user.id }, policyDoc.id, {
      expectedVersion: 1,
      content: 'Unauthorized direct edit',
    }),
  ).rejects.toThrow();

  const proposal = await knowledge.proposals.propose(
    { userId: alex.user.id },
    {
      space,
      kind: 'update',
      docId: policyDoc.id,
      baseVersion: 1,
      title: policyDoc.title,
      content:
        '# Quotation Discount Policy\n\nDiscounts up to 10% are confirmed automatically. Discounts above 10% require sales manager approval within 2 business days.',
      reason: 'Clarify review SLA discussed with sales leadership',
    },
  );
  expect(proposal.status).toBe('pending');

  // Alex cannot accept proposals; Morgan accepts -> version 2.
  await expect(
    knowledge.proposals.accept({ userId: alex.user.id }, proposal.id),
  ).rejects.toThrow();

  const accepted = await knowledge.proposals.accept(
    { userId: morgan.user.id },
    proposal.id,
  );
  expect(accepted.status).toBe('accepted');

  const updatedDoc = await knowledge.docs.get(
    { userId: alex.user.id },
    policyDoc.id,
  );
  expect(updatedDoc.version).toBe(2);

  // Stale optimistic lock version must be rejected.
  await expect(
    knowledge.docs.update({ userId: morgan.user.id }, policyDoc.id, {
      expectedVersion: 1,
      content: 'Stale overwrite attempt',
    }),
  ).rejects.toThrow();

  // Restricted internal margin memo visible only to Admin & Morgan, invisible to Alex.
  const adminUsers = await users.list({
    search: DEFAULT_ADMIN_CREDENTIALS.email,
  });
  const adminUserId = adminUsers.items[0]!.id;
  const restrictedDoc = await knowledge.docs.create(
    { userId: adminUserId },
    {
      scope: space.scope,
      scopeId: space.scopeId,
      kind: 'article',
      title: 'Internal Discount Margin Floor',
      slug: 'internal-discount-margin-floor',
      content:
        '# Internal Margin Floor\n\nConfidential management floor for enterprise discount negotiations.',
    },
  );
  await knowledge.permissions.replace(
    { userId: adminUserId },
    restrictedDoc.id,
    {
      mode: 'custom',
      entries: [
        { subject: { type: 'user', id: morgan.user.id }, level: 'read' },
      ],
    },
  );

  const morganHits = await knowledge.docs.search(
    { userId: morgan.user.id },
    space,
    'discount',
    { limit: 10 },
  );
  expect(morganHits.map((h) => h.docId)).toContain(restrictedDoc.id);

  const alexHits = await knowledge.docs.search(
    { userId: alex.user.id },
    space,
    'discount',
    { limit: 10 },
  );
  expect(alexHits.map((h) => h.docId)).toContain(policyDoc.id);
  expect(alexHits.map((h) => h.docId)).not.toContain(restrictedDoc.id);

  // 2. Customer setup for Business Agent tests.
  const customer = await jsonData(
    await alex.session.fetch(
      '/crm/customers',
      write({
        name: 'Northstar Manufacturing',
        industry: 'Manufacturing',
        status: 'prospect',
        notes: 'Evaluating CRM rollout across two regional offices.',
      }),
    ),
  );
  await jsonData(
    await alex.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Regional CRM rollout', stage: 'proposal' }),
    ),
  );
  await jsonData(
    await alex.session.fetch(
      `/crm/customers/${customer.id}/followUps`,
      write({
        channel: 'meeting',
        content: 'Customer asked about enterprise discount rules and rollout.',
        nextStep: 'Send pricing policy summary.',
      }),
    ),
  );

  // Unauthenticated caller -> 401.
  expect(
    (
      await request(
        `/crmAssistant/customers/${customer.id}/follow-up-draft`,
        write({ goal: 'Summarize' }),
      )
    ).status,
  ).toBe(401);

  // No model configured yet -> FAILED_PRECONDITION (412/400).
  const noModelRes = await alex.session.fetch(
    `/crmAssistant/customers/${customer.id}/follow-up-draft`,
    write({ goal: 'Address discount rules' }),
  );
  expect(noModelRes.status).toBe(400);
  const noModelBody = await noModelRes.json();
  expect(noModelBody.error?.reason).toBe('CRM_MODEL_NOT_CONFIGURED');

  // 3. Register local fixture model service and verify tool calls, citations, and permissions.
  const fixture = await startFixtureModelServer();
  try {
    await agents.models.services.create({
      provider: 'openai-compatible',
      title: 'Fixture Chat',
      baseUrl: fixture.baseUrl,
      apiKey: 'fixture-key',
      enabled: true,
      models: [
        {
          value: 'crm-fixture-chat',
          label: 'Fixture Chat Model',
          kind: 'chat',
          dimensions: null,
        },
      ],
    });

    // Unrelated salesperson Taylor is denied BEFORE calling the model.
    const callsBeforeTaylor = fixture.state.calls;
    const taylorDenied = await taylor.session.fetch(
      `/crmAssistant/customers/${customer.id}/follow-up-draft`,
      write({ goal: 'Read Alex customer' }),
    );
    expect(taylorDenied.status).toBe(404);
    expect(fixture.state.calls).toBe(callsBeforeTaylor);

    // Owner Alex generates an evidence-backed follow-up draft.
    const generated = await jsonData(
      await alex.session.fetch(
        `/crmAssistant/customers/${customer.id}/follow-up-draft`,
        write({ goal: 'Address discount rules and SLA' }),
      ),
    );
    expect(generated.canSaveFollowUp).toBe(true);
    expect(fixture.state.toolNamesCalled).toEqual([
      'crm_customer_context',
      'crm_product_knowledge',
    ]);
    // Alex's assistant cites only the authorized v2 policy doc, never the restricted margin memo.
    expect(
      generated.draft.citations.map((c: { docId: string }) => c.docId),
    ).toContain(policyDoc.id);
    expect(
      generated.draft.citations.map((c: { docId: string }) => c.docId),
    ).not.toContain(restrictedDoc.id);
    expect(generated.draft.citations[0].version).toBe(2);
    expect(generated.draft.missingEvidence.length).toBeGreaterThan(0);

    // Generation MUST NOT automatically write a follow-up record.
    const followUpsAfterGen = await jsonData(
      await alex.session.fetch(`/crm/customers/${customer.id}/followUps`),
    );
    expect(followUpsAfterGen).toHaveLength(1);

    // Read-only shared salesperson Taylor can generate draft with canSaveFollowUp=false.
    await jsonData(
      await morgan.session.fetch(
        `/crm/customers/${customer.id}/shares`,
        write({ userIds: [taylor.user.id] }, 'PUT'),
      ),
    );
    const taylorGenerated = await jsonData(
      await taylor.session.fetch(
        `/crmAssistant/customers/${customer.id}/follow-up-draft`,
        write({ goal: 'Review context' }),
      ),
    );
    expect(taylorGenerated.canSaveFollowUp).toBe(false);

    // Transferring ownership away from Alex immediately blocks Alex's assistant access.
    await jsonData(
      await morgan.session.fetch(
        `/crm/customers/${customer.id}/owner`,
        write({ ownerId: taylor.user.id }, 'PUT'),
      ),
    );
    const alexRevoked = await alex.session.fetch(
      `/crmAssistant/customers/${customer.id}/follow-up-draft`,
      write({ goal: 'Should fail after transfer' }),
    );
    expect(alexRevoked.status).toBe(404);
    expect(admin).toBeTruthy();
  } finally {
    await fixture.close();
  }
});
