import { answerApi } from '@nocobase/app-testing/client';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import * as downloads from '../../client/pages/documents/download.js';
import { expect, it, vi } from 'vitest';
import { renderCrmClient } from '../helpers/crm-client.js';
import QuoteDocument from '../../client/pages/documents/quote-document.js';
import { CustomerAttachments } from '../../client/pages/documents/files.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
const namespace = 'document-test';
const namespaces = {
  [namespace]: {
    'en-US': async () => ({ default: enUS }),
    'zh-CN': async () => ({ default: zhCN }),
  },
};
it('withholds formal generation for an unconfirmed quotation', async () => {
  await renderCrmClient(
    <Routes>
      <Route
        path='/quotes/:customerId/:opportunityId/:quoteId'
        element={<QuoteDocument revision={0} />}
      />
    </Routes>,
    {
      route: '/quotes/customer/opportunity/quote',
      fetch: answerApi(() => ({ data: { confirmed: false, document: null } })),
      namespace,
      namespaces,
    },
  );
  expect(
    await screen.findByText(
      'Confirm this quotation before generating the document.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Generate DOCX' }),
  ).not.toBeInTheDocument();
});
it('downloads the live draft from its own action and offers no formal issuance', async () => {
  const download = vi
    .spyOn(downloads, 'downloadFile')
    .mockResolvedValue(undefined);
  try {
    await renderCrmClient(
      <Routes>
        <Route
          path='/quotes/:customerId/:opportunityId/:quoteId'
          element={<QuoteDocument revision={0} />}
        />
      </Routes>,
      {
        route: '/quotes/customer/opportunity/quote',
        fetch: answerApi(() => ({
          data: { draft: true, confirmed: false, document: null },
        })),
        namespace,
        namespaces,
      },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Download draft DOCX' }),
    );
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'draft-quotation-quote.docx',
        contentUrl: expect.stringContaining(
          '/api/crmFiles/quotes/customer/opportunity/quote/draft',
        ),
      }),
    );
    expect(
      screen.queryByRole('button', { name: 'Generate DOCX' }),
    ).not.toBeInTheDocument();
  } finally {
    download.mockRestore();
  }
});
it('shared customer attachments omit write actions but preserve the read surface', async () => {
  await renderCrmClient(
    <CustomerAttachments customerId='customer' revision={0} />,
    {
      fetch: answerApi(() => ({ data: [], meta: { total: 0 } })),
      namespace,
      namespaces,
    },
    { customerAccess: { edit: false }, recordActions: ['viewCustomer'] },
  );
  expect(
    await screen.findByRole('heading', { name: 'Attachments' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Add attachments' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Remove' }),
  ).not.toBeInTheDocument();
});
