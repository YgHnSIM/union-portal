import assert from 'node:assert/strict';
import test from 'node:test';
import {
  summarizePeriod,
  validateLedgerRecords,
} from '../src/domain/accounting.js';
import type { Account, LedgerEntry } from '../src/domain/types.js';

const ACCOUNTS: Account[] = [
  {
    category: '기초이월',
    gwan: '기초이월',
    hang: '기초이월',
    mok: '전년도 이월잔액',
    description: '',
  },
  {
    category: '수입',
    gwan: '조합비수입',
    hang: '정기조합비',
    mok: '공무직 조합비',
    description: '',
  },
  {
    category: '지출',
    gwan: '운영비',
    hang: '회의비',
    mok: '정기 운영위원회',
    description: '',
  },
  {
    category: '내부이전',
    gwan: '내부이전',
    hang: '정기교부금',
    mok: '지부 교부금',
    description: '',
  },
];

function makeEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    txId: 'HQ-2026-001',
    unitCode: 'HQ',
    unitName: '본부',
    year: 2026,
    ym: '2026-01',
    date: '2026-01-01',
    gubun: '수입',
    gwan: '조합비수입',
    hang: '정기조합비',
    mok: '공무직 조합비',
    expType: '',
    fund: '일반회계',
    target: '조합원',
    attrYm: '2026-01',
    inc: 0,
    exp: 0,
    unitBal: 0,
    note: '',
    memo: '',
    ...overrides,
  };
}

test('정상 원장은 COA 및 잔액 검증을 통과하고 내부이전을 상계 집계한다', () => {
  const entries: LedgerEntry[] = [
    makeEntry({
      txId: 'HQ-2026-001',
      gubun: '기초이월',
      gwan: '기초이월',
      hang: '기초이월',
      mok: '전년도 이월잔액',
      inc: 100000,
      unitBal: 100000,
    }),
    makeEntry({
      txId: 'HQ-2026-002',
      gubun: '수입',
      inc: 50000,
      unitBal: 150000,
    }),
    makeEntry({
      txId: 'HQ-2026-003',
      gubun: '내부이전(전출)',
      gwan: '내부이전',
      hang: '정기교부금',
      mok: '지부 교부금',
      exp: 30000,
      unitBal: 120000,
    }),
    makeEntry({
      txId: 'AY-2026-001',
      unitCode: 'AY',
      unitName: '안물',
      gubun: '내부이전(전입)',
      gwan: '내부이전',
      hang: '정기교부금',
      mok: '지부 교부금',
      inc: 30000,
      unitBal: 30000,
    }),
    makeEntry({
      txId: 'AY-2026-002',
      unitCode: 'AY',
      unitName: '안물',
      gubun: '지출',
      gwan: '운영비',
      hang: '회의비',
      mok: '정기 운영위원회',
      exp: 10000,
      unitBal: 20000,
    }),
  ];

  const val = validateLedgerRecords(entries, ACCOUNTS);
  assert.deepEqual(val.errors, []);
  assert.deepEqual(val.unitBalances, { 본부: 120000, 안물: 20000 });

  const sum = summarizePeriod(entries);
  assert.equal(sum.op, 100000);
  assert.equal(sum.inc, 50000);
  assert.equal(sum.exp, 10000);
  assert.equal(sum.trNet, 0);
  assert.equal(sum.net, 40000);
});

test('미등록 COA, 누적잔액 불일치, 엑셀 수식 오류를 검출한다', () => {
  const entries: LedgerEntry[] = [
    makeEntry({
      txId: 'HQ-2026-001',
      gwan: '없는관',
      inc: 1000,
      unitBal: 9999,
      note: '#REF! 오류',
    }),
  ];
  const val = validateLedgerRecords(entries, ACCOUNTS);
  assert.equal(val.errors.length, 3);
});
