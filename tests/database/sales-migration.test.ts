import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
const sources = [
  {
    packageName: 'crm-sales-test',
    directory: path.resolve('database/main/migrations'),
  },
];
describeMigration('202611120001_sales_model', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('crmProducts').toHaveField('unitPriceCents', {
      type: 'bigInt',
      nullable: false,
    });
    await expectCollection('crmOpportunities').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmQuotes').toHaveIndex(['opportunityId']);
    await expectCollection('crmQuoteLines').toHaveField('discountBasisPoints', {
      type: 'integer',
      nullable: false,
    });
    await expectCollection('crmCustomers').toHaveField('notes', {
      type: 'text',
      nullable: false,
    });
  },
  down: async ({ expectCollection }) => {
    await expectCollection('crmQuoteLines').not.toExist();
    await expectCollection('crmQuotes').not.toExist();
    await expectCollection('crmOpportunities').not.toExist();
    await expectCollection('crmProducts').not.toExist();
    await expectCollection('crmCustomers').toHaveField('notes', {
      type: 'text',
      nullable: false,
    });
  },
});
describeMigration('202611120002_sales_relations', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('crmOpportunities').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmQuoteLines').toHaveField('quoteId', {
      type: 'string',
      nullable: false,
    });
  },
  down: async ({ expectCollection }) => {
    await expectCollection('crmOpportunities').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmQuoteLines').toHaveField('quoteId', {
      type: 'string',
      nullable: false,
    });
  },
});
