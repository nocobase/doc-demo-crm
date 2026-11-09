# Lesson 3 · Test and deliver the first version

Start: `lesson-2`. Finish: `lesson-3`.
Compare: `git diff lesson-2..lesson-3`.

This lesson adds pagination and rollback test cases, a read-only runtime check
and the delivery/maintenance runbook. The CRM schema and behavior remain
compatible with Lesson 2.

## Run the checks

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm exec tsc -p tsconfig.node.json --noEmit
```

`pnpm test` runs the Vitest suite. The focused CRM verification covers 30 cases
on isolated SQLite databases and the client test harness:

| Business rule                                              | Verification                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Signed-out / unpermitted users cannot access customer data | Every CRM read/write route returns 401 / 403                                 |
| A customer name and follow-up summary are required         | Blank and oversized input is rejected                                        |
| Contacts belong to the selected customer                   | Cross-customer update and orphan insert are rejected                         |
| Author and time come from the server                       | Caller cannot supply an author; persisted author matches the session         |
| Retries do not create duplicate records                    | Same key replays the result; changed input under that key is rejected        |
| A failed write has no partial effect                       | Missing-parent write leaves neither a child nor a receipt                    |
| All results are reachable                                  | 23 records across two pages have 23 unique ids                               |
| People can correct mistakes                                | Form validation, failure preservation, search and translations are exercised |
| Schema history is reversible                               | Apply → down → reapply on a disposable database                              |
| Navigation and grants remain stable                        | All route components load; permission titles resolve in both languages       |

For browser acceptance, start a dedicated test/learning application, then set
`APP_URL` to its exact entry URL and `E2E_USERNAME` / `E2E_PASSWORD` to its test
account in your shell. Do not put real passwords in committed files.

```sh
pnpm exec playwright install chromium
pnpm exec playwright test tests/playwright/crm.test.ts
```

This creates one uniquely named Summit Analytics customer with a contact and
follow-up, edits it, searches for it and confirms persistence after a reload.
It leaves the acceptance record in that dedicated database. It must not be run
against a real production database. The read-only runtime check additionally
uses `E2E_EMAIL` and optionally `CRM_EXPECT_CUSTOMER`:

```sh
node scripts/check-crm-runtime.mjs
```

That check verifies health, the application page, rejected anonymous access,
sign-in with the configured origin, an authenticated customer read and OpenAPI.
It does not replace the browser business flow.

## Build and run a local delivery

The build targets Linux x64/glibc and Node.js 24. Use the platform matching your
server when it differs. No database or runtime secrets belong in the archive.

```sh
pnpm build --target linux-x64 --node-version 24 --tar
sha256sum storage/exports/dist.tar.gz
mkdir -p storage/delivery/my-crm
# Use a new, empty destination; never unpack over an existing installation.
tar -xzf storage/exports/dist.tar.gz -C storage/delivery/my-crm
node storage/delivery/my-crm/dist/cli/index.js config init --dialect sqlite --json
node storage/delivery/my-crm/dist/cli/index.js config set \
  app.publicOrigin=http://127.0.0.1:13010 \
  server.host=127.0.0.1 server.port=13010 jobs.default=memory --json
node storage/delivery/my-crm/dist/cli/index.js config check --json
node storage/delivery/my-crm/dist/cli/index.js db apply --dry-run --json
node storage/delivery/my-crm/dist/cli/index.js db apply --json
node storage/delivery/my-crm/dist/server/standalone.js
```

Open `http://127.0.0.1:13010/main/` for this configured example, after the server
reports ready. Choose another free port and update the origin together if needed.
This is a local, single-process delivery rehearsal. There is no external host,
HTTPS reverse proxy or automatic boot service configured. The current machine
had no global pm2, so the rehearsal uses the supported standalone Node entry.
For a long-running server, follow the installed deployment skill and use
app-installer/pm2 or the shipped Dockerfile under a dedicated service identity.

The deployment creates its own administrator with the sample learning
credentials from `config.example.yml`. Change that password before exposing the
service. Required initialization runs; optional sample data is skipped. To
transfer actual data, restore a coordinated backup instead of expecting Git or
the code archive to carry it.

## Back up and restore

For this lesson's SQLite configuration, data is under the installation's
`storage/database.sqlite`. Confirm the configured path before applying this
procedure to a different installation.

1. Stop the service gracefully (Ctrl-C for the foreground Node process) and wait
   for it to exit. Do not copy a live SQLite file by itself.
2. Archive **config.yml and all storage**, plus your service environment file if
   one is used. Keep the matching code archive and its SHA-256. Store backups
   privately: configuration includes the encryption keys, and storage contains
   business data and sessions.
3. Restore into a new empty directory with the matching code artifact. Unpack
   configuration and storage beside `dist/`; preserve the encryption keys.
4. Validate configuration, start the restored service and verify exact record
   ids and values, sign-in, contacts and follow-ups. Changing host/port requires
   updating the public origin. Never point two instances at one SQLite file.

Example cold backup (run only after the service has stopped):

```sh
mkdir -p storage/backups
tar -czf storage/backups/my-crm-runtime.tar.gz \
  -C storage/delivery/my-crm config.yml storage
chmod 600 storage/backups/my-crm-runtime.tar.gz
```

The verification used this procedure and restored into a separate directory on
port 13011. It did not overwrite the working development or delivery database.

## Upgrade and runtime checks

From Lesson 2, install the Lesson 3 code with the frozen lockfile and run the
focused checks. There is no new schema migration. For a deployed update:

1. Build and verify the new archive; record the source commit and digest.
2. Review migration dry-run and configuration changes.
3. Stop, take a coordinated backup and retain the previous code artifact.
4. Deploy the new `dist/` while preserving configuration, keys and storage.
5. Run configuration validation and migrations, start, and check health plus a
   representative customer/contact/follow-up read and write.
6. Restart once and verify the same records remain. Inspect `storage/logs/`.

If an update fails, select the compatible previous code and restore its
coordinated backup when required. A Git checkout or code-only rollback does not
undo a migration or recover data. A restore discards writes made after its
backup; do not perform one on real users' data without a recovery decision.

Memory jobs and local concurrency are suitable for this single instance. This
lesson does not configure distributed execution, mail, AI, notifications or file
uploads. A health response alone is not proof that a workflow or backup works.

See [verification evidence](verification.md) for what was actually executed and
what remains outside the local rehearsal.
