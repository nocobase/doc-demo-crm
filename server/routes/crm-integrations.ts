import { SalesService } from '../providers/sales.js';
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
  listResponse,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  Contact,
  ContactInput,
  CrmService,
  Customer,
  CustomerInput,
  ListInput,
} from '../providers/crm.js';

import {
  ConflictMode,
  IntakeValidationError,
  ingestCustomerRow,
} from '../providers/crm-intake.js';
import {
  SyncDeliveryView,
  SyncTargetInput,
  SyncTargetView,
  crmIntegrationsToken,
} from '../providers/crm-integrations.js';
import {
  authorizeCrm,
  customerReads,
  scopedRepository,
  optionalCrm,
} from '../providers/crm-permissions.js';

const Header = z.object({ 'idempotency-key': z.string() });
const IdParam = z.object({ id: z.uuid() });
const DeliveriesQuery = z.object({
  entityType: z.enum(['quote', 'opportunity']).optional(),
  entityId: z.uuid().optional(),
});

const LeadIntakeInput = z.strictObject({
  externalId: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(80).default('website'),
  name: CustomerInput.shape.name,
  industry: CustomerInput.shape.industry,
  status: CustomerInput.shape.status,
  website: CustomerInput.shape.website,
  notes: CustomerInput.shape.notes,
  conflictMode: ConflictMode.default('skip'),
  contact: ContactInput.optional(),
});

const LeadIntakeResponse = z.object({
  action: z.enum(['created', 'updated', 'skipped']),
  externalId: z.string(),
  source: z.string(),
  customer: Customer,
  contact: Contact.optional(),
});

function toIntakeApiError(error: unknown): never {
  if (error instanceof IntakeValidationError) {
    if (error.code === 'CONFLICT_REJECTED') {
      throw new ApiError({
        status: 'ALREADY_EXISTS',
        reason: 'CRM_CUSTOMER_CONFLICT',
        domain: 'crm',
        message: error.message,
      });
    }
    if (error.code === 'PERMISSION_DENIED') {
      throw new ApiError({
        status: 'PERMISSION_DENIED',
        reason: 'CRM_ACCESS_DENIED',
        domain: 'crm',
        message: error.message,
      });
    }
    throw new ApiError({
      status: 'INVALID_ARGUMENT',
      reason: error.code,
      domain: 'crm',
      message: error.message,
    });
  }
  throw error;
}

