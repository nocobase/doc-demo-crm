import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name:'202611150002_customer_documents',
  async up({builder}) {
    await builder.createCollection('crmFiles',c=>{
      c.uuid('id').primary().notNull(); c.string('disk',{length:255}).notNull();c.text('key').notNull();c.text('filename').notNull();c.string('ext',{length:32}).notNull();c.string('mimeType',{length:255}).notNull();c.bigInt('size').notNull();c.datetime('createdAt').notNull();c.datetime('updatedAt').notNull();
      c.string('ownerId',{length:128}).notNull();c.string('customerId',{length:64});c.string('status',{length:20}).notNull().defaultTo('staged');c.index(['customerId','status']);c.index(['ownerId','status']);
    });
    await builder.createCollection('crmQuoteDocuments',c=>{
      c.uuid('id').primary().notNull();c.string('quoteId',{length:64}).notNull().unique();c.string('customerId',{length:64}).notNull();c.uuid('fileId').notNull();c.integer('templateRevision').notNull();c.string('snapshotHash',{length:64}).notNull();c.json('sourceSnapshot').notNull();c.datetime('createdAt').notNull();
      c.foreignKey('quoteId',{references:{collection:'crmQuotes',fields:['id']},onDelete:'restrict'});c.foreignKey('fileId',{references:{collection:'crmFiles',fields:['id']},onDelete:'restrict'});
    });
  },
  async down({builder}) {await builder.dropCollection('crmQuoteDocuments');await builder.dropCollection('crmFiles');},
});
