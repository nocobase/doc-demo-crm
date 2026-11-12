import type { PagePermissionTitles } from './page-permissions.js';

/** Permission labels for application pages without navigation/breadcrumb titles (including overlays).
 * Keys are existing route names; values are application translation keys.
 * Do not add navigation/breadcrumbs or change authorization ids just to name a permission.
 */
export const pagePermissionTitles: PagePermissionTitles = {
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
