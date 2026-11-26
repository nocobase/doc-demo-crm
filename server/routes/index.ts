import crmAssistant from './crm-assistant.js';
import crmReminders from './crm-reminders.js';
import crmMail from './crm-mail.js';
import crmNotifications from './crm-notifications.js';
import customerFileRoutes from './customer-files.js';
import quoteWorkflowRoutes from './quote-workflows.js';
import quoteApprovalRoutes from './quote-approvals.js';
import crmAccessRoutes from './crm-access.js';
import workspaceRoutes from './workspace.js';
import salesRoutes from './sales.js';
import crmRoutes from './crm.js';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

const routes: readonly AppRouteContribution<Application>[] = [
  crmAssistant,
  crmMail,
  crmReminders,
  workspaceRoutes,
  crmAccessRoutes,
  crmRoutes,
  salesRoutes,
  quoteApprovalRoutes,
  quoteWorkflowRoutes,
  crmNotifications,
  ...customerFileRoutes,
];

export default routes;
