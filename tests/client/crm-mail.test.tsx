import {
  answerApi,
  renderWithApp,
  type ApiCall,
} from '@nocobase/app-testing/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import CustomerMail from '../../client/pages/mail/customer.js';
import enUS from '../../client/locales/en-US.js';
import metadata from '../../package.json' with { type: 'json' };
it('never requests unfiltered mail and clears correspondence when the selected contact changes', async () => {
  const api = vi.fn(({ path, query }: ApiCall) => {
    if (path.startsWith('crm/customers/'))
      return {
        data: [
          { id: 'a', name: 'Casey', email: 'contact@harbor.example' },
          { id: 'b', name: 'Jordan', email: 'jordan@harbor.example' },
        ],
        meta: { total: 2 },
      };
    if (query?.contactId === 'a')
      return {
        data: [
          {
            id: 'm1',
            subject: 'Casey proposal',
            from: { address: 'contact@harbor.example' },
          },
        ],
        meta: { total: 1 },
      };
    if (query?.contactId === 'b') return { data: [], meta: { total: 0 } };
    return new Response(null, { status: 404 });
  });
  await renderWithApp(<CustomerMail customerId='customer' revision={0} />, {
    route: '/',
    namespace: metadata.name,
    namespaces: { [metadata.name]: enUS },
    fetch: answerApi(api),
  });
  const user = userEvent.setup();
  await screen.findByRole('button', { name: /Casey/ });
  expect(
    api.mock.calls.some(([call]) => call.path.startsWith('crmMail/')),
  ).toBe(false);
  await user.click(screen.getByRole('button', { name: /Casey/ }));
  await screen.findByText('Casey proposal');
  await user.click(screen.getByRole('button', { name: /Jordan/ }));
  await waitFor(() =>
    expect(screen.queryByText('Casey proposal')).not.toBeInTheDocument(),
  );
  expect(
    api.mock.calls.some(
      ([call]) =>
        call.path === 'crmMail/customers/customer' &&
        call.query?.contactId === 'b',
    ),
  ).toBe(true);
});
