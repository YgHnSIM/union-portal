import type { Account, LedgerEntry } from './types.js';

export interface PeriodSummary {
  op: number;
  inc: number;
  exp: number;
  trIn: number;
  trOut: number;
  trNet: number;
  adj: number;
  net: number;
  hqExp: number;
}

const FORMULA_ERRORS = ['#REF!', '#NAME?', '#VALUE!', '#N/A'] as const;

export function summarizePeriod(records: LedgerEntry[]): PeriodSummary {
  let op = 0;
  let inc = 0;
  let exp = 0;
  let trIn = 0;
  let trOut = 0;
  let adj = 0;

  for (const r of records) {
    if (r.gubun === '기초이월') op += r.inc;
    else if (r.gubun === '수입') inc += r.inc;
    else if (r.gubun === '지출') exp += r.exp;
    else if (r.gubun === '내부이전(전입)') trIn += r.inc;
    else if (r.gubun === '내부이전(전출)') trOut += r.exp;
    else if (r.gubun === '이월차액') adj += r.inc - r.exp;
  }

  const trNet = trIn - trOut;
  const net = inc - exp + trNet + adj;
  return {
    op,
    inc,
    exp,
    trIn,
    trOut,
    trNet,
    adj,
    net,
    hqExp: exp + trOut,
  };
}

export function validateLedgerRecords(
  records: LedgerEntry[],
  accounts: Account[],
): { unitBalances: Record<string, number>; errors: string[] } {
  const errors: string[] = [];
  const validCoa = new Set(
    accounts.map(
      (a) =>
        `${a.category === '내부이전' ? '내부이전' : a.category}\0${a.gwan}\0${a.hang}\0${a.mok}`,
    ),
  );

  const unitBalances: Record<string, number> = {};

  for (const r of records) {
    const cat = r.gubun.startsWith('내부이전') ? '내부이전' : r.gubun;
    const key = `${cat}\0${r.gwan}\0${r.hang}\0${r.mok}`;
    if (!validCoa.has(key)) {
      errors.push(
        `Invalid COA at ${r.txId}: (${cat}, ${r.gwan}, ${r.hang}, ${r.mok})`,
      );
    }

    const fieldsToScan = [
      r.txId,
      r.unitName,
      r.gubun,
      r.gwan,
      r.hang,
      r.mok,
      r.target,
      r.note,
      r.memo,
    ];
    for (const val of fieldsToScan) {
      for (const errTok of FORMULA_ERRORS) {
        if (val.includes(errTok)) {
          errors.push(`Formula error '${errTok}' at ${r.txId}`);
        }
      }
    }

    const prev = unitBalances[r.unitName] ?? 0;
    const next = prev + r.inc - r.exp;
    unitBalances[r.unitName] = next;
    if (next !== r.unitBal) {
      errors.push(
        `Balance mismatch at ${r.txId}: expected ${next}, got ${r.unitBal}`,
      );
    }
  }

  return { unitBalances, errors };
}
