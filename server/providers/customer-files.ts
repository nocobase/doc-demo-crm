import { randomUUID, createHash } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { ApiError } from '@nocobase/app-server/router';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { serverFileRepositoryManagerToken } from '@nocobase/app-plugin-file/server';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { z } from 'zod';
import type {
  RepositoryFilter,
  RepositoryRecord,
} from '@nocobase/repository-input';
import { lockQuote } from './quote-lock.js';
import { DOCX_MIME, renderQuotation } from './quotation-renderer.js';
export const FileRow = z.object({
  id: z.string(),
  disk: z.string(),
  key: z.string(),
  filename: z.string(),
  ext: z.string(),
  mimeType: z.string(),
  size: z.union([z.string(), z.number()]),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  ownerId: z.string(),
  customerId: z.string().nullable(),
  status: z.string(),
});
export type CustomerFile = z.infer<typeof FileRow>;
const FrozenQuote = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.literal('USD'),
  total: z.number(),
  lines: z
    .array(
      z.object({
        productName: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        discount: z.number(),
        amount: z.number(),
      }),
    )
    .min(1)
    .max(100),
});
export const fileMissing = () =>
  new ApiError({
    status: 'NOT_FOUND',
    reason: 'FILE_NOT_FOUND',
    domain: 'crm',
    message: 'File not found.',
  });
export const fileConflict = () =>
  new ApiError({
    status: 'FAILED_PRECONDITION',
    reason: 'FILE_STATE_CHANGED',
    domain: 'crm',
    message: 'The file is no longer available for this operation.',
  });
