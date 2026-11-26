import type { PermissionWorkspaceSelection } from '@nocobase/app-plugin-authorization/client/settings';

/**
 * Configure this selection whenever the app adds a business feature. Give each action a localized description,
 * map each page's primary and related objects, and name additional scope slots with registered collection titles.
 * The authorization plugin reads it through its `workspace` option in `client/plugins.ts`; see
 * .agents/skills/nocobase-app-development/references/authorization.md for the role editor example.
 */
export const permissionWorkspaceSelection: PermissionWorkspaceSelection = {
  business: [
    {
      type: 'composite',
      id: 'crm.records',
      scopeTitles: {
        crmCustomers: { key: 'crm.title' },
        crmContacts: { key: 'crm.contacts' },
        crmFollowUps: { key: 'crm.followUps' },
        crmOpportunities: { key: 'sales.opportunities' },
        crmQuotes: { key: 'sales.quotes' },
        crmQuoteLines: { key: 'crmAccess.quoteLines' },
        crmProducts: { key: 'sales.products' },
      },
      hiddenActionScopes: {
        createCustomer: ['customers'],
        addContact: ['contacts'],
        recordFollowUp: ['followUps'],
        createOpportunity: ['opportunities'],
        createQuote: ['quotes', 'lines'],
      },
      actions: [
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
      ],
      actionDescriptions: Object.fromEntries(
        [
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
        ].map((action) => [action, { key: `crmAccess.${action}Description` }]),
      ),
    },
    {
      type: 'composite',
      id: 'crm.products',
      scopeTitles: { crmProducts: { key: 'sales.products' } },
      hiddenActionScopes: { create: ['products'] },
      actions: ['view', 'create', 'edit'],
      actionDescriptions: {
        view: { key: 'crmAccess.productViewDescription' },
        create: { key: 'crmAccess.productCreateDescription' },
        edit: { key: 'crmAccess.productEditDescription' },
      },
    },
  ],
  pages: {
    customers: { primary: ['crm.records'], related: ['crm.products'] },
    'sales-workspace': { primary: ['crm.records'] },
    products: { primary: ['crm.products'] },
    'crm-tasks': { primary: ['crm.records'] },
  },
  settingsComposites: {
    crmIntegrationsSettings: [{ id: 'crm.integrations' }],
    quoteWorkflowDefinitions: [{ id: 'crm.workflow' }],
    quoteWorkflowExecutions: [{ id: 'crm.workflow' }],
  },
};
