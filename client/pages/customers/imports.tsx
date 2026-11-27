import { useCan } from '@nocobase/app-plugin-authorization/client';
import { crmOperations } from '../../../server/crm-operations.js';
import {
  useApiClient,
  usePageBreadcrumb,
  useSubmission,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { PendingButton } from '#components/pending-button';
import { RouteChildPage } from '#components/route-child-page';
import { StatusBadge } from '#components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { Textarea } from '#components/ui/textarea';
import { useListData } from '#hooks/use-list-data';
import { ReadError } from './shared.js';

interface ImportBatch {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedByName: string;
  conflictMode: 'skip' | 'update' | 'reject';
  transactionMode: 'allOrNothing' | 'rowByRow';
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completedWithErrors'
    | 'rolledBack'
    | 'failed';
  jobId: string | null;
  totalRows: number;
  createdCustomers: number;
  updatedCustomers: number;
  createdContacts: number;
  skippedRows: number;
  failedRows: number;
  progress: number;
  summary: string;
  createdAt: string;
  completedAt: string | null;
}

interface ImportRowError {
  id: string;
  rowNumber: number;
  customerName: string;
  contactEmail: string;
  code: string;
  message: string;
  rawRow: string;
}

interface ImportBatchDetail extends ImportBatch {
  errors: ImportRowError[];
}

const SAMPLE_VALID_CSV = [
  'customerName,industry,status,website,notes,contactName,contactRole,contactEmail,contactPhone',
  'Harbor Robotics,Automation,prospect,https://harbor-robotics.example.com,Met at industrial expo,Jordan Patel,VP Operations,jordan.patel@harbor-robotics.example.com,+1-555-0140',
  'Summit Logistics,Supply Chain,customer,https://summit-logistics.example.com,Legacy regional account,Riley Chen,IT Director,riley.chen@summit-logistics.example.com,+1-555-0141',
].join('\n');

const SAMPLE_ERROR_CSV = [
  'customerName,industry,status,website,notes,contactName,contactRole,contactEmail,contactPhone',
  'Cobalt Energy,Utilities,prospect,https://cobalt-energy.example.com,Grid modernization lead,Taylor Brooks,Director,taylor.brooks@cobalt-energy.example.com,+1-555-0145',
  'Broken Record Corp,Retail,prospect,not-a-valid-url,Bad website and email,Sam Lee,Manager,invalid-email,+1-555-0146',
].join('\n');

function statusTone(status: ImportBatch['status']) {
  if (status === 'completed') return 'success' as const;
  if (status === 'queued' || status === 'running') return 'info' as const;
  return 'warning' as const;
}

export default function CustomerImportsPage() {
  const batchCreate = useCan(crmOperations.importCustomers);
  const customerCreate = useCan(crmOperations.createCustomer);
  const customerEdit = useCan(crmOperations.editCustomer);
  const canImport = batchCreate.can && customerCreate.can;
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  usePageBreadcrumb([
    { label: t('crm.title'), to: '/customers' },
    { label: t('crmImports.title') },
  ]);

  const [fileName, setFileName] = useState('customers-batch.csv');
  const [csvContent, setCsvContent] = useState(SAMPLE_VALID_CSV);
  const [conflictMode, setConflictMode] = useState<
    'skip' | 'update' | 'reject'
  >('skip');
  const [transactionMode, setTransactionMode] = useState<
    'allOrNothing' | 'rowByRow'
  >('allOrNothing');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const batches = useListData<{ data: ImportBatch[] }>('crmImports/batches');
  const effectiveSelectedId = selectedId ?? batches.data?.data[0]?.id ?? null;
  const detail = useListData<{ data: ImportBatchDetail }>(
    effectiveSelectedId ? `crmImports/batches/${effectiveSelectedId}` : '',
    { active: Boolean(effectiveSelectedId) },
  );

  const submission = useSubmission({
    scope: `${session?.user.id}:crm-import`,
  });

  const hasActiveJob = Boolean(
    batches.data?.data.some(
      (b) => b.status === 'queued' || b.status === 'running',
    ) ||
    detail.data?.data.status === 'queued' ||
    detail.data?.data.status === 'running',
  );

  const { reload: reloadBatches } = batches;
  const { reload: reloadDetail } = detail;

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      reloadBatches();
      if (effectiveSelectedId) reloadDetail();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, effectiveSelectedId, reloadBatches, reloadDetail]);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsvContent(await file.text());
    setSubmitError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const payload = {
      fileName: fileName.trim() || 'customers.csv',
      csvContent,
      conflictMode,
      transactionMode,
    };
    try {
      const response = await submission.run(payload, (key, signal) =>
        api.request<{ data: ImportBatch }>({
          path: 'crmImports/batches',
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          json: payload,
          signal,
        }),
      );
      if (response?.data.id) setSelectedId(response.data.id);
      batches.reload();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : t('crmImports.submitFailed'),
      );
    }
  };

  const downloadCsv = async (path: string, fallbackName: string) => {
    const csvText = await api.request<string>({ path, method: 'GET' });
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const selectedBatch = detail.data?.data;

  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={t('crmImports.title')}
          description={t('crmImports.description')}
          actions={
            canImport && (
              <Button
                variant='outline'
                onClick={() =>
                  void downloadCsv(
                    'crmImports/template.csv',
                    'crm-customers-template.csv',
                  )
                }
              >
                <Download className='mr-2 size-4' />
                {t('crmImports.downloadTemplate')}
              </Button>
            )
          }
        />

        {canImport && (
          <Card>
            <CardHeader>
              <CardTitle>{t('crmImports.newImport')}</CardTitle>
              <CardDescription>{t('crmImports.newImportHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className='space-y-4'
                onSubmit={(e) => void handleSubmit(e)}
              >
                <div className='grid gap-4 md:grid-cols-3'>
                  <div className='space-y-2'>
                    <Label htmlFor='import-file'>
                      {t('crmImports.csvFile')}
                    </Label>
                    <Input
                      id='import-file'
                      type='file'
                      accept='.csv,text/csv'
                      onChange={(e) => void handleFileChange(e)}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>{t('crmImports.conflictMode')}</Label>
                    <Select
                      value={conflictMode}
                      onValueChange={(value) => {
                        if (
                          value === 'skip' ||
                          value === 'update' ||
                          value === 'reject'
                        ) {
                          setConflictMode(value);
                        }
                      }}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue>
                          {conflictMode === 'skip'
                            ? t('crmImports.conflictSkip')
                            : conflictMode === 'update'
                              ? t('crmImports.conflictUpdate')
                              : t('crmImports.conflictReject')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='skip'>
                          {t('crmImports.conflictSkip')}
                        </SelectItem>
                        <SelectItem disabled={!customerEdit.can} value='update'>
                          {t('crmImports.conflictUpdate')}
                        </SelectItem>
                        <SelectItem value='reject'>
                          {t('crmImports.conflictReject')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='space-y-2'>
                    <Label>{t('crmImports.transactionMode')}</Label>
                    <Select
                      value={transactionMode}
                      onValueChange={(value) => {
                        if (value === 'allOrNothing' || value === 'rowByRow') {
                          setTransactionMode(value);
                        }
                      }}
                    >
                      <SelectTrigger className='w-full'>
                        <SelectValue>
                          {transactionMode === 'allOrNothing'
                            ? t('crmImports.txAllOrNothing')
                            : t('crmImports.txRowByRow')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='allOrNothing'>
                          {t('crmImports.txAllOrNothing')}
                        </SelectItem>
                        <SelectItem value='rowByRow'>
                          {t('crmImports.txRowByRow')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className='space-y-2'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <Label htmlFor='import-csv-content'>
                      {t('crmImports.csvPreview')} ({fileName})
                    </Label>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => {
                          setFileName('customers-valid-sample.csv');
                          setCsvContent(SAMPLE_VALID_CSV);
                        }}
                      >
                        {t('crmImports.loadValidSample')}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => {
                          setFileName('customers-with-errors.csv');
                          setCsvContent(SAMPLE_ERROR_CSV);
                        }}
                      >
                        {t('crmImports.loadErrorSample')}
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    id='import-csv-content'
                    rows={5}
                    className='font-mono text-xs'
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                  />
                </div>

                {submitError ? (
                  <Alert variant='destructive'>
                    <AlertTitle>{t('crmImports.submitFailed')}</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                ) : null}

                <PendingButton type='submit' busy={submission.submitting}>
                  <Upload className='mr-2 size-4' />
                  {t('crmImports.startImport')}
                </PendingButton>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0'>
            <div>
              <CardTitle>{t('crmImports.batchesTitle')}</CardTitle>
              <CardDescription>{t('crmImports.batchesHint')}</CardDescription>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                batches.reload();
                if (effectiveSelectedId) detail.reload();
              }}
            >
              <RefreshCw className='mr-2 size-4' />
              {t('crmImports.refresh')}
            </Button>
          </CardHeader>
          <CardContent>
            {batches.error ? (
              <ReadError error={batches.error} retry={batches.reload} />
            ) : (batches.data?.data.length ?? 0) === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('crmImports.noBatches')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('crmImports.fileName')}</TableHead>
                    <TableHead>{t('crmImports.mode')}</TableHead>
                    <TableHead>{t('crmImports.status')}</TableHead>
                    <TableHead>{t('crmImports.progress')}</TableHead>
                    <TableHead>{t('crmImports.counts')}</TableHead>
                    <TableHead>{t('crmImports.submittedBy')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.data!.data.map((batch) => (
                    <TableRow
                      key={batch.id}
                      className={
                        batch.id === effectiveSelectedId
                          ? 'bg-muted/50 cursor-pointer'
                          : 'cursor-pointer'
                      }
                      onClick={() => setSelectedId(batch.id)}
                    >
                      <TableCell className='font-medium'>
                        {batch.fileName}
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {t(`crmImports.conflict_${batch.conflictMode}`)} ·{' '}
                        {t(`crmImports.tx_${batch.transactionMode}`)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={statusTone(batch.status)}>
                          {t(`crmImports.status_${batch.status}`)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>{batch.progress}%</TableCell>
                      <TableCell className='text-xs'>
                        +{batch.createdCustomers} / ~{batch.updatedCustomers} /{' '}
                        {batch.skippedRows} skip / {batch.failedRows} err
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {batch.uploadedByName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selectedBatch ? (
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0'>
              <div>
                <CardTitle>
                  {t('crmImports.reportTitle')}: {selectedBatch.fileName}
                </CardTitle>
                <CardDescription>{selectedBatch.summary}</CardDescription>
              </div>
              {selectedBatch.errors.length > 0 ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    void downloadCsv(
                      `crmImports/batches/${selectedBatch.id}/errors.csv`,
                      `${selectedBatch.fileName.replace(/\.csv$/i, '')}-errors.csv`,
                    )
                  }
                >
                  <Download className='mr-2 size-4' />
                  {t('crmImports.downloadErrors')}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-3 sm:grid-cols-5'>
                <div className='rounded-md border p-3'>
                  <div className='text-xs text-muted-foreground'>
                    {t('crmImports.totalRows')}
                  </div>
                  <div className='text-xl font-semibold'>
                    {selectedBatch.totalRows}
                  </div>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='text-xs text-muted-foreground'>
                    {t('crmImports.createdCustomers')}
                  </div>
                  <div className='text-xl font-semibold'>
                    {selectedBatch.createdCustomers}
                  </div>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='text-xs text-muted-foreground'>
                    {t('crmImports.updatedCustomers')}
                  </div>
                  <div className='text-xl font-semibold'>
                    {selectedBatch.updatedCustomers}
                  </div>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='text-xs text-muted-foreground'>
                    {t('crmImports.skippedRows')}
                  </div>
                  <div className='text-xl font-semibold'>
                    {selectedBatch.skippedRows}
                  </div>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='text-xs text-muted-foreground'>
                    {t('crmImports.failedRows')}
                  </div>
                  <div className='text-xl font-semibold'>
                    {selectedBatch.failedRows}
                  </div>
                </div>
              </div>

              {selectedBatch.errors.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('crmImports.rowNumber')}</TableHead>
                      <TableHead>{t('crm.name')}</TableHead>
                      <TableHead>{t('crm.email')}</TableHead>
                      <TableHead>{t('crmImports.errorCode')}</TableHead>
                      <TableHead>{t('crmImports.errorMessage')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedBatch.errors.map((err) => (
                      <TableRow key={err.id}>
                        <TableCell>#{err.rowNumber}</TableCell>
                        <TableCell>{err.customerName || '—'}</TableCell>
                        <TableCell>{err.contactEmail || '—'}</TableCell>
                        <TableCell className='font-mono text-xs'>
                          {err.code}
                        </TableCell>
                        <TableCell className='text-sm text-destructive'>
                          {err.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('crmImports.noRowErrors')}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}
