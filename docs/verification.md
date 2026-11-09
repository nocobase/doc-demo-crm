# Quick-start verification record

Executed on 2026-11-10 (Asia/Singapore), on Linux x64/glibc, Node.js 24.21.0.
The source project selects pnpm 11.7.0. Template baseline:
`@nocobase/app-template-default@1.0.0-beta.92`.

## Stage history

- `lesson-1`: `5c593aa` — created in the originally empty directory, configured
  SQLite and English, verified HTTP 200, native sign-in and authenticated OpenAPI.
- `lesson-2`: `5bcc2c8` — added customers, contacts and follow-up records, with
  optional English samples. This was applied to the running Lesson 1 database;
  the existing administrator continued to sign in. The initial feature checks
  passed before this stage was committed.
- `lesson-3`: resolves to the final test/delivery commit. Application runtime
  sources and schema are identical to Lesson 2; this stage adds test cases,
  runtime verification and delivery documentation.

Resolve the full immutable commits with `git rev-parse lesson-1^{commit}` (and
likewise for the other tags). There is one cumulative `main` branch. No remote
repository was configured, so commits and annotated tags are local.

## Executed checks

| Check                                                   | Actual outcome                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Focused Vitest run (files listed below)                 | 6 files, 30 tests passed                                                                 |
| Client, server and CLI/browser TypeScript projects      | Passed                                                                                   |
| ESLint on new/changed application and test files        | Passed with zero warnings                                                                |
| Prettier on changed source and documentation            | Passed; migration/seed history is excluded by repository policy                          |
| UI component source checker on `client/pages/customers` | 5 files, 0 findings, 0 exceptions                                                        |
| Chromium against the development application            | Create customer → edit → add contact → record follow-up → search → reload passed         |
| Chromium against the extracted production build         | The same complete flow passed; no page errors                                            |
| Build and deployment dependency check                   | Passed; required native binaries target Linux x64 / Node 24                              |
| Fresh deployment initialization                         | Required migrations and seeds completed, optional business sample seed skipped           |
| Reapplying deployment migrations                        | `success-noop`, no newly executed migration                                              |
| Graceful restart                                        | Exact ids and all values in all three CRM tables preserved                               |
| Cold backup restored to an independent directory        | Exact CRM records preserved; sign-in, health, anonymous denial and OpenAPI checks passed |
| Restored SQLite database                                | `PRAGMA integrity_check` returned `ok`                                                   |

The focused test selection above can be reproduced through the standard entry point:

```sh
pnpm test tests/server/crm.test.ts tests/database/crm-migration.test.ts tests/client/crm.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts tests/server/authorization-assignment-safety.test.ts
```

Visual inspection covered a desktop customer detail and the follow-up form at
375px. Light/dark and narrow-screen captures are retained locally under
`storage/verification/`:

- `customers-desktop.png`
- `customer-detail.png`
- `customer-mobile.png`
- `customer-dark.png`
- `follow-up-mobile.png`

The browser acceptance records are deliberately recognizable as **Summit
Analytics** followed by a timestamp. The development database also contains the
three optional sample accounts. The isolated delivery database contains one
complete acceptance account, its contact and follow-up. An earlier development
acceptance attempt saved a customer before its test incorrectly treated the
success toast as the form dialog; it is retained as a test record. The selector
was corrected, and the complete flow passed afterwards.

## Local delivery evidence

Application runtime source: `5bcc2c8` (unchanged in Lesson 3).
Artifact: `storage/exports/dist.tar.gz`, 74.1 MB as reported by the build.
SHA-256:

```text
3189707fb1c0a8ac153e536c18fca6f68d59577451509f7c19c57f4845b4705c
```

- Development entry: `http://127.0.0.1:13000/main/`.
- Extracted standalone delivery: `storage/delivery/lesson-3/`, configured for
  `http://127.0.0.1:13010/main/` with its own database, configuration and keys.
- Cold backup: `storage/backups/lesson-3-runtime.tar.gz` (private permissions).
- Restore check: `storage/delivery/restore-check/`, tested on port 13011, then
  stopped. It did not replace either working database.
- Deployment plans/results, artifact digest and pre-restart CRM row snapshot:
  `storage/verification/`. All runtime evidence, backups and secrets are ignored
  by Git. A fresh clone recreates them by following Lesson 3.

The development and standalone delivery processes were started in this session.
To restart them, use `pnpm dev` or
`node storage/delivery/lesson-3/dist/server/standalone.js`, respectively, in your
own terminal. Check the port is free before starting another process.

## Limits of this verification

This was a local standalone delivery and recovery rehearsal, not a deployment to
an external production server. HTTPS/reverse-proxy behavior, automatic startup at
machine boot, Docker, other operating systems/databases, distributed workers,
mail, AI and uploads were not exercised. The CRM uses a shared quick-start page
grant; per-salesperson ownership and field/action scopes belong to Lesson 6.

Published packages emit missing-sourcemap warnings during client tests; the
machine's global pnpm settings also emit warnings. Local-memory concurrency is
expected for this single-process setup. These did not prevent the recorded
checks from passing. The template's unrelated test suites were not run; the
scope was the three lessons and their affected route/settings consumers.
