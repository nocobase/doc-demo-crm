import {
  authorizeCrm,
  customerReads,
  scopedRepository,
} from '../providers/crm-permissions.js';
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
  ApiError,
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

const Params = z.object({ id: z.uuid(), contactId: z.uuid().optional() });
const Header = z.object({ 'idempotency-key': z.string() });
const Page = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  router.onError(apiErrorHandler);
  // Scoped to this router's /crm mount. The initial learning dataset is shared
  // only with explicitly permitted users; no automatic member grant is seeded.
  for (const path of ['/customers', '/customers/*'])
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
    );
  router.get(
    '/customers',
    async (c, next) => {
      await authorizeCrm(c.get('authz'), 'viewCustomer');
      await next();
    },
    describeRoute({
      tags: ['CRM'],
      summary: 'Search customers',
      responses: { 200: listResponse(Customer), ...apiErrorResponses },
    }),
    apiValidator('query', ListInput),
    async (c) =>
      c.json(
        await new CrmService(
          connection,
          await authorizeCrm(c.get('authz'), 'viewCustomer'),
        ).list(c.req.valid('query')),
      ),
  );
  router.get(
    '/customers/:id',
    async (c, next) => {
      await authorizeCrm(c.get('authz'), 'viewCustomer');
      await next();
    },
    describeRoute({
      tags: ['CRM'],
      summary: 'Read customer',
      responses: { 200: dataResponse(Customer), ...apiErrorResponses },
    }),
    apiValidator('param', Params),
    async (c) =>
      c.json({
        data: await new CrmService(
          connection,
          await authorizeCrm(c.get('authz'), 'viewCustomer'),
        ).get(c.req.valid('param').id),
      }),
  );
  for (const kind of ['contacts', 'followUps'] as const) {
    router.get(
      `/customers/:id/${kind}`,
      async (c, next) => {
        await customerReads(
          c.get('authz'),
          kind === 'contacts' ? 'viewContacts' : 'viewFollowUps',
        );
        await next();
      },
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
          await new CrmService(
            connection,
            await customerReads(
              c.get('authz'),
              kind === 'contacts' ? 'viewContacts' : 'viewFollowUps',
            ),
          ).related(c.req.valid('param').id, kind, c.req.valid('query').page),
        ),
    );
  }
  // Every write has a validated body and a transaction-bound idempotency receipt.
  for (const update of [false, true]) {
    router.on(
      update ? 'PATCH' : 'POST',
      update ? '/customers/:id' : '/customers',
      async (c, next) => {
        await authorizeCrm(
          c.get('authz'),
          update ? 'editCustomer' : 'createCustomer',
        );
        await next();
      },
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
        const policies = await authorizeCrm(
          c.get('authz'),
          update ? 'editCustomer' : 'createCustomer',
        );
        const service = new CrmService(connection, policies);
        const result = await executeIdempotentMutation({
          connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crm/customers/${id ?? 'new'}`,
          input: c.req.valid('json'),
          authorize: async () => {
            if (id) await service.get(id);
          },
          authorizeReplay: async (record) => {
            await service.get(z.object({ id: z.string() }).parse(record).id);
          },
          execute: (tx) =>
            new CrmService(tx, policies).saveCustomer(
              c.req.valid('json'),
              id,
              c.get('auth')!.user.id,
            ),
        });
        c.header('Idempotency-Replayed', String(result.replayed));
        return c.json({ data: result.data });
      },
    );
    router.on(
      update ? 'PATCH' : 'POST',
      update ? '/customers/:id/contacts/:contactId' : '/customers/:id/contacts',
      async (c, next) => {
        await authorizeCrm(
          c.get('authz'),
          update ? 'editContact' : 'addContact',
        );
        await next();
      },
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
        const policies = await authorizeCrm(
          c.get('authz'),
          update ? 'editContact' : 'addContact',
        );
        const service = new CrmService(connection, policies);
        const result = await executeIdempotentMutation({
          connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crm/${id}/contacts/${contactId ?? 'new'}`,
          input: c.req.valid('json'),
          authorize: async () => {
            await service.get(id);
          },
          authorizeReplay: async (record) => {
            await service.get(id);
            const savedId = z.object({ id: z.string() }).parse(record).id;
            if (
              !(await scopedRepository(
                connection,
                policies,
                'crmContacts',
              ).findOne({ filter: { id: savedId, customerId: id } }))
            )
              throw new ApiError({
                status: 'NOT_FOUND',
                reason: 'CRM_RECORD_NOT_FOUND',
                domain: 'crm',
                message: 'The requested record does not exist.',
              });
          },
          execute: (tx) =>
            new CrmService(tx, policies).saveContact(
              id,
              c.req.valid('json'),
              contactId,
            ),
        });
        c.header('Idempotency-Replayed', String(result.replayed));
        return c.json({ data: result.data });
      },
    );
  }
  router.post(
    '/customers/:id/followUps',
    async (c, next) => {
      await authorizeCrm(c.get('authz'), 'recordFollowUp');
      await next();
    },
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
      const policies = await authorizeCrm(c.get('authz'), 'recordFollowUp');
      const service = new CrmService(connection, policies);
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${c.get('auth')!.user.id}`,
        operation: `crm/${id}/followUps/new`,
        input: c.req.valid('json'),
        authorize: async () => {
          await service.get(id);
        },
        authorizeReplay: async (record) => {
          await service.get(id);
          const savedId = z.object({ id: z.string() }).parse(record).id;
          if (
            !(await scopedRepository(
              connection,
              policies,
              'crmFollowUps',
            ).findOne({ filter: { id: savedId, customerId: id } }))
          )
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'CRM_RECORD_NOT_FOUND',
              domain: 'crm',
              message: 'The requested record does not exist.',
            });
        },
        execute: (tx) =>
          new CrmService(tx, policies).addFollowUp(
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
