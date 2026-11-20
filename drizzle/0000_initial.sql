CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  official_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  opened_on TEXT,
  closed_on TEXT,
  ledger_sheet TEXT,
  raw_dir TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS accounts (
  category TEXT NOT NULL,
  gwan TEXT NOT NULL,
  hang TEXT NOT NULL,
  mok TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (category, gwan, hang, mok)
);

CREATE TABLE IF NOT EXISTS people (
  person_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('member', 'external')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'retired', 'withdrawn', 'leave')),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS member_profiles (
  person_id TEXT PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL REFERENCES units(code),
  birth_date TEXT NOT NULL DEFAULT '',
  shift TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  first_joined_on TEXT NOT NULL DEFAULT '',
  joined_on TEXT NOT NULL DEFAULT '',
  left_on TEXT NOT NULL DEFAULT '',
  member_wish TEXT NOT NULL DEFAULT '',
  application_doc_key TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS external_profiles (
  person_id TEXT PRIMARY KEY REFERENCES people(person_id) ON DELETE CASCADE,
  org TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  tx_id TEXT PRIMARY KEY,
  unit_code TEXT NOT NULL REFERENCES units(code),
  unit_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  ym TEXT NOT NULL,
  date TEXT NOT NULL,
  gubun TEXT NOT NULL,
  gwan TEXT NOT NULL,
  hang TEXT NOT NULL,
  mok TEXT NOT NULL,
  exp_type TEXT NOT NULL DEFAULT '',
  fund TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  attr_ym TEXT NOT NULL DEFAULT '',
  inc INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0,
  unit_bal INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS membership_events (
  event_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('join', 'withdraw', 'rejoin', 'transfer', 'baseline_sync', 'ledger_import')),
  event_date TEXT NOT NULL,
  from_unit TEXT REFERENCES units(code),
  to_unit TEXT REFERENCES units(code),
  reason_category TEXT NOT NULL DEFAULT '' CHECK (reason_category IN ('정년퇴직', '계약만료·퇴직', '기타', '')),
  rejoin_category TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  doc_md_path TEXT NOT NULL DEFAULT '',
  refund_tx_id TEXT REFERENCES ledger_entries(tx_id)
);

CREATE TABLE IF NOT EXISTS member_documents (
  doc_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES membership_events(event_id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('가입서', '탈퇴서', '기타')),
  blob_key TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_aliases (
  alias TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  match_mode TEXT NOT NULL DEFAULT 'exact' CHECK (match_mode IN ('exact', 'context_title')),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS person_roles (
  role_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  org TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  public_disclosure TEXT NOT NULL DEFAULT 'masked' CHECK (public_disclosure IN ('public_official', 'masked')),
  valid_from TEXT,
  valid_to TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS strip_tokens (
  category TEXT NOT NULL CHECK (category IN ('honorific', 'modifier', 'title')),
  token TEXT NOT NULL,
  PRIMARY KEY (category, token)
);

CREATE TABLE IF NOT EXISTS privacy_rules (
  rule_type TEXT NOT NULL CHECK (rule_type IN ('forbidden_name', 'target_mask', 'note_replacement')),
  match_key TEXT NOT NULL,
  replacement TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (rule_type, match_key)
);

CREATE TABLE IF NOT EXISTS ledger_person_links (
  tx_id TEXT NOT NULL REFERENCES ledger_entries(tx_id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  match_field TEXT NOT NULL CHECK (match_field IN ('target', 'note')),
  PRIMARY KEY (tx_id, person_id)
);

CREATE TABLE IF NOT EXISTS document_ledger_links (
  doc_id TEXT NOT NULL,
  tx_id TEXT NOT NULL REFERENCES ledger_entries(tx_id) ON DELETE RESTRICT,
  relation_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (doc_id, tx_id)
);

CREATE TABLE IF NOT EXISTS sync_metadata (
  sync_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_unit ON member_profiles(unit_code);
CREATE INDEX IF NOT EXISTS idx_membership_events_person ON membership_events(person_id, event_date);
CREATE INDEX IF NOT EXISTS idx_person_roles_person ON person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_ym ON ledger_entries(ym);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_unit ON ledger_entries(unit_code, date);
