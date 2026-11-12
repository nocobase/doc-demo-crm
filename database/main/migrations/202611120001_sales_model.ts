import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611120001_sales_model',
  async up({ builder }) {
    await builder.createCollection('crmProducts', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('code', { length: 40 }).notNull().unique();
      c.bigInt('unitPriceCents').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('crmOpportunities', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('customerId', { length: 64 }).notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('stage', { length: 20 }).notNull();
      c.text('notes').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.foreignKey('customerId', { references: { collection: 'crmCustomers', fields: ['id'] }, onDelete: 'restrict' });
      c.index('customerId');
    });
    await builder.createCollection('crmQuotes', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('opportunityId', { length: 64 }).notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('currency', { length: 3 }).notNull();
      c.bigInt('totalCents').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.foreignKey('opportunityId', { references: { collection: 'crmOpportunities', fields: ['id'] }, onDelete: 'restrict' });
      c.index('opportunityId');
    });
    await builder.createCollection('crmQuoteLines', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('quoteId', { length: 64 }).notNull();
      c.string('productId', { length: 64 }).notNull();
      c.string('productName', { length: 120 }).notNull();
      c.string('productCode', { length: 40 }).notNull();
      c.integer('position').notNull();
      c.integer('quantity').notNull();
      c.bigInt('unitPriceCents').notNull();
      c.integer('discountBasisPoints').notNull();
      c.bigInt('amountCents').notNull();
      c.foreignKey('quoteId', { references: { collection: 'crmQuotes', fields: ['id'] }, onDelete: 'restrict' });
      c.foreignKey('productId', { references: { collection: 'crmProducts', fields: ['id'] }, onDelete: 'restrict' });
      c.index('quoteId');
      c.index('productId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('crmQuoteLines');
    await builder.dropCollection('crmQuotes');
    await builder.dropCollection('crmOpportunities');
    await builder.dropCollection('crmProducts');
  },
});
