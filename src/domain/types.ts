export type UnitStatus = 'active' | 'closed';

export interface Unit {
  code: string;
  name: string;
  officialName: string;
  shortName: string;
  fullName: string;
  status: UnitStatus;
  openedOn: string | null;
  closedOn: string | null;
  ledgerSheet: string | null;
  rawDir: string | null;
  note: string;
}

export interface Account {
  category: string;
  gwan: string;
  hang: string;
  mok: string;
  description: string;
}

export type PersonKind = 'member' | 'external';
export type PersonStatus = 'active' | 'inactive' | 'retired' | 'withdrawn' | 'leave';
export type PublicDisclosure = 'public_official' | 'masked';
export type RoleScope =
  | 'executive'
  | 'branch_head'
  | 'auditor'
  | 'committee'
  | 'staff_rotating'
  | 'external_rep'
  | 'other';
export type EventType = 'join' | 'withdraw' | 'rejoin' | 'transfer' | 'baseline_sync' | 'ledger_import';
export type WithdrawReasonCategory = '정년퇴직' | '계약만료·퇴직' | '기타' | '';
export type MemberDocType = '가입서' | '탈퇴서' | '기타';
export type AliasMatchMode = 'exact' | 'context_title';
export type StripTokenCategory = 'honorific' | 'modifier' | 'title';
export type PrivacyRuleType = 'forbidden_name' | 'target_mask' | 'note_replacement';
export type DocVisibility = 'public' | 'unlisted' | 'internal_only';
export type DocCategory = 'statement' | 'mom' | 'knowledge' | 'notice' | 'newsletter';

export interface Person {
  personId: string;
  kind: PersonKind;
  name: string;
  phone: string;
  email: string;
  status: PersonStatus;
  note: string;
}

export interface MemberProfile {
  personId: string;
  unitCode: string;
  birthDate: string;
  shift: string;
  employmentType: string;
  firstJoinedOn: string;
  joinedOn: string;
  leftOn: string;
  memberWish: string;
  applicationDocKey: string;
}

export interface ExternalProfile {
  personId: string;
  org: string;
  category: string;
}

export interface MemberRecord extends Person, MemberProfile {}
export interface ExternalRecord extends Person, ExternalProfile {}

export interface MembershipEvent {
  eventId: string;
  personId: string;
  eventType: EventType;
  eventDate: string;
  fromUnit: string | null;
  toUnit: string | null;
  reasonCategory: WithdrawReasonCategory;
  rejoinCategory: string;
  reason: string;
  docMdPath: string;
  refundTxId: string | null;
}

export interface MemberDocument {
  docId: string;
  eventId: string;
  personId: string;
  docType: MemberDocType;
  blobKey: string;
  note: string;
  createdAt: string;
}

export interface PersonAlias {
  alias: string;
  personId: string;
  matchMode: AliasMatchMode;
  note: string;
}

export interface PersonRole {
  roleId: string;
  personId: string;
  org: string;
  title: string;
  publicDisclosure: PublicDisclosure;
  validFrom: string | null;
  validTo: string | null;
  isPrimary: boolean;
  roleScope?: RoleScope;
  termLabel?: string;
  appointedOn?: string | null;
  endedOn?: string | null;
  endReason?: string;
  sortOrder?: number;
  evidenceDocId?: string;
  note?: string;
}

export interface StripToken {
  category: StripTokenCategory;
  token: string;
}

export interface PrivacyRule {
  ruleType: PrivacyRuleType;
  matchKey: string;
  replacement: string;
  note: string;
}

export interface LedgerEntry {
  txId: string;
  unitCode: string;
  unitName: string;
  year: number;
  ym: string;
  date: string;
  gubun: string;
  gwan: string;
  hang: string;
  mok: string;
  expType: string;
  fund: string;
  target: string;
  attrYm: string;
  inc: number;
  exp: number;
  unitBal: number;
  note: string;
  memo: string;
}

export interface LedgerPersonLink {
  txId: string;
  personId: string;
  matchField: 'target' | 'note';
}

export interface DocumentLedgerLink {
  docId: string;
  txId: string;
  relationNote: string;
  createdAt: string;
}

export interface SyncMetadata {
  syncKey: string;
  valueJson: string;
  updatedAt: string;
}

export interface StripTokensConfig {
  honorifics: string[];
  modifiers: string[];
  titles: string[];
}

export interface PrivacyBundle {
  forbiddenNames: string[];
  targetMask: Record<string, string>;
  exactNoteReplacements: Record<string, string>;
}

export interface DirectoryBundle {
  people: Person[];
  members: MemberRecord[];
  externals: ExternalRecord[];
  membershipEvents: MembershipEvent[];
  memberDocuments: MemberDocument[];
  aliases: PersonAlias[];
  roles: PersonRole[];
  stripTokens: StripTokensConfig;
  privacy: PrivacyBundle;
  idToName: Record<string, string>;
}

export interface DocumentRecordV3 {
  id: string;
  category: DocCategory;
  route: string;
  title: string;
  summary: string;
  dates: {
    publishedOn: string;
    modifiedOn: string;
    reviewedOn: string;
    eventOn?: string;
  };
  workflow: {
    status: 'draft' | 'reviewed' | 'final';
    visibility: DocVisibility;
  };
  topicIds: string[];
  evidence: {
    count: number;
    note: string;
    noteVisibility: 'public' | 'private';
    sourceIds: string[];
    complete: boolean;
  };
  relatedDocumentIds: string[];
  displayOrder: number;
  presentation: {
    print: {
      titleLines?: string[];
    };
  };
  type?: 'minutes' | 'report';
  socialImage?: string;
  financePeriod?: string;
  attendeeRoles?: string[];
}
