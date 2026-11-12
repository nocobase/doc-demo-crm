import { expect, test } from '@playwright/test';

const entry = process.env.APP_URL;
if (!entry)
  throw new Error(
    'Set APP_URL to a dedicated learning or test application, including its base path.',
  );
const appUrl = new URL(`${entry.replace(/\/+$/, '')}/`);
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!username || !password)
  throw new Error('Set E2E_USERNAME and E2E_PASSWORD for the test account.');

test('customer → contact → follow-up → search survives a browser reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const name = `Summit Analytics ${Date.now()}`;
  await page.goto(new URL('login', appUrl).href);
  await page.getByLabel('Username or email').fill(username!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto(new URL('customers', appUrl).href);
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  const customerDialog = page.getByRole('dialog', {
    name: 'New customer',
    exact: true,
  });
  await customerDialog.getByLabel('Customer name').pressSequentially(name);
  await customerDialog.getByLabel('Industry').fill('Analytics');
  await customerDialog
    .getByLabel('Notes')
    .fill('Acceptance record: interested in centralizing customer follow-up.');
  await customerDialog
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(customerDialog).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Search customers by name' })
    .fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Edit customer', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Edit customer', exact: true })
    .getByLabel('Industry')
    .fill('Data services');
  await page
    .getByRole('dialog', { name: 'Edit customer', exact: true })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByText('Data services', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add contact', exact: true })
    .getByLabel('Contact name')
    .fill('Alex Morgan');
  await page
    .getByRole('dialog', { name: 'Add contact', exact: true })
    .getByLabel('Email', { exact: true })
    .fill('alex@example.com');
  await page
    .getByRole('dialog', { name: 'Add contact', exact: true })
    .getByLabel('Job title')
    .fill('Sales Lead');
  await page
    .getByRole('dialog', { name: 'Add contact', exact: true })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Record follow-up', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Record follow-up', exact: true })
    .getByLabel('Summary')
    .fill('Discussed the sales team requirements.');
  await page
    .getByRole('dialog', { name: 'Record follow-up', exact: true })
    .getByLabel('Next step')
    .fill('Prepare a product walkthrough.');
  await page
    .getByRole('dialog', { name: 'Record follow-up', exact: true })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(
    page.getByText('Discussed the sales team requirements.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Prepare a product walkthrough.', { exact: true }),
  ).toBeVisible();
  const health = await page.request.get(new URL('api/healthz', appUrl).href);
  expect(health.ok()).toBe(true);
  expect(errors).toEqual([]);
});
