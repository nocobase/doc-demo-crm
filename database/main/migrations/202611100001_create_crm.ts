import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611100001_create_crm',
  async up({ builder }) {
    await builder.createCollection('crmCustomers', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('industry', { length: 100 }).notNull();
      c.string('status', { length: 20 }).notNull();
      c.string('website', { length: 200 }).notNull();
      c.text('notes').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['status', 'name']);
      c.index('name');
    });
    await builder.createCollection('crmContacts', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('customerId', { length: 64 }).notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('role', { length: 100 }).notNull();
      c.string('email', { length: 200 }).notNull();
      c.string('phone', { length: 60 }).notNull();
      c.datetime('createdAt').notNull();
      c.foreignKey('customerId', { references: { collection: 'crmCustomers', fields: ['id'] }, onDelete: 'restrict' });
      c.index('customerId');
    });
    await builder.createCollection('crmFollowUps', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('customerId', { length: 64 }).notNull();
      c.string('channel', { length: 20 }).notNull();
      c.text('content').notNull();
      c.text('nextStep').notNull();
      c.string('authorName', { length: 200 }).notNull();
      c.datetime('createdAt').notNull();
      c.foreignKey('customerId', { references: { collection: 'crmCustomers', fields: ['id'] }, onDelete: 'restrict' });
      c.index(['customerId', 'createdAt']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('crmFollowUps');
    await builder.dropCollection('crmContacts');
    await builder.dropCollection('crmCustomers');
  },
});
