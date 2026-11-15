import type { DatabaseConnection } from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';

/** Caller has checked customer and quote access; use the same transaction for edit and submit. */
export async function lockQuote(connection: DatabaseConnection, id: string) {
  const repository = connection.repository('crmQuotes');
  const record = await repository.findOne({ filter: { id } });
  if (!record)
    throw new ApiError({
      status: 'NOT_FOUND',
      reason: 'QUOTE_NOT_FOUND',
      domain: 'crm',
      message: 'Quotation not found.',
    });
  const revision = Number(record.revision);
  const result = await repository.updateMany({
    filter: { id, revision },
    values: { revision: revision + 1 },
  });
  if (result.updatedCount !== 1)
    throw new ApiError({
      status: 'ABORTED',
      reason: 'QUOTE_CHANGED',
      domain: 'crm',
      message: 'The quotation changed. Reload before trying again.',
    });
}
export async function assertQuoteEditable(
  connection: DatabaseConnection,
  quoteId: string,
) {
  const approval = await connection
    .repository('crmQuoteApprovals')
    .findOne({ filter: { quoteId } });
  if (
    approval &&
    !['draft', 'revision'].includes(
      typeof approval.status === 'string' ? approval.status : '',
    )
  )
    throw new ApiError({
      status: 'FAILED_PRECONDITION',
      reason: 'QUOTE_LOCKED',
      domain: 'crm',
      message: 'This quotation is locked by its approval state.',
    });
}
