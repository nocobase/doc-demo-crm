import fileUi from '../extensions/nocobase-file-component-ui/locales/en-US.js';
import type { LocaleResource } from '@nocobase/i18n';

import systemEnUS from './system/en-US.js';

const enUS = {
  // The template's own copy: the shell, the sign-in pages, shared components and the homepage. Keep it in
  // `./system/` so a template upgrade can replace it without touching the application's copy below.
  ...systemEnUS,
  ...fileUi,
  workspace: {
    title: 'Sales workspace',
    description:
      'Continue recent conversations and move your opportunities forward.',
    openCustomers: 'Open customers',
    customers: 'Customers',
    opportunities: 'Opportunities',
    quotes: 'Quotes',
    opportunity: 'Opportunity',
    recentFollowUps: 'Recent follow-ups',
    recentOpportunities: 'Recently updated opportunities',
    recentQuotes: 'Recently updated quotes',
    noFollowUps: 'No follow-ups yet. Open a customer to record a conversation.',
    noOpportunities: 'No opportunities yet. Open a customer to create one.',
    noQuotes: 'No quotes yet. Open an opportunity to create one.',
  },
  sales: {
    name: 'Name',
    products: 'Products',
    opportunities: 'Opportunities',
    quotes: 'Quotes',
    product: 'Product',
    code: 'Product code',
    unitPrice: 'Unit price (USD)',
    quantity: 'Quantity',
    discount: 'Discount (%)',
    amount: 'Amount',
    total: 'Total',
    stage: 'Stage',
    discovery: 'Discovery',
    proposal: 'Proposal',
    won: 'Won',
    lost: 'Lost',
    newProduct: 'New product',
    editProduct: 'Edit product',
    newOpportunity: 'New opportunity',
    editOpportunity: 'Edit opportunity',
    newQuote: 'New quote',
    editQuote: 'Edit quote',
    searchProducts: 'Search products by name',
    catalogueHint:
      'Maintain current product prices. Saved quotes keep their own price snapshots.',
    snapshotHint:
      'Amounts use the saved unit prices and discounts. Catalogue price changes do not change this quote.',
    addLine: 'Add product',
    removeLine: 'Remove line',
    addLineHint: 'Add at least one product to this quote.',
    previous: 'Previous products',
    next: 'Next products',
  },
  crm: {
    title: 'Customers',
    description: 'Keep customer details, contacts and conversations together.',
    name: 'Customer name',
    industry: 'Industry',
    status: 'Status',
    website: 'Website',
    notes: 'Notes',
    prospect: 'Prospect',
    customer: 'Customer',
    inactive: 'Inactive',
    all: 'All statuses',
    search: 'Search customers by name',
    searchAction: 'Search',
    empty: 'No customers yet. Add your first customer.',
    newCustomer: 'New customer',
    editCustomer: 'Edit customer',
    detail: 'Customer details',
    overview: 'Overview',
    contacts: 'Contacts',
    followUps: 'Follow-up records',
    newContact: 'Add contact',
    newFollowUp: 'Record follow-up',
    contactName: 'Contact name',
    role: 'Job title',
    email: 'Email',
    phone: 'Phone',
    channel: 'Channel',
    content: 'Summary',
    nextStep: 'Next step',
    recordedAt: 'Recorded at',
    author: 'Recorded by',
    call: 'Call',
    meeting: 'Meeting',
    note: 'Note',
    notProvided: 'Not provided',
    save: 'Save',
    saved: 'Saved successfully.',
    saving: 'Saving…',
    cancel: 'Cancel',
    required: 'This field is required.',
    tooLong: 'Use at most {{max}} characters.',
    invalidEmail: 'Enter a valid email address.',
    invalidWebsite: 'Enter a full HTTP or HTTPS URL.',
    expired: 'Your session has ended. Sign in again.',
    denied: 'You do not have access to this CRM.',
    missing: 'This record does not exist. Return to Customers.',
    failed: 'Unable to load records. Try again.',
    retry: 'Retry',
    signIn: 'Sign in',
    discard: 'Discard unsaved changes?',
    discardHint: 'Your changes will be lost.',
    keepEditing: 'Keep editing',
    discardAction: 'Discard',
    uncertain:
      'The save result is unknown. Keep this form open and retry the original submission.',
    restoreInput:
      'A previous submission is unresolved. Re-enter the original values exactly, then retry.',
  },
  // The application's copy goes here, one group per feature. A shared group such as `navigation` is extended by
  // spreading the system one first, `navigation: { ...systemEnUS.navigation, orders: 'Orders' }`, since a group
  // written here replaces the system group of the same name rather than merging with it.
};

/**
 * The shape every locale of this application follows, derived from the English wording above.
 *
 * Anything a plugin does not translate falls back to this namespace, so a term defined here is reused everywhere
 * without each plugin repeating it.
 */
export type AppResource = LocaleResource<typeof enUS>;

export default enUS;
