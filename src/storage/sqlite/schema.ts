import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const units = sqliteTable(
  'units',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    officialName: text('official_name').notNull(),
    shortName: text('short_name').notNull(),
    fullName: text('full_name').notNull(),
    status: text('status').notNull(),
    openedOn: text('opened_on'),
    closedOn: text('closed_on'),
    ledgerSheet: text('ledger_sheet'),
    rawDir: text('raw_dir'),
    note: text('note').notNull().default(''),
  },
  (table) => [check('units_status_chk', sql`${table.status} IN ('active', 'closed')`)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    category: text('category').notNull(),
    gwan: text('gwan').notNull(),
    hang: text('hang').notNull(),
    mok: text('mok').notNull(),
    description: text('description').notNull().default(''),
  },
  (table) => [primaryKey({ columns: [table.category, table.gwan, table.hang, table.mok] })],
);

export const people = sqliteTable(
  'people',
  {
    personId: text('person_id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    status: text('status').notNull(),
    note: text('note').notNull().default(''),
  },
  (table) => [
    check('people_kind_chk', sql`${table.kind} IN ('member', 'external')`),
    check(
      'people_status_chk',
      sql`${table.status} IN ('active', 'inactive', 'retired', 'withdrawn', 'leave')`,
    ),
  ],
);

export const memberProfiles = sqliteTable('member_profiles', {
  personId: text('person_id')
    .primaryKey()
    .references(() => people.personId, { onDelete: 'cascade' }),
  unitCode: text('unit_code')
    .notNull()
    .references(() => units.code),
  birthDate: text('birth_date').notNull().default(''),
  shift: text('shift').notNull().default(''),
  employmentType: text('employment_type').notNull().default(''),
  firstJoinedOn: text('first_joined_on').notNull().default(''),
  joinedOn: text('joined_on').notNull().default(''),
  leftOn: text('left_on').notNull().default(''),
  memberWish: text('member_wish').notNull().default(''),
  applicationDocKey: text('application_doc_key').notNull().default(''),
});

export const externalProfiles = sqliteTable('external_profiles', {
  personId: text('person_id')
    .primaryKey()
    .references(() => people.personId, { onDelete: 'cascade' }),
  org: text('org').notNull().default(''),
  category: text('category').notNull().default(''),
});

export const ledgerEntries = sqliteTable('ledger_entries', {
  txId: text('tx_id').primaryKey(),
  unitCode: text('unit_code')
    .notNull()
    .references(() => units.code),
  unitName: text('unit_name').notNull(),
  year: integer('year').notNull(),
  ym: text('ym').notNull(),
  date: text('date').notNull(),
  gubun: text('gubun').notNull(),
  gwan: text('gwan').notNull(),
  hang: text('hang').notNull(),
  mok: text('mok').notNull(),
  expType: text('exp_type').notNull().default(''),
  fund: text('fund').notNull().default(''),
  target: text('target').notNull().default(''),
  attrYm: text('attr_ym').notNull().default(''),
  inc: integer('inc').notNull().default(0),
  exp: integer('exp').notNull().default(0),
  unitBal: integer('unit_bal').notNull().default(0),
  note: text('note').notNull().default(''),
  memo: text('memo').notNull().default(''),
});

export const membershipEvents = sqliteTable(
  'membership_events',
  {
    eventId: text('event_id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.personId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventDate: text('event_date').notNull(),
    fromUnit: text('from_unit').references(() => units.code),
    toUnit: text('to_unit').references(() => units.code),
    reasonCategory: text('reason_category').notNull().default(''),
    rejoinCategory: text('rejoin_category').notNull().default(''),
    reason: text('reason').notNull().default(''),
    docMdPath: text('doc_md_path').notNull().default(''),
    refundTxId: text('refund_tx_id').references(() => ledgerEntries.txId),
  },
  (table) => [
    check(
      'membership_events_type_chk',
      sql`${table.eventType} IN ('join', 'withdraw', 'rejoin', 'transfer', 'baseline_sync', 'ledger_import')`,
    ),
    check(
      'membership_events_reason_cat_chk',
      sql`${table.reasonCategory} IN ('정년퇴직', '계약만료·퇴직', '기타', '')`,
    ),
  ],
);

export const memberDocuments = sqliteTable(
  'member_documents',
  {
    docId: text('doc_id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => membershipEvents.eventId, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.personId, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    blobKey: text('blob_key').notNull().default(''),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [check('member_documents_type_chk', sql`${table.docType} IN ('가입서', '탈퇴서', '기타')`)],
);

export const personAliases = sqliteTable(
  'person_aliases',
  {
    alias: text('alias').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.personId, { onDelete: 'cascade' }),
    matchMode: text('match_mode').notNull().default('exact'),
    note: text('note').notNull().default(''),
  },
  (table) => [check('person_aliases_mode_chk', sql`${table.matchMode} IN ('exact', 'context_title')`)],
);

export const personRoles = sqliteTable(
  'person_roles',
  {
    roleId: text('role_id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.personId, { onDelete: 'cascade' }),
    org: text('org').notNull().default(''),
    title: text('title').notNull(),
    publicDisclosure: text('public_disclosure').notNull().default('masked'),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    check(
      'person_roles_disclosure_chk',
      sql`${table.publicDisclosure} IN ('public_official', 'masked')`,
    ),
  ],
);

export const stripTokens = sqliteTable(
  'strip_tokens',
  {
    category: text('category').notNull(),
    token: text('token').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.category, table.token] }),
    check('strip_tokens_cat_chk', sql`${table.category} IN ('honorific', 'modifier', 'title')`),
  ],
);

export const privacyRules = sqliteTable(
  'privacy_rules',
  {
    ruleType: text('rule_type').notNull(),
    matchKey: text('match_key').notNull(),
    replacement: text('replacement').notNull().default(''),
    note: text('note').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.ruleType, table.matchKey] }),
    check(
      'privacy_rules_type_chk',
      sql`${table.ruleType} IN ('forbidden_name', 'target_mask', 'note_replacement')`,
    ),
  ],
);

export const ledgerPersonLinks = sqliteTable(
  'ledger_person_links',
  {
    txId: text('tx_id')
      .notNull()
      .references(() => ledgerEntries.txId, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.personId, { onDelete: 'cascade' }),
    matchField: text('match_field').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.txId, table.personId] }),
    check('ledger_person_links_field_chk', sql`${table.matchField} IN ('target', 'note')`),
  ],
);

export const documentLedgerLinks = sqliteTable(
  'document_ledger_links',
  {
    docId: text('doc_id').notNull(),
    txId: text('tx_id')
      .notNull()
      .references(() => ledgerEntries.txId, { onDelete: 'restrict' }),
    relationNote: text('relation_note').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.docId, table.txId] })],
);

export const syncMetadata = sqliteTable('sync_metadata', {
  syncKey: text('sync_key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
