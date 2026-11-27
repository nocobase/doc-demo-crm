import { SalesService } from '../providers/sales.js';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineApiRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
  apiErrorHandler,
  ApiError,
  executeIdempotentMutation,
} from '@nocobase/app-server/router';
import {
  authorizeCrm,
  customerReads,
  scopedRepository,
} from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';
const params = z.object({ customerId: z.uuid() });
const header = z.object({ 'idempotency-key': z.string().min(1).max(128) });
const input = z
  .strictObject({
    title: z.string().trim().min(1).max(160),
    kind: z.enum(['followUp', 'quoteExpiry']),
    dueAt: z.iso.datetime({ offset: true }),
    quoteId: z.uuid().optional(),
  })
  .superRefine((v, c) => {
    if ((v.kind === 'quoteExpiry') !== !!v.quoteId)
      c.addIssue({
        code: 'custom',
        path: ['quoteId'],
        message: 'Select a quotation only for a quotation reminder.',
      });
  });
const describe = (summary: string) =>
  describeRoute({
    tags: ['CRM reminders'],
    summary,
    responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
  });
export default defineApiRoutes((app: Application) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>();
  r.onError(apiErrorHandler);
  r.use(
    '/crmReminders/*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
  );
  const connection = app.container.resolve(databaseManagerToken).connection();
  r.get(
    '/crmReminders/customers/:customerId',
    describe('Read authorized customer reminder plans'),
    apiValidator('param', params),
    apiValidator(
      'query',
      z.object({
        page: z.coerce.number().int().positive().max(100000).default(1),
      }),
    ),
    async (c) => {
      const customerId = c.req.valid('param').customerId;
      await new CrmService(
        connection,
        await authorizeCrm(c.get('authz'), 'viewCustomer'),
      ).get(customerId);
      const page = c.req.valid('query').page;
      const repo = connection.repository('crmReminders');
      const filter = { customerId };
      const [data, total] = await Promise.all([
        repo.findMany({
          filter,
          limit: 20,
          offset: (page - 1) * 20,
          sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
        }),
        repo.count({ filter }),
      ]);
      return c.json({ data, meta: { total, page, pageSize: 20 } });
    },
  );
  r.get(
    '/crmReminders/customers/:customerId/quotes',
    describe('List confirmed quotations available for a response deadline'),
    apiValidator('param', params),
    async (c) => {
      const customerId = c.req.valid('param').customerId;
      const policies = await customerReads(c.get('authz'), 'viewQuotes');
      await new CrmService(connection, policies).get(customerId);
      const quotes = await scopedRepository(
        connection,
        policies,
        'crmQuotes',
      ).findMany({ filter: { customerId }, limit: 100 });
      const data = [];
      for (const quote of quotes) {
        const opportunity = await scopedRepository(
          connection,
          policies,
          'crmOpportunities',
        ).findOne({
          filter: { id: z.string().parse(quote.opportunityId), customerId },
        });
        if (!opportunity) continue;
        const approval = await connection
          .repository('crmQuoteApprovals')
          .findOne({
            filter: {
              quoteId: z.string().parse(quote.id),
              status: 'confirmed',
            },
          });
        if (approval) data.push({ id: quote.id, name: quote.name });
      }
      return c.json({ data });
    },
  );
  r.post(
    '/crmReminders/customers/:customerId',
    describe('Schedule one follow-up or quotation response reminder'),
    apiValidator('param', params),
    apiValidator('header', header),
    apiValidator('json', input),
    async (c) => {
      const { customerId } = c.req.valid('param');
      const values = c.req.valid('json');
      const policies = await authorizeCrm(c.get('authz'), 'scheduleReminder');
      const quotePolicies = values.quoteId
        ? await customerReads(c.get('authz'), 'viewQuotes')
        : undefined;
      const actor = c.get('auth')!.user.id;
      const authorize = async () => {
        await new CrmService(connection, policies).get(customerId);
      };
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${actor}`,
        operation: `crmReminders/create/${customerId}`,
        input: values,
        authorize,
        authorizeReplay: authorize,
        execute: async (tx) => {
          await new CrmService(tx, policies).get(customerId);
          let opportunityId = null;
          if (values.quoteId && quotePolicies) {
            const quote = await scopedRepository(
              tx,
              quotePolicies,
              'crmQuotes',
            ).findOne({ filter: { id: values.quoteId, customerId } });
            const approval = await tx.repository('crmQuoteApprovals').findOne({
              filter: { quoteId: values.quoteId, status: 'confirmed' },
            });
            if (!quote || !approval)
              throw new ApiError({
                status: 'FAILED_PRECONDITION',
                reason: 'CRM_CONFIRMED_QUOTE_REQUIRED',
                domain: 'crm',
                message: 'Select a confirmed quotation from this customer.',
              });
            await new SalesService(tx, quotePolicies).opportunity(
              customerId,
              z.string().parse(quote.opportunityId),
            );
            opportunityId = quote.opportunityId;
          }
          const now = new Date().toISOString();
          const saved = await tx.repository('crmReminders').createOne({
            values: {
              id: randomUUID(),
              customerId,
              kind: values.kind,
              title: values.title,
              dueAt: new Date(values.dueAt).toISOString(),
              quoteId: values.quoteId ?? null,
              opportunityId,
              status: 'pending',
              createdBy: actor,
              createdAt: now,
              updatedAt: now,
            },
          });
          return saved.record;
        },
      });
      return c.json({ data: result.data });
    },
  );
  r.post(
    '/crmReminders/customers/:customerId/:id/:action',
    describe('Complete or cancel an authorized reminder plan'),
    apiValidator(
      'param',
      params.extend({ id: z.uuid(), action: z.enum(['complete', 'cancel']) }),
    ),
    apiValidator('header', header),
    async (c) => {
      const values = c.req.valid('param');
      const policies = await authorizeCrm(
        c.get('authz'),
        values.action === 'complete' ? 'completeReminder' : 'cancelReminder',
      );
      const authorize = async () => {
        await new CrmService(connection, policies).get(values.customerId);
      };
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${c.get('auth')!.user.id}`,
        operation: `crmReminders/${values.action}/${values.id}`,
        input: values,
        authorize,
        authorizeReplay: authorize,
        execute: async (tx) => {
          await new CrmService(tx, policies).get(values.customerId);
          const row = await tx.repository('crmReminders').findOne({
            filter: { id: values.id, customerId: values.customerId },
          });
          if (!row)
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'CRM_REMINDER_NOT_FOUND',
              domain: 'crm',
              message: 'Reminder not found.',
            });
          if (!['pending', 'notified'].includes(z.string().parse(row.status)))
            return row;
          const saved = await tx.repository('crmReminders').updateOne({
            filter: { id: values.id },
            values: {
              status: values.action === 'complete' ? 'done' : 'cancelled',
              updatedAt: new Date().toISOString(),
            },
          });
          return saved.record;
        },
      });
      return c.json({ data: result.data });
    },
  );
  return new Hono().route('/', r);
});
