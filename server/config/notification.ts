import { defineMailChannelsConfig } from '@nocobase/app-plugin-notification-providers/config';
import { type AppConfigFactory } from '@nocobase/app-server/config';
import type { NotificationConfigInput } from '@nocobase/app-plugin-notification/server';

const notification: AppConfigFactory<NotificationConfigInput> =
  defineMailChannelsConfig({
    defaults: { channels: { inbox: { type: 'in-app' } } },
  });

export default notification;
