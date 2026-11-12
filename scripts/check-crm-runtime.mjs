// Read-only runtime acceptance. Credentials come only from the calling environment.
const entry = process.env.APP_URL;
if (!entry)
  throw new Error(
    'Set APP_URL to the application entry, including its base path.',
  );
const base = new URL(`${entry.replace(/\/+$/, '')}/`);
const get = async (path, headers = {}) => {
  const response = await fetch(new URL(path, base), {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
};
const health = await (await get('api/healthz')).json();
if (health.ok !== true) throw new Error('Health response is not ready.');
await get('customers');
const unauthenticated = await fetch(new URL('api/crm/customers', base));
if (unauthenticated.status !== 401)
  throw new Error('Anonymous CRM access was not rejected.');
const password = process.env.E2E_PASSWORD;
const email = process.env.E2E_EMAIL;
if (!password || !email)
  throw new Error(
    'Set E2E_EMAIL and E2E_PASSWORD for the read-only business verification.',
  );
const signIn = await fetch(new URL('api/auth/sign-in/email', base), {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base.origin },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) throw new Error(`Sign-in: HTTP ${signIn.status}`);
const headers = {
  cookie: signIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; '),
};
const list = await (
  await get('api/crm/customers?pageSize=100', headers)
).json();
const expected = process.env.CRM_EXPECT_CUSTOMER;
if (expected && !list.data.some((row) => row.name === expected))
  throw new Error(`Expected customer was not found: ${expected}`);
const swagger = await (await get('api/swagger', headers)).json();
if (!Object.keys(swagger.paths).some((path) => path.endsWith('/crm/customers')))
  throw new Error('CRM API is missing from OpenAPI.');
console.log(
  JSON.stringify({
    ok: true,
    url: base.href,
    customers: list.meta.total,
    authenticatedApi: true,
    anonymousDenied: true,
    openApi: true,
  }),
);
