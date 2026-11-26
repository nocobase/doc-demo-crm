import { Mail, BookOpen } from 'lucide-react';
import { knowledgeDefinition } from '@nocobase/app-plugin-knowledge/client/routes';
import crmNotificationRoutes from './pages/settings/crm-notifications/routes.js';
import databaseExplorerRoutes from './pages/settings/database-explorer/routes.js';
import {
  Home,
  Building2,
  Package,
  LayoutDashboard,
  ListTodo,
  Plug,
} from 'lucide-react';
import personalSettingsRoutes from './pages/me/routes.js';
import workflowSettingsRoutes from './pages/settings/workflows/routes.js';
import settingsShellRoutes from './pages/settings/shell-routes.js';
import {
  defineAppRoutes,
  defineSystemSettingsRoutes,
  SYSTEM_SETTINGS_CATEGORIES,
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
        name: 'customers-imports',
        path: 'imports',
        breadcrumb: { title: 'crmImports.title' },
        componentLoader: () => import('./pages/customers/imports.js'),
      },
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
              'reminders',
              'assistant',
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
    ...knowledgeDefinition({
      path: '/product-knowledge',
      space: { scope: 'crm-products', scopeId: '' },
    }),
    navigation: { title: 'crmAssistant.knowledge', icon: BookOpen },
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

const crmSettingsRoutes = defineSystemSettingsRoutes([
  {
    parent: SYSTEM_SETTINGS_CATEGORIES.data,
    name: 'crmIntegrationsSettings',
    path: '/integrations',
    auth: 'required',
    authz: {
      resource: { type: 'composite', id: 'crm.integrations' },
      action: 'read',
    },
    navigation: {
      title: 'integrations.title',
      description: 'integrations.navDescription',
      icon: Plug,
    },
    breadcrumb: { title: 'integrations.title' },
    componentLoader: () => import('./pages/settings/integrations/index.js'),
  },
  {
    parent: SYSTEM_SETTINGS_CATEGORIES.data,
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
]);

export function createApplicationRoutes(): readonly AppClientRouteContribution[] {
  return [
    appRoutes,
    settingsShellRoutes,
    personalSettingsRoutes,
    workflowSettingsRoutes,
    databaseExplorerRoutes,
    crmSettingsRoutes,
    crmNotificationRoutes,
  ];
}
export default createApplicationRoutes();
