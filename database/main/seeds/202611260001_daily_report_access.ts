import { defineSeed } from '@nocobase/db';
import { z } from 'zod';

const reportPageGrant = z.object({
  resource: z.object({ type: z.literal('page'), id: z.literal('crm.dailyReports') }),
});

export default defineSeed({
  name: '202611260001_daily_report_access',
  transaction: true,
  async run({ query }) {
    const role = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'crm-sales-manager')
      .executeTakeFirst();
    if (!role) return;
    const raw: unknown = typeof role.grants === 'string' ? JSON.parse(role.grants) : role.grants;
    const grants = z.array(z.unknown()).parse(raw);
    if (grants.some((grant) => reportPageGrant.safeParse(grant).success)) return;
    grants.push({
      resource: { type: 'page', id: 'crm.dailyReports' },
      actions: [{ action: 'access' }],
    });
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
      .where('id', '=', role.id)
      .execute();
  },
});
