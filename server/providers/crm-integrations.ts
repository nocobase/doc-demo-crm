import { createHash, randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { ApiError } from '@nocobase/app-server/router';
import {
  apiKeyScopesToken,
  type AccessRef,
} from '@nocobase/app-plugin-api-keys/server';
import {
  databaseManagerToken,
  isUniqueConstraintViolation,
  type RepositoryRecord,
} from '@nocobase/db';
import {
  Job,
  type JobExecutionContext,
  type JobExecutor,
} from '@nocobase/jobs';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { z } from 'zod';
import { type CrmPolicies, scopedRepository } from './crm-permissions.js';
import { asString } from './crm-intake.js';

export const DEFAULT_ERP_TARGET_KEY = 'erp-finance';
export const DEFAULT_MOCK_ERP_URL = 'mock://erp-finance/orders';

export const SyncTargetInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  endpointUrl: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (value) =>
        value.startsWith('mock://erp-finance') || /^https?:\/\//i.test(value),
      'Endpoint must be mock://erp-finance/orders or an http(s) URL.',
    ),
  secretHeader: z.string().trim().max(200).default(''),
  enabled: z.boolean().default(true),
  simulateFailure: z.boolean().default(false),
});

export const SyncTargetView = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  endpointUrl: z.string(),
  secretHeader: z.string(),
  enabled: z.boolean(),
  simulateFailure: z.boolean(),
  updatedAt: z.string(),
});

