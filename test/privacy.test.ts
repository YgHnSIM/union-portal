import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STRIP_TOKENS } from '../src/domain/person-normalizer.js';
import {
  auditDocumentPrivacy,
  computePrivacyHashes,
  isPublicOfficialOn,
  sanitizeLedgerRecords,
  scanTextWithHashes,
} from '../src/domain/privacy.js';
import type { DirectoryBundle, LedgerEntry } from '../src/domain/types.js';

function makePrivacyBundle(): DirectoryBundle {
  return {
    people: [
      {
        personId: 'M-9001',
        kind: 'member',
        name: '홍길동',
        phone: '010-0000-0000',
        email: 'hong@example.org',
        status: 'active',
        note: '',
      },
      {
        personId: 'M-9002',
        kind: 'member',
        name: '김철수',
        phone: '',
        email: '',
        status: 'active',
        note: '',
      },
      {
        personId: 'M-9003',
        kind: 'member',
        name: '박민수',
        phone: '',
        email: '',
        status: 'active',
        note: '',
      },
      {
        personId: 'E-9001',
        kind: 'external',
        name: '이영희',
        phone: '',
        email: '',
        status: 'active',
        note: '',
      },
    ],
    members: [
      {
        personId: 'M-9001',
        kind: 'member',
        name: '홍길동',
        phone: '010-0000-0000',
        email: 'hong@example.org',
        status: 'active',
        note: '',
        unitCode: 'HQ',
        birthDate: '900101',
        shift: '주간',
        employmentType: '공무직',
        firstJoinedOn: '2025-01-01',
        joinedOn: '2025-01-01',
        leftOn: '',
        memberWish: '',
        applicationDocKey: '',
      },
      {
        personId: 'M-9002',
        kind: 'member',
        name: '김철수',
        phone: '',
        email: '',
        status: 'active',
        note: '',
        unitCode: 'AY',
        birthDate: '',
        shift: '',
        employmentType: '공무직',
        firstJoinedOn: '2025-01-01',
        joinedOn: '2025-01-01',
        leftOn: '',
        memberWish: '',
        applicationDocKey: '',
      },
      {
        personId: 'M-9003',
        kind: 'member',
        name: '박민수',
        phone: '',
        email: '',
        status: 'active',
        note: '',
        unitCode: 'BP',
        birthDate: '',
        shift: '',
        employmentType: '공무직',
        firstJoinedOn: '2025-01-01',
        joinedOn: '2025-01-01',
        leftOn: '',
        memberWish: '',
        applicationDocKey: '',
      },
    ],
    externals: [
      {
        personId: 'E-9001',
        kind: 'external',
        name: '이영희',
        phone: '',
        email: '',
        status: 'active',
        note: '',
        org: '교섭대표노조',
        category: '연대노조',
      },
    ],
    membershipEvents: [],
    memberDocuments: [],
    aliases: [
      {
        alias: '박 반장',
        personId: 'M-9003',
        matchMode: 'exact',
        note: '',
      },
    ],
    roles: [
      {
        roleId: 'R-9001',
        personId: 'M-9001',
        org: '본조',
        title: '위원장',
        publicDisclosure: 'public_official',
        validFrom: '2025-01',
        validTo: '2026-08',
        isPrimary: true,
      },
      {
        roleId: 'R-9002',
        personId: 'M-9002',
        org: '안양지부',
        title: '소통간사',
        publicDisclosure: 'masked',
        validFrom: null,
        validTo: null,
        isPrimary: true,
      },
      {
        roleId: 'R-9003',
        personId: 'E-9001',
        org: '교섭대표노조',
        title: '위원장',
        publicDisclosure: 'public_official',
        validFrom: null,
        validTo: null,
        isPrimary: true,
      },
    ],
    stripTokens: DEFAULT_STRIP_TOKENS,
    privacy: {
      forbiddenNames: ['홍길동', '김철수', '박민수', '이영희', '박 반장'],
      targetMask: { 김철수: '조합원' },
      exactNoteReplacements: { '김철수 모친상 조의금': '조합원 경조사(안물)' },
    },
    idToName: {
      'M-9001': '홍길동',
      'M-9002': '김철수',
      'M-9003': '박민수',
      'E-9001': '이영희',
    },
  };
}

test('시점별 public_disclosure 판정 (임기 전·중·후)', () => {
  const bundle = makePrivacyBundle();
  assert.equal(isPublicOfficialOn(bundle.roles, 'M-9001', '2024-12-15'), false);
  assert.equal(isPublicOfficialOn(bundle.roles, 'M-9001', '2026-05-01'), true);
  assert.equal(isPublicOfficialOn(bundle.roles, 'M-9001', '2026-09-01'), false);
  assert.equal(isPublicOfficialOn(bundle.roles, 'M-9002', '2026-05-01'), false);
  assert.equal(isPublicOfficialOn(bundle.roles, 'E-9001', '2026-05-01'), true);
});

