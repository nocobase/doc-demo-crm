import { defineSeed } from '@nocobase/db';
export default defineSeed({
  name: '202611120001_sales_samples', sample: true,
  async run(context) {
    const repository = context.repository.bind(context);
    const date = '2026-11-12T02:00:00.000Z';
    const products = [
      { id: '00000000-0000-4000-8100-000000000001', name: 'CRM workspace license', code: 'CRM-TEAM', unitPriceCents: 12000 },
      { id: '00000000-0000-4000-8100-000000000002', name: 'Implementation workshop', code: 'CRM-SETUP', unitPriceCents: 80000 },
      { id: '00000000-0000-4000-8100-000000000003', name: 'Sales enablement session', code: 'CRM-TRAIN', unitPriceCents: 25000 },
    ];
    for (const product of products) await repository('crmProducts').upsertOne({ filter: { id: product.id }, create: { ...product, createdAt: date, updatedAt: date }, update: { id: product.id } });
    // A standalone sample run is safe even when an installation intentionally skipped CRM samples.
    const customerId = '00000000-0000-4000-8000-000000000001';
    if (!await repository('crmCustomers').findOne({ filter: { id: customerId } })) return;
    const opportunityId = '00000000-0000-4000-8200-000000000001';
    await repository('crmOpportunities').upsertOne({ filter: { id: opportunityId }, create: { id: opportunityId, customerId, name: 'Northstar sales workspace', stage: 'proposal', notes: 'A shared CRM for the 12-person sales team.', createdAt: date, updatedAt: date }, update: { id: opportunityId } });
    const quoteId = '00000000-0000-4000-8300-000000000001';
    const existing = await repository('crmQuotes').findOne({ filter: { id: quoteId } });
    // Never restore removed lines or overwrite an edited quote during sample reruns.
    if (existing) return;
    await repository('crmQuotes').createOne({ values: { id: quoteId, opportunityId, customerId, name: 'Northstar team rollout', currency: 'USD', totalCents: 209600, createdAt: date, updatedAt: date } });
    for (const [position, product] of products.slice(0, 2).entries()) await repository('crmQuoteLines').createOne({ values: { id: `00000000-0000-4000-8400-00000000000${position + 1}`, quoteId, customerId, productId: product.id, productName: product.name, productCode: product.code, position, quantity: position === 0 ? 12 : 1, unitPriceCents: product.unitPriceCents, discountBasisPoints: position === 0 ? 1000 : 0, amountCents: position === 0 ? 129600 : 80000 } });
  },
});
