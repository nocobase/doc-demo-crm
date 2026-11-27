import { CrmService } from './crm.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import { z } from 'zod';
import { ContactInput, CustomerInput } from './crm.js';
import { scopedRepository, type CrmPolicies } from './crm-permissions.js';

export const ConflictMode = z.enum(['skip', 'update', 'reject']);
export type ConflictModeValue = z.infer<typeof ConflictMode>;

export const TransactionMode = z.enum(['allOrNothing', 'rowByRow']);
export type TransactionModeValue = z.infer<typeof TransactionMode>;

export const IMPORT_CSV_HEADERS = [
  'customerName',
  'industry',
  'status',
  'website',
  'notes',
  'contactName',
  'contactRole',
  'contactEmail',
  'contactPhone',
] as const;

export const IMPORT_CSV_TEMPLATE = [
  IMPORT_CSV_HEADERS.join(','),
  'Harbor Robotics,Automation,prospect,https://harbor-robotics.example.com,Met at industrial expo,Jordan Patel,VP Operations,jordan.patel@harbor-robotics.example.com,+1-555-0140',
  'Summit Logistics,Supply Chain,customer,https://summit-logistics.example.com,Legacy regional account,Riley Chen,IT Director,riley.chen@summit-logistics.example.com,+1-555-0141',
].join('\n');

export interface ParsedCsvRow {
  readonly rowNumber: number;
  readonly raw: Record<string, string>;
}

export interface IntakeContactPayload {
  readonly name: string;
  readonly role: string;
  readonly email: string;
  readonly phone: string;
}

export interface IntakeRowPayload {
  readonly customer: z.infer<typeof CustomerInput>;
  readonly contact?: IntakeContactPayload;
}

export class IntakeValidationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_FIELD'
      | 'CONFLICT_REJECTED'
      | 'PERMISSION_DENIED'
      | 'DUPLICATE_IN_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'IntakeValidationError';
  }
}

export interface IntakePolicies {
  readonly view: CrmPolicies;
  readonly createCustomer?: CrmPolicies;
  readonly editCustomer?: CrmPolicies;
  readonly addContact?: CrmPolicies;
  readonly editContact?: CrmPolicies;
}

export interface IngestRowResult {
  readonly action: 'created' | 'updated' | 'skipped';
  readonly customer: RepositoryRecord;
  readonly contact?: RepositoryRecord;
  readonly contactCreated: boolean;
}

const HEADER_ALIASES: Record<string, (typeof IMPORT_CSV_HEADERS)[number]> = {
  customername: 'customerName',
  customer_name: 'customerName',
  customer: 'customerName',
  company: 'customerName',
  name: 'customerName',
  industry: 'industry',
  status: 'status',
  website: 'website',
  notes: 'notes',
  contactname: 'contactName',
  contact_name: 'contactName',
  contactrole: 'contactRole',
  contact_role: 'contactRole',
  jobtitle: 'contactRole',
  contactemail: 'contactEmail',
  contact_email: 'contactEmail',
  email: 'contactEmail',
  contactphone: 'contactPhone',
  contact_phone: 'contactPhone',
  phone: 'contactPhone',
};

export function parseCsvRecords(csvText: string): {
  headers: string[];
  rows: ParsedCsvRow[];
} {
  const clean = csvText.replace(/^\uFEFF/, '');
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i++;
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    throw new IntakeValidationError(
      'INVALID_FIELD',
      'CSV contains an unclosed quoted field.',
    );
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    matrix.push(row);
  }

  const nonEmpty = matrix.filter((cells) =>
    cells.some((cell) => cell.trim() !== ''),
  );
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }
  const rawHeaders = nonEmpty[0].map((h) => h.trim());
  const normalizedHeaders = rawHeaders.map((h) => {
    const key = h.toLowerCase().replace(/[\s-]+/g, '');
    return HEADER_ALIASES[key] ?? h;
  });

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = nonEmpty[i];
    const record: Record<string, string> = {};
    for (let col = 0; col < normalizedHeaders.length; col++) {
      const header = normalizedHeaders[col];
      record[header] = (cells[col] ?? '').trim();
    }
    rows.push({ rowNumber: i + 1, raw: record });
  }
  return { headers: normalizedHeaders, rows };
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function normalizeCustomerKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function validateIntakeRecord(
  raw: Record<string, string | undefined>,
): IntakeRowPayload {
  const rawStatus = (raw.status ?? '').trim().toLowerCase();
  const customerParsed = CustomerInput.safeParse({
    name: raw.customerName ?? raw.name ?? '',
    industry: raw.industry ?? '',
    status: rawStatus || 'prospect',
    website: raw.website ?? '',
    notes: raw.notes ?? '',
  });
  if (!customerParsed.success) {
    const issue = customerParsed.error.issues[0];
    const path = issue?.path.join('.') || 'customer';
    throw new IntakeValidationError(
      'INVALID_FIELD',
      `${path}: ${issue?.message ?? 'Invalid customer field.'}`,
    );
  }

  const contactName = (raw.contactName ?? '').trim();
  const contactRole = (raw.contactRole ?? '').trim();
  const contactEmail = (raw.contactEmail ?? '').trim();
  const contactPhone = (raw.contactPhone ?? '').trim();
  const hasContactDetails = Boolean(
    contactName || contactRole || contactEmail || contactPhone,
  );
  if (!hasContactDetails) {
    return { customer: customerParsed.data };
  }

  const contactParsed = ContactInput.safeParse({
    name: contactName,
    role: contactRole,
    email: contactEmail,
    phone: contactPhone,
  });
  if (!contactParsed.success) {
    const issue = contactParsed.error.issues[0];
    const path = issue?.path.join('.') || 'contact';
    throw new IntakeValidationError(
      'INVALID_FIELD',
      `contact.${path}: ${issue?.message ?? 'Invalid contact field.'}`,
    );
  }
  return { customer: customerParsed.data, contact: contactParsed.data };
}

