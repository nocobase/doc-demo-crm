# Lesson 12: scheduled customer reminders

Continue from `lesson-11` with the same database, private files and configuration. Back them up before upgrading, install the locked dependencies and start the application. Startup applies `202611160002_crm_reminders` and synchronizes the source-owned schedule. Existing customers, quotations, documents, mail and notifications remain intact. A fresh installation uses the same setup instructions and creates the new collection during initialization.

## Use the feature

Open a customer → Reminders. A current editor can enter a title, local due time and either a follow-up or a confirmed quotation's response deadline. The browser converts the time to UTC. A quotation deadline is an internal follow-up plan: it does not change the issued DOCX, change prices or expire the quotation. Cancel and create another plan to change its time. Complete the plan after following up; reading an inbox message does not complete it.

The `crm.reminders` Scheduler definition runs every minute (`* * * * *`, `UTC`). It checks due pending plans in bounded batches, queues one generic in-app event to the current active customer owner and marks the plan notified transactionally. Notification submission and delivery use Lesson 10's outbox and native Notification services. The current owner is rechecked inside the business transaction; account activity is checked outside that transaction to avoid exhausting SQLite's connection pool.

Inactive customers, absent/disabled owners and confirmed quotes belonging to won/lost opportunities produce no reminder. Pending plans are reconsidered on later executions. Completed/cancelled/notified plans never enqueue again. Ownership changes before checking affect the recipient; ownership changes after an event exists do not create a second event. Already queued messages are not recalled by completing/cancelling a plan.

System settings → Scheduled reminders shows timezone, next execution, pause/resume and occurrence history. Select the task name to inspect checked/queued/skipped counts. Success means the business check committed, not that a notification reached the inbox. View Notifications for transport outcomes. Pause affects future triggers, not an execution already running; resume checks overdue pending plans on the next run.

## Verification

```sh
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project node tests/server/crm-reminders.test.ts
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project node tests/database/crm-reminders-migration.test.ts
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project client tests/client/crm-reminders.test.tsx tests/client/crm-schedules.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts
```

Real SQLite tests cover time boundaries, missing offsets, duplicate creation/checking, read-only sharing, completion/cancellation, ownership changes, inactive customers, disabled owners, quote eligibility, closed opportunities, pagination past deferred plans and native notification outage recovery. Migration up/down preserves earlier customer data. Browser acceptance follows an actual minute trigger, native occurrence completion and inbox delivery, then completes the plan and pauses/resumes the schedule. The application runs as one process with memory jobs in these checks. Multi-instance deployment requires shared Jobs/locks and its own runtime verification.
