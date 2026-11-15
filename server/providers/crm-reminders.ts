import { z } from 'zod';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import {
  userManagementServiceToken,
  UserManagementError,
} from '@nocobase/app-plugin-users/server/tokens';
import {
  crmNotificationsToken,
  enqueueCrmNotification,
  eventIdentity,
} from './crm-notifications.js';
export class CrmRemindersService {
  constructor(private readonly app: Application) {}
  async scan(now = new Date()) {
    const connection = this.app.container
      .resolve(databaseManagerToken)
      .connection();
    let cursor = '';
    let queued = 0,
      skipped = 0,
      checked = 0;
    while (true) {
      const rows = await connection.query
        .selectFrom('crmReminders')
        .selectAll()
        .where('status', '=', 'pending')
        .where('dueAt', '<=', now.toISOString())
        .where('id', '>', cursor)
        .orderBy('id')
        .limit(100)
        .execute();
      if (!rows.length) break;
      checked += rows.length;
      cursor = String(rows.at(-1)!.id);
      for (const candidate of rows) {
        const currentCustomer = await connection
          .repository('crmCustomers')
          .findOne({ filter: { id: String(candidate.customerId) } });
        if (
          !currentCustomer ||
          currentCustomer.status === 'inactive' ||
          !currentCustomer.ownerId
        ) {
          skipped++;
          continue;
        }
        try {
          const owner = await this.app.container
            .resolve(userManagementServiceToken)
            .get(z.string().parse(currentCustomer.ownerId));
          if (owner.disabledAt) {
            skipped++;
            continue;
          }
        } catch (error) {
          if (
            error instanceof UserManagementError &&
            error.code === 'USER_NOT_FOUND'
          ) {
            skipped++;
            continue;
          }
          throw error;
        }

        const didQueue = await connection.transaction(async (tx) => {
          const reminder = await tx.repository('crmReminders').findOne({
            filter: { id: String(candidate.id), status: 'pending' },
          });
          if (
            !reminder ||
            z.coerce.date().parse(reminder.dueAt).getTime() > now.getTime()
          )
            return false;
          const customer = await tx
            .repository('crmCustomers')
            .findOne({ filter: { id: z.string().parse(reminder.customerId) } });
          if (
            !customer ||
            customer.status === 'inactive' ||
            customer.ownerId !== currentCustomer.ownerId
          )
            return false;
          if (reminder.kind === 'quoteExpiry') {
            const opportunity = await tx
              .repository('crmOpportunities')
              .findOne({
                filter: {
                  id: z.string().parse(reminder.opportunityId),
                  customerId: z.string().parse(reminder.customerId),
                },
              });
            const quote = await tx.repository('crmQuoteApprovals').findOne({
              filter: {
                quoteId: z.string().parse(reminder.quoteId),
                status: 'confirmed',
              },
            });
            if (
              !opportunity ||
              !quote ||
              ['won', 'lost'].includes(z.string().parse(opportunity.stage))
            )
              return false;
          }
          const claim = await tx.query
            .updateTable('crmReminders')
            .set({ status: 'notified', updatedAt: now.toISOString() })
            .where('id', '=', z.string().parse(reminder.id))
            .where('status', '=', 'pending')
            .execute();
          if (Number(claim.updatedCount) !== 1) return false;
          await enqueueCrmNotification(tx, {
            id: eventIdentity('reminder', z.string().parse(reminder.id)),
            scenario:
              reminder.kind === 'quoteExpiry' ? 'quoteDue' : 'followUpDue',
            recipientId: z.string().parse(customer.ownerId),
            targetPath: `/customers/${z.string().parse(reminder.customerId)}/details/reminders`,
          });
          return true;
        });
        if (didQueue) queued++;
        else skipped++;
      }
    }
    await this.app.container.resolve(crmNotificationsToken).flush();
    return { checked, queued, skipped };
  }
}
export const crmRemindersToken =
  createServiceToken<CrmRemindersService>('crm/reminders');
export default class CrmRemindersProvider extends ServiceProvider<Application> {
  name = 'crm.reminders';
  override register() {
    this.app.container.singleton(
      crmRemindersToken,
      () => new CrmRemindersService(this.app),
    );
  }
  override async boot() {
    const scheduler = this.app.container.resolve(schedulerServiceToken);
    scheduler.registerTarget({
      type: 'crm.reminder-scan',
      title: 'CRM reminder check',
      validate: (config) => ({
        valid:
          !!config &&
          typeof config === 'object' &&
          Object.keys(config).length === 0,
      }),
      start: async () => ({
        state: 'completed' as const,
        outcome: 'succeeded' as const,
        result: await this.app.container.resolve(crmRemindersToken).scan(),
      }),
    });
    scheduler.defineSchedule({
      key: 'crm.reminders',
      title: 'Customer follow-up reminders',
      description:
        'Check due plans and queue notifications; delivery has separate logs.',
      schedule: { cron: '* * * * *', timezone: 'UTC' },
      target: { type: 'crm.reminder-scan', config: {} },
    });
  }
  override async shutdown() {
    await this.app.container.resolve(schedulerServiceToken).drain();
  }
}
