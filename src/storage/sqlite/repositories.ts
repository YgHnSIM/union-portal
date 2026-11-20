import { and, asc, eq } from 'drizzle-orm';
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
  PrivacyBundle,
  PrivacyRule,
  PublicDisclosure,
  StripToken,
  StripTokensConfig,
  SyncMetadata,
  Unit,
} from '../../domain/types.js';
import type {
  AccountsRepository,
  DocumentLinksRepository,
  LedgerRepository,
  PeopleRepository,
  PrivacyRepository,
  SyncMetadataRepository,
  UnionRepositories,
  UnitsRepository,
} from '../repositories.js';
import type { SqliteOrmDb } from './client.js';
import {
  accounts,
  documentLedgerLinks,
  externalProfiles,
  ledgerEntries,
  ledgerPersonLinks,
  memberDocuments,
  memberProfiles,
  membershipEvents,
  people,
  personAliases,
  personRoles,
  privacyRules,
  stripTokens,
  syncMetadata,
  units,
} from './schema.js';

type QueryExecutor = Pick<
  SqliteOrmDb,
  'select' | 'insert' | 'update' | 'delete'
>;

class SqliteUnitsRepository implements UnitsRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async listAll(): Promise<Unit[]> {
    const rows = await this.exec.select().from(units).orderBy(asc(units.code));
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      officialName: r.officialName,
      shortName: r.shortName,
      fullName: r.fullName,
      status: r.status as Unit['status'],
      openedOn: r.openedOn,
      closedOn: r.closedOn,
      ledgerSheet: r.ledgerSheet,
      rawDir: r.rawDir,
      note: r.note,
    }));
  }

  async findByCode(code: string): Promise<Unit | null> {
    const rows = await this.exec.select().from(units).where(eq(units.code, code));
    const r = rows[0];
    if (!r) return null;
    return {
      code: r.code,
      name: r.name,
      officialName: r.officialName,
      shortName: r.shortName,
      fullName: r.fullName,
      status: r.status as Unit['status'],
      openedOn: r.openedOn,
      closedOn: r.closedOn,
      ledgerSheet: r.ledgerSheet,
      rawDir: r.rawDir,
      note: r.note,
    };
  }

  async upsertMany(items: Unit[]): Promise<void> {
    for (const u of items) {
      await this.exec
        .insert(units)
        .values({
          code: u.code,
          name: u.name,
          officialName: u.officialName,
          shortName: u.shortName,
          fullName: u.fullName,
          status: u.status,
          openedOn: u.openedOn,
          closedOn: u.closedOn,
          ledgerSheet: u.ledgerSheet,
          rawDir: u.rawDir,
          note: u.note,
        })
        .onConflictDoUpdate({
          target: units.code,
          set: {
            name: u.name,
            officialName: u.officialName,
            shortName: u.shortName,
            fullName: u.fullName,
            status: u.status,
            openedOn: u.openedOn,
            closedOn: u.closedOn,
            ledgerSheet: u.ledgerSheet,
            rawDir: u.rawDir,
            note: u.note,
          },
        });
    }
  }
}

class SqliteAccountsRepository implements AccountsRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async listAll(): Promise<Account[]> {
    return this.exec.select().from(accounts);
  }

  async replaceAll(items: Account[]): Promise<void> {
    await this.exec.delete(accounts);
    if (items.length === 0) return;
    await this.exec.insert(accounts).values(
      items.map((a) => ({
        category: a.category,
        gwan: a.gwan,
        hang: a.hang,
        mok: a.mok,
        description: a.description,
      })),
    );
  }
}

class SqlitePrivacyRepository implements PrivacyRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async listStripTokens(): Promise<StripToken[]> {
    const rows = await this.exec.select().from(stripTokens);
    return rows.map((r) => ({
      category: r.category as StripToken['category'],
      token: r.token,
    }));
  }

  async replaceStripTokens(tokens: StripToken[]): Promise<void> {
    await this.exec.delete(stripTokens);
    if (tokens.length === 0) return;
    await this.exec
      .insert(stripTokens)
      .values(tokens.map((t) => ({ category: t.category, token: t.token })))
      .onConflictDoNothing();
  }

  async listRules(): Promise<PrivacyRule[]> {
    const rows = await this.exec.select().from(privacyRules);
    return rows.map((r) => ({
      ruleType: r.ruleType as PrivacyRule['ruleType'],
      matchKey: r.matchKey,
      replacement: r.replacement,
      note: r.note,
    }));
  }

  async upsertRules(rules: PrivacyRule[]): Promise<void> {
    for (const rule of rules) {
      await this.exec
        .insert(privacyRules)
        .values({
          ruleType: rule.ruleType,
          matchKey: rule.matchKey,
          replacement: rule.replacement,
          note: rule.note,
        })
        .onConflictDoUpdate({
          target: [privacyRules.ruleType, privacyRules.matchKey],
          set: {
            replacement: rule.replacement,
            note: rule.note,
          },
        });
    }
  }
}

