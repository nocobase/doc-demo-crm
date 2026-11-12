import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, Outlet, useParams, useOutletContext } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import { Card, CardContent } from '#components/ui/card';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
import { SalesRelated } from './lists.js';
import type { Opportunity, SalesContext } from './types.js';
export default function OpportunityDetail() {
  const { t } = useTranslation();
  const { customerId, opportunityId } = useParams();
  const owner = useOutletContext<SalesContext>();
  const request = useListData<{ data: Opportunity }>(
    `crmSales/customers/${customerId}/opportunities/${opportunityId}`,
  );
  const opportunity = request.error ? undefined : request.data?.data;
  const [revision, setRevision] = useState(0);
  const reload = () => {
    request.reload();
    owner.reload();
    setRevision((v) => v + 1);
  };
  usePageBreadcrumb([
    { label: t('crm.title'), to: '/customers' },
    { label: t('crm.detail'), to: `/customers/${customerId}/details` },
    { label: opportunity?.name ?? t('sales.opportunities') },
  ]);
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={opportunity?.name ?? t('sales.opportunities')}
          actions={
            opportunity ? (
              <Button nativeButton={false} render={<Link to='edit' />}>
                {t('sales.editOpportunity')}
              </Button>
            ) : undefined
          }
        />
        {request.error ? (
          <ReadError error={request.error} retry={request.reload} />
        ) : !opportunity ? (
          <Loading />
        ) : (
          <>
            <Card>
              <CardContent className='space-y-3 pt-6'>
                <p>
                  {t('sales.stage')}: {t(`sales.${opportunity.stage}`)}
                </p>
                <p className='whitespace-pre-wrap'>
                  {opportunity.notes || t('crm.notProvided')}
                </p>
              </CardContent>
            </Card>
            <SalesRelated
              customerId={customerId!}
              opportunityId={opportunityId}
              revision={revision}
            />
          </>
        )}
        <Outlet context={{ opportunity, reload }} />
      </PageContainer>
    </RouteChildPage>
  );
}
