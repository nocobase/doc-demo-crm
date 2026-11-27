import { readFile } from 'node:fs/promises';
import { quotationTemplate } from '../../server/templates/quotation-v2.js';
import { expect, test } from 'vitest';
import { renderQuotation } from '../../server/providers/quotation-renderer.js';
import { documentXml } from '../helpers/docx.js';

test('ships the same DOCX template that the renderer embeds', async () => {
  const source = await readFile(
    new URL('../../docs/templates/quotation-v2.docx', import.meta.url),
  );
  expect(Buffer.from(quotationTemplate, 'base64')).toEqual(source);
});

test('renders every quotation row, escapes business text and retains fixed monetary values', async () => {
  const xml = documentXml(
    await renderQuotation({
      name: 'Phase <one>',
      customer: '客户 & Partners',
      opportunity: 'Rollout',
      currency: 'USD',
      reference: 'frozen-id',
      total: '190.00',
      lines: [
        {
          productName: 'Implementation',
          quantity: 2,
          unitPrice: '100.00',
          discount: '10%',
          amount: '180.00',
        },
        {
          productName: 'Support',
          quantity: 1,
          unitPrice: '10.00',
          discount: '0%',
          amount: '10.00',
        },
      ],
    }),
  );
  for (const value of [
    'Phase &lt;one&gt;',
    '客户 &amp; Partners',
    'Implementation',
    'Support',
    '180.00',
    '10.00',
    '190.00',
    'USD',
    'frozen-id',
  ])
    expect(xml).toContain(value);
  expect(xml).not.toMatch(/\{d\./);
  expect((xml.match(/<w:tr>/g) ?? []).length).toBe(3);
});
