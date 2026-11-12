import salesRoutes from './sales.js';
import crmRoutes from './crm.js';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

const routes: readonly AppRouteContribution<Application>[] = [
  crmRoutes,
  salesRoutes,
];

export default routes;
