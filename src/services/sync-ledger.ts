import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { validateLedgerRecords } from '../domain/accounting.js';
import {
  collectPersonNames,
  normalizePersonMentions,
} from '../domain/person-normalizer.js';
import type {
  LedgerEntry,
  LedgerPersonLink,
  Person,
  Unit,
} from '../domain/types.js';
import type { UnionRepositories } from '../storage/repositories.js';

export interface RawJsonLedgerRow {
  tx_id: string;
  unit: string;
  year: number;
  ym: string;
  date: string;
  gubun: string;
  gwan: string;
  hang: string;
  mok: string;
  exp_type?: string;
  fund?: string;
  target?: string;
  attr_ym?: string;
  inc?: number;
  exp?: number;
  unit_bal?: number;
  note?: string;
  memo?: string;
}

export function buildUnitLookup(units: Unit[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of units) {
    map.set(u.code.toUpperCase(), u.code);
    map.set(u.name, u.code);
    map.set(u.shortName, u.code);
    map.set(u.officialName, u.code);
    map.set(u.fullName, u.code);
  }
  return map;
}

const XLUDF_STRING_FALLBACK_RE =
  /^IFERROR\(__xludf\.DUMMYFUNCTION\("""COMPUTED_VALUE"""\),"(.*)"\)$/s;

function unwrapExcelCell(value: ExcelJS.CellValue): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if ('error' in value && typeof value.error === 'string') {
      return value.error;
    }
    if ('result' in value) {
      const res = value.result;
      if (res && typeof res === 'object' && 'error' in res) {
        return String((res as { error: unknown }).error);
      }
      if (res instanceof Date) {
        if (!Number.isNaN(res.getTime())) return res;
        if ('formula' in value && typeof value.formula === 'string') {
          const m = value.formula.match(XLUDF_STRING_FALLBACK_RE);
          if (m) return m[1]!.replace(/""/g, '"');
        }
        return null;
      }
      if (typeof res === 'string' || typeof res === 'number') return res;
      if (res === undefined || res === null) {
        if ('formula' in value && typeof value.formula === 'string') {
          const m = value.formula.match(XLUDF_STRING_FALLBACK_RE);
          if (m) return m[1]!.replace(/""/g, '"');
        }
        return null;
      }
      return String(res);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function cellToString(value: ExcelJS.CellValue): string {
  const raw = unwrapExcelCell(value);
  if (raw === null) return '';
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10);
  }
  return String(raw).trim();
}

function cellToYm(value: ExcelJS.CellValue): string {
  const raw = unwrapExcelCell(value);
  if (raw === null) return '';
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 7);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2})/);
  return m ? m[1]! : s;
}

function cellToInt(value: ExcelJS.CellValue): number {
  const raw = unwrapExcelCell(value);
  if (raw === null || raw === '') return 0;
  if (typeof raw === 'number') return Math.round(raw);
  const parsed = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export async function parseLedgerFromXlsx(
  xlsxPath: string,
  unitLookup: Map<string, string>,
): Promise<LedgerEntry[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet('통합원장');
  if (!ws) {
    throw new Error(`XLSX 파일에 '통합원장' 시트가 없습니다: ${xlsxPath}`);
  }

  const entries: LedgerEntry[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const txId = cellToString(row.getCell(1).value);
    if (!txId) return;
    const unitName = cellToString(row.getCell(2).value);
    const unitCode = unitLookup.get(unitName) ?? unitLookup.get(unitName.toUpperCase());
    if (!unitCode) {
      throw new Error(`알 수 없는 회계단위 '${unitName}' (row ${rowNumber}, tx ${txId})`);
    }
    entries.push({
      txId,
      unitCode,
      unitName,
      year: cellToInt(row.getCell(3).value),
      ym: cellToYm(row.getCell(4).value),
      date: cellToString(row.getCell(5).value),
      gubun: cellToString(row.getCell(6).value),
      gwan: cellToString(row.getCell(7).value),
      hang: cellToString(row.getCell(8).value),
      mok: cellToString(row.getCell(9).value),
      expType: cellToString(row.getCell(10).value),
      fund: cellToString(row.getCell(11).value),
      target: cellToString(row.getCell(12).value),
      attrYm: cellToYm(row.getCell(13).value),
      inc: cellToInt(row.getCell(14).value),
      exp: cellToInt(row.getCell(15).value),
      unitBal: cellToInt(row.getCell(16).value),
      note: cellToString(row.getCell(17).value),
      memo: cellToString(row.getCell(18).value),
    });
  });

  return entries;
}

