import { authorizeCrm } from '../providers/crm-permissions.js';
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
  dataResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { Workspace, WorkspaceService } from '../providers/workspace.js';

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  router.onError(apiErrorHandler);
  router.get(
    '/crm/workspace',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    describeRoute({
      tags: ['CRM'],
      summary: 'Read sales workspace',
      responses: { 200: dataResponse(Workspace), ...apiErrorResponses },
    }),
    async (c) => {
      const service = new WorkspaceService(
        connection,
        await authorizeCrm(c.get('authz'), 'view'),
      );
      return c.json({ data: await service.read() });
    },
  );
  return new Hono().route('/', router);
});
