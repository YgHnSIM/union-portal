import type { DocCategory, LedgerEntry, Unit } from './types.js';

export interface PublicLedgerMeta {
  syncedAt: string;
  totalRecords: number;
  monthsRange: [string, string];
  sanitized: boolean;
}

export interface PublicLedgerRecord {
  tx_id: string;
  unit: string;
  year: number;
  ym: string;
  date: string;
  gubun: string;
  gwan: string;
  hang: string;
  mok: string;
  exp_type: string;
  fund: string;
  target: string;
  attr_ym: string;
  inc: number;
  exp: number;
  unit_bal: number;
  note: string;
  memo: string;
}

export interface PublicLedgerJson {
  meta: PublicLedgerMeta;
  records: PublicLedgerRecord[];
}

export interface OrgUnitSummary {
  code: string;
  officialName: string;
  shortName: string;
  fullName: string;
  status: string;
  activeCount: number;
  byEmployment: Record<string, number>;
  byShift: Record<string, number>;
}

export interface MonthlyMembershipFlow {
  ym: string;
  joins: number;
  rejoins: number;
  withdraws: number;
  transfers: number;
}

export interface OrgSummaryJson {
  generatedAt: string;
  totalActive: number;
  totalHistorical: number;
  units: OrgUnitSummary[];
  monthlyFlows: MonthlyMembershipFlow[];
}

export interface PublicOfficialRecord {
  roleId: string;
  personId: string;
  kind: string;
  roleScope?: string;
  termLabel?: string;
  sortOrder?: number;
  name: string;
  org: string;
  title: string;
  memberUnitCode?: string | null;
  memberUnitName?: string | null;
  validFrom: string | null;
  validTo: string | null;
  isPrimary: boolean;
}

export interface PublicOfficialsJson {
  officials: PublicOfficialRecord[];
}

export interface PublicLinkEntry {
  txId: string;
  docId: string;
  docTitle: string;
  category: DocCategory;
  route: string;
  relationNote: string;
}

export interface PublicDocumentLinksJson {
  links: Array<{
    docId: string;
    txId: string;
    relationNote: string;
    createdAt: string;
  }>;
}

export function toPublicLedgerRecord(entry: LedgerEntry): PublicLedgerRecord {
  return {
    tx_id: entry.txId,
    unit: entry.unitName,
    year: entry.year,
    ym: entry.ym,
    date: entry.date,
    gubun: entry.gubun,
    gwan: entry.gwan,
    hang: entry.hang,
    mok: entry.mok,
    exp_type: entry.expType,
    fund: entry.fund,
    target: entry.target,
    attr_ym: entry.attrYm,
    inc: entry.inc,
    exp: entry.exp,
    unit_bal: entry.unitBal,
    note: entry.note,
    memo: entry.memo,
  };
}

export function fromPublicLedgerRecord(
  record: PublicLedgerRecord,
  unitCode = '',
): LedgerEntry {
  return {
    txId: record.tx_id,
    unitCode,
    unitName: record.unit,
    year: record.year,
    ym: record.ym,
    date: record.date,
    gubun: record.gubun,
    gwan: record.gwan,
    hang: record.hang,
    mok: record.mok,
    expType: record.exp_type,
    fund: record.fund,
    target: record.target,
    attrYm: record.attr_ym,
    inc: record.inc,
    exp: record.exp,
    unitBal: record.unit_bal,
    note: record.note,
    memo: record.memo,
  };
}

export function publicLedgerToEntries(
  pub: Pick<PublicLedgerJson, 'records'>,
  unitByName?: ReadonlyMap<string, Unit>,
): LedgerEntry[] {
  return pub.records.map((r) =>
    fromPublicLedgerRecord(r, unitByName?.get(r.unit)?.code ?? ''),
  );
}

/**
 * Determines whether a public_official record should appear on the public /union/ portal
 * (excludes external reps and rotating staff per ADR-0003).
 */
export function isActiveUnionOfficialForPortal(
  official: PublicOfficialRecord,
  currentYm: string,
): boolean {
  if (official.kind !== 'member') return false;
  if (
    official.roleScope === 'external_rep' ||
    official.roleScope === 'staff_rotating'
  ) {
    return false;
  }
  if (!official.name) return false;
  const fromOk = !official.validFrom || official.validFrom.slice(0, 7) <= currentYm;
  const toOk = !official.validTo || official.validTo.slice(0, 7) >= currentYm;
  return fromOk && toOk;
}