export async function parseLedgerFromJson(
  jsonPath: string,
  unitLookup: Map<string, string>,
): Promise<LedgerEntry[]> {
  const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as RawJsonLedgerRow[];
  return raw.map((r) => {
    const unitName = String(r.unit ?? '').trim();
    const unitCode = unitLookup.get(unitName) ?? unitLookup.get(unitName.toUpperCase());
    if (!unitCode) {
      throw new Error(`알 수 없는 회계단위 '${unitName}' (tx ${r.tx_id})`);
    }
    return {
      txId: String(r.tx_id),
      unitCode,
      unitName,
      year: Number(r.year),
      ym: String(r.ym),
      date: String(r.date),
      gubun: String(r.gubun),
      gwan: String(r.gwan),
      hang: String(r.hang),
      mok: String(r.mok),
      expType: String(r.exp_type ?? ''),
      fund: String(r.fund ?? ''),
      target: String(r.target ?? ''),
      attrYm: String(r.attr_ym ?? ''),
      inc: Math.round(Number(r.inc ?? 0)),
      exp: Math.round(Number(r.exp ?? 0)),
      unitBal: Math.round(Number(r.unit_bal ?? 0)),
      note: String(r.note ?? ''),
      memo: String(r.memo ?? ''),
    };
  });
}

export function computeLedgerPersonLinks(
  entries: LedgerEntry[],
  allPeople: Person[],
): LedgerPersonLink[] {
  const links: LedgerPersonLink[] = [];
  const seen = new Set<string>();
  for (const r of entries) {
    for (const p of allPeople) {
      if (!p.name) continue;
      let matchField: 'target' | 'note' | null = null;
      if (r.target.includes(p.name)) matchField = 'target';
      else if (r.note.includes(p.name)) matchField = 'note';
      if (matchField) {
        const key = `${r.txId}\0${p.personId}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ txId: r.txId, personId: p.personId, matchField });
        }
      }
    }
  }
  return links;
}

export async function syncLedgerFromFile(
  repos: UnionRepositories,
  inputPath: string,
  syncedAtOverride?: string,
): Promise<{
  totalRecords: number;
  unitBalances: Record<string, number>;
  monthsRange: [string, string];
  linksCount: number;
}> {
  const absInput = path.resolve(inputPath);
  const ext = path.extname(absInput).toLowerCase();

  return repos.transaction(async (txRepos) => {
    const [units, accounts, bundle] = await Promise.all([
      txRepos.units.listAll(),
      txRepos.accounts.listAll(),
      txRepos.people.getDirectoryBundle(),
    ]);
    const unitLookup = buildUnitLookup(units);
    const knownNames = collectPersonNames(bundle);

    const rawEntries =
      ext === '.xlsx'
        ? await parseLedgerFromXlsx(absInput, unitLookup)
        : ext === '.json'
          ? await parseLedgerFromJson(absInput, unitLookup)
          : (() => {
              throw new Error(`지원하지 않는 원장 파일 형식입니다: ${absInput}`);
            })();

    const entries =
      ext === '.xlsx'
        ? rawEntries.map((r) => ({
            ...r,
            target: normalizePersonMentions(r.target, knownNames, bundle),
            note: normalizePersonMentions(r.note, knownNames, bundle),
          }))
        : rawEntries;

    const validation = validateLedgerRecords(entries, accounts);
    if (validation.errors.length > 0) {
      throw new Error(
        `원장 검증 실패 (${validation.errors.length}건): ${validation.errors.slice(0, 5).join('; ')}`,
      );
    }

    const links = computeLedgerPersonLinks(entries, bundle.people);
    await txRepos.ledger.replaceAllAndSyncLinks(entries, links);

    const yms = entries.map((e) => e.ym).filter(Boolean).sort();
    const monthsRange: [string, string] = [yms[0] ?? '', yms[yms.length - 1] ?? ''];
    const syncedAt =
      syncedAtOverride ?? new Date().toISOString().slice(0, 19);

    await txRepos.syncMeta.set(
      'ledger_sync',
      JSON.stringify({
        syncedAt,
        sourcePath: absInput,
        totalRecords: entries.length,
        unitBalances: validation.unitBalances,
        monthsRange,
      }),
    );

    return {
      totalRecords: entries.length,
      unitBalances: validation.unitBalances,
      monthsRange,
      linksCount: links.length,
    };
  });
}
