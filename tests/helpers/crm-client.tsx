import type { ReactElement } from 'react';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationSnapshot,
} from '@nocobase/app-plugin-authorization/client';
import type {
  CrmAccess,
  CustomerAccess,
} from '../../client/hooks/use-crm-access.js';
import { renderSettingsClient } from './settings-client.js';

const recordOperations = [
  'view',
  'createCustomer',
  'editCustomer',
  'addContact',
  'editContact',
  'recordFollowUp',
  'createOpportunity',
  'editOpportunity',
  'createQuote',
  'editQuote',
  'assignOwner',
  'shareCustomer',
];
export interface CrmClientFixture {
  recordActions?: string[];
  productActions?: string[];
  globalAccess?: Partial<CrmAccess>;
  customerAccess?: Partial<CustomerAccess>;
}
/** Keep native authz hooks/client; provide only transport-level capability responses. */
export function renderCrmClient(
  ui: ReactElement,
  options: Parameters<typeof renderSettingsClient>[1],
  fixture: CrmClientFixture = {},
) {
  const recordActions = fixture.recordActions ?? recordOperations;
  const productActions = fixture.productActions ?? ['view', 'create', 'edit'];
  const permissions: AuthorizationSnapshot = {
    unrestricted: false,
    permissions: [
      { resource: { type: 'page', id: 'customers' }, actions: ['access'] },
      {
        resource: { type: 'composite', id: 'crm.records' },
        actions: recordActions,
      },
      {
        resource: { type: 'composite', id: 'crm.products' },
        actions: productActions,
      },
    ],
  };
  const globalAccess: CrmAccess = {
    createCustomer: recordActions.includes('createCustomer'),
    manageProducts:
      productActions.includes('create') && productActions.includes('edit'),
    productActions: {
      view: productActions.includes('view'),
      create: productActions.includes('create'),
      edit: productActions.includes('edit'),
    },
    ...fixture.globalAccess,
  };
  const customerAccess: CustomerAccess = {
    edit: true,
    manage: false,
    canAssign: false,
    canShare: false,
    shared: false,
    ownerId: 'settings-test-user',
    ownerName: 'Alex Morgan',
    users: [],
    shares: [],
    ...fixture.customerAccess,
    actions:
      fixture.customerAccess?.actions ??
      Object.fromEntries(
        recordOperations.map((action) => [
          action,
          recordActions.includes(action) &&
            fixture.customerAccess?.edit !== false,
        ]),
      ),
  };
  return renderSettingsClient(ui, {
    ...options,
    fetch: async (request) => {
      const path = new URL(request.url).pathname.split('/api/').at(-1);
      if (request.method === 'GET' && path === 'authorization/permissions')
        return Response.json({ data: permissions });
      if (request.method === 'GET' && path === 'crm/access')
        return Response.json({ data: globalAccess });
      if (
        request.method === 'GET' &&
        /^crm\/customers\/[^/]+\/access$/.test(path ?? '')
      )
        return Response.json({ data: customerAccess });
      return options?.fetch?.(request) ?? new Response(null, { status: 404 });
    },
    services: (app) => {
      options?.services?.(app);
      app.container.singleton(
        authorizationClientToken,
        (resolver) => new AuthorizationClient(resolver.resolve(apiClientToken)),
      );
    },
  });
}
