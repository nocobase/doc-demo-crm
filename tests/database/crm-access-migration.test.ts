import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202611120003_customer_access', {
  sources: [
    {
      packageName: 'crm-access-test',
      directory: path.resolve('database/main/migrations'),
    },
  ],
  up: async ({ expectCollection }) => {
    await expectCollection('crmCustomers').toHaveField('ownerId', {
      type: 'string',
      nullable: true,
    });
    await expectCollection('crmCustomers').toHaveIndex(['ownerId']);
    await expectCollection('crmContacts').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
  },
  down: async ({ expectCollection }) => {
    await expectCollection('crmCustomers').toHaveField('name', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmContacts').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
  },
});

describeMigration('202611120005_quote_customer_access', {
  reversible: false,
  sources: [
    {
      packageName: 'crm-access-test',
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
    await expectCollection('crmQuotes').toHaveField('customerId', {
      type: 'string',
      nullable: true,
    });
    await expectCollection('crmQuoteLines').toHaveIndex(['customerId']);
    const quote = await connection
      .repository('crmQuotes')
      .findOne({ filter: { id: 'retained-quote' } });
    const line = await connection
      .repository('crmQuoteLines')
      .findOne({ filter: { id: 'retained-line' } });
    const { expect } = await import('vitest');
    expect(quote).toMatchObject({
      customerId: 'retained-customer',
      opportunityId: 'retained-opportunity',
    });
    expect(Number(quote?.totalCents)).toBe(180);
    expect(Number(line?.amountCents)).toBe(180);
    expect(line).toMatchObject({
      customerId: 'retained-customer',
      quoteId: 'retained-quote',
      productName: 'Historical name',
    });
  },
});
