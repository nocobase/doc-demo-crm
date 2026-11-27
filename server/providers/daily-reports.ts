import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';

dayjs.extend(utc);
dayjs.extend(timezone);

export const reportTimezone = 'Asia/Shanghai';

export const DailyReport = z.object({
  reportDate: z.iso.date(),
  customers: z.number().int(),
  opportunities: z.number().int(),
  followUps: z.number().int(),
});

export async function generateDailyReport(
  connection: DatabaseConnection,
  runAt: Date,
) {
  const today = dayjs(runAt).tz(reportTimezone).format('YYYY-MM-DD');
  const reportDate = dayjs.utc(today).subtract(1, 'day').format('YYYY-MM-DD');
  const start = dayjs.tz(reportDate, reportTimezone).toISOString();
  const end = dayjs.tz(today, reportTimezone).toISOString();

  return connection.transaction(async (tx) => {
    const count = (collection: string) =>
      tx.repository(collection).count({
        filter: (f) =>
          f.and([
            f.date('createdAt').notBefore(start),
            f.date('createdAt').before(end),
          ]),
      });
    const counts = {
      customers: await count('crmCustomers'),
      opportunities: await count('crmOpportunities'),
      followUps: await count('crmFollowUps'),
    };
    const report = { reportDate, ...counts };
    await tx.repository('crmDailyReports').upsertOne({
      filter: { reportDate },
      create: report,
      update: counts,
    });
    return report;
  });
}

export default class DailyReportsProvider extends ServiceProvider<Application> {
  name = 'crm.daily-reports';
  override async boot() {
    const scheduler = this.app.container.resolve(schedulerServiceToken);
    const connection = this.app.container
      .resolve(databaseManagerToken)
      .connection();
    scheduler.registerTarget({
      type: 'crm.daily-report',
      title: 'Summarize sales activity',
      validate: (config) => ({
        valid: z.strictObject({}).safeParse(config).success,
      }),
      start: async () => ({
        state: 'completed',
        outcome: 'succeeded',
        result: await generateDailyReport(connection, new Date()),
      }),
    });
    scheduler.defineSchedule({
      key: 'crm.daily-sales-activity',
      title: 'Daily sales activity',
      description:
        'Summarize customers, opportunities and follow-ups created during the previous team calendar day.',
      schedule: { cron: '0 1 * * *', timezone: reportTimezone },
      target: { type: 'crm.daily-report', config: {} },
    });
  }
}
