import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611260001_sales_activity_reports',
  async up({ builder }) {
    await builder.createCollection('crmDailyReports', (c) => {
      c.string('reportDate', { length: 10 }).primary().notNull();
      c.integer('customers').notNull();
      c.integer('opportunities').notNull();
      c.integer('followUps').notNull();
    });
  },
  async down({ builder }) {
    await builder.dropCollection('crmDailyReports');
  },
});
