import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611250001_crm_data_imports',
  async up({ builder }) {
    await builder.createCollection('crmImportBatches', (c) => {
      c.uuid('id').primary().notNull();
      c.string('fileName', { length: 255 }).notNull();
      c.string('uploadedBy', { length: 128 }).notNull();
      c.string('uploadedByName', { length: 200 }).notNull();
      c.string('ownerId', { length: 128 });
      c.string('conflictMode', { length: 20 }).notNull().defaultTo('skip');
      c.string('transactionMode', { length: 20 })
        .notNull()
        .defaultTo('allOrNothing');
      c.string('status', { length: 24 }).notNull().defaultTo('queued');
      c.string('jobId', { length: 128 });
      c.integer('totalRows').notNull().defaultTo(0);
      c.integer('createdCustomers').notNull().defaultTo(0);
      c.integer('updatedCustomers').notNull().defaultTo(0);
      c.integer('createdContacts').notNull().defaultTo(0);
      c.integer('skippedRows').notNull().defaultTo(0);
      c.integer('failedRows').notNull().defaultTo(0);
      c.integer('progress').notNull().defaultTo(0);
      c.text('csvContent').notNull();
      c.text('summary').notNull().defaultTo('');
      c.datetime('startedAt');
      c.datetime('completedAt');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['uploadedBy', 'createdAt']);
      c.index(['status', 'createdAt']);
    });
    await builder.createCollection('crmImportErrors', (c) => {
      c.uuid('id').primary().notNull();
      c.uuid('batchId').notNull();
      c.integer('rowNumber').notNull();
      c.string('customerName', { length: 120 }).notNull().defaultTo('');
      c.string('contactEmail', { length: 200 }).notNull().defaultTo('');
      c.string('code', { length: 64 }).notNull();
      c.string('message', { length: 500 }).notNull();
      c.text('rawRow').notNull();
      c.datetime('createdAt').notNull();
      c.foreignKey('batchId', {
        references: { collection: 'crmImportBatches', fields: ['id'] },
        onDelete: 'cascade',
      });
      c.index(['batchId', 'rowNumber']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('crmImportErrors');
    await builder.dropCollection('crmImportBatches');
  },
});
