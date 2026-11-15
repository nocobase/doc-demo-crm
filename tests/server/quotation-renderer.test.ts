import { inflateRawSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { renderQuotation } from '../../server/providers/quotation-renderer.js';
function documentXml(zip: Buffer) {
  for (let i = 0; i < zip.length - 46; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = zip.readUInt16LE(i + 28);
    const name = zip.subarray(i + 46, i + 46 + nameLength).toString();
    if (name !== 'word/document.xml') continue;
    const offset = zip.readUInt32LE(i + 42);
    const start =
      offset +
      30 +
      zip.readUInt16LE(offset + 26) +
      zip.readUInt16LE(offset + 28);
    const bytes = zip.subarray(start, start + zip.readUInt32LE(i + 20));
    return (
      zip.readUInt16LE(i + 10) === 8 ? inflateRawSync(bytes) : bytes
    ).toString();
  }
  throw new Error('Missing DOCX document');
}
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
