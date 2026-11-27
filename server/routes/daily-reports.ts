import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  apiErrorHandler,
  apiErrorResponses,
  dataResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { DailyReport, reportTimezone } from '../providers/daily-reports.js';

export default defineApiRoutes((app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  router.onError(apiErrorHandler);
  router.get(
    '/crm/daily-reports',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    describeRoute({
      tags: ['CRM'],
      summary: 'Read the latest 30 team sales activity reports',
      responses: {
        200: dataResponse(
          z.object({ timezone: z.string(), reports: z.array(DailyReport) }),
        ),
        ...apiErrorResponses,
      },
    }),
    async (c) => {
      await c.get('authz').require({
        resource: { type: 'page', id: 'crm.dailyReports' },
        action: 'access',
      });
      const reports = await app.container
        .resolve(databaseManagerToken)
        .connection()
        .repository('crmDailyReports')
        .findMany({ sort: (s) => [s.field('reportDate').desc()], limit: 30 });
      return c.json({
        data: {
          timezone: reportTimezone,
          reports: z.array(DailyReport).parse(reports),
        },
      });
    },
  );
  return new Hono().route('/', router);
});
