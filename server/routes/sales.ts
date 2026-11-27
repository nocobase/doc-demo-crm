import { authorizeCrm, customerReads } from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';
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
  SalesService,
  Product,
  ProductInput,
  Opportunity,
  OpportunityInput,
  Quote,
  QuoteInput,
  SalesListInput,
} from '../providers/sales.js';

const salesOperations = {
  products: { create: 'createProduct', edit: 'editProduct' },
  opportunities: { create: 'createOpportunity', edit: 'editOpportunity' },
  quotes: { create: 'createQuote', edit: 'editQuote' },
} as const;
function readSales(
  context: AuthorizationContext,
  kind: keyof typeof salesOperations,
) {
  if (kind === 'products') return authorizeCrm(context, 'viewProducts');
  return customerReads(
    context,
    kind === 'quotes' ? 'viewQuotes' : 'viewOpportunities',
  );
}
const Params = z.object({
  customerId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
  id: z.uuid().optional(),
});
const Header = z.object({ 'idempotency-key': z.string() });
const opportunities = '/customers/:customerId/opportunities';
const quotes = `${opportunities}/:opportunityId/quotes`;
export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  router.onError(apiErrorHandler);
  // The dedicated mount contains only the sales model endpoints.
  for (const path of ['/products', '/products/*', '/customers/*'])
    router.use(
      path,
      app.container
        .resolve(authenticationToken)
        .required({ scopedKeys: false }),
      app.container.resolve(authorizationToken).middleware(),
    );
  for (const kind of ['products', 'opportunities', 'quotes'] as const) {
    const base =
      kind === 'products'
        ? '/products'
        : kind === 'opportunities'
          ? opportunities
          : quotes;
    const schema =
      kind === 'products'
        ? Product
        : kind === 'opportunities'
          ? Opportunity
          : Quote;
    router.get(
      base,
      async (c, next) => {
        await readSales(c.get('authz'), kind);
        await next();
      },
      describeRoute({
        tags: ['CRM sales'],
        summary: `List ${kind}`,
        responses: { 200: listResponse(schema), ...apiErrorResponses },
      }),
      apiValidator('param', Params),
      apiValidator('query', SalesListInput),
      async (c) => {
        const { customerId, opportunityId } = c.req.valid('param');
        const input = c.req.valid('query');
        const service = new SalesService(
          connection,
          await readSales(c.get('authz'), kind),
        );
        return c.json(
          kind === 'products'
            ? await service.products(input)
            : kind === 'opportunities'
              ? await service.opportunities(customerId!, input.page)
              : await service.quotes(customerId!, opportunityId!, input.page),
        );
      },
    );
    router.get(
      `${base}/:id`,
      async (c, next) => {
        await readSales(c.get('authz'), kind);
        await next();
      },
      describeRoute({
        tags: ['CRM sales'],
        summary: `Read ${kind}`,
        responses: { 200: dataResponse(schema), ...apiErrorResponses },
      }),
      apiValidator('param', Params),
      async (c) => {
        const { customerId, opportunityId, id } = c.req.valid('param');
        const service = new SalesService(
          connection,
          await readSales(c.get('authz'), kind),
        );
        return c.json({
          data:
            kind === 'products'
              ? await service.product(id!)
              : kind === 'opportunities'
                ? await service.opportunity(customerId!, id!)
                : await service.quote(customerId!, opportunityId!, id!),
        });
      },
    );
  }
  for (const update of [false, true]) {
    for (const kind of ['products', 'opportunities', 'quotes'] as const) {
      const base =
        kind === 'products'
          ? '/products'
          : kind === 'opportunities'
            ? opportunities
            : quotes;
      router.on(
        update ? 'PATCH' : 'POST',
        update ? `${base}/:id` : base,
        async (c, next) => {
          const action = salesOperations[kind][update ? 'edit' : 'create'];
          await authorizeCrm(c.get('authz'), action);
          await next();
        },
        describeRoute({
          tags: ['CRM sales'],
          summary: `${update ? 'Update' : 'Create'} ${kind}`,
          responses: {
            200: dataResponse(
              kind === 'products'
                ? Product
                : kind === 'opportunities'
                  ? Opportunity
                  : Quote,
            ),
            ...apiErrorResponses,
          },
        }),
        apiValidator('param', Params),
        apiValidator('header', Header),
        apiValidator(
          'json',
          kind === 'products'
            ? ProductInput
            : kind === 'opportunities'
              ? OpportunityInput
              : QuoteInput,
        ),
        async (c) => {
          const { customerId, opportunityId, id } = c.req.valid('param');
          const input = c.req.valid('json');
          const action = salesOperations[kind][update ? 'edit' : 'create'];
          const policies = await authorizeCrm(c.get('authz'), action);
          const assertAccess = async () => {
            if (customerId)
              await new CrmService(connection, policies).get(customerId);
          };
          const result = await executeIdempotentMutation({
            connection,
            key: c.req.valid('header')['idempotency-key'],
            principal: `${app.appName}:${c.get('auth')!.user.id}`,
            operation: `crmSales/${kind}/${customerId ?? ''}/${opportunityId ?? ''}/${id ?? 'new'}`,
            input,
            authorize: async () => {
              await assertAccess();
            },
            authorizeReplay: async (record) => {
              await assertAccess();
              const savedId = z.object({ id: z.string() }).parse(record).id;
              const service = new SalesService(connection, policies);
              if (kind === 'products') await service.product(savedId);
              else if (kind === 'opportunities')
                await service.opportunity(customerId!, savedId);
              else await service.quote(customerId!, opportunityId!, savedId);
            },
            execute: (tx) => {
              const sales = new SalesService(tx, policies);
              return kind === 'products'
                ? sales.saveProduct(ProductInput.parse(input), id)
                : kind === 'opportunities'
                  ? sales.saveOpportunity(
                      customerId!,
                      OpportunityInput.parse(input),
                      id,
                    )
                  : sales.saveQuote(
                      customerId!,
                      opportunityId!,
                      QuoteInput.parse(input),
                      id,
                    );
            },
          });
          c.header('Idempotency-Replayed', String(result.replayed));
          return c.json({ data: result.data });
        },
      );
    }
  }
  return new Hono().route('/crmSales', router);
});
