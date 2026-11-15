# Lesson 9 · Customer attachments and quotation documents

Start from `lesson-8`. Back up the database, configuration and storage together. Install locked dependencies, inspect pending migrations, apply them and start the app:

```sh
pnpm install --frozen-lockfile
pnpm nocobase db apply --dry-run --json
pnpm nocobase db apply --json
pnpm dev
```

Use the printed Local URL. This stage adds two new tables without changing earlier migration sources. The retained-data migration test exercises forward and reverse schema changes; a rollback removes document metadata, so restore matching file-storage/database backups for an operational rollback. Git does not contain uploaded bytes.

Customer details now has an Attachments tab. Authorized owners/managers upload up to ten files per save, each at most 5 MB, then Save to associate them. Uploads are private staging until saved. Cancelled selections are not customer attachments. Shared readers may preview/download but cannot attach/remove. Every content request rechecks customer scope, including after transfer or revoked sharing. Removing an attachment retains its customer association as a tombstone; it cannot become uploader-private again or be reattached. Content responses prohibit caching and active document execution.

Confirmed quotations offer Generate DOCX. The fixed English Carbone 3.9.2 template is in `docs/templates/quotation-v1.docx`, with embedded server bytes for packaging. Same-format rendering requires no PDF converter. Lines/prices/discounts/totals come from the confirmed snapshot; customer/opportunity names are captured at first issue. A unique quotation version, shared quote lock and standard receipt transaction make repeated/concurrent requests return the same file. Later catalogue or name changes do not alter its bytes. Native FileRepository handles storage and native file UI previews DOCX locally.

System settings → Files and quotation documents shows the actual template/storage policy and paged unlinked uploads older than 24 hours. Cleanup claims a file before deleting its bytes, blocking a simultaneous attach. Physical failure leaves Cleanup pending; retry completes the same claim. Attached, removed and issued files never enter this directory. Native metadata endpoints expose only a caller's unlinked staging records; there is no generic file update/delete bypass.

```sh
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run tests/server/customer-files.test.ts tests/server/quotation-renderer.test.ts tests/database/customer-documents-migration.test.ts tests/server/quote-approvals.test.ts tests/client/customer-documents.test.tsx tests/client/file-preview.test.tsx tests/client/page-permission-titles.test.ts tests/client/client-routes.test.ts
```

Tests cover real SQLite permissions/bytes, frozen and concurrent issuance, render failure and retry, Unicode/XML/multiple lines, retained migration, cleanup failure/replay and same-uploader association races. Browser checks use isolated synthetic accounts: upload/preview/download, native DOCX preview, failed save with retained selection, cancel/discard, 375×667 ten-file footer, dark theme, preview download403 visible inside the dialog, restored file-trigger focus, remove feedback and cleanup status filter. Copied file-preview UI carries a documented app extension for local download feedback and an optional returnFocus callback when a table replaces its trigger.

Independent prompt replay and the initial-to-revised prompt history are recorded in the website work directory. Only SQLite, local private storage and a single-process development server were verified. No production deployment or external document converter is claimed.
