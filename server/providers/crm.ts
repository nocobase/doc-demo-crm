import { randomUUID } from 'node:crypto';
import {
  type DatabaseConnection,
  type RepositoryFilter,
  type RepositoryRecord,
  RepositoryError,
} from '@nocobase/db';
import { ApiError } from '@nocobase/app-server/router';
import { z } from 'zod';

export const CustomerInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  industry: z.string().trim().max(100).default(''),
  status: z.enum(['prospect', 'customer', 'inactive']).default('prospect'),
  website: z
    .union([z.literal(''), z.url().refine((v) => /^https?:\/\//i.test(v))])
    .default(''),
  notes: z.string().trim().max(4000).default(''),
});
export const ContactInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(100).default(''),
  email: z.union([z.literal(''), z.email().max(200)]).default(''),
  phone: z.string().trim().max(60).default(''),
});
export const FollowUpInput = z.strictObject({
  channel: z.enum(['call', 'email', 'meeting', 'note']),
  content: z.string().trim().min(1).max(4000),
  nextStep: z.string().trim().max(2000).default(''),
});
export const ListInput = z.object({
  q: z.string().trim().max(120).default(''),
  status: z.enum(['prospect', 'customer', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const Customer = CustomerInput.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const Contact = ContactInput.extend({
  id: z.string(),
  customerId: z.string(),
  createdAt: z.string(),
});
export const FollowUp = FollowUpInput.extend({
  id: z.string(),
  customerId: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});

export class CrmService {
  constructor(private readonly connection: DatabaseConnection) {}
  async list(input: z.infer<typeof ListInput>) {
    const repository = this.connection.repository('crmCustomers');
    const filter: RepositoryFilter<RepositoryRecord> = (f) =>
      f.and([
        ...(input.q
          ? [f.string('name').includes(input.q, { mode: 'insensitive' })]
          : []),
        ...(input.status ? [f.string('status').eq(input.status)] : []),
      ]);
    const [data, total] = await Promise.all([
      repository.findMany({
        filter,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
        sort: (s) => [s.field('name').asc(), s.field('id').asc()],
      }),
      repository.count({ filter }),
    ]);
    return {
      data,
      meta: { total, page: input.page, pageSize: input.pageSize },
    };
  }
  async get(id: string) {
    const record = await this.connection
      .repository('crmCustomers')
      .findOne({ filter: { id } });
    if (!record) throw missing();
    return record;
  }
  async related(
    customerId: string,
    kind: 'contacts' | 'followUps',
    page: number,
  ) {
    await this.get(customerId);
    const repository = this.connection.repository(
      kind === 'contacts' ? 'crmContacts' : 'crmFollowUps',
    );
    const filter = { customerId };
    const [data, total] = await Promise.all([
      repository.findMany({
        filter,
        limit: 20,
        offset: (page - 1) * 20,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      }),
      repository.count({ filter }),
    ]);
    return { data, meta: { total, page, pageSize: 20 } };
  }
  async saveCustomer(input: z.infer<typeof CustomerInput>, id?: string) {
    const repo = this.connection.repository('crmCustomers');
    const now = new Date().toISOString();
    try {
      return (
        id
          ? await repo.updateOne({
              filter: { id },
              values: { ...input, updatedAt: now },
            })
          : await repo.createOne({
              values: {
                id: randomUUID(),
                ...input,
                createdAt: now,
                updatedAt: now,
              },
            })
      ).record;
    } catch (error) {
      if (error instanceof RepositoryError && error.code === 'RECORD_NOT_FOUND')
        throw missing();
      throw error;
    }
  }
  async saveContact(
    customerId: string,
    input: z.infer<typeof ContactInput>,
    id?: string,
  ) {
    await this.get(customerId);
    const repo = this.connection.repository('crmContacts');
    try {
      return (
        id
          ? await repo.updateOne({ filter: { id, customerId }, values: input })
          : await repo.createOne({
              values: {
                id: randomUUID(),
                customerId,
                ...input,
                createdAt: new Date().toISOString(),
              },
            })
      ).record;
    } catch (error) {
      if (error instanceof RepositoryError && error.code === 'RECORD_NOT_FOUND')
        throw missing();
      throw error;
    }
  }
  async addFollowUp(
    customerId: string,
    input: z.infer<typeof FollowUpInput>,
    authorName: string,
  ) {
    await this.get(customerId);
    return (
      await this.connection.repository('crmFollowUps').createOne({
        values: {
          id: randomUUID(),
          customerId,
          ...input,
          authorName,
          createdAt: new Date().toISOString(),
        },
      })
    ).record;
  }
}
function missing() {
  return new ApiError({
    status: 'NOT_FOUND',
    reason: 'CRM_RECORD_NOT_FOUND',
    domain: 'crm',
    message: 'The requested record does not exist.',
  });
}