class SqlitePeopleRepository implements PeopleRepository {
  constructor(
    private readonly exec: QueryExecutor,
    private readonly privacyRepo: PrivacyRepository,
  ) {}

  async listPeople(): Promise<Person[]> {
    const rows = await this.exec.select().from(people).orderBy(asc(people.personId));
    return rows.map((r) => ({
      personId: r.personId,
      kind: r.kind as Person['kind'],
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status as Person['status'],
      note: r.note,
    }));
  }

  async findPersonById(personId: string): Promise<Person | null> {
    const rows = await this.exec.select().from(people).where(eq(people.personId, personId));
    const r = rows[0];
    if (!r) return null;
    return {
      personId: r.personId,
      kind: r.kind as Person['kind'],
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status as Person['status'],
      note: r.note,
    };
  }

  async listMembers(): Promise<MemberRecord[]> {
    const rows = await this.exec
      .select()
      .from(people)
      .innerJoin(memberProfiles, eq(people.personId, memberProfiles.personId))
      .orderBy(asc(people.personId));
    return rows.map(({ people: p, member_profiles: mp }) => ({
      personId: p.personId,
      kind: 'member',
      name: p.name,
      phone: p.phone,
      email: p.email,
      status: p.status as Person['status'],
      note: p.note,
      unitCode: mp.unitCode,
      birthDate: mp.birthDate,
      shift: mp.shift,
      employmentType: mp.employmentType,
      firstJoinedOn: mp.firstJoinedOn,
      joinedOn: mp.joinedOn,
      leftOn: mp.leftOn,
      memberWish: mp.memberWish,
      applicationDocKey: mp.applicationDocKey,
    }));
  }

  async findMemberById(personId: string): Promise<MemberRecord | null> {
    const rows = await this.exec
      .select()
      .from(people)
      .innerJoin(memberProfiles, eq(people.personId, memberProfiles.personId))
      .where(eq(people.personId, personId));
    const row = rows[0];
    if (!row) return null;
    const { people: p, member_profiles: mp } = row;
    return {
      personId: p.personId,
      kind: 'member',
      name: p.name,
      phone: p.phone,
      email: p.email,
      status: p.status as Person['status'],
      note: p.note,
      unitCode: mp.unitCode,
      birthDate: mp.birthDate,
      shift: mp.shift,
      employmentType: mp.employmentType,
      firstJoinedOn: mp.firstJoinedOn,
      joinedOn: mp.joinedOn,
      leftOn: mp.leftOn,
      memberWish: mp.memberWish,
      applicationDocKey: mp.applicationDocKey,
    };
  }

  async listExternals(): Promise<ExternalRecord[]> {
    const rows = await this.exec
      .select()
      .from(people)
      .innerJoin(externalProfiles, eq(people.personId, externalProfiles.personId))
      .orderBy(asc(people.personId));
    return rows.map(({ people: p, external_profiles: ep }) => ({
      personId: p.personId,
      kind: 'external',
      name: p.name,
      phone: p.phone,
      email: p.email,
      status: p.status as Person['status'],
      note: p.note,
      org: ep.org,
      category: ep.category,
    }));
  }

  async upsertMember(record: MemberRecord): Promise<void> {
    await this.exec
      .insert(people)
      .values({
        personId: record.personId,
        kind: 'member',
        name: record.name,
        phone: record.phone,
        email: record.email,
        status: record.status,
        note: record.note,
      })
      .onConflictDoUpdate({
        target: people.personId,
        set: {
          kind: 'member',
          name: record.name,
          phone: record.phone,
          email: record.email,
          status: record.status,
          note: record.note,
        },
      });

    await this.exec
      .insert(memberProfiles)
      .values({
        personId: record.personId,
        unitCode: record.unitCode,
        birthDate: record.birthDate,
        shift: record.shift,
        employmentType: record.employmentType,
        firstJoinedOn: record.firstJoinedOn,
        joinedOn: record.joinedOn,
        leftOn: record.leftOn,
        memberWish: record.memberWish,
        applicationDocKey: record.applicationDocKey,
      })
      .onConflictDoUpdate({
        target: memberProfiles.personId,
        set: {
          unitCode: record.unitCode,
          birthDate: record.birthDate,
          shift: record.shift,
          employmentType: record.employmentType,
          firstJoinedOn: record.firstJoinedOn,
          joinedOn: record.joinedOn,
          leftOn: record.leftOn,
          memberWish: record.memberWish,
          applicationDocKey: record.applicationDocKey,
        },
      });
  }

