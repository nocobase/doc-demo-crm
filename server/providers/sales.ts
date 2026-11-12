import { scopedRepository, type CrmPolicies } from './crm-permissions.js';
import { randomUUID } from 'node:crypto';
import {
  type DatabaseConnection,
  type RepositoryRecord,
  isUniqueConstraintViolation,
} from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';
import { CrmService } from './crm.js';

const money = z
  .number()
  .min(0)
  .max(100000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001,
    'Use at most two decimal places.',
  );
export const ProductInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40),
  unitPrice: money,
});
export const OpportunityInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  stage: z.enum(['discovery', 'proposal', 'won', 'lost']).default('discovery'),
  notes: z.string().trim().max(4000).default(''),
});
export const QuoteInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  lines: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(10000),
        unitPrice: money.optional(),
        discount: z
          .number()
          .min(0)
          .max(100)
          .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001)
          .default(0),
      }),
    )
    .min(1)
    .max(100),
});
export const SalesListInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(120).default(''),
});
export const Product = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  unitPrice: z.number(),
});
export const Opportunity = OpportunityInput.extend({
  id: z.string(),
  customerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const QuoteLine = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  productCode: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  discount: z.number(),
  amount: z.number(),
});
export const Quote = z.object({
  id: z.string(),
  opportunityId: z.string(),
  name: z.string(),
  currency: z.string(),
  total: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(QuoteLine).optional(),
});
function missing() {
  return new ApiError({
    status: 'NOT_FOUND',
    reason: 'CRM_RECORD_NOT_FOUND',
    domain: 'crm',
    message: 'The requested record does not exist.',
  });
}
const productResult = (r: RepositoryRecord) =>
  Product.parse({ ...r, unitPrice: Number(r.unitPriceCents) / 100 });
const quoteResult = (r: RepositoryRecord) =>
  Quote.parse({ ...r, total: Number(r.totalCents) / 100 });
