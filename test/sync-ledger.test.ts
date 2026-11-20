import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemberService } from '../src/services/member-service.js';
import { syncLedgerFromFile } from '../src/services/sync-ledger.js';
import { LocalFileStorage } from '../src/storage/blob-storage.js';
import { openSqliteConnection } from '../src/storage/sqlite/client.js';
import { migrateSqlite } from '../src/storage/sqlite/migrate.js';
import { SqliteUnionRepositories } from '../src/storage/sqlite/repositories.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'drizzle',
);

test('원장 단방향 동기화는 upsert를 수행하며 document_ledger_links 참조 tx_id 누락 시 트랜잭션을 롤백한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-sync-'));
  const dbPath = path.join(tmpDir, 'union.db');
  const conn = await openSqliteConnection(dbPath);

  try {
    await migrateSqlite(conn.client, MIGRATIONS_DIR);
    const repos = new SqliteUnionRepositories(conn.db);
    const blobs = new LocalFileStorage(path.join(tmpDir, '_raw'));
    const service = new MemberService(repos, blobs);

    await repos.units.upsertMany([
      {
        code: 'HQ',
        name: '본부',
        officialName: '본조',
        shortName: '본부',
        fullName: '본조합',
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
        description: '',
      },
      {
        category: '지출',
        gwan: '운영비',
        hang: '회의비',
        mok: '정기 운영위원회',
        description: '',
      },
    ]);

    const v1Path = path.join(tmpDir, 'ledger-v1.json');
    await fs.writeFile(
      v1Path,
      JSON.stringify([
        {
          tx_id: 'HQ-2026-001',
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
          tx_id: 'HQ-2026-002',
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
          exp: 30000,
          unit_bal: 70000,
          note: '1월 운영위 식대',
          memo: '',
        },
      ]),
      'utf8',
    );

    const res1 = await syncLedgerFromFile(repos, v1Path);
    assert.equal(res1.totalRecords, 2);
    assert.equal(res1.unitBalances['본부'], 70000);

    await service.linkDocumentLedger({
      docId: 'mom:202601',
      txId: 'HQ-2026-002',
      relationNote: '1월 운영위 식대',
    });

    // v2 deletes HQ-2026-002 which is referenced by document_ledger_links -> must fail!
    const v2Path = path.join(tmpDir, 'ledger-v2.json');
    await fs.writeFile(
      v2Path,
      JSON.stringify([
        {
          tx_id: 'HQ-2026-001',
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

    await assert.rejects(
      async () => {
        await syncLedgerFromFile(repos, v2Path);
      },
      /document_ledger_links/,
    );

    // Original data must remain intact after rollback
    const entriesAfter = await repos.ledger.listEntries();
    assert.equal(entriesAfter.length, 2);
  } finally {
    conn.close();
    await fs.rm(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
});
