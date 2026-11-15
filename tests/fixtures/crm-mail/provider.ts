import {
  defineMailProviderDefinition,
  type NormalizedMailMessage,
  type MailProviderSendInput,
} from '@nocobase/app-plugin-mail/server';
export function fixtureMailProvider() {
  const sent: MailProviderSendInput[] = [];
  const messages = (address: string): NormalizedMailMessage[] =>
    [
      'contact@harbor.example',
      'contact@harbor.example.evil',
      'other@harbor.example',
    ].map((from, index) => ({
      providerMessageId: `message-${index}`,
      providerFolderIds: ['inbox'],
      from: { address: from },
      to: [{ address }],
      cc: [],
      bcc: [],
      replyTo: [],
      references: [],
      subject:
        index === 0 ? 'Implementation requirements' : 'Other correspondence',
      preview: 'Please review the implementation proposal.',
      text: 'Please review the implementation proposal.',
      receivedAt: '2026-11-15T08:00:00.000Z',
      read: false,
      starred: false,
      draft: false,
      attachments: [],
    }));
  const capabilities = { receive: true, send: true, folders: true };
  const definition = defineMailProviderDefinition({
    type: 'crm-test-mail',
    label: 'Local test mailbox',
    capabilities,
    connection: {
      async connect(context, _config, input) {
        return {
          ok: true as const,
          value: {
            address: input.address,
            displayName: input.displayName,
            credentialReference: await context.credentials.put({
              fixture: true,
            }),
            scopes: [],
            identities: [
              { address: input.address, isPrimary: true, canSend: true },
            ],
          },
        };
      },
    },
    async createAdapter(_context, config, account) {
      return {
        identity: { type: config.type, name: config.name },
        capabilities,
        async getCurrentSyncCursor() {
          return { ok: true as const, value: { value: 'fixture-1' } };
        },
        async listChanges() {
          return {
            ok: true as const,
            value: {
              messages: [],
              deletedProviderMessageIds: [],
              nextCursor: { value: 'fixture-1' },
              hasMore: false,
            },
          };
        },
        async listFolders() {
          return {
            ok: true as const,
            value: {
              folders: [
                {
                  providerFolderId: 'inbox',
                  type: 'inbox' as const,
                  name: 'Inbox',
                  kind: 'folder' as const,
                },
              ],
              completeProviderFolderIds: ['inbox'],
            },
          };
        },
        async listMessages() {
          return {
            ok: true as const,
            value: { messages: messages(account.address) },
          };
        },
        async getMessage(id) {
          return {
            ok: true as const,
            value: messages(account.address).find(
              (m) => m.providerMessageId === id,
            )!,
          };
        },
        async setRead() {
          return { ok: true as const, value: undefined };
        },
        async sendMessage(input) {
          sent.push(input);
          return {
            status: 'accepted' as const,
            providerMessageId: `sent-${sent.length}`,
          };
        },
      };
    },
  });
  return { definition, sent };
}
