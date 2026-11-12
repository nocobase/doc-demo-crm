# Lesson 7 · Role permissions and customer access

Start: `lesson-6`. Finish: `lesson-7`. Compare: `git diff lesson-6..lesson-7`.

## Business goal

Sales users maintain their own customers and related contacts, follow-ups, opportunities and quotes. Managers maintain all customers, assign owners and share selected customers read-only with named sales users. Sales users read the product catalogue; managers maintain it. Inactive customers retain the same permission behavior as other customers.

The application uses native Authorization permission sets, record scopes and Sharing Rules. Page navigation and business actions are independent. Only explicit users receive the editable Sales or Sales manager permission sets; the member role grants no CRM access. An administrator assigns roles in **System settings → Users**. A roleless user remains unable to open the CRM or call its business APIs.

## Development prompt

```prompt
给 CRM 增加销售和销售主管两种角色。销售只能查看和维护自己负责的客户，新建客户归自己；主管可以查看和维护全部客户、分配负责人，也可以把客户只读共享给指定销售并撤销共享。共享给销售的客户不能修改。联系人、跟进记录、商机和报价都遵循所属客户的访问范围；销售可以查看产品，主管维护产品。把角色分配给明确选择的用户，不要让所有登录用户自动获得 CRM 权限。页面按钮和直接调用接口都要遵守这些规则。
```

## Independent installation and upgrade

Follow [Lesson 1](lesson-1.md) for configuration and startup. An existing installation should stop its server and back up its database, configuration and uploads before switching to this stage. Install the locked dependencies, review and apply the migrations, then restart using the exact printed `Local:` URL:

```sh
pnpm install --frozen-lockfile
pnpm nocobase db apply --dry-run --json
pnpm nocobase db apply --json
pnpm dev
```

Existing customers remain **Unassigned**. A manager or administrator can see them and assign each one explicitly; they are not silently assigned to the administrator or a random salesperson. The additional customer key on quotes and quote lines is backfilled from the existing opportunity relationship without altering prices, discounts, totals or other business data. New writes derive that key on the server; requests cannot choose a different customer key.

The quote/customer scope migration `202611120005_quote_customer_access` is forward-only. It adds nullable columns, backfills them and creates indexes without rebuilding referenced tables. Nullable columns keep the upgrade compatible with retained data; the application writes customer keys for every new quote and line, and missing keys grant no salesperson access. Removing these columns would rebuild the referenced parent table on SQLite, so this stage deliberately provides no automatic rollback for that migration. Restore a matching pre-upgrade backup to return to the earlier schema. Switching Git tags alone does not roll back data.

For a fresh learning database, use the optional sample data as described in [Lesson 5](lesson-5.md). Sample customers start unassigned. This stage creates the two permission sets but creates no demo accounts and assigns no business roles automatically. Create or select two sales users, one manager and one user without a CRM role through the existing administration interface. Use local credentials of your own; no credentials or browser sessions belong in Git.

## Configure and try the roles

1. In **System settings → Users**, assign **Sales** to two explicitly chosen users and **Sales manager** to the manager. Leave the fourth user without a CRM role. Existing unrelated roles are preserved.
2. Sign in as the manager. Open an unassigned customer and use its **Overview** access panel to assign an owner. Existing customer details and related records remain visible.
3. In a separate sales session, create a customer and verify that it belongs to that account. The other salesperson cannot find or open it.
4. As manager, select the other salesperson in **Read-only sharing** and save. That salesperson can view the customer's contacts, follow-ups, opportunities and quotes, including related records added after sharing. Editing and creation controls are unavailable, including when opening a form URL directly.
5. Revoke sharing and reload the other sales session. The shared customer and its related records disappear from searches, counts and recent activity. Revoking a share does not remove access granted independently by ownership or a manager role.
6. Reassign a customer and verify that the old owner loses access on the next request, including attempts to replay a previous mutation. The new owner can maintain it. Sales can read products but cannot create or edit them.

Manager ownership assignment and sharing are separately configurable business actions in the existing permission editor. The sharing endpoint accepts only selected user IDs and always constructs native **view-only** rules. Managers receive no generic sharing-rule administration grant and cannot create arbitrary edit-sharing rules through the platform API.

## Verification

Relevant checks:

```sh
pnpm exec vitest run tests/server/crm-access.test.ts tests/server/authorization-assignment-safety.test.ts tests/database/crm-access-migration.test.ts tests/server/crm.test.ts tests/server/sales.test.ts tests/server/workspace.test.ts
pnpm exec vitest run tests/client/crm.test.tsx tests/client/sales.test.tsx tests/client/workspace.test.tsx tests/client/client-routes.test.ts tests/client/page-permission-titles.test.ts tests/client/permission-workspace.test.ts
```

The permission scenarios exercise production routes, native policy evaluation and real isolated databases. They check own and other records, anonymous and roleless requests, read-only sharing, new related records after sharing, workspace data, revocation, reassignment, mutation replay, product maintenance, generic sharing API rejection, and page-only versus action-only grants. The migration check starts with an existing customer, opportunity, quote and line, verifies retained values and customer-key backfill, and does not claim a rollback for the forward-only migration.

Acceptance results on the retained Lesson 6 installation:

- The six server/database test files passed 18 tests; the additional independently narrowed workspace scope regression passed with the workspace suite. Six client test files passed 58 tests, including direct form URLs and independent action grants.
- Client, server and Node TypeScript checks, scoped ESLint, formatting and the client UI checker passed.
- The real database upgrade preserved every original field across 4 customers, 4 contacts, 5 follow-ups, 2 products, 1 opportunity, 2 quotes and 3 lines. Derived customer keys matched the parent chains and SQLite reported no foreign-key violations.
- Real accounts were explicitly assigned through the native Users interface. Ten groups of direct API checks covered ownership, no-role denial, all shared descendants, read-only writes, products, generic permission administration denial, workspace scopes, revocation, reassignment, replay and automatic ownership on creation. Existing quote totals and notes were unchanged.
- The existing CRM Playwright flow passed 1/1: customer creation and editing, contacts, follow-ups, search and refresh.
- Browser acceptance confirmed the manager owner/share controls, the salesperson's read-only banner and owner name, readable related records without write buttons, blocked direct customer/follow-up/quote/product form URLs, and access removal after revocation and reload. No page errors occurred. The tutorial includes two screenshots of these actual results.

Workspace preview rows with an inaccessible parent are omitted, even when an administrator independently configures a broader child scope. Counts continue to follow each entity's configured native scope. The walkthrough above can also be used to check a learning installation independently.
