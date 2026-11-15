# Lesson 11: customer correspondence

Start at `lesson-10`. Mail is already installed and registered. This stage adds personal Mail/accounts/logs pages, a customer correspondence tab and administrator account/sync/submission views. The required seed extends only the named CRM roles with `mail.workspace`; existing assignments and customized grants remain intact. It grants neither `mail.admin` nor `mail.management` to sales managers.

## Run and connect

Use the repository's installation instructions for a new instance. For an existing lesson-10 instance, back up its database and private files, retain its configuration, install the locked dependencies and start development. Startup applies the new permission seed; no CRM records or issued documents are replaced. Restart existing sessions after permission changes.

Merge this into the private `config.yml` at the project root (or the file selected by `APP_CONFIG_FILE`), keeping the existing database and other settings. Replace the endpoints and TLS settings with those supplied by your authorized test mailbox provider:

```yaml
mail:
  oauthReturnUrl: /mail/accounts
  providers:
    company-mail:
      type: imap-smtp
      imap:
        host: imap.example.com
        port: 993
        secure: true
      smtp:
        host: smtp.example.com
        port: 465
        secure: true
```

Run `pnpm nocobase config check`, restart `pnpm dev`, and open the printed `Local:` URL. In Mail → Mail accounts → Connect account, select `company-mail`, enter the mailbox address, login username and password/app password, then choose the initial synchronization boundary. An omitted username uses the mailbox address. Direct TLS uses `secure: true`; use the provider's prescribed values for STARTTLS. Connecting validates both endpoints; a passing configuration check alone does not establish connectivity. Once connected, synchronize and check Mail logs for completion and the workspace for a known test message.

The provider name is a stable account reference: do not rename it after connecting. Private configuration is server-only; do not put real credentials in source or prompts. The test fixture is not enabled in an ordinary startup. No real provider is preconfigured and the application never sends automatically.

### Provider options

If SMTP does not archive sent messages, add `sentCopyMode: client` and, when the server does not mark a Sent folder, `sentFolder: Sent` under `company-mail`. Use an existing folder. Keep the default `server` mode if SMTP archives messages itself, including asynchronously. Archive failure does not mean sending failed; do not resend an accepted message.

For OAuth, merge either named provider below into the same private `mail.providers` map. Replace placeholders using an OAuth application from your provider; YAML does not expand `${NAME}` automatically.

```yaml
mail:
  oauthCallbackUrl: /mail/oauth/callback
  oauthReturnUrl: /mail/accounts
  providers:
    google:
      type: gmail
      clientId: replace-with-google-client-id
      clientSecret: replace-with-google-client-secret
    microsoft-365:
      type: microsoft
      clientId: replace-with-entra-client-id
      clientSecret: replace-with-entra-client-secret
      tenant: common
```

Register the exact callback URL with the OAuth application. For public origin `https://mail.example.com` and application base path `/main`, it is `https://mail.example.com/main/mail/oauth/callback`; successful authorization returns to `/main/mail/accounts`. Use your application's actual origin and base path, not these example addresses. Gmail API/consent or Microsoft Graph permissions and tenant policy must allow mail access; follow the installed guide at `.agents/skills/nocobase-app-plugin-mail/references/configuration-and-accounts.md` for supported scopes and account flow. Restart and confirm the chosen provider appears before authorizing. OAuth configuration is an alternative to the IMAP/SMTP path, not part of its acceptance.

Select a contact with a full email address in Customers → customer → Customer mail. Only the current user's synchronized From/To/Cc matches appear; selecting a different contact clears the previous result. Customer sharing does not expose another user's mailbox. Losing CRM access blocks the CRM endpoint; it does not delete mail from your personal mailbox.

To send a quotation, download the already issued DOCX from a confirmed quote. Open Mail → Compose, verify the recipient, attach that file and send explicitly. Mail logs shows native sync and submission status. `accepted` means provider acceptance, not recipient delivery. An unknown result must be investigated before another send. System settings → Mail administration is separately authorized.

## Verification

```sh
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project node tests/server/crm-mail.test.ts
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project node tests/server/authorization-assignment-safety.test.ts
APP_CONFIG_FILE=tests/fixtures/isolated-config.yml pnpm exec vitest run --project client tests/client/crm-mail.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts
```

The mail test uses real isolated SQLite and the public Mail Provider extension with a local fixture. It verifies native synchronization, exact address matching, personal mailbox isolation, denied customer access, native idempotency and byte-for-byte preservation of an issued DOCX uploaded for sending. It never connects an external account. Browser evidence uses the same kind of isolated fixture, not fabricated UI data. External OAuth, IMAP/SMTP connectivity, recipient receipt and multi-instance jobs require separate environment verification.
