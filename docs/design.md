# CRM first-release design

The first release helps an administrator keep customer details, contacts and conversations together. Use [the interactive prototype](prototype.html) for the customer list, forms and detail layouts. It is a single HTML file that opens directly in a browser; its in-memory records and simulated identity do not implement authentication or persistence.

## Users and access

An authenticated administrator operates the first release. A signed-out user or a user without customer permissions cannot read or change customer records, contacts or follow-ups. Both page navigation and direct API calls must respect access. Sales ownership, sharing and manager responsibilities belong to a later lesson.

## Records and business rules

| Record    | Information and rules                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer  | Name is required. Industry, website and notes are optional. Status is Prospect, Customer or Inactive. Search by name and filter by status. Create, view and edit; no delete operation. Inactive keeps all existing records.           |
| Contact   | Belongs to one customer. Name is required; title, email and phone are optional. Validate nonempty email addresses. Add and view on the customer detail page; a contact cannot be moved through another customer's endpoint.           |
| Follow-up | Belongs to one customer. Type is Call, Email, Meeting or Note. Content is required; next step is optional text. Record the authenticated actor and creation time automatically. Display newest first. No edit or delete after saving. |

Duplicate requests must not create duplicate records. Failed submissions preserve entered values and do not leave partially saved business records. A customer status is a classification, not an approval state. Next step is plain text and does not schedule notifications.

## Pages and interactions

- Customers: a searchable table with a status filter and New customer action. Customer names open their detail. Returning preserves search and filter choices.
- Customer form: create or edit name, industry, website, notes and status. Show field validation; cancel without saving.
- Customer detail: overview, related contacts and follow-ups. Open Edit customer, Add contact or Record follow-up from their relevant section.
- Contact and follow-up forms: retain the current customer association and return to that detail after saving. Show records only under their own customer.

Use the application's existing shadcn-style controls, borders, spacing and navigation conventions. Prototype field validation and follow-up identity are previews; verify the actual application's persistence and server authorization separately.

## Delivery and acceptance

| Step                    | Deliver                                      | Acceptance                                                                                                                                                                            |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer management     | List, create/edit form and detail            | Create a customer, reject an empty or whitespace-only name, search and filter, edit and mark inactive. Reload the actual app and verify retained changes and historical data.         |
| Contacts and follow-ups | Related lists and forms                      | Require names/content, validate email, keep customer association, record the actual actor and time, display latest first, and offer no follow-up editing or deletion.                 |
| Testing and delivery    | Automated checks and deployment verification | Verify signed-out and unauthorized rejection, association boundaries, retry protection, failed writes, migration rollback on isolated data, and persistence after deployment restart. |

For prototype review, open `docs/prototype.html`, create and edit a customer, add a contact and two follow-ups, return to the list and use search and status filters. Reloading resets this preview. Runtime tests begin after implementation.

## Deferred scope

Sales and manager roles, customer ownership and sharing, opportunities, products, quotes, approvals, reminders, email synchronization, attachments and imports are outside the first release. There are no unresolved decisions in this tutorial's default scope. Record any reader-specific changes here before implementing them; update the prototype when they affect layouts or interaction.

## Lesson 5 increment — Opportunities, products and quotes

The first-release prototype remains the reference for its original customer flows. Lesson 5 extends the actual application using the same installed components and shell conventions:

- Products have a name, unique code and current USD unit price. The catalogue provides search, pagination and create/edit dialogs.
- A customer has many opportunities, with a required name, stage (Discovery, Proposal, Won or Lost) and notes. A stage is a classification, not an approval workflow.
- An opportunity has many quotes. Each quote has a name and one to 100 product lines. The detail displays product name/code snapshots, quantity, unit price, discount, each rounded amount and the total.
- Quantities are integers from 1 to 10,000; unit prices are 0–100,000 with two decimals; discounts are 0–100 percent with two decimals. Round each line half-up to cents before summing. The server owns totals.
- Catalogue changes do not alter existing quote snapshots. Editing a quote carries each line's explicit saved price; repeated products at different prices are supported. Updating a quote and all its lines is atomic and receipt-protected.
- Customer → opportunity → quote navigation uses nested detail routes and breadcrumbs; forms use existing route dialogs and retain unresolved submissions. Existing contacts and follow-ups remain accessible.
- The initial customer page permission protects every sales endpoint. This stage does not yet introduce salesperson ownership or manager-specific permissions. No role is granted automatically to all signed-in users.

Acceptance includes exact fractional rounding, product repricing without quote changes, quote edits, association boundaries, rejected invalid values, receipt replay, rollback, preserved older records and metadata relation reads. Standard components come from `client/components/data-table`, `route-dialog`, `feedback-form`, `pending-button` and `ui/{button,input,textarea,label,select,card,alert,alert-dialog}`; application code composes them without introducing custom primitives.

## Lesson 6 increment — Sales workspace

