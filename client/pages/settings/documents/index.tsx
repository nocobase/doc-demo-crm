import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../../customers/shared.js';
import { FilesTable } from '../../documents/files.js';
export default function DocumentSettings() {
  const cleanup = useCan({
    resource: { type: 'settings', id: 'crm.documents' },
    action: 'cleanup',
  });
  const { t } = useTranslation();
  const request = useListData<{
    data: {
      template: {
        id: string;
        revision: number;
        format: string;
        language: string;
      };
      storage: {
        disk: string;
        uploadMaxBytes: number;
        attachMaxFiles: number;
        orphanMinimumAgeHours: number;
      };
    };
  }>('crmDocuments/settings');
  const data = request.data?.data;
  return (
    <PageContainer>
      <PageHeader title={t('documents.settings')} />
      {request.error ? (
        <ReadError error={request.error} retry={request.reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('documents.template')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              <p>
                {t('documents.templateDescription', {
                  revision: data.template.revision,
                })}
              </p>
              <p className='text-sm text-muted-foreground'>
                {t('documents.storageDescription', {
                  disk: data.storage.disk,
                  size: data.storage.uploadMaxBytes / 1024 / 1024,
                  count: data.storage.attachMaxFiles,
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('documents.cleanup')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <p className='text-sm text-muted-foreground'>
                {t('documents.cleanupHint', {
                  hours: data.storage.orphanMinimumAgeHours,
                })}
              </p>
              <FilesTable path='crmDocuments/orphans' canRemove={cleanup.can} />
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
