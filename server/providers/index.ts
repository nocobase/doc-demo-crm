import CrmNotificationsProvider from './crm-notifications.js';
import QuoteApprovalsProvider from './quote-approvals.js';
import CrmPermissionsProvider from './crm-permissions.js';
import NotificationManagementProvider from './notification-management.js';
import SubmissionProvider from './submission.js';
import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  SubmissionProvider,
  CrmPermissionsProvider,
  NotificationManagementProvider,
  CrmNotificationsProvider,
  QuoteApprovalsProvider,
];

export default serviceProviders;
