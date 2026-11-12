import type { PagePermissionTitles } from './page-permissions.js';

/** Permission labels for application pages without navigation/breadcrumb titles (including overlays).
 * Keys are existing route names; values are application translation keys.
 * Do not add navigation/breadcrumbs or change authorization ids just to name a permission.
 */
export const pagePermissionTitles: PagePermissionTitles = {
  'customers-tab-overview': 'crm.overview',
  'customers-tab-contacts': 'crm.contacts',
  'customers-tab-followUps': 'crm.followUps',
  'customers-tab-opportunities': 'sales.opportunities',
  'customers-tab-overview-edit': 'crm.editCustomer',
  'customers-tab-contacts-edit': 'crm.editCustomer',
  'customers-tab-followUps-edit': 'crm.editCustomer',
  'customers-tab-opportunities-edit': 'crm.editCustomer',
  'customers-tab-contact-new': 'crm.newContact',
  'customers-tab-followup-new': 'crm.newFollowUp',
  'customers-tab-opportunity-new': 'sales.newOpportunity',
  'sales-opportunity-new': 'sales.newOpportunity',
  'sales-opportunity-edit': 'sales.editOpportunity',
  'sales-quote-new': 'sales.newQuote',
  'sales-quote-edit': 'sales.editQuote',
  'products-new': 'sales.newProduct',
  'products-edit': 'sales.editProduct',
  'customers-new': 'crm.newCustomer',
  'customers-edit': 'crm.editCustomer',
  'customers-contact-new': 'crm.newContact',
  'customers-followup-new': 'crm.newFollowUp',
};
