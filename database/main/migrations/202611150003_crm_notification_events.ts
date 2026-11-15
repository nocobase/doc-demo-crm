import { defineMigration } from '@nocobase/db';
export default defineMigration({name:'202611150003_crm_notification_events',async up({builder}){
 await builder.createCollection('crmNotificationEvents',c=>{
 c.string('id',{length:128}).primary().notNull();c.string('scenario',{length:32}).notNull();c.string('recipientId',{length:128}).notNull();c.text('targetPath').notNull();c.string('status',{length:20}).notNull().defaultTo('queued');c.string('notificationId',{length:128});c.integer('attempts').notNull().defaultTo(0);c.string('errorCategory',{length:64});c.datetime('createdAt').notNull();c.datetime('updatedAt').notNull();c.index(['status','createdAt']);
 });
},async down({builder}){await builder.dropCollection('crmNotificationEvents');}});
