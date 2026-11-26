import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { userTaskServiceToken } from '@nocobase/app-plugin-task-center/server';
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
} from '@nocobase/app-server/router';
import { LifecycleError, type JsonObject } from '@nocobase/lifecycle';
import {
  ApprovalError,
  rowsOf,
  APPROVAL_COLLECTIONS,
} from '@nocobase/app-plugin-approval/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { authorizeCrm } from '../providers/crm-permissions.js';
import { SalesService } from '../providers/sales.js';
import { lockQuote } from '../providers/quote-lock.js';
import { quoteApprovalServiceToken } from '../providers/quote-approvals.js';

const Params = z.object({
  customerId: z.uuid(),
  opportunityId: z.uuid(),
  quoteId: z.uuid(),
});
const Header = z.object({ 'idempotency-key': z.string().min(1).max(128) });
const Submit = z.strictObject({
  reviewerId: z.string().min(1).max(128).nullable().default(null),
});
const Withdraw = z.strictObject({
  expectVersion: z.number().int().nonnegative(),
});
const Decision = z.strictObject({
  taskId: z.string().min(1),
  action: z.enum(['approve', 'reject', 'return']),
  contentHash: z.string().min(1),
  comment: z.string().trim().max(2000).default(''),
});
const base = '/quotes/:customerId/:opportunityId/:quoteId';
const lifecycle = 'crmQuoteApprovals';
const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    reason: 'APPROVAL_DENIED',
    domain: 'crm',
    message: 'This approval operation is not allowed.',
  });
