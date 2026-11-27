import type { Application } from '@nocobase/app-server/application';
import {
  UserManagementError,
  userManagementServiceToken,
} from '@nocobase/app-plugin-users/server/tokens';
import { crmOperations, type CrmOperation } from '../crm-operations.js';
import { ApiError } from '@nocobase/app-server/router';
import { ServiceProvider } from '@nocobase/service-provider';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import {
  authorizationToken,
  defineDatabasePermission,
  type AuthorizationContext,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineCompositeResource,
  defineRecordAccess,
  AuthorizationDeniedError,
} from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import {
  databaseManagerToken,
  type DatabaseConnection,
  type RepositoryPolicy,
} from '@nocobase/db';
import { z } from 'zod';

export const customerCollections = [
  'crmCustomers',
  'crmContacts',
  'crmFollowUps',
  'crmOpportunities',
  'crmQuotes',
  'crmQuoteLines',
] as const;
const label = (key: string) => ({ key, ns: 'doc-demo-crm' });
const data = (collection: string) =>
  defineDatabasePermission((p) => p.collection(collection).read('*'));
const customers = data('crmCustomers');
const contacts = data('crmContacts');
const followUps = data('crmFollowUps');
const opportunities = data('crmOpportunities');
const quotes = data('crmQuotes');
const lines = data('crmQuoteLines');
const products = data('crmProducts');
export const crmCustomers = defineCompositeResource('crm.customers', (r) =>
  r
    .title(label('crm.title'))
    .action('view', (a) =>
      a.title(label('crmAccess.view')).grant('customers', customers),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('customers', customers.create('*')),
    )
    .action('edit', (a) =>
      a
        .title(label('crmAccess.edit'))
        .grant(
          'customers',
          customers.update([
            'name',
            'industry',
            'status',
            'website',
            'notes',
            'updatedAt',
          ]),
        ),
    )
    .action('assignOwner', (a) =>
      a
        .title(label('crmAccess.assignOwner'))
        .grant('customers', customers.update(['ownerId', 'updatedAt'])),
    )
    .action('share', (a) =>
      a.title(label('crmAccess.manageSharing')).grant('customers', customers),
    )
    .action('attachFile', (a) =>
      a.title(label('documents.add')).grant('customers', customers),
    )
    .action('removeFile', (a) =>
      a.title(label('documents.remove')).grant('customers', customers),
    )
    .action('schedule', (a) =>
      a.title(label('reminders.schedule')).grant('customers', customers),
    )
    .action('completeReminder', (a) =>
      a.title(label('reminders.complete')).grant('customers', customers),
    )
    .action('cancelReminder', (a) =>
      a.title(label('reminders.cancel')).grant('customers', customers),
    )
    .action('useAssistant', (a) =>
      a.title(label('crmAssistant.tab')).grant('customers', customers),
    ),
);
export const crmContacts = defineCompositeResource('crm.contacts', (r) =>
  r
    .title(label('crm.contacts'))
    .action('view', (a) =>
      a.title(label('crmAccess.view')).grant('contacts', contacts),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('contacts', contacts.create('*'))
        .grant('customers', customers),
    )
    .action('edit', (a) =>
      a
        .title(label('crmAccess.edit'))
        .grant('contacts', contacts.update(['name', 'role', 'email', 'phone']))
        .grant('customers', customers),
    ),
);
export const crmFollowUps = defineCompositeResource('crm.followUps', (r) =>
  r
    .title(label('crm.followUps'))
    .action('view', (a) =>
      a.title(label('crmAccess.view')).grant('followUps', followUps),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('followUps', followUps.create('*'))
        .grant('customers', customers),
    ),
);
export const crmOpportunities = defineCompositeResource(
  'crm.opportunities',
  (r) =>
    r
      .title(label('sales.opportunities'))
      .action('view', (a) =>
        a.title(label('crmAccess.view')).grant('opportunities', opportunities),
      )
      .action('create', (a) =>
        a
          .title(label('crmAccess.create'))
          .grant('opportunities', opportunities.create('*'))
          .grant('customers', customers),
      )
      .action('edit', (a) =>
        a
          .title(label('crmAccess.edit'))
          .grant(
            'opportunities',
            opportunities.update(['name', 'stage', 'notes', 'updatedAt']),
          )
          .grant('customers', customers),
      ),
);
export const crmQuotes = defineCompositeResource('crm.quotes', (r) =>
  r
    .title(label('sales.quotes'))
    .action('view', (a) =>
      a
        .title(label('crmAccess.view'))
        .grant('quotes', quotes)
        .grant('lines', lines),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('quotes', quotes.create('*'))
        .grant('lines', lines.create('*'))
        .grant('opportunities', opportunities)
        .grant('customers', customers)
        .grant('products', products),
    )
    .action('edit', (a) =>
      a
        .title(label('crmAccess.edit'))
        .grant('quotes', quotes.update(['name', 'totalCents', 'updatedAt']))
        .grant('lines', lines.create('*').delete())
        .grant('opportunities', opportunities)
        .grant('customers', customers)
        .grant('products', products),
    )
    .action('submit', (a) =>
      a
        .title(label('quoteApproval.submit'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    )
    .action('withdraw', (a) =>
      a
        .title(label('quoteApproval.withdraw'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    )
    .action('approve', (a) =>
      a
        .title(label('quoteApproval.approve'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    )
    .action('reject', (a) =>
      a
        .title(label('quoteApproval.reject'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    )
    .action('return', (a) =>
      a
        .title(label('quoteApproval.return'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    )
    .action('issue', (a) =>
      a
        .title(label('documents.generate'))
        .grant('quotes', quotes)
        .grant('lines', lines)
        .grant('opportunities', opportunities)
        .grant('customers', customers),
    ),
);
export const crmImports = defineCompositeResource('crm.imports', (r) =>
  r
    .title(label('crmImports.title'))
    .action('view', (a) =>
      a
        .title(label('crmAccess.view'))
        .grant('batches', data('crmImportBatches')),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('batches', data('crmImportBatches').create('*')),
    ),
);
export const crmProducts = defineCompositeResource('crm.products', (r) =>
  r
    .title(label('sales.products'))
    .action('view', (a) =>
      a.title(label('crmAccess.view')).grant('products', products),
    )
    .action('create', (a) =>
      a
        .title(label('crmAccess.create'))
        .grant('products', products.create('*')),
    )
    .action('edit', (a) =>
      a
        .title(label('crmAccess.edit'))
        .grant(
          'products',
          products.update(['name', 'code', 'unitPriceCents', 'updatedAt']),
        ),
    ),
);

export const crmIntegrations = defineCompositeResource(
  'crm.integrations',
  (r) =>
    r
      .title(label('integrations.resourceTitle'))
      .action('read', (a) =>
        a
          .title(label('crmAccess.view'))
          .grant('deliveries', data('crmSyncDeliveries'))
          .grant('targets', data('crmSyncTargets')),
      )
      .action('sync', (a) =>
        a
          .title(label('integrations.syncAction'))
          .grant(
            'deliveries',
            data('crmSyncDeliveries').create('*').update('*'),
          )
          .grant('targets', data('crmSyncTargets')),
      )
      .action('configure', (a) =>
        a
          .title(label('integrations.configureAction'))
          .grant('targets', data('crmSyncTargets').create('*').update('*')),
      ),
);

function customerCondition(collection: string, customerIds: readonly string[]) {
  return buildFilter((f) =>
    f.or(
      customerIds.map((id) =>
        f.string(collection === 'crmCustomers' ? 'id' : 'customerId').eq(id),
      ),
    ),
  );
}
export default class CrmPermissionsProvider extends ServiceProvider<AppPluginApplication> {
  readonly name = 'app.crm-permissions';
  override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    const connection = this.app.container
      .resolve(databaseManagerToken)
      .connection();
    for (const name of [
      ...customerCollections,
      'crmProducts',
      'crmSyncDeliveries',
      'crmSyncTargets',
      'crmImportBatches',
    ])
      authz.database.collections.add({ name, title: name });
    authz.recordAccess.define(
      defineRecordAccess('crm.submitted', (a) =>
        a
          .title(label('crmAccess.submitted'))
          .collections('crmImportBatches')
          .resolver(({ principal }) =>
            principal.type === 'user'
              ? buildFilter((f) => f.string('uploadedBy').eq(principal.id))
              : false,
          ),
      ),
    );
    authz.recordAccess.define(
      defineRecordAccess('crm.owned', (a) =>
        a
          .title(label('crmAccess.owned'))
          .collections(...customerCollections)
          .resolver(async ({ principal, collection }) => {
            if (principal.type !== 'user') return false;
            if (collection === 'crmCustomers')
              return buildFilter((f) => f.string('ownerId').eq(principal.id));
            // Trusted ownership lookup only; public data reads still use native policies.
            const customers = await connection
              .repository('crmCustomers')
              .findMany({
                filter: { ownerId: principal.id },
                select: (s) => s.fields('id'),
              });
            return customers.length
              ? customerCondition(
                  collection,
                  customers.map((customer) => z.string().parse(customer.id)),
                )
              : false;
          }),
      ),
    );
    authz.recordAccess.define(
      defineRecordAccess('crm.customer', (a) =>
        a
          .title(label('crmAccess.selectedCustomer'))
          .collections(...customerCollections)
          .params<{ customerId: string }>(z.object({ customerId: z.uuid() }))
          .resolver(({ collection, params }) =>
            customerCondition(collection, [params.customerId]),
          ),
      ),
    );
    authz.ui.sections.add({
      name: 'crm',
      title: 'CRM',
      parent: 'business',
    });
    for (const resource of [
      crmCustomers,
      crmContacts,
      crmFollowUps,
      crmOpportunities,
      crmQuotes,
      crmImports,
    ]) {
      authz.ui.place(authz.compositeResources.define(resource.build()), {
        section: 'crm',
      });
    }
    authz.ui.sections.add({
      name: 'crm.admin',
      title: 'CRM',
      parent: 'administration',
    });
    for (const item of [
      {
        id: 'crm.documents',
        title: label('documents.settings'),
        actions: [
          { name: 'read', title: label('crmAccess.view') },
          { name: 'cleanup', title: label('documents.cleanup') },
        ],
      },
      {
        id: 'crm.workflow',
        title: label('quoteApproval.workflows'),
        actions: [
          { name: 'read', title: label('crmAccess.view') },
          { name: 'configure', title: label('quoteApproval.configure') },
        ],
      },
      {
        id: 'crm.notificationEvents',
        title: label('crmNotifications.title'),
        actions: [{ name: 'read', title: label('crmAccess.view') }],
      },
    ]) {
      authz.settings.add(item);
      authz.ui.place(
        { type: 'settings', id: item.id },
        { section: 'crm.admin' },
      );
    }
    authz.ui.place(authz.compositeResources.define(crmProducts), {
      section: 'crm',
    });
    authz.ui.place(authz.compositeResources.define(crmIntegrations), {
      section: 'crm',
    });
  }
}
// Owner and sharing pickers list explicitly assigned CRM users, including custom roles.
export async function crmRoleMembers(
  app: Application,
  tx: DatabaseConnection,
  operations: readonly CrmOperation[],
) {
  const sets = app.container
    .resolve(authorizationToken)
    .permissionSets.withTransaction(tx);
  const eligible = (await sets.list()).filter((set) =>
    set.grants.some((grant) =>
      operations.some((key) => {
        const ref = crmOperations[key];
        return (
          grant.resource.type === ref.resource.type &&
          grant.resource.id === ref.resource.id &&
          grant.actions.some((a) => a.action === ref.action)
        );
      }),
    ),
  );
  const assignments = (
    await Promise.all(eligible.map((set) => sets.listAssignments(set.key)))
  ).flat();
  const ids = new Set(
    assignments
      .filter((a) => a.subject.type === 'user')
      .map((a) => a.subject.id),
  );
  const directory = app.container
    .resolve(userManagementServiceToken)
    .withConnection(tx);
  const users = await Promise.all(
    [...ids].map(async (id) => {
      try {
        const user = await directory.get(id);
        return user.disabledAt ? [] : [{ id: user.id, name: user.name }];
      } catch (error) {
        if (
          error instanceof UserManagementError &&
          error.code === 'USER_NOT_FOUND'
        )
          return [];
        throw error;
      }
    }),
  );
  return users.flat().sort((a, b) => a.name.localeCompare(b.name));
}
export type CrmPolicies = Readonly<Record<string, RepositoryPolicy | false>>;
export async function authorizeCrm(
  context: AuthorizationContext,
  operation: CrmOperation,
): Promise<CrmPolicies> {
  const decision = await context.authorize(crmOperations[operation]);
  if (decision.effect === 'deny' || !decision.conditions?.database)
    throw new AuthorizationDeniedError(decision);
  return decision.conditions.database;
}
// A read of a related record also checks the independently scoped parent reads.
export async function customerReads(
  context: AuthorizationContext,
  ...related: (
    'viewContacts' | 'viewFollowUps' | 'viewOpportunities' | 'viewQuotes'
  )[]
) {
  const selections = new Set<CrmOperation>(['viewCustomer', ...related]);
  if (selections.has('viewQuotes')) selections.add('viewOpportunities');
  return Object.assign(
    {},
    ...(await Promise.all(
      [...selections].map((op) => authorizeCrm(context, op)),
    )),
  ) as CrmPolicies;
}

export async function optionalCrm(
  context: AuthorizationContext,
  operation: CrmOperation,
) {
  const decision = await context.authorize(crmOperations[operation]);
  return decision.effect === 'deny' ? undefined : decision.conditions?.database;
}
// A summary can omit whole objects. Each collection comes from its own View grant.
export async function summaryReads(
  context: AuthorizationContext,
  includeContacts = false,
): Promise<CrmPolicies> {
  const customer = await authorizeCrm(context, 'viewCustomer');
  const reads = await Promise.all([
    optionalCrm(context, 'viewFollowUps'),
    optionalCrm(context, 'viewOpportunities'),
    optionalCrm(context, 'viewQuotes'),
    includeContacts ? optionalCrm(context, 'viewContacts') : undefined,
  ]);
  return reads.reduce<CrmPolicies>(
    (policies, read) => ({ ...policies, ...read }),
    customer,
  );
}
export function scopedRepository(
  connection: DatabaseConnection,
  policies: CrmPolicies,
  collection: string,
) {
  const policy = policies[collection];
  if (!policy)
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      reason: 'CRM_ACCESS_DENIED',
      domain: 'crm',
      message: 'This operation is not allowed.',
    });
  return connection.repository(collection).withPolicy(policy);
}
