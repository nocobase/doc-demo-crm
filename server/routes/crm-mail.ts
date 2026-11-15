import type { Application } from '@nocobase/app-server/application';
import { Hono } from 'hono';
import { z } from 'zod';
import { databaseManagerToken } from '@nocobase/db';
import { mailServiceToken } from '@nocobase/app-plugin-mail/server';
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
} from '@nocobase/app-server/router';
import {
  authorizeCrm,
  scopedRepository,
} from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';

export default defineApiRoutes((app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  router.onError(apiErrorHandler);
  router.use(
    '/crmMail/*',
    app.container.resolve(authenticationToken).required({ scopedKeys: false }),
    app.container.resolve(authorizationToken).middleware(),
    async (c, next) => {
      await c.get('authz').require({
        resource: { type: 'page', id: 'mail.workspace' },
        action: 'access',
      });
      c.header('Cache-Control', 'private, no-store');
      await next();
    },
  );
  router.get(
    '/crmMail/customers/:customerId',
    describeRoute({
      tags: ['CRM mail'],
      summary:
        'Read personal correspondence for one authorized customer contact',
      responses: { 200: dataResponse(z.unknown()), ...apiErrorResponses },
    }),
    apiValidator('param', z.object({ customerId: z.uuid() })),
    apiValidator(
      'query',
      z.object({
        contactId: z.uuid(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      }),
    ),
    async (c) => {
      const connection = app.container
        .resolve(databaseManagerToken)
        .connection();
      const policies = await authorizeCrm(c.get('authz'), 'view');
      const { customerId } = c.req.valid('param');
      const { contactId, page } = c.req.valid('query');
      await new CrmService(connection, policies).get(customerId);
      const contact = await scopedRepository(
        connection,
        policies,
        'crmContacts',
      ).findOne({ filter: { id: contactId, customerId } });
      if (
        !contact ||
        typeof contact.email !== 'string' ||
        !contact.email.trim()
      )
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'CRM_CONTACT_EMAIL_NOT_FOUND',
          domain: 'crm',
          message: 'Choose a customer contact with an email address.',
        });
      const result = await app.container.resolve(mailServiceToken).listMessages(
        { actorId: c.get('auth')!.user.id },
        {
          participant: contact.email.trim().toLowerCase(),
          offset: (page - 1) * 20,
          limit: 20,
          withTotal: true,
        },
      );
      return c.json({
        data: result.items,
        meta: { total: result.total ?? 0, page, pageSize: 20 },
      });
    },
  );
  return new Hono().route('/', router);
});
