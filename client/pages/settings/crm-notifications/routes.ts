import { Bell, FileClock, List } from 'lucide-react';
import { defineAppRoutes } from '@nocobase/app-client/plugins';
export default defineAppRoutes([
  {
    name: 'notificationManagement',
    parent: 'settingsSystem',
    navigation: { title: 'settings.notificationManagement', icon: Bell },
    breadcrumb: { title: 'settings.notificationManagement' },
    children: [
      {
        name: 'notificationLogs',
        path: '/notifications/logs',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'notification.logs' },
          action: 'access',
        },
        navigation: { title: 'crmNotifications.logs', icon: FileClock },
        componentLoader: () => import('./logs.js'),
      },
      {
        name: 'crmNotificationEvents',
        path: '/notifications/events',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'notification.logs' },
          action: 'access',
        },
        navigation: { title: 'crmNotifications.events', icon: List },
        componentLoader: () => import('./events.js'),
      },
    ],
  },
]);
