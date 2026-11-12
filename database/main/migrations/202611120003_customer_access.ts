import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202611120003_customer_access',
  async up({ builder }) {
    await builder.alterCollection('crmCustomers', (c) => {
      c.string('ownerId', { length: 64, nullable: true });
      c.index('ownerId', { name: 'crm_customers_owner_idx' });
    });
    // Existing customers deliberately remain unassigned; never guess an owner.
    await builder.alterCollection('crmContacts', (c) => { c.belongsTo('customer', 'crmCustomers', { index: false }).targetKey('id').foreignKey('customerId').constraints(false); });
    await builder.alterCollection('crmFollowUps', (c) => { c.belongsTo('customer', 'crmCustomers', { index: false }).targetKey('id').foreignKey('customerId').constraints(false); });
  },
  async down({ builder }) {
    await builder.alterCollection('crmFollowUps', (c) => { c.dropField('customer'); });
    await builder.alterCollection('crmContacts', (c) => { c.dropField('customer'); });
    await builder.alterCollection('crmCustomers', (c) => { c.dropIndex('crm_customers_owner_idx'); });
    await builder.alterCollection('crmCustomers', (c) => { c.dropField('ownerId'); });
  },
});
