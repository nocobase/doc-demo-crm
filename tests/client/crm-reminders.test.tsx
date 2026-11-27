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
import { expect, it } from 'vitest';
import CustomerReminders from '../../client/pages/reminders/customer.js';
import enUS from '../../client/locales/en-US.js';
import metadata from '../../package.json' with { type: 'json' };

async function renderPage(edit: boolean) {
  await renderWithApp(
    <AuthenticationProvider>
      <CustomerReminders customerId='customer' revision={0} />
    </AuthenticationProvider>,
    {
      route: '/',
      namespace: metadata.name,
      namespaces: { [metadata.name]: enUS },
      fetch: answerApi(({ path }: ApiCall) => {
        if (path === 'authorization/permissions')
          return {
            data: {
              unrestricted: false,
              permissions: [
                {
                  resource: { type: 'composite', id: 'crm.customers' },
                  actions: ['schedule', 'completeReminder', 'cancelReminder'],
                },
              ],
            },
          };
        if (path.includes('/access'))
          return {
            data: {
              edit,
              actions: {
                scheduleReminder: edit,
                cancelReminder: edit,
                completeReminder: edit,
              },
            },
          };
        if (path.endsWith('/quotes'))
          return {
            data: [{ id: 'quote-id', name: 'Implementation quotation' }],
          };
        return {
          data: [
            {
              id: 'plan',
              title: 'Call Casey',
              kind: 'followUp',
              status: 'pending',
              dueAt: '2026-11-15T13:00:00Z',
            },
          ],
          meta: { total: 1 },
        };
      }),
      services: (app) => {
        app.container.instance(authenticationClientToken, {
          getSession: async () => ({ data: null }),
        });
        app.container.singleton(
          authorizationClientToken,
          (resolver) =>
            new AuthorizationClient(resolver.resolve(apiClientToken)),
        );
      },
    },
  );
}

it('shows readable selected reminder and quotation names', async () => {
  await renderPage(true);
  const user = userEvent.setup();
  const kind = await screen.findByRole('combobox', { name: 'Reminder type' });
  expect(kind).toHaveTextContent('Customer follow-up');
  await user.click(kind);
  await user.click(
    await screen.findByRole('option', { name: 'Quotation response deadline' }),
  );
  expect(kind).toHaveTextContent('Quotation response deadline');
  const quote = screen.getByRole('combobox', { name: 'Confirmed quotation' });
  await user.click(quote);
  await user.click(
    await screen.findByRole('option', { name: 'Implementation quotation' }),
  );
  expect(quote).toHaveTextContent('Implementation quotation');
});

it('keeps shared customers read only even with the role-level edit grant', async () => {
  await renderPage(false);
  await screen.findByText('Call Casey');
  expect(
    screen.queryByRole('button', { name: 'Schedule reminder' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Complete', exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Cancel', exact: true }),
  ).not.toBeInTheDocument();
});
