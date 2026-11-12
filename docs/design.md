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
