import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202611120002_sales_relations',
  async up({ builder }) {
    // The physical foreign keys already exist; these declarations expose the
    // same relationships to Collection metadata and Repository relation queries.
    await builder.alterCollection('crmCustomers', (c) => { c.hasMany('opportunities', 'crmOpportunities').sourceKey('id').foreignKey('customerId').constraints(false); });
    await builder.alterCollection('crmOpportunities', (c) => { c.belongsTo('customer', 'crmCustomers', { index: false }).targetKey('id').foreignKey('customerId').constraints(false); c.hasMany('quotes', 'crmQuotes').sourceKey('id').foreignKey('opportunityId').constraints(false); });
    await builder.alterCollection('crmQuotes', (c) => { c.belongsTo('opportunity', 'crmOpportunities', { index: false }).targetKey('id').foreignKey('opportunityId').constraints(false); c.hasMany('lines', 'crmQuoteLines').sourceKey('id').foreignKey('quoteId').constraints(false); });
    await builder.alterCollection('crmQuoteLines', (c) => { c.belongsTo('quote', 'crmQuotes', { index: false }).targetKey('id').foreignKey('quoteId').constraints(false); c.belongsTo('product', 'crmProducts', { index: false }).targetKey('id').foreignKey('productId').constraints(false); });
    await builder.alterCollection('crmProducts', (c) => { c.hasMany('quoteLines', 'crmQuoteLines').sourceKey('id').foreignKey('productId').constraints(false); });
  },
  async down({ builder }) {
    await builder.alterCollection('crmProducts', (c) => { c.dropField('quoteLines'); });
    await builder.alterCollection('crmQuoteLines', (c) => { c.dropFields('quote', 'product'); });
    await builder.alterCollection('crmQuotes', (c) => { c.dropFields('opportunity', 'lines'); });
    await builder.alterCollection('crmOpportunities', (c) => { c.dropFields('customer', 'quotes'); });
    await builder.alterCollection('crmCustomers', (c) => { c.dropField('opportunities'); });
  },
});
