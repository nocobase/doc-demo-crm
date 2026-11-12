# Lesson 5 — Opportunities and quote data modeling

Start at `lesson-4`; the completed stage is `lesson-5`. This stage adds products, customer opportunities, quotes and quote lines while retaining customers, contacts and follow-ups. The interface and sample data are English.

## Staged development requests

Use the three requests in [Lesson 5 of the course](https://docs.nocobase.com/guides/opportunities-and-quotes/): model the relationships and fields, confirm and generate migrations, then connect quote saving and pages. The [ER model and dictionary](sales-model.md) describe the implemented Lesson 5 fields and distinguish database constraints from save-time validation.

These staged requests were introduced during the lesson rewrite. They are reader instructions, not a transcript of the original implementation run. The original single-request implementation and its historical verification below predate this rewrite; those results do not establish an independent replay of the new requests.

## Run from an empty installation

Use Node.js 24 or later and the package-manager version declared in `package.json`. Follow the root README to install locked dependencies, initialize and check the application's configuration, and provide your own initial administrator credentials. Start with `pnpm dev` and open the exact `Local:` URL it prints, including the application base path.

Development sample seeds add three products and, when the existing Northstar Labs sample customer is present, one opportunity and a two-line quote. To load samples deliberately on a development installation that skipped them, use `pnpm nocobase db sample`. The samples use stable IDs and preserve edits when rerun.

## Upgrade from Lesson 4

Keep the current configuration, database and file storage. Back up the database, install this stage's locked dependencies, preview with `pnpm nocobase db apply --dry-run`, then run `pnpm nocobase db apply`. The two new migrations create four sales tables and add Collection relationship metadata. They do not replace or clear the customer tables. Starting the development server also applies pending migrations.

Switching a Git tag does not undo database migrations. Use a separate database for experimenting with an earlier tag or migration rollback.

## Explore the model

1. Open **Products** to create a product or edit its current unit price. Product codes are unique.
2. Open **Customers → Northstar Labs** and choose **New opportunity**, or open the seeded **Northstar sales workspace**.
3. Create a quote with one or more products. The initial line price comes from the catalogue and can be changed for that quote. Enter quantity and the percentage discount; `10` means ten percent off.
4. Save and open the quote. The seeded **Northstar team rollout** contains 12 licenses at $120 with 10% off ($1,296) plus one $800 workshop, totaling **$2,096**.
5. For the course exercise, set Team workspace license (`TEAM-LICENSE`) to $100 and Onboarding workshop (`ONBOARDING`) to $250. Create **Annual rollout proposal** with 10 licenses at 10% off and one workshop without a discount: total $1,150.
6. Predict the result before changing the license catalog price to $120. Reopen the saved quote: its license price must remain $100 and its total $1,150.
7. Create **Repriced rollout check** with the same quantities and discounts, selecting the products again. It must use $120 for licenses and total $1,330.
8. Edit the old quote to 12 licenses without changing its saved price: total $1,330. Restore its quantity to 10 and verify $1,150 after reloading. Keep this old quote for the following lessons.

The customer-to-opportunity, opportunity-to-quote and quote-to-line links are physical foreign keys and Collection `hasMany`/`belongsTo` metadata. Business endpoints use the Repository and validate each parent relationship. The UI reuses the installed DataTable, route dialogs, form feedback, submission controller and shadcn controls.

Amounts use USD in this tutorial, without tax or currency conversion. Quantities are whole numbers from 1 to 10,000. A unit price is between $0 and $100,000 with at most two decimals; a discount is between 0% and 100% with at most two decimals. Up to 100 lines are allowed. The server calculates each line using integer cents and discount basis points, rounds half-up to cents, then sums the rounded lines. It rejects client-supplied totals.

A product may appear on multiple lines at different quoted prices. Quote edits send the saved unit price explicitly for every line; omitting it on an update is rejected rather than silently substituting today's catalogue price. Product names and codes are also copied onto the line. No deletion, approval or workflow transitions are introduced here; the opportunity stage is a classification.

## Verify

Run the affected tests:

```bash
pnpm exec vitest run tests/server/sales.test.ts tests/server/sales-price-exercise.test.ts tests/server/crm.test.ts tests/database/sales-migration.test.ts tests/client/sales.test.tsx tests/client/crm.test.tsx tests/client/page-permission-titles.test.ts
pnpm exec vitest run tests/client/client-routes.test.ts
```

They cover anonymous and unauthorized access, parent association boundaries, multiple prices for the same product, fractional rounding, product repricing, quote edits, invalid quantities and discounts, duplicate product codes, repeated submission receipts, failed quote writes, sample reruns, migration up/down/reapply, retained CRM behavior, product search, saving and rejected drafts. Database tests use isolated SQLite databases; other database dialects are not verified by these runs.

Browser acceptance should also create a product, open a customer opportunity, add and edit a quote, follow breadcrumbs back, and reload the saved result. Check the prior customer, contact and follow-up records after the upgrade. Test results and screenshots are evidence for their exercised scenarios, not a substitute for this interactive acceptance.

## Historical verification record

The lesson's six targeted test files passed **27 tests** on SQLite. The separate route registration and authorization suite passed **9 tests**, including the nine added sales routes. The client and server TypeScript projects, targeted ESLint checks and the UI component checker also passed (seven client source files, no component findings).

Browser acceptance on the isolated development database verified:

- Editing a product and saving returns to **Products** and displays the new $125 price.
- **New quote → Add product**, quantity 2 and 10% discount saves a **$225** quote; opening and refreshing retain that result.
- Editing a saved quote quantity from 10 to 12 and back changes its total from **$1,150 → $1,330 → $1,150**, with the final total retained after refresh.
- These flows produced no page errors. The tutorial screenshots use the English interface at a 1440 × 900 CSS-pixel viewport with device scale factor 2.

Test credentials, browser sessions and the disposable database are private runtime artifacts and are not committed.
