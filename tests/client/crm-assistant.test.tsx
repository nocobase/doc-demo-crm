import {
  AuthenticationProvider,
  authenticationClientToken,
} from '@nocobase/app-plugin-authentication/client';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
} from '@nocobase/app-plugin-authorization/client';
import {
  answerApi,
  renderWithApp,
  type ApiCall,
} from '@nocobase/app-testing/client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CustomerAssistant } from '../../client/pages/customers/assistant.js';
import enUS from '../../client/locales/en-US.js';
import metadata from '../../package.json' with { type: 'json' };

async function renderAssistant({
  hasModel,
  canSaveFollowUp,
  onPostFollowUp,
}: {
  hasModel: boolean;
  canSaveFollowUp: boolean;
  onPostFollowUp?: (call: ApiCall) => void;
}) {
  const reload = vi.fn();
  await renderWithApp(
    <AuthenticationProvider>
      <CustomerAssistant
        customerId='00000000-0000-4000-8000-000000000001'
        revision={0}
        reload={reload}
      />
    </AuthenticationProvider>,
    {
      route:
        '/customers/00000000-0000-4000-8000-000000000001/details/assistant',
      namespace: metadata.name,
      namespaces: { [metadata.name]: enUS },
      fetch: answerApi((call: ApiCall) => {
        if (call.path === 'authorization/permissions') {
          return {
            data: {
              unrestricted: false,
              permissions: [
                {
                  resource: { type: 'composite', id: 'crm.records' },
                  actions: ['view', 'recordFollowUp'],
                },
              ],
            },
          };
        }
        if (call.path.includes('/access')) {
          return {
            data: {
              edit: canSaveFollowUp,
              actions: { recordFollowUp: canSaveFollowUp },
            },
          };
        }
        if (call.path.startsWith('crmAssistant/models')) {
          return {
            data: hasModel
              ? {
                  services: [
                    {
                      name: 'deepseek',
                      title: 'DeepSeek',
                      provider: 'deepseek',
                      models: [
                        { value: 'deepseek-chat', label: 'DeepSeek Chat' },
                      ],
                    },
                  ],
                  defaultModel: {
                    modelService: 'deepseek',
                    model: 'deepseek-chat',
                  },
                }
              : { services: [], defaultModel: null },
          };
        }
        if (call.path.endsWith('/follow-up-draft') && call.method === 'POST') {
          return {
            data: {
              sessionId: 'session-1',
              model: { modelService: 'deepseek', model: 'deepseek-chat' },
              canSaveFollowUp,
              draft: {
                summary:
                  'Northstar Manufacturing is reviewing implementation scope.',
                suggestedNextStep:
                  'Confirm rollout timeline and manager approval for 15% discount.',
                channel: 'email',
                draftContent:
                  'Sharing our implementation timeline and discount approval notes.',
                citations: [
                  {
                    docId: 'doc-1',
                    title: 'Quotation Discount Policy',
                    version: 2,
                    excerpt:
                      'Discounts above 10% require sales manager approval.',
                  },
                ],
                missingEvidence: ['No custom penalty SLA is documented.'],
              },
            },
          };
        }
        if (call.path.endsWith('/followUps') && call.method === 'POST') {
          onPostFollowUp?.(call);
          return { data: { id: 'fu-1' } };
        }
        return { data: null };
      }),
      services: (app) => {
        app.container.instance(authenticationClientToken, {
          getSession: async () => ({
            data: {
              session: { id: 'sess-alex' },
              user: { id: 'user-alex', name: 'Alex Rivera' },
            },
          }),
        });
        app.container.singleton(
          authorizationClientToken,
          (resolver) =>
            new AuthorizationClient(resolver.resolve(apiClientToken)),
        );
      },
    },
  );
  return { reload };
}

it('shows guidance when no chat model is configured', async () => {
  await renderAssistant({ hasModel: false, canSaveFollowUp: true });
  await screen.findByText('No enabled chat model');
  expect(
    screen.queryByRole('button', { name: 'Generate follow-up draft' }),
  ).not.toBeInTheDocument();
});

it('generates an evidence-backed editable draft and saves only after explicit confirmation', async () => {
  const savedCalls: ApiCall[] = [];
  const { reload } = await renderAssistant({
    hasModel: true,
    canSaveFollowUp: true,
    onPostFollowUp: (call) => savedCalls.push(call),
  });
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole('button', { name: 'Generate follow-up draft' }),
  );

  await screen.findByText('Quotation Discount Policy');
  expect(screen.getByText('v2')).toBeInTheDocument();
  expect(
    screen.getByText('No custom penalty SLA is documented.'),
  ).toBeInTheDocument();
  expect(savedCalls).toHaveLength(0);

  const summaryBox = screen.getByLabelText('Summary');
  await user.clear(summaryBox);
  await user.type(summaryBox, 'Reviewed draft edited by Alex.');

  await user.click(screen.getByRole('button', { name: 'Save as follow-up' }));
  await screen.findByText('Follow-up saved from reviewed draft.');
  expect(savedCalls).toHaveLength(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('blocks saving drafts for read-only shared users', async () => {
  await renderAssistant({ hasModel: true, canSaveFollowUp: false });
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole('button', { name: 'Generate follow-up draft' }),
  );
  await screen.findByText('Quotation Discount Policy');
  expect(screen.getByText(/Read-only shared access/i)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save as follow-up' }),
  ).not.toBeInTheDocument();
});