export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  const service = app.container.resolve(quoteApprovalServiceToken);
  router.onError((error, c) => {
    if (error instanceof LifecycleError || error instanceof ApprovalError)
      return apiErrorHandler(
        new ApiError({
          status: 'FAILED_PRECONDITION',
          reason: error.code,
          domain: 'crm',
          message: error.message,
        }),
        c,
      );
    return apiErrorHandler(error, c);
  });
  for (const path of ['/quotes/*', '/reviewers', '/tasks/*'])
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
    );
  const describe = (summary: string) =>
    describeRoute({
      tags: ['CRM approvals'],
      summary,
      responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
    });
  router.get(
    '/tasks/:id',
    describe('Resolve an owned quotation task'),
    apiValidator('param', z.object({ id: z.string().min(1).max(128) })),
    async (c) => {
      const actor = c.get('auth')!.user.id;
      const entry = await app.container
        .resolve(userTaskServiceToken)
        .get(actor, c.req.valid('param').id);
      const task =
        entry?.sourceType === 'approval.task'
          ? await rowsOf(connection).get(
              APPROVAL_COLLECTIONS.tasks,
              entry.sourceKey,
            )
          : undefined;
      if (!task || task.source !== lifecycle)
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'TASK_NOT_FOUND',
          domain: 'crm',
          message: 'Quotation task not found.',
        });
      const record = await connection
        .repository(lifecycle)
        .findOne({ filter: { id: String(task.recordId) } });
      if (!record) throw denied();
      await new SalesService(
        connection,
        await authorizeCrm(c.get('authz'), 'view'),
      ).quote(
        typeof record.customerId === 'string' ? record.customerId : '',
        typeof record.opportunityId === 'string' ? record.opportunityId : '',
        typeof record.quoteId === 'string' ? record.quoteId : '',
      );
      return c.json({
        data: {
          customerId: record.customerId,
          opportunityId: record.opportunityId,
          quoteId: record.quoteId,
        },
      });
    },
  );
  router.get(
    '/reviewers',
    describe('List eligible quotation reviewers'),
    async (c) => {
      await authorizeCrm(c.get('authz'), 'editQuote');
      return c.json({
        data: (await service.reviewers()).filter(
          (person) => person.id !== c.get('auth')!.user.id,
        ),
      });
    },
  );
  router.get(
    base,
    describe('Read quotation approval and offered actions'),
    apiValidator('param', Params),
    async (c) => {
      const { customerId, opportunityId, quoteId } = c.req.valid('param');
      const actor = { id: c.get('auth')!.user.id };
      await new SalesService(
        connection,
        await authorizeCrm(c.get('authz'), 'view'),
      ).quote(customerId, opportunityId, quoteId);
      const record = await connection
        .repository(lifecycle)
        .findOne({ filter: { quoteId } });
      const definition = record
        ? service.runtime.recordLifecycle(lifecycle, { ...record, id: quoteId })
        : lifecycle;
      const frozen = record
        ? await service.parameters.snapshot('crm', definition, quoteId)
        : undefined;
      const configured = await service.parameters.readConfiguration(
        'crm',
        definition,
      );
      const thresholdPercent = Number(
        frozen?.values.thresholdPercent ??
          configured?.values.thresholdPercent ??
          10,
      );
      if (!record)
        return c.json({
          data: {
            status: 'draft',
            thresholdPercent,
            view: null,
            runs: [],
            actions: [],
          },
        });
      const [view, runs, actions] = await Promise.all([
        service.runtime.view(definition, quoteId, actor),
        service.approvals.runViewsFor(definition, quoteId),
        service.approvals.actionsFor(definition, quoteId, actor),
      ]);
      const people: Record<string, string> = {};
      const ids = new Set<string>([
        typeof record.applicantId === 'string' ? record.applicantId : '',
        typeof record.reviewerId === 'string' ? record.reviewerId : '',
      ]);
      for (const run of runs)
        for (const task of run.tasks) ids.add(task.assigneeId);
      const users = app.container.resolve(userManagementServiceToken);
      await Promise.all(
        [...ids].filter(Boolean).map(async (id) => {
          try {
            people[id] = (await users.get(id)).name;
          } catch {
            /* Retain history if a user was removed. */
          }
        }),
      );
      return c.json({
        data: {
          status: record.status,
          thresholdPercent,
          view,
          runs,
          actions,
          people,
        },
      });
    },
  );
  router.post(
    `${base}/submit`,
    describe('Submit a saved quotation'),
    apiValidator('param', Params),
    apiValidator('header', Header),
    apiValidator('json', Submit),
    async (c) => {
      const { customerId, opportunityId, quoteId } = c.req.valid('param');
      const input = c.req.valid('json');
      const actor = { id: c.get('auth')!.user.id };
      const policies = await authorizeCrm(c.get('authz'), 'editQuote');
      const check = () =>
        new SalesService(connection, policies).quote(
          customerId,
          opportunityId,
          quoteId,
        );
      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${actor.id}`,
        operation: `crmApproval/submit/${quoteId}`,
        input,
        authorize: async () => {
          await check();
        },
        authorizeReplay: async () => {
          await check();
        },
        execute: async (tx) => {
          await lockQuote(tx, quoteId);
          const quote = await new SalesService(tx, policies).quote(
            customerId,
            opportunityId,
            quoteId,
          );
          const maxDiscountBasisPoints = Math.max(
            ...quote.lines.map((line) => Math.round(line.discount * 100)),
          );
          const existing = await tx
            .repository(lifecycle)
            .findOne({ filter: { quoteId } });
          const definition = existing
            ? service.runtime.recordLifecycle(lifecycle, {
                ...existing,
                id: quoteId,
              })
            : lifecycle;
          const frozen = await service.parameters.snapshot(
            'crm',
            definition,
            quoteId,
            tx,
          );
          const config = await service.parameters.readConfiguration(
            'crm',
            definition,
            tx,
          );
          const thresholdBasisPoints = Math.round(
            Number(
              frozen?.values?.thresholdPercent ??
                config?.values.thresholdPercent ??
                10,
            ) * 100,
          );
          if (
            maxDiscountBasisPoints > thresholdBasisPoints &&
            !(await service.reviewers(tx)).some(
              (person) =>
                person.id === input.reviewerId && person.id !== actor.id,
            )
          )
            throw denied();
          const snapshot = JSON.parse(JSON.stringify(quote)) as JsonObject;
          const values = {
            snapshot,
            reviewerId: input.reviewerId,
            maxDiscountBasisPoints,
            thresholdBasisPoints,
          };
          if (!existing)
            await service.runtime.create(
              lifecycle,
              {
                id: quoteId,
                quoteId,
                customerId,
                opportunityId,
                applicantId: actor.id,
                createdAt: new Date().toISOString(),
                ...values,
              },
              { actor, transaction: tx },
            );
          else
            await service.runtime.fire(definition, quoteId, 'revise', {
              actor,
              input: values,
              transaction: tx,
              requestId: `${c.req.valid('header')['idempotency-key']}:revise`,
            });
          const submitted = await service.runtime.fire(
            definition,
            quoteId,
            'submit',
            {
              actor,
              manual: true,
              transaction: tx,
              requestId: c.req.valid('header')['idempotency-key'],
            },
          );
          return { status: submitted.record.status, id: quoteId };
        },
      });
      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json({ data: result.data });
    },
  );
  router.post(
    `${base}/withdraw`,
    describe('Withdraw a pending quotation'),
    apiValidator('param', Params),
    apiValidator('header', Header),
    apiValidator('json', Withdraw),
    async (c) => {
      const { customerId, opportunityId, quoteId } = c.req.valid('param');
      await new SalesService(
        connection,
        await authorizeCrm(c.get('authz'), 'editQuote'),
      ).quote(customerId, opportunityId, quoteId);
      const result = await service.runtime.fire(
        await service.runtime.boundLifecycle(lifecycle, quoteId),
        quoteId,
        'withdraw',
        {
          actor: { id: c.get('auth')!.user.id },
          manual: true,
          expect: { version: c.req.valid('json').expectVersion },
          requestId: c.req.valid('header')['idempotency-key'],
        },
      );
      return c.json({ data: result });
    },
  );
  router.post(
    `${base}/actions`,
    describe('Decide an offered quotation approval task'),
    apiValidator('param', Params),
    apiValidator('header', Header),
    apiValidator('json', Decision),
    async (c) => {
      const { customerId, opportunityId, quoteId } = c.req.valid('param');
      const actor = { id: c.get('auth')!.user.id };
      await new SalesService(
        connection,
        await authorizeCrm(c.get('authz'), 'editQuote'),
      ).quote(customerId, opportunityId, quoteId);
      const input = c.req.valid('json');
      if (!(await service.reviewers()).some((person) => person.id === actor.id))
        throw denied();
      const tasks = await service.approvals.tasksFor(
        await service.runtime.boundLifecycle(lifecycle, quoteId),
        quoteId,
      );
      if (!tasks.some((task) => task.id === input.taskId)) throw denied();
      const result = await service.approvals.perform({
        action: input.action,
        target: { taskId: input.taskId },
        actor,
        comment: input.comment,
        contentHash: input.contentHash,
        requestId: c.req.valid('header')['idempotency-key'],
        ...(input.action === 'return' ? { input: { to: 'revision' } } : {}),
      });
      return c.json({ data: result });
    },
  );
  return new Hono().route('/crmApprovals', router);
});