  async upsertExternal(record: ExternalRecord): Promise<void> {
    await this.exec
      .insert(people)
      .values({
        personId: record.personId,
        kind: 'external',
        name: record.name,
        phone: record.phone,
        email: record.email,
        status: record.status,
        note: record.note,
      })
      .onConflictDoUpdate({
        target: people.personId,
        set: {
          kind: 'external',
          name: record.name,
          phone: record.phone,
          email: record.email,
          status: record.status,
          note: record.note,
        },
      });

    await this.exec
      .insert(externalProfiles)
      .values({
        personId: record.personId,
        org: record.org,
        category: record.category,
      })
      .onConflictDoUpdate({
        target: externalProfiles.personId,
        set: {
          org: record.org,
          category: record.category,
        },
      });
  }

  async listEvents(personId?: string): Promise<MembershipEvent[]> {
    const query = personId
      ? this.exec
          .select()
          .from(membershipEvents)
          .where(eq(membershipEvents.personId, personId))
          .orderBy(asc(membershipEvents.eventId))
      : this.exec.select().from(membershipEvents).orderBy(asc(membershipEvents.eventId));
    const rows = await query;
    return rows.map((r) => ({
      eventId: r.eventId,
      personId: r.personId,
      eventType: r.eventType as MembershipEvent['eventType'],
      eventDate: r.eventDate,
      fromUnit: r.fromUnit,
      toUnit: r.toUnit,
      reasonCategory: r.reasonCategory as MembershipEvent['reasonCategory'],
      rejoinCategory: r.rejoinCategory,
      reason: r.reason,
      docMdPath: r.docMdPath,
      refundTxId: r.refundTxId,
    }));
  }

  async addEvent(event: MembershipEvent): Promise<void> {
    await this.exec.insert(membershipEvents).values({
      eventId: event.eventId,
      personId: event.personId,
      eventType: event.eventType,
      eventDate: event.eventDate,
      fromUnit: event.fromUnit,
      toUnit: event.toUnit,
      reasonCategory: event.reasonCategory,
      rejoinCategory: event.rejoinCategory,
      reason: event.reason,
      docMdPath: event.docMdPath,
      refundTxId: event.refundTxId,
    });
  }

  async replaceEvents(items: MembershipEvent[]): Promise<void> {
    await this.exec.delete(membershipEvents);
    for (const ev of items) {
      await this.addEvent(ev);
    }
  }

