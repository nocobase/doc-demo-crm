import { randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { ApiError } from '@nocobase/app-server/router';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  UserManagementError,
  userManagementServiceToken,
} from '@nocobase/app-plugin-users/server/tokens';
import {
  databaseManagerToken,
  type DatabaseConnection,
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
import {
  ConflictMode,
  IMPORT_CSV_HEADERS,
  IntakeValidationError,
  TransactionMode,
  asString,
  escapeCsvCell,
  ingestCustomerRow,
  normalizeCustomerKey,
  parseCsvRecords,
  validateIntakeRecord,
  type ConflictModeValue,
  type IntakePolicies,
} from './crm-intake.js';
import {
  authorizeCrm,
  optionalCrm,
  scopedRepository,
  type CrmPolicies,
} from './crm-permissions.js';

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const CreateImportBatchInput = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  csvContent: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= MAX_IMPORT_BYTES,
      'CSV file exceeds the 2 MB limit.',
    ),
  conflictMode: ConflictMode.default('skip'),
  transactionMode: TransactionMode.default('allOrNothing'),
});

export const ImportBatchSummary = z.object({
  id: z.string(),
  fileName: z.string(),
  uploadedBy: z.string(),
  uploadedByName: z.string(),
  ownerId: z.string().nullable(),
  conflictMode: ConflictMode,
  transactionMode: TransactionMode,
  status: z.enum([
    'queued',
    'running',
    'completed',
    'completedWithErrors',
    'rolledBack',
    'failed',
  ]),
  jobId: z.string().nullable(),
  totalRows: z.number(),
  createdCustomers: z.number(),
  updatedCustomers: z.number(),
  createdContacts: z.number(),
  skippedRows: z.number(),
  failedRows: z.number(),
  progress: z.number(),
  summary: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ImportRowError = z.object({
  id: z.string(),
  batchId: z.string(),
  rowNumber: z.number(),
  customerName: z.string(),
  contactEmail: z.string(),
  code: z.string(),
  message: z.string(),
  rawRow: z.string(),
  createdAt: z.string(),
});

interface RowFailure {
  readonly rowNumber: number;
  readonly customerName: string;
  readonly contactEmail: string;
  readonly code: string;
  readonly message: string;
  readonly rawRow: Record<string, string>;
}

class RollbackBatchError extends Error {
  constructor(readonly failures: readonly RowFailure[]) {
    super('Import batch rolled back due to row errors.');
    this.name = 'RollbackBatchError';
  }
}

interface CrmImportPayload {
  readonly batchId: string;
}

function createCrmImportJob(
  processBatch: (
    batchId: string,
    context: JobExecutionContext,
  ) => Promise<void>,
) {
  return class CrmImportJob extends Job<CrmImportPayload> {
    static readonly jobName = 'crm.import.customers';

    async execute(context: JobExecutionContext): Promise<void> {
      context.signal.throwIfAborted();
      await processBatch(this.payload.batchId, context);
    }
  };
}

function formatBatch(row: RepositoryRecord) {
  return ImportBatchSummary.parse({
    id: asString(row.id),
    fileName: asString(row.fileName),
    uploadedBy: asString(row.uploadedBy),
    uploadedByName: asString(row.uploadedByName),
    ownerId: row.ownerId ? asString(row.ownerId) : null,
    conflictMode: row.conflictMode,
    transactionMode: row.transactionMode,
    status: row.status,
    jobId: row.jobId ? asString(row.jobId) : null,
    totalRows: Number(row.totalRows ?? 0),
    createdCustomers: Number(row.createdCustomers ?? 0),
    updatedCustomers: Number(row.updatedCustomers ?? 0),
    createdContacts: Number(row.createdContacts ?? 0),
    skippedRows: Number(row.skippedRows ?? 0),
    failedRows: Number(row.failedRows ?? 0),
    progress: Number(row.progress ?? 0),
    summary: asString(row.summary),
    startedAt: row.startedAt ? asString(row.startedAt) : null,
    completedAt: row.completedAt ? asString(row.completedAt) : null,
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  });
}

function formatError(row: RepositoryRecord) {
  return ImportRowError.parse({
    id: asString(row.id),
    batchId: asString(row.batchId),
    rowNumber: Number(row.rowNumber),
    customerName: asString(row.customerName),
    contactEmail: asString(row.contactEmail),
    code: asString(row.code),
    message: asString(row.message),
    rawRow: asString(row.rawRow, '{}'),
    createdAt: asString(row.createdAt),
  });
}

export class CrmImportsService {
  private executor: JobExecutor | undefined;
  private JobClass: ReturnType<typeof createCrmImportJob> | undefined;
  private accepting = true;

  constructor(private readonly app: Application) {}

  attach(
    executor: JobExecutor,
    JobClass: ReturnType<typeof createCrmImportJob>,
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

  async createBatchRecord(
    policies: CrmPolicies,
    tx: DatabaseConnection,
    actor: { readonly id: string; readonly name: string },
    input: z.infer<typeof CreateImportBatchInput>,
    batchId = randomUUID(),
  ) {
    if (!this.accepting || !this.executor || !this.JobClass) {
      throw new ApiError({
        status: 'UNAVAILABLE',
        reason: 'IMPORT_EXECUTOR_UNAVAILABLE',
        domain: 'crm',
        message: 'Background import executor is not ready.',
      });
    }

    let parsed: ReturnType<typeof parseCsvRecords>;
    try {
      parsed = parseCsvRecords(input.csvContent);
    } catch (error) {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'INVALID_CSV',
        domain: 'crm',
        message:
          error instanceof Error ? error.message : 'Unable to parse CSV input.',
      });
    }

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'EMPTY_CSV',
        domain: 'crm',
        message: 'CSV must contain a header row and at least one data row.',
      });
    }
    if (!parsed.headers.includes('customerName')) {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'MISSING_CUSTOMER_NAME_COLUMN',
        domain: 'crm',
        message:
          'CSV must include a customerName (or name / company) header column.',
      });
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'IMPORT_ROW_LIMIT_EXCEEDED',
        domain: 'crm',
        message: `Import files may contain at most ${MAX_IMPORT_ROWS} rows.`,
      });
    }

    const now = new Date().toISOString();
    const record = (
      await scopedRepository(tx, policies, 'crmImportBatches').createOne({
        values: {
          id: batchId,
          fileName: input.fileName,
          uploadedBy: actor.id,
          uploadedByName: actor.name,
          ownerId: actor.id,
          conflictMode: input.conflictMode,
          transactionMode: input.transactionMode,
          status: 'queued',
          jobId: null,
          totalRows: parsed.rows.length,
          createdCustomers: 0,
          updatedCustomers: 0,
          createdContacts: 0,
          skippedRows: 0,
          failedRows: 0,
          progress: 0,
          csvContent: input.csvContent,
          summary: 'Queued for background processing.',
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      })
    ).record;

    return formatBatch(record);
  }

  async enqueueBatch(batchId: string) {
    if (!this.accepting || !this.executor || !this.JobClass) {
      throw new ApiError({
        status: 'UNAVAILABLE',
        reason: 'IMPORT_EXECUTOR_UNAVAILABLE',
        domain: 'crm',
        message: 'Background import executor is not ready.',
      });
    }
    const receipt = await this.executor.addJob(new this.JobClass({ batchId }));
    const updated = (
      await this.connection()
        .repository('crmImportBatches')
        .updateOne({
          filter: { id: batchId },
          values: { jobId: receipt.jobId, updatedAt: new Date().toISOString() },
        })
    ).record;
    return formatBatch(updated);
  }

  async listBatches(policies: CrmPolicies) {
    const repo = scopedRepository(
      this.connection(),
      policies,
      'crmImportBatches',
    );

    const rows = await repo.findMany({
      limit: 50,
      sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
    });
    return rows.map(formatBatch);
  }

  async getBatch(policies: CrmPolicies, batchId: string) {
    const repo = scopedRepository(
      this.connection(),
      policies,
      'crmImportBatches',
    );
    const row = await repo.findOne({ filter: { id: batchId } });
    if (!row) {
      throw new ApiError({
        status: 'NOT_FOUND',
        reason: 'IMPORT_BATCH_NOT_FOUND',
        domain: 'crm',
        message: 'Import batch not found.',
      });
    }
    const errors = await this.connection()
      .repository('crmImportErrors')
      .findMany({
        filter: { batchId },
        limit: 500,
        sort: (s) => [s.field('rowNumber').asc()],
      });
    return {
      ...formatBatch(row),
      errors: errors.map(formatError),
    };
  }

  async errorsCsv(policies: CrmPolicies, batchId: string) {
    const batch = await this.getBatch(policies, batchId);
    const headers = [...IMPORT_CSV_HEADERS, 'errorCode', 'errorMessage'];
    const lines = [headers.join(',')];
    for (const err of batch.errors) {
      let raw: Record<string, string> = {};
      try {
        raw = JSON.parse(err.rawRow) as Record<string, string>;
      } catch {
        raw = {};
      }
      const values = [
        ...IMPORT_CSV_HEADERS.map((key) => raw[key] ?? ''),
        err.code,
        err.message,
      ];
      lines.push(values.map(escapeCsvCell).join(','));
    }
    return {
      fileName: `${batch.fileName.replace(/\.csv$/i, '')}-errors.csv`,
      csv: lines.join('\n'),
    };
  }

  async processBatch(
    batchId: string,
    context: JobExecutionContext,
  ): Promise<void> {
    context.signal.throwIfAborted();
    const connection = this.connection();
    const batchRepo = connection.repository('crmImportBatches');
    const errorRepo = connection.repository('crmImportErrors');
    const batch = await batchRepo.findOne({ filter: { id: batchId } });
    if (!batch) return;
    if (
      ['completed', 'completedWithErrors', 'rolledBack', 'failed'].includes(
        asString(batch.status),
      )
    ) {
      return;
    }

    const startedAt = new Date().toISOString();
    await batchRepo.updateOne({
      filter: { id: batchId },
      values: {
        status: 'running',
        startedAt,
        progress: 5,
        summary: 'Validating rows and checking permissions.',
        updatedAt: startedAt,
      },
    });
    await context.reportProgress(5);

    // Clear any partial error entries from a previous interrupted attempt.
    await errorRepo.deleteMany({ filter: { batchId } });

    const uploadedBy = asString(batch.uploadedBy);
    try {
      const user = await this.app.container
        .resolve(userManagementServiceToken)
        .get(uploadedBy);
      if (user.disabledAt) {
        await this.markFailed(
          batchId,
          'Submitting user account is disabled.',
          context,
        );
        return;
      }
    } catch (error) {
      if (
        error instanceof UserManagementError &&
        error.code === 'USER_NOT_FOUND'
      ) {
        await this.markFailed(
          batchId,
          'Submitting user no longer exists.',
          context,
        );
        return;
      }
      throw error;
    }

    const authz = this.app.container.resolve(authorizationToken);
    const principal = { type: 'user' as const, id: uploadedBy };
    const authzContext = authz.for({
      principal,
      subjects: [
        { type: 'authenticated', id: '*' },
        ...(await authz.subjects.resolveFor(principal)),
      ],
    });

    let policies: IntakePolicies;
    try {
      const batchPolicy = await authorizeCrm(authzContext, 'importCustomers');
      if (
        !(await scopedRepository(
          connection,
          batchPolicy,
          'crmImportBatches',
        ).findOne({ filter: { id: batchId } }))
      )
        throw new Error('Batch access denied');
      const view = {
        ...(await authorizeCrm(authzContext, 'viewCustomer')),
        ...(await optionalCrm(authzContext, 'viewContacts')),
      };
      policies = {
        view,
        createCustomer: await optionalCrm(authzContext, 'createCustomer'),
        editCustomer: await optionalCrm(authzContext, 'editCustomer'),
        addContact: await optionalCrm(authzContext, 'addContact'),
        editContact: await optionalCrm(authzContext, 'editContact'),
      };
    } catch {
      await this.markFailed(
        batchId,
        'Submitting user no longer holds CRM access permissions.',
        context,
      );
      return;
    }

    const conflictMode = ConflictMode.parse(batch.conflictMode);
    const transactionMode = TransactionMode.parse(batch.transactionMode);
    const ownerId = batch.ownerId ? asString(batch.ownerId) : uploadedBy;

    let parsed: ReturnType<typeof parseCsvRecords>;
    try {
      parsed = parseCsvRecords(asString(batch.csvContent));
    } catch (error) {
      await this.markFailed(
        batchId,
        error instanceof Error ? error.message : 'Invalid CSV payload.',
        context,
      );
      return;
    }

    if (transactionMode === 'allOrNothing') {
      await this.runAllOrNothing(
        batchId,
        parsed.rows,
        policies,
        ownerId,
        conflictMode,
        context,
      );
    } else {
      await this.runRowByRow(
        batchId,
        parsed.rows,
        policies,
        ownerId,
        conflictMode,
        context,
      );
    }
  }

  private async runAllOrNothing(
    batchId: string,
    rows: ReturnType<typeof parseCsvRecords>['rows'],
    policies: IntakePolicies,
    ownerId: string,
    conflictMode: ConflictModeValue,
    context: JobExecutionContext,
  ) {
    const connection = this.connection();
    const seenKeys = new Set<string>();
    const failures: RowFailure[] = [];
    let createdCustomers = 0;
    let updatedCustomers = 0;
    let createdContacts = 0;
    let skippedRows = 0;

    try {
      await connection.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i++) {
          context.signal.throwIfAborted();
          const row = rows[i];
          try {
            const payload = validateIntakeRecord(row.raw);
            const customerKey = normalizeCustomerKey(payload.customer.name);
            if (seenKeys.has(customerKey) && conflictMode === 'reject') {
              throw new IntakeValidationError(
                'DUPLICATE_IN_FILE',
                `Duplicate customer "${payload.customer.name}" appears earlier in the same file.`,
              );
            }
            seenKeys.add(customerKey);

            // If failures already occurred, continue validating rows without mutating unnecessarily.
            const result = await ingestCustomerRow(tx, policies, payload, {
              ownerId,
              conflictMode,
            });
            if (result.action === 'created') createdCustomers++;
            else if (result.action === 'updated') updatedCustomers++;
            else if (result.action === 'skipped') skippedRows++;
            if (result.contactCreated) createdContacts++;
          } catch (error) {
            const code =
              error instanceof IntakeValidationError
                ? error.code
                : 'INVALID_FIELD';
            failures.push({
              rowNumber: row.rowNumber,
              customerName: (row.raw.customerName ?? '').slice(0, 120),
              contactEmail: (row.raw.contactEmail ?? '').slice(0, 200),
              code,
              message:
                error instanceof Error ? error.message : 'Row validation error',
              rawRow: row.raw,
            });
          }
        }
        if (failures.length > 0) {
          throw new RollbackBatchError(failures);
        }
      });

      const doneAt = new Date().toISOString();
      await connection.repository('crmImportBatches').updateOne({
        filter: { id: batchId },
        values: {
          status: 'completed',
          createdCustomers,
          updatedCustomers,
          createdContacts,
          skippedRows,
          failedRows: 0,
          progress: 100,
          summary: `Committed atomically: ${createdCustomers} created, ${updatedCustomers} updated, ${skippedRows} skipped.`,
          completedAt: doneAt,
          updatedAt: doneAt,
        },
      });
      await context.reportProgress(100);
    } catch (error) {
      if (error instanceof RollbackBatchError) {
        const doneAt = new Date().toISOString();
        await this.persistErrors(batchId, error.failures, doneAt);
        await connection.repository('crmImportBatches').updateOne({
          filter: { id: batchId },
          values: {
            status: 'rolledBack',
            createdCustomers: 0,
            updatedCustomers: 0,
            createdContacts: 0,
            skippedRows: 0,
            failedRows: error.failures.length,
            progress: 100,
            summary: `Rolled back entire batch: ${error.failures.length} row(s) failed validation or conflict rules; 0 records written.`,
            completedAt: doneAt,
            updatedAt: doneAt,
          },
        });
        await context.reportProgress(100);
        return;
      }
      throw error;
    }
  }

  private async runRowByRow(
    batchId: string,
    rows: ReturnType<typeof parseCsvRecords>['rows'],
    policies: IntakePolicies,
    ownerId: string,
    conflictMode: ConflictModeValue,
    context: JobExecutionContext,
  ) {
    const connection = this.connection();
    const failures: RowFailure[] = [];
    let createdCustomers = 0;
    let updatedCustomers = 0;
    let createdContacts = 0;
    let skippedRows = 0;

    for (let i = 0; i < rows.length; i++) {
      context.signal.throwIfAborted();
      const row = rows[i];
      try {
        const payload = validateIntakeRecord(row.raw);
        const result = await connection.transaction((tx) =>
          ingestCustomerRow(tx, policies, payload, { ownerId, conflictMode }),
        );
        if (result.action === 'created') createdCustomers++;
        else if (result.action === 'updated') updatedCustomers++;
        else if (result.action === 'skipped') skippedRows++;
        if (result.contactCreated) createdContacts++;
      } catch (error) {
        const code =
          error instanceof IntakeValidationError ? error.code : 'INVALID_FIELD';
        failures.push({
          rowNumber: row.rowNumber,
          customerName: (row.raw.customerName ?? '').slice(0, 120),
          contactEmail: (row.raw.contactEmail ?? '').slice(0, 200),
          code,
          message:
            error instanceof Error ? error.message : 'Row validation error',
          rawRow: row.raw,
        });
      }
      const progress = Math.min(
        95,
        Math.round(((i + 1) / Math.max(rows.length, 1)) * 90) + 5,
      );
      await context.reportProgress(progress);
    }

    const doneAt = new Date().toISOString();
    if (failures.length > 0) {
      await this.persistErrors(batchId, failures, doneAt);
    }
    const status = failures.length > 0 ? 'completedWithErrors' : 'completed';
    await connection.repository('crmImportBatches').updateOne({
      filter: { id: batchId },
      values: {
        status,
        createdCustomers,
        updatedCustomers,
        createdContacts,
        skippedRows,
        failedRows: failures.length,
        progress: 100,
        summary:
          failures.length > 0
            ? `Processed row by row: ${createdCustomers} created, ${updatedCustomers} updated, ${skippedRows} skipped, ${failures.length} failed.`
            : `Processed row by row: ${createdCustomers} created, ${updatedCustomers} updated, ${skippedRows} skipped.`,
        completedAt: doneAt,
        updatedAt: doneAt,
      },
    });
    await context.reportProgress(100);
  }

  private async persistErrors(
    batchId: string,
    failures: readonly RowFailure[],
    createdAt: string,
  ) {
    const repo = this.connection().repository('crmImportErrors');
    for (const failure of failures) {
      await repo.createOne({
        values: {
          id: randomUUID(),
          batchId,
          rowNumber: failure.rowNumber,
          customerName: failure.customerName,
          contactEmail: failure.contactEmail,
          code: failure.code,
          message: failure.message.slice(0, 500),
          rawRow: JSON.stringify(failure.rawRow),
          createdAt,
        },
      });
    }
  }

  private async markFailed(
    batchId: string,
    summary: string,
    context: JobExecutionContext,
  ) {
    const doneAt = new Date().toISOString();
    await this.connection()
      .repository('crmImportBatches')
      .updateOne({
        filter: { id: batchId },
        values: {
          status: 'failed',
          progress: 100,
          summary,
          completedAt: doneAt,
          updatedAt: doneAt,
        },
      });
    await context.reportProgress(100);
  }
}

export const crmImportsToken =
  createServiceToken<CrmImportsService>('crm/imports');

export default class CrmImportsProvider extends ServiceProvider<Application> {
  readonly name = 'crm.imports';
  private executor: JobExecutor | undefined;

  override register(): void {
    this.app.container.singleton(
      crmImportsToken,
      () => new CrmImportsService(this.app),
    );
  }

  override async start(): Promise<void> {
    const service = this.app.container.resolve(crmImportsToken);
    const JobClass = createCrmImportJob((batchId, context) =>
      service.processBatch(batchId, context),
    );
    this.executor = this.app.container
      .resolve(jobExecutorServiceToken)
      .getJobExecutor('crm.imports');
    this.executor.registerJob(JobClass);
    await this.executor.setup({ consume: true });
    service.attach(this.executor, JobClass);
  }

  override async shutdown(): Promise<void> {
    this.app.container.resolve(crmImportsToken).stopAccepting();
    await this.executor?.shutdown();
  }
}
