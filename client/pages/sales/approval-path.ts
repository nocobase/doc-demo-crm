export const approvalPath = (
  customerId?: string,
  opportunityId?: string,
  quoteId?: string,
) => `crmApprovals/quotes/${customerId}/${opportunityId}/${quoteId}`;
