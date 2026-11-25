import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611250002_crm_integrations',
  async up({ builder }) {
    await builder.createCollection('crmSyncTargets', (c) => {
      c.uuid('id').primary().notNull();
      c.string('key', { length: 64 }).notNull();
      c.string('name', { length: 120 }).notNull();
      c.string('endpointUrl', { length: 500 }).notNull();
      c.string('secretHeader', { length: 200 }).notNull().defaultTo('');
      c.boolean('enabled').notNull().defaultTo(true);
      c.boolean('simulateFailure').notNull().defaultTo(false);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('key');
    });
    await builder.createCollection('crmSyncDeliveries', (c) => {
      c.uuid('id').primary().notNull();
      c.string('idempotencyKey', { length: 160 }).notNull();
      c.string('targetKey', { length: 64 }).notNull();
      c.string('entityType', { length: 24 }).notNull();
      c.string('entityId', { length: 64 }).notNull();
      c.string('customerId', { length: 64 }).notNull();
      c.string('entityTitle', { length: 160 }).notNull().defaultTo('');
      c.string('eventType', { length: 40 }).notNull();
      c.string('status', { length: 24 }).notNull().defaultTo('pending');
      c.integer('attempts').notNull().defaultTo(0);
      c.integer('httpStatus');
      c.string('externalReference', { length: 128 });
      c.string('errorMessage', { length: 500 });
      c.text('payloadSnapshot').notNull();
      c.datetime('lastAttemptAt');
      c.datetime('succeededAt');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('idempotencyKey');
      c.index(['entityType', 'entityId']);
      c.index(['status', 'createdAt']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('crmSyncDeliveries');
    await builder.dropCollection('crmSyncTargets');
  },
});
