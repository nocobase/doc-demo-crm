import { Navigate, useLocation, useMatch } from 'react-router';

export default function NotificationKindsRedirect() {
  const location = useLocation();
  const detail = useMatch('/settings/notifications/templates/:templateId');
  const query = new URLSearchParams(location.search);
  const id = detail?.params.templateId ?? query.get('template');
  query.delete('template');
  query.set('tab', 'kinds');
  if (id) query.set('kindId', id);
  return (
    <Navigate
      replace
      to={{
        pathname: '/settings/notifications',
        search: query.toString(),
        hash: location.hash,
      }}
    />
  );
}
