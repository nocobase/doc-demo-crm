# Lesson 2 · Define CRM requirements

Start: `lesson-1`. Finish: `lesson-2`. Compare: `git diff lesson-1..lesson-2`.

This stage adds [the first-release design](design.md) and [an interactive HTML prototype](prototype.html). It does not add business tables, real customer pages or customer APIs. The application still runs as described in [Lesson 1](lesson-1.md).

## Review the prototype

Open `docs/prototype.html` directly in a browser. No build, server, dependency install or database is needed for the prototype. Use the New customer button, enter a name, and save. Edit the customer, add a contact, then record two follow-ups. Return through Customers to search by name or filter by status. Mark a customer Inactive and verify its contacts and follow-ups remain visible.

Empty names and follow-up content are rejected; a nonempty email must be valid. New follow-ups appear first and cannot be edited or deleted. The fictional actor and timestamps simulate the future interface. All preview data is in memory and resets when the file reloads; no authentication, authorization or persistence claim is made for this stage.

## Development prompt

```prompt
根据已确定的第一版 CRM 需求，生成 docs/prototype.html，让我在浏览器里直接打开，体验客户列表、新建和编辑表单、客户详情，以及添加联系人和记录跟进的过程。用英文界面和虚构数据演示，沿用应用现有的界面风格。这一步先做原型，不开发正式业务功能。把 CRM 需求整理到 docs/design.md，写清使用者、资料、跟进流程、页面、访问规则及暂不做的内容，引用原型并列出验收标准。
```

## Acceptance

- The single HTML file opens independently and its create/edit, validation, contact, follow-up, search and filter interactions work.
- The design lists the first-release scope, access boundaries, retained inactive records, immutable follow-ups, page behavior and staged acceptance.
- `AGENTS.md` registers both references. The actual customer feature begins in Lesson 3.

Moving from Lesson 1 to this stage requires no database migration or sample data. Preserve the existing application configuration, database and uploads when changing code.
