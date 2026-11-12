import type { DatabaseConnection } from '@nocobase/db';
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
  constructor(private readonly connection: DatabaseConnection) {}
  async read() {
    const customers = this.connection.repository('crmCustomers');
    const opportunities = this.connection.repository('crmOpportunities');
    const quotes = this.connection.repository('crmQuotes');
    const [
      customerCount,
      opportunityCount,
      quoteCount,
      followUps,
      recentOpportunities,
      recentQuotes,
    ] = await Promise.all([
      customers.count(),
      opportunities.count(),
      quotes.count(),
      this.connection.repository('crmFollowUps').findMany({
        limit: 5,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      opportunities.findMany({
        limit: 5,
        sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
        select: (s) =>
          s
            .fields('id', 'name', 'customerId', 'stage', 'updatedAt')
            .include('customer', (c) => c.fields('id', 'name')),
      }),
      quotes.findMany({
        limit: 5,
        sort: (s) => [s.field('updatedAt').desc(), s.field('id').asc()],
        select: (s) =>
          s
            .fields('id', 'name', 'totalCents', 'updatedAt')
            .include('opportunity', (o) =>
              o
                .fields('id', 'name', 'customerId')
                .include('customer', (c) => c.fields('id', 'name')),
            ),
      }),
    ]);
    // Follow-ups predate Collection relation metadata. Resolve only the five
    // preview owners; no schema change is needed for this UI lesson.
    const recentFollowUps = await Promise.all(
      followUps.map(async (record) => ({
        ...record,
        customer: await customers.findOne({
          filter: { id: z.string().parse(record.customerId) },
          select: (s) => s.fields('id', 'name'),
        }),
      })),
    );
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
