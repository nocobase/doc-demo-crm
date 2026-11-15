import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
describeMigration('202611160002_crm_reminders', {
  sources: [
    {
      packageName: 'crm-reminder-test',
      directory: path.resolve('database/main/migrations'),
    },
  ],
  before: async ({ connection }) => {
    const now = new Date().toISOString();
    await connection
      .repository('crmCustomers')
      .createOne({
        values: {
          id: 'retained-customer',
          name: 'Retained customer',
          industry: '',
          website: '',
          notes: 'Keep original data',
          status: 'prospect',
          ownerId: null,
          createdAt: now,
          updatedAt: now,
        },
      });
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('crmReminders').toExist();
    expect(
      (
        await connection
          .repository('crmCustomers')
          .findOne({ filter: { id: 'retained-customer' } })
      )?.notes,
    ).toBe('Keep original data');
  },
  down: async ({ connection, expectCollection }) => {
    await expectCollection('crmReminders').not.toExist();
    expect(await connection.repository('crmCustomers').count()).toBe(1);
  },
});
