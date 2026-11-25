import { defineSeed } from '@nocobase/db';

interface StoredGrant {
  resource?: { type?: string; id?: string };
  actions?: Array<{ action: string; policy?: unknown }>;
}

export default defineSeed({
  name: '202611250003_crm_integrations_access',
  transaction: true,
  async run({ query }) {
    const manager = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'crm-sales-manager')
      .executeTakeFirst();
    if (!manager || typeof manager.grants !== 'string') return;
    const grants = JSON.parse(manager.grants) as StoredGrant[];
    const hasIntegrations = grants.some(
      (g) =>
        g.resource?.type === 'composite' &&
        g.resource?.id === 'crm.integrations',
    );
    if (hasIntegrations) return;
    grants.push({
      resource: { type: 'composite', id: 'crm.integrations' },
      actions: [
        {
          action: 'read',
          policy: {
            type: 'composite',
            scopes: { deliveries: 'allRecords', targets: 'allRecords' },
          },
        },
        {
          action: 'sync',
          policy: {
            type: 'composite',
            scopes: { deliveries: 'allRecords', targets: 'allRecords' },
          },
        },
      ],
    });
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
      .where('id', '=', String(manager.id))
      .execute();
  },
});
