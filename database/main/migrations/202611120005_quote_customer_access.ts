import { defineMigration } from '@nocobase/db';
export default defineMigration({
 name:'202611120005_quote_customer_access',
 // Removing a column from a referenced parent table rebuilds it on SQLite.
 // Keep this data-preserving upgrade forward-only instead of promising unsafe rollback.
 irreversible:true,
 async up({builder,query}) {
  await builder.alterCollection('crmQuotes',c=>{c.string('customerId',{length:64,nullable:true});});
  await builder.alterCollection('crmQuoteLines',c=>{c.string('customerId',{length:64,nullable:true});});
  // Record Access operates on a collection's own columns. Preserve historical
  // parentage while materializing the customer key for native row policies.
  const quotes=await query.selectFrom('crmQuotes as quote').innerJoin('crmOpportunities as opportunity','opportunity.id','quote.opportunityId').select(['quote.id','opportunity.customerId']).execute();
  for(const quote of quotes) {
   await query.updateTable('crmQuotes').set({customerId:quote.customerId}).where('id','=',quote.id).execute();
   await query.updateTable('crmQuoteLines').set({customerId:quote.customerId}).where('quoteId','=',quote.id).execute();
  }
  await builder.alterCollection('crmQuotes',c=>{c.index('customerId',{name:'crm_quotes_customer_access_idx'});});
  await builder.alterCollection('crmQuoteLines',c=>{c.index('customerId',{name:'crm_quote_lines_customer_access_idx'});});
 }
});
