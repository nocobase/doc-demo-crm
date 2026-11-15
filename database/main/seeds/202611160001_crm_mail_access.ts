import { defineSeed } from '@nocobase/db';
// Extend only the two explicit tutorial roles; preserve their customized grants.
export default defineSeed({name:'202611160001_crm_mail_access',transaction:true,async run({query}) {
 for(const key of ['crm-sales','crm-sales-manager']) {
  const row=await query.selectFrom('authorizationPermissionSets').select(['id','grants']).where('key','=',key).executeTakeFirst();
  if(!row) continue;
  const grants=typeof row.grants==='string'?JSON.parse(row.grants):row.grants;
  if(!Array.isArray(grants)) throw new Error('Invalid CRM permission grants');
  if(!grants.some(g=>g.resource?.type==='page'&&g.resource?.id==='mail.workspace')) grants.push({resource:{type:'page',id:'mail.workspace'},actions:[{action:'access'}]});
  await query.updateTable('authorizationPermissionSets').set({grants:JSON.stringify(grants),updatedAt:new Date()}).where('id','=',row.id).execute();
 }
}});
