import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationContext,
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
  CreateImportBatchInput,
  ImportBatchSummary,
  ImportRowError,
  crmImportsToken,
} from '../providers/crm-imports.js';
import { IMPORT_CSV_TEMPLATE } from '../providers/crm-intake.js';
import { authorizeCrm } from '../providers/crm-permissions.js';

const BatchParams = z.object({ id: z.uuid() });
const Header = z.object({ 'idempotency-key': z.string() });
const BatchDetail = ImportBatchSummary.extend({
  errors: z.array(ImportRowError),
});

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  const imports = app.container.resolve(crmImportsToken);
  router.onError(apiErrorHandler);

  for (const path of ['/batches', '/batches/*', '/template.csv']) {
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
    );
  }

  const canViewAllBatches = async (authzContext: AuthorizationContext) => {
    const decision = await authzContext.authorize({
      resource: { type: 'composite', id: 'crm.records' },
      action: 'assignOwner',
    });
    return decision.effect !== 'deny';
  };

  router.get(
    '/template.csv',
    describeRoute({
      tags: ['CRM imports'],
      summary: 'Download customer import CSV template',
      responses: { ...apiErrorResponses },
    }),
    async (c) => {
      await authorizeCrm(c.get('authz'), 'view');
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header(
        'Content-Disposition',
        'attachment; filename="crm-customers-template.csv"',
      );
      c.header('Cache-Control', 'private, no-store');
      return c.body(IMPORT_CSV_TEMPLATE);
    },
  );

  router.get(
    '/batches',
    describeRoute({
      tags: ['CRM imports'],
      summary: 'List bulk customer import batches',
      responses: {
        200: listResponse(ImportBatchSummary),
        ...apiErrorResponses,
      },
    }),
    async (c) => {
      await authorizeCrm(c.get('authz'), 'view');
      const data = await imports.listBatches(
        c.get('auth')!.user.id,
        await canViewAllBatches(c.get('authz')),
      );
      return c.json({ data, meta: { total: data.length } });
    },
  );

  router.post(
    '/batches',
    describeRoute({
      tags: ['CRM imports'],
      summary: 'Submit a bulk customer and contact CSV import job',
      responses: {
        202: dataResponse(ImportBatchSummary),
        ...apiErrorResponses,
      },
    }),
    apiValidator('header', Header),
    apiValidator('json', CreateImportBatchInput),
    async (c) => {
      const input = c.req.valid('json');
      await authorizeCrm(c.get('authz'), 'createCustomer');
      if (input.conflictMode === 'update') {
        await authorizeCrm(c.get('authz'), 'editCustomer');
      }
      const user = c.get('auth')!.user;
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${user.id}`,
        operation: 'crm/imports/create',
        input,
        authorize: async () => {
          await authorizeCrm(c.get('authz'), 'createCustomer');
        },
        authorizeReplay: async () => {
          await authorizeCrm(c.get('authz'), 'view');
        },
        execute: (tx) =>
          imports.createBatchRecord(
            tx,
            { id: user.id, name: user.name },
            input,
          ),
      });
      const batch = result.replayed
        ? result.data
        : await imports.enqueueBatch(result.data.id);
      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json({ data: batch }, 202);
    },
  );

  router.get(
    '/batches/:id',
    describeRoute({
      tags: ['CRM imports'],
      summary: 'Get import batch progress and row error report',
      responses: { 200: dataResponse(BatchDetail), ...apiErrorResponses },
    }),
    apiValidator('param', BatchParams),
    async (c) => {
      await authorizeCrm(c.get('authz'), 'view');
      const data = await imports.getBatch(
        c.get('auth')!.user.id,
        await canViewAllBatches(c.get('authz')),
        c.req.valid('param').id,
      );
      return c.json({ data });
    },
  );

  router.get(
    '/batches/:id/errors.csv',
    describeRoute({
      tags: ['CRM imports'],
      summary: 'Download failed import rows as CSV',
      responses: { ...apiErrorResponses },
    }),
    apiValidator('param', BatchParams),
    async (c) => {
      await authorizeCrm(c.get('authz'), 'view');
      const report = await imports.errorsCsv(
        c.get('auth')!.user.id,
        await canViewAllBatches(c.get('authz')),
        c.req.valid('param').id,
      );
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header(
        'Content-Disposition',
        `attachment; filename="${report.fileName}"`,
      );
      c.header('Cache-Control', 'private, no-store');
      return c.body(report.csv);
    },
  );

  return new Hono().route('/crmImports', router);
});
