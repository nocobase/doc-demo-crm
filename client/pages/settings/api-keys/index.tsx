import { copyText, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Copy, KeyRound, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { PendingButton } from '#components/pending-button';
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
import { useListData } from '#hooks/use-list-data';
import { ReadError } from '../../customers/shared.js';

type LocalizedText = string | { key: string; ns?: string };

interface KeyScopeGroupView {
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  levels: ('read' | 'write' | 'admin')[];
  held: Partial<Record<'read' | 'write' | 'admin', boolean>>;
}

interface KeyScopePresetView {
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  groups: Record<string, { level: 'read' | 'write' | 'admin' }>;
  expiresInDays: number | null;
}

interface ScopeOptionsResponse {
  data: {
    groups: KeyScopeGroupView[];
    presets: KeyScopePresetView[];
    defaultExpiresInDays: number;
    mayCreate?: boolean;
  };
}

interface ApiKeyView {
  id: string;
  name: string | null;
  description: string | null;
  start: string | null;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  scope: {
    groups: Record<string, { level: string }>;
  } | null;
}

export default function ApiKeysSettingsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const options = useListData<ScopeOptionsResponse>('apiKeys/scopeOptions');
  const keys = useListData<{ data: ApiKeyView[] }>('apiKeys');

  const [name, setName] = useState('External lead capture');
  const [description, setDescription] = useState(
    'Scoped key for website lead form and ERP sync',
  );
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [selectedLevels, setSelectedLevels] = useState<
    Record<string, 'none' | 'read' | 'write'>
  >({
    'crm.leads': 'write',
    'crm.integrations': 'none',
  });
  const [busy, setBusy] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const labelOf = (text: LocalizedText | null | undefined) => {
    if (!text) return '';
    return typeof text === 'string' ? text : t(text.key);
  };

  const applyPreset = (preset: KeyScopePresetView) => {
    const next: Record<string, 'none' | 'read' | 'write'> = {};
    for (const group of options.data?.data.groups ?? []) {
      const target = preset.groups[group.id]?.level;
      next[group.id] =
        target === 'read' || target === 'write' ? target : 'none';
    }
    setSelectedLevels(next);
    if (preset.expiresInDays) {
      setExpiresInDays(String(preset.expiresInDays));
    }
    setName(labelOf(preset.title));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    const groups: Record<string, { level: 'read' | 'write' }> = {};
    for (const [groupId, level] of Object.entries(selectedLevels)) {
      if (level !== 'none') groups[groupId] = { level };
    }
    if (Object.keys(groups).length === 0) {
      setErrorMessage(t('integrations.selectAtLeastOneScope'));
      return;
    }
    setBusy(true);
    try {
      const response = await api.request<{
        data: { key: ApiKeyView; secret: string };
      }>({
        path: 'apiKeys',
        method: 'POST',
        json: {
          name: name.trim(),
          description: description.trim() || null,
          expiresInDays: Number(expiresInDays),
          scope: { groups },
        },
      });
      setRevealedSecret({
        name: response.data.key.name ?? name,
        secret: response.data.secret,
      });
      setCopied(false);
      keys.reload();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t('integrations.createKeyFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async (key: ApiKeyView) => {
    setErrorMessage(null);
    try {
      const response = await api.request<{
        data: { key: ApiKeyView; secret: string };
      }>({
        path: `apiKeys/${key.id}/rotate`,
        method: 'POST',
      });
      setRevealedSecret({
        name: response.data.key.name ?? key.id,
        secret: response.data.secret,
      });
      setCopied(false);
      keys.reload();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t('integrations.rotateKeyFailed'),
      );
    }
  };

  const handleRevoke = async (keyId: string) => {
    setErrorMessage(null);
    try {
      await api.request({ path: `apiKeys/${keyId}`, method: 'DELETE' });
      keys.reload();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t('integrations.revokeKeyFailed'),
      );
    }
  };

  const scopeGroups = options.data?.data.groups ?? [];
  const presets = options.data?.data.presets ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t('integrations.apiKeysTitle')}
        description={t('integrations.apiKeysDescription')}
      />

      {revealedSecret ? (
        <Alert>
          <KeyRound className='size-4' />
          <AlertTitle>
            {t('integrations.secretCreatedTitle')}: {revealedSecret.name}
          </AlertTitle>
          <AlertDescription className='mt-2 space-y-2'>
            <p className='text-sm'>{t('integrations.secretOnceHint')}</p>
            <div className='flex flex-wrap items-center gap-2'>
              <code className='rounded bg-muted px-2 py-1 font-mono text-xs break-all'>
                {revealedSecret.secret}
              </code>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  void copyText(revealedSecret.secret).then((ok) => {
                    if (ok) setCopied(true);
                  });
                }}
              >
                <Copy className='mr-1 size-3.5' />
                {copied ? t('integrations.copied') : t('integrations.copy')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.createKeyTitle')}</CardTitle>
          <CardDescription>{t('integrations.createKeyHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {options.error ? (
            <ReadError error={options.error} retry={options.reload} />
          ) : (
            <form className='space-y-4' onSubmit={(e) => void handleCreate(e)}>
              {presets.length > 0 ? (
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm text-muted-foreground'>
                    {t('integrations.presets')}:
                  </span>
                  {presets.map((preset) => (
                    <Button
                      key={preset.id}
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() => applyPreset(preset)}
                    >
                      {labelOf(preset.title)}
                    </Button>
                  ))}
                </div>
              ) : null}

              <div className='grid gap-4 md:grid-cols-3'>
                <div className='space-y-2'>
                  <Label htmlFor='apikey-name'>
                    {t('integrations.keyName')}
                  </Label>
                  <Input
                    id='apikey-name'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='apikey-desc'>
                    {t('integrations.keyDescription')}
                  </Label>
                  <Input
                    id='apikey-desc'
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                  />
                </div>
                <div className='space-y-2'>
                  <Label>{t('integrations.expiryDays')}</Label>
                  <Select
                    value={expiresInDays}
                    onValueChange={(value) => {
                      if (value) setExpiresInDays(value);
                    }}
                  >
                    <SelectTrigger className='w-full'>
                      <SelectValue>{expiresInDays} days</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='30'>30 days</SelectItem>
                      <SelectItem value='90'>90 days</SelectItem>
                      <SelectItem value='365'>365 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className='space-y-3'>
                <Label>{t('integrations.scopeGroups')}</Label>
                <div className='grid gap-3 md:grid-cols-2'>
                  {scopeGroups.map((group) => (
                    <div
                      key={group.id}
                      className='flex items-center justify-between gap-4 rounded-md border p-3'
                    >
                      <div className='space-y-0.5'>
                        <div className='text-sm font-medium'>
                          {labelOf(group.title)}
                        </div>
                        <div className='text-xs text-muted-foreground'>
                          {labelOf(group.description)}
                        </div>
                      </div>
                      <Select
                        value={selectedLevels[group.id] ?? 'none'}
                        onValueChange={(value) => {
                          if (
                            value === 'none' ||
                            value === 'read' ||
                            value === 'write'
                          ) {
                            setSelectedLevels((prev) => ({
                              ...prev,
                              [group.id]: value,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger className='w-32'>
                          <SelectValue>
                            {(selectedLevels[group.id] ?? 'none') === 'none'
                              ? t('integrations.levelNone')
                              : (selectedLevels[group.id] ?? 'none') === 'read'
                                ? t('integrations.levelRead')
                                : t('integrations.levelWrite')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>
                            {t('integrations.levelNone')}
                          </SelectItem>
                          {group.levels.includes('read') ? (
                            <SelectItem
                              value='read'
                              disabled={group.held.read === false}
                            >
                              {t('integrations.levelRead')}
                            </SelectItem>
                          ) : null}
                          {group.levels.includes('write') ? (
                            <SelectItem
                              value='write'
                              disabled={group.held.write === false}
                            >
                              {t('integrations.levelWrite')}
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {errorMessage ? (
                <Alert variant='destructive'>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}

              <PendingButton type='submit' busy={busy}>
                <KeyRound className='mr-2 size-4' />
                {t('integrations.issueKey')}
              </PendingButton>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.myKeysTitle')}</CardTitle>
          <CardDescription>{t('integrations.myKeysHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {keys.error ? (
            <ReadError error={keys.error} retry={keys.reload} />
          ) : (keys.data?.data.length ?? 0) === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('integrations.noKeys')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('integrations.keyName')}</TableHead>
                  <TableHead>{t('integrations.keyPrefix')}</TableHead>
                  <TableHead>{t('integrations.scopeGroups')}</TableHead>
                  <TableHead>{t('integrations.expiresAt')}</TableHead>
                  <TableHead>{t('integrations.status')}</TableHead>
                  <TableHead className='text-right'>
                    {t('integrations.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.data!.data.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className='font-medium'>{key.name ?? '—'}</div>
                      {key.description ? (
                        <div className='text-xs text-muted-foreground'>
                          {key.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {key.start ? `${key.start}…` : '—'}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {key.scope
                        ? Object.entries(key.scope.groups)
                            .map(([id, grant]) => `${id}: ${grant.level}`)
                            .join(', ')
                        : t('integrations.fullAccountScope')}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {key.expiresAt
                        ? new Date(key.expiresAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={key.enabled ? 'success' : 'neutral'}>
                        {key.enabled
                          ? t('integrations.active')
                          : t('integrations.disabled')}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => void handleRotate(key)}
                        >
                          <RotateCw className='mr-1 size-3.5' />
                          {t('integrations.rotate')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => void handleRevoke(key.id)}
                        >
                          <Trash2 className='mr-1 size-3.5' />
                          {t('integrations.revoke')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
