import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  defineRootRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
  ApiError,
  apiErrorHandler,
  executeIdempotentMutation,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  authorizeCrm,
  customerReads,
  scopedRepository,
} from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';
import { SalesService } from '../providers/sales.js';
import {
  CustomerFilesService,
  customerFileDisk,
  fileMissing,
} from '../providers/customer-files.js';
import { DOCX_MIME } from '../providers/quotation-renderer.js';
import { quotationTemplateRevision } from '../templates/quotation-v2.js';
type Env = AuthEnv & AuthorizationEnv;
const describe = (summary: string) =>
  describeRoute({
    tags: ['CRM documents'],
    summary,
    responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
  });
const header = z.object({ 'idempotency-key': z.string().min(1).max(128) });
const customerParams = z.object({ customerId: z.uuid() });
const quoteParams = customerParams.extend({
  opportunityId: z.uuid(),
  quoteId: z.uuid(),
});
const fileGuards = defineApiRoutes((app: Application) => {
  const r = new Hono<Env>();
  r.onError(apiErrorHandler);
  r.use(
    '/crmFileUploads/*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
  );
  return new Hono().route('/', r);
});
const contentGuard = defineRootRoutes((app: Application) => {
  const r = new Hono<Env>();
  r.onError(apiErrorHandler);
  const service = new CustomerFilesService(app);
  r.use(
    '/uploads/crmFiles/*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      const id = z
        .uuid()
        .safeParse(c.req.path.split('/').at(-1)?.split('.')[0]);
      if (!id.success) throw fileMissing();
      const file = await service.get(id.data);
      if (['removed', 'deleting'].includes(file.status)) throw fileMissing();
      if (file.customerId) {
        await new CrmService(
          service.connection,
          await authorizeCrm(c.get('authz'), 'viewCustomer'),
        ).get(file.customerId);
        if (file.status === 'document') {
          const document = await service.connection
            .repository('crmQuoteDocuments')
            .findOne({ filter: { fileId: file.id } });
          const policies = await customerReads(c.get('authz'), 'viewQuotes');
          const quote =
            document &&
            (await scopedRepository(
              service.connection,
              policies,
              'crmQuotes',
            ).findOne({
              filter: {
                id: z.string().parse(document.quoteId),
                customerId: file.customerId,
              },
            }));
          if (!quote) throw fileMissing();
          await new SalesService(service.connection, policies).quote(
            file.customerId,
            z.string().parse(quote.opportunityId),
            z.string().parse(quote.id),
          );
        }
      } else if (
        file.status !== 'staged' ||
        file.ownerId !== c.get('auth')!.user.id
      )
        throw fileMissing();
      await next();
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "sandbox; default-src 'none'");
      c.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
    },
  );
  return new Hono().route('/', r);
});
const nativeFiles = (disk: string) =>
  defineFileRepositoryApiRoutes<{
    id: string;
    upload: boolean;
  }>({
    principal: async (c) => {
      const context = c as import('hono').Context<Env>;
      let upload = false;
      try {
        await authorizeCrm(context.get('authz'), 'attachFile');
        upload = true;
      } catch {
        /* Read-only users may still read their own private staging metadata. */
      }
      return { id: context.get('auth')!.user.id, upload };
    },
    repositories: [
      {
        name: 'crmFileUploads',
        collection: 'crmFiles',
        connection: 'main',
        disk,
        accessPath: '/uploads/crmFiles',
        accessMode: 'stream',
        policy: (p) => ({
          read: {
            scope: { ownerId: p.id, status: 'staged', customerId: null },
            fields: [
              'id',
              'filename',
              'ext',
              'mimeType',
              'size',
              'createdAt',
              'updatedAt',
            ],
          },
          create: p.upload
            ? { scope: true, defaults: { ownerId: p.id, status: 'staged' } }
            : false,
          update: false,
          delete: false,
        }),
        actions: {
          findOne: {},
          findMany: { maxLimit: 100 },
          uploadOne: { maxSize: 5 * 1024 * 1024 },
          uploadMany: { maxSize: 5 * 1024 * 1024 },
        },
      },
    ],
  });