/**
 * Shared customer & contact ingestion rule reused by CSV bulk import and External Lead API.
 * Must be executed inside a caller-owned transaction (`tx`) so customer and contact commit or roll back together.
 */
export async function ingestCustomerRow(
  tx: DatabaseConnection,
  policies: IntakePolicies,
  payload: IntakeRowPayload,
  options: {
    readonly ownerId: string | null;
    readonly conflictMode: ConflictModeValue;
  },
): Promise<IngestRowResult> {
  const viewCustomers = scopedRepository(tx, policies.view, 'crmCustomers');
  const targetKey = normalizeCustomerKey(payload.customer.name);
  const candidates = await viewCustomers.findMany({
    filter: (f) =>
      f.string('name').includes(payload.customer.name, { mode: 'insensitive' }),
    limit: 50,
  });
  const existing = candidates.find(
    (item) => normalizeCustomerKey(asString(item.name)) === targetKey,
  );

  const now = new Date().toISOString();

  if (existing) {
    if (options.conflictMode === 'reject') {
      throw new IntakeValidationError(
        'CONFLICT_REJECTED',
        `Customer "${payload.customer.name}" already exists.`,
      );
    }
    if (options.conflictMode === 'skip') {
      return { action: 'skipped', customer: existing, contactCreated: false };
    }
    if (!policies.editCustomer) {
      throw new IntakeValidationError(
        'PERMISSION_DENIED',
        'You do not have permission to update existing customers.',
      );
    }
    const editRepo = scopedRepository(
      tx,
      policies.editCustomer,
      'crmCustomers',
    );
    const updatedCustomer = (
      await editRepo.updateOne({
        filter: { id: asString(existing.id) },
        values: {
          name: payload.customer.name,
          industry: payload.customer.industry || asString(existing.industry),
          status: payload.customer.status,
          website: payload.customer.website || asString(existing.website),
          notes: payload.customer.notes || asString(existing.notes),
          updatedAt: now,
        },
      })
    ).record;

    let savedContact: RepositoryRecord | undefined;
    let contactCreated = false;
    if (payload.contact) {
      const contactResult = await upsertContact(
        tx,
        policies,
        asString(existing.id),
        payload.contact,
        now,
      );
      savedContact = contactResult.contact;
      contactCreated = contactResult.created;
    }
    return {
      action: 'updated',
      customer: updatedCustomer,
      contact: savedContact,
      contactCreated,
    };
  }

  if (!policies.createCustomer) {
    throw new IntakeValidationError(
      'PERMISSION_DENIED',
      'You do not have permission to create customers.',
    );
  }
  const createRepo = scopedRepository(
    tx,
    policies.createCustomer,
    'crmCustomers',
  );
  const customerId = randomUUID();
  const createdCustomer = (
    await createRepo.createOne({
      values: {
        id: customerId,
        ownerId: options.ownerId,
        ...payload.customer,
        createdAt: now,
        updatedAt: now,
      },
    })
  ).record;

  let savedContact: RepositoryRecord | undefined;
  let contactCreated = false;
  if (payload.contact) {
    const contactResult = await upsertContact(
      tx,
      policies,
      customerId,
      payload.contact,
      now,
    );
    savedContact = contactResult.contact;
    contactCreated = contactResult.created;
  }

  return {
    action: 'created',
    customer: createdCustomer,
    contact: savedContact,
    contactCreated,
  };
}

async function upsertContact(
  tx: DatabaseConnection,
  policies: IntakePolicies,
  customerId: string,
  contact: IntakeContactPayload,
  now: string,
): Promise<{ contact: RepositoryRecord; created: boolean }> {
  const viewContacts = scopedRepository(tx, policies.view, 'crmContacts');
  const existingContacts = await viewContacts.findMany({
    filter: { customerId },
    limit: 200,
  });
  const normalizedEmail = contact.email.trim().toLowerCase();
  const normalizedName = normalizeCustomerKey(contact.name);
  const matched = existingContacts.find((item) => {
    const itemEmail = asString(item.email).trim().toLowerCase();
    if (normalizedEmail && itemEmail) return itemEmail === normalizedEmail;
    return normalizeCustomerKey(asString(item.name)) === normalizedName;
  });

  if (matched) {
    if (!policies.editContact) {
      throw new IntakeValidationError(
        'PERMISSION_DENIED',
        'You do not have permission to update contacts.',
      );
    }
    await new CrmService(tx, policies.editContact).get(customerId);
    const updated = (
      await scopedRepository(tx, policies.editContact, 'crmContacts').updateOne(
        {
          filter: { id: asString(matched.id), customerId },
          values: {
            name: contact.name,
            role: contact.role || asString(matched.role),
            email: contact.email || asString(matched.email),
            phone: contact.phone || asString(matched.phone),
          },
        },
      )
    ).record;
    return { contact: updated, created: false };
  }

  if (!policies.addContact) {
    throw new IntakeValidationError(
      'PERMISSION_DENIED',
      'You do not have permission to add contacts.',
    );
  }
  await new CrmService(tx, policies.addContact).get(customerId);
  const created = (
    await scopedRepository(tx, policies.addContact, 'crmContacts').createOne({
      values: {
        id: randomUUID(),
        customerId,
        ...contact,
        createdAt: now,
      },
    })
  ).record;
  return { contact: created, created: true };
}

export function escapeCsvCell(value: unknown): string {
  const raw = asString(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
