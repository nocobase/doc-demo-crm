import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  executeIdempotentMutation,
  listResponse,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  CrmService,
  Customer,
  CustomerInput,
  Contact,
  ContactInput,
  FollowUp,
  FollowUpInput,
  ListInput,
} from '../providers/crm.js';

const access = {
  resource: { type: 'page', id: 'customers' },
  action: 'access',
} as const;
const Params = z.object({ id: z.uuid(), contactId: z.uuid().optional() });
const Header = z.object({ 'idempotency-key': z.string() });
const Page = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  const service = new CrmService(connection);
  router.onError(apiErrorHandler);
  // Scoped to this router's /crm mount. The initial learning dataset is shared
  // only with explicitly permitted users; no automatic member grant is seeded.
  router.use(
    '*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      await c.get('authz').require(access);
      await next();
    },
  );
  router.get(
    '/customers',
    describeRoute({
      tags: ['CRM'],
      summary: 'Search customers',
      responses: { 200: listResponse(Customer), ...apiErrorResponses },
    }),
    apiValidator('query', ListInput),
    async (c) => c.json(await service.list(c.req.valid('query'))),
  );
  router.get(
    '/customers/:id',
    describeRoute({
      tags: ['CRM'],
      summary: 'Read customer',
      responses: { 200: dataResponse(Customer), ...apiErrorResponses },
    }),
    apiValidator('param', Params),
    async (c) => c.json({ data: await service.get(c.req.valid('param').id) }),
  );
  for (const kind of ['contacts', 'followUps'] as const) {
    router.get(
      `/customers/:id/${kind}`,
      describeRoute({
        tags: ['CRM'],
        summary: `List customer ${kind}`,
        responses: {
          200: listResponse(kind === 'contacts' ? Contact : FollowUp),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', Params),
      apiValidator('query', Page),
      async (c) =>
        c.json(
          await service.related(
            c.req.valid('param').id,
            kind,
            c.req.valid('query').page,
          ),
        ),
    );
  }
  // Every write has a validated body and a transaction-bound idempotency receipt.
  for (const update of [false, true]) {
    router.on(
      update ? 'PATCH' : 'POST',
      update ? '/customers/:id' : '/customers',
      describeRoute({
        tags: ['CRM'],
        summary: update ? 'Update customer' : 'Create customer',
        responses: { 200: dataResponse(Customer), ...apiErrorResponses },
      }),
      apiValidator('param', z.object({ id: z.uuid().optional() })),
      apiValidator('header', Header),
      apiValidator('json', CustomerInput),
      async (c) => {
        const id = c.req.valid('param').id;
        const result = await executeIdempotentMutation({
          connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crm/customers/${id ?? 'new'}`,
          input: c.req.valid('json'),
          authorize: async () => {
            await c.get('authz').require(access);
          },
          authorizeReplay: async () => {
            await c.get('authz').require(access);
          },
          execute: (tx) =>
            new CrmService(tx).saveCustomer(c.req.valid('json'), id),
        });
        c.header('Idempotency-Replayed', String(result.replayed));
        return c.json({ data: result.data });
      },
    );
    router.on(
      update ? 'PATCH' : 'POST',
      update ? '/customers/:id/contacts/:contactId' : '/customers/:id/contacts',
      describeRoute({
        tags: ['CRM'],
        summary: update ? 'Update contact' : 'Create contact',
        responses: { 200: dataResponse(Contact), ...apiErrorResponses },
      }),
      apiValidator('param', Params),
      apiValidator('header', Header),
      apiValidator('json', ContactInput),
      async (c) => {
        const { id, contactId } = c.req.valid('param');
        const result = await executeIdempotentMutation({
          connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crm/${id}/contacts/${contactId ?? 'new'}`,
          input: c.req.valid('json'),
          authorize: async () => {
            await c.get('authz').require(access);
          },
          authorizeReplay: async () => {
            await c.get('authz').require(access);
          },
          execute: (tx) =>
            new CrmService(tx).saveContact(id, c.req.valid('json'), contactId),
        });
        c.header('Idempotency-Replayed', String(result.replayed));
        return c.json({ data: result.data });
      },
    );
  }
  router.post(
    '/customers/:id/followUps',
    describeRoute({
      tags: ['CRM'],
      summary: 'Record customer follow-up',
      responses: { 200: dataResponse(FollowUp), ...apiErrorResponses },
    }),
    apiValidator('param', Params),
    apiValidator('header', Header),
    apiValidator('json', FollowUpInput),
    async (c) => {
      const id = c.req.valid('param').id;
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${c.get('auth')!.user.id}`,
        operation: `crm/${id}/followUps/new`,
        input: c.req.valid('json'),
        authorize: async () => {
          await c.get('authz').require(access);
        },
        authorizeReplay: async () => {
          await c.get('authz').require(access);
        },
        execute: (tx) =>
          new CrmService(tx).addFollowUp(
            id,
            c.req.valid('json'),
            c.get('auth')!.user.name,
          ),
      });
      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json({ data: result.data });
    },
  );
  return new Hono().route('/crm', router);
});