export class SalesService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly policies: CrmPolicies,
  ) {}
  private repository(name: string) {
    return scopedRepository(this.connection, this.policies, name);
  }
  async products(input: z.infer<typeof SalesListInput>) {
    const repo = this.repository('crmProducts');
    const data = await repo.findMany({
      filter: (f) =>
        input.q
          ? f.string('name').includes(input.q, { mode: 'insensitive' })
          : f.and([]),
      limit: 20,
      offset: (input.page - 1) * 20,
      sort: (s) => [s.field('name').asc(), s.field('id').asc()],
    });
    const total = await repo.count({
      filter: (f) =>
        input.q
          ? f.string('name').includes(input.q, { mode: 'insensitive' })
          : f.and([]),
    });
    return {
      data: data.map(productResult),
      meta: { total, page: input.page, pageSize: 20 },
    };
  }
  async product(id: string) {
    const record = await this.repository('crmProducts').findOne({
      filter: { id },
    });
    if (!record) throw missing();
    return productResult(record);
  }
  async saveProduct(input: z.infer<typeof ProductInput>, id?: string) {
    if (id) await this.product(id);
    const repo = this.repository('crmProducts');
    const duplicate = await repo.findOne({ filter: { code: input.code } });
    if (duplicate && duplicate.id !== id)
      throw new ApiError({
        status: 'ALREADY_EXISTS',
        reason: 'PRODUCT_CODE_EXISTS',
        domain: 'crm',
        message: 'This product code is already used.',
      });
    const now = new Date().toISOString();
    const values = {
      name: input.name,
      code: input.code,
      unitPriceCents: Math.round(input.unitPrice * 100),
      updatedAt: now,
    };
    try {
      return productResult(
        (id
          ? await repo.updateOne({ filter: { id }, values })
          : await repo.createOne({
              values: { id: randomUUID(), ...values, createdAt: now },
            })
        ).record,
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ApiError({
          status: 'ALREADY_EXISTS',
          reason: 'PRODUCT_CODE_EXISTS',
          domain: 'crm',
          message: 'This product code is already used.',
        });
      throw error;
    }
  }
  async opportunities(customerId: string, page: number) {
    await new CrmService(this.connection, this.policies).get(customerId);
    const repo = this.repository('crmOpportunities');
    const filter = { customerId };
    return {
      data: await repo.findMany({
        filter,
        limit: 20,
        offset: (page - 1) * 20,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      meta: { total: await repo.count({ filter }), page, pageSize: 20 },
    };
  }
  async opportunity(customerId: string, id: string) {
    await new CrmService(this.connection, this.policies).get(customerId);
    const record = await this.repository('crmOpportunities').findOne({
      filter: { id, customerId },
    });
    if (!record) throw missing();
    return record;
  }
  async saveOpportunity(
    customerId: string,
    input: z.infer<typeof OpportunityInput>,
    id?: string,
  ) {
    await new CrmService(this.connection, this.policies).get(customerId);
    if (id) await this.opportunity(customerId, id);
    const repo = this.repository('crmOpportunities');
    const now = new Date().toISOString();
    return (
      id
        ? await repo.updateOne({
            filter: { id, customerId },
            values: { ...input, updatedAt: now },
          })
        : await repo.createOne({
            values: {
              id: randomUUID(),
              customerId,
              ...input,
              createdAt: now,
              updatedAt: now,
            },
          })
    ).record;
  }
  async quotes(customerId: string, opportunityId: string, page: number) {
    await this.opportunity(customerId, opportunityId);
    const repo = this.repository('crmQuotes');
    const filter = { opportunityId };
    return {
      data: (
        await repo.findMany({
          filter,
          limit: 20,
          offset: (page - 1) * 20,
          sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        })
      ).map(quoteResult),
      meta: { total: await repo.count({ filter }), page, pageSize: 20 },
    };
  }
  async quote(customerId: string, opportunityId: string, id: string) {
    await this.opportunity(customerId, opportunityId);
    const record = await this.repository('crmQuotes').findOne({
      filter: { id, opportunityId },
    });
    if (!record) throw missing();
    const lines = await this.repository('crmQuoteLines').findMany({
      filter: { quoteId: id },
      sort: (s) => [s.field('position').asc()],
    });
    return {
      ...quoteResult(record),
      lines: lines.map((line) =>
        QuoteLine.parse({
          ...line,
          unitPrice: Number(line.unitPriceCents) / 100,
          discount: Number(line.discountBasisPoints) / 100,
          amount: Number(line.amountCents) / 100,
        }),
      ),
    };
  }
  // The caller supplies the receipt transaction: header, complete lines and totals commit together.
  async saveQuote(
    customerId: string,
    opportunityId: string,
    input: z.infer<typeof QuoteInput>,
    id?: string,
  ) {
    await this.opportunity(customerId, opportunityId);
    const existing = id
      ? await this.quote(customerId, opportunityId, id)
      : undefined;
    const quoteId = id ?? randomUUID();
    const lines = [];
    for (const [position, line] of input.lines.entries()) {
      const product = await this.product(line.productId);
      // Updates must explicitly carry the snapshot; omitting price on creation uses today's catalogue price.
      if (existing && line.unitPrice === undefined)
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'QUOTE_SNAPSHOT_REQUIRED',
          domain: 'crm',
          message:
            'Supply the saved unit price for every line when editing a quote.',
        });
      const candidate = existing?.lines[position];
      const oldLine =
        candidate?.productId === line.productId ? candidate : undefined;
      const unitPriceCents = Math.round(
        (line.unitPrice ?? oldLine?.unitPrice ?? product.unitPrice) * 100,
      );
      const discountBasisPoints = Math.round(line.discount * 100);
      const amountCents = Number(
        (BigInt(unitPriceCents) *
          BigInt(line.quantity) *
          BigInt(10000 - discountBasisPoints) +
          5000n) /
          10000n,
      );
      lines.push({
        id: randomUUID(),
        quoteId,
        customerId,
        productId: line.productId,
        productName: oldLine?.productName ?? product.name,
        productCode: oldLine?.productCode ?? product.code,
        position,
        quantity: line.quantity,
        unitPriceCents,
        discountBasisPoints,
        amountCents,
      });
    }
    const totalCents = lines.reduce(
      (total, line) => total + line.amountCents,
      0,
    );
    const now = new Date().toISOString();
    const repo = this.repository('crmQuotes');
    const values = { name: input.name, totalCents, updatedAt: now };
    if (id) {
      await repo.updateOne({ filter: { id, opportunityId }, values });
      await this.repository('crmQuoteLines').deleteMany({
        filter: { quoteId },
      });
    } else
      await repo.createOne({
        values: {
          id: quoteId,
          opportunityId,
          customerId,
          currency: 'USD',
          ...values,
          createdAt: now,
        },
      });
    for (const line of lines)
      await this.repository('crmQuoteLines').createOne({ values: line });
    return this.quote(customerId, opportunityId, quoteId);
  }
}