Keep the existing theme, shell, record URLs and quote rules. Compose routine pages with the installed UI Library (quick frontend workflow); do not change schema in this lesson.

- `/sales` shows accurate customer, opportunity and quote counts, the five latest follow-ups, and the five most recently updated opportunities and quotes. Links retain record identity. Reads require the existing customer page permission; record ownership is introduced in Lesson 7.
- Customer details use URL-backed Overview, Contacts, Follow-up records and Opportunities tabs. A bare detail URL redirects to Overview. Existing opportunity/quote URLs and legacy form URLs remain valid. Each tab owns its edit dialog so closing or saving returns to that tab, including after a direct URL load.
- Customer list search/status/pagination remain URL-backed. Returning restores the original list filters. Tab content reuses DataTable, existing forms and submission protection; the parent owns PageContainer/PageHeader and shell breadcrumbs.
- Empty, loading and failed reads have standard feedback. Retrying reads never repeats writes. Tables can scroll horizontally on small screens while navigation and form actions remain reachable.
- The original prototype is the first-release reference; this section supersedes its vertically stacked detail sections with route tabs and adds the workspace. There is no new visual theme or shell exception.

Acceptance: combined search/status filters, empty results, failure/retry, direct tab URLs and reload, save/cancel to the same tab, browser back, workspace links and current counts, retained older records, and narrow-screen return paths.

## Lesson 7 · Sales roles and customer access

Sales users can read and maintain their own customers, contacts, follow-ups, opportunities and quotes. Creating a customer assigns it to the signed-in user. Sales managers can maintain every customer and assign its owner. Customers retained from earlier stages start unassigned; only a manager or administrator can see and assign them. Inactive remains a classification and does not prevent authorized edits.

Managers can share a customer's complete related history read-only with explicitly selected sales users and revoke that share. Sharing adds read access only; it never grants editing. A person's independent ownership or manager grant remains effective when a share is revoked. Product viewing is available to sales; only managers maintain products. Platform administrators retain their unrestricted access.

Use native Permission Sets, Users role assignment, record scopes and Sharing Rules. The initial Sales and Sales manager sets are editable; no business role is assigned to all signed-in users. Administrators assign the sets to named users through System settings → Users. Page access alone does not grant API operations, and an action grant alone does not grant page navigation.

Customer details show the current owner and whether the record is read-only. Authorized managers can assign an owner and edit the shared-user list. Customer, contact, follow-up, opportunity, quote and product action controls reflect the same operations enforced by the server, including direct form URLs. The first-release prototype remains a reference for its original single-administrator screens; the running application demonstrates this later permission increment.

Acceptance uses a manager, two sales users and a user without CRM roles. Check own, other, unassigned and shared customers; all related reads and writes; workspace counts and recent records; product maintenance; owner reassignment; share revocation; page-only/action-only grants; and retries after access is removed. Use separate browser sessions and direct API requests, and confirm old records survive the migration.

For native row scopes, quotes and quote lines carry a server-maintained customer key derived from their existing parents. The incremental migration preserves all prior business values and leaves older customers unassigned. The nullable scope keys are backfilled on upgrade; new application writes always populate them, and null scope keys do not match salesperson access. The quote-scope migration is forward-only because rebuilding a referenced SQLite table for rollback can violate existing foreign keys; recovery uses a matching backup.

## Lesson 8 · Quotation approval and tasks

A saved quotation begins in Draft. Any line discount strictly above 10% requires an explicitly selected, active Sales manager; an applicant cannot select themselves. At or below the threshold, submitting confirms the quotation immediately. Server checks use saved line values, not client totals. Submission freezes the quote, applicant, reviewer and applicable threshold. Native lifecycle parameters expose the threshold to authorized administrators; the first submission pins its configuration version for that quotation, including subsequent returns and resubmissions.

Reviewers can approve, reject with a reason, or return with a reason. Returned quotations can be edited and resubmitted by the applicant. Approval and rejection are final; a new commercial revision is a new quotation. Review, confirmed and rejected quotations cannot be edited, including by direct API writes. Submission and quote edits serialize against the same quote row. Approval decisions require the current task, content hash, active manager eligibility and current customer access. Replayed requests do not create duplicate approvals or tasks.

Applicants can withdraw a pending review. An active Sales manager with edit access can also withdraw to recover a request whose applicant lost access or reviewer became unavailable. Withdrawal closes the task and returns to Draft. If customer ownership changes, the former owner loses access immediately; the new owner creates a new quotation after the manager withdraws the old request rather than impersonating the old applicant.

My tasks uses the native Task Center, opens the authorized quotation as a child page, and refreshes after decisions. The quote displays the status, reviewer, decisions and reasons using native approval UI. Task completion follows the approval outcome. System settings contains the native workflow definition diagram, real threshold configuration and authorized execution history. Sales roles receive no workflow configuration grant by default. Native task filters persist while the parent page remains mounted; they are not URL filters.