  async listMemberDocuments(eventId?: string): Promise<MemberDocument[]> {
    const query = eventId
      ? this.exec
          .select()
          .from(memberDocuments)
          .where(eq(memberDocuments.eventId, eventId))
          .orderBy(asc(memberDocuments.docId))
      : this.exec.select().from(memberDocuments).orderBy(asc(memberDocuments.docId));
    const rows = await query;
    return rows.map((r) => ({
      docId: r.docId,
      eventId: r.eventId,
      personId: r.personId,
      docType: r.docType as MemberDocument['docType'],
      blobKey: r.blobKey,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  async addMemberDocument(doc: MemberDocument): Promise<void> {
    await this.exec
      .insert(memberDocuments)
      .values({
        docId: doc.docId,
        eventId: doc.eventId,
        personId: doc.personId,
        docType: doc.docType,
        blobKey: doc.blobKey,
        note: doc.note,
        createdAt: doc.createdAt,
      })
      .onConflictDoUpdate({
        target: memberDocuments.docId,
        set: {
          eventId: doc.eventId,
          personId: doc.personId,
          docType: doc.docType,
          blobKey: doc.blobKey,
          note: doc.note,
          createdAt: doc.createdAt,
        },
      });
  }

  async listAliases(): Promise<PersonAlias[]> {
    const rows = await this.exec.select().from(personAliases).orderBy(asc(personAliases.alias));
    return rows.map((r) => ({
      alias: r.alias,
      personId: r.personId,
      matchMode: r.matchMode as PersonAlias['matchMode'],
      note: r.note,
    }));
  }

  async upsertAlias(alias: PersonAlias): Promise<void> {
    await this.exec
      .insert(personAliases)
      .values({
        alias: alias.alias,
        personId: alias.personId,
        matchMode: alias.matchMode,
        note: alias.note,
      })
      .onConflictDoUpdate({
        target: personAliases.alias,
        set: {
          personId: alias.personId,
          matchMode: alias.matchMode,
          note: alias.note,
        },
      });
  }

  async listRoles(personId?: string): Promise<PersonRole[]> {
    const query = personId
      ? this.exec
          .select()
          .from(personRoles)
          .where(eq(personRoles.personId, personId))
          .orderBy(asc(personRoles.roleId))
      : this.exec.select().from(personRoles).orderBy(asc(personRoles.roleId));
    const rows = await query;
    return rows.map((r) => ({
      roleId: r.roleId,
      personId: r.personId,
      org: r.org,
      title: r.title,
      publicDisclosure: r.publicDisclosure as PublicDisclosure,
      validFrom: r.validFrom,
      validTo: r.validTo,
      isPrimary: r.isPrimary,
    }));
  }

  async upsertRole(role: PersonRole): Promise<void> {
    await this.exec
      .insert(personRoles)
      .values({
        roleId: role.roleId,
        personId: role.personId,
        org: role.org,
        title: role.title,
        publicDisclosure: role.publicDisclosure,
        validFrom: role.validFrom,
        validTo: role.validTo,
        isPrimary: role.isPrimary,
      })
      .onConflictDoUpdate({
        target: personRoles.roleId,
        set: {
          personId: role.personId,
          org: role.org,
          title: role.title,
          publicDisclosure: role.publicDisclosure,
          validFrom: role.validFrom,
          validTo: role.validTo,
          isPrimary: role.isPrimary,
        },
      });
  }

  async setRoleDisclosure(roleId: string, disclosure: PublicDisclosure): Promise<void> {
    await this.exec
      .update(personRoles)
      .set({ publicDisclosure: disclosure })
      .where(eq(personRoles.roleId, roleId));
  }

  async getDirectoryBundle(): Promise<DirectoryBundle> {
    const [allPeople, members, externals, events, docs, aliases, roles, tokenRows, ruleRows] =
      await Promise.all([
        this.listPeople(),
        this.listMembers(),
        this.listExternals(),
        this.listEvents(),
        this.listMemberDocuments(),
        this.listAliases(),
        this.listRoles(),
        this.privacyRepo.listStripTokens(),
        this.privacyRepo.listRules(),
      ]);

    const stripCfg: StripTokensConfig = {
      honorifics: tokenRows.filter((t) => t.category === 'honorific').map((t) => t.token),
      modifiers: tokenRows.filter((t) => t.category === 'modifier').map((t) => t.token),
      titles: tokenRows.filter((t) => t.category === 'title').map((t) => t.token),
    };

    const privacy: PrivacyBundle = {
      forbiddenNames: ruleRows
        .filter((r) => r.ruleType === 'forbidden_name')
        .map((r) => r.matchKey),
      targetMask: Object.fromEntries(
        ruleRows
          .filter((r) => r.ruleType === 'target_mask')
          .map((r) => [r.matchKey, r.replacement]),
      ),
      exactNoteReplacements: Object.fromEntries(
        ruleRows
          .filter((r) => r.ruleType === 'note_replacement')
          .map((r) => [r.matchKey, r.replacement]),
      ),
    };

    const idToName: Record<string, string> = {};
    for (const p of allPeople) {
      idToName[p.personId] = p.name;
    }

    return {
      people: allPeople,
      members,
      externals,
      membershipEvents: events,
      memberDocuments: docs,
      aliases,
      roles,
      stripTokens: stripCfg,
      privacy,
      idToName,
    };
  }
}

class SqliteLedgerRepository implements LedgerRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async listEntries(filter?: {
    unitCode?: string;
    ym?: string;
    year?: number;
  }): Promise<LedgerEntry[]> {
    const rows = await this.exec.select().from(ledgerEntries);
    return rows
      .filter((r) => {
        if (filter?.unitCode && r.unitCode !== filter.unitCode) return false;
        if (filter?.ym && r.ym !== filter.ym) return false;
        if (filter?.year !== undefined && r.year !== filter.year) return false;
        return true;
      })
      .map((r) => ({
        txId: r.txId,
        unitCode: r.unitCode,
        unitName: r.unitName,
        year: r.year,
        ym: r.ym,
        date: r.date,
        gubun: r.gubun,
        gwan: r.gwan,
        hang: r.hang,
        mok: r.mok,
        expType: r.expType,
        fund: r.fund,
        target: r.target,
        attrYm: r.attrYm,
        inc: r.inc,
        exp: r.exp,
        unitBal: r.unitBal,
        note: r.note,
        memo: r.memo,
      }));
  }

  async findByTxId(txId: string): Promise<LedgerEntry | null> {
    const rows = await this.exec
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txId, txId));
    const r = rows[0];
    if (!r) return null;
    return {
      txId: r.txId,
      unitCode: r.unitCode,
      unitName: r.unitName,
      year: r.year,
      ym: r.ym,
      date: r.date,
      gubun: r.gubun,
      gwan: r.gwan,
      hang: r.hang,
      mok: r.mok,
      expType: r.expType,
      fund: r.fund,
      target: r.target,
      attrYm: r.attrYm,
      inc: r.inc,
      exp: r.exp,
      unitBal: r.unitBal,
      note: r.note,
      memo: r.memo,
    };
  }

  async listReferencedTxIds(): Promise<{
    documentLinks: string[];
    refundLinks: string[];
  }> {
    const docRows = await this.exec
      .select({ txId: documentLedgerLinks.txId })
      .from(documentLedgerLinks);
    const evRows = await this.exec
      .select({ refundTxId: membershipEvents.refundTxId })
      .from(membershipEvents);
    return {
      documentLinks: [...new Set(docRows.map((r) => r.txId))],
      refundLinks: [
        ...new Set(
          evRows
            .map((r) => r.refundTxId)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      ],
    };
  }

  async replaceAllAndSyncLinks(
    entries: LedgerEntry[],
    links: LedgerPersonLink[],
  ): Promise<void> {
    const incomingIds = new Set(entries.map((e) => e.txId));
    const refs = await this.listReferencedTxIds();
    const missingDocRefs = refs.documentLinks.filter((id) => !incomingIds.has(id));
    if (missingDocRefs.length > 0) {
      throw new Error(
        `원장 동기화 중단: document_ledger_links가 참조하는 거래번호가 누락되었습니다: ${missingDocRefs.join(', ')}`,
      );
    }
    const missingRefundRefs = refs.refundLinks.filter((id) => !incomingIds.has(id));
    if (missingRefundRefs.length > 0) {
      throw new Error(
        `원장 동기화 중단: membership_events.refund_tx_id가 참조하는 거래번호가 누락되었습니다: ${missingRefundRefs.join(', ')}`,
      );
    }

    await this.exec.delete(ledgerPersonLinks);

    for (const e of entries) {
      await this.exec
        .insert(ledgerEntries)
        .values({
          txId: e.txId,
          unitCode: e.unitCode,
          unitName: e.unitName,
          year: e.year,
          ym: e.ym,
          date: e.date,
          gubun: e.gubun,
          gwan: e.gwan,
          hang: e.hang,
          mok: e.mok,
          expType: e.expType,
          fund: e.fund,
          target: e.target,
          attrYm: e.attrYm,
          inc: e.inc,
          exp: e.exp,
          unitBal: e.unitBal,
          note: e.note,
          memo: e.memo,
        })
        .onConflictDoUpdate({
          target: ledgerEntries.txId,
          set: {
            unitCode: e.unitCode,
            unitName: e.unitName,
            year: e.year,
            ym: e.ym,
            date: e.date,
            gubun: e.gubun,
            gwan: e.gwan,
            hang: e.hang,
            mok: e.mok,
            expType: e.expType,
            fund: e.fund,
            target: e.target,
            attrYm: e.attrYm,
            inc: e.inc,
            exp: e.exp,
            unitBal: e.unitBal,
            note: e.note,
            memo: e.memo,
          },
        });
    }

    // Delete obsolete ledger rows not in incomingIds (safe because ref check passed above)
    const existingRows = await this.exec
      .select({ txId: ledgerEntries.txId })
      .from(ledgerEntries);
    for (const row of existingRows) {
      if (!incomingIds.has(row.txId)) {
        await this.exec.delete(ledgerEntries).where(eq(ledgerEntries.txId, row.txId));
      }
    }

    for (const link of links) {
      await this.exec
        .insert(ledgerPersonLinks)
        .values({
          txId: link.txId,
          personId: link.personId,
          matchField: link.matchField,
        })
        .onConflictDoNothing();
    }
  }

  async listPersonLinks(txId?: string): Promise<LedgerPersonLink[]> {
    const query = txId
      ? this.exec
          .select()
          .from(ledgerPersonLinks)
          .where(eq(ledgerPersonLinks.txId, txId))
      : this.exec.select().from(ledgerPersonLinks);
    const rows = await query;
    return rows.map((r) => ({
      txId: r.txId,
      personId: r.personId,
      matchField: r.matchField as LedgerPersonLink['matchField'],
    }));
  }
}

class SqliteDocumentLinksRepository implements DocumentLinksRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async listAll(): Promise<DocumentLedgerLink[]> {
    const rows = await this.exec
      .select()
      .from(documentLedgerLinks)
      .orderBy(asc(documentLedgerLinks.docId), asc(documentLedgerLinks.txId));
    return rows.map((r) => ({
      docId: r.docId,
      txId: r.txId,
      relationNote: r.relationNote,
      createdAt: r.createdAt,
    }));
  }

  async listByDocId(docId: string): Promise<DocumentLedgerLink[]> {
    const rows = await this.exec
      .select()
      .from(documentLedgerLinks)
      .where(eq(documentLedgerLinks.docId, docId));
    return rows.map((r) => ({
      docId: r.docId,
      txId: r.txId,
      relationNote: r.relationNote,
      createdAt: r.createdAt,
    }));
  }

  async listByTxId(txId: string): Promise<DocumentLedgerLink[]> {
    const rows = await this.exec
      .select()
      .from(documentLedgerLinks)
      .where(eq(documentLedgerLinks.txId, txId));
    return rows.map((r) => ({
      docId: r.docId,
      txId: r.txId,
      relationNote: r.relationNote,
      createdAt: r.createdAt,
    }));
  }

  async upsert(link: DocumentLedgerLink): Promise<void> {
    await this.exec
      .insert(documentLedgerLinks)
      .values({
        docId: link.docId,
        txId: link.txId,
        relationNote: link.relationNote,
        createdAt: link.createdAt,
      })
      .onConflictDoUpdate({
        target: [documentLedgerLinks.docId, documentLedgerLinks.txId],
        set: {
          relationNote: link.relationNote,
          createdAt: link.createdAt,
        },
      });
  }

  async remove(docId: string, txId: string): Promise<void> {
    await this.exec
      .delete(documentLedgerLinks)
      .where(
        and(
          eq(documentLedgerLinks.docId, docId),
          eq(documentLedgerLinks.txId, txId),
        ),
      );
  }
}

class SqliteSyncMetadataRepository implements SyncMetadataRepository {
  constructor(private readonly exec: QueryExecutor) {}

