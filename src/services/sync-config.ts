import fs from 'node:fs/promises';
import path from 'node:path';
import type { Account, Unit } from '../domain/types.js';
import type { UnionRepositories } from '../storage/repositories.js';

interface RawUnitsJson {
  units: Array<{
    code: string;
    name: string;
    officialName?: string;
    shortName?: string;
    fullName: string;
    status: 'active' | 'closed';
    openedOn: string | null;
    closedOn: string | null;
    ledgerSheet: string | null;
    rawDir: string | null;
    note?: string;
  }>;
}

interface RawCoaJson {
  accounts: Array<{
    category: string;
    gwan: string;
    hang: string;
    mok: string;
    description?: string;
  }>;
}

export const DEFAULT_OFFICIAL_UNIT_NAMES: Record<
  string,
  { official: string; short: string }
> = {
  HQ: { official: '본조', short: '본부' },
  AY: { official: '안양지부', short: '안물' },
  BP: { official: '부평지부', short: '부평물' },
  SS: { official: '서서울지부', short: '서물' },
};

export async function syncMasterConfig(options: {
  projectRoot: string;
  repos: UnionRepositories;
}): Promise<{ unitsSynced: number; accountsSynced: number }> {
  const absRoot = path.resolve(options.projectRoot);
  const unitsPath = path.join(absRoot, 'config', 'units.json');
  const coaPath = path.join(absRoot, 'config', 'coa.json');

  const [unitsRaw, coaRaw] = await Promise.all([
    fs.readFile(unitsPath, 'utf8'),
    fs.readFile(coaPath, 'utf8'),
  ]);

  const unitsJson = JSON.parse(unitsRaw.replace(/^\uFEFF/, '')) as RawUnitsJson;
  const coaJson = JSON.parse(coaRaw.replace(/^\uFEFF/, '')) as RawCoaJson;

  if (!Array.isArray(unitsJson.units) || unitsJson.units.length === 0) {
    throw new Error(`유효한 units 배열이 없습니다: ${unitsPath}`);
  }
  if (!Array.isArray(coaJson.accounts) || coaJson.accounts.length === 0) {
    throw new Error(`유효한 accounts 배열이 없습니다: ${coaPath}`);
  }

  const unitRows: Unit[] = unitsJson.units.map((u) => {
    const defaults = DEFAULT_OFFICIAL_UNIT_NAMES[u.code];
    return {
      code: u.code,
      name: u.name,
      officialName: u.officialName ?? defaults?.official ?? u.name,
      shortName: u.shortName ?? defaults?.short ?? u.name,
      fullName: u.fullName,
      status: u.status,
      openedOn: u.openedOn,
      closedOn: u.closedOn,
      ledgerSheet: u.ledgerSheet,
      rawDir: u.rawDir,
      note: u.note ?? '',
    };
  });

  const accountRows: Account[] = coaJson.accounts.map((a) => ({
    category: a.category,
    gwan: a.gwan,
    hang: a.hang,
    mok: a.mok,
    description: a.description ?? '',
  }));

  await options.repos.transaction(async (txRepos) => {
    await txRepos.units.upsertMany(unitRows);
    await txRepos.accounts.replaceAll(accountRows);
  });

  return {
    unitsSynced: unitRows.length,
    accountsSynced: accountRows.length,
  };
}
