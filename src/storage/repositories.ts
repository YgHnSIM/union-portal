import type {
  Account,
  DirectoryBundle,
  DocumentLedgerLink,
  ExternalRecord,
  LedgerEntry,
  LedgerPersonLink,
  MemberDocument,
  MemberRecord,
  MembershipEvent,
  Person,
  PersonAlias,
  PersonRole,
  PrivacyRule,
  PrivacyRuleType,
  PublicDisclosure,
  StripToken,
  SyncMetadata,
  Unit,
} from '../domain/types.js';

export interface UnitsRepository {
  listAll(): Promise<Unit[]>;
  findByCode(code: string): Promise<Unit | null>;
  upsertMany(items: Unit[]): Promise<void>;
}

export interface AccountsRepository {
  listAll(): Promise<Account[]>;
  replaceAll(items: Account[]): Promise<void>;
}

export interface PeopleRepository {
  listPeople(): Promise<Person[]>;
  findPersonById(personId: string): Promise<Person | null>;
  listMembers(): Promise<MemberRecord[]>;
  findMemberById(personId: string): Promise<MemberRecord | null>;
  listExternals(): Promise<ExternalRecord[]>;
  upsertMember(record: MemberRecord): Promise<void>;
  upsertExternal(record: ExternalRecord): Promise<void>;
  listEvents(personId?: string): Promise<MembershipEvent[]>;
  addEvent(event: MembershipEvent): Promise<void>;
  replaceEvents(items: MembershipEvent[]): Promise<void>;
  listMemberDocuments(eventId?: string): Promise<MemberDocument[]>;
  addMemberDocument(doc: MemberDocument): Promise<void>;
  listAliases(): Promise<PersonAlias[]>;
  upsertAlias(alias: PersonAlias): Promise<void>;
  listRoles(personId?: string): Promise<PersonRole[]>;
  findRoleById(roleId: string): Promise<PersonRole | null>;
  upsertRole(role: PersonRole): Promise<void>;
  setRoleDisclosure(roleId: string, disclosure: PublicDisclosure): Promise<void>;
  getDirectoryBundle(): Promise<DirectoryBundle>;
}

export interface PrivacyRepository {
  listStripTokens(): Promise<StripToken[]>;
  replaceStripTokens(tokens: StripToken[]): Promise<void>;
  listRules(): Promise<PrivacyRule[]>;
  upsertRules(rules: PrivacyRule[]): Promise<void>;
  deleteRule(ruleType: PrivacyRuleType, matchKey: string): Promise<void>;
}

export interface LedgerRepository {
  listEntries(filter?: { unitCode?: string; ym?: string; year?: number }): Promise<LedgerEntry[]>;
  findByTxId(txId: string): Promise<LedgerEntry | null>;
  listReferencedTxIds(): Promise<{
    documentLinks: string[];
    refundLinks: string[];
  }>;
  replaceAllAndSyncLinks(entries: LedgerEntry[], links: LedgerPersonLink[]): Promise<void>;
  listPersonLinks(txId?: string): Promise<LedgerPersonLink[]>;
}

export interface DocumentLinksRepository {
  listAll(): Promise<DocumentLedgerLink[]>;
  listByDocId(docId: string): Promise<DocumentLedgerLink[]>;
  listByTxId(txId: string): Promise<DocumentLedgerLink[]>;
  upsert(link: DocumentLedgerLink): Promise<void>;
  remove(docId: string, txId: string): Promise<void>;
}

export interface SyncMetadataRepository {
  get(key: string): Promise<SyncMetadata | null>;
  set(key: string, valueJson: string): Promise<void>;
}

export interface UnionRepositories {
  units: UnitsRepository;
  accounts: AccountsRepository;
  people: PeopleRepository;
  privacy: PrivacyRepository;
  ledger: LedgerRepository;
  links: DocumentLinksRepository;
  syncMeta: SyncMetadataRepository;
  transaction<T>(fn: (repos: UnionRepositories) => Promise<T>): Promise<T>;
}
