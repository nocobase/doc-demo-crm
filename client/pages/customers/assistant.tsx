import { useApiClient, useSubmission, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';
import { Loading } from '#components/loading';
import { PendingButton } from '#components/pending-button';
import { useListData } from '#hooks/use-list-data';
import { useCustomerOperation } from '#hooks/use-crm-access';
import { Choice, ReadError } from './shared.js';

interface ModelCatalogResponse {
  data: {
    services: {
      name: string;
      title: string;
      provider: string;
      models: { value: string; label: string }[];
    }[];
    defaultModel: { modelService: string; model: string } | null;
  };
}

interface Citation {
  docId: string;
  title: string;
  version: number;
  excerpt: string;
}

interface FollowUpDraft {
  summary: string;
  suggestedNextStep: string;
  channel: 'call' | 'email' | 'meeting' | 'note';
  draftContent: string;
  citations: Citation[];
  missingEvidence: string[];
}

interface DraftGenerationResponse {
  data: {
    sessionId: string;
    model: { modelService: string; model: string };
    draft: FollowUpDraft;
    canSaveFollowUp: boolean;
  };
}

export function CustomerAssistant({
  customerId,
  revision,
  reload,
}: {
  customerId: string;
  revision: number;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { session } = useAuthentication();
  const formId = useId();

  const modelsRequest = useListData<ModelCatalogResponse>(
    `crmAssistant/models?revision=${revision}`,
  );
  const recordAccess = useCustomerOperation(customerId, 'recordFollowUp');

  const modelChoices =
    modelsRequest.data?.data.services.flatMap((service) =>
      service.models.map((m) => ({
        key: `${service.name}::${m.value}`,
        service: service.name,
        model: m.value,
        label: `${service.title} · ${m.label}`,
      })),
    ) ?? [];

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [goal, setGoal] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftGenerationResponse['data'] | null>(
    null,
  );

  // Editable draft fields (explicit human review before saving).
  const [channel, setChannel] = useState<'call' | 'email' | 'meeting' | 'note'>(
    'call',
  );
  const [content, setContent] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const submission = useSubmission({
    scope: `${session?.user.id}:crm:assistant-followUp:${customerId}:${result?.sessionId ?? 'none'}`,
  });

  const defaultModel = modelsRequest.data?.data.defaultModel;
  const defaultKey = defaultModel
    ? `${defaultModel.modelService}::${defaultModel.model}`
    : '';
  const effectiveSelectedKey =
    (selectedKey && modelChoices.some((c) => c.key === selectedKey)
      ? selectedKey
      : modelChoices.find((c) => c.key === defaultKey)?.key) ??
    modelChoices[0]?.key ??
    '';

  const handleGenerate = async () => {
    const chosen =
      modelChoices.find((c) => c.key === effectiveSelectedKey) ??
      modelChoices[0];
    if (!chosen) return;
    setGenerating(true);
    setGenerateError(null);
    setSavedNotice(false);
    setSaveError(null);
    try {
      const response = await api.request<DraftGenerationResponse>({
        path: `crmAssistant/customers/${customerId}/follow-up-draft`,
        method: 'POST',
        json: {
          goal: goal.trim(),
          selectedModel: { modelService: chosen.service, model: chosen.model },
        },
      });
      setResult(response.data);
      setChannel(response.data.draft.channel);
      setContent(response.data.draft.draftContent);
      setNextStep(response.data.draft.suggestedNextStep);
    } catch (error) {
      setGenerateError(
        error instanceof Error
          ? error.message
          : t('crmAssistant.generateFailed'),
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveFollowUp = async () => {
    if (!content.trim()) {
      setSaveError(t('crm.required'));
      return;
    }
    setSaveError(null);
    try {
      const saved = await submission.run(
        { channel, content: content.trim(), nextStep: nextStep.trim() },
        async (key, signal, values) =>
          api.request({
            path: `crm/customers/${customerId}/followUps`,
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
            json: values,
          }),
      );
      if (!saved) return;
      setSavedNotice(true);
      toaster.show({ type: 'success', title: t('crmAssistant.draftSaved') });
      reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('crm.failed'));
    }
  };

  if (modelsRequest.loading && !modelsRequest.data) return <Loading />;
  if (modelsRequest.error)
    return (
      <ReadError error={modelsRequest.error} retry={modelsRequest.reload} />
    );

  const canSave = recordAccess.allowed && (result?.canSaveFollowUp ?? true);

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('crmAssistant.title')}</CardTitle>
          <CardDescription>{t('crmAssistant.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {modelChoices.length === 0 ? (
            <Alert>
              <AlertTitle>{t('crmAssistant.noModelTitle')}</AlertTitle>
              <AlertDescription>
                {t('crmAssistant.noModelDescription')}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor={`${formId}-model`}>
                    {t('crmAssistant.model')}
                  </Label>
                  <select
                    id={`${formId}-model`}
                    value={effectiveSelectedKey}
                    onChange={(event) => setSelectedKey(event.target.value)}
                    disabled={generating}
                    className='flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'
                  >
                    {modelChoices.map((choice) => (
                      <option key={choice.key} value={choice.key}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor={`${formId}-goal`}>
                  {t('crmAssistant.goal')}
                </Label>
                <Textarea
                  id={`${formId}-goal`}
                  rows={2}
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder={t('crmAssistant.goalPlaceholder')}
                  disabled={generating}
                />
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                <PendingButton
                  type='button'
                  busy={generating}
                  pendingLabel={t('crmAssistant.generating')}
                  onClick={() => void handleGenerate()}
                >
                  {t('crmAssistant.generate')}
                </PendingButton>
                <p className='text-xs text-muted-foreground'>
                  {t('crmAssistant.readOnlyBoundary')}
                </p>
              </div>
            </>
          )}

          {generateError ? (
            <Alert variant='destructive'>
              <AlertDescription>{generateError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>{t('crmAssistant.briefTitle')}</CardTitle>
              <CardDescription>
                {t('crmAssistant.generatedBy', {
                  model: `${result.model.modelService}/${result.model.model}`,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-1'>
                <h3 className='text-sm font-medium'>
                  {t('crmAssistant.summary')}
                </h3>
                <p className='whitespace-pre-wrap text-sm text-muted-foreground'>
                  {result.draft.summary}
                </p>
              </div>

              <div className='space-y-1'>
                <h3 className='text-sm font-medium'>
                  {t('crmAssistant.suggestedNextStep')}
                </h3>
                <p className='whitespace-pre-wrap text-sm'>
                  {result.draft.suggestedNextStep}
                </p>
              </div>

              <div className='space-y-2'>
                <h3 className='text-sm font-medium'>
                  {t('crmAssistant.citations')}
                </h3>
                {result.draft.citations.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('crmAssistant.noCitations')}
                  </p>
                ) : (
                  <ul className='space-y-2'>
                    {result.draft.citations.map((citation) => (
                      <li
                        key={`${citation.docId}-${citation.version}-${citation.title}`}
                        className='rounded-md border p-3 text-sm'
                      >
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>{citation.title}</span>
                          <Badge variant='secondary'>v{citation.version}</Badge>
                        </div>
                        {citation.excerpt ? (
                          <p className='mt-1 text-xs text-muted-foreground'>
                            {citation.excerpt}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {result.draft.missingEvidence.length > 0 ? (
                <Alert>
                  <AlertTitle>{t('crmAssistant.missingEvidence')}</AlertTitle>
                  <AlertDescription>
                    <ul className='mt-1 list-disc space-y-1 pl-4 text-sm'>
                      {result.draft.missingEvidence.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('crmAssistant.draftTitle')}</CardTitle>
              <CardDescription>{t('crmAssistant.draftHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!canSave ? (
                <Alert>
                  <AlertDescription>
                    {t('crmAssistant.readOnlySaveNotice')}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className='space-y-2'>
                <Label htmlFor={`${formId}-channel`}>{t('crm.channel')}</Label>
                <Choice
                  id={`${formId}-channel`}
                  label={t('crm.channel')}
                  value={channel}
                  values={['call', 'email', 'meeting', 'note']}
                  onChange={(value) =>
                    setChannel(value as 'call' | 'email' | 'meeting' | 'note')
                  }
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor={`${formId}-content`}>{t('crm.content')}</Label>
                <Textarea
                  id={`${formId}-content`}
                  rows={5}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  disabled={!canSave || submission.submitting}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor={`${formId}-nextStep`}>
                  {t('crm.nextStep')}
                </Label>
                <Textarea
                  id={`${formId}-nextStep`}
                  rows={2}
                  value={nextStep}
                  onChange={(event) => setNextStep(event.target.value)}
                  disabled={!canSave || submission.submitting}
                />
              </div>

              {saveError ? (
                <Alert variant='destructive'>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              ) : null}

              {savedNotice ? (
                <Alert>
                  <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
                    <span>{t('crmAssistant.draftSaved')}</span>
                    <Button
                      size='sm'
                      variant='outline'
                      nativeButton={false}
                      render={<Link to='../followUps' relative='path' />}
                    >
                      {t('crmAssistant.viewFollowUps')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {canSave ? (
                <div className='flex flex-wrap items-center gap-2'>
                  <PendingButton
                    type='button'
                    busy={submission.submitting}
                    pendingLabel={t('crm.saving')}
                    onClick={() => void handleSaveFollowUp()}
                  >
                    {t('crmAssistant.saveDraft')}
                  </PendingButton>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