  async get(key: string): Promise<SyncMetadata | null> {
    const rows = await this.exec
      .select()
      .from(syncMetadata)
      .where(eq(syncMetadata.syncKey, key));
    const r = rows[0];
    if (!r) return null;
    return {
      syncKey: r.syncKey,
      valueJson: r.valueJson,
      updatedAt: r.updatedAt,
    };
  }

  async set(key: string, valueJson: string): Promise<void> {
    const now = new Date().toISOString();
    await this.exec
      .insert(syncMetadata)
      .values({ syncKey: key, valueJson, updatedAt: now })
      .onConflictDoUpdate({
        target: syncMetadata.syncKey,
        set: { valueJson, updatedAt: now },
      });
  }
}

export class SqliteUnionRepositories implements UnionRepositories {
  readonly units: UnitsRepository;
  readonly accounts: AccountsRepository;
  readonly people: PeopleRepository;
  readonly privacy: PrivacyRepository;
  readonly ledger: LedgerRepository;
  readonly links: DocumentLinksRepository;
  readonly syncMeta: SyncMetadataRepository;

  constructor(
    private readonly db: SqliteOrmDb,
    exec?: QueryExecutor,
  ) {
    const target = exec ?? db;
    this.units = new SqliteUnitsRepository(target);
    this.accounts = new SqliteAccountsRepository(target);
    this.privacy = new SqlitePrivacyRepository(target);
    this.people = new SqlitePeopleRepository(target, this.privacy);
    this.ledger = new SqliteLedgerRepository(target);
    this.links = new SqliteDocumentLinksRepository(target);
    this.syncMeta = new SqliteSyncMetadataRepository(target);
  }

  async transaction<T>(fn: (repos: UnionRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const scoped = new SqliteUnionRepositories(this.db, tx);
      return fn(scoped);
    });
  }
}
