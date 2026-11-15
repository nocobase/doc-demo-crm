import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  apiValidator,
  describeRoute,
  dataResponse,
  apiErrorResponses,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';
import { z } from 'zod';
const row = z.object({
  id: z.string(),
  scenario: z.string(),
  status: z.string(),
  attempts: z.number(),
  notificationId: z.string().nullable(),
  errorCategory: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
});
export default defineApiRoutes((app: Application) => {
  const r = new Hono<AuthEnv & AuthorizationEnv>();
  r.onError(apiErrorHandler);
  r.use(
    '/crmNotifications/*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      await c
        .get('authz')
        .require({
          resource: { type: 'page', id: 'notification.logs' },
          action: 'access',
        });
      await next();
    },
  );
  r.get(
    '/crmNotifications/events',
    describeRoute({
      tags: ['CRM notifications'],
      summary: 'List safe business notification handoff states',
      responses: { 200: dataResponse(z.array(row)), ...apiErrorResponses },
    }),
    apiValidator(
      'query',
      z.object({
        page: z.coerce.number().int().positive().default(1),
        status: z.enum(['queued', 'submitted', 'skipped']).optional(),
      }),
    ),
    async (c) => {
      const { page, status } = c.req.valid('query');
      const repository = app.container
        .resolve(databaseManagerToken)
        .connection()
        .repository('crmNotificationEvents');
      const filter = status ? { status } : undefined;
      const rows = await repository.findMany({
        filter,
        limit: 20,
        offset: (page - 1) * 20,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
      });
      return c.json({
        data: rows.map((item) => row.parse(item)),
        meta: { page, pageSize: 20, total: await repository.count({ filter }) },
      });
    },
  );
  return new Hono().route('/', r);
});