export class CustomerFilesService {
  constructor(private readonly app: Application) {}
  get connection() {
    return this.app.container.resolve(databaseManagerToken).connection();
  }
  repository(tx?: DatabaseConnection, defaults: Record<string, string> = {}) {
    return this.app.container
      .resolve(serverFileRepositoryManagerToken)
      .repository('crmFiles', {
        connection: 'main',
        transaction: tx,
        disk: 'local',
        accessPath: '/uploads/crmFiles',
        policy: {
          read: true,
          create: { scope: true, defaults },
          update: false,
          delete: false,
        },
      });
  }
  async get(id: string, tx = this.connection) {
    const row = await tx.repository('crmFiles').findOne({ filter: { id } });
    if (!row) throw fileMissing();
    return FileRow.parse(row);
  }
  async safe(row: CustomerFile, tx = this.connection) {
    const { disk: _disk, key: _key, ownerId, ...safe } = row;
    let uploader = '';
    try {
      uploader = (
        await this.app.container
          .resolve(userManagementServiceToken)
          .withConnection(tx)
          .get(ownerId)
      ).name;
    } catch {
      /* A deleted account does not remove historical files. */
    }
    return {
      ...safe,
      uploader,
      contentUrl: `${this.app.publicBasePath ?? ''}${this.repository().getUrl(row)}`,
    };
  }
  async list(customerId: string, page: number) {
    const r = this.connection.repository('crmFiles');
    const filter = { customerId, status: 'attached' };
    const rows = await r.findMany({
      filter,
      limit: 20,
      offset: (page - 1) * 20,
      sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
    });
    return {
      data: await Promise.all(rows.map((row) => this.safe(FileRow.parse(row)))),
      meta: { page, pageSize: 20, total: await r.count({ filter }) },
    };
  }
  async attach(
    tx: DatabaseConnection,
    customerId: string,
    actorId: string,
    ids: string[],
  ) {
    for (const id of ids) {
      const result = await tx.repository('crmFiles').updateMany({
        filter: { id, ownerId: actorId, status: 'staged', customerId: null },
        values: {
          status: 'attached',
          customerId,
          updatedAt: new Date().toISOString(),
        },
      });
      if (result.updatedCount !== 1) throw fileConflict();
    }
    return { ids };
  }
  async remove(tx: DatabaseConnection, customerId: string, id: string) {
    const result = await tx.repository('crmFiles').updateMany({
      filter: { id, customerId, status: 'attached' },
      values: { status: 'removed', updatedAt: new Date().toISOString() },
    });
    if (result.updatedCount !== 1) throw fileConflict();
    return { id };
  }
  async document(quoteId: string, tx = this.connection) {
    const doc = await tx
      .repository('crmQuoteDocuments')
      .findOne({ filter: { quoteId } });
    if (!doc) return null;
    const fileId = z.string().parse(doc.fileId);
    return {
      file: await this.safe(await this.get(fileId, tx), tx),
      templateRevision: doc.templateRevision,
      snapshotHash: doc.snapshotHash,
    };
  }
  async generate(
    tx: DatabaseConnection,
    quoteId: string,
    customerId: string,
    actorId: string,
    customer: string,
    opportunity: string,
  ) {
    await lockQuote(tx, quoteId);
    const existing = await this.document(quoteId, tx);
    if (existing) return existing;
    const approval = await tx
      .repository('crmQuoteApprovals')
      .findOne({ filter: { quoteId, status: 'confirmed' } });
    if (!approval)
      throw new ApiError({
        status: 'FAILED_PRECONDITION',
        reason: 'QUOTE_NOT_CONFIRMED',
        domain: 'crm',
        message: 'Confirm the quotation before generating a document.',
      });
    const quote = FrozenQuote.parse(approval.snapshot);
    const sourceSnapshot = {
      ...quote,
      customer,
      opportunity,
      templateRevision: 1,
    };
    const snapshotHash = createHash('sha256')
      .update(JSON.stringify(sourceSnapshot))
      .digest('hex');
    const data = {
      name: quote.name,
      customer,
      opportunity,
      currency: quote.currency,
      reference: quote.id,
      total: quote.total.toFixed(2),
      lines: quote.lines.map((line) => ({
        ...line,
        unitPrice: line.unitPrice.toFixed(2),
        discount: `${line.discount}%`,
        amount: line.amount.toFixed(2),
      })),
    };
    let bytes: Buffer;
    try {
      bytes = await renderQuotation(data);
    } catch {
      throw new ApiError({
        status: 'INTERNAL',
        reason: 'DOCUMENT_RENDER_FAILED',
        domain: 'crm',
        message: 'Unable to generate the quotation document. Try again.',
      });
    }
    if (bytes.length > 10 * 1024 * 1024) throw fileConflict();
    const { record } = await this.repository(tx, {
      ownerId: actorId,
      customerId,
      status: 'document',
    }).uploadOne({
      file: new File([new Uint8Array(bytes)], `quotation-${quote.id}.docx`, {
        type: DOCX_MIME,
      }),
    });
    await tx.repository('crmQuoteDocuments').createOne({
      values: {
        id: randomUUID(),
        quoteId,
        customerId,
        fileId: record.id,
        templateRevision: 1,
        snapshotHash,
        sourceSnapshot,
        createdAt: new Date().toISOString(),
      },
    });
    return {
      file: await this.safe(await this.get(record.id, tx), tx),
      templateRevision: 1,
      snapshotHash,
    };
  }
  async orphans(page: number, status?: 'staged' | 'deleting') {
    const r = this.connection.repository('crmFiles');
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const filter: RepositoryFilter<RepositoryRecord> = (f) =>
      f.and([
        f.string('customerId').eq(null),
        status
          ? f.string('status').eq(status)
          : f.or([
              f.string('status').eq('staged'),
              f.string('status').eq('deleting'),
            ]),
        f.date('createdAt').before(cutoff),
      ]);
    const rows = await r.findMany({
      filter,
      limit: 20,
      offset: (page - 1) * 20,
      sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
    });
    return {
      data: await Promise.all(rows.map((row) => this.safe(FileRow.parse(row)))),
      meta: { page, pageSize: 20, total: await r.count({ filter }) },
    };
  }
  async claimCleanup(tx: DatabaseConnection, id: string) {
    const row = await this.get(id, tx);
    if (
      row.customerId ||
      !['staged', 'deleting'].includes(row.status) ||
      new Date(row.createdAt).getTime() > Date.now() - 86400000
    )
      throw fileConflict();
    const result = await tx.repository('crmFiles').updateMany({
      filter: { id, customerId: null, status: row.status },
      values: { status: 'deleting', updatedAt: new Date().toISOString() },
    });
    if (result.updatedCount !== 1) throw fileConflict();
    return row;
  }
  async finishCleanup(row: CustomerFile) {
    const current = await this.connection
      .repository('crmFiles')
      .findOne({ filter: { id: row.id } });
    if (!current) return { id: row.id };
    if (current.status !== 'deleting' || current.customerId)
      throw fileConflict();
    const disk = this.app.container.resolve(driveManagerToken).use(row.disk);
    if (await disk.exists(row.key)) await disk.delete(row.key);
    await this.connection.repository('crmFiles').deleteOne({
      filter: { id: row.id, status: 'deleting', customerId: null },
    });
    return { id: row.id };
  }
}
