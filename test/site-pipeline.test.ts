import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computePrivacyHashes } from '../src/domain/privacy.js';
import { buildSite } from '../src/site/build-site.js';
import { generateRedirects } from '../src/site/generate-redirects.js';
import { validateSite } from '../src/site/validate-site.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SALT = 'unit-test-hmac-salt-fixed-secret-0123';

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

async function createSiteFixture(tmpDir: string): Promise<void> {
  // Config & Schemas & Minimal Assets & Bylaws
  await copyDir(path.join(REPO_ROOT, '_source', 'schemas'), path.join(tmpDir, '_source', 'schemas'));
  await copyDir(path.join(REPO_ROOT, '_source', 'union'), path.join(tmpDir, '_source', 'union'));
  await copyDir(path.join(REPO_ROOT, 'config'), path.join(tmpDir, 'config'));
  await copyDir(path.join(REPO_ROOT, 'web', 'assets'), path.join(tmpDir, 'web', 'assets'));

  // Catalog, Topics, Sources (fictional test documents)
  await fs.writeFile(
    path.join(tmpDir, '_source', 'topics.json'),
    JSON.stringify(
      {
        topics: [
          { id: 'op-committee', label: '운영위원회' },
          { id: 'working-conditions', label: '근로조건' },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(tmpDir, '_source', 'sources.json'),
    JSON.stringify({ sources: [] }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(tmpDir, '_source', 'catalog.json'),
    JSON.stringify(
      {
        $schema: 'https://yghnsim.github.io/union-portal/schema/catalog.schema.json',
        schemaVersion: 3,
        documents: [
          {
            id: 'statement:202605_test',
            category: 'statement',
            route: 'archive/statement/202605_test.html',
            title: '현장 노동조건 개선 촉구 성명서',
            summary: '근로조건 개선 요구 성명서 테스트 문서입니다.',
            dates: {
              publishedOn: '2026-05-20',
              modifiedOn: '2026-05-20',
              reviewedOn: '2026-05-20',
              eventOn: '2026-05-20',
            },
            workflow: { status: 'final', visibility: 'public' },
            topicIds: ['working-conditions'],
            evidence: {
              count: 1,
              note: '공식 성명서',
              noteVisibility: 'public',
              sourceIds: [],
              complete: true,
            },
            relatedDocumentIds: ['mom:202605'],
            displayOrder: 10,
            presentation: { print: {} },
          },
          {
            id: 'notice:unlisted_2026',
            category: 'notice',
            route: 'archive/notice/unlisted_2026.html',
            title: '미등재 안내 테스트',
            summary: '목록 및 사이트맵에서 제외되어야 하는 미등재 문서입니다.',
            dates: {
              publishedOn: '2026-05-21',
              modifiedOn: '2026-05-21',
              reviewedOn: '2026-05-21',
            },
            workflow: { status: 'final', visibility: 'unlisted' },
            topicIds: ['working-conditions'],
            evidence: {
              count: 0,
              note: '미등재 테스트',
              noteVisibility: 'public',
              sourceIds: [],
              complete: true,
            },
            relatedDocumentIds: [],
            displayOrder: 20,
            presentation: { print: {} },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  // Source bodies
  await fs.mkdir(path.join(tmpDir, '_source', 'mom'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, '_source', 'mom', '202605.md'),
    `---
id: "mom:202605"
category: "mom"
route: "archive/mom/202605.html"
title: "2026년 5월 정기 운영위원회 회의록"
summary: "5월 운영위원회 안건 및 재정 연동 테스트 회의록입니다."
dates:
  publishedOn: "2026-05-15"
  modifiedOn: "2026-05-15"
  reviewedOn: "2026-05-15"
  eventOn: "2026-05-10"
workflow:
  status: "final"
  visibility: "public"
topicIds:
  - "op-committee"
evidence:
  count: 1
  note: "운영위원회 회의록 원본"
  noteVisibility: "public"
  sourceIds: []
  complete: true
relatedDocumentIds:
  - "statement:202605_test"
displayOrder: 10
type: "minutes"
financePeriod: "2026-05"
presentation:
  print: {}
---

# 2026년 5월 정기 운영위원회 회의록

## 1. 참석 현황
- 참석 임원: 홍길동 위원장
- 소통간사: 지부 소통간사 1인 (비공개)

## 2. 안건 논의
1. 현장 근로조건 개선 건의
`,
    'utf8',
  );
  await fs.writeFile(
    path.join(tmpDir, '_source', 'mom', '202606_internal.md'),
    `---
id: "mom:202606_internal"
category: "mom"
route: "archive/mom/202606_internal.html"
title: "내부 전용 회의록 테스트"
summary: "공개 빌드에 절대 포함되어선 안 되는 내부 문서입니다."
dates:
  publishedOn: "2026-06-01"
  modifiedOn: "2026-06-01"
  reviewedOn: "2026-06-01"
  eventOn: "2026-06-01"
workflow:
  status: "draft"
  visibility: "internal_only"
topicIds:
  - "op-committee"
evidence:
  count: 0
  note: "내부 전용 초안"
  noteVisibility: "private"
  sourceIds: []
  complete: false
relatedDocumentIds: []
displayOrder: 99
type: "minutes"
presentation:
  print: {}
---

## 1. 내부 메모
- 내부 검토용: 박민수
`,
    'utf8',
  );

  await fs.mkdir(path.join(tmpDir, '_source', 'statement'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, '_source', 'statement', '202605_test.body.html'),
    `<section class="intro-section">
  <h2 class="section-title">1. 현장의 목소리를 들어라</h2>
  <p class="body-text">노동조건 개선과 안전 인력 확충을 즉각 이행하라.</p>
</section>
<section>
  <h2 class="section-title">2. 우리의 요구</h2>
  <p class="body-text no-indent">다음 사항을 요구한다.</p>
  <div class="demands">
    <ol>
      <li>안전 인력 즉각 충원하라.</li>
    </ol>
  </div>
</section>
<div class="closing-block">
  <p class="closing-highlight">안전한 일터를 쟁취하자.</p>
  <p class="closing-text">물류노동자의 권리를 끝까지 지킨다.</p>
</div>`,
    'utf8',
  );

  await fs.mkdir(path.join(tmpDir, '_source', 'notice'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, '_source', 'notice', 'unlisted_2026.html'),
    `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>미등재 안내 테스트</title></head>
<body><main class="archive-container document-article"><header class="document-header"><h1 class="document-title">미등재 안내 테스트</h1></header><p class="body-text">미등재 본문입니다.</p></main></body></html>`,
    'utf8',
  );

  // Public projections (fictional data only)
  await fs.mkdir(path.join(tmpDir, 'data', 'public'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'data', 'public', 'ledger_public.json'),
    JSON.stringify(
      {
        meta: {
          syncedAt: '2026-05-31T10:00:00',
          totalRecords: 2,
          monthsRange: ['2026-05', '2026-05'],
          sanitized: true,
        },
        records: [
          {
            tx_id: 'HQ-2026-901',
            unit: '본부',
            year: 2026,
            ym: '2026-05',
            date: '2026-05-05',
            gubun: '수입',
            gwan: '조합비수입',
            hang: '정기조합비',
            mok: '공무직 조합비',
            exp_type: '',
            fund: '일반회계',
            target: '조합원',
            attr_ym: '2026-05',
            inc: 1000000,
            exp: 0,
            unit_bal: 1000000,
            note: '5월 정기 조합비 수납',
            memo: '',
          },
          {
            tx_id: 'HQ-2026-902',
            unit: '본부',
            year: 2026,
            ym: '2026-05',
            date: '2026-05-12',
            gubun: '지출',
            gwan: '교섭·투쟁·권익비',
            hang: '선전·홍보',
            mok: '성명서·리플렛·공고',
            exp_type: '인쇄·제작',
            fund: '일반회계',
            target: '본조',
            attr_ym: '2026-05',
            inc: 0,
            exp: 120000,
            unit_bal: 880000,
            note: '5월 성명서 인쇄 집행',
            memo: '',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(tmpDir, 'data', 'public', 'org_summary.json'),
    JSON.stringify(
      {
        generatedAt: '2026-05-31T10:00:00',
        totalActive: 10,
        totalHistorical: 12,
        units: [
          {
            code: 'AY',
            officialName: '안양지부',
            shortName: '안물',
            fullName: '안양물류센터지부',
            status: 'active',
            activeCount: 10,
            byEmployment: { 공무직: 8, 기간제: 2 },
            byShift: { 주간: 10 },
          },
          {
            code: 'HQ',
            officialName: '본조',
            shortName: '본부',
            fullName: '우체국물류지원단 물류노동조합 본조합',
            status: 'active',
            activeCount: 0,
            byEmployment: {},
            byShift: {},
          },
        ],
        monthlyFlows: [{ ym: '2026-05', joins: 1, rejoins: 0, withdraws: 0, transfers: 0 }],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(tmpDir, 'data', 'public', 'public_officials.json'),
    JSON.stringify(
      {
        officials: [
          {
            roleId: 'R-9001',
            personId: 'M-9001',
            kind: 'member',
            roleScope: 'executive',
            termLabel: '제3기',
            sortOrder: 10,
            name: '홍길동',
            org: '본조',
            title: '위원장',
            memberUnitCode: 'AY',
            memberUnitName: '안양지부',
            validFrom: '2025-01',
            validTo: null,
            isPrimary: true,
          },
          {
            roleId: 'R-9002',
            personId: 'E-9001',
            kind: 'external',
            roleScope: 'external_rep',
            termLabel: '',
            sortOrder: 100,
            name: '이영희',
            org: '교섭대표노조',
            title: '사무국장',
            memberUnitCode: null,
            memberUnitName: null,
            validFrom: null,
            validTo: null,
            isPrimary: true,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(tmpDir, 'data', 'public', 'document_ledger_links.json'),
    JSON.stringify(
      {
        links: [
          {
            docId: 'mom:202605',
            txId: 'HQ-2026-902',
            relationNote: '5월 운영위원회 식비 집행',
            createdAt: '2026-05-15T00:00:00Z',
          },
          {
            docId: 'mom:202606_internal',
            txId: 'HQ-2026-901',
            relationNote: '내부문서 연계 제외 확인',
            createdAt: '2026-06-01T00:00:00Z',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const hashes = computePrivacyHashes(
    {
      people: [
        { personId: 'M-9001', kind: 'member', name: '홍길동', phone: '', email: '', status: 'active', note: '' },
        { personId: 'M-9002', kind: 'member', name: '김철수', phone: '010-0000-0000', email: '', status: 'active', note: '' },
        { personId: 'M-9003', kind: 'member', name: '박민수', phone: '', email: '', status: 'active', note: '' },
        { personId: 'E-9001', kind: 'external', name: '이영희', phone: '', email: '', status: 'active', note: '' },
      ],
      aliases: [],
    },
    TEST_SALT,
  );
  await fs.writeFile(
    path.join(tmpDir, 'data', 'public', 'privacy_hashes.json'),
    JSON.stringify(hashes, null, 2),
    'utf8',
  );
}

test('buildSite, validateSite(--ci), 프라이버시 누출 차단 및 generateRedirects 파이프라인을 검증한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-site-'));
  try {
    await createSiteFixture(tmpDir);

    const buildRes = await buildSite({
      projectRoot: tmpDir,
      currentYm: '2026-05',
    });
    assert.equal(buildRes.docsPublished, 2);
    assert.equal(buildRes.docsUnlisted, 1);
    assert.equal(buildRes.docsSkippedInternal, 1);

    const siteDir = path.join(tmpDir, '_site');
    const momHtml = await fs.readFile(path.join(siteDir, 'archive', 'mom', '202605.html'), 'utf8');
    assert.match(momHtml, /data-privacy-zone="finance"/);
    assert.match(momHtml, /HQ-2026-902/);
    assert.match(momHtml, /880,000원/);

    const stmtHtml = await fs.readFile(
      path.join(siteDir, 'archive', 'statement', '202605_test.html'),
      'utf8',
    );
    assert.match(stmtHtml, /print-light-surface/);
    assert.match(stmtHtml, /data-print-density="short"/);

    // internal_only excluded from build, sitemap, public_links.js
    await assert.rejects(() =>
      fs.stat(path.join(siteDir, 'archive', 'mom', '202606_internal.html')),
    );
    const linksJs = await fs.readFile(
      path.join(siteDir, 'accounting', 'data', 'public_links.js'),
      'utf8',
    );
    assert.ok(!linksJs.includes('mom:202606_internal'));
    assert.ok(linksJs.includes('HQ-2026-902'));

    // unlisted has noindex,follow and absent from sitemap/index
    const unlistedHtml = await fs.readFile(
      path.join(siteDir, 'archive', 'notice', 'unlisted_2026.html'),
      'utf8',
    );
    assert.match(unlistedHtml, /noindex,follow/);
    const sitemap = await fs.readFile(path.join(siteDir, 'sitemap.xml'), 'utf8');
    assert.ok(!sitemap.includes('unlisted_2026.html'));
    assert.ok(sitemap.includes('archive/mom/202605.html'));

    // /union/ includes union officer (홍길동) and branch card (안양지부), excludes external rep (이영희) and 0-member HQ card
    const unionPath = path.join(siteDir, 'union', 'index.html');
    const unionHtml = await fs.readFile(unionPath, 'utf8');
    assert.match(unionHtml, /홍길동/);
    assert.match(unionHtml, /안양지부/);
    assert.match(unionHtml, /bylaws-guide\.html/);
    assert.match(unionHtml, /bylaws\.html/);
    assert.ok(!unionHtml.includes('이영희'));
    assert.ok(!unionHtml.includes('<span class="doc-cat-badge">HQ</span>'));

    // /union/bylaws-guide.html & /union/bylaws.html are built and indexed in sitemap
    const bylawsGuidePath = path.join(siteDir, 'union', 'bylaws-guide.html');
    const bylawsFullPath = path.join(siteDir, 'union', 'bylaws.html');
    const bylawsGuideHtml = await fs.readFile(bylawsGuidePath, 'utf8');
    const bylawsFullHtml = await fs.readFile(bylawsFullPath, 'utf8');
    assert.match(bylawsGuideHtml, /노동조합 규약 한눈에 보기/);
    assert.match(bylawsFullHtml, /id="art-37-2"/);
    assert.ok(sitemap.includes('union/bylaws-guide.html'));
    assert.ok(sitemap.includes('union/bylaws.html'));

    // CI validate passes on clean site
    const ciPass = await validateSite({
      projectRoot: tmpDir,
      ci: true,
      salt: TEST_SALT,
      currentYm: '2026-05',
    });
    assert.equal(ciPass.ok, true, ciPass.errors.join('\n'));

    // Inject personal name into /union/bylaws.html -> MUST fail CI check (strict Zero-PII)
    await fs.writeFile(
      bylawsFullPath,
      bylawsFullHtml.replace('</main>', '<p>홍길동</p></main>'),
      'utf8',
    );
    const ciFailBylaws = await validateSite({
      projectRoot: tmpDir,
      ci: true,
      salt: TEST_SALT,
      currentYm: '2026-05',
    });
    assert.equal(ciFailBylaws.ok, false);
    assert.ok(ciFailBylaws.errors.some((e) => e.includes('union/bylaws.html') && e.includes('홍*동')));
    await fs.writeFile(bylawsFullPath, bylawsFullHtml, 'utf8');

    // Inject external rep into /union/index.html -> MUST fail CI check
    await fs.writeFile(unionPath, unionHtml.replace('</main>', '<p>이영희</p></main>'), 'utf8');
    const ciFailExtUnion = await validateSite({
      projectRoot: tmpDir,
      ci: true,
      salt: TEST_SALT,
      currentYm: '2026-05',
    });
    assert.equal(ciFailExtUnion.ok, false);
    assert.ok(ciFailExtUnion.errors.some((e) => e.includes('이*희')));
    await fs.writeFile(unionPath, unionHtml, 'utf8');

    // Inject masked person leak into accounting index -> MUST fail CI check with masked token
    const accIdxPath = path.join(siteDir, 'accounting', 'index.html');
    const origAccIdx = await fs.readFile(accIdxPath, 'utf8');
    await fs.writeFile(accIdxPath, origAccIdx.replace('</main>', '<p>김철수 지급</p></main>'), 'utf8');
    const ciFailAcc = await validateSite({
      projectRoot: tmpDir,
      ci: true,
      salt: TEST_SALT,
      currentYm: '2026-05',
    });
    assert.equal(ciFailAcc.ok, false);
    assert.ok(ciFailAcc.errors.some((e) => e.includes('김*수')));
    await fs.writeFile(accIdxPath, origAccIdx, 'utf8');

    // Inject even active official into finance zone -> MUST fail CI check
    const momPath = path.join(siteDir, 'archive', 'mom', '202605.html');
    await fs.writeFile(
      momPath,
      momHtml.replace('data-privacy-zone="finance"', 'data-privacy-zone="finance" data-test="1"')
        .replace('880,000원', '880,000원 홍길동 찬조'),
      'utf8',
    );
    const ciFailFin = await validateSite({
      projectRoot: tmpDir,
      ci: true,
      salt: TEST_SALT,
      currentYm: '2026-05',
    });
    assert.equal(ciFailFin.ok, false);
    assert.ok(ciFailFin.errors.some((e) => e.includes('[finance-zone]') && e.includes('홍*동')));

    // Generate legacy redirects
    const redir = await generateRedirects({ projectRoot: tmpDir });
    assert.ok(redir.accountingRedirects >= 5);
    assert.ok(redir.workplaceRedirects >= 8);
    const momRedir = await fs.readFile(
      path.join(tmpDir, 'redirects', 'workplace', 'MoM', '202605.html'),
      'utf8',
    );
    assert.match(momRedir, /archive\/mom\/202605\.html/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
