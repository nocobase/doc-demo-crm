# Lesson 8 · Quote approvals and tasks

On the complete CRM example, start with a saved draft under a customer you own. For an upgrade from `lesson-7`, this stage adds an immutable quotation approval snapshot, native Approval/Task Center integration and authorized workflow settings. Existing CRM records and role assignments remain intact.

## Installation and upgrade

Back up the prior database, configuration and storage before upgrading. Install locked dependencies and apply migrations:

```sh
pnpm install --frozen-lockfile
pnpm nocobase db apply --dry-run --json
pnpm nocobase db apply --json
pnpm dev
```

Use the printed `Local:` URL. The registered approval and task-center packages require registry access; resolve installation access before continuing. The app does not configure an AI model for approval assistance.

Migration `202611150001_quote_approvals` is deliberately forward-only. Removing its quote revision column causes SQLite to rebuild a referenced quote table and fails with retained quote lines. A retained-data test verifies the forward upgrade; rollback requires restoring a matching database backup, not switching Git tags. Earlier stage migrations remain unchanged.

## Try the process

Assign Sales and Sales manager roles to named test accounts through existing Users settings. No wildcard assignment is added. Create a customer owned by the salesperson, an opportunity, a product and a quotation. A line discount strictly above10% requires an active selected manager other than the applicant. At or below10%, submission confirms without a review task.

Submit from the quotation dialog. As the selected manager, open My tasks and the quotation. Approve, reject with a reason or return with a reason. Return permits editing and resubmission, with retained history and a fresh task. Withdrawal cancels the current task and restores Draft. Confirmed and rejected quotations are final; create another for a new proposal. After approval, reopen the quote as the salesperson. Check the decision, the Confirmed state and the absence of Edit quote. This completes the approval exercise.

Every action requires current customer scope. A manager must also retain the quotation operation permission; manager membership alone is insufficient. Unrelated users and read-only shares cannot decide. A removed reviewer cannot act. The applicant or another currently authorized manager may withdraw for recovery. After ownership transfer, the former applicant loses access and the new owner creates a new quotation rather than impersonating them.

Workflow management under System settings shows the native diagram, versioned threshold configuration and execution history. Its read/configure permissions are independent of sales roles. First submission pins the threshold for the quotation, including later returns/resubmissions. Native Task Center filters persist while its parent page stays mounted.

## Verification

```sh
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run tests/server/quote-approvals.test.ts tests/server/authorization-assignment-safety.test.ts tests/database/quote-approvals-migration.test.ts tests/client/quote-approvals.test.tsx tests/client/page-permission-titles.test.ts
```

The explicit empty configuration prevents local development configuration from affecting test database setup; fixtures supply their own isolated database and synthetic accounts.

The integration test boots real isolated SQLite, creates distinct users and checks snapshots, duplicate submission, stale content, locked edits, return/edit/resubmit, completion, withdrawal, threshold version pinning, removed reviewer eligibility, changed catalogue price, ownership transfer and a manager with read-only operation permissions. The migration test creates earlier-stage customers/products/opportunities/quotes/lines before applying this stage and checks retained identities, associations and amounts.

Browser evidence uses synthetic accounts and separate storage: saved15% quote2×$12,000=$20,400; actual sales submission; manager task1→0 after approval; returned reason retained across a simulated failed request, successful retry and task-origin edit/cancel; parameter save20→reload→restore10;390px quotation layout and375px reason form; actual dark preference and keyboard timeline disclosure. Screenshots for the tutorial are captured from these pages.

Independent tutorial-prompt reproduction passed after one prompt revision: 8 files / 47 tests and a fresh-database browser flow. The initial ambiguities and follow-up remain recorded in the website work records. Main-example acceptance passed with 8 files / 30 tests, retained-data migration verification and real browser checks. Only SQLite and local single-process operation are covered; production multi-instance operation needs the deployment's shared locking/jobs configuration.
