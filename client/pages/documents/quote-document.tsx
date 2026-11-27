import { useCustomerOperation } from '#hooks/use-crm-access';
import {
  resolveAppUrl,
  useApiClient,
  useSubmission,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { useParams } from 'react-router';
import {
  FileList,
  FilePreviewDialog,
} from '#extensions/nocobase-file-component-ui/index';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { PendingButton } from '#components/pending-button';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';
import type { BusinessFile } from './files.js';
import { downloadFile } from './download.js';
export default function QuoteDocument({ revision }: { revision: number }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const { customerId, opportunityId, quoteId } = useParams();
  const issue = useCustomerOperation(customerId, 'issueQuote');
  const path = `crmFiles/quotes/${customerId}/${opportunityId}/${quoteId}`;
  const request = useListData<{
    data: {
      draft: boolean;
      confirmed: boolean;
      document: null | { file: BusinessFile; templateRevision: number };
    };
  }>(`${path}?revision=${revision}`);
  const submission = useSubmission({
    scope: `${session?.user.id}:document:${quoteId}`,
  });
  const [failed, setFailed] = useState(false);
  const [downloadingDraft, setDownloadingDraft] = useState(false);
  const [preview, setPreview] = useState(false);
  const file = request.data?.data.document?.file;
  const downloadDraft = async () => {
    setFailed(false);
    setDownloadingDraft(true);
    try {
      await downloadFile({
        filename: `draft-quotation-${quoteId}.docx`,
        contentUrl: resolveAppUrl(`/api/${path}/draft`),
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    } catch {
      setFailed(true);
    } finally {
      setDownloadingDraft(false);
    }
  };
  const download = () => {
    if (file) return downloadFile(file).catch(() => setFailed(true));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(
            request.data?.data.draft
              ? 'documents.draftQuotation'
              : 'documents.quotation',
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {request.data ? (
          <p className='text-sm text-muted-foreground'>
            {t(
              request.data.data.draft
                ? 'documents.draftHint'
                : 'documents.quoteHint',
            )}
          </p>
        ) : null}
        {request.error ? (
          <ReadError error={request.error} retry={request.reload} />
        ) : !request.data ? (
          <Loading />
        ) : request.data.data.draft ? (
          <PendingButton
            busy={downloadingDraft}
            onClick={() => void downloadDraft()}
          >
            {t('documents.downloadDraft')}
          </PendingButton>
        ) : file ? (
          <>
            <FileList
              files={[file]}
              onPreview={() => {
                setFailed(false);
                setPreview(true);
              }}
              onDownload={() => void download()}
              onError={() => setFailed(true)}
            />
            <FilePreviewDialog
              files={[file]}
              open={preview}
              onOpenChange={setPreview}
              onDownload={downloadFile}
              onError={() => setFailed(true)}
            />
          </>
        ) : request.data.data.confirmed && issue.allowed ? (
          <PendingButton
            busy={submission.submitting}
            onClick={() => {
              setFailed(false);
              void submission
                .run({}, (key, signal) =>
                  api.request({
                    path,
                    method: 'POST',
                    headers: { 'Idempotency-Key': key },
                    signal,
                  }),
                )
                .then(request.reload)
                .catch(() => setFailed(true));
            }}
          >
            {t('documents.generate')}
          </PendingButton>
        ) : request.data.data.confirmed ? null : (
          <p>{t('documents.confirmFirst')}</p>
        )}
        {failed ? (
          <p role='alert' className='text-destructive'>
            {t('documents.failed')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
