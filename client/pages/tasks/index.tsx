import { useApiClient, usePageBreadcrumb } from '@nocobase/app-client';
import {
  TaskCenter,
  createTaskCenterDataSource,
  type TaskCenterTask,
} from '@nocobase/app-plugin-task-center/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
function TaskLink({ task }: { task: TaskCenterTask }) {
  const api = useApiClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  return (
    <div className='space-y-2'>
      <Button
        variant='link'
        disabled={pending}
        onClick={() => {
          void (async () => {
            setPending(true);
            setError(undefined);
            try {
              const response = await api.request<{
                data: {
                  customerId: string;
                  opportunityId: string;
                  quoteId: string;
                };
              }>({ path: `crmApprovals/tasks/${task.id}` });
              const r = response.data;
              await navigate(
                `quotes/${r.customerId}/${r.opportunityId}/${r.quoteId}`,
              );
            } catch (failure) {
              setError(failure);
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        {t('quoteApproval.open')}
      </Button>
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{t('quoteApproval.failed')}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
export default function QuoteTasks() {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const api = useApiClient();
  const dataSource = useMemo(() => {
    const source = createTaskCenterDataSource(api);
    return {
      ...source,
      list: async (query: Parameters<typeof source.list>[0]) => {
        const page = await source.list(query);
        return {
          ...page,
          data: page.data.map((task) =>
            task.sourceType === 'approval.task' && task.subject === 'crm.quote'
              ? { ...task, title: t('quoteApproval.reviewTask') }
              : task,
          ),
        };
      },
    };
  }, [api, t]);
  usePageBreadcrumb([{ label: t('quoteApproval.tasks') }]);
  const sources = useMemo(
    () => [
      {
        sourceType: 'approval.task',
        label: t('quoteApproval.title'),
        renderTask: (task: TaskCenterTask) => <TaskLink task={task} />,
      },
    ],
    [t],
  );
  return (
    <>
      <TaskCenter
        dataSource={dataSource}
        sources={sources}
        refreshKey={revision}
      />
      <Outlet
        context={{
          fromTasks: true,
          reload: () => setRevision((value) => value + 1),
        }}
      />
    </>
  );
}
