export type CustomerReference = { id: string; name: string };
export type OpportunityReference = {
  id: string;
  name: string;
  customerId: string;
  customer: CustomerReference;
};
export type Workspace = {
  counts: { customers: number; opportunities: number; quotes: number };
  followUps: {
    id: string;
    customerId: string;
    customer: CustomerReference;
    channel: string;
    content: string;
    nextStep: string;
    authorName: string;
    createdAt: string;
  }[];
  opportunities: (OpportunityReference & {
    stage: string;
    updatedAt: string;
  })[];
  quotes: {
    id: string;
    name: string;
    total: number;
    updatedAt: string;
    opportunity: OpportunityReference;
  }[];
};
export const customerPath = (id: string) => `/customers/${id}/details`;
export const opportunityPath = (record: OpportunityReference) =>
  `${customerPath(record.customerId)}/opportunities/${record.id}`;
