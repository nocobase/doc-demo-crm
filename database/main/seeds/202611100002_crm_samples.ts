import { defineSeed } from '@nocobase/db';

export default defineSeed({
  name: '202611100002_crm_samples',
  sample: true,
  async run({ repository }) {
    const examples = [
      { id: '00000000-0000-4000-8000-000000000001', name: 'Northstar Labs', industry: 'Technology', status: 'prospect', website: 'https://example.com', notes: 'Exploring a CRM for a 12-person sales team.', contact: 'Emma Wilson', role: 'Operations Lead', channel: 'meeting', content: 'Discussed centralizing customer information and follow-up notes.', nextStep: 'Prepare a short walkthrough for the sales team.' },
      { id: '00000000-0000-4000-8000-000000000002', name: 'Harbor Design', industry: 'Professional services', status: 'customer', website: '', notes: 'Small design studio tracking repeat clients.', contact: 'James Chen', role: 'Managing Director', channel: 'call', content: 'Reviewed how the team records client conversations.', nextStep: 'Share the contact import checklist.' },
      { id: '00000000-0000-4000-8000-000000000003', name: 'Willow Retail', industry: 'Retail', status: 'inactive', website: '', notes: 'Evaluation paused until the next planning cycle.', contact: 'Olivia Martin', role: 'Sales Manager', channel: 'email', content: 'Customer asked to pause the evaluation.', nextStep: 'Wait for the customer to restart the discussion.' },
    ];
    for (const [index, item] of examples.entries()) {
      const { contact, role, channel, content, nextStep, ...customer } = item;
      const date = '2026-11-10T02:00:00.000Z';
      // Stable ids and create-only upserts preserve edits if the sample is re-run.
      await repository('crmCustomers').upsertOne({ filter: { id: item.id }, create: { ...customer, createdAt: date, updatedAt: date }, update: { id: item.id } });
      const contactId = `00000000-0000-4000-8001-00000000000${index + 1}`;
      await repository('crmContacts').upsertOne({ filter: { id: contactId }, create: { id: contactId, customerId: item.id, name: contact, role, email: `contact${index + 1}@example.com`, phone: '', createdAt: date }, update: { id: contactId } });
      const followId = `00000000-0000-4000-8002-00000000000${index + 1}`;
      await repository('crmFollowUps').upsertOne({ filter: { id: followId }, create: { id: followId, customerId: item.id, channel, content, nextStep, authorName: 'Tutorial team', createdAt: date }, update: { id: followId } });
    }
  },
});
