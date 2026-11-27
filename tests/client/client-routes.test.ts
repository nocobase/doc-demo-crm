import {
  authorizationPages,
  registeredPluginRoutes,
} from '../helpers/plugin-routes.js';
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
  type AppClientRouteComponentLoader,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';

describe('app client routes', () => {
  it('keeps the landing page and the authentication pages', () => {
    // The authentication plugin and this application have to agree on these paths: it sends an unknown visitor to
    // /login, sends a signed-in user who opens a guest page back to /, and mails a reset link to /reset-password,
    // while the sign-in form links to /register and /forgot-password. Only their presence is asserted, so a page the
    // application adds is not a defect. Whether these four are guest pages is not checked here either: app-client
    // refuses any route that claims one of those paths without `auth: 'guest'`.
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        // The page `deviceAuthorization()`'s verificationUri names, where a CLI's sign-in is approved.
        '/device',
      ]),
    );
  });

  it('keeps workflow and process pages in System settings in a fresh application', () => {
    const processPages = pagePaths(resolveRoutes().routes).filter((path) =>
      /\/(?:workflows|processes)(?:\/|$)/.test(path),
    );
    expect(processPages).toEqual([
      '/settings/workflows/definitions',
      '/settings/workflows/definitions/quotation',
      '/settings/workflows/executions',
      '/settings/workflows/executions/:executionId',
    ]);
  });

  it('loads every page component', async () => {
    const resolved = resolveRoutes();
    const loaders = componentLoadersIn(resolved.routes);
    // The tree above is filtered by loader, so an empty list would make the loop below pass without loading
    // anything at all.
    expect(loaders).not.toHaveLength(0);

    for (const componentLoader of loaders) {
      // The registered loader is already the wrapped one, so awaiting it holds every page to the contract that its
      // module default-exports a component. A page that moved or lost its default export fails here.
      await expect(componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('pins the page authorization of every signed-in page', () => {
    // A stored page grant records the page's `authz` resource id (`authorizedAs`), not its route `name`: changing an
    // id is a data change that has to migrate the grants that reference it, not a refactor — so changing this list
    // deliberately is the point. A new page that requires sign-in adds an entry here, because a page that checks
    // access is a new grant somebody has to be given.
    // The landing page opted out of page authorization, so they are reachable by every signed-in user.
    const application = resolveAppClientContributions([
      {
        packageName: 'doc-demo-crm',
        source: 'application',
        routes: applicationRoutes,
      },
    ]);
    const expected = [
      { name: 'home', authorizedAs: null },
      ...['crm-mail', 'crm-mail-accounts', 'crm-mail-logs'].map((name) => ({
        name,
        authorizedAs: 'mail.workspace',
      })),
      ...[
        'crm-tasks',
        'crm-task-quote',
        'crm-task-quote-edit',
        'crm-task-quote-submit',
      ].map((name) => ({ name, authorizedAs: 'crm.tasks' })),
      { name: 'sales-workspace', authorizedAs: 'crm.workspace' },
      { name: 'crm-daily-reports', authorizedAs: 'crm.dailyReports' },
      ...[
        'customers',
        'customers-imports',
        'customers-new',
        'customers-detail',
        'customers-tab-overview',
        'customers-tab-overview-edit',
        'customers-tab-contacts',
        'customers-tab-contacts-edit',
        'customers-tab-contact-new',
        'customers-tab-followUps',
        'customers-tab-followUps-edit',
        'customers-tab-followup-new',
        'customers-tab-opportunities',
        'customers-tab-opportunities-edit',
        'customers-tab-opportunity-new',
        'sales-opportunity',
        'sales-opportunity-edit',
        'sales-quote-new',
        'sales-quote',
        'sales-quote-submit',
        'sales-quote-edit',
        'customers-tab-attachments',
        'customers-tab-attachments-edit',
        'customers-tab-attachments-add',
        'customers-tab-mail',
        'customers-tab-mail-edit',
        'customers-tab-reminders',
        'customers-tab-reminders-edit',
        'customers-tab-assistant',
        'customers-tab-assistant-edit',
        'sales-opportunity-new',
        'customers-edit',
        'customers-contact-new',
        'customers-followup-new',
      ].map((name) => ({ name, authorizedAs: 'crm.customers' })),
      ...['products', 'products-new', 'products-edit'].map((name) => ({
        name,
        authorizedAs: 'crm.products',
      })),
      { name: 'knowledge', authorizedAs: 'knowledge' },
      ...[
        'quoteWorkflowDefinitions',
        'quoteWorkflowDefinition',
        'quoteWorkflowExecutions',
        'quoteWorkflowExecution',
      ].map((name) => ({ name, authorizedAs: 'settings:crm.workflow' })),
      {
        name: 'crmIntegrationsSettings',
        authorizedAs: 'composite:crm.integrations',
      },
      { name: 'crm.documents', authorizedAs: 'settings:crm.documents' },
      {
        name: 'crmNotificationEvents',
        authorizedAs: 'settings:crm.notificationEvents',
      },
      { name: 'notificationLogs', authorizedAs: 'settings:notification' },
      { name: 'notificationTemplates', authorizedAs: 'settings:notification' },
      {
        name: 'notificationTemplateDetail',
        authorizedAs: 'settings:notification',
      },
      { name: 'settingsHome', authorizedAs: null },
      { name: 'personalSettingsHome', authorizedAs: null },
      { name: 'personalAppearance', authorizedAs: null },
      { name: 'databaseExplorer', authorizedAs: 'database-explorer' },
    ];
    const actual = pageAuthorizations(application.routes);
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expect.arrayContaining(expected));
  });

  it('registers Users, Roles and permissions and database browsing in System settings', async () => {
    const paths = pagePaths(resolveRoutes().routes);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/settings/users',
        '/settings/roles',
        '/settings/database-explorer',
        '/settings/api-keys',
        '/me/api-keys',
        '/mail',
        '/customers',
        '/settings/integrations',
      ]),
    );
    for (const loader of componentLoadersIn(resolveRoutes().routes))
      await expect(loader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
  });

  it('leaves the inbox page to the in-app notification plugin', () => {
    // `@nocobase/app-plugin-notification-in-app/client` registers the route `inbox` and the header button.
    expect(
      applicationRoutes[0].routes.find((route) => route.name === 'inbox'),
    ).toBeUndefined();
  });
});

/** This application's own contribution, registered the way the client runtime registers it. */
function resolveRoutes() {
  return resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
    registeredPluginRoutes('@nocobase/app-plugin-users'),
    authorizationPages(),
    registeredPluginRoutes('@nocobase/app-plugin-api-keys'),
    registeredPluginRoutes('@nocobase/app-plugin-mail'),
  ]);
}

/**
 * The paths of the pages a route tree registers. A menu group names no component, so it carries no path of its own
 * and inherits its parent's — filtering on `componentLoader` is what keeps that inherited path out of the list.
 */
function pagePaths(routes: readonly AppClientRegisteredRoute[]): string[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.path] : []),
    ...pagePaths(route.children ?? []),
  ]);
}

/** Every page loader in a tree, at any depth. */
function componentLoadersIn(
  routes: readonly AppClientRegisteredRoute[],
): AppClientRouteComponentLoader[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.componentLoader] : []),
    ...componentLoadersIn(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz === 'unrestricted'
                  ? 'unrestricted'
                  : route.authz.resource.type === 'page'
                    ? route.authz.resource.id
                    : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}
