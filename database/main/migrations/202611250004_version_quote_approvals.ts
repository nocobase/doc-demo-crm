import { createHash } from 'node:crypto';
import { defineMigration } from '@nocobase/db';
import { z } from 'zod';

const definition = 'crmQuoteApprovals';
const identity = (...parts: (string | number)[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const revision = z.number().int().nonnegative();
const threshold = z.number().min(0).max(100);
const source = z.object({
  group: z.literal('discount'),
  schemaVersion: z.literal(1),
  revision,
  origin: z.enum(['default', 'configuration']),
});
const snapshot = z.object({
  scope: z.literal('crm'),
  lifecycle: z.literal(definition),
  recordId: z.string(),
  at: z.iso.datetime({ offset: true }),
  values: z.strictObject({ thresholdPercent: threshold }),
  sources: z.strictObject({ thresholdPercent: source }),
  revision: revision.optional(),
});
const configuration = z.object({
  scope: z.literal('crm'),
  group: z.literal('discount'),
  schemaVersion: z.literal(1),
  revision: revision.positive(),
  values: z.strictObject({ thresholdPercent: threshold }),
  actorId: z.string(),
  at: z.iso.datetime({ offset: true }),
});

export default defineMigration({
  name: '202611250004_version_quote_approvals',
  // Configuration writes after this migration belong to the versioned definition.
  // Rolling back requires the matching database backup so revisions and receipts agree.
  irreversible: true,
  async up(context) {
    // Repositories decode JSON on every supported driver. The source shapes and identities
    // below are those of the released, single-threshold quotation process.
    const records = await context.repository(definition).findMany();
    const transitions = await context
      .repository('crmApprovalTransitions')
      .findMany({
        filter: { transition: '$create' },
      });
    const starts = new Map<string, unknown[]>();
    for (const entry of transitions) {
      const id = z.string().parse(entry.recordId);
      starts.set(id, [...(starts.get(id) ?? []), entry.lifecycle]);
    }
    const snapshots = context.repository('crmApprovalParameterSnapshots');
    const byId = new Map(
      (await snapshots.findMany()).map((row) => [row.id, row.payload]),
    );
    const updates: { id: string; payload: object }[] = [];
    const conflicts: string[] = [];
    for (const record of records) {
      const id = z.string().parse(record.id);
      const names = starts.get(id) ?? [];
      if (names.length !== 1 || names[0] !== definition)
        conflicts.push(
          `crmQuoteApprovals/${id}: creation history ${JSON.stringify(names)}`,
        );
      const key = identity('crm', definition, id);
      const payload = byId.get(key);
      const parsed = snapshot.safeParse(payload);
      // The old submit endpoint created and submitted in one transaction. Even a withdrawn
      // draft has a submission snapshot. Never substitute today's threshold for a missing one.
      if (
        !parsed.success ||
        parsed.data.recordId !== id ||
        Math.round(parsed.data.values.thresholdPercent * 100) !==
          record.thresholdBasisPoints ||
        (parsed.data.revision !== undefined &&
          parsed.data.revision !==
            parsed.data.sources.thresholdPercent.revision)
      ) {
        conflicts.push(
          `crmQuoteApprovals/${id}: missing or inconsistent submitted threshold snapshot`,
        );
      } else if (parsed.data.revision === undefined) {
        updates.push({
          id: key,
          payload: {
            ...(payload as object),
            revision: parsed.data.sources.thresholdPercent.revision,
          },
        });
      }
    }
    const heads = context.repository('crmApprovalParameterHeads');
    const versions = context.repository('crmApprovalParameterVersions');
    const oldHead = await heads.findOne({
      filter: { id: identity('crm', 'discount') },
    });
    const copies: { id: string; payload: object; selectionCounts: object }[] =
      [];
    if (oldHead) {
      if (
        oldHead.status !== 'current' ||
        oldHead.scope !== 'crm' ||
        oldHead.groupKey !== 'discount' ||
        !revision.positive().safeParse(oldHead.revision).success
      )
        conflicts.push(
          'crmApprovalParameterHeads/discount: invalid configuration head',
        );
      else
        for (let n = 1; n <= Number(oldHead.revision); n++) {
          const row = await versions.findOne({
            filter: { id: identity('crm', 'discount', n) },
          });
          const parsed = configuration.safeParse(row?.payload);
          if (
            !parsed.success ||
            parsed.data.revision !== n ||
            !row?.selectionCounts ||
            Object.keys(row.selectionCounts).length
          )
            conflicts.push(
              `crmApprovalParameterVersions/discount/${n}: invalid threshold configuration`,
            );
          else
            copies.push({
              id: identity('crm', definition, n),
              payload: { ...parsed.data, group: definition },
              selectionCounts: {},
            });
        }
      if (await heads.findOne({ filter: { id: identity('crm', definition) } }))
        conflicts.push(
          'crmApprovalParameterHeads: the destination configuration already exists',
        );
    }
    if (conflicts.length) throw new Error(conflicts.join('\n'));
    await context.builder.alterCollection(definition, (table) => {
      table.string('approvalDefinition');
    });
    for (const record of records) {
      await context
        .repository(definition)
        .updateOne({
          filter: { id: z.string().parse(record.id) },
          values: { approvalDefinition: definition },
        });
    }
    for (const update of updates)
      await snapshots.updateOne({
        filter: { id: update.id },
        values: { payload: update.payload },
      });
    for (const values of copies) await versions.createOne({ values });
    if (oldHead)
      await heads.createOne({
        values: {
          ...oldHead,
          id: identity('crm', definition),
          groupKey: definition,
        },
      });
  },
});
