import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AliasMatchMode,
  DocumentLedgerLink,
  ExternalRecord,
  MemberDocType,
  MemberDocument,
  MemberRecord,
  MembershipEvent,
  PersonAlias,
  PersonRole,
  PublicDisclosure,
  Unit,
  WithdrawReasonCategory,
} from '../domain/types.js';
import type { BlobStorage } from '../storage/blob-storage.js';
import type { UnionRepositories } from '../storage/repositories.js';

const VALID_DOC_TYPES = new Set<MemberDocType>(['가입서', '탈퇴서', '기타']);

export function nextSeqId(values: string[], prefix: string): string {
  let maxNum = 0;
  for (const val of values) {
    if (val.startsWith(prefix)) {
      const rest = val.slice(prefix.length);
      if (/^\d+$/.test(rest)) {
        const n = Number(rest);
        if (n > maxNum) maxNum = n;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

export function normalizeWithdrawCategory(raw: string): WithdrawReasonCategory {
  const s = (raw || '기타').trim();
  const aliases: Record<string, WithdrawReasonCategory> = {
    정년: '정년퇴직',
    정년퇴직: '정년퇴직',
    계약만료: '계약만료·퇴직',
    퇴직: '계약만료·퇴직',
    퇴사: '계약만료·퇴직',
    계약만료퇴직: '계약만료·퇴직',
    '계약만료·퇴직': '계약만료·퇴직',
    '계약만료 or 퇴직': '계약만료·퇴직',
    기타: '기타',
  };
  const resolved = aliases[s];
  if (!resolved) {
    throw new Error(
      `허용되지 않은 탈퇴 사유 분류입니다: ${s} (허용: 정년퇴직, 계약만료·퇴직, 기타)`,
    );
  }
  return resolved;
}

export function resolveUnitCode(rawUnit: string, units: Unit[]): string {
  const key = rawUnit.trim();
  const hit = units.find(
    (u) =>
      u.code.toUpperCase() === key.toUpperCase() ||
      u.name === key ||
      u.shortName === key ||
      u.officialName === key,
  );
  if (!hit) {
    const valid = units.map((u) => u.code).join(', ');
    throw new Error(`등록되지 않은 조직단위입니다: ${rawUnit} (가능: ${valid})`);
  }
  return hit.code;
}

function parseDocSpec(
  rawSpec: string,
  defaultType: MemberDocType,
): { docType: MemberDocType; sourcePath: string } {
  const spec = rawSpec.trim();
  const eqIdx = spec.indexOf('=');
  if (eqIdx > 0) {
    const prefix = spec.slice(0, eqIdx).trim();
    const rest = spec.slice(eqIdx + 1).trim();
    if (VALID_DOC_TYPES.has(prefix as MemberDocType)) {
      return { docType: prefix as MemberDocType, sourcePath: rest };
    }
    throw new Error(
      `증빙 유형은 가입서, 탈퇴서, 기타 중 하나여야 합니다: ${prefix}`,
    );
  }
  return { docType: defaultType, sourcePath: spec };
}

export class MemberService {
  constructor(
    private readonly repos: UnionRepositories,
    private readonly blobs: BlobStorage,
  ) {}

  private async archiveDocFiles(
    rawSpecs: string[],
    defaultType: MemberDocType,
    prefixTag: 'JOIN' | 'WITHDRAW',
    eventDate: string,
    eventId: string,
    personId: string,
    name: string,
    docNote: string,
    txRepos: UnionRepositories,
  ): Promise<MemberDocument[]> {
    const existingDocs = await txRepos.people.listMemberDocuments();
    const docIds = existingDocs.map((d) => d.docId);
    const added: MemberDocument[] = [];
    const ymd = eventDate.replaceAll('-', '');

    for (let i = 0; i < rawSpecs.length; i += 1) {
      const spec = rawSpecs[i]!.trim();
      if (!spec) continue;
      const { docType, sourcePath } = parseDocSpec(spec, defaultType);
      const absSource = path.resolve(sourcePath);
      const ext = path.extname(absSource).toLowerCase() || '.bin';
      const suffix = i > 0 ? `_${i + 1}` : '';
      const targetKey = `applications/${prefixTag}_${ymd}_${personId}_${name}${suffix}${ext}`;

      const buf = await fs.readFile(absSource);
      const storedKey = await this.blobs.put(targetKey, buf);

      const docId = nextSeqId(docIds, 'DOC-');
      docIds.push(docId);
      const doc: MemberDocument = {
        docId,
        eventId,
        personId,
        docType,
        blobKey: storedKey,
        note: docNote.trim(),
        createdAt: eventDate,
      };
      await txRepos.people.addMemberDocument(doc);
      added.push(doc);
    }

    if (added.length === 0 && docNote.trim()) {
      const docId = nextSeqId(docIds, 'DOC-');
      const doc: MemberDocument = {
        docId,
        eventId,
        personId,
        docType: '기타',
        blobKey: '',
        note: docNote.trim(),
        createdAt: eventDate,
      };
      await txRepos.people.addMemberDocument(doc);
      added.push(doc);
    }

    return added;
  }

  private findTargetMember(
    members: MemberRecord[],
    id?: string,
    name?: string,
  ): MemberRecord {
    if (id) {
      const targetId = id.trim().toUpperCase();
      const found = members.find((m) => m.personId === targetId);
      if (!found) {
        throw new Error(`person_id '${id}'를 찾을 수 없습니다.`);
      }
      return found;
    }
    if (name) {
      const q = name.trim();
      const hits = members.filter((m) => m.name === q);
      if (hits.length === 0) {
        throw new Error(`조합원 '${q}'을(를) 찾을 수 없습니다.`);
      }
      if (hits.length > 1) {
        throw new Error(
          `동명이인이 여러 명 있습니다 (${hits.map((h) => h.personId).join(', ')}) — --id 로 지정하세요.`,
        );
      }
      return hits[0]!;
    }
    throw new Error('--id 또는 --name 중 하나는 반드시 지정해야 합니다.');
  }

  async joinMember(input: {
    name: string;
    unit: string;
    birth?: string;
    phone?: string;
    email?: string;
    shift?: string;
    empType?: string;
    date?: string;
    wish?: string;
    docs?: string[];
    docNote?: string;
    rejoinCategory?: string;
    note?: string;
  }): Promise<{
    mode: 'join' | 'rejoin';
    member: MemberRecord;
    event: MembershipEvent;
    documents: MemberDocument[];
  }> {
    const cleanName = input.name.trim();
    const cleanBirth = (input.birth ?? '').trim();
    const joinDate = input.date?.trim() || new Date().toISOString().slice(0, 10);

    return this.repos.transaction(async (txRepos) => {
      const [units, members, events] = await Promise.all([
        txRepos.units.listAll(),
        txRepos.people.listMembers(),
        txRepos.people.listEvents(),
      ]);
      const unitCode = resolveUnitCode(input.unit, units);

      if (cleanBirth) {
        const formerHits = members.filter(
          (m) =>
            m.name === cleanName &&
            m.birthDate === cleanBirth &&
            m.status !== 'active',
        );
        if (formerHits.length === 1) {
          const res = await this.applyRejoinInTx(
            txRepos,
            formerHits[0]!,
            unitCode,
            joinDate,
            events,
            input,
          );
          return { mode: 'rejoin', ...res };
        }
      }

      const personId = nextSeqId(
        members.map((m) => m.personId),
        'M-',
      );
      const eventId = nextSeqId(
        events.map((e) => e.eventId),
        'EV-',
      );
      const ymd = joinDate.replaceAll('-', '');
      const docMdPath = `_raw/applications/JOIN_${ymd}_${personId}_${cleanName}.md`;

      const member: MemberRecord = {
        personId,
        kind: 'member',
        name: cleanName,
        phone: (input.phone ?? '').trim(),
        email: (input.email ?? '').trim(),
        status: 'active',
        note: (input.note ?? '신규 가입').trim(),
        unitCode,
        birthDate: cleanBirth,
        shift: (input.shift ?? '').trim(),
        employmentType: (input.empType ?? '공무직').trim(),
        firstJoinedOn: joinDate,
        joinedOn: joinDate,
        leftOn: '',
        memberWish: (input.wish ?? '').trim(),
        applicationDocKey: '',
      };

      const event: MembershipEvent = {
        eventId,
        personId,
        eventType: 'join',
        eventDate: joinDate,
        fromUnit: null,
        toUnit: unitCode,
        reasonCategory: '',
        rejoinCategory: '',
        reason: (input.note ?? '조합원 가입').trim(),
        docMdPath,
        refundTxId: null,
      };

      await txRepos.people.upsertMember(member);
      await txRepos.people.addEvent(event);

      const documents = await this.archiveDocFiles(
        input.docs ?? [],
        '가입서',
        'JOIN',
        joinDate,
        eventId,
        personId,
        cleanName,
        input.docNote ?? '',
        txRepos,
      );
      const primaryKey = documents.find((d) => d.blobKey)?.blobKey ?? '';
      if (primaryKey) {
        member.applicationDocKey = primaryKey;
        await txRepos.people.upsertMember(member);
      }

      await txRepos.privacy.upsertRules([
        {
          ruleType: 'forbidden_name',
          matchKey: cleanName,
          replacement: '',
          note: `member:${personId}`,
        },
      ]);

      return { mode: 'join', member, event, documents };
    });
  }

  private async applyRejoinInTx(
    txRepos: UnionRepositories,
    existing: MemberRecord,
    nextUnit: string,
    rejoinDate: string,
    events: MembershipEvent[],
    input: {
      birth?: string;
      phone?: string;
      email?: string;
      shift?: string;
      empType?: string;
      wish?: string;
      docs?: string[];
      docNote?: string;
      rejoinCategory?: string;
      reason?: string;
      note?: string;
    },
  ): Promise<{
    member: MemberRecord;
    event: MembershipEvent;
    documents: MemberDocument[];
  }> {
    const eventId = nextSeqId(
      events.map((e) => e.eventId),
      'EV-',
    );
    const ymd = rejoinDate.replaceAll('-', '');
    const docMdPath = `_raw/applications/JOIN_${ymd}_${existing.personId}_${existing.name}.md`;
    const priorWithdraw = [...events]
      .reverse()
      .find(
        (ev) => ev.personId === existing.personId && ev.eventType === 'withdraw',
      );
    const defaultRejoinCat =
      priorWithdraw?.reasonCategory === '계약만료·퇴직'
        ? '계약만료 후 재입사'
        : '일반 재가입';
    const rejoinCat = (input.rejoinCategory || defaultRejoinCat).trim();
    const prevUnit = existing.unitCode || null;

    const updated: MemberRecord = {
      ...existing,
      status: 'active',
      unitCode: nextUnit,
      firstJoinedOn: existing.firstJoinedOn || existing.joinedOn || rejoinDate,
      joinedOn: rejoinDate,
      leftOn: '',
      birthDate: input.birth?.trim() || existing.birthDate,
      phone: input.phone?.trim() || existing.phone,
      email: input.email?.trim() || existing.email,
      shift: input.shift?.trim() || existing.shift,
      employmentType: input.empType?.trim() || existing.employmentType,
      memberWish: input.wish?.trim() || existing.memberWish,
      note: input.note?.trim() || existing.note,
    };

    const event: MembershipEvent = {
      eventId,
      personId: existing.personId,
      eventType: 'rejoin',
      eventDate: rejoinDate,
      fromUnit: prevUnit,
      toUnit: nextUnit,
      reasonCategory: '',
      rejoinCategory: rejoinCat,
      reason: (input.reason || input.note || rejoinCat).trim(),
      docMdPath,
      refundTxId: null,
    };

    await txRepos.people.upsertMember(updated);
    await txRepos.people.addEvent(event);

    const documents = await this.archiveDocFiles(
      input.docs ?? [],
      '가입서',
      'JOIN',
      rejoinDate,
      eventId,
      existing.personId,
      existing.name,
      input.docNote ?? '',
      txRepos,
    );
    const primaryKey = documents.find((d) => d.blobKey)?.blobKey ?? '';
    if (primaryKey) {
      updated.applicationDocKey = primaryKey;
      await txRepos.people.upsertMember(updated);
    }

    await txRepos.privacy.upsertRules([
      {
        ruleType: 'forbidden_name',
        matchKey: updated.name,
        replacement: '',
        note: `member:${updated.personId}`,
      },
    ]);

    return { member: updated, event, documents };
  }

  async rejoinMember(input: {
    id?: string;
    name?: string;
    unit?: string;
    birth?: string;
    phone?: string;
    email?: string;
    shift?: string;
    empType?: string;
    wish?: string;
    date?: string;
    rejoinCategory?: string;
    reason?: string;
    docs?: string[];
    docNote?: string;
    note?: string;
  }) {
    const rejoinDate = input.date?.trim() || new Date().toISOString().slice(0, 10);
    return this.repos.transaction(async (txRepos) => {
      const [units, members, events] = await Promise.all([
        txRepos.units.listAll(),
        txRepos.people.listMembers(),
        txRepos.people.listEvents(),
      ]);
      const target = this.findTargetMember(members, input.id, input.name);
      const nextUnit = input.unit?.trim()
        ? resolveUnitCode(input.unit, units)
        : target.unitCode;
      return this.applyRejoinInTx(
        txRepos,
        target,
        nextUnit,
        rejoinDate,
        events,
        input,
      );
    });
  }

  async withdrawMember(input: {
    id?: string;
    name?: string;
    category?: string;
    reason?: string;
    date?: string;
    refundTx?: string;
    docs?: string[];
    docNote?: string;
  }) {
    const withdrawDate = input.date?.trim() || new Date().toISOString().slice(0, 10);
    const category = normalizeWithdrawCategory(input.category ?? '기타');

    return this.repos.transaction(async (txRepos) => {
      const [members, events] = await Promise.all([
        txRepos.people.listMembers(),
        txRepos.people.listEvents(),
      ]);
      const target = this.findTargetMember(members, input.id, input.name);
      const eventId = nextSeqId(
        events.map((e) => e.eventId),
        'EV-',
      );
      const ymd = withdrawDate.replaceAll('-', '');
      const docMdPath = `_raw/applications/WITHDRAW_${ymd}_${target.personId}_${target.name}.md`;
      const refundTxId = input.refundTx?.trim() || null;

      if (refundTxId) {
        const txRow = await txRepos.ledger.findByTxId(refundTxId);
        if (!txRow) {
          throw new Error(`환급 거래번호를 원장에서 찾을 수 없습니다: ${refundTxId}`);
        }
      }

      const updated: MemberRecord = {
        ...target,
        status: 'withdrawn',
        leftOn: withdrawDate,
      };
      const event: MembershipEvent = {
        eventId,
        personId: target.personId,
        eventType: 'withdraw',
        eventDate: withdrawDate,
        fromUnit: target.unitCode || null,
        toUnit: null,
        reasonCategory: category,
        rejoinCategory: '',
        reason: (input.reason || category).trim(),
        docMdPath,
        refundTxId,
      };

      await txRepos.people.upsertMember(updated);
      await txRepos.people.addEvent(event);
      const documents = await this.archiveDocFiles(
        input.docs ?? [],
        '탈퇴서',
        'WITHDRAW',
        withdrawDate,
        eventId,
        target.personId,
        target.name,
        input.docNote ?? '',
        txRepos,
      );

      return { member: updated, event, documents };
    });
  }

  async transferMember(input: {
    id?: string;
    name?: string;
    toUnit: string;
    date?: string;
    reason?: string;
  }) {
    const transferDate = input.date?.trim() || new Date().toISOString().slice(0, 10);
    return this.repos.transaction(async (txRepos) => {
      const [units, members, events] = await Promise.all([
        txRepos.units.listAll(),
        txRepos.people.listMembers(),
        txRepos.people.listEvents(),
      ]);
      const target = this.findTargetMember(members, input.id, input.name);
      const toUnit = resolveUnitCode(input.toUnit, units);
      const fromUnit = target.unitCode || null;
      const eventId = nextSeqId(
        events.map((e) => e.eventId),
        'EV-',
      );

      const updated: MemberRecord = { ...target, unitCode: toUnit };
      const event: MembershipEvent = {
        eventId,
        personId: target.personId,
        eventType: 'transfer',
        eventDate: transferDate,
        fromUnit,
        toUnit,
        reasonCategory: '',
        rejoinCategory: '',
        reason: (input.reason || '지부 이동').trim(),
        docMdPath: '',
        refundTxId: null,
      };
      await txRepos.people.upsertMember(updated);
      await txRepos.people.addEvent(event);
      return { member: updated, event };
    });
  }

  async addExternal(input: {
    name: string;
    org?: string;
    category?: string;
    phone?: string;
    email?: string;
    note?: string;
  }): Promise<ExternalRecord> {
    const cleanName = input.name.trim();
    return this.repos.transaction(async (txRepos) => {
      const externals = await txRepos.people.listExternals();
      const personId = nextSeqId(
        externals.map((e) => e.personId),
        'E-',
      );
      const rec: ExternalRecord = {
        personId,
        kind: 'external',
        name: cleanName,
        phone: (input.phone ?? '').trim(),
        email: (input.email ?? '').trim(),
        status: 'active',
        note: (input.note ?? '').trim(),
        org: (input.org ?? '').trim(),
        category: (input.category ?? '기타').trim(),
      };
      await txRepos.people.upsertExternal(rec);
      await txRepos.privacy.upsertRules([
        {
          ruleType: 'forbidden_name',
          matchKey: cleanName,
          replacement: '',
          note: `external:${personId}`,
        },
      ]);
      return rec;
    });
  }

  async addRole(input: {
    personId: string;
    org: string;
    title: string;
    disclosure: PublicDisclosure;
    validFrom?: string | null;
    validTo?: string | null;
    isPrimary?: boolean;
  }): Promise<PersonRole> {
    return this.repos.transaction(async (txRepos) => {
      const person = await txRepos.people.findPersonById(input.personId);
      if (!person) {
        throw new Error(`인물을 찾을 수 없습니다: ${input.personId}`);
      }
      const roles = await txRepos.people.listRoles();
      const roleId = nextSeqId(
        roles.map((r) => r.roleId),
        'R-',
      );
      const role: PersonRole = {
        roleId,
        personId: input.personId,
        org: input.org.trim(),
        title: input.title.trim(),
        publicDisclosure: input.disclosure,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        isPrimary: input.isPrimary ?? true,
      };
      await txRepos.people.upsertRole(role);
      return role;
    });
  }

  async setRoleDisclosure(roleId: string, disclosure: PublicDisclosure): Promise<void> {
    await this.repos.people.setRoleDisclosure(roleId, disclosure);
  }

  async addAlias(input: {
    alias: string;
    personId: string;
    matchMode?: AliasMatchMode;
    note?: string;
  }): Promise<PersonAlias> {
    return this.repos.transaction(async (txRepos) => {
      const person = await txRepos.people.findPersonById(input.personId);
      if (!person) {
        throw new Error(`인물을 찾을 수 없습니다: ${input.personId}`);
      }
      const mode: AliasMatchMode = input.matchMode ?? 'exact';
      const aliasRow: PersonAlias = {
        alias: input.alias.trim(),
        personId: input.personId,
        matchMode: mode,
        note: (input.note ?? '').trim(),
      };
      await txRepos.people.upsertAlias(aliasRow);
      if (mode === 'exact') {
        await txRepos.privacy.upsertRules([
          {
            ruleType: 'forbidden_name',
            matchKey: aliasRow.alias,
            replacement: '',
            note: `alias:${aliasRow.personId}`,
          },
        ]);
      }
      return aliasRow;
    });
  }

  async linkDocumentLedger(input: {
    docId: string;
    txId: string;
    relationNote?: string;
  }): Promise<DocumentLedgerLink> {
    return this.repos.transaction(async (txRepos) => {
      const txRow = await txRepos.ledger.findByTxId(input.txId);
      if (!txRow) {
        throw new Error(`원장 거래번호를 찾을 수 없습니다: ${input.txId}`);
      }
      const link: DocumentLedgerLink = {
        docId: input.docId.trim(),
        txId: input.txId.trim(),
        relationNote: (input.relationNote ?? '').trim(),
        createdAt: new Date().toISOString().slice(0, 10),
      };
      await txRepos.links.upsert(link);
      return link;
    });
  }
}
