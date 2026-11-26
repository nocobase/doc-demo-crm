import { defineSeed } from '@nocobase/db';

interface PermissionGrant {
  resource?: { type?: string; id?: string };
  actions?: { action?: string }[];
}

function parseGrants(raw: unknown): PermissionGrant[] {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) throw new Error('Invalid CRM permission grants');
  return parsed as PermissionGrant[];
}

// Extend the two CRM roles with Product knowledge access while preserving customized grants.
export default defineSeed({
  name: '202611250001_crm_knowledge_access',
  transaction: true,
  async run({ query }) {
    const kbActionsByRole: Record<string, readonly string[]> = {
      'crm-sales': ['read.all', 'propose.all'],
      'crm-sales-manager': ['read.all', 'propose.all', 'edit.all'],
    };
    for (const [key, kbActions] of Object.entries(kbActionsByRole)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      const grants = parseGrants(row.grants);

      if (
        !grants.some(
          (g) => g.resource?.type === 'page' && g.resource?.id === 'knowledge',
        )
      ) {
        grants.push({
          resource: { type: 'page', id: 'knowledge' },
          actions: [{ action: 'access' }],
        });
      }

      const existingKb = grants.find(
        (g) => g.resource?.type === 'kb' && g.resource?.id === 'kb.knowledge',
      );
      if (existingKb && Array.isArray(existingKb.actions)) {
        for (const action of kbActions) {
          if (!existingKb.actions.some((a) => a.action === action)) {
            existingKb.actions.push({ action });
          }
        }
      } else {
        grants.push({
          resource: { type: 'kb', id: 'kb.knowledge' },
          actions: kbActions.map((action) => ({ action })),
        });
      }

      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
        .where('id', '=', row.id)
        .execute();
    }
  },
});
