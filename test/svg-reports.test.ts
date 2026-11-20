import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildInternalReports } from '../src/reports/build-internal-reports.js';
import {
  renderActivityBarsSvg,
  renderMonthlyFlowSvg,
  renderUnitComparisonSvg,
} from '../src/site/svg-charts.js';
import { openSqliteConnection } from '../src/storage/sqlite/client.js';
import { migrateSqlite } from '../src/storage/sqlite/migrate.js';
import { SqliteUnionRepositories } from '../src/storage/sqlite/repositories.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'drizzle');

test('SVG 차트 생성기는 빈 데이터와 정상 데이터 모두 유효하고 접근성 속성을 갖춘 인라인 SVG를 반환한다', () => {
  const emptyMonthly = renderMonthlyFlowSvg([], '빈 월별 추이');
  assert.match(emptyMonthly, /^<svg\b[^>]*role="img"/);
  assert.match(emptyMonthly, /표시할 데이터가 없습니다/);

  const monthly = renderMonthlyFlowSvg(
    [
      { label: '1월', inc: 1500000, exp: 500000, endBal: 2000000 },
      { label: '2월', inc: 1600000, exp: 700000, endBal: 2900000 },
    ],
    '2026년 월별 추이',
    { standalone: true },
  );
  assert.match(monthly, /<title>2026년 월별 추이<\/title>/);
  assert.match(monthly, /<polyline/);

  const bars = renderActivityBarsSvg(
    [{ label: '임시총회', value: 450000, pct: 60 }],
    '주요 활동 TOP',
  );
  assert.match(bars, /45\.0만원 \(60\.0%\)/);

  const cmp = renderUnitComparisonSvg(
    [
      {
        label: '본조',
        series: [
          { name: '공무직', value: 12, color: '#3b82f6' },
          { name: '기간제', value: 4, color: '#10b981' },
        ],
      },
    ],
    '지부 비교',
  );
  assert.match(cmp, /<rect /);
});

test('buildInternalReports는 로컬 SQLite 데이터를 읽어 독립 실행형 월간·연간 SVG HTML 보고서를 생성한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-reports-'));
  const dbPath = path.join(tmpDir, 'union.db');
  const conn = await openSqliteConnection(dbPath);

  try {
    await migrateSqlite(conn.client, MIGRATIONS_DIR);
    const repos = new SqliteUnionRepositories(conn.db);

    await fs.mkdir(path.join(tmpDir, 'config'), { recursive: true });
    await fs.copyFile(
      path.join(REPO_ROOT, 'config', 'coa.json'),
      path.join(tmpDir, 'config', 'coa.json'),
    );
    await fs.copyFile(
      path.join(REPO_ROOT, 'config', 'units.json'),
      path.join(tmpDir, 'config', 'units.json'),
    );

    await repos.units.upsertMany([
      {
        code: 'HQ',
        name: '본부',
        officialName: '본조',
        shortName: '본부',
        fullName: '우체국물류지원단 물류노동조합 본조합',
        status: 'active',
        openedOn: '2023-01',
        closedOn: null,
        ledgerSheet: '원장_본부',
        rawDir: '_raw/HQ',
        note: '',
      },
    ]);

    await repos.accounts.replaceAll([
      {
        category: '수입',
        gwan: '조합비수입',
        hang: '정기조합비',
        mok: '공무직 조합비',
        description: '정규·공무직 조합원 월 정기 노조회비',
      },
      {
        category: '지출',
        gwan: '조합원복지·연대비',
        hang: '경조·예우',
        mok: '조합원·임원 경조사',
        description: '경조사 지원',
      },
    ]);

    await repos.people.upsertMember({
      personId: 'M-9001',
      kind: 'member',
      name: '홍길동',
      phone: '',
      email: '',
      status: 'active',
      note: '',
      unitCode: 'HQ',
      birthDate: '900101',
      shift: '주간',
      employmentType: '공무직',
      firstJoinedOn: '2026-01-01',
      joinedOn: '2026-01-01',
      leftOn: '',
      memberWish: '',
      applicationDocKey: '',
    });

    await repos.ledger.replaceAllAndSyncLinks(
      [
        {
          txId: 'HQ-2026-901',
          unitCode: 'HQ',
          unitName: '본부',
          year: 2026,
          ym: '2026-05',
          date: '2026-05-05',
          gubun: '수입',
          gwan: '조합비수입',
          hang: '정기조합비',
          mok: '공무직 조합비',
          expType: '',
          fund: '일반회계',
          target: '조합원',
          attrYm: '2026-05',
          inc: 1000000,
          exp: 0,
          unitBal: 1000000,
          note: '5월 조합비 수납',
          memo: '',
        },
        {
          txId: 'HQ-2026-902',
          unitCode: 'HQ',
          unitName: '본부',
          year: 2026,
          ym: '2026-05',
          date: '2026-05-12',
          gubun: '지출',
          gwan: '조합원복지·연대비',
          hang: '경조·예우',
          mok: '조합원·임원 경조사',
          expType: '경조금·화환',
          fund: '일반회계',
          target: '홍길동',
          attrYm: '2026-05',
          inc: 0,
          exp: 100000,
          unitBal: 900000,
          note: '홍길동 경조사 지원',
          memo: '',
        },
      ],
      [],
    );

    const res = await buildInternalReports({
      projectRoot: tmpDir,
      repos,
      month: '2026-05',
      year: 2026,
    });

    const monthlyHtml = await fs.readFile(res.monthlyPath, 'utf8');
    const annualHtml = await fs.readFile(res.annualPath, 'utf8');
    assert.match(monthlyHtml, /<svg\b/);
    assert.match(monthlyHtml, /홍길동 경조사 지원/);
    assert.match(monthlyHtml, /단위별 조합원 현황/);
    assert.match(annualHtml, /<svg\b/);
    assert.match(annualHtml, /900,000원/);
  } finally {
    conn.close();
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
