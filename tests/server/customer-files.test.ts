import { driveManagerToken } from '@nocobase/app-server/drive';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createAppTest } from '@nocobase/app-testing/server';
import { afterAll, expect, vi } from 'vitest';
import { documentXml } from '../helpers/docx.js';
import * as renderer from '../../server/providers/quotation-renderer.js';
import { CustomerFilesService } from '../../server/providers/customer-files.js';
import { createStandaloneServer } from '../../server/standalone.js';
const storage = mkdtempSync(join(tmpdir(), 'crm-files-'));
afterAll(() => rm(storage, { recursive: true, force: true }));
const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    drive: {
      default: 'attachments',
      disks: {
        attachments: { driver: 'fs', location: storage, visibility: 'private' },
      },
    },
    app: { publicOrigin: 'http://localhost' },
    auth: {
      secret: 'crm-file-test-secret-at-least-32-characters',
      trustedOrigins: ['http://localhost'],
    },
    users: { initialAdmin: DEFAULT_ADMIN_CREDENTIALS },
  },
});
const write = (
  body: unknown,
  method = 'POST',
  key = `${Date.now()}.${randomUUID()}`,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'idempotency-key': key,
  },
  body: JSON.stringify(body),
});
async function data(r: Response) {
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body));
  return body.data;
}
test('uploads private files, attaches with customer scope and issues one frozen DOCX', async ({
  testApp,
  request,
  connection,
}) => {
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  async function person(name: string, role: string) {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: 'file-test-password',
      name,
    };
    const user = await users.create({
      ...credentials,
      roleScopes: { app: [role] },
    });
    return { user, session: await signIn(testApp, credentials) };
  }
  const a = await person('Alex', 'crm-sales');
  const m = await person('Morgan', 'crm-sales-manager');
  const other = await person('Taylor', 'crm-sales');
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const checked = await data(
    await admin.fetch('/file/disks/attachments/check', write({})),
  );
  expect(checked.ok).toBe(true);
  const customer = await data(
    await a.session.fetch(
      '/crm/customers',
      write({ name: '客户 <Northstar> & Partners' }),
    ),
  );
  const customerPath = `/crmFiles/customers/${customer.id}`;
  const upload = new FormData();
  upload.append(
    'file',
    new File(['Requirements & Unicode 中文'], 'requirements.txt', {
      type: 'text/plain',
    }),
  );
  const uploaded = await data(
    await a.session.fetch('/crmFileUploads/uploadOne', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: upload,
    }),
  );
  const file = uploaded.record;
  expect(file.filename).toBe('requirements.txt');
  const files = connection.repository('crmFiles');
  const stored = await files.findOne({ filter: { id: file.id } });
  expect(stored?.disk).toBe('attachments');
  const drive = testApp.application.container.resolve(driveManagerToken);
  const legacyId = randomUUID();
  const legacyKey = `objects/${legacyId}.txt`;
  await drive.use('local').put(legacyKey, 'Earlier local attachment');
  await files.createOne({
    values: { ...stored, id: legacyId, disk: 'local', key: legacyKey },
  });
  const legacyUrl = `http://localhost${file.contentUrl.replace(file.id, legacyId)}`;
  expect(await (await a.session.fetch(legacyUrl)).text()).toBe(
    'Earlier local attachment',
  );
  const url = `http://localhost${file.contentUrl}`;
  expect(await (await a.session.fetch(url)).text()).toBe(
    'Requirements & Unicode 中文',
  );
  expect(
    (await a.session.fetch(url)).headers.get('content-disposition'),
  ).toContain('attachment');
  expect((await other.session.fetch(url)).status).toBe(404);
  expect((await testApp.fetch(new Request(url))).status).toBe(401);
  await data(await a.session.fetch(customerPath, write({ ids: [file.id] })));
  expect((await data(await a.session.fetch(customerPath)))[0].id).toBe(file.id);
  await data(
    await m.session.fetch(
      `/crm/customers/${customer.id}/shares`,
      write({ userIds: [other.user.id] }, 'PUT'),
    ),
  );
  expect(await (await other.session.fetch(url)).text()).toBe(
    'Requirements & Unicode 中文',
  );
  expect(
    (await other.session.fetch(customerPath, write({ ids: [file.id] }))).status,
  ).toBe(404);
  expect(
    (
      await other.session.fetch(
        `${customerPath}/${file.id}`,
        write({}, 'DELETE'),
      )
    ).status,
  ).toBe(404);
  await data(
    await m.session.fetch(
      `/crm/customers/${customer.id}/shares`,
      write({ userIds: [] }, 'PUT'),
    ),
  );
  expect((await other.session.fetch(url)).status).toBe(404);
  const product = await data(
    await m.session.fetch(
      '/crmSales/products',
      write({
        name: 'Implementation & support',
        code: randomUUID(),
        unitPrice: 100,
      }),
    ),
  );
  const opp = await data(
    await a.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities`,
      write({ name: 'Regional rollout' }),
    ),
  );
  const quote = await data(
    await a.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities/${opp.id}/quotes`,
      write({
        name: 'Rollout proposal',
        lines: [{ productId: product.id, quantity: 2, discount: 15 }],
      }),
    ),
  );
  const docPath = `/crmFiles/quotes/${customer.id}/${opp.id}/${quote.id}`;
  const draftPath = `${docPath}/draft`;
  const approvalPath = `/crmApprovals/quotes/${customer.id}/${opp.id}/${quote.id}`;
  const quotePath = `/crmSales/customers/${customer.id}/opportunities/${opp.id}/quotes/${quote.id}`;
  const approvalRows = connection.repository('crmQuoteApprovals');
  const draftFiles = await files.count();
  expect((await request(draftPath)).status).toBe(401);
  expect((await other.session.fetch(draftPath)).status).toBe(404);
  expect((await a.session.fetch(docPath, write({}))).status).toBe(400);
  async function preview(quantity: number, total: string) {
    const response = await a.session.fetch(draftPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain(
      'draft-quotation-',
    );
    const xml = documentXml(Buffer.from(await response.arrayBuffer()));
    for (const value of [
      'DRAFT QUOTATION',
      'Implementation &amp; support',
      `>${quantity}<`,
      '100.00',
      '15%',
      `Total: ${total} USD`,
    ])
      expect(xml).toContain(value);
    expect(xml).not.toContain('Confirmed quotation');
    expect(await approvalRows.count({ filter: { quoteId: quote.id } })).toBe(0);
    expect(await files.count()).toBe(draftFiles);
    expect(await connection.repository('crmQuoteDocuments').count()).toBe(0);
    expect((await data(await a.session.fetch(approvalPath))).status).toBe(
      'draft',
    );
  }
  await preview(2, '170.00');
  await data(
    await a.session.fetch(
      quotePath,
      write(
        {
          name: quote.name,
          lines: [
            {
              productId: product.id,
              quantity: 3,
              unitPrice: 100,
              discount: 15,
            },
          ],
        },
        'PATCH',
      ),
    ),
  );
  await preview(3, '255.00');
  await data(
    await a.session.fetch(
      `${approvalPath}/submit`,
      write({ reviewerId: m.user.id }),
    ),
  );
  expect((await a.session.fetch(draftPath)).status).toBe(400);
  const review = await data(await m.session.fetch(approvalPath));
  const [run] = review.runs;
  await data(
    await m.session.fetch(
      `${approvalPath}/actions`,
      write({
        taskId: run.tasks[0].id,
        action: 'approve',
        contentHash: run.run.contentHash,
      }),
    ),
  );
  expect((await a.session.fetch(draftPath)).status).toBe(400);
  // A catalog price change before issuance must not enter the confirmed snapshot.
  await data(
    await m.session.fetch(
      `/crmSales/products/${product.id}`,
      write(
        { name: 'Repriced implementation', code: product.code, unitPrice: 125 },
        'PATCH',
      ),
    ),
  );
  const renderFailure = vi
    .spyOn(renderer, 'renderQuotation')
    .mockRejectedValueOnce(new Error('synthetic renderer failure'));
  expect((await a.session.fetch(docPath, write({}))).status).toBe(500);
  renderFailure.mockRestore();
  expect(await connection.repository('crmQuoteDocuments').count()).toBe(0);
  const concurrent = await Promise.all([
    a.session.fetch(docPath, write({})).then(data),
    a.session.fetch(docPath, write({})).then(data),
  ]);
  expect(concurrent[0].file.id).toBe(concurrent[1].file.id);
  const key = `${Date.now()}.${randomUUID()}`;
  const issued = await data(
    await a.session.fetch(docPath, write({}, 'POST', key)),
  );
  const repeat = await data(
    await a.session.fetch(docPath, write({}, 'POST', key)),
  );
  expect(repeat.file.id).toBe(issued.file.id);
  expect((await files.findOne({ filter: { id: issued.file.id } }))?.disk).toBe(
    'attachments',
  );
  const issuedUrl = `http://localhost${issued.file.contentUrl}`;
  const firstDownload = Buffer.from(
    await (await a.session.fetch(issuedUrl)).arrayBuffer(),
  );
  const issuedXml = documentXml(firstDownload);
  expect(issuedXml).toContain('Confirmed quotation');
  expect(issuedXml).toContain('Implementation &amp; support');
  expect(issuedXml).toContain('100.00');
  expect(issuedXml).toContain('Total: 255.00 USD');
  expect(issuedXml).not.toContain('DRAFT');
  expect((await other.session.fetch(issuedUrl)).status).toBe(404);
  await data(
    await m.session.fetch(
      `/crmSales/products/${product.id}`,
      write(
        { name: 'Changed catalog', code: product.code, unitPrice: 900 },
        'PATCH',
      ),
    ),
  );
  const another = await data(await a.session.fetch(docPath, write({})));
  expect(another.file.id).toBe(issued.file.id);
  const doc = await a.session.fetch(
    `http://localhost${issued.file.contentUrl}`,
  );
  expect(doc.headers.get('content-type')).toContain('wordprocessingml');
  const bytes = new Uint8Array(await doc.arrayBuffer());
  expect(Buffer.from(bytes)).toEqual(firstDownload);
  await data(
    await a.session.fetch(
      `/crm/customers/${customer.id}`,
      write({ name: 'Renamed customer' }, 'PATCH'),
    ),
  );
  await data(
    await a.session.fetch(
      `/crmSales/customers/${customer.id}/opportunities/${opp.id}`,
      write(
        { name: 'Renamed opportunity', stage: 'proposal', notes: '' },
        'PATCH',
      ),
    ),
  );
  const afterRename = await data(await a.session.fetch(docPath, write({})));
  expect(afterRename.file.id).toBe(issued.file.id);
  expect(
    new Uint8Array(
      await (
        await a.session.fetch(`http://localhost${afterRename.file.contentUrl}`)
      ).arrayBuffer(),
    ),
  ).toEqual(bytes);

  expect(await connection.repository('crmQuoteDocuments').count()).toBe(1);
  await data(
    await m.session.fetch(
      `/crm/customers/${customer.id}/owner`,
      write({ ownerId: other.user.id }, 'PUT'),
    ),
  );
  expect((await a.session.fetch(url)).status).toBe(404);
  expect((await a.session.fetch(docPath, write({}))).status).toBe(404);
  expect(
    (await other.session.fetch(`http://localhost${issued.file.contentUrl}`))
      .status,
  ).toBe(200);
  await data(
    await other.session.fetch(
      `${customerPath}/${file.id}`,
      write({}, 'DELETE'),
    ),
  );
  expect((await a.session.fetch(url)).status).toBe(404);
  expect((await other.session.fetch(url)).status).toBe(404);
  expect(
    (await a.session.fetch('/crmFileUploads/findMany', write({}))).status,
  ).toBe(200);
  expect((await request('/crmDocuments/settings')).status).toBe(401);
  expect((await a.session.fetch('/crmDocuments/settings')).status).toBe(403);
  expect(
    (await data(await admin.fetch('/crmDocuments/settings'))).storage.disk,
  ).toBe('attachments');
  const orphanForm = new FormData();
  orphanForm.append(
    'file',
    new File(['orphan'], 'orphan.txt', { type: 'text/plain' }),
  );
  const orphan = (
    await data(
      await a.session.fetch('/crmFileUploads/uploadOne', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: orphanForm,
      }),
    )
  ).record;
  const cleanupPath = `/crmDocuments/orphans/${orphan.id}`;
  expect((await admin.fetch(cleanupPath, write({}, 'DELETE'))).status).toBe(
    400,
  );
  await connection.repository('crmFiles').updateOne({
    filter: { id: orphan.id },
    values: { createdAt: new Date(Date.now() - 90000000).toISOString() },
  });
  const rows = await data(await admin.fetch('/crmDocuments/orphans'));
  expect(rows.map((row: { id: string }) => row.id)).toEqual([orphan.id]);
  expect((await a.session.fetch(cleanupPath, write({}, 'DELETE'))).status).toBe(
    403,
  );
  const service = new CustomerFilesService(testApp.application);
  await connection.transaction(async (tx) => {
    await service.claimCleanup(tx, orphan.id);
  });
  expect(
    (await other.session.fetch(customerPath, write({ ids: [orphan.id] })))
      .status,
  ).toBe(400);
  const ownedCustomer = await data(
    await a.session.fetch('/crm/customers', write({ name: 'Same uploader' })),
  );
  expect(
    (
      await a.session.fetch(
        `/crmFiles/customers/${ownedCustomer.id}`,
        write({ ids: [orphan.id] }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await data(await admin.fetch('/crmDocuments/orphans?status=staged')))
      .length,
  ).toBe(0);
  expect(
    (await data(await admin.fetch('/crmDocuments/orphans?status=deleting')))
      .length,
  ).toBe(1);
  const disk = drive.use('attachments');
  const failedDelete = vi
    .spyOn(disk, 'delete')
    .mockRejectedValueOnce(new Error('storage unavailable'));
  const cleanupKey = `${Date.now()}.${randomUUID()}`;
  expect(
    (await admin.fetch(cleanupPath, write({}, 'DELETE', cleanupKey))).status,
  ).toBe(500);
  failedDelete.mockRestore();
  expect(
    (
      await connection
        .repository('crmFiles')
        .findOne({ filter: { id: orphan.id } })
    )?.status,
  ).toBe('deleting');
  await data(await admin.fetch(cleanupPath, write({}, 'DELETE', cleanupKey)));
  await data(await admin.fetch(cleanupPath, write({}, 'DELETE', cleanupKey)));
  expect(
    await connection
      .repository('crmFiles')
      .findOne({ filter: { id: orphan.id } }),
  ).toBeUndefined();
  expect(
    (
      await admin.fetch(
        `/crmDocuments/orphans/${issued.file.id}`,
        write({}, 'DELETE'),
      )
    ).status,
  ).toBe(400);
});
