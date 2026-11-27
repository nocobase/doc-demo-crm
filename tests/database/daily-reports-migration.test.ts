import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';

describeMigration('202611260001_sales_activity_reports', {
  sources: [
    { packageName: 'crm', directory: path.resolve('database/main/migrations') },
  ],
  up: async ({ expectCollection }) => {
    await expectCollection('crmDailyReports').toExist();
  },
  down: async ({ expectCollection }) => {
    await expectCollection('crmDailyReports').not.toExist();
    await expectCollection('crmFollowUps').toExist();
  },
});
