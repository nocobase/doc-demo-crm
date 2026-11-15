import { createHash } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import {
  notificationServiceToken,
  notificationTemplateRegistryToken,
  describeNotificationTemplateChannel,
  type NotificationConfigInput,
} from '@nocobase/app-plugin-notification/server';
import {
  userManagementServiceToken,
  UserManagementError,
} from '@nocobase/app-plugin-users/server/tokens';
import type { ScheduleExecutor } from '@nocobase/jobs';
import { z } from 'zod';
export const scenarios = [
  'assignment',
  'confirmed',
  'rejected',
  'returned',
] as const;
export type CrmNotificationScenario = (typeof scenarios)[number];
export function renderCrmNotification(scenario: CrmNotificationScenario) {
  if (scenario === 'assignment')
    return {
      title: 'Customer assigned to you',
      body: 'You have been assigned a customer. Open the customer to view the current details.',
    };
  const outcomes = {
    confirmed: 'confirmed',
    rejected: 'rejected',
    returned: 'returned for revision',
  };
  return {
    title: `Quotation ${outcomes[scenario]}`,
    body: `Your quotation was ${outcomes[scenario]}. Open it to view its current status. Reading this message does not complete an approval task.`,
  };
}
export function eventIdentity(...parts: string[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export async function enqueueCrmNotification(
  tx: DatabaseConnection,
  input: {
    id: string;
    scenario: CrmNotificationScenario;
    recipientId: string;
    targetPath: string;
  },
) {
  await tx.repository('crmNotificationEvents').createOne({
    values: {
      ...input,
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
}
const eventSchema = z.object({
  id: z.string(),
  scenario: z.enum(scenarios),
  recipientId: z.string(),
  targetPath: z.string(),
  attempts: z.number(),
});
export class CrmNotificationsService {
  private active: Promise<void> | undefined;
  private closing = false;
  async close() {
    this.closing = true;
    await this.active;
  }
  constructor(private readonly app: Application) {}
  flush(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async run() {
    const connection = this.app.container
      .resolve(databaseManagerToken)
      .connection();
    const repository = connection.repository('crmNotificationEvents');
    const notification = this.app.container.resolve(notificationServiceToken);
    const rows = await repository.findMany({
      filter: { status: 'queued' },
      limit: 100,
      sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
    });
    for (const raw of rows) {
      const event = eventSchema.parse(raw);
      const idempotencyKey = `crm-event:${event.id}`;
      try {
        const previous = await notification.getByIdempotencyKey(idempotencyKey);
        if (previous) {
          await repository.updateOne({
            filter: { id: event.id },
            values: {
              status: 'submitted',
              notificationId: previous.notificationId,
              errorCategory: null,
              updatedAt: new Date().toISOString(),
            },
          });
          continue;
        }
        const user = await this.app.container
          .resolve(userManagementServiceToken)
          .get(event.recipientId);
        if (user.disabledAt) {
          await repository.updateOne({
            filter: { id: event.id },
            values: {
              status: 'skipped',
              errorCategory: 'recipientUnavailable',
              updatedAt: new Date().toISOString(),
            },
          });
          continue;
        }
        const result = await notification.send({
          idempotencyKey,
          source: { type: `crm.${event.scenario}`, referenceId: event.id },
          messages: {
            inbox: {
              to: event.recipientId,
              ...renderCrmNotification(event.scenario),
              target: { type: 'route', path: event.targetPath },
            },
          },
        });
        await repository.updateOne({
          filter: { id: event.id },
          values: {
            status: 'submitted',
            notificationId: result.notificationId,
            attempts: event.attempts + 1,
            errorCategory: null,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        // No bodies, credentials or raw provider error details belong in the business event directory.
        await repository.updateOne({
          filter: { id: event.id },
          values: {
            status:
              error instanceof UserManagementError &&
              error.code === 'USER_NOT_FOUND'
                ? 'skipped'
                : 'queued',
            attempts: event.attempts + 1,
            errorCategory:
              error instanceof UserManagementError &&
              error.code === 'USER_NOT_FOUND'
                ? 'recipientUnavailable'
                : 'submissionUnavailable',
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
  }
}
export const crmNotificationsToken =
  createServiceToken<CrmNotificationsService>('crm/notifications');
export default class CrmNotificationsProvider extends ServiceProvider<Application> {
  readonly name = 'crm.notifications';
  private schedule: ScheduleExecutor | undefined;
  private releases: (() => void)[] = [];
  override register() {
    this.app.container.singleton(
      crmNotificationsToken,
      () => new CrmNotificationsService(this.app),
    );
  }
  override async boot() {
    const registry = this.app.container.resolve(
      notificationTemplateRegistryToken,
    );
    for (const scenario of scenarios) {
      this.releases.push(
        registry.register({
          id: `crm.${scenario}`,
          contributor: 'doc-demo-crm',
          category: 'CRM',
          name: renderCrmNotification(scenario).title,
          trigger:
            scenario === 'assignment'
              ? 'Customer owner changes to another nonnull user'
              : `Quotation transitions to ${scenario === 'returned' ? 'revision' : scenario}`,
          recipients:
            scenario === 'assignment'
              ? 'New customer owner, including self-assignment'
              : 'Original quotation applicant',
          businessRule:
            'Every committed event; no unrelated or read-only shared recipients',
          locales: ['en-US'],
          languagePolicy:
            'Fixed English business messages; interface language does not change message content.',
          variables: [],
          channels: () => [
            describeNotificationTemplateChannel(
              this.app.config.get<NotificationConfigInput>('notification'),
              'inbox',
            ),
          ],
          render: () => renderCrmNotification(scenario),
        }),
      );
    }
  }
  override async start() {
    const service = this.app.container.resolve(crmNotificationsToken);
    this.schedule = this.app.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor('crm-notification-events');
    await this.schedule.addJob({
      name: 'crm-notification-events-sweep',
      options: { every: 15000 },
      payload: {},
      execute: async () => {
        await service.flush();
      },
    });
    await this.schedule.setup();
    await service.flush();
  }
  override async shutdown() {
    await this.schedule?.shutdown();
    await this.app.container.resolve(crmNotificationsToken).close();
    for (const release of this.releases) release();
  }
}
