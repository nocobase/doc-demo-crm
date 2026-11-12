# Lesson 6 — Sales workspace UI

Start from `lesson-5`; this lesson finishes at `lesson-6`. It adds a sales
workspace and URL-backed customer tabs without changing database schema or
quote calculations. Read [the cumulative business design](design.md) for scope.

## Request sent to the development Agent

The development Agent implemented this exact tutorial request:

```text
把现有 CRM 整理成销售日常使用的工作台。沿用应用现有风格，用 UI Library 组合页面。工作台展示客户、商机和报价概况，以及最近的跟进记录，能直接打开对应客户或商机。客户列表支持按名称搜索和状态筛选；客户详情用标签页组织资料、联系人、跟进和商机，并能继续查看报价。保留现有录入和编辑能力，让加载中、没有数据和请求失败时的反馈清楚，在窄屏上也能完成查看和返回。
```

## Run a fresh checkout

Use Node.js 24 or later and the repository's pnpm version. In a separate
checkout, create your learning branch from `lesson-6`, then run:

```sh
pnpm install --frozen-lockfile
pnpm nocobase config init --dialect sqlite
pnpm nocobase config check
APP_SAMPLE_DATA=true pnpm dev
```

SQLite is the verified local setup, not a requirement for the feature. Keep the
server running and open its printed `Local:` URL, including the application
base path. Sign in with the administrator from your configuration. On a fresh
database, `APP_SAMPLE_DATA=true` loads the existing CRM and sales samples.

Open **Sales workspace**. Counts include all records currently accessible at
this stage, while each recent-record table shows at most five rows. Select a
customer to open Overview, Contacts, Follow-up records or Opportunities. Recent
follow-up links open that customer's follow-up tab; opportunity and quote links
open their actual record URLs.

## Upgrade from Lesson 5

Stop the previous process and back up your configuration and database. Keep
both when moving your learning branch to the Lesson 6 changes. Install the
locked dependencies and run `pnpm dev` again. There is no new migration or seed
in this lesson. Do not reset the database to apply a UI update.

Existing `/customers/:id/details` links redirect to Overview. Previous direct
form URLs and opportunity/quote URLs still work. New tab-specific form URLs
return to the tab that opened them after saving or cancelling. Browser reload
and back/forward preserve the selected tab through the URL.

## Component and data boundaries

The feature composes the installed `PageContainer`, `PageHeader`, `DataTable`,
`RecordLink`, `StatusBadge`, `Card`, `Tabs`, and existing route forms. No shell,
primitive, theme or database schema is replaced. The original customer list
keeps URL-backed search, status filtering and pagination.

`GET /api/crm/workspace` requires authentication and the existing customer page
permission. Repository counts give totals; limited queries give recent rows.
Opportunity and quote previews use the existing Collection relationships.
Related customer names for at most five follow-ups are resolved individually;
this avoids adding a schema migration to a UI-only stage. Role and record-level
scoping arrives in Lesson 7. No business permission is automatically granted to
all signed-in users.

## Verification

Run the focused suites from the application root:

```sh
pnpm exec vitest run tests/server/workspace.test.ts tests/client/workspace.test.tsx tests/client/crm.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts
```

The API tests use isolated databases. They check anonymous and unassigned-user
rejection, empty results, accurate counts with more than five records, limited
recent lists, associated names and IDs, quote amounts, and unchanged row counts.
Component tests cover working record links, pending/error/retry states, Chinese
empty-state text, combined customer filters, no matches, clearing filters,
customer tabs, and saving a direct contact form back to Contacts.

For browser regression, start a dedicated test application and set `APP_URL`
to its printed URL, plus `E2E_USERNAME` and `E2E_PASSWORD` for a test user:

```sh
pnpm exec playwright test tests/playwright/crm.test.ts
```

This creates a recognizable **Summit Analytics** record and related data. The
flow retains the earlier create/edit/contact/follow-up/search/reload assertions
and now checks selected tabs after reload and browser back.

The actual development application was exercised in Chromium on 2026-11-12:
workspace summaries and quote links; combined customer name/status filtering;
Contacts/Follow-up records/Opportunities navigation; saving a follow-up and
returning to the same tab; reload persistence; opportunity-to-quote navigation;
no search results; a controlled HTTP 503 followed by successful Retry; and
390px-width tab navigation and browser back. There was no horizontal page
overflow and no page errors. These browser checks used the shared isolated
learning database and retained the original customers and sales records.

English screenshots `sales-workspace.png` and `customer-workspace.png` were
captured at a 1440 × 900 CSS viewport with device scale 2 and visually inspected.
They are included in the corresponding tutorial in `website-v3`, not as
runtime state in this application repository.

| Check                                                                         | Result                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Focused Vitest suites listed above                                            | 5 files, 28 tests passed                                                 |
| Client, server and CLI/browser TypeScript projects                            | Passed                                                                   |
| ESLint on changed source and tests                                            | Passed with zero warnings                                                |
| Prettier on changed source, tests and design/run documents                    | Passed                                                                   |
| UI component checker on the changed customer, sales-list and workspace source | 5 source files, zero findings, zero exceptions                           |
| Actual CRM Playwright regression                                              | 1 test passed, including retained business assertions and tab navigation |
| Actual workspace/tab acceptance described above                               | Passed; no page errors                                                   |

The checks cover this stage and affected consumers. Other application modules,
other database engines, and production deployment were not revalidated for this
UI change.