Acceptance covers the 10% boundary, self-review and unrelated-user rejection, immutable snapshots, concurrent edits, repeated submission, return/edit/resubmit, reject, withdraw, lost reviewer eligibility, transferred ownership, native pending/completed tasks, configuration version pinning, direct links and retained earlier CRM data. Screenshots come from the isolated running application with synthetic sales and manager accounts.

## Lesson 9 · Attachments and issued quotation documents

Requirement attachments belong to customers and inherit current customer access. Uploads begin as private staging files belonging to the uploader, then are attached through an authorized customer save. Shared users can preview and download but cannot upload, attach or remove. Every byte request checks current access, including after transfer or sharing revocation.

Generate a single DOCX from a confirmed quotation’s saved approval snapshot, using fixed application template revision1. The first issued version also captures the authorized customer display name. Keep the issued file and its source identity; repeated generation returns that version, and later catalog/customer edits do not rewrite it. New commercial content needs a new quotation. Document generation requires current read access and never sends a message. File and template management joins existing system settings; credentials remain server-side. Preview uses the installed local OOXML viewer.

## Lesson 10 · Business event notifications

New nonnull customer ownership sends one in-app notification to the new owner; unchanged assignment, unassignment and sharing do not. Confirmed (including automatic confirmation), rejected and returned quotations notify the original applicant per committed transition. No unrelated or read-only shared recipient is added. Messages use fixed English generic content; customer/quote data is loaded only after current authorization at the linked route. Marking a message read never decides an approval or closes a task.

A transactionally recorded business event is handed to the native Notification service with a stable key. Native Notification/Delivery/Attempt persistence owns delivery and recovery. Preacceptance queued events remain recoverable; accepted events link to native delivery logs and are never re-sent by the outbox. System settings provides registered synthetic-only templates, actual native logs and safe pending event states. This lesson activates only the in-app channel; external channels remain deployment choices requiring credentials and separate verification.

## Lesson 11 · Customer correspondence

Mail owns personal accounts, synchronization, message content, attachments and submission history. The application adds a personal workspace/accounts/logs entry and a customer Mail tab. Select one existing contact with a nonempty email; match the full normalized address in From/To/Cc against the signed-in user's synchronized messages. No domain, fuzzy matching or unfiltered fallback. Customer access and Mail workspace permission are checked on each customer-mail request. Sharing customers never grants mailbox access. Managers use their own mailboxes; native mail administration grants remain separate.

Send quotations explicitly from the native workspace after downloading the already issued DOCX and verifying recipient and attachment. This lesson does not automate sending or duplicate Mail submission state. Show native personal sync/submission records and administrator account/status records. Accepted means provider acceptance, unknown is not eligible for blind retry. Local provider fixtures verify application integration; external OAuth, mailbox connection and recipient delivery require an authorized mailbox.

## Lesson 12 · Scheduled follow-up and quotation response deadlines

Customer reminders are separate plans with a title, explicit UTC due time and kind `followUp` or `quoteExpiry` (quotation response deadline). Quotation reminders select a confirmed quotation of that customer; they neither change an issued document nor expire the commercial quotation. Cancel and create a new plan to change time. Current customer editors can create, complete or cancel plans; shared readers can only view them. Pending and notified plans can be completed/cancelled. Reading a notification never changes a plan.

A code-owned Scheduler definition checks every minute in UTC, with actual occurrence history and authorized pause/resume. Each due pending plan queues one generic in-app event for the current active customer owner and changes to notified in the same transaction. No owner, inactive customer or disabled owner leaves the plan pending for later checks. Quote plans whose opportunity is won/lost are skipped. The stable reminder ID owns deduplication; already notified plans do not notify a new owner again. Native delivery logs own transport status. A successful scan means durable decisions/events were saved, not delivery completed. Database failures fail the occurrence; later executions revisit pending plans. Notification submission failures retain the existing durable outbox for recovery.

## Lesson 13 · Assisted customer follow-up

Generate a customer summary, suggested next step and editable follow-up draft from the selected customer's authorized history and product knowledge. OnlineAgent owns model execution; Knowledge owns versioned product articles and permission-filtered retrieval. Product knowledge uses built-in text retrieval; semantic indexing is optional and outside this lesson.

Business tools recheck the current user's customer access on every call. Model input cannot choose an identity or broaden the selected customer. Retrieved text is evidence, never an instruction. Cite only retrieved documents and versions; missing evidence must remain an explicit gap. No tool sends mail, changes a quotation or records a follow-up automatically. Saving an edited draft uses the existing follow-up form, current write permission and submission protection.

Use the existing customer detail and form components, English interface and shared theme. Model and knowledge administration belongs under System settings. Acceptance includes inaccessible customers/documents, revoked access, missing models, failed generation, no automatic writes, editable drafts and explicit save. Fixture model tests do not establish real model quality or replace runtime screenshots and prompt replay.
