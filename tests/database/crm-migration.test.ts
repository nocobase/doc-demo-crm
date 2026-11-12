import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611100001_create_crm', {
  sources: [
    {
      packageName: 'crm-test',
      directory: path.resolve('database/main/migrations'),
    },
  ],
  up: async ({ expectCollection }) => {
    await expectCollection('crmCustomers').toHaveField('name', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmContacts').toHaveField('customerId', {
      type: 'string',
      nullable: false,
    });
    await expectCollection('crmFollowUps').toHaveIndex([
      'customerId',
      'createdAt',
    ]);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('crmFollowUps').not.toExist();
    await expectCollection('crmContacts').not.toExist();
    await expectCollection('crmCustomers').not.toExist();
  },
});
