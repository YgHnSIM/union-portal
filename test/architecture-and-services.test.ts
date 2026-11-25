import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs, flagOne } from '../src/cli/args.js';
import {
  summarizeAnnualCoa,
  validateLedgerRecords,
} from '../src/domain/accounting.js';
import { auditDocumentPrivacy } from '../src/domain/privacy.js';
import type { Account, DirectoryBundle, LedgerEntry } from '../src/domain/types.js';
import { runPrivacyAudit } from '../src/services/audit-privacy.js';
import { exportPublicProjection } from '../src/services/export-public.js';
import { MemberService } from '../src/services/member-service.js';
import { syncMasterConfig } from '../src/services/sync-config.js';
import { syncLedgerFromFile } from '../src/services/sync-ledger.js';
import { LocalFileStorage } from '../src/storage/blob-storage.js';
import { openSqliteConnection } from '../src/storage/sqlite/client.js';
import { migrateSqlite } from '../src/storage/sqlite/migrate.js';
import { SqliteUnionRepositories } from '../src/storage/sqlite/repositories.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'drizzle');

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

test('아키텍처 경계: domain은 I/O·DB·상위 계층을 import하지 않고 services는 sqlite 구현체에 직접 결합하지 않는다', async () => {
  const domainDir = path.join(REPO_ROOT, 'src', 'domain');
  const domainFiles = (await fs.readdir(domainDir)).filter((f) => f.endsWith('.ts'));
  const forbiddenDomainImports = [
    /from\s+['"]node:fs/,
    /from\s+['"]node:child_process/,
    /from\s+['"]@libsql\/client/,
    /from\s+['"]drizzle-orm/,
    /from\s+['"]\.\.\/(?:storage|services|site|reports|pdf|cli)\//,
  ];
  for (const file of domainFiles) {
    const src = await fs.readFile(path.join(domainDir, file), 'utf8');
    for (const pat of forbiddenDomainImports) {
      assert.ok(
        !pat.test(src),
        `src/domain/${file} 에 금지된 의존성(${pat})이 포함되어 있습니다.`,
      );
    }
  }

  const servicesDir = path.join(REPO_ROOT, 'src', 'services');
  const serviceFiles = (await fs.readdir(servicesDir)).filter((f) => f.endsWith('.ts'));
  const forbiddenServiceImports = [
    /from\s+['"]@libsql\/client/,
    /from\s+['"]drizzle-orm/,
    /from\s+['"]\.\.\/storage\/sqlite\//,
  ];
  for (const file of serviceFiles) {
    const src = await fs.readFile(path.join(servicesDir, file), 'utf8');
    for (const pat of forbiddenServiceImports) {
      assert.ok(
        !pat.test(src),
        `src/services/${file} 에 금지된 저장소 구현체 의존성(${pat})이 포함되어 있습니다.`,
      );
    }
  }
});

test('직책 공개 등급 가드, Blob 트랜잭션 보상 정리, 마스터 설정 동기화 및 문서-거래 연결 해제를 검증한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-arch-svc-'));
  const dbPath = path.join(tmpDir, 'union.db');
  const rawDir = path.join(tmpDir, '_raw');
  const conn = await openSqliteConnection(dbPath);

  try {
    await migrateSqlite(conn.client, MIGRATIONS_DIR);
    await copyDir(path.join(REPO_ROOT, 'config'), path.join(tmpDir, 'config'));

    const repos = new SqliteUnionRepositories(conn.db);
    const blobs = new LocalFileStorage(rawDir);
    const service = new MemberService(repos, blobs);

    // 1. Master config sync populates units & accounts on a fresh DB
    const cfgRes = await syncMasterConfig({ projectRoot: tmpDir, repos });
    assert.ok(cfgRes.unitsSynced >= 4);
    assert.ok(cfgRes.accountsSynced >= 40);

    // 2. Staff rotating role cannot be switched to public_official via setRoleDisclosure (service or repo)
    const joined = await service.joinMember({
      name: '홍길동',
      unit: 'AY',
      birth: '900101',
      date: '2026-01-10',
    });
    const rotatingRole = await service.appointRole({
      personId: joined.member.personId,
      title: '소통간사',
      roleScope: 'staff_rotating',
    });
    await assert.rejects(
      () => service.setRoleDisclosure(rotatingRole.roleId, 'public_official'),
      /ADR-0003/,
    );
    await assert.rejects(
      () => repos.people.setRoleDisclosure(rotatingRole.roleId, 'public_official'),
      /ADR-0003/,
    );
    await assert.rejects(
      () => repos.people.setRoleDisclosure('R-9999', 'masked'),
      /찾을 수 없습니다/,
    );

    // 3. Blob compensation deletes stored scan if DB transaction fails afterward
    const sampleDoc = path.join(tmpDir, 'withdraw-scan.jpg');
    await fs.writeFile(sampleDoc, Buffer.from('sensitive-scan'));
    const failingRepos: SqliteUnionRepositories = Object.create(repos);
    failingRepos.transaction = async (fn) => {
      return repos.transaction(async (txRepos) => {
        const proxyPeople = Object.create(txRepos.people);
        proxyPeople.addMemberDocument = async () => {
          throw new Error('forced document insert failure');
        };
        const proxyRepos = Object.create(txRepos);
        proxyRepos.people = proxyPeople;
        return fn(proxyRepos);
      });
    };
    const failingService = new MemberService(failingRepos, blobs);
    await assert.rejects(
      () =>
        failingService.withdrawMember({
          id: joined.member.personId,
          date: '2026-03-01',
          docs: [`탈퇴서=${sampleDoc}`],
        }),
      /forced document insert failure/,
    );
    const remainingBlobs = await blobs.list('applications');
    assert.equal(
      remainingBlobs.length,
      0,
      '트랜잭션 실패 시 업로드된 민감 첨부파일이 고아 파일로 남아서는 안 됩니다.',
    );

    // 4. Ledger sync + document link + unlink allows later deletion of unlinked tx
    const v1Path = path.join(tmpDir, 'ledger-v1.json');
    await fs.writeFile(
      v1Path,
      JSON.stringify([
        {
          tx_id: 'HQ-2026-901',
          unit: '본부',
          year: 2026,
          ym: '2026-01',
          date: '2026-01-10',
          gubun: '수입',
          gwan: '조합비수입',
          hang: '정기조합비',
          mok: '공무직 조합비',
          exp_type: '',
          fund: '일반회계',
          target: '조합원',
          attr_ym: '2026-01',
          inc: 100000,
          exp: 0,
          unit_bal: 100000,
          note: '',
          memo: '',
        },
        {
          tx_id: 'HQ-2026-902',
          unit: '본부',
          year: 2026,
          ym: '2026-01',
          date: '2026-01-15',
          gubun: '지출',
          gwan: '운영비',
          hang: '회의비',
          mok: '정기 운영위원회',
          exp_type: '식대',
          fund: '일반회계',
          target: '식당',
          attr_ym: '2026-01',
          inc: 0,
          exp: 20000,
          unit_bal: 80000,
          note: '1월 운영위',
          memo: '',
        },
      ]),
      'utf8',
    );
    await syncLedgerFromFile(repos, v1Path);
    await service.linkDocumentLedger({ docId: 'mom:202601', txId: 'HQ-2026-902' });
    const unlinked = await service.unlinkDocumentLedger({
      docId: 'mom:202601',
      txId: 'HQ-2026-902',
    });
    assert.equal(unlinked.removed, true);

    const v2Path = path.join(tmpDir, 'ledger-v2.json');
    await fs.writeFile(
      v2Path,
      JSON.stringify([
        {
          tx_id: 'HQ-2026-901',
          unit: '본부',
          year: 2026,
          ym: '2026-01',
          date: '2026-01-10',
          gubun: '수입',
          gwan: '조합비수입',
          hang: '정기조합비',
          mok: '공무직 조합비',
          exp_type: '',
          fund: '일반회계',
          target: '조합원',
          attr_ym: '2026-01',
          inc: 100000,
          exp: 0,
          unit_bal: 100000,
          note: '',
          memo: '',
        },
      ]),
      'utf8',
    );
    const sync2 = await syncLedgerFromFile(repos, v2Path);
    assert.equal(sync2.totalRecords, 1);
  } finally {
    conn.close();
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('runPrivacyAudit는 읽기 전용(.env 미생성)이며 해시 누락·HTML 블록·회계 확장 검증을 정확히 수행한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-audit-'));
  const dbPath = path.join(tmpDir, 'union.db');
  const rawDir = path.join(tmpDir, '_raw');
  const conn = await openSqliteConnection(dbPath);

  try {
    await migrateSqlite(conn.client, MIGRATIONS_DIR);
    await copyDir(path.join(REPO_ROOT, 'config'), path.join(tmpDir, 'config'));
    await copyDir(path.join(REPO_ROOT, '_source', 'schemas'), path.join(tmpDir, '_source', 'schemas'));
    await fs.writeFile(
      path.join(tmpDir, '_source', 'topics.json'),
      JSON.stringify({ topics: [{ id: 'op-committee', label: '운영위원회' }] }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, '_source', 'sources.json'),
      JSON.stringify({ sources: [] }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, '_source', 'catalog.json'),
      JSON.stringify({
        $schema: 'https://yghnsim.github.io/union-portal/schema/catalog.schema.json',
        schemaVersion: 3,
        documents: [],
      }),
      'utf8',
    );

    const repos = new SqliteUnionRepositories(conn.db);
    const blobs = new LocalFileStorage(rawDir);
    const service = new MemberService(repos, blobs);
    await syncMasterConfig({ projectRoot: tmpDir, repos });
    await service.joinMember({
      name: '홍길동',
      unit: 'AY',
      birth: '900101',
      date: '2026-01-10',
    });

    // Export public projection first (creates .env salt and hashes)
    await exportPublicProjection({ projectRoot: tmpDir, repos });

    // Remove .env and verify runPrivacyAudit does NOT recreate it
    const envPath = path.join(tmpDir, '.env');
    await fs.rm(envPath, { force: true });
    const prevEnvSalt = process.env.PRIVACY_HMAC_SALT;
    delete process.env.PRIVACY_HMAC_SALT;
    try {
      const noSaltAudit = await runPrivacyAudit({ projectRoot: tmpDir, repos });
      assert.ok(
        noSaltAudit.publicPrivacyErrors.some((e) => e.includes('PRIVACY_HMAC_SALT')),
      );
      await assert.rejects(() => fs.stat(envPath));
    } finally {
      if (prevEnvSalt !== undefined) process.env.PRIVACY_HMAC_SALT = prevEnvSalt;
    }

    // Add a new member without re-running exportPublicProjection -> missing hash detection
    process.env.PRIVACY_HMAC_SALT = 'fixed-audit-salt-for-unit-test';
    try {
      await exportPublicProjection({ projectRoot: tmpDir, repos });
      await service.joinMember({
        name: '김철수',
        unit: 'BP',
        birth: '910202',
        date: '2026-02-01',
      });
      const staleAudit = await runPrivacyAudit({ projectRoot: tmpDir, repos });
      assert.ok(
        staleAudit.publicPrivacyErrors.some((e) => e.includes('누락된 해시')),
      );
    } finally {
      delete process.env.PRIVACY_HMAC_SALT;
    }

    // HTML multiline <style> and <script> blocks should not trigger false positives and should preserve line numbers
    const testBundle: DirectoryBundle = {
      people: [
        {
          personId: 'M-9001',
          kind: 'member',
          name: '홍길동',
          phone: '',
          email: '',
          status: 'active',
          note: '',
        },
      ],
      members: [],
      externals: [],
      membershipEvents: [],
      memberDocuments: [],
      aliases: [],
      roles: [],
      stripTokens: { honorifics: [], modifiers: [], titles: [] },
      privacy: { forbiddenNames: ['홍길동'], targetMask: {}, exactNoteReplacements: {} },
      idToName: { 'M-9001': '홍길동' },
    };
    const htmlWithBlocks = [
      '<html>',
      '<head><style>',
      '/* 홍길동 스타일 주석 */',
      '</style></head>',
      '<body>',
      '<p>홍길동 노출</p>',
      '</body></html>',
    ].join('\n');
    const htmlFindings = auditDocumentPrivacy(
      { isHtml: true, eventOn: '2026-05-01' },
      htmlWithBlocks,
      testBundle,
    );
    assert.equal(htmlFindings.length, 1);
    assert.equal(htmlFindings[0]!.line, 6);
  } finally {
    conn.close();
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('회계 확장 검증(중복 txId·음수·#DIV/0!·수식) 및 연간 COA 결산·CLI --flag=value 파서를 검증한다', () => {
  const accounts: Account[] = [
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
  ];
  const badEntries: LedgerEntry[] = [
    {
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
      target: '=SUM(A1:A2)',
      attrYm: '2026-01',
      inc: -100,
      exp: 0,
      unitBal: -100,
      note: '#DIV/0!',
      memo: '',
    },
    {
      txId: 'HQ-2026-001',
      unitCode: 'HQ',
      unitName: '본부',
      year: 2026,
      ym: '2026-01',
      date: '2026-01-02',
      gubun: '지출',
      gwan: '운영비',
      hang: '회의비',
      mok: '정기 운영위원회',
      expType: '식대',
      fund: '일반회계',
      target: '식당',
      attrYm: '2026-01',
      inc: 0,
      exp: 500,
      unitBal: -600,
      note: '',
      memo: '',
    },
  ];

  const val = validateLedgerRecords(badEntries, accounts);
  assert.ok(val.errors.some((e) => e.includes('Duplicate tx_id')));
  assert.ok(val.errors.some((e) => e.includes('Negative amount')));
  assert.ok(val.errors.some((e) => e.includes('Unresolved formula')));
  assert.ok(val.errors.some((e) => e.includes('#DIV/0!')));

  const clean2026: LedgerEntry[] = [
    {
      ...badEntries[0]!,
      target: '조합원',
      inc: 10000,
      unitBal: 10000,
      note: '',
    },
    {
      ...badEntries[1]!,
      txId: 'HQ-2026-002',
      exp: 4000,
      unitBal: 6000,
    },
  ];
  const annualCoa = summarizeAnnualCoa(clean2026, [], accounts);
  assert.equal(annualCoa.length, 2);
  assert.equal(annualCoa[0]!.pctText, '100.0%');
  assert.equal(annualCoa[1]!.currentAmount, 4000);

  const parsed = parseArgs([
    'member',
    'join',
    '--name=홍길동',
    '--doc=가입서=C:\\scan\\join.jpg',
    '--unit',
    'AY',
  ]);
  assert.deepEqual(parsed.positionals, ['member', 'join']);
  assert.equal(flagOne(parsed, 'name'), '홍길동');
  assert.equal(flagOne(parsed, 'doc'), '가입서=C:\\scan\\join.jpg');
  assert.equal(flagOne(parsed, 'unit'), 'AY');
});
