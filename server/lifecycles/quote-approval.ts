import {
  enqueueCrmNotification,
  eventIdentity,
} from '../providers/crm-notifications.js';
import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';
import type { ParameterGroup } from '@nocobase/lifecycle';
import {
  approvalState,
  approve,
  reject,
  returnTo,
  defineApproval,
  stagesFor,
  type ApprovalDirectory,
  type ApprovalTaskContributor,
} from '@nocobase/app-plugin-approval/server';
import type {
  JsonObject,
  LifecycleRecord,
  TransitionContext,
} from '@nocobase/lifecycle';

export interface QuoteApprovalRecord extends LifecycleRecord {
  id: string;
  quoteId: string;
  customerId: string;
  opportunityId: string;
  applicantId: string;
  reviewerId: string | null;
  snapshot: JsonObject;
  maxDiscountBasisPoints: number;
  thresholdBasisPoints: number;
  status: 'draft' | 'review' | 'revision' | 'confirmed' | 'rejected';
}
export interface QuoteApprovalTypes {
  record: QuoteApprovalRecord;
  state: QuoteApprovalRecord['status'];
  parameters: { thresholdPercent: number };
  services: {
    directory: ApprovalDirectory;
    contributor: ApprovalTaskContributor;
    notify: () => Promise<void>;
  };
}
export const quoteApprovalParameters: ParameterGroup = {
  key: 'discount',
  title: 'Discount approval',
  schemaVersion: 1,
  fields: {
    thresholdPercent: {
      type: 'number',
      title: 'Maximum automatic discount (%)',
      parse: (value) => z.number().min(0).max(100).parse(value),
      bindings: [{ transition: 'submit' }],
    },
  },
};
const stage = stagesFor<QuoteApprovalTypes>();
const applicantOnly = ({
  actor,
  record,
}: TransitionContext<QuoteApprovalTypes>) =>
  actor.id === record.applicantId || {
    code: 'APPLICANT_ONLY',
    message: 'Only the applicant may change this request.',
  };

async function notifyResult(
  context: import('@nocobase/lifecycle').TransitionHookContext<QuoteApprovalTypes>,
) {
  const scenario =
    context.to === 'confirmed'
      ? 'confirmed'
      : context.to === 'rejected'
        ? 'rejected'
        : context.to === 'revision'
          ? 'returned'
          : undefined;
  if (!scenario) return;
  await enqueueCrmNotification(context.tx.handle as DatabaseConnection, {
    id: eventIdentity('approval', context.entry.id),
    scenario,
    recipientId: context.record.applicantId,
    targetPath: `/customers/${context.record.customerId}/details/opportunities/${context.record.opportunityId}/quotes/${context.record.quoteId}`,
  });
  context.tx.afterCommit(() => context.services.notify().catch(() => {}));
}

export const quoteApproval = defineApproval<QuoteApprovalTypes>({
  name: 'crmQuoteApprovals',
  collection: 'crmQuoteApprovals',
  initial: 'draft',
  version: 1,
  parameters: { thresholdPercent: 10 },
  parameterConfiguration: {
    readMode: 'snapshot',
    snapshotTransition: 'submit',
    groups: [quoteApprovalParameters],
  },
  applicant: (record) => record.applicantId,
  directory: (services) => services.directory,
  freeze: [
    'snapshot',
    'reviewerId',
    'thresholdBasisPoints',
    'maxDiscountBasisPoints',
  ],
  userTasks: (services) => ({
    contributor: services.contributor,
    describe: () => ({ subject: 'crm.quote', title: 'Review quotation' }),
  }),
  states: [
    'draft',
    'revision',
    approvalState(
      'review',
      stage.single({
        assignee: ({ record }) => record.reviewerId,
        onEmpty: 'refuse',
        actions: [
          approve(),
          reject({ reason: 'required' }),
          returnTo({ targets: ['revision'], reason: 'required' }),
        ],
      }),
    ),
    { name: 'confirmed', final: true },
    { name: 'rejected', final: true },
  ],
  create: { guard: ({ actor, values }) => actor.id === values.applicantId },
  transitions: {
    revise: {
      from: ['draft', 'revision'],
      to: ['draft', 'revision'],
      route: ({ record }) => record.status,
      guard: applicantOnly,
      accept: [
        'snapshot',
        'reviewerId',
        'thresholdBasisPoints',
        'maxDiscountBasisPoints',
      ],
    },
    submit: {
      onTransition: notifyResult,
      from: ['draft', 'revision'],
      to: ['review', 'confirmed'],
      guard: applicantOnly,
      route: ({ record, parameters }) =>
        record.maxDiscountBasisPoints >
        Math.round(parameters.thresholdPercent * 100)
          ? 'review'
          : 'confirmed',
      set: ({ parameters }) => ({
        thresholdBasisPoints: Math.round(parameters.thresholdPercent * 100),
      }),
    },
    withdraw: {
      from: 'review',
      to: 'draft',
      guard: async (context) =>
        context.actor.id === context.record.applicantId ||
        (await context.services.directory.hasRole(
          context.actor.id,
          'crm-sales-manager',
        )) || {
          code: 'APPLICANT_OR_MANAGER_ONLY',
          message:
            'Only the applicant or a sales manager may withdraw this request.',
        },
    },
    confirm: {
      from: 'review',
      to: 'confirmed',
      approvalOutcome: 'approved',
      onTransition: notifyResult,
    },
    reject: {
      from: 'review',
      to: 'rejected',
      approvalOutcome: 'rejected',
      onTransition: notifyResult,
    },
    return: {
      from: 'review',
      to: 'revision',
      approvalOutcome: 'returned',
      onTransition: notifyResult,
    },
  },
});
