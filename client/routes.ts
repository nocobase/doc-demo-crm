import { Mail } from 'lucide-react';
import crmNotificationRoutes from './pages/settings/crm-notifications/routes.js';
import databaseExplorerRoutes from './pages/settings/database-explorer/routes.js';
import { createAppClientConfig } from '@nocobase/app-client';
import { readAppClientRuntimeConfig } from '@nocobase/app-client/runtime';
import { includeNotificationTemplateRoutes } from './pages/settings/notification-routes.js';
import systemSettingsRoutes from './pages/settings/routes.js';
import {
  Home,
  Building2,
  Package,
  LayoutDashboard,
  ListTodo,
  Workflow,
} from 'lucide-react';
import settingsShellRoutes from './pages/settings/shell-routes.js';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
  type AppClientRouteDefinition,
} from '@nocobase/app-client/plugins';

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home/index.js'),
    name: 'home',
    navigation: { title: 'navigation.home', icon: Home },
    path: '/',
  },
  {
    name: 'crm-mail',
    path: '/mail',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'mail.workspace' },
      action: 'access',
    },
    navigation: { title: 'crmMail.workspace', icon: Mail },
    componentLoader: () => import('./pages/mail/workspace.js'),
  },
  {
    name: 'crm-mail-accounts',
    path: '/mail/accounts',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'mail.workspace' },
      action: 'access',
    },
    breadcrumb: { title: 'crmMail.accounts' },
    componentLoader: () => import('./pages/mail/accounts.js'),
  },
  {
    name: 'crm-mail-logs',
    path: '/mail/logs',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'mail.workspace' },
      action: 'access',
    },
    breadcrumb: { title: 'crmMail.logs' },
    componentLoader: () => import('./pages/mail/logs.js'),
  },
  {
    name: 'crm-mail-admin',
    parent: 'settingsBusiness',
    path: '/mail-administration',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'mail.admin' }, action: 'access' },
    navigation: { title: 'crmMail.admin', icon: Mail },
    componentLoader: () => import('./pages/mail/logs.js'),
  },
  {
    parent: 'settingsBusiness',
    name: 'crm.documents',
    path: '/documents',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'crm.documents' },
      action: 'access',
    },
    navigation: { title: 'documents.settings', icon: Package },
    componentLoader: () => import('./pages/settings/documents/index.js'),
  },
  // Keep Home first; add business navigation after this landing page.
  {
    name: 'crm-tasks',
    path: '/tasks',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'customers' }, action: 'access' },
    navigation: { title: 'quoteApproval.tasks', icon: ListTodo },
    componentLoader: () => import('./pages/tasks/index.js'),
    children: [
      {
        name: 'crm-task-quote',
        path: 'quotes/:customerId/:opportunityId/:quoteId',
        componentLoader: () => import('./pages/sales/quote.js'),
        children: [
          {
            name: 'crm-task-quote-edit',
            path: 'edit',
            presentation: { kind: 'dialog' as const, title: 'sales.editQuote' },
            componentLoader: () => import('./pages/sales/edit.js'),
          },
          {
            name: 'crm-task-quote-submit',
            path: 'submit',
            presentation: {
              kind: 'dialog' as const,
              title: 'quoteApproval.submit',
            },
            componentLoader: () => import('./pages/sales/submit-quote.js'),
          },
        ],
      },
    ],
  },
  {
    parent: 'settingsBusiness',
    name: 'quoteWorkflows',
    path: '/quote-workflows',
    auth: 'required',
    authz: {
      resource: { type: 'composite', id: 'crm.workflow' },
      action: 'read',
    },
    navigation: { title: 'quoteApproval.workflows', icon: Workflow },
    componentLoader: () => import('./pages/settings/quote-workflows/index.js'),
    children: [
      {
        name: 'quoteWorkflowDefinitions',
        path: 'definitions',
        componentLoader: () =>
          import('./pages/settings/quote-workflows/definitions.js'),
        children: [
          {
            name: 'quoteWorkflowDefinition',
            path: 'quotation',
            componentLoader: () =>
              import('./pages/settings/quote-workflows/definition.js'),
          },
        ],
      },
      {
        name: 'quoteWorkflowExecutions',
        path: 'executions',
        componentLoader: () =>
          import('./pages/settings/quote-workflows/executions.js'),
        children: [
          {
            name: 'quoteWorkflowExecution',
            path: ':executionId',
            componentLoader: () =>
              import('./pages/settings/quote-workflows/execution.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'sales-workspace',
    path: '/sales',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'customers' }, action: 'access' },
    navigation: { title: 'workspace.title', icon: LayoutDashboard },
    componentLoader: () => import('./pages/sales-workspace/index.js'),
  },
  {
    name: 'customers',
    path: '/customers',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'customers' }, action: 'access' },
    navigation: { title: 'crm.title', icon: Building2 },
    componentLoader: () => import('./pages/customers/index.js'),
    children: [
      {
        name: 'customers-new',
        path: 'new',
        presentation: { kind: 'dialog' as const, title: 'crm.newCustomer' },
        componentLoader: () => import('./pages/customers/edit.js'),
      },
      {
        name: 'customers-detail',
        path: ':customerId/details',
        breadcrumb: { title: 'crm.detail' },
        componentLoader: () => import('./pages/customers/detail.js'),
        children: [
          ...(
            [
              'overview',
              'contacts',
              'followUps',
              'opportunities',
              'attachments',
              'mail',
            ] as const
          ).map((tab): AppClientRouteDefinition => ({
            name: `customers-tab-${tab}`,
            path: tab,
            componentLoader: () => import('./pages/customers/detail-tab.js'),
            children: [
              {
                name: `customers-tab-${tab}-edit`,
                path: 'edit',
                presentation: {
                  kind: 'dialog' as const,
                  title: 'crm.editCustomer',
                },
                componentLoader: () => import('./pages/customers/edit.js'),
              },
              ...(tab === 'attachments'
                ? [
                    {
                      name: 'customers-tab-attachments-add',
                      path: 'addFiles',
                      presentation: {
                        kind: 'dialog' as const,
                        title: 'documents.add',
                      },
                      componentLoader: () =>
                        import('./pages/documents/add-files.js'),
                    },
                  ]
                : []),
              ...(tab === 'contacts'
                ? [
                    {
                      name: 'customers-tab-contact-new',
                      path: 'newContact',
                      presentation: {
                        kind: 'dialog' as const,
                        title: 'crm.newContact',
                      },
                      componentLoader: () =>
                        import('./pages/customers/edit.js'),
                    },
                  ]
                : []),
              ...(tab === 'followUps'
                ? [
                    {
                      name: 'customers-tab-followup-new',
                      path: 'newFollowUp',
                      presentation: {
                        kind: 'dialog' as const,
                        title: 'crm.newFollowUp',
                      },
                      componentLoader: () =>
                        import('./pages/customers/edit.js'),
                    },
                  ]
                : []),
              ...(tab === 'opportunities'
                ? [
                    {
                      name: 'customers-tab-opportunity-new',
                      path: 'newOpportunity',
                      presentation: {
                        kind: 'dialog' as const,
                        title: 'sales.newOpportunity',
                      },
                      componentLoader: () => import('./pages/sales/edit.js'),
                    },
                    {
                      name: 'sales-opportunity',
                      path: ':opportunityId',
                      breadcrumb: { title: 'sales.opportunities' },
                      componentLoader: () =>
                        import('./pages/sales/opportunity.js'),
                      children: [
                        {
                          name: 'sales-opportunity-edit',
                          path: 'edit',
                          presentation: {
                            kind: 'dialog' as const,
                            title: 'sales.editOpportunity',
                          },
                          componentLoader: () =>
                            import('./pages/sales/edit.js'),
                        },
                        {
                          name: 'sales-quote-new',
                          path: 'newQuote',
                          presentation: {
                            kind: 'dialog' as const,
                            title: 'sales.newQuote',
                          },
                          componentLoader: () =>
                            import('./pages/sales/edit.js'),
                        },
                        {
                          name: 'sales-quote',
                          path: 'quotes/:quoteId',
                          breadcrumb: { title: 'sales.quotes' },
                          componentLoader: () =>
                            import('./pages/sales/quote.js'),
                          children: [
                            {
                              name: 'sales-quote-submit',
                              path: 'submit',
                              presentation: {
                                kind: 'dialog' as const,
                                title: 'quoteApproval.submit',
                              },
                              componentLoader: () =>
                                import('./pages/sales/submit-quote.js'),
                            },
                            {
                              name: 'sales-quote-edit',
                              path: 'edit',
                              presentation: {
                                kind: 'dialog' as const,
                                title: 'sales.editQuote',
                              },
                              componentLoader: () =>
                                import('./pages/sales/edit.js'),
                            },
                          ],
                        },
                      ],
                    },
                  ]
                : []),
            ],
          })),

          {
            name: 'sales-opportunity-new',
            path: 'newOpportunity',
            presentation: {
              kind: 'dialog' as const,
              title: 'sales.newOpportunity',
            },
            componentLoader: () => import('./pages/sales/edit.js'),
          },
          {
            name: 'customers-edit',
            path: 'edit',
            presentation: {
              kind: 'dialog' as const,
              title: 'crm.editCustomer',
            },
            componentLoader: () => import('./pages/customers/edit.js'),
          },
          {
            name: 'customers-contact-new',
            path: 'newContact',
            presentation: { kind: 'dialog' as const, title: 'crm.newContact' },
            componentLoader: () => import('./pages/customers/edit.js'),
          },
          {
            name: 'customers-followup-new',
            path: 'newFollowUp',
            presentation: { kind: 'dialog' as const, title: 'crm.newFollowUp' },
            componentLoader: () => import('./pages/customers/edit.js'),
          },
        ],
      },
    ],
  },
  {
    name: 'products',
    path: '/products',
    auth: 'required',
    authz: { resource: { type: 'page', id: 'customers' }, action: 'access' },
    navigation: { title: 'sales.products', icon: Package },
    componentLoader: () => import('./pages/sales/products.js'),
    children: [
      {
        name: 'products-new',
        path: 'new',
        presentation: { kind: 'dialog' as const, title: 'sales.newProduct' },
        componentLoader: () => import('./pages/sales/edit.js'),
      },
      {
        name: 'products-edit',
        path: ':productId/edit',
        presentation: { kind: 'dialog' as const, title: 'sales.editProduct' },
        componentLoader: () => import('./pages/sales/edit.js'),
      },
    ],
  },
  {
    // Declares no navigation, so the application decides where its entry goes (for example a sidebar item with an
    // unread badge). The plugin's API answers each person's own messages only, so the page needs no authorization of
    // its own.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/inbox.js'),
    name: 'inbox',
    path: '/inbox',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    // Where a command line's sign-in sends the person to approve it (`pages/auth/device.tsx`). Optional rather than
    // required so it renders outside the shell, like the sign-in pages; the page sends a guest to sign in and back.
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/device.js'),
    name: 'device',
    path: '/device',
  },
]);

// The System settings shell stays registered: it shows only the modules a viewer may open, and none until the
// application or its plugins contribute one. Business administration such as `./pages/settings/routes.js` joins it.
export function createApplicationRoutes(
  rawConfig: unknown = readAppClientRuntimeConfig(),
): readonly AppClientRouteContribution[] {
  const config = createAppClientConfig({ rawConfig });
  return includeNotificationTemplateRoutes(
    [
      appRoutes,
      settingsShellRoutes,
      systemSettingsRoutes,
      databaseExplorerRoutes,
      crmNotificationRoutes,
    ],
    config.get<boolean>('notificationTemplates.invitationConfigured') === true,
  );
}

const routes: readonly AppClientRouteContribution[] = createApplicationRoutes();

export default routes;
