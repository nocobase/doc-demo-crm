import { crmNotificationsToken } from './crm-notifications.js';
import type { Application } from '@nocobase/app-server/application';
import { queueServiceToken } from '@nocobase/app-server/queue';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import {
  ApprovalService,
  approvalTaskContributorToken,
  type Approval,
} from '@nocobase/app-plugin-approval/server';
import {
  LifecycleRuntime,
  StoredLifecycleParameters,
  createRepositoryLifecycleStore,
} from '@nocobase/lifecycle';
import {
  createLifecycleJobs,
  type LifecycleJobs,
} from '@nocobase/lifecycle/jobs';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import {
  quoteApproval,
  type QuoteApprovalTypes,
} from '../lifecycles/quote-approval.js';

export class QuoteApprovalService {
  readonly runtime: LifecycleRuntime;
  readonly approvals: ApprovalService;
  readonly jobs: LifecycleJobs;
  readonly parameters: StoredLifecycleParameters;
  constructor(private readonly app: Application) {
    const database = app.container.resolve(databaseManagerToken);
    const executors = app.container.resolve(jobExecutorServiceToken);
    this.jobs = createLifecycleJobs({
      jobs: executors.getJobExecutor('doc-demo-crm'),
      schedule: executors.getScheduleExecutor('doc-demo-crm'),
      jobName: 'doc-demo-crm/quote-approval-effects',
      sweepEveryMs: 60000,
    });
    const store = createRepositoryLifecycleStore(database, {
      collections: {
        transitions: 'crmApprovalTransitions',
        effectRuns: 'crmApprovalEffectRuns',
      },
    });
    this.parameters = new StoredLifecycleParameters(store, {
      heads: 'crmApprovalParameterHeads',
      versions: 'crmApprovalParameterVersions',
      selections: 'crmApprovalParameterSelections',
      requests: 'crmApprovalParameterRequests',
      snapshots: 'crmApprovalParameterSnapshots',
      usages: 'crmApprovalParameterUsages',
    });
    this.runtime = new LifecycleRuntime({
      store,
      dispatcher: this.jobs,
    });
    const services = (handle: unknown): QuoteApprovalTypes['services'] => {
      const connection =
        (handle as DatabaseConnection | undefined) ?? database.connection();
      return {
        contributor: app.container.resolve(approvalTaskContributorToken),
        notify: () => app.container.resolve(crmNotificationsToken).flush(),
        directory: {
          isActive: async (id) =>
            (await this.reviewers(connection)).some(
              (person) => person.id === id,
            ),
          managerOf: () => undefined,
          hasRole: async (id, role) =>
            role === 'crm-sales-manager' &&
            (await this.reviewers(connection)).some(
              (person) => person.id === id,
            ),
        },
      };
    };
    this.runtime.register(quoteApproval, {
      services,
      parameterConfiguration: {
        store: this.parameters,
        scope: () => 'crm',
      },
    });
    this.approvals = new ApprovalService(
      this.runtime,
      [quoteApproval.approval as unknown as Approval<never>],
      services,
      {
        queue: app.container.resolve(queueServiceToken),
        schedule: executors.getScheduleExecutor('crm.quote-approval-clock'),
      },
    );
  }
  async reviewers(
    connection = this.app.container.resolve(databaseManagerToken).connection(),
  ) {
    const assignments = await this.app.container
      .resolve(authorizationToken)
      .permissionSets.withTransaction(connection)
      .listAssignments('crm-sales-manager');
    const ids = [
      ...new Set(
        assignments
          .filter((a) => a.subject.type === 'user')
          .map((a) => a.subject.id),
      ),
    ];
    const users = this.app.container
      .resolve(userManagementServiceToken)
      .withConnection(connection);
    const result = await Promise.all(
      ids.map(async (id) => {
        try {
          const user = await users.get(id);
          return user.disabledAt ? null : { id: user.id, name: user.name };
        } catch {
          return null;
        }
      }),
    );
    return result.filter(
      (entry): entry is { id: string; name: string } => entry !== null,
    );
  }
}
export const quoteApprovalServiceToken =
  createServiceToken<QuoteApprovalService>('crm/quote-approvals');
export default class QuoteApprovalsProvider extends ServiceProvider<Application> {
  readonly name = 'crm.quote-approvals';
  override register() {
    this.app.container.singleton(
      quoteApprovalServiceToken,
      () => new QuoteApprovalService(this.app),
    );
  }
  override async start() {
    const service = this.app.container.resolve(quoteApprovalServiceToken);
    await service.jobs.start(service.runtime);
    await service.approvals.start();
  }
  override async shutdown() {
    const service = this.app.container.resolve(quoteApprovalServiceToken);
    await service.approvals.shutdown();
    await service.jobs.shutdown();
  }
}
