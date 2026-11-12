import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useOutletContext,
  useResolvedPath,
} from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { useRouteSearches } from '../../routing/route-context.js';
import { ReadError } from './shared.js';
import type { Customer, CustomerContext } from './types.js';

export default function CustomerDetail() {
  const { t } = useTranslation();
  const { customerId } = useParams();
  const access = useCustomerOperation(customerId, 'editCustomer');
  const parent = useResolvedPath('..').pathname;
  const ownPath = useResolvedPath('.').pathname;
  const location = useLocation();
  const navigate = useNavigate();
  const searches = useRouteSearches();
  const owner = useOutletContext<CustomerContext>();
  const request = useListData<{ data: Customer }>(
    `crm/customers/${customerId}`,
  );
  const customer = request.error ? undefined : request.data?.data;
  usePageBreadcrumb([
    {
      label: t('crm.title'),
      to: { pathname: parent, search: searches.get(parent) ?? '' },
    },
    { label: customer?.name ?? t('crm.detail') },
  ]);
  const [revision, setRevision] = useState(0);
  const reload = () => {
    request.reload();
    access.reload();
    owner.reload();
    setRevision((v) => v + 1);
  };
  const tabs = [
    { value: 'overview', label: t('crm.overview') },
    { value: 'contacts', label: t('crm.contacts') },
    { value: 'followUps', label: t('crm.followUps') },
    { value: 'opportunities', label: t('sales.opportunities') },
  ];
  const segment = location.pathname.slice(ownPath.length + 1).split('/')[0];
  const current = tabs.find((tab) => tab.value === segment)?.value;
  const parentEntry =
    location.pathname.replace(/\/$/, '') === ownPath.replace(/\/$/, '');
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={customer?.name ?? t('crm.detail')}
          actions={
            customer && access.allowed ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: current ? `${current}/edit` : 'edit',
                      search: location.search,
                    }}
                  />
                }
              >
                {t('crm.editCustomer')}
              </Button>
            ) : undefined
          }
        />
        {request.error ? (
          <ReadError error={request.error} retry={request.reload} />
        ) : !customer ? (
          <Loading />
        ) : (
          <>
            {parentEntry ? (
              <Navigate
                replace
                to={{ pathname: 'overview', search: location.search }}
              />
            ) : null}
            <Tabs
              value={current ?? 'overview'}
              onValueChange={(value) => {
                if (typeof value === 'string' && value !== current)
                  void navigate({
                    pathname: `${ownPath}/${value}`,
                    search: location.search,
                  });
              }}
            >
              <div className='overflow-x-auto'>
                <TabsList variant='line' aria-label={t('crm.detail')}>
                  {tabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
          </>
        )}
        <Outlet context={{ customer, reload, revision }} />
      </PageContainer>
    </RouteChildPage>
  );
}
