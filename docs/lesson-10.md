# Lesson 10: business notifications

Continue from `lesson-9`. The example enables the existing native notification/in-app plugins through the `inbox` channel. No new package installation is required for this stage. Start with the existing local development configuration; startup runs `202611150003_crm_notification_events.ts` and preserves earlier CRM/file records. Keep database and private file storage together when backing up the application.

Customer owner changes notify the new nonnull active owner. Unchanged owner, unassignment and sharing do not create messages. Confirmed (including automatic confirmation), rejected and returned quotations notify the original applicant. Submission awaiting approval and withdrawal do not. Messages deliberately contain generic English text, not names, amounts or approval comments. Every linked customer/quotation checks current access. Reading an inbox item changes no approval/task state.

Business transactions insert `crmNotificationEvents`. Postcommit submission improves responsiveness; a native scheduled task sweeps queued rows every 15 seconds and at startup. `queued` means not accepted by the native service; `submitted` means a native notification exists, not that delivery completed. Native notification logs own delivery/attempt state and transport retries. Missing/disabled recipients are skipped. Stable event identities plus native idempotency recover a crash between send acceptance and updating the event. Submitted rows are never resent. A terminal native delivery failure needs an authorized `retryDelivery` operation with a reason after its cause is corrected; the lesson provides viewing, not a retry button.

System settings → Notifications supplies actual template definitions with pure previews, a paginated business-event list and native delivery logs. The preview uses no real records and does not send. Administrators can inspect actual channel activation without exposing credentials. Ordinary sales users have no template/log administration grants.

## Verification

SQLite fixture checks run in separate processes to avoid an observed fixture-lifecycle `SQLITE_READONLY_DBMOVED` error in multi-file server runs. The same quotation regression passes independently; no application database/configuration is changed to hide the error.

```sh
for suite in tests/server/crm-notifications.test.ts tests/server/quote-approvals.test.ts tests/server/customer-files.test.ts tests/database/crm-notifications-migration.test.ts tests/database/customer-documents-migration.test.ts; do
  APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project node "$suite" || exit 1
done
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project client tests/client/inbox.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts
```

The server tests use real isolated SQLite and users to check recipient isolation, authorization, rollback, duplicate operations, preacceptance outage/recovery, crash-after-acceptance recovery and preview no-send. Retained migration up/down preserves previous files. Browser acceptance covers actual assignment/approval, read/unread, current access on old links and stale tabs, native logs, error retry and mobile/dark display. The tutorial's independent replay starts at lesson 9 with only the frozen prompt; its report lives in the website work directory.

This lesson verifies local single-process SQLite and in-app delivery. SMTP/Resend, Feishu/DingTalk and optional Web Push are documented alternatives, not verified connections. Configure shared jobs/locks and validate real transport delivery before a multi-instance deployment. No deployment or remote tag publication is part of this verification.
