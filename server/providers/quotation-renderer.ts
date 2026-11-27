import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import carbone from 'carbone';
import { quotationTemplate } from '../templates/quotation-v2.js';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Only our fixed template and bounded plain DTO enter the public renderer. No PDF converter runs. */
export async function renderQuotation(
  data: Record<string, unknown>,
  kind: 'draft' | 'confirmed' = 'confirmed',
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'crm-quotation-'));
  try {
    const template = join(directory, 'quotation.docx');
    await writeFile(template, Buffer.from(quotationTemplate, 'base64'));
    return await new Promise((resolve, reject) =>
      carbone.render(
        template,
        {
          ...data,
          heading: kind === 'draft' ? 'DRAFT QUOTATION' : 'QUOTATION',
          statusLabel:
            kind === 'draft' ? 'Draft preview' : 'Confirmed quotation',
        },
        { lang: 'en-us', timezone: 'UTC' },
        (error, result) => {
          if (error) reject(error);
          else if (Buffer.isBuffer(result)) resolve(result);
          else reject(new Error('Renderer did not return document bytes'));
        },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
