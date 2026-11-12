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
  SalesService,
  Product,
  ProductInput,
  Opportunity,
  OpportunityInput,
  Quote,
  QuoteInput,
  SalesListInput,
} from '../providers/sales.js';

const access = {
  resource: { type: 'page', id: 'customers' },
  action: 'access',
} as const;
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
  const service = new SalesService(connection);
  router.onError(apiErrorHandler);
  // The dedicated mount contains only the sales model endpoints.
  router.use(
    '*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      await c.get('authz').require(access);
      await next();
    },
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
      describeRoute({
        tags: ['CRM sales'],
        summary: `Read ${kind}`,
        responses: { 200: dataResponse(schema), ...apiErrorResponses },
      }),
      apiValidator('param', Params),
      async (c) => {
        const { customerId, opportunityId, id } = c.req.valid('param');
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
          const result = await executeIdempotentMutation({
            connection,
            key: c.req.valid('header')['idempotency-key'],
            principal: `${app.appName}:${c.get('auth')!.user.id}`,
            operation: `crmSales/${kind}/${customerId ?? ''}/${opportunityId ?? ''}/${id ?? 'new'}`,
            input,
            authorize: async () => {
              await c.get('authz').require(access);
            },
            authorizeReplay: async () => {
              await c.get('authz').require(access);
            },
            execute: (tx) => {
              const sales = new SalesService(tx);
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
