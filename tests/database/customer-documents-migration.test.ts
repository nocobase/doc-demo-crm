import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202611150002_customer_documents', {
  sources: [
    {
      packageName: 'crm-documents-test',
      directory: path.resolve('database/main/migrations'),
    },
  ],
  before: async ({ connection }) => {
    const now = new Date().toISOString();
    await connection.repository('crmCustomers').createOne({
      values: {
        id: 'retained-customer',
        name: 'Retained customer',
        industry: '',
        website: '',
        notes: 'Keep original data',
        status: 'prospect',
        ownerId: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('crmProducts').createOne({
      values: {
        id: 'retained-product',
        name: 'Retained product',
        code: 'KEEP',
        unitPriceCents: 100,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('crmOpportunities').createOne({
      values: {
        id: 'retained-opportunity',
        customerId: 'retained-customer',
        name: 'Retained opportunity',
        stage: 'proposal',
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('crmQuotes').createOne({
      values: {
        id: 'retained-quote',
        opportunityId: 'retained-opportunity',
        customerId: 'retained-customer',
        name: 'Retained quote',
        currency: 'USD',
        totalCents: 180,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('crmQuoteLines').createOne({
      values: {
        id: 'retained-line',
        quoteId: 'retained-quote',
        customerId: 'retained-customer',
        productId: 'retained-product',
        productName: 'Historical name',
        productCode: 'HISTORICAL',
        position: 0,
        quantity: 2,
        unitPriceCents: 100,
        discountBasisPoints: 1000,
        amountCents: 180,
      },
    });
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('crmFiles').toHaveField('ownerId', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmQuoteDocuments').toHaveField('sourceSnapshot', {
      type: 'json',
      nullable: false,
    });
    expect(
      (
        await connection
          .repository('crmQuoteLines')
          .findOne({ filter: { id: 'retained-line' } })
      )?.productName,
    ).toBe('Historical name');
    await connection
      .repository('crmFiles')
      .createOne({
        values: {
          id: 'file',
          ownerId: 'user',
          disk: 'local',
          key: 'safe',
          filename: 'quote.docx',
          ext: 'docx',
          mimeType: 'application/octet-stream',
          size: 100,
          status: 'document',
          customerId: 'retained-customer',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    await connection
      .repository('crmQuoteDocuments')
      .createOne({
        values: {
          id: 'doc',
          quoteId: 'retained-quote',
          customerId: 'retained-customer',
          fileId: 'file',
          templateRevision: 1,
          snapshotHash: 'hash',
          sourceSnapshot: { total: 180 },
          createdAt: new Date().toISOString(),
        },
      });
  },
  down: async ({ connection, expectCollection }) => {
    await expectCollection('crmFiles').not.toExist();
    await expectCollection('crmQuoteDocuments').not.toExist();
    expect(
      Number(
        (
          await connection
            .repository('crmQuotes')
            .findOne({ filter: { id: 'retained-quote' } })
        )?.totalCents,
      ),
    ).toBe(180);
  },
});
