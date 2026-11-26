import { createHash } from 'node:crypto';
import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

const name = 'crmQuoteApprovals';
const at = '2026-11-01T00:00:00.000Z';
const identity = (...parts: (string | number)[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const submitted = {
  scope: 'crm',
  lifecycle: name,
  recordId: 'quote',
  at,
  values: { thresholdPercent: 10 },
  sources: {
    thresholdPercent: {
      schemaVersion: 1,
      group: 'discount',
      revision: 0,
      origin: 'default',
      readMode: 'snapshot',
    },
  },
};

describeMigration('202611250004_version_quote_approvals', {
  sources: [
    {
      packageName: 'doc-demo-crm',
      directory: path.resolve('database/main/migrations'),
    },
  ],
  reversible: false,
  before: async ({ connection }) => {
    await connection.repository('crmCustomers').createOne({
      values: {
        id: 'customer',
        name: 'Existing customer',
        industry: '',
        website: '',
        notes: '',
        status: 'prospect',
        createdAt: at,
        updatedAt: at,
      },
    });
    await connection.repository('crmOpportunities').createOne({
      values: {
        id: 'opportunity',
        customerId: 'customer',
        name: 'Existing opportunity',
        stage: 'proposal',
        notes: '',
        createdAt: at,
        updatedAt: at,
      },
    });
    await connection.repository('crmQuotes').createOne({
      values: {
        id: 'quote',
        customerId: 'customer',
        opportunityId: 'opportunity',
        name: 'Submitted quote',
        currency: 'USD',
        totalCents: 100,
        createdAt: at,
        updatedAt: at,
      },
    });
    await connection.repository(name).createOne({
      values: {
        id: 'quote',
        quoteId: 'quote',
        customerId: 'customer',
        opportunityId: 'opportunity',
        applicantId: 'sales',
        reviewerId: 'manager',
        snapshot: { name: 'Submitted quote' },
        maxDiscountBasisPoints: 1100,
        thresholdBasisPoints: 1000,
        status: 'review',
        statusChangedAt: at,
        lifecycleVersion: 1,
        createdAt: at,
      },
    });
    await connection.repository('crmApprovalTransitions').createOne({
      values: {
        lifecycle: name,
        recordId: 'quote',
        transition: '$create',
        to: 'draft',
        actorId: 'sales',
        at,
        version: 0,
        requestKey: 'create',
      },
    });
    await connection.repository('crmApprovalParameterSnapshots').createOne({
      values: { id: identity('crm', name, 'quote'), payload: submitted },
    });
    await connection.repository('crmApprovalParameterHeads').createOne({
      values: {
        id: identity('crm', 'discount'),
        scope: 'crm',
        groupKey: 'discount',
        status: 'current',
        revision: 1,
      },
    });
    await connection.repository('crmApprovalParameterVersions').createOne({
      values: {
        id: identity('crm', 'discount', 1),
        selectionCounts: {},
        payload: {
          scope: 'crm',
          group: 'discount',
          revision: 1,
          schemaVersion: 1,
          values: { thresholdPercent: 20 },
          actorId: 'admin',
          at,
        },
      },
    });
  },
  up: async ({ connection }) => {
    expect(
      await connection.repository(name).findOne({ filter: { id: 'quote' } }),
    ).toMatchObject({
      status: 'review',
      thresholdBasisPoints: 1000,
      approvalDefinition: name,
    });
    expect(
      await connection
        .repository('crmApprovalParameterSnapshots')
        .findOne({ filter: { id: identity('crm', name, 'quote') } }),
    ).toMatchObject({ payload: { ...submitted, revision: 0 } });
    expect(
      await connection
        .repository('crmApprovalParameterVersions')
        .findOne({ filter: { id: identity('crm', name, 1) } }),
    ).toMatchObject({
      payload: {
        group: name,
        revision: 1,
        values: { thresholdPercent: 20 },
        actorId: 'admin',
        at,
      },
    });
    expect(await connection.repository('crmApprovalTransitions').count()).toBe(
      1,
    );
    expect(
      await connection.repository('crmApprovalParameterVersions').count(),
    ).toBe(2);
  },
});
