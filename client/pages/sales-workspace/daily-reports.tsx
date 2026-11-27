import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Loading } from '#components/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../customers/shared.js';

interface Report {
  reportDate: string;
  customers: number;
  opportunities: number;
  followUps: number;
}
const metrics = ['customers', 'opportunities', 'followUps'] as const;

export default function DailyReportsPage() {
  const { t } = useTranslation();
  const request = useListData<{
    data: { timezone: string; reports: Report[] };
  }>('crm/daily-reports');
  const result = request.data?.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('dailyReports.title')}
        description={
          result && t('dailyReports.description', { timezone: result.timezone })
        }
      />
      {request.error ? (
        <ReadError error={request.error} retry={request.reload} />
      ) : !result ? (
        <Loading />
      ) : result.reports.length === 0 ? (
        <p>{t('dailyReports.empty')}</p>
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dailyReports.date')}</TableHead>
                {metrics.map((key) => (
                  <TableHead key={key} className='text-right'>
                    {t('dailyReports.' + key)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.reports.map((report) => (
                <TableRow key={report.reportDate}>
                  <TableCell className='whitespace-nowrap font-medium'>
                    {report.reportDate}
                  </TableCell>
                  {metrics.map((key) => (
                    <TableCell key={key} className='text-right tabular-nums'>
                      {report[key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
