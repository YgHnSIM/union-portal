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

const FORMULA_ERRORS = ['#REF!', '#NAME?', '#VALUE!', '#N/A', '#DIV/0!'] as const;

export interface AnnualCoaSummaryRow {
  category: string;
  gwan: string;
  hang: string;
  mok: string;
  count: number;
  prevAmount: number;
  currentAmount: number;
  diffAmount: number;
  pctText: string;
}

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
  const seenTxIds = new Set<string>();

  for (const r of records) {
    if (seenTxIds.has(r.txId)) {
      errors.push(`Duplicate tx_id: ${r.txId}`);
    }
    seenTxIds.add(r.txId);

    if (r.inc < 0 || r.exp < 0) {
      errors.push(`Negative amount at ${r.txId}: inc=${r.inc}, exp=${r.exp}`);
    }

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
      if (val.startsWith('=')) {
        errors.push(`Unresolved formula '${val}' at ${r.txId}`);
      }
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

/**
 * Aggregates annual 3-tier COA (관·항·목) figures and year-over-year diffs.
 */
export function summarizeAnnualCoa(
  currentYearRecords: LedgerEntry[],
  prevYearRecords: LedgerEntry[],
  accounts: Account[],
  currentSummary?: PeriodSummary,
): AnnualCoaSummaryRow[] {
  const cs = currentSummary ?? summarizePeriod(currentYearRecords);
  const rows: AnnualCoaSummaryRow[] = [];

  for (const acc of accounts) {
    const { category, gwan, hang, mok } = acc;
    if (category === '기초이월' || category === '이월차액') continue;

    let currentAmount = 0;
    let prevAmount = 0;
    let count = 0;
    let pctText = '-';

    if (category === '내부이전') {
      for (const r of currentYearRecords) {
        if (r.gwan === gwan && r.hang === hang && r.mok === mok) {
          currentAmount += r.gubun.includes('전출') ? r.exp : r.inc;
          count += 1;
        }
      }
      for (const r of prevYearRecords) {
        if (r.gwan === gwan && r.hang === hang && r.mok === mok) {
          prevAmount += r.gubun.includes('전출') ? r.exp : r.inc;
        }
      }
    } else {
      const useInc = category === '수입';
      for (const r of currentYearRecords) {
        if (r.gubun === category && r.gwan === gwan && r.hang === hang && r.mok === mok) {
          currentAmount += useInc ? r.inc : r.exp;
          count += 1;
        }
      }
      for (const r of prevYearRecords) {
        if (r.gubun === category && r.gwan === gwan && r.hang === hang && r.mok === mok) {
          prevAmount += useInc ? r.inc : r.exp;
        }
      }
      const denom = useInc ? cs.inc || 1 : cs.exp || 1;
      pctText = `${((currentAmount / denom) * 100).toFixed(1)}%`;
    }

    if (currentAmount === 0 && prevAmount === 0) continue;

    rows.push({
      category,
      gwan,
      hang,
      mok,
      count,
      prevAmount,
      currentAmount,
      diffAmount: currentAmount - prevAmount,
      pctText,
    });
  }

  return rows;
}
