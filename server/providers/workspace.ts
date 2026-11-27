import type { CrmPolicies } from './crm-permissions.js';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseConnection, ReadNode } from '@nocobase/db';
import { z } from 'zod';

const CustomerReference = z.object({ id: z.string(), name: z.string() });
const OpportunityReference = z.object({
  id: z.string(),
  name: z.string(),
  customerId: z.string(),
  customer: CustomerReference,
});
export const Workspace = z.object({
  counts: z.object({
    customers: z.number(),
    opportunities: z.number(),
    quotes: z.number(),
  }),
  followUps: z.array(
    z.object({
      id: z.string(),
      customerId: z.string(),
      customer: CustomerReference,
      channel: z.string(),
      content: z.string(),
      nextStep: z.string(),
      authorName: z.string(),
      createdAt: z.string(),
    }),
  ),
  opportunities: z.array(
    OpportunityReference.extend({ stage: z.string(), updatedAt: z.string() }),
  ),
  quotes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      total: z.number(),
      updatedAt: z.string(),
      opportunity: OpportunityReference,
    }),
  ),
});

/** Bounded record previews plus exact counts; no client-side full-table scan. */
export class WorkspaceService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly policies: CrmPolicies,
  ) {}
  // Combine the separately granted reads into this query's authorized parent relations.
  private readNode(
    name: string,
    fields: string[],
    relations?: Record<string, ReadNode>,
  ): ReadNode | undefined {
    const policy = this.policies[name];
    if (!policy || !policy.read) return undefined;
    return {
      ...(policy.read === true
        ? { scope: true as const, fields }
        : policy.read),
      relations,
    };
  }
  private repository(name: string, read?: ReadNode) {
    if (!read) return undefined;
    return this.connection
      .repository(name)
      .withPolicy({ read, create: false, update: false, delete: false });
  }
  async read() {
    const customer = this.readNode('crmCustomers', ['id', 'name']);
    const opportunity =
      customer &&
      this.readNode(
        'crmOpportunities',
        ['id', 'name', 'customerId', 'stage', 'updatedAt'],
        { customer },
      );
    const followUp =
      customer &&
      this.readNode(
        'crmFollowUps',
        [
          'id',
          'customerId',
          'channel',
          'content',
          'nextStep',
          'authorName',
          'createdAt',
        ],
        { customer },
      );
    const quote =
      opportunity &&
      this.readNode(
        'crmQuotes',
        ['id', 'name', 'opportunityId', 'totalCents', 'updatedAt'],
        { opportunity },
      );
    const customers = this.repository('crmCustomers', customer);
    const opportunities = this.repository('crmOpportunities', opportunity);
    const quotes = this.repository('crmQuotes', quote);
    const followUps = this.repository('crmFollowUps', followUp);
    const visibleCustomer = buildFilter((f) => f.relation('customer').exists());
    const visibleOpportunity = buildFilter((f) =>
      f.relation('opportunity').some((p) => p.relation('customer').exists()),
    );
    const [
      customerCount,
      opportunityCount,
      quoteCount,
      recentFollowUps,
      recentOpportunities,
      recentQuotes,
    ] = await Promise.all([
      customers?.count() ?? 0,
      opportunities?.count({ filter: visibleCustomer }) ?? 0,
      quotes?.count({ filter: visibleOpportunity }) ?? 0,
      followUps?.findMany({
        filter: visibleCustomer,
        limit: 5,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        select: (s) =>
          s
            .fields(
              'id',
              'customerId',
              'channel',
              'content',
              'nextStep',
              'authorName',
              'createdAt',
            )
            .include('customer', (c) => c.fields('id', 'name')),
      }) ?? [],
      opportunities?.findMany({
        filter: visibleCustomer,
        limit: 5,
        sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
        select: (s) =>
          s
            .fields('id', 'name', 'customerId', 'stage', 'updatedAt')
            .include('customer', (c) => c.fields('id', 'name')),
      }) ?? [],
      quotes?.findMany({
        filter: visibleOpportunity,
        limit: 5,
        sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
        select: (s) =>
          s
            .fields('id', 'name', 'totalCents', 'updatedAt')
            .include('opportunity', (p) =>
              p
                .fields('id', 'name', 'customerId')
                .include('customer', (c) => c.fields('id', 'name')),
            ),
      }) ?? [],
    ]);
    return Workspace.parse({
      counts: {
        customers: customerCount,
        opportunities: opportunityCount,
        quotes: quoteCount,
      },
      followUps: recentFollowUps,
      opportunities: recentOpportunities,
      quotes: recentQuotes.map((record) => ({
        ...record,
        total: Number(record.totalCents) / 100,
      })),
    });
  }
}
