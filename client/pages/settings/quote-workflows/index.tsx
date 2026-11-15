import {
  usePageBreadcrumb,
  useApiClient,
  useSubmission,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { LifecycleDescriptionView, RecordView } from '@nocobase/lifecycle';
import { useRef, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import {
  WorkflowManagementLayout,
  WorkflowDefinitionDetail,
} from '#extensions/nocobase-workflow-management/layout';
import { WorkflowDefinitionList } from '#extensions/nocobase-workflow-management/definition-list';
import { WorkflowExecutionList } from '#extensions/nocobase-workflow-management/execution-list';
import { WorkflowExecutionDetail } from '#extensions/nocobase-workflow-management/execution-detail';
import { LifecycleDiagram } from '#components/lifecycle-diagram';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { Loading } from '#components/loading';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { PendingButton } from '#components/pending-button';
import { FeedbackForm } from '#components/feedback-form';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../../customers/shared.js';
const root = '/settings/quote-workflows';
type Definition = {
  description: LifecycleDescriptionView;
  parameters: { revision: number; values: { thresholdPercent: number } };
};
export default function Workflows() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.includes('/executions')
    ? 'executions'
    : 'definitions';
  usePageBreadcrumb([{ label: t('quoteApproval.workflows'), to: root }]);
  if (location.pathname.replace(/\/$/, '') === root)
    return <Navigate to={`${root}/definitions`} replace />;
  return (
    <WorkflowManagementLayout
      title={t('quoteApproval.workflows')}
      labels={{
        definitions: t('quoteApproval.definitions'),
        executions: t('quoteApproval.executions'),
      }}
      tab={tab}
      onTabChange={(value) => {
        void navigate(`${root}/${value}`);
      }}
    >
      <Outlet />
    </WorkflowManagementLayout>
  );
}
export function Definitions() {
  const { t } = useTranslation();
  const request = useListData<{ data: Definition }>('crmWorkflows/definition');
  return (
    <>
      <WorkflowDefinitionList
        rows={[
          {
            id: 'crmQuoteApprovals',
            title: <Link to='quotation'>{t('quoteApproval.title')}</Link>,
            activity: (
              <Link to={`${root}/executions`}>
                {t('quoteApproval.executions')}
              </Link>
            ),
          },
        ]}
        search={null}
        loaded={Boolean(request.data)}
        loading={request.loading}
        status={
          request.error ? (
            <ReadError error={request.error} retry={request.reload} />
          ) : null
        }
        labels={{
          workflow: t('quoteApproval.title'),
          executionCount: t('quoteApproval.executions'),
          executionActivity: t('quoteApproval.executions'),
        }}
        onRefresh={request.reload}
      />
      <Outlet />
    </>
  );
}
export function DefinitionDetail() {
  const { t } = useTranslation();
  const request = useListData<{ data: Definition }>('crmWorkflows/definition');
  const permission = useCan({
    resource: { type: 'composite', id: 'crm.workflow' },
    action: 'configure',
  });
  const inputRef = useRef<HTMLInputElement>(null);
  usePageBreadcrumb([
    { label: t('quoteApproval.workflows'), to: `${root}/definitions` },
    { label: t('quoteApproval.title') },
  ]);
  if (request.error)
    return <ReadError error={request.error} retry={request.reload} />;
  if (!request.data) return <Loading />;
  const data = request.data.data;
  const description = {
    ...data.description.description,
    transitions: data.description.description.transitions.filter(
      (transition) => transition.name !== 'revise',
    ),
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader title={t('quoteApproval.title')} />
        <WorkflowDefinitionDetail
          diagramTitle={t('quoteApproval.process')}
          parametersTitle={t('quoteApproval.configure')}
          diagram={
            <LifecycleDiagram
              description={description}
              ariaLabel={t('quoteApproval.process')}
              stateLabel={(state) => t(`quoteApproval.${state.name}`)}
              transitionLabel={(transition) =>
                t(`quoteApproval.${transition.name}`)
              }
              configuration={{
                label: () => t('quoteApproval.configure'),
                canConfigure: () => permission.can,
                onConfigure: () => inputRef.current?.focus(),
              }}
            />
          }
          parameters={
            <Parameters
              key={data.parameters.revision}
              config={data.parameters}
              allowed={permission.can}
              reload={request.reload}
              inputRef={inputRef}
            />
          }
        />
      </PageContainer>
    </RouteChildPage>
  );
}
function Parameters({
  config,
  allowed,
  reload,
  inputRef,
}: {
  config: Definition['parameters'];
  allowed: boolean;
  reload: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const submission = useSubmission({ scope: 'quoteApprovalConfiguration' });
  const [value, setValue] = useState(String(config.values.thresholdPercent));
  const [error, setError] = useState<unknown>();
  return (
    <FeedbackForm
      error={error}
      submitting={submission.submitting}
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await submission.run(
            {
              thresholdPercent: Number(value),
              expectedRevision: config.revision,
            },
            (key, signal, values) =>
              api.request({
                path: 'crmWorkflows/parameters',
                method: 'PUT',
                signal,
                json: { ...values, requestId: key },
              }),
          );
          reload();
        } catch (failure) {
          setError(failure);
        }
      }}
    >
      <Label htmlFor='discount-threshold'>{t('quoteApproval.threshold')}</Label>
      <Input
        id='discount-threshold'
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        type='number'
        min={0}
        max={100}
        step='0.01'
        disabled={!allowed || submission.submitting}
      />
      <p className='text-sm text-muted-foreground'>
        {t('quoteApproval.thresholdHint')}
      </p>
      <PendingButton
        type='submit'
        busy={submission.submitting}
        disabled={!allowed}
      >
        {t('crm.save')}
      </PendingButton>
    </FeedbackForm>
  );
}
export function Executions() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const page = Math.max(1, Number(search.get('page')) || 1);
  const order = search.get('order') === 'oldest' ? 'oldest' : 'newest';
  const request = useListData<{
    data: {
      id: string;
      status: string;
      createdAt: string;
      snapshot: { name: string };
    }[];
    meta: { total: number };
  }>(`crmWorkflows/executions?page=${page}&order=${order}`);
  return (
    <>
      <WorkflowExecutionList
        rows={(request.data?.data ?? []).map((r) => ({
          id: r.id,
          record: <Link to={r.id}>{r.snapshot.name}</Link>,
          workflow: t('quoteApproval.title'),
          state: t(`quoteApproval.${r.status}`),
          createdAt: new Date(r.createdAt).toLocaleString(),
        }))}
        loaded={Boolean(request.data)}
        loading={request.loading}
        filters={null}
        status={
          request.error ? (
            <ReadError error={request.error} retry={request.reload} />
          ) : null
        }
        labels={{
          record: t('sales.quotes'),
          workflow: t('quoteApproval.title'),
          state: t('crm.status'),
          createdAt: t('quoteApproval.time'),
          previous: t('quoteApproval.previous'),
          next: t('quoteApproval.next'),
        }}
        order={order}
        onSort={() =>
          setSearch({
            page: '1',
            order: order === 'newest' ? 'oldest' : 'newest',
          })
        }
        onRefresh={request.reload}
        pagination={page}
        previousDisabled={page <= 1}
        nextDisabled={page * 20 >= (request.data?.meta.total ?? 0)}
        onPrevious={() => setSearch({ page: String(page - 1), order })}
        onNext={() => setSearch({ page: String(page + 1), order })}
      />
      <Outlet />
    </>
  );
}
export function ExecutionDetail() {
  const { t } = useTranslation();
  const { executionId } = useParams();
  const request = useListData<{ data: RecordView }>(
    `crmWorkflows/executions/${executionId}`,
  );
  const definition = useListData<{ data: Definition }>(
    'crmWorkflows/definition',
  );
  usePageBreadcrumb([
    { label: t('quoteApproval.executions'), to: `${root}/executions` },
    { label: executionId ?? '' },
  ]);
  if (request.error)
    return <ReadError error={request.error} retry={request.reload} />;
  if (definition.error)
    return <ReadError error={definition.error} retry={definition.reload} />;
  if (!request.data || !definition.data) return <Loading />;
  const data = request.data.data;
  const labels = Object.fromEntries(
    [
      'processDiagram',
      'history',
      'historyHint',
      'step',
      'transition',
      'from',
      'to',
      'actor',
      'time',
      'noHistory',
      'effects',
      'effect',
      'state',
      'attempts',
      'error',
      'noEffects',
      'executionParameters',
      'snapshotHint',
    ].map((key) => [key, t(`quoteApproval.${key}`)]),
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader title={t('quoteApproval.executions')} />
        <WorkflowExecutionDetail
          transitions={data.history.transitions.map((entry) => ({
            ...entry,
            id: String(entry.id),
          }))}
          state={String(data.record.status)}
          effects={[]}
          labels={
            {
              ...labels,
              showStep: (step: number) => String(step),
            } as import('#extensions/nocobase-workflow-management/execution-detail').WorkflowExecutionLabels
          }
          stateLabel={(name) => t(`quoteApproval.${name}`)}
          transitionLabel={(name) => t(`quoteApproval.${name}`)}
          dateLabel={(at) => new Date(at).toLocaleString()}
          effectStatusLabel={(status) => status}
          parameters={
            <p>
              {t('quoteApproval.threshold')}:{' '}
              {String(Number(data.record.thresholdBasisPoints) / 100)}%
            </p>
          }
          renderDiagram={({ current, history }) => (
            <LifecycleDiagram
              description={definition.data!.data.description.description}
              currentState={current}
              history={history}
              ariaLabel={t('quoteApproval.process')}
            />
          )}
        />
      </PageContainer>
    </RouteChildPage>
  );
}
