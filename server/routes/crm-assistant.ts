import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { OnlineAgentResultError } from '@nocobase/app-plugin-agents/server/online-agent';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';
import { authorizeCrm } from '../providers/crm-permissions.js';
import { CrmService } from '../providers/crm.js';
import {
  FOLLOW_UP_DRAFT_JSON_SCHEMA,
  FollowUpDraftResult,
} from '../providers/crm-assistant.js';

const Params = z.object({ id: z.uuid() });
const GenerateInput = z.strictObject({
  goal: z.string().trim().max(500).default(''),
  selectedModel: z
    .strictObject({
      modelService: z.string().trim().min(1).max(120),
      model: z.string().trim().min(1).max(200),
    })
    .optional(),
});

const ModelsResponse = z.object({
  services: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      provider: z.string(),
      models: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      ),
    }),
  ),
  defaultModel: z
    .object({
      modelService: z.string(),
      model: z.string(),
    })
    .nullable(),
});

const DraftResponse = z.object({
  sessionId: z.string(),
  model: z.object({
    modelService: z.string(),
    model: z.string(),
  }),
  draft: FollowUpDraftResult,
  canSaveFollowUp: z.boolean(),
});

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  const auth = app.container.resolve(authenticationToken);
  const authz = app.container.resolve(authorizationToken);
  router.onError(apiErrorHandler);

  for (const path of ['/models', '/customers/:id/follow-up-draft']) {
    router.use(path, auth.required({ scopedKeys: false }), authz.middleware());
  }

  router.get(
    '/models',
    async (c, next) => {
      await authorizeCrm(c.get('authz'), 'useAssistant');
      await next();
    },
    describeRoute({
      tags: ['CRM Assistant'],
      summary: 'List enabled chat models for the CRM sales assistant',
      responses: { 200: dataResponse(ModelsResponse), ...apiErrorResponses },
    }),
    async (c) => {
      const agents = app.container.resolve(agentsToken);
      const catalog = await agents.models.gateway.catalog('chat');
      const services = catalog.services.map((service) => ({
        name: service.name,
        title: service.title,
        provider: service.provider,
        models: service.models.map((m) => ({
          value: m.value,
          label: m.label,
        })),
      }));
      const defaultModel =
        catalog.defaultModel ??
        (services[0]?.models[0]
          ? {
              modelService: services[0].name,
              model: services[0].models[0].value,
            }
          : null);
      return c.json({ data: { services, defaultModel } });
    },
  );

  router.post(
    '/customers/:id/follow-up-draft',
    async (c, next) => {
      await authorizeCrm(c.get('authz'), 'useAssistant');
      await next();
    },
    describeRoute({
      tags: ['CRM Assistant'],
      summary: 'Generate an evidence-backed customer follow-up draft',
      responses: { 200: dataResponse(DraftResponse), ...apiErrorResponses },
    }),
    apiValidator('param', Params),
    apiValidator('json', GenerateInput),
    async (c) => {
      const customerId = c.req.valid('param').id;
      const input = c.req.valid('json');
      const authCtx = c.get('auth')!;
      const authzCtx = c.get('authz');

      // Enforce current customer access before touching any model service.
      const viewPolicies = await authorizeCrm(authzCtx, 'viewCustomer');
      await new CrmService(
        connection,
        await authorizeCrm(authzCtx, 'useAssistant'),
      ).get(customerId);
      const customer = await new CrmService(connection, viewPolicies).get(
        customerId,
      );

      let canSaveFollowUp: boolean;
      try {
        const writePolicies = await authorizeCrm(authzCtx, 'recordFollowUp');
        await new CrmService(connection, writePolicies).get(customerId);
        canSaveFollowUp = true;
      } catch {
        canSaveFollowUp = false;
      }

      const agents = app.container.resolve(agentsToken);
      const catalog = await agents.models.gateway.catalog('chat');
      const availableModels = catalog.services.flatMap((service) =>
        service.models.map((model) => ({
          modelService: service.name,
          model: model.value,
        })),
      );
      if (availableModels.length === 0) {
        throw new ApiError({
          status: 'FAILED_PRECONDITION',
          domain: 'crm',
          reason: 'CRM_MODEL_NOT_CONFIGURED',
          message:
            'Configure and enable a chat model in System settings → AI models before generating a draft.',
        });
      }

      const resolvedModel = input.selectedModel
        ? availableModels.find(
            (candidate) =>
              candidate.modelService === input.selectedModel!.modelService &&
              candidate.model === input.selectedModel!.model,
          )
        : (catalog.defaultModel ?? availableModels[0]);

      if (!resolvedModel) {
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          domain: 'crm',
          reason: 'CRM_MODEL_UNAVAILABLE',
          message: 'The selected chat model is not available or enabled.',
        });
      }

      const userPrompt = input.goal
        ? `Prepare a customer follow-up summary, suggested next step, and editable follow-up draft for the selected customer.\n\nFocus requested by salesperson:\n${input.goal}`
        : 'Prepare a concise customer follow-up summary, suggested next step, and editable follow-up draft for the selected customer based on their records and product knowledge.';

      try {
        const session = await agents.onlineAgent.background(
          {
            user: { id: authCtx.user.id },
            authorization: authzCtx,
            credentials: authCtx,
            business: { customerId },
          },
          {
            scope: ['crm-follow-up'],
            selectedModel: resolvedModel,
            source: 'crm-follow-up-draft',
            title: `Follow-up draft: ${z.string().parse(customer.name)}`,
          },
        );
        await session.run(
          [{ role: 'user', content: userPrompt }],
          FOLLOW_UP_DRAFT_JSON_SCHEMA,
        );
        const raw = await session.get();
        const draft = FollowUpDraftResult.parse(raw);
        return c.json({
          data: {
            sessionId: session.sessionId,
            model: resolvedModel,
            draft,
            canSaveFollowUp,
          },
        });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof OnlineAgentResultError) {
          throw new ApiError({
            status: 'INTERNAL',
            domain: 'crm',
            reason: 'CRM_ASSISTANT_FAILED',
            message:
              error.message ||
              'Unable to generate a follow-up draft from the selected model.',
          });
        }
        throw new ApiError({
          status: 'INTERNAL',
          domain: 'crm',
          reason: 'CRM_ASSISTANT_FAILED',
          message:
            'Unable to generate a follow-up draft. Check the model service configuration and try again.',
        });
      }
    },
  );

  return new Hono().route('/crmAssistant', router);
});
