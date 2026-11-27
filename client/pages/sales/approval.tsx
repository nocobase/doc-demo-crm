import { approvalPath } from './approval-path.js';
import { useApiClient, useSubmission } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  approvalStepsOf,
  renderTimelineEntry,
  type RunView,
  type TaskActions,
} from '@nocobase/app-plugin-approval/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApprovalProgress,
  ApprovalTimeline,
  ApprovalActionBar,
  ApprovalUiProvider,
  type ApprovalBarAction,
} from '#extensions/nocobase-approval-ui/index';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
export interface ApprovalView {
  status: string;
  people?: Record<string, string>;
  thresholdPercent: number;
  view: null | {
    record: {
      lifecycleVersion: number;
      snapshot: { total: number };
      applicantId: string;
    };
    available: { name: string; allowed: boolean }[];
  };
  runs: RunView[];
  actions: TaskActions[];
}
export default function QuoteApprovalPanel({
  revision,
  onHandled,
}: {
  revision: number;
  onHandled: () => void;
}) {
  const { t } = useTranslation();
  const { customerId, opportunityId, quoteId } = useParams();
  const access = useCustomerOperation(customerId, 'submitQuote');
  const api = useApiClient();
  const { session } = useAuthentication();
  const path = approvalPath(customerId, opportunityId, quoteId);
  const request = useListData<{ data: ApprovalView }>(
    `${path}?revision=${revision}`,
  );
  const submission = useSubmission({
    scope: `${session?.user.id}:quoteDecision:${quoteId}`,
  });
  const [error, setError] = useState<unknown>();
  if (request.error)
    return <ReadError error={request.error} retry={request.reload} />;
  if (!request.data) return <Loading />;
  const data = request.data.data;
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      id ? (data.people?.[id] ?? id) : '',
    stage: () => t('quoteApproval.review'),
  };
  const actions: ApprovalBarAction[] = data.actions.flatMap((group) =>
    group.actions
      .filter((action) => access.access?.actions?.[`${action.name}Quote`])
      .map((action) => ({
        key: `${group.task.id}:${action.name}`,
        label: t(`quoteApproval.${action.name}`),
        tone: action.tone,
        primary: action.primary,
        confirm: action.name === 'approve',
        ...(action.name === 'approve'
          ? {}
          : {
              form: {
                initialValues: { comment: '' },
                validate: (values: Record<string, unknown>) =>
                  (typeof values.comment === 'string'
                    ? values.comment
                    : ''
                  ).trim()
                    ? []
                    : ['comment'],
                render: ({
                  values,
                  setValues,
                  invalid,
                }: {
                  values: Record<string, unknown>;
                  invalid: readonly string[];
                  setValues: (values: Record<string, unknown>) => void;
                }) => (
                  <div className='space-y-2'>
                    <Label htmlFor='approval-comment'>
                      {t('quoteApproval.reason')}
                    </Label>
                    <Textarea
                      id='approval-comment'
                      required
                      aria-invalid={invalid.includes('comment')}
                      aria-describedby={
                        invalid.includes('comment')
                          ? 'approval-comment-error'
                          : undefined
                      }
                      value={
                        typeof values.comment === 'string' ? values.comment : ''
                      }
                      onChange={(event) =>
                        setValues({ comment: event.target.value })
                      }
                    />
                    {invalid.includes('comment') ? (
                      <p
                        id='approval-comment-error'
                        className='text-sm text-destructive'
                      >
                        {t('quoteApproval.reasonRequired')}
                      </p>
                    ) : null}
                  </div>
                ),
              },
            }),
        run: async (values: Record<string, unknown>) => {
          try {
            setError(undefined);
            await submission.run(
              {
                taskId: group.task.id,
                action: action.name,
                comment:
                  typeof values.comment === 'string' ? values.comment : '',
                contentHash:
                  group.contentHash ??
                  data.runs.find((run) => run.run.id === group.task.runId)?.run
                    .contentHash ??
                  '',
              },
              (key, signal, payload) =>
                api.request({
                  path: `${path}/actions`,
                  method: 'POST',
                  headers: { 'Idempotency-Key': key },
                  signal,
                  json: payload,
                }),
            );
            request.reload();
            onHandled();
            return true;
          } catch (failure) {
            setError(failure);
            request.reload();
            return false;
          }
        },
      })),
  );
  if (
    access.access?.actions?.withdrawQuote &&
    data.view?.available.some(
      (action) => action.name === 'withdraw' && action.allowed,
    )
  )
    actions.push({
      key: 'withdraw',
      label: t('quoteApproval.withdraw'),
      group: 'record',
      confirm: true,
      run: async () => {
        try {
          setError(undefined);
          await submission.run(
            { expectVersion: data.view!.record.lifecycleVersion },
            (key, signal, payload) =>
              api.request({
                path: `${path}/withdraw`,
                method: 'POST',
                headers: { 'Idempotency-Key': key },
                signal,
                json: payload,
              }),
          );
          request.reload();
          onHandled();
        } catch (failure) {
          setError(failure);
          request.reload();
          return false;
        }
      },
    });
  const steps = approvalStepsOf(data.runs).map((step) => ({
    ...step,
    title: t('quoteApproval.review'),
    policy: step.policy ? t(`approval.policies.${step.policy}`) : null,
    tasks: step.tasks.map((task) => ({
      key: task.id,
      personId: task.assigneeId,
      badges: [{ label: t(`approval.taskStatus.${task.status}`) }],
      comment: task.comment,
    })),
  }));
  const lines = data.runs
    .flatMap((run) => [
      ...run.timeline.entries,
      ...run.timeline.stages.flatMap((stage) => stage.entries),
    ])
    .map((entry) => {
      const rendered = renderTimelineEntry(entry, text);
      return {
        ...rendered,
        kind:
          rendered.kind === 'system' ? ('event' as const) : ('action' as const),
      };
    });
  return (
    <ApprovalUiProvider personName={(id) => data.people?.[id] ?? id}>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('quoteApproval.title')} · {t(`quoteApproval.${data.status}`)}
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {['draft', 'revision'].includes(data.status) && access.allowed ? (
            <Button nativeButton={false} render={<Link to='submit' />}>
              {t('quoteApproval.submit')}
            </Button>
          ) : null}
          <p className='text-sm text-muted-foreground'>
            {t('quoteApproval.rule', { threshold: data.thresholdPercent })}
          </p>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{t('quoteApproval.failed')}</AlertDescription>
            </Alert>
          ) : null}
          {steps.length ? <ApprovalProgress steps={steps} /> : null}
          <ApprovalActionBar actions={actions} />
          {lines.length ? <ApprovalTimeline lines={lines} /> : null}
        </CardContent>
      </Card>
    </ApprovalUiProvider>
  );
}
