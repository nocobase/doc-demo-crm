import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
// Installation data is self-contained so the database task loader needs no application-source imports.
function crmPermissionSet(manager: boolean) {
  const scope = manager ? 'allRecords' : 'crm.owned';
  let set = definePermissionSet(
    manager ? 'crm-sales-manager' : 'crm-sales',
  ).title({
    key: manager ? 'crmAccess.manager' : 'crmAccess.sales',
    ns: 'doc-demo-crm',
  });
  for (const id of [
    'crm.workspace',
    'crm.customers',
    'crm.products',
    'crm.tasks',
  ]) {
    set = set.grant({
      resource: { type: 'page', id },
      actions: [{ action: 'access' }],
    });
  }
  const customer = { customers: scope };
  const opportunity = { opportunities: scope, ...customer };
  const quote = { quotes: scope, lines: scope, ...opportunity };
  const catalog = { products: 'allRecords' };
  const imports = { batches: manager ? 'allRecords' : 'crm.submitted' };
  const objects: Record<string, Record<string, Record<string, string>>> = {
    'crm.imports': { view: imports, create: imports },
    'crm.customers': {
      view: customer,
      create: customer,
      edit: customer,
      ...(manager ? { assignOwner: customer, share: customer } : {}),
      attachFile: customer,
      removeFile: customer,
      schedule: customer,
      completeReminder: customer,
      cancelReminder: customer,
      useAssistant: customer,
    },
    'crm.contacts': {
      view: { contacts: scope },
      create: { contacts: scope, customers: scope },
      edit: { contacts: scope, customers: scope },
    },
    'crm.followUps': {
      view: { followUps: scope },
      create: { followUps: scope, customers: scope },
    },
    'crm.opportunities': {
      view: { opportunities: scope },
      create: opportunity,
      edit: opportunity,
    },
    'crm.quotes': {
      view: { quotes: scope, lines: scope },
      create: { ...quote, ...catalog },
      edit: { ...quote, ...catalog },
      submit: quote,
      withdraw: quote,
      ...(manager ? { approve: quote, reject: quote, return: quote } : {}),
      issue: quote,
    },
    'crm.products': {
      view: catalog,
      ...(manager ? { create: catalog, edit: catalog } : {}),
    },
  };
  for (const [id, actions] of Object.entries(objects)) {
    set = set.grant({
      resource: { type: 'composite', id },
      actions: Object.entries(actions).map(([action, scopes]) => ({
        action,
        policy: { type: 'composite', scopes },
      })),
    });
  }
  return set.build();
}
export default defineSeed({
  name: '202611120004_crm_roles',
  transaction: true,
  async run({ query }) {
    for (const manager of [false, true]) {
      const set = crmPermissionSet(manager);
      const existing = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', set.key)
        .executeTakeFirst();
      if (existing) continue;
      const now = new Date();
      await query
        .insertInto('authorizationPermissionSets')
        .values({
          id: set.key,
          key: set.key,
          title: encodeAuthorizationTitle(set.title),
          grants: JSON.stringify(set.grants),
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
    // Assignment is explicitly performed in System settings → Users, never by a wildcard seed.
  },
});
