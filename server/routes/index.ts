import quoteWorkflowRoutes from './quote-workflows.js';
import quoteApprovalRoutes from './quote-approvals.js';
import crmAccessRoutes from './crm-access.js';
import workspaceRoutes from './workspace.js';
import salesRoutes from './sales.js';
import crmRoutes from './crm.js';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

const routes: readonly AppRouteContribution<Application>[] = [
  workspaceRoutes,
  crmAccessRoutes,
  crmRoutes,
  salesRoutes,
  quoteApprovalRoutes,
  quoteWorkflowRoutes,
];

export default routes;
