export type Product = {
  id: string;
  name: string;
  code: string;
  unitPrice: number;
};
export type Opportunity = {
  id: string;
  customerId: string;
  name: string;
  stage: string;
  notes: string;
};
export type QuoteLine = {
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  amount: number;
};
export type Quote = {
  id: string;
  opportunityId: string;
  name: string;
  total: number;
  currency: string;
  lines: QuoteLine[];
};
export type SalesContext = {
  product?: Product;
  opportunity?: Opportunity;
  quote?: Quote;
  reload: () => void;
};
export const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    value,
  );