export default defineApiRoutes(async (app: Application) => {
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  const connection = app.container.resolve(databaseManagerToken).connection();
  const integrations = app.container.resolve(crmIntegrationsToken);
  const auth = app.container.resolve(authenticationToken);
  const authz = app.container.resolve(authorizationToken);
  router.onError(apiErrorHandler);

  // External integration endpoints explicitly opt into scoped API keys (`scopedKeys: true`).
  for (const path of [
    '/leads',
    '/customers',
    '/deliveries',
    '/deliveries/*',
    '/sync/*',
  ]) {
    router.use(path, auth.required({ scopedKeys: true }), authz.middleware());
  }

  // Target administration stays interactive-session only.
  router.use(
    '/target',
    auth.required({ scopedKeys: false }),
    authz.middleware(),
  );

  router.get(
    '/customers',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'List accessible CRM customers (supports scoped API keys)',
      operationId: 'integrationListCustomers',
      responses: { 200: listResponse(Customer), ...apiErrorResponses },
    }),
    apiValidator('query', ListInput),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'viewCustomer');
      return c.json(
        await new CrmService(connection, policies).list(c.req.valid('query')),
      );
    },
  );

  router.post(
    '/leads',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Ingest an external lead into CRM customers and contacts',
      operationId: 'integrationIngestLead',
      responses: {
        200: dataResponse(LeadIntakeResponse),
        201: dataResponse(LeadIntakeResponse),
        ...apiErrorResponses,
      },
    }),
    apiValidator('header', Header),
    apiValidator('json', LeadIntakeInput),
    async (c) => {
      const input = c.req.valid('json');
      const authzContext = c.get('authz');
      const view = input.contact
        ? await customerReads(authzContext, 'viewContacts')
        : await authorizeCrm(authzContext, 'viewCustomer');
      const createCustomer = await authorizeCrm(authzContext, 'createCustomer');
      const editCustomer =
        input.conflictMode === 'update'
          ? await authorizeCrm(authzContext, 'editCustomer')
          : await optionalCrm(authzContext, 'editCustomer');
      const addContact = input.contact
        ? await authorizeCrm(authzContext, 'addContact')
        : await optionalCrm(authzContext, 'addContact');
      const editContact = await optionalCrm(authzContext, 'editContact');

      const userId = c.get('auth')!.user.id;
      const notesWithSource = input.notes
        ? `[${input.source} #${input.externalId}] ${input.notes}`
        : `Captured from ${input.source} (${input.externalId}).`;

      const result = await executeIdempotentMutation({
        connection,
        key: c.req.valid('header')['idempotency-key'],
        principal: `${app.appName}:${userId}`,
        operation: 'crm/integrations/leads',
        input,
        authorize: async () => {
          await authorizeCrm(authzContext, 'createCustomer');
        },
        authorizeReplay: async () => {
          await authorizeCrm(authzContext, 'viewCustomer');
        },
        execute: async (tx) => {
          try {
            const ingested = await ingestCustomerRow(
              tx,
              { view, createCustomer, editCustomer, addContact, editContact },
              {
                customer: {
                  name: input.name,
                  industry: input.industry,
                  status: input.status,
                  website: input.website,
                  notes: notesWithSource,
                },
                ...(input.contact ? { contact: input.contact } : {}),
              },
              { ownerId: userId, conflictMode: input.conflictMode },
            );
            return {
              action: ingested.action,
              externalId: input.externalId,
              source: input.source,
              customer: ingested.customer,
              ...(ingested.contact ? { contact: ingested.contact } : {}),
            };
          } catch (error) {
            toIntakeApiError(error);
          }
        },
      });

      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json(
        { data: result.data },
        result.data.action === 'created' && !result.replayed ? 201 : 200,
      );
    },
  );

  router.get(
    '/target',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Read ERP & Finance sync target configuration',
      operationId: 'integrationGetTarget',
      responses: { 200: dataResponse(SyncTargetView), ...apiErrorResponses },
    }),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'readIntegrations');
      const target = await integrations.getTarget(policies);
      const configure = await optionalCrm(
        c.get('authz'),
        'configureIntegrations',
      );
      const canReadSecret =
        configure?.crmSyncTargets &&
        (await scopedRepository(
          connection,
          configure,
          'crmSyncTargets',
        ).findOne({ filter: { id: target.id } }));
      return c.json({
        data: {
          ...target,
          secretHeader: canReadSecret ? target.secretHeader : '',
        },
      });
    },
  );

  router.put(
    '/target',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Update ERP & Finance sync target configuration',
      operationId: 'integrationUpdateTarget',
      responses: { 200: dataResponse(SyncTargetView), ...apiErrorResponses },
    }),
    apiValidator('json', SyncTargetInput),
    async (c) => {
      const policies = await authorizeCrm(
        c.get('authz'),
        'configureIntegrations',
      );
      return c.json({
        data: await integrations.updateTarget(policies, c.req.valid('json')),
      });
    },
  );

  router.get(
    '/deliveries',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'List ERP & Finance outbound sync deliveries',
      operationId: 'integrationListDeliveries',
      responses: { 200: listResponse(SyncDeliveryView), ...apiErrorResponses },
    }),
    apiValidator('query', DeliveriesQuery),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'readIntegrations');
      const data = await integrations.listDeliveries(
        policies,
        c.req.valid('query'),
      );
      return c.json({ data, meta: { total: data.length } });
    },
  );

  router.post(
    '/sync/quotes/:id',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Queue ERP & Finance sync for a confirmed quotation',
      operationId: 'integrationSyncQuote',
      responses: {
        200: dataResponse(SyncDeliveryView),
        202: dataResponse(SyncDeliveryView),
        ...apiErrorResponses,
      },
    }),
    apiValidator('param', IdParam),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'syncIntegrations');
      const viewPolicies = await customerReads(c.get('authz'), 'viewQuotes');
      const result = await integrations.syncConfirmedQuote(
        policies,
        viewPolicies,
        c.req.valid('param').id,
      );
      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json({ data: result.delivery }, result.replayed ? 200 : 202);
    },
  );

  router.post(
    '/sync/opportunities/:id',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Queue ERP & Finance sync for a won opportunity',
      operationId: 'integrationSyncOpportunity',
      responses: {
        200: dataResponse(SyncDeliveryView),
        202: dataResponse(SyncDeliveryView),
        ...apiErrorResponses,
      },
    }),
    apiValidator('param', IdParam),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'syncIntegrations');
      const viewPolicies = await customerReads(
        c.get('authz'),
        'viewOpportunities',
      );
      const result = await integrations.syncWonOpportunity(
        policies,
        viewPolicies,
        c.req.valid('param').id,
      );
      c.header('Idempotency-Replayed', String(result.replayed));
      return c.json({ data: result.delivery }, result.replayed ? 200 : 202);
    },
  );

  router.post(
    '/deliveries/:id/retry',
    describeRoute({
      tags: ['CRM integrations'],
      summary: 'Retry a failed ERP & Finance sync delivery',
      operationId: 'integrationRetryDelivery',
      responses: { 202: dataResponse(SyncDeliveryView), ...apiErrorResponses },
    }),
    apiValidator('param', IdParam),
    async (c) => {
      const policies = await authorizeCrm(c.get('authz'), 'syncIntegrations');
      const row = await scopedRepository(
        connection,
        policies,
        'crmSyncDeliveries',
      ).findOne({ filter: { id: c.req.valid('param').id } });
      if (!row)
        throw new ApiError({
          status: 'NOT_FOUND',
          domain: 'crm',
          reason: 'SYNC_DELIVERY_NOT_FOUND',
          message: 'Sync delivery not found.',
        });
      const customerId = z.string().parse(row.customerId);
      const entityId = z.string().parse(row.entityId);
      const quote = row.entityType === 'quote';
      const reads = await customerReads(
        c.get('authz'),
        quote ? 'viewQuotes' : 'viewOpportunities',
      );
      await new CrmService(connection, reads).get(customerId);
      const record = await scopedRepository(
        connection,
        reads,
        quote ? 'crmQuotes' : 'crmOpportunities',
      ).findOne({ filter: { id: entityId, customerId } });
      if (!record)
        throw new ApiError({
          status: 'NOT_FOUND',
          domain: 'crm',
          reason: 'CRM_RECORD_NOT_FOUND',
          message: 'Sync source not found.',
        });
      if (quote)
        await new SalesService(connection, reads).quote(
          customerId,
          z.string().parse(record.opportunityId),
          entityId,
        );
      const delivery = await integrations.retryDelivery(
        policies,
        c.req.valid('param').id,
      );
      return c.json({ data: delivery }, 202);
    },
  );

  return new Hono().route('/crmIntegrations', router);
});
