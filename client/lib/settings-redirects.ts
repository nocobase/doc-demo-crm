/**
 * Settings pages that lived outside `/settings` before `defineSystemSettingsRoutes()` mounted them there; the shared router
 * redirects each one. CRM bookmarks keep pointing to the corresponding workflow and its history.
 * Each former prefix keeps working for bookmarks and links, with the rest of the path, the query and the hash. Route
 * definitions reject wildcards, so the redirects are plain router entries; the destination's own guards still apply.
 */
export const SETTINGS_REDIRECTS: readonly (readonly [string, string])[] = [
  ['/settings/crm-schedules', '/settings/automation/schedules'],
  ['/settings/mail-administration', '/settings/mail'],
  ['/settings/quote-workflows/definitions', '/settings/workflows/definitions'],
  ['/settings/quote-workflows/executions', '/settings/workflows/executions'],
  ['/settings/quote-workflows', '/settings/workflows/definitions'],
];

/** Where a former settings URL lives now, or `undefined` when it is not one. */
export function settingsRedirectTarget(pathname: string): string | undefined {
  for (const [from, to] of SETTINGS_REDIRECTS) {
    if (pathname === from || pathname.startsWith(`${from}/`))
      return `${to}${pathname.slice(from.length)}`;
  }
  return undefined;
}
