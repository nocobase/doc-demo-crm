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
export const scopeKeys = [
  'customers',
  'contacts',
  'followUps',
  'opportunities',
  'quotes',
  'lines',
] as const;
const data = (collection: string) =>
  defineDatabasePermission((p) => p.collection(collection).read('*'));
const customers = data('crmCustomers');
const contacts = data('crmContacts');
const followUps = data('crmFollowUps');
const opportunities = data('crmOpportunities');
const quotes = data('crmQuotes');
const lines = data('crmQuoteLines');
const products = data('crmProducts');
export const crmRecords = defineCompositeResource('crm.records', (r) =>
  r
    .title({ key: 'crmAccess.records', ns: 'app' })
    .action('view', (a) =>
      a
        .title({ key: 'crmAccess.view', ns: 'app' })
        .grant('customers', customers)
        .grant('contacts', contacts)
        .grant('followUps', followUps)
        .grant('opportunities', opportunities)
        .grant('quotes', quotes)
        .grant('lines', lines),
    )
    .action('createCustomer', (a) =>
      a
        .title({ key: 'crm.newCustomer', ns: 'app' })
        .grant('customers', customers.create('*')),
    )
    .action('editCustomer', (a) =>
      a
        .title({ key: 'crm.editCustomer', ns: 'app' })
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
    .action('addContact', (a) =>
      a
        .title({ key: 'crm.newContact', ns: 'app' })
        .grant('customers', customers)
        .grant('contacts', contacts.create('*')),
    )
    .action('editContact', (a) =>
      a
        .title({ key: 'crm.editContact', ns: 'app' })
        .grant('customers', customers)
        .grant('contacts', contacts.update(['name', 'role', 'email', 'phone'])),
    )
    .action('recordFollowUp', (a) =>
      a
        .title({ key: 'crm.newFollowUp', ns: 'app' })
        .grant('customers', customers)
        .grant('followUps', followUps.create('*')),
    )
    .action('createOpportunity', (a) =>
      a
        .title({ key: 'sales.newOpportunity', ns: 'app' })
        .grant('customers', customers)
        .grant('opportunities', opportunities.create('*')),
    )
    .action('editOpportunity', (a) =>
      a
        .title({ key: 'sales.editOpportunity', ns: 'app' })
        .grant('customers', customers)
        .grant(
          'opportunities',
          opportunities.update(['name', 'stage', 'notes', 'updatedAt']),
        ),
    )
    .action('createQuote', (a) =>
      a
        .title({ key: 'sales.newQuote', ns: 'app' })
        .grant('customers', customers)
        .grant('opportunities', opportunities)
        .grant('quotes', quotes.create('*'))
        .grant('lines', lines.create('*'))
        .grant('products', products),
    )
    .action('editQuote', (a) =>
      a
        .title({ key: 'sales.editQuote', ns: 'app' })
        .grant('customers', customers)
        .grant('opportunities', opportunities)
        .grant('quotes', quotes.update(['name', 'totalCents', 'updatedAt']))
        .grant('lines', lines.create('*').delete())
        .grant('products', products),
    )
    .action('shareCustomer', (a) =>
      a
        .title({ key: 'crmAccess.manageSharing', ns: 'app' })
        .grant('customers', customers),
    )
    .action('assignOwner', (a) =>
      a
        .title({ key: 'crmAccess.assignOwner', ns: 'app' })
        .grant('customers', customers.update(['ownerId', 'updatedAt'])),
    ),
);
export const crmProducts = defineCompositeResource('crm.products', (r) =>
  r
    .title({ key: 'sales.products', ns: 'app' })
    .action('view', (a) =>
      a.title({ key: 'crmAccess.view', ns: 'app' }).grant('products', products),
    )
    .action('create', (a) =>
      a
        .title({ key: 'sales.newProduct', ns: 'app' })
        .grant('products', products.create('*')),
    )
    .action('edit', (a) =>
      a
        .title({ key: 'sales.editProduct', ns: 'app' })
        .grant(
          'products',
          products.update(['name', 'code', 'unitPriceCents', 'updatedAt']),
        ),
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
    for (const name of [...customerCollections, 'crmProducts'])
      authz.database.collections.add({ name, title: name });
    authz.recordAccess.define(
      defineRecordAccess('crm.owned', (a) =>
        a
          .title({ key: 'crmAccess.owned', ns: 'app' })
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
          .title({ key: 'crmAccess.selectedCustomer', ns: 'app' })
          .collections(...customerCollections)
          .params<{ customerId: string }>(z.object({ customerId: z.uuid() }))
          .resolver(({ collection, params }) =>
            customerCondition(collection, [params.customerId]),
          ),
      ),
    );
    authz.ui.sections.add({
      name: 'crm',
      title: { key: 'crmAccess.records', ns: 'app' },
      parent: 'business',
    });
    authz.ui.place(authz.compositeResources.define(crmRecords), {
      section: 'crm',
    });
    authz.ui.place(authz.compositeResources.define(crmProducts), {
      section: 'crm',
    });
  }
}
export type CrmPolicies = Readonly<Record<string, RepositoryPolicy | false>>;
export async function authorizeCrm(
  context: AuthorizationContext,
  action: string,
  resource = 'crm.records',
): Promise<CrmPolicies> {
  const decision = await context.authorize({
    resource: { type: 'composite', id: resource },
    action,
  });
  if (decision.effect === 'deny' || !decision.conditions?.database)
    throw new AuthorizationDeniedError(decision);
  return decision.conditions.database;
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
