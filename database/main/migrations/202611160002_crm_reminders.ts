import { defineMigration } from '@nocobase/db';
export default defineMigration({name:'202611160002_crm_reminders',async up({builder}){
 await builder.createCollection('crmReminders',c=>{
  c.uuid('id').primary().notNull();c.uuid('customerId').notNull();c.string('kind',{length:24}).notNull();c.uuid('quoteId');c.uuid('opportunityId');c.string('title',{length:160}).notNull();c.datetime('dueAt').notNull();c.string('status',{length:24}).notNull().defaultTo('pending');c.string('createdBy',{length:128}).notNull();c.datetime('createdAt').notNull();c.datetime('updatedAt').notNull();c.index(['status','dueAt']);c.index(['customerId','createdAt']);
 });
},async down({builder}){await builder.dropCollection('crmReminders');}});
