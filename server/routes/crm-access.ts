import { crmOperations, type CrmOperation } from '../crm-operations.js';
import {
  crmNotificationsToken,
  enqueueCrmNotification,
  eventIdentity,
} from '../providers/crm-notifications.js';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
  type AuthorizationContext,
} from '@nocobase/app-plugin-authorization/server';
import { validateDataScopeRule } from '@nocobase/app-plugin-authorization/server/extension';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { selection } from '@nocobase/authorization/core';
import { type SharingRulesAuthorizationApi } from '@nocobase/authorization/sharing-rules';
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
import { Hono } from 'hono';
import { z } from 'zod';
import {
  authorizeCrm,
  crmRoleMembers,
  crmCustomers,
  crmContacts,
  crmFollowUps,
  crmOpportunities,
  crmQuotes,
  scopedRepository,
} from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';

const sharedResources = [
  [crmCustomers, ['customers']],
  [crmContacts, ['contacts']],
  [crmFollowUps, ['followUps']],
  [crmOpportunities, ['opportunities']],
  [crmQuotes, ['quotes', 'lines']],
] as const;
const User = z.object({ id: z.string(), name: z.string() });
const Access = z.object({
  shared: z.boolean(),
  canAssign: z.boolean(),
  canShare: z.boolean(),
  actions: z.record(z.string(), z.boolean()),
  edit: z.boolean(),
  manage: z.boolean(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  shares: z.array(z.object({ userId: z.string(), name: z.string() })),
  users: z.array(User),
});
const Global = z.object({
  createCustomer: z.boolean(),
});
const Params = z.object({ id: z.uuid() });
const Header = z.object({ 'idempotency-key': z.string() });
const Owner = z.strictObject({
  ownerId: z.string().min(1).max(128).nullable(),
});
const Shares = z.strictObject({
  userIds: z
    .array(z.string().min(1).max(128))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
const forbidden = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    reason: 'CRM_ACCESS_DENIED',
    domain: 'crm',
    message: 'This operation is not allowed.',
  });

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const authz = app.container.resolve(authorizationToken);
  const connection = app.container.resolve(databaseManagerToken).connection();
  const users = app.container.resolve(userManagementServiceToken);
  const rules = (
    authz as typeof authz & SharingRulesAuthorizationApi<DatabaseConnection>
  ).sharingRules;
  router.onError(apiErrorHandler);
  for (const path of [
    '/access',
    '/customers/:id/access',
    '/customers/:id/owner',
    '/customers/:id/shares',
  ])
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      authz.middleware(),
    );
  const eligible = (tx = connection) =>
    crmRoleMembers(app, tx, ['viewCustomer']);
  const may = async (
    context: AuthorizationContext,
    operation: CrmOperation,
    id?: string,
  ) => {
    const decision = await context.authorize(crmOperations[operation]);
    if (decision.effect === 'deny' || !decision.conditions?.database)
      return false;
    if (!id) return true;
    const policy = decision.conditions.database.crmCustomers;
    if (!policy) return false;
    return Boolean(
      await connection
        .repository('crmCustomers')
        .withPolicy(policy)
        .findOne({ filter: { id } }),
    );
  };
  const key = (id: string, resource = 'crm.customers') =>
    `${resource}.${id}.read`;
  const inspect = async (context: AuthorizationContext, id: string) => {
    const customer = await new CrmService(
      connection,
      await authorizeCrm(context, 'viewCustomer'),
    ).get(id);
    const actions = Object.fromEntries(
      await Promise.all(
        (
          [
            'attachFile',
            'removeFile',
            'scheduleReminder',
            'completeReminder',
            'cancelReminder',
            'useAssistant',
            'issueQuote',
            'submitQuote',
            'withdrawQuote',
            'approveQuote',
            'rejectQuote',
            'returnQuote',
            'editCustomer',
            'addContact',
            'editContact',
            'recordFollowUp',
            'createOpportunity',
            'editOpportunity',
            'createQuote',
            'editQuote',
            'assignOwner',
            'shareCustomer',
          ] as const
        ).map(
          async (action) => [action, await may(context, action, id)] as const,
        ),
      ),
    );
    const {
      assignOwner: canAssign,
      shareCustomer: canShare,
      editCustomer: edit,
    } = actions;
    const manage = canAssign || canShare;
    const [options, rule] = await Promise.all([
      manage ? eligible() : Promise.resolve([]),
      rules.get(key(id)),
    ]);
    const ownerId =
      typeof customer.ownerId === 'string' ? customer.ownerId : null;
    let ownerName: string | null = null;
    if (ownerId) {
      try {
        ownerName = (await users.get(ownerId)).name;
      } catch {
        /* Historical or removed owner is shown by id. */
      }
    }
    const shares = await Promise.all(
      (manage ? (rule?.subjects ?? []) : [])
        .filter((s) => s.type === 'user')
        .map(async (subject) => {
          let name = subject.id;
          try {
            name = (await users.get(subject.id)).name;
          } catch {
            /* Retain a removable reference to a deleted user. */
          }
          return { userId: subject.id, name };
        }),
    );
    const shared = Boolean(
      rule?.subjects?.some(
        (subject) =>
          subject.type === 'user' &&
          subject.id === context.identity.principal.id,
      ),
    );
    return {
      shared,
      canAssign,
      canShare,
      actions,
      edit,
      manage,
      ownerId,
      ownerName,
      shares,
      users: options,
    };
  };
  router.get(
    '/access',
    describeRoute({
      tags: ['CRM access'],
      summary: 'Read CRM action availability',
      responses: { 200: dataResponse(Global), ...apiErrorResponses },
    }),
    async (c) =>
      c.json({
        data: {
          createCustomer: await may(c.get('authz'), 'createCustomer'),
        },
      }),
  );
  router.get(
    '/customers/:id/access',
    describeRoute({
      tags: ['CRM access'],
      summary: 'Read customer access and owner',
      responses: { 200: dataResponse(Access), ...apiErrorResponses },
    }),
    apiValidator('param', Params),
    async (c) =>
      c.json({ data: await inspect(c.get('authz'), c.req.valid('param').id) }),
  );
  for (const kind of ['owner', 'shares'] as const) {
    router.put(
      `/customers/:id/${kind}`,
      describeRoute({
        tags: ['CRM access'],
        summary:
          kind === 'owner'
            ? 'Assign customer owner'
            : 'Replace read-only customer shares',
        responses: {
          200: dataResponse(z.object({ id: z.string() })),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', Params),
      apiValidator('header', Header),
      apiValidator('json', kind === 'owner' ? Owner : Shares),
      async (c) => {
        const { id } = c.req.valid('param');
        const input = c.req.valid('json');
        const policies = await authorizeCrm(
          c.get('authz'),
          kind === 'owner' ? 'assignOwner' : 'shareCustomer',
        );
        const assertAccess = async () => {
          if (
            !(await scopedRepository(
              connection,
              policies,
              'crmCustomers',
            ).findOne({ filter: { id } }))
          )
            throw forbidden();
        };
        const result = await executeIdempotentMutation({
          connection,
          key: c.req.valid('header')['idempotency-key'],
          principal: `${app.appName}:${c.get('auth')!.user.id}`,
          operation: `crm/access/${id}/${kind}`,
          input,
          authorize: assertAccess,
          authorizeReplay: assertAccess,
          execute: async (tx) => {
            const allowed = await eligible(tx);
            if (kind === 'owner') {
              const { ownerId } = Owner.parse(input);
              if (
                ownerId !== null &&
                !allowed.some((user) => user.id === ownerId)
              )
                throw new ApiError({
                  status: 'INVALID_ARGUMENT',
                  reason: 'CRM_USER_NOT_ELIGIBLE',
                  domain: 'crm',
                  message: 'Select an active CRM user with customer access.',
                });
              const previous = await scopedRepository(
                tx,
                policies,
                'crmCustomers',
              ).findOne({ filter: { id } });
              await scopedRepository(tx, policies, 'crmCustomers').updateOne({
                filter: { id },
                values: { ownerId, updatedAt: new Date().toISOString() },
              });
              if (ownerId && previous?.ownerId !== ownerId)
                await enqueueCrmNotification(tx, {
                  id: eventIdentity(
                    app.appName,
                    c.get('auth')!.user.id,
                    `crm/access/${id}/owner`,
                    c.req.valid('header')['idempotency-key'],
                  ),
                  scenario: 'assignment',
                  recipientId: ownerId,
                  targetPath: `/customers/${id}/details/overview`,
                });
            } else {
              const { userIds } = Shares.parse(input);
              if (
                userIds.some(
                  (userId) => !allowed.some((user) => user.id === userId),
                )
              )
                throw new ApiError({
                  status: 'INVALID_ARGUMENT',
                  reason: 'CRM_USER_NOT_ELIGIBLE',
                  domain: 'crm',
                  message: 'Select active CRM users with customer access.',
                });
              const bound = rules.withTransaction(tx);
              for (const [resource, slots] of sharedResources) {
                const ruleKey = key(id, resource.reference().name);
                const existing = await bound.get(ruleKey);
                if (!userIds.length) {
                  if (existing) await bound.delete(ruleKey);
                  continue;
                }
                const rule = {
                  key: ruleKey,
                  title: 'Customer read-only sharing',
                  resource: {
                    type: 'composite',
                    id: resource.reference().name,
                  },
                  subjects: userIds.map((id) => ({ type: 'user', id })),
                  actions: (resource === crmCustomers
                    ? ['view', 'useAssistant']
                    : ['view']
                  ).flatMap((action) =>
                    slots.map((scopeKey) => ({
                      action,
                      scopeKey,
                      selection: selection.recordAccess('crm.customer', {
                        customerId: id,
                      }),
                    })),
                  ),
                };
                validateDataScopeRule(authz, rule);
                if (existing) await bound.update(ruleKey, rule);
                else await bound.create(rule);
              }
            }
            return { id };
          },
        });
        await app.container
          .resolve(crmNotificationsToken)
          .flush()
          .catch(() => {});
        c.header('Idempotency-Replayed', String(result.replayed));
        return c.json({ data: result.data });
      },
    );
  }
  return new Hono().route('/crm', router);
});
