import { defineMigration } from '@nocobase/db';

// The first distributed quote-approval schema lacked the quote revision and parameter storage.
// Add the complete missing set only on that schema. Keep the original executed migration intact.
const parameters = [
  'crmApprovalParameterHeads',
  'crmApprovalParameterVersions',
  'crmApprovalParameterSelections',
  'crmApprovalParameterRequests',
  'crmApprovalParameterSnapshots',
  'crmApprovalParameterUsages',
];

export default defineMigration({
  name: '202611250003_complete_quote_approval_storage',
  irreversible: true,
  async shouldRun({ builder }) {
    const quotes = await builder.getCollection('crmQuotes');
    if (!quotes) return false;
    const present = [
      Boolean(quotes.fields?.some((field) => field.name === 'revision')),
      ...(await Promise.all(
        parameters.map((name) => builder.hasCollection(name)),
      )),
    ];
    if (present.every(Boolean)) return false;
    if (present.some(Boolean))
      throw new Error(
        'Partial CRM quotation approval schema. Review the quote revision and all six parameter collections before upgrading.',
      );
    return true;
  },
  async up({ builder }) {
    await builder.alterCollection('crmQuotes', (c) => {
      c.integer('revision').notNull().defaultTo(0);
    });
    await builder.createCollection('crmApprovalParameterHeads', (table) => {
      table.string('id', { length: 64 }).primary().notNull();
      table.string('scope').notNull();
      table.string('groupKey').notNull();
      table.string('status').notNull();
      table.integer('revision').notNull();
      table.unique(['scope', 'groupKey']);
    });
    await builder.createCollection('crmApprovalParameterVersions', (table) => {
      table.string('id', { length: 64 }).primary().notNull();
      table.json('payload').notNull();
      table.json('selectionCounts').notNull();
    });
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
    await builder.createCollection('crmApprovalParameterRequests', (table) => {
      table.string('id', { length: 64 }).primary().notNull();
      table.string('actorId').notNull();
      table.text('fingerprint').notNull();
      table.integer('revision').notNull();
    });
    await builder.createCollection('crmApprovalParameterSnapshots', (table) => {
      table.string('id', { length: 64 }).primary().notNull();
      table.json('payload').notNull();
    });
    await builder.createCollection('crmApprovalParameterUsages', (table) => {
      table.string('id', { length: 64 }).primary().notNull();
      table.json('payload').notNull();
      table.string('recordKey', { length: 64 }).notNull();
      table.datetimeTz('at').notNull();
      table.index(['recordKey', 'at', 'id']);
    });
  },
});
