import { MailWorkspacePage } from '@nocobase/app-plugin-mail/client';
import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
export default function Workspace() {
  const { t } = useTranslation();
  return (
    <MailWorkspacePage
      accountsHref='/mail/accounts'
      headerActions={
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to='/mail/logs' />}
        >
          {t('crmMail.logs')}
        </Button>
      }
    />
  );
}
