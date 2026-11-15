import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611150001_quote_approvals',
  // SQLite rebuilds the referenced quote table when removing revision.
  // Restore a matching backup to reverse this retained-data upgrade.
  irreversible: true,
  async up({ builder }) {
    await builder.alterCollection('crmQuotes', (c) => { c.integer('revision').notNull().defaultTo(0); });
    await builder.createCollection(
      'crmApprovalParameterHeads',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.string('scope').notNull();
        table.string('groupKey').notNull();
        table.string('status').notNull();
        table.integer('revision').notNull();
        table.unique(['scope', 'groupKey']);
      },
    );
    await builder.createCollection(
      'crmApprovalParameterVersions',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.json('payload').notNull();
        table.json('selectionCounts').notNull();
      },
    );
    await builder.createCollection(
      'crmApprovalParameterSelections',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.string('versionId', { length: 64 }).notNull();
        table.string('ruleKey').notNull();
        table.integer('group').notNull();
        table.string('type').notNull();
        table.string('referenceId').notNull();
        table.index(['versionId']);
      },
    );
    await builder.createCollection(
      'crmApprovalParameterRequests',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.string('actorId').notNull();
        table.text('fingerprint').notNull();
        table.integer('revision').notNull();
      },
    );
    await builder.createCollection(
      'crmApprovalParameterSnapshots',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.json('payload').notNull();
      },
    );
    await builder.createCollection(
      'crmApprovalParameterUsages',
      (table) => {
        table.string('id', { length: 64 }).primary().notNull();
        table.json('payload').notNull();
        table.string('recordKey', { length: 64 }).notNull();
        table.datetimeTz('at').notNull();
        table.index(['recordKey', 'at', 'id']);
      },
    );
    await builder.createCollection('crmQuoteApprovals', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('quoteId', { length: 64 }).notNull().unique();
      c.string('customerId', { length: 64 }).notNull();
      c.string('opportunityId', { length: 64 }).notNull();
      c.string('applicantId').notNull();
      c.string('reviewerId');
      c.json('snapshot').notNull();
      c.integer('maxDiscountBasisPoints').notNull();
      c.integer('thresholdBasisPoints').notNull();
      c.string('status').notNull();
      c.datetimeTz('statusChangedAt').notNull();
      c.integer('lifecycleVersion').notNull().defaultTo(0);
      c.datetimeTz('createdAt').notNull();
      c.index(['status', 'statusChangedAt']);
      c.index(['customerId']);
      c.foreignKey('quoteId', { references: { collection: 'crmQuotes', fields: ['id'] }, onDelete: 'restrict' });
    });
    await builder.createCollection('crmApprovalTransitions', (table) => {
      table.bigInt('id').primary().autoIncrement().notNull();
      table.string('lifecycle').notNull();
      table.string('recordId').notNull();
      table.string('transition').notNull();
      // Null on the entry runtime.create() writes.
      table.string('from');
      table.string('to').notNull();
      table.string('actorId').notNull();
      table.json('input').notNull().defaultTo({});
      table.datetimeTz('at').notNull();
      table.integer('version').notNull();
      // The caller's request id, as it sent it; null when it sent none.
      table.string('requestId');
      // What a repeated request is found by: the request id, or a key derived
      // from the version for an entry without one. It is never null, so one
      // plain unique index means the same on every dialect, whichever way it
      // treats NULL in a unique index.
      table.string('requestKey').notNull();
      table.index(['lifecycle', 'recordId', 'id']);
      table.unique(['lifecycle', 'recordId', 'version']);
      table.unique(['lifecycle', 'recordId', 'requestKey']);
    });

    await builder.createCollection('crmApprovalEffectRuns', (table) => {
      table.bigInt('id').primary().autoIncrement().notNull();
      table.bigInt('transitionId').notNull();
      table.string('lifecycle').notNull();
      table.string('recordId').notNull();
      table.string('effect').notNull();
      table.boolean('stayBound').notNull();
      table.string('status').notNull();
      table.integer('attempts').notNull().defaultTo(0);
      table.integer('maxAttempts').notNull().defaultTo(1);
      table.json('result');
      table.text('error');
      table.datetimeTz('createdAt').notNull();
      table.datetimeTz('updatedAt').notNull();
      table.datetimeTz('claimedAt');
      table.datetimeTz('runAfter');
      // A continuation the outcome still has to fire, refused so far for a
      // reason a deploy can remove; null when nothing is pending.
      table.json('continuation');
      // When the sweep may try that continuation next: null exactly when
      // nothing is pending, so the sweep finds the due runs without a JSON
      // filter, those due longest first.
      table.datetimeTz('continuationDueAt');
      // When the sweep gave up on that continuation: null unless it did, so
      // an operations page finds those runs, and prune() keeps them, without
      // a JSON filter.
      table.datetimeTz('continuationAbandonedAt');
      table.index(['status', 'id']);
      table.index(['lifecycle', 'recordId', 'id']);
      table.index(['continuationDueAt']);
      table.index(['continuationAbandonedAt']);
    });
  },
});
