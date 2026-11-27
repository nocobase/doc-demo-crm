import {
  defineSystemSettingsRoutes,
  SYSTEM_SETTINGS_CATEGORIES,
} from '@nocobase/app-client/plugins';
import { Workflow } from 'lucide-react';

export default defineSystemSettingsRoutes([
  {
    parent: SYSTEM_SETTINGS_CATEGORIES.automation,
    name: 'quoteWorkflows',
    kind: 'module',
    navigation: { title: 'settings.workflows.title', icon: Workflow },
    breadcrumb: { title: 'settings.workflows.title' },
    children: [
      {
        name: 'quoteWorkflowDefinitions',
        path: '/workflows/definitions',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'crm.workflow' },
          action: 'read',
        },
        navigation: { title: 'settings.workflows.definitions' },
        breadcrumb: { title: 'settings.workflows.definitions' },
        componentLoader: () => import('../quote-workflows/definitions.js'),
        children: [
          {
            name: 'quoteWorkflowDefinition',
            path: 'quotation',
            componentLoader: () => import('../quote-workflows/definition.js'),
          },
        ],
      },
      {
        name: 'quoteWorkflowExecutions',
        path: '/workflows/executions',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'crm.workflow' },
          action: 'read',
        },
        navigation: { title: 'settings.workflows.executions' },
        breadcrumb: { title: 'settings.workflows.executions' },
        componentLoader: () => import('../quote-workflows/executions.js'),
        children: [
          {
            name: 'quoteWorkflowExecution',
            path: ':executionId',
            componentLoader: () => import('../quote-workflows/execution.js'),
          },
        ],
      },
    ],
  },
]);
