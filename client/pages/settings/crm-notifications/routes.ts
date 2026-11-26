import { List } from 'lucide-react';
import {
  defineSystemSettingsRoutes,
  SYSTEM_SETTINGS_CATEGORIES,
} from '@nocobase/app-client/plugins';
export default defineSystemSettingsRoutes([
  {
    parent: SYSTEM_SETTINGS_CATEGORIES.messages,
    name: 'crmNotificationEvents',
    path: '/notifications/events',
    auth: 'required',
    authz: {
      resource: { type: 'page', id: 'notification.logs' },
      action: 'access',
    },
    navigation: { title: 'crmNotifications.title', icon: List },
    breadcrumb: { title: 'crmNotifications.events' },
    componentLoader: () => import('./events.js'),
  },
  {
    // An event's deep link opens the exact notification and its delivery attempts.
    name: 'notificationLogs',
    path: '/notifications/logs',
    auth: 'required',
    authz: {
      resource: { type: 'settings', id: 'notification' },
      action: 'read',
    },
    breadcrumb: { title: 'crmNotifications.logs' },
    componentLoader: () => import('./logs.js'),
  },
  {
    name: 'notificationTemplates',
    path: '/notifications/templates',
    authz: {
      resource: { type: 'settings', id: 'notification' },
      action: 'read',
    },
    componentLoader: () => import('./kinds-redirect.js'),
    children: [
      {
        name: 'notificationTemplateDetail',
        path: ':templateId',
        componentLoader: () => import('./kinds-redirect.js'),
      },
    ],
  },
]);
