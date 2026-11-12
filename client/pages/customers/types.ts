export interface Customer {
  id: string;
  name: string;
  industry: string;
  status: 'prospect' | 'customer' | 'inactive';
  website: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface Contact {
  id: string;
  customerId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  createdAt: string;
}
export interface FollowUp {
  id: string;
  customerId: string;
  channel: string;
  content: string;
  nextStep: string;
  authorName: string;
  createdAt: string;
}
export interface ListResult<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}
export interface CustomerContext {
  reload: () => void;
  customer?: Customer;
}
