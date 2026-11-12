import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useAuthorizationRevision,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { useListData } from './use-list-data.js';

export interface CrmAccess {
  createCustomer: boolean;
  manageProducts: boolean;
  productActions?: { view: boolean; create: boolean; edit: boolean };
}
export interface CustomerAccess {
  edit: boolean;
  actions?: Readonly<Record<string, boolean>>;
  manage: boolean;
  canAssign: boolean;
  canShare: boolean;
  shared?: boolean;
  ownerId: string | null;
  ownerName: string | null;
  shares: { userId: string; name: string }[];
  users: { id: string; name: string }[];
}
function useAccessQuery() {
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  return new URLSearchParams({
    actor: session?.user.id ?? '',
    authorizationRevision: String(revision),
  }).toString();
}
export function useCrmAccess() {
  const query = useAccessQuery();
  const request = useListData<{ data: CrmAccess }>(`crm/access?${query}`);
  return {
    ...request,
    access: !request.loading && !request.error ? request.data?.data : undefined,
  };
}
export function useCustomerAccess(customerId?: string, revision = 0) {
  const query = useAccessQuery();
  const request = useListData<{ data: CustomerAccess }>(
    `crm/customers/${customerId}/access?${query}&revision=${revision}`,
    { active: Boolean(customerId) },
  );
  return {
    ...request,
    access: !request.loading && !request.error ? request.data?.data : undefined,
  };
}
export function useCustomerOperation(
  customerId: string | undefined,
  action: string,
) {
  const request = useCustomerAccess(customerId);
  const permission = useCan({
    resource: { type: 'composite', id: 'crm.records' },
    action,
  });
  return {
    ...request,
    allowed: Boolean(
      (request.access?.actions?.[action] ?? request.access?.edit) &&
      permission.can,
    ),
    loading: request.loading || permission.isPending,
    error: request.error ?? permission.error,
    reload: () => {
      request.reload();
      void permission.retry();
    },
  };
}
