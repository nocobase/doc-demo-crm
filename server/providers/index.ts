import DailyReportsProvider from './daily-reports.js';
import CrmAssistantProvider from './crm-assistant.js';
import CrmImportsProvider from './crm-imports.js';
import CrmIntegrationsProvider from './crm-integrations.js';
import CrmRemindersProvider from './crm-reminders.js';
import CrmNotificationsProvider from './crm-notifications.js';
import QuoteApprovalsProvider from './quote-approvals.js';
import CrmPermissionsProvider from './crm-permissions.js';
import ConversationSharingProvider from './conversation-sharing.js';
import SubmissionProvider from './submission.js';
import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  SubmissionProvider,
  CrmPermissionsProvider,
  ConversationSharingProvider,
  CrmNotificationsProvider,
  QuoteApprovalsProvider,
  CrmRemindersProvider,
  DailyReportsProvider,
  CrmAssistantProvider,
  CrmImportsProvider,
  CrmIntegrationsProvider,
];

export default serviceProviders;
