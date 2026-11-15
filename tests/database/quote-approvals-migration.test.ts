import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202611150001_quote_approvals', {
  reversible: false,
  sources: [
    {
      packageName: 'crm-approval-test',
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
    const quote = await connection
      .repository('crmQuotes')
      .findOne({ filter: { id: 'retained-quote' } });
    const line = await connection
      .repository('crmQuoteLines')
      .findOne({ filter: { id: 'retained-line' } });
    expect(quote).toMatchObject({
      name: 'Retained quote',
      customerId: 'retained-customer',
      opportunityId: 'retained-opportunity',
      revision: 0,
    });
    expect(Number(quote?.totalCents)).toBe(180);
    expect(line).toMatchObject({
      productName: 'Historical name',
      customerId: 'retained-customer',
    });
    expect(Number(line?.amountCents)).toBe(180);

    await expectCollection('crmQuotes').toHaveField('revision', {
      type: 'integer',
      nullable: false,
    });
    await expectCollection('crmQuoteApprovals').toHaveField('snapshot', {
      type: 'json',
      nullable: false,
    });
    await expectCollection('crmApprovalParameterSnapshots').toExist();
    await expectCollection('crmCustomers').toHaveField('notes', {
      type: 'text',
      nullable: false,
    });
  },
});