test('sanitizeLedgerRecords는 target/note/memo에서 개인 실명을 비식별 처리한다', () => {
  const bundle = makePrivacyBundle();
  const raw: LedgerEntry[] = [
    {
      txId: 'HQ-2026-901',
      unitCode: 'HQ',
      unitName: '본부',
      year: 2026,
      ym: '2026-05',
      date: '2026-05-10',
      gubun: '지출',
      gwan: '조합원복지·연대비',
      hang: '경조·예우',
      mok: '조합원·임원 경조사',
      expType: '경조금·화환',
      fund: '일반회계',
      target: '김철수 님',
      attrYm: '2026-05',
      inc: 0,
      exp: 100000,
      unitBal: 100000,
      note: '김철수님 모친상 조의금',
      memo: '이영희 찬조 확인',
    },
  ];
  const clean = sanitizeLedgerRecords(raw, bundle);
  assert.equal(clean[0]!.target, '조합원');
  assert.equal(clean[0]!.note, '조합원 경조사(안물)');
  assert.equal(clean[0]!.memo, '관계자 찬조 확인');
});

test('auditDocumentPrivacy는 공적 문맥의 현임 공식 직무자·외부 공적 대표자는 허용하고, 소통간사·재정문맥 내 임원은 차단한다', () => {
  const bundle = makePrivacyBundle();
  const doc = `---
id: "mom:202605"
---
# 2026년 5월 운영위원회 회의록
- 참석자: 홍길동(위원장), 김철수(소통간사), 이영희(교섭대표노조 위원장)
## 2. 재정 현황 보고
- 특별 찬조: 홍길동 전 위원장 200,000원 입금
`;
  const findings = auditDocumentPrivacy(
    { eventOn: '2026-05-10', category: 'mom' },
    doc,
    bundle,
  );
  assert.equal(findings.length, 2);
  assert.equal(findings[0]!.type, 'masked_person');
  assert.equal(findings[1]!.type, 'finance_context_name');
});

test('HMAC-SHA256 해시 인덱스가 원문 실명·별칭·전화번호 유출을 탐지하고 정제본은 통과한다', () => {
  const bundle = makePrivacyBundle();
  const salt = 'test-salt-secret-value';
  const index = computePrivacyHashes(bundle, salt);

  const leaked = scanTextWithHashes(
    '참석자 박 반장 연락처 010-0000-0000 및 김철수',
    index,
    salt,
  );
  assert.ok(leaked.length >= 3);

  const clean = scanTextWithHashes(
    '참석자 위원장 1명 및 소통간사 1명',
    index,
    salt,
  );
  assert.equal(clean.length, 0);
});


test('auditDocumentPrivacy는 HTML data-privacy-zone="finance" 내부 임원도 차단하고 연혁 문서에 allowHistoricalOfficials를 허용한다', () => {
  const bundle = makePrivacyBundle();
  const retiredBundle: DirectoryBundle = {
    ...bundle,
    roles: [
      {
        roleId: 'R-9009',
        personId: 'M-9001',
        org: '본조',
        title: '초대 위원장',
        publicDisclosure: 'public_official',
        validFrom: '2018-01',
        validTo: '2020-12',
        isPrimary: true,
      },
    ],
  };

  const html = `<article>
    <p>행사 인사말: 홍길동 초대 위원장</p>
    <section data-privacy-zone="finance">
      <p>전달 금액: 홍길동 찬조 100,000원</p>
    </section>
  </article>`;

  const defaultFindings = auditDocumentPrivacy(
    { eventOn: '2026-05-10', category: 'notice', isHtml: true, allowHistoricalOfficials: false },
    html,
    retiredBundle,
  );
  // Outside finance zone fails as masked_person when retired & !allowHistoricalOfficials, inside fails as finance_context_name
  assert.ok(defaultFindings.some((f) => f.type === 'masked_person'));
  assert.ok(defaultFindings.some((f) => f.type === 'finance_context_name'));

  const historyFindings = auditDocumentPrivacy(
    { eventOn: '2026-05-10', category: 'notice', isHtml: true, allowHistoricalOfficials: true },
    html,
    retiredBundle,
  );
  assert.equal(historyFindings.length, 1);
  assert.equal(historyFindings[0]!.type, 'finance_context_name');
});