export const SyncDeliveryView = z.object({
  id: z.string(),
  idempotencyKey: z.string(),
  targetKey: z.string(),
  entityType: z.enum(['quote', 'opportunity']),
  entityId: z.string(),
  customerId: z.string(),
  entityTitle: z.string(),
  eventType: z.enum(['quote.confirmed', 'opportunity.won']),
  status: z.enum(['pending', 'succeeded', 'failed']),
  attempts: z.number(),
  httpStatus: z.number().nullable(),
  externalReference: z.string().nullable(),
  errorMessage: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  succeededAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

interface ErpSyncPayload {
  readonly deliveryId: string;
}

function createErpSyncJob(
  deliver: (deliveryId: string, context: JobExecutionContext) => Promise<void>,
) {
  return class CrmErpSyncJob extends Job<ErpSyncPayload> {
    static readonly jobName = 'crm.integration.erp-sync';

    async execute(context: JobExecutionContext): Promise<void> {
      context.signal.throwIfAborted();
      await deliver(this.payload.deliveryId, context);
    }
  };
}

function formatTarget(row: RepositoryRecord) {
  return SyncTargetView.parse({
    id: asString(row.id),
    key: asString(row.key),
    name: asString(row.name),
    endpointUrl: asString(row.endpointUrl),
    secretHeader: asString(row.secretHeader),
    enabled: Boolean(row.enabled),
    simulateFailure: Boolean(row.simulateFailure),
    updatedAt: asString(row.updatedAt),
  });
}

function formatDelivery(row: RepositoryRecord) {
  return SyncDeliveryView.parse({
    id: asString(row.id),
    idempotencyKey: asString(row.idempotencyKey),
    targetKey: asString(row.targetKey),
    entityType: row.entityType,
    entityId: asString(row.entityId),
    customerId: asString(row.customerId),
    entityTitle: asString(row.entityTitle),
    eventType: row.eventType,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    httpStatus:
      row.httpStatus === null || row.httpStatus === undefined
        ? null
        : Number(row.httpStatus),
    externalReference: row.externalReference
      ? asString(row.externalReference)
      : null,
    errorMessage: row.errorMessage ? asString(row.errorMessage) : null,
    lastAttemptAt: row.lastAttemptAt ? asString(row.lastAttemptAt) : null,
    succeededAt: row.succeededAt ? asString(row.succeededAt) : null,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  });
}

export class CrmIntegrationsService {
  private executor: JobExecutor | undefined;
  private JobClass: ReturnType<typeof createErpSyncJob> | undefined;
  private accepting = true;
  private readonly mockErpLedger = new Map<string, string>();

  constructor(private readonly app: Application) {}

  attach(
    executor: JobExecutor,
    JobClass: ReturnType<typeof createErpSyncJob>,
  ): void {
    this.executor = executor;
    this.JobClass = JobClass;
    this.accepting = true;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  private connection() {
    return this.app.container.resolve(databaseManagerToken).connection();
  }

  async ensureDefaultTarget() {
    const repo = this.connection().repository('crmSyncTargets');
    const existing = await repo.findOne({
      filter: { key: DEFAULT_ERP_TARGET_KEY },
    });
    if (existing) return formatTarget(existing);
    const now = new Date().toISOString();
    try {
      const created = (
        await repo.createOne({
          values: {
            id: randomUUID(),
            key: DEFAULT_ERP_TARGET_KEY,
            name: 'ERP & Finance Order Sync',
            endpointUrl: DEFAULT_MOCK_ERP_URL,
            secretHeader: '',
            enabled: true,
            simulateFailure: false,
            createdAt: now,
            updatedAt: now,
          },
        })
      ).record;
      return formatTarget(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const retry = await repo.findOne({
          filter: { key: DEFAULT_ERP_TARGET_KEY },
        });
        if (retry) return formatTarget(retry);
      }
      throw error;
    }
  }

  async getTarget() {
    return this.ensureDefaultTarget();
  }

  async updateTarget(input: z.infer<typeof SyncTargetInput>) {
    const current = await this.ensureDefaultTarget();
    const updated = (
      await this.connection()
        .repository('crmSyncTargets')
        .updateOne({
          filter: { id: current.id },
          values: {
            ...input,
            updatedAt: new Date().toISOString(),
          },
        })
    ).record;
    return formatTarget(updated);
  }

  async listDeliveries(filters?: { entityType?: string; entityId?: string }) {
    const filter: Record<string, string> = {};
    if (filters?.entityType) filter.entityType = filters.entityType;
    if (filters?.entityId) filter.entityId = filters.entityId;
    const rows = await this.connection()
      .repository('crmSyncDeliveries')
      .findMany({
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
        limit: 100,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
      });
    return rows.map(formatDelivery);
  }

  async syncConfirmedQuote(viewPolicies: CrmPolicies, quoteId: string) {
    const connection = this.connection();
    const quote = await scopedRepository(
      connection,
      viewPolicies,
      'crmQuotes',
    ).findOne({ filter: { id: quoteId } });
    if (!quote) {
      throw new ApiError({
        status: 'NOT_FOUND',
        reason: 'CRM_RECORD_NOT_FOUND',
        domain: 'crm',
        message: 'Quotation not found in your accessible scope.',
      });
    }
    const approval = await connection
      .repository('crmQuoteApprovals')
      .findOne({ filter: { quoteId } });
    if (!approval || asString(approval.status) !== 'confirmed') {
      throw new ApiError({
        status: 'FAILED_PRECONDITION',
        reason: 'QUOTE_NOT_CONFIRMED',
        domain: 'crm',
        message: 'Only confirmed quotations can be synced to ERP/Finance.',
      });
    }

    const customerId = asString(quote.customerId);
    const opportunityId = asString(quote.opportunityId);
    const [customer, opportunity, lines] = await Promise.all([
      scopedRepository(connection, viewPolicies, 'crmCustomers').findOne({
        filter: { id: customerId },
      }),
      scopedRepository(connection, viewPolicies, 'crmOpportunities').findOne({
        filter: { id: opportunityId },
      }),
      scopedRepository(connection, viewPolicies, 'crmQuoteLines').findMany({
        filter: { quoteId },
        sort: (s) => [s.field('position').asc()],
      }),
    ]);

    const idempotencyKey = `erp-sync:quote:${quoteId}`;
    const payload = {
      eventType: 'quote.confirmed',
      idempotencyKey,
      quote: {
        id: quoteId,
        name: asString(quote.name),
        currency: asString(quote.currency, 'USD'),
        total: Number(quote.totalCents ?? 0) / 100,
        lines: lines.map((line) => ({
          productCode: asString(line.productCode),
          productName: asString(line.productName),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPriceCents) / 100,
          discount: Number(line.discountBasisPoints) / 100,
          amount: Number(line.amountCents) / 100,
        })),
      },
      opportunity: opportunity
        ? {
            id: opportunityId,
            name: asString(opportunity.name),
            stage: asString(opportunity.stage),
          }
        : null,
      customer: customer
        ? {
            id: customerId,
            name: asString(customer.name),
            industry: asString(customer.industry),
          }
        : null,
    };

    return this.queueDelivery({
      idempotencyKey,
      entityType: 'quote',
      entityId: quoteId,
      customerId,
      entityTitle: asString(quote.name),
      eventType: 'quote.confirmed',
      payload,
    });
  }

  async syncWonOpportunity(viewPolicies: CrmPolicies, opportunityId: string) {
    const connection = this.connection();
    const opportunity = await scopedRepository(
      connection,
      viewPolicies,
      'crmOpportunities',
    ).findOne({ filter: { id: opportunityId } });
    if (!opportunity) {
      throw new ApiError({
        status: 'NOT_FOUND',
        reason: 'CRM_RECORD_NOT_FOUND',
        domain: 'crm',
        message: 'Opportunity not found in your accessible scope.',
      });
    }
    if (asString(opportunity.stage) !== 'won') {
      throw new ApiError({
        status: 'FAILED_PRECONDITION',
        reason: 'OPPORTUNITY_NOT_WON',
        domain: 'crm',
        message: 'Only won opportunities can be synced as ERP deals.',
      });
    }

    const customerId = asString(opportunity.customerId);
    const customer = await scopedRepository(
      connection,
      viewPolicies,
      'crmCustomers',
    ).findOne({ filter: { id: customerId } });

    const idempotencyKey = `erp-sync:opportunity:${opportunityId}`;
    const payload = {
      eventType: 'opportunity.won',
      idempotencyKey,
      opportunity: {
        id: opportunityId,
        name: asString(opportunity.name),
        stage: asString(opportunity.stage),
      },
      customer: customer
        ? {
            id: customerId,
            name: asString(customer.name),
            industry: asString(customer.industry),
          }
        : null,
    };

    return this.queueDelivery({
      idempotencyKey,
      entityType: 'opportunity',
      entityId: opportunityId,
      customerId,
      entityTitle: asString(opportunity.name),
      eventType: 'opportunity.won',
      payload,
    });
  }

  private async queueDelivery(input: {
    readonly idempotencyKey: string;
    readonly entityType: 'quote' | 'opportunity';
    readonly entityId: string;
    readonly customerId: string;
    readonly entityTitle: string;
    readonly eventType: 'quote.confirmed' | 'opportunity.won';
    readonly payload: Record<string, unknown>;
  }) {
    const target = await this.ensureDefaultTarget();
    if (!target.enabled) {
      throw new ApiError({
        status: 'FAILED_PRECONDITION',
        reason: 'INTEGRATION_TARGET_DISABLED',
        domain: 'crm',
        message: 'ERP & Finance sync target is currently disabled.',
      });
    }

    const repo = this.connection().repository('crmSyncDeliveries');
    const existing = await repo.findOne({
      filter: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (asString(existing.status) === 'succeeded') {
        return { delivery: formatDelivery(existing), replayed: true };
      }
      if (asString(existing.status) === 'failed') {
        const retried = await this.retryDelivery(asString(existing.id));
        return { delivery: retried, replayed: false };
      }
      return { delivery: formatDelivery(existing), replayed: true };
    }

    const now = new Date().toISOString();
    const deliveryId = randomUUID();
    const created = (
      await repo.createOne({
        values: {
          id: deliveryId,
          idempotencyKey: input.idempotencyKey,
          targetKey: target.key,
          entityType: input.entityType,
          entityId: input.entityId,
          customerId: input.customerId,
          entityTitle: input.entityTitle,
          eventType: input.eventType,
          status: 'pending',
          attempts: 0,
          httpStatus: null,
          externalReference: null,
          errorMessage: null,
          payloadSnapshot: JSON.stringify(input.payload),
          lastAttemptAt: null,
          succeededAt: null,
          createdAt: now,
          updatedAt: now,
        },
      })
    ).record;

    await this.enqueueJob(deliveryId);
    return { delivery: formatDelivery(created), replayed: false };
  }

  async retryDelivery(deliveryId: string) {
    const repo = this.connection().repository('crmSyncDeliveries');
    const existing = await repo.findOne({ filter: { id: deliveryId } });
    if (!existing) {
      throw new ApiError({
        status: 'NOT_FOUND',
        reason: 'SYNC_DELIVERY_NOT_FOUND',
        domain: 'crm',
        message: 'Sync delivery record not found.',
      });
    }
    if (asString(existing.status) === 'succeeded') {
      return formatDelivery(existing);
    }
    const now = new Date().toISOString();
    const updated = (
      await repo.updateOne({
        filter: { id: deliveryId },
        values: {
          status: 'pending',
          errorMessage: null,
          updatedAt: now,
        },
      })
    ).record;
    await this.enqueueJob(deliveryId);
    return formatDelivery(updated);
  }

  private async enqueueJob(deliveryId: string) {
    if (!this.accepting || !this.executor || !this.JobClass) {
      throw new ApiError({
        status: 'UNAVAILABLE',
        reason: 'INTEGRATION_EXECUTOR_UNAVAILABLE',
        domain: 'crm',
        message: 'Integration sync executor is not ready.',
      });
    }
    await this.executor.addJob(new this.JobClass({ deliveryId }));
  }

  async deliver(
    deliveryId: string,
    context: JobExecutionContext,
  ): Promise<void> {
    context.signal.throwIfAborted();
    const repo = this.connection().repository('crmSyncDeliveries');
    const row = await repo.findOne({ filter: { id: deliveryId } });
    if (!row || asString(row.status) === 'succeeded') return;

    const target = await this.ensureDefaultTarget();
    const attemptNumber = Number(row.attempts ?? 0) + 1;
    const now = new Date().toISOString();
    const idempotencyKey = asString(row.idempotencyKey);

    if (!target.enabled) {
      await repo.updateOne({
        filter: { id: deliveryId },
        values: {
          status: 'failed',
          attempts: attemptNumber,
          httpStatus: null,
          errorMessage: 'ERP sync target is disabled.',
          lastAttemptAt: now,
          updatedAt: now,
        },
      });
      return;
    }

    if (target.endpointUrl.startsWith('mock://erp-finance')) {
      if (target.simulateFailure) {
        await repo.updateOne({
          filter: { id: deliveryId },
          values: {
            status: 'failed',
            attempts: attemptNumber,
            httpStatus: 503,
            errorMessage:
              'Simulated ERP endpoint outage (HTTP 503). Disable failure simulation and retry.',
            lastAttemptAt: now,
            updatedAt: now,
          },
        });
        return;
      }

      const existingRef = this.mockErpLedger.get(idempotencyKey);
      const digest = createHash('sha256')
        .update(idempotencyKey)
        .digest('hex')
        .slice(0, 8)
        .toUpperCase();
      const externalReference = existingRef ?? `ERP-SO-${digest}`;
      this.mockErpLedger.set(idempotencyKey, externalReference);

      await repo.updateOne({
        filter: { id: deliveryId },
        values: {
          status: 'succeeded',
          attempts: attemptNumber,
          httpStatus: 200,
          externalReference,
          errorMessage: null,
          lastAttemptAt: now,
          succeededAt: now,
          updatedAt: now,
        },
      });
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-CRM-Event': asString(row.eventType),
      };
      if (target.secretHeader) {
        headers['X-Integration-Secret'] = target.secretHeader;
      }
      const response = await fetch(target.endpointUrl, {
        method: 'POST',
        headers,
        body: asString(row.payloadSnapshot),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 240);
        await repo.updateOne({
          filter: { id: deliveryId },
          values: {
            status: 'failed',
            attempts: attemptNumber,
            httpStatus: response.status,
            errorMessage: `HTTP ${response.status}${text ? `: ${text}` : ''}`,
            lastAttemptAt: now,
            updatedAt: now,
          },
        });
        return;
      }
      let externalReference: string | null = null;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (typeof body.externalReference === 'string') {
          externalReference = body.externalReference;
        } else if (typeof body.orderId === 'string') {
          externalReference = body.orderId;
        } else if (typeof body.id === 'string') {
          externalReference = body.id;
        }
      } catch {
        // Non-JSON 2xx responses still count as delivered.
      }
      await repo.updateOne({
        filter: { id: deliveryId },
        values: {
          status: 'succeeded',
          attempts: attemptNumber,
          httpStatus: response.status,
          externalReference:
            externalReference ??
            `ERP-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 8).toUpperCase()}`,
          errorMessage: null,
          lastAttemptAt: now,
          succeededAt: now,
          updatedAt: now,
        },
      });
    } catch (error) {
      await repo.updateOne({
        filter: { id: deliveryId },
        values: {
          status: 'failed',
          attempts: attemptNumber,
          httpStatus: null,
          errorMessage: (error instanceof Error
            ? error.message
            : 'Network error during ERP delivery'
          ).slice(0, 500),
          lastAttemptAt: now,
          updatedAt: now,
        },
      });
    }
  }
}

export const crmIntegrationsToken =
  createServiceToken<CrmIntegrationsService>('crm/integrations');

export default class CrmIntegrationsProvider extends ServiceProvider<Application> {
  readonly name = 'crm.integrations';
  private executor: JobExecutor | undefined;
  private releases: (() => void)[] = [];

  override register(): void {
    this.app.container.singleton(
      crmIntegrationsToken,
      () => new CrmIntegrationsService(this.app),
    );
  }

  override async boot(): Promise<void> {
    if (this.app.container.has(apiKeyScopesToken)) {
      const scopes = this.app.container.resolve(apiKeyScopesToken);
      scopes.mapAccess((ref: AccessRef) => {
        if (ref.kind === 'page') {
          return { resource: { type: 'page', id: ref.id }, action: 'access' };
        }
        if (ref.kind === 'settings') {
          return {
            resource: { type: 'settings', id: ref.id },
            action: ref.action,
          };
        }
        return {
          resource: { type: 'composite', id: ref.id },
          action: ref.action,
        };
      });

      this.releases.push(
        scopes.groups.add({
          id: 'crm.leads',
          category: 'business',
          title: { key: 'integrations.scopeLeadsTitle', ns: 'app' },
          description: { key: 'integrations.scopeLeadsDesc', ns: 'app' },
          levels: {
            read: [{ kind: 'business', id: 'crm.records', action: 'view' }],
            write: [
              { kind: 'business', id: 'crm.records', action: 'createCustomer' },
              { kind: 'business', id: 'crm.records', action: 'editCustomer' },
              { kind: 'business', id: 'crm.records', action: 'addContact' },
              { kind: 'business', id: 'crm.records', action: 'editContact' },
            ],
          },
        }),
      );

      this.releases.push(
        scopes.groups.add({
          id: 'crm.integrations',
          category: 'business',
          title: { key: 'integrations.scopeSyncTitle', ns: 'app' },
          description: { key: 'integrations.scopeSyncDesc', ns: 'app' },
          levels: {
            read: [
              { kind: 'business', id: 'crm.integrations', action: 'read' },
            ],
            write: [
              { kind: 'business', id: 'crm.integrations', action: 'sync' },
            ],
          },
        }),
      );

      this.releases.push(
        scopes.presets.add({
          id: 'lead-intake',
          title: { key: 'integrations.presetLeadIntake', ns: 'app' },
          description: { key: 'integrations.presetLeadIntakeDesc', ns: 'app' },
          groups: {
            'crm.leads': { level: 'write' },
          },
          expiresInDays: 90,
        }),
      );

      this.releases.push(
        scopes.presets.add({
          id: 'erp-sync',
          title: { key: 'integrations.presetErpSync', ns: 'app' },
          description: { key: 'integrations.presetErpSyncDesc', ns: 'app' },
          groups: {
            'crm.leads': { level: 'read' },
            'crm.integrations': { level: 'write' },
          },
          expiresInDays: 90,
        }),
      );
    }
  }

  override async start(): Promise<void> {
    const service = this.app.container.resolve(crmIntegrationsToken);
    const JobClass = createErpSyncJob((deliveryId, context) =>
      service.deliver(deliveryId, context),
    );
    this.executor = this.app.container
      .resolve(jobExecutorServiceToken)
      .getJobExecutor('crm.integrations');
    this.executor.registerJob(JobClass);
    await this.executor.setup({ consume: true });
    service.attach(this.executor, JobClass);
  }

  override async shutdown(): Promise<void> {
    this.app.container.resolve(crmIntegrationsToken).stopAccepting();
    await this.executor?.shutdown();
    for (const release of this.releases) release();
    this.releases = [];
  }
}
