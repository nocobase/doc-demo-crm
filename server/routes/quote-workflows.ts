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
} from '@nocobase/app-server/router';
import {
  lifecycleDescriptionViewAsync,
  ParameterConfigurationError,
} from '@nocobase/lifecycle';
import { Hono } from 'hono';
import { z } from 'zod';
import { quoteApprovalServiceToken } from '../providers/quote-approvals.js';
import { quoteApprovalParameters } from '../lifecycles/quote-approval.js';
export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const service = app.container.resolve(quoteApprovalServiceToken);
  const connection = app.container.resolve(databaseManagerToken).connection();
  router.onError((error, c) =>
    apiErrorHandler(
      error instanceof ParameterConfigurationError
        ? new ApiError({
            status:
              error.code === 'CONFIGURATION_CONFLICT'
                ? 'ABORTED'
                : 'INVALID_ARGUMENT',
            reason: error.code,
            domain: 'crm',
            message: error.message,
          })
        : error,
      c,
    ),
  );
  for (const path of [
    '/definition',
    '/parameters',
    '/executions',
    '/executions/*',
  ])
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
      async (c, next) => {
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: 'crm.workflow' },
          action: c.req.method === 'GET' ? 'read' : 'configure',
        });
        if (decision.effect === 'deny')
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            reason: 'WORKFLOW_ACCESS_DENIED',
            domain: 'crm',
            message: 'Workflow administration access is required.',
          });
        await next();
      },
    );
  const describe = (summary: string) =>
    describeRoute({
      tags: ['CRM workflows'],
      summary,
      responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
    });
  router.get(
    '/definition',
    describe('Read quotation process definition'),
    async (c) =>
      c.json({
        data: {
          description: await lifecycleDescriptionViewAsync(
            service.runtime,
            'crmQuoteApprovals',
            { record: null, transactionHandle: undefined },
          ),
          parameters: (await service.parameters.read('crm', 'discount')) ?? {
            revision: 0,
            values: { thresholdPercent: 10 },
          },
        },
      }),
  );
  router.put(
    '/parameters',
    describe('Configure quotation discount threshold'),
    apiValidator(
      'json',
      z.strictObject({
        thresholdPercent: z.number().min(0).max(100),
        expectedRevision: z.number().int().nonnegative(),
        requestId: z.string().min(1).max(128),
      }),
    ),
    async (c) => {
      const input = c.req.valid('json');
      const data = await service.parameters.save({
        scope: 'crm',
        group: quoteApprovalParameters,
        values: { thresholdPercent: input.thresholdPercent },
        expectedRevision: input.expectedRevision,
        requestId: input.requestId,
        actorId: c.get('auth')!.user.id,
        at: new Date().toISOString(),
      });
      return c.json({ data });
    },
  );
  router.get(
    '/executions',
    describe('List quotation process executions'),
    apiValidator(
      'query',
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        order: z.enum(['newest', 'oldest']).default('newest'),
      }),
    ),
    async (c) => {
      const { page, order } = c.req.valid('query');
      const repository = connection.repository('crmQuoteApprovals');
      return c.json({
        data: await repository.findMany({
          select: (s) =>
            s.fields(
              'id',
              'customerId',
              'opportunityId',
              'quoteId',
              'status',
              'createdAt',
              'applicantId',
              'snapshot',
            ),
          limit: 20,
          offset: (page - 1) * 20,
          sort: (s) =>
            order === 'newest'
              ? [s.field('createdAt').desc(), s.field('id').desc()]
              : [s.field('createdAt').asc(), s.field('id').asc()],
        }),
        meta: { page, pageSize: 20, total: await repository.count() },
      });
    },
  );
  router.get(
    '/executions/:id',
    describe('Read quotation process execution history'),
    apiValidator('param', z.object({ id: z.uuid() })),
    async (c) =>
      c.json({
        data: await service.runtime.view(
          'crmQuoteApprovals',
          c.req.valid('param').id,
          { id: c.get('auth')!.user.id },
        ),
      }),
  );
  return new Hono().route('/crmWorkflows', router);
});
