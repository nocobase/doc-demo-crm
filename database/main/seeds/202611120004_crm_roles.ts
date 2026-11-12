import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
// Installation data is self-contained so the database task loader needs no application-source imports.
function crmPermissionSet(manager:boolean) {
 const scope=manager?'allRecords':'crm.owned';
 const actions:Record<string,Record<string,string>>={
  view:{customers:scope,contacts:scope,followUps:scope,opportunities:scope,quotes:scope,lines:scope},
  createCustomer:{customers:scope},editCustomer:{customers:scope},
  addContact:{customers:scope,contacts:scope},editContact:{customers:scope,contacts:scope},
  recordFollowUp:{customers:scope,followUps:scope},
  createOpportunity:{customers:scope,opportunities:scope},editOpportunity:{customers:scope,opportunities:scope},
  createQuote:{customers:scope,opportunities:scope,quotes:scope,lines:scope,products:'allRecords'},
  editQuote:{customers:scope,opportunities:scope,quotes:scope,lines:scope,products:'allRecords'},
  ...(manager?{assignOwner:{customers:'allRecords'},shareCustomer:{customers:'allRecords'}}:{})
 };
 return definePermissionSet(manager?'crm-sales-manager':'crm-sales').title({key:manager?'crmAccess.manager':'crmAccess.sales',ns:'app'})
  .grant({resource:{type:'page',id:'customers'},actions:[{action:'access'}]})
  .grant({resource:{type:'composite',id:'crm.records'},actions:Object.entries(actions).map(([action,scopes])=>({action,policy:{type:'composite',scopes}}))})
  .grant({resource:{type:'composite',id:'crm.products'},actions:(manager?['view','create','edit']:['view']).map(action=>({action,policy:{type:'composite',scopes:{products:'allRecords'}}}))}).build();
}

export default defineSeed({name:'202611120004_crm_roles',transaction:true,async run({query}) {
 for(const manager of [false,true]) {
  const set=crmPermissionSet(manager);
  const existing=await query.selectFrom('authorizationPermissionSets').select('id').where('key','=',set.key).executeTakeFirst();
  if(existing) continue;
  const now=new Date();
  await query.insertInto('authorizationPermissionSets').values({id:set.key,key:set.key,title:encodeAuthorizationTitle(set.title),grants:JSON.stringify(set.grants),createdAt:now,updatedAt:now}).execute();
 }
 // Assignment is explicitly performed in System settings → Users, never by a wildcard seed.
}});
