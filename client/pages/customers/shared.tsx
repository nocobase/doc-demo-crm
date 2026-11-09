import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';

export function ReadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { t } = useTranslation();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {t(
          status === 401
            ? 'crm.expired'
            : status === 403
              ? 'crm.denied'
              : status === 404
                ? 'crm.missing'
                : 'crm.failed',
        )}
        {status === 401 ? (
          <Link to='/login'>{t('crm.signIn')}</Link>
        ) : ![403, 404].includes(status) ? (
          <Button variant='outline' onClick={retry}>
            {t('crm.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function Choice({
  value,
  values,
  onChange,
  label,
  id,
}: {
  value: string;
  values: string[];
  onChange: (value: string) => void;
  label: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const items = values.map((v) => ({ value: v, label: t(`crm.${v}`) }));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v);
      }}
    >
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
