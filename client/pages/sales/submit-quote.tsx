import { useApiClient, useSubmission } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useId, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { PendingButton } from '#components/pending-button';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { FeedbackForm } from '#components/feedback-form';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { ReadError } from '../customers/shared.js';
import type { ApprovalView } from './approval.js';
import { approvalPath } from './approval-path.js';
import type { Quote } from './types.js';
export default function SubmitQuote() {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const { session } = useAuthentication();
  const { customerId, opportunityId, quoteId } = useParams();
  const { quote, reload } = useOutletContext<{
    quote?: Quote;
    reload: () => void;
  }>();
  const access = useCustomerOperation(customerId, 'editQuote');
  const request = useListData<{ data: { id: string; name: string }[] }>(
    'crmApprovals/reviewers',
    { active: access.allowed },
  );
  const policy = useListData<{ data: ApprovalView }>(
    approvalPath(customerId, opportunityId, quoteId),
    { active: access.allowed },
  );
  const threshold = policy.data?.data.thresholdPercent;
  const submission = useSubmission({
    scope: `${session?.user.id}:submitQuote:${quoteId}`,
  });
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const formId = useId();
  const needsReview = Boolean(
    quote?.lines.some((line) => line.discount > (threshold ?? 10)),
  );
  const close = () => {
    void navigate('..', { relative: 'path' });
  };
  return (
    <RouteDialog
      title={t('quoteApproval.submit')}
      beforeClose={() => !submission.submitting && !submission.pending}
      footer={
        <>
          <Button
            variant='outline'
            onClick={close}
            disabled={submission.submitting}
          >
            {t('crm.cancel')}
          </Button>
          <PendingButton
            type='submit'
            form={formId}
            busy={submission.submitting}
            disabled={
              !access.allowed ||
              !quote ||
              threshold === undefined ||
              (needsReview && !reviewerId)
            }
          >
            {t('quoteApproval.submit')}
          </PendingButton>
        </>
      }
    >
      {!access.allowed ? (
        <p>{t('crmAccess.deniedEdit')}</p>
      ) : request.error ? (
        <ReadError error={request.error} retry={request.reload} />
      ) : policy.error ? (
        <ReadError error={policy.error} retry={policy.reload} />
      ) : !quote || !request.data || !policy.data ? (
        <Loading />
      ) : (
        <FeedbackForm
          id={formId}
          error={error}
          submitting={submission.submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setError(undefined);
              await submission.run(
                { reviewerId: needsReview ? reviewerId : null },
                (key, signal, payload) =>
                  api.request({
                    path: `${approvalPath(customerId, opportunityId, quoteId)}/submit`,
                    method: 'POST',
                    signal,
                    headers: { 'Idempotency-Key': key },
                    json: payload,
                  }),
              );
              reload();
              close();
            } catch (failure) {
              setError(failure);
            }
          }}
        >
          <p className='text-sm text-muted-foreground'>
            {t('quoteApproval.rule', { threshold })}
          </p>
          {needsReview ? (
            <div className='space-y-2'>
              <Label htmlFor='quote-reviewer'>
                {t('quoteApproval.reviewer')}
              </Label>
              <Select
                items={request.data.data.map((person) => ({
                  value: person.id,
                  label: person.name,
                }))}
                value={reviewerId ?? ''}
                onValueChange={(value) => setReviewerId(value)}
              >
                <SelectTrigger id='quote-reviewer'>
                  <SelectValue
                    placeholder={t('quoteApproval.chooseReviewer')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {request.data.data.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!request.data.data.length ? (
                <p>{t('quoteApproval.noReviewer')}</p>
              ) : null}
            </div>
          ) : (
            <p>{t('quoteApproval.direct')}</p>
          )}
        </FeedbackForm>
      )}
    </RouteDialog>
  );
}