const businessFiles = defineApiRoutes((app: Application) => {
  const r = new Hono<Env>();
  r.onError(apiErrorHandler);
  const service = new CustomerFilesService(app);
  for (const path of ['/crmFiles/*', '/crmDocuments/*'])
    r.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
    );
  r.use('/crmDocuments/*', async (c, next) => {
    await c.get('authz').require({
      resource: { type: 'settings', id: 'crm.documents' },
      action: c.req.method === 'DELETE' ? 'cleanup' : 'read',
    });
    await next();
  });
  r.get(
    '/crmFiles/customers/:customerId',
    describe('List authorized customer attachments'),
    apiValidator('param', customerParams),
    apiValidator(
      'query',
      z.object({ page: z.coerce.number().int().positive().default(1) }),
    ),
    async (c) => {
      const { customerId } = c.req.valid('param');
      await new CrmService(
        service.connection,
        await authorizeCrm(c.get('authz'), 'viewCustomer'),
      ).get(customerId);
      return c.json(await service.list(customerId, c.req.valid('query').page));
    },
  );
  r.post(
    '/crmFiles/customers/:customerId',
    describe('Attach privately uploaded files to a customer'),
    apiValidator('param', customerParams),
    apiValidator('header', header),
    apiValidator(
      'json',
      z.strictObject({
        ids: z
          .array(z.uuid())
          .min(1)
          .max(10)
          .refine((ids) => new Set(ids).size === ids.length),
      }),
    ),
    async (c) => {
      const { customerId } = c.req.valid('param');
      const policies = await authorizeCrm(c.get('authz'), 'attachFile');
      const actor = c.get('auth')!.user.id;
      const input = c.req.valid('json');
      const result = await executeIdempotentMutation({
        connection: service.connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${actor}`,
        operation: `crmFiles/attach/${customerId}`,
        input,
        authorize: async () => {
          await new CrmService(service.connection, policies).get(customerId);
        },
        authorizeReplay: async () => {
          await new CrmService(service.connection, policies).get(customerId);
        },
        execute: async (tx) => {
          await new CrmService(tx, policies).get(customerId);
          return service.attach(tx, customerId, actor, input.ids);
        },
      });
      return c.json({ data: result.data });
    },
  );
  r.delete(
    '/crmFiles/customers/:customerId/:id',
    describe('Remove a customer requirement attachment'),
    apiValidator('param', customerParams.extend({ id: z.uuid() })),
    apiValidator('header', header),
    async (c) => {
      const input = c.req.valid('param');
      const policies = await authorizeCrm(c.get('authz'), 'removeFile');
      const actor = c.get('auth')!.user.id;
      const result = await executeIdempotentMutation({
        connection: service.connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${actor}`,
        operation: `crmFiles/remove/${input.id}`,
        input,
        authorize: async () => {
          await new CrmService(service.connection, policies).get(
            input.customerId,
          );
        },
        authorizeReplay: async () => {
          await new CrmService(service.connection, policies).get(
            input.customerId,
          );
        },
        execute: (tx) => service.remove(tx, input.customerId, input.id),
      });
      return c.json({ data: result.data });
    },
  );
  const quotePath = '/crmFiles/quotes/:customerId/:opportunityId/:quoteId';
  r.get(
    quotePath,
    describe('Read issued quotation document and generation eligibility'),
    apiValidator('param', quoteParams),
    async (c) => {
      const p = c.req.valid('param');
      await new SalesService(
        service.connection,
        await customerReads(c.get('authz'), 'viewQuotes'),
      ).quote(p.customerId, p.opportunityId, p.quoteId);
      const approval = await service.connection
        .repository('crmQuoteApprovals')
        .findOne({ filter: { quoteId: p.quoteId } });
      return c.json({
        data: {
          draft: !approval || approval.status === 'draft',
          confirmed: approval?.status === 'confirmed',
          document: await service.document(p.quoteId),
        },
      });
    },
  );
  r.get(
    `${quotePath}/draft`,
    describeRoute({
      tags: ['CRM documents'],
      summary: 'Download a preview of the current draft quotation',
      responses: {
        200: {
          description: 'English draft quotation',
          content: {
            [DOCX_MIME]: { schema: { type: 'string', format: 'binary' } },
          },
        },
        ...apiErrorResponses,
      },
    }),
    apiValidator('param', quoteParams),
    async (c) => {
      const input = c.req.valid('param');
      const bytes = await service.draftPreview(
        await customerReads(c.get('authz'), 'viewQuotes'),
        input,
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': DOCX_MIME,
          'Content-Disposition': `attachment; filename="draft-quotation-${input.quoteId}.docx"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
  );
  r.post(
    quotePath,
    describe('Issue a fixed-template DOCX from a confirmed quotation snapshot'),
    apiValidator('param', quoteParams),
    apiValidator('header', header),
    async (c) => {
      const input = c.req.valid('param');
      const policies = await authorizeCrm(c.get('authz'), 'issueQuote');
      const actor = c.get('auth')!.user.id;
      const result = await executeIdempotentMutation({
        connection: service.connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${actor}`,
        operation: `crmFiles/generate/${input.quoteId}`,
        input,
        authorize: async () => {
          await new SalesService(service.connection, policies).quote(
            input.customerId,
            input.opportunityId,
            input.quoteId,
          );
        },
        authorizeReplay: async () => {
          await new SalesService(service.connection, policies).quote(
            input.customerId,
            input.opportunityId,
            input.quoteId,
          );
        },
        execute: async (tx) => {
          const sales = new SalesService(tx, policies);
          await sales.quote(
            input.customerId,
            input.opportunityId,
            input.quoteId,
          );
          const customer = await new CrmService(tx, policies).get(
            input.customerId,
          );
          const opportunity = await sales.opportunity(
            input.customerId,
            input.opportunityId,
          );
          return service.generate(
            tx,
            input.quoteId,
            input.customerId,
            actor,
            z.string().parse(customer.name),
            z.string().parse(opportunity.name),
          );
        },
      });
      return c.json({ data: result.data });
    },
  );
  r.get(
    '/crmDocuments/settings',
    describe('Read used document template and storage policy'),
    async (c) =>
      c.json({
        data: {
          template: {
            id: `quotation-v${quotationTemplateRevision}`,
            revision: quotationTemplateRevision,
            format: 'docx',
            language: 'en-US',
          },
          storage: {
            disk: service.disk,
            access: 'authenticated',
            uploadMaxBytes: 5 * 1024 * 1024,
            attachMaxFiles: 10,
            orphanMinimumAgeHours: 24,
          },
        },
      }),
  );
  r.get(
    '/crmDocuments/orphans',
    describe('List unlinked uploads eligible for cleanup'),
    apiValidator(
      'query',
      z.object({
        page: z.coerce.number().int().positive().default(1),
        status: z.enum(['staged', 'deleting']).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await service.orphans(
          c.req.valid('query').page,
          c.req.valid('query').status,
        ),
      ),
  );
  r.delete(
    '/crmDocuments/orphans/:id',
    describe('Claim and clean an old unlinked upload'),
    apiValidator('param', z.object({ id: z.uuid() })),
    apiValidator('header', header),
    async (c) => {
      const input = c.req.valid('param');
      const authorize = async () => {
        await c.get('authz').require({
          resource: { type: 'settings', id: 'crm.documents' },
          action: 'cleanup',
        });
      };
      try {
        const claim = await executeIdempotentMutation({
          connection: service.connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crmFiles/cleanup/${input.id}`,
          input,
          authorize,
          authorizeReplay: authorize,
          execute: (tx) => service.claimCleanup(tx, input.id),
        });
        return c.json({ data: await service.finishCleanup(claim.data) });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError({
          status: 'INTERNAL',
          reason: 'FILE_CLEANUP_FAILED',
          domain: 'crm',
          message: 'File cleanup failed. Retry the claimed file.',
        });
      }
    },
  );
  return new Hono().route('/', r);
});
async function nativeFileRouter(app: Application, scope: 'api' | 'root') {
  const router = new Hono();
  for (const route of nativeFiles(customerFileDisk(app))) {
    if (route.scope === scope) {
      router.route('/', await route.createRouter(app));
    }
  }
  return router;
}

export default [
  fileGuards,
  contentGuard,
  defineApiRoutes((app: Application) => nativeFileRouter(app, 'api')),
  defineRootRoutes((app: Application) => nativeFileRouter(app, 'root')),
  businessFiles,
];
