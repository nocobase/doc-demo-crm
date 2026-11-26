import { defineSeed } from '@nocobase/db';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

// The upstream personal key form now checks a separate creation permission.
// Preserve key issuance for the two explicit CRM roles. Key scopes still use the holder's grants.
export default defineSeed({
  name: '202611250004_crm_personal_api_keys',
  transaction: true,
  async run({ query }) {
    const roles = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', 'in', ['crm-sales', 'crm-sales-manager'])
      .execute();
    for (const role of roles) {
      const grants: Grant[] = (
        typeof role.grants === 'string' ? JSON.parse(role.grants) : role.grants
      ) as Grant[];
      const existing = grants.find(
        ({ resource }) =>
          resource.type === 'settings' && resource.id === 'personalApiKeys',
      );
      if (existing?.actions.some(({ action }) => action === 'create')) continue;
      if (existing) existing.actions.push({ action: 'create' });
      else
        grants.push({
          resource: { type: 'settings', id: 'personalApiKeys' },
          actions: [{ action: 'create' }],
        });
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
        .where('id', '=', String(role.id))
        .execute();
    }
  },
});
