# Lesson 2 · Manage customers and follow-up records

Start: `lesson-1`. Finish: `lesson-2`.
Compare: `git diff lesson-1..lesson-2`.

## Business scope

Use **Customers** to search by name, filter Prospect / Customer / Inactive and
page through the results. Create a customer, open its name, edit the overview,
add contacts and record conversations with a next step. Reload the detail to
confirm the records are persisted. Status is a customer classification, not an
approval process. Customers can be made Inactive instead of deleted. Follow-ups
are append-only, with the author and timestamp supplied by the server.

The quick-start uses one shared learning dataset. Only the initial administrator
has access by default. Explicitly granting the Customers page also grants this
starter dataset's read/write operations. Do not use this simplified model for a
sales team with separate data scopes; Lesson 6 introduces the business permission
model. User and permission administration are available in System settings.

## Independent installation

Follow [Lesson 1](lesson-1.md), then load the optional English sample data:

```sh
pnpm nocobase db sample --json
pnpm dev
```

For a brand-new database, `APP_SAMPLE_DATA=true pnpm dev` loads samples on first
installation. Otherwise use `db sample` after startup has installed the schema.
There are three sample customers: Northstar Labs, Harbor Design and Willow
Retail, each with a contact and a follow-up. Stable sample ids preserve existing
edits. Sample data is optional and is not required for production.

## Upgrade from Lesson 1

Stop the application, back up its database, configuration and storage, then:

```sh
git switch --detach lesson-2
pnpm install --frozen-lockfile
pnpm nocobase db apply --dry-run --json
pnpm nocobase db apply --json
pnpm nocobase db sample --json  # optional development sample data
pnpm dev
```

The migration only adds the three CRM tables; existing users, sessions and
settings are preserved. For continued development create your own branch with
`git switch -c my-crm lesson-2`. Never use database reset to upgrade. Checking out
Lesson 1 again does not remove the CRM tables or restore a previous database.

## Core capabilities used

- Collection Builder migrations, foreign keys, indexes and Repository persistence.
- Native authentication and authorization checks on every CRM endpoint.
- Validated and documented APIs, pagination and atomic idempotency receipts.
- Application routes, child-route forms, DataTable, translation resources and
  form feedback. Components come from the installed application UI library.

## Acceptance scenarios

1. Create **Summit Analytics**, industry **Data services**. Its name is required.
2. Find it by searching **summit**, open it, change its notes and save.
3. Add **Alex Morgan**, job title **Sales Lead**, email **alex@example.com**.
4. Record a Call: **Discussed the sales team requirements.** Next step:
   **Prepare a product walkthrough.**
5. Reload. The customer, contact, author, time and follow-up remain visible.
6. Filter by Inactive; the new prospect is excluded. Clear filters to restore it.
7. Invalid email, blank customer name or blank follow-up summary is rejected.
8. An unauthenticated caller gets 401; an ordinary user without CRM access gets
   403 for reads and writes. A contact cannot be moved or edited through another
   customer's endpoint. Repeating a write with the same operation key creates
   only one record.

Automated coverage lives in `tests/server/crm.test.ts`,
`tests/database/crm-migration.test.ts`, `tests/client/crm.test.tsx` and
`tests/playwright/crm.test.ts`. Browser tests deliberately create a uniquely
named Summit Analytics acceptance record; use a disposable learning installation
for repeated runs. Lesson 3 documents the validation and delivery process.

## Executed verification (2026-11-10)

- 27 targeted Vitest cases passed: CRM API (4), migration reversal (1),
  authorization assignment guard (2), CRM pages (5), route contracts (8) and
  permission titles (7).
- Chromium completed customer creation, editing, contact creation, follow-up,
  search and reload against the real server; no page errors.
- Inspected desktop detail and a 375px follow-up form; captured light/dark and
  narrow-screen evidence under the ignored `storage/verification/` directory.
- Client, server and CLI/browser-test TypeScript projects passed. Changed source
  passed ESLint; the UI component checker reported no findings or exceptions.
- Optional sample data loaded successfully. Package sourcemap and global pnpm
  configuration warnings remain upstream/environment warnings.
