# Lesson 1 · Create and run the CRM

Stage: `lesson-1`. Starting point: an empty directory. This stage creates the
NocoBase 3 application, authentication and administration foundation. Customer
management arrives in Lesson 2.

## Run independently

Requirements: Node.js 24+, pnpm 11 (the project pins 11.7.0), Linux/macOS or WSL.

```sh
pnpm install --frozen-lockfile
pnpm nocobase config init --dialect sqlite --json
pnpm nocobase config check --json
pnpm dev
```

Open the exact `Local:` URL printed by the last command, including `/main/`.
The port advances if occupied. Set `app.publicOrigin` to your browser's origin
(protocol, host and port, without `/main`) with `pnpm nocobase config set`.
Restart if needed and verify sign-in using that same host.

The initial local learning account is `nocobase` (`admin@nocobase.com`) with the
sample password `admin123`, as declared in `config.example.yml`. Change it before
exposing the application. New accounts do not receive administrator access.
English is the default interface language. No mail, AI or external database is
needed for these three lessons.

`config.yml`, SQLite data and `storage/` are local and ignored by Git. Keep the
generated secrets with your database backups. A Git tag restores code, not data.
To restart development, run `pnpm dev` in this directory.

## Agent entry

Read `AGENTS.md`, then `.agents/skills/nocobase-app-development/SKILL.md`.
`pnpm install` synchronizes the version-matched skills. Business implementation
belongs in this application, not in a separate plugin.

## Acceptance

- Application entry responds successfully and presents the login screen.
- The initial administrator can sign in and return to Home.
- System settings is available to the administrator.
- Configuration validation passes. Secrets and generated data are not committed.

Creation used `@nocobase/app-template-default@1.0.0-beta.92`; the lockfile fixes
resolved dependencies. Installation reported peer-dependency warnings; runtime
and the lesson-specific checks are recorded with the delivered stages.
