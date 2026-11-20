import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemberService } from '../src/services/member-service.js';
import { LocalFileStorage } from '../src/storage/blob-storage.js';
import { openSqliteConnection } from '../src/storage/sqlite/client.js';
import { migrateSqlite } from '../src/storage/sqlite/migrate.js';
import { SqliteUnionRepositories } from '../src/storage/sqlite/repositories.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'drizzle',
);

test('SQLite 마이그레이션, 물리 FK 강제, 조합원 생애주기, BlobStorage 경로탈출 차단을 검증한다', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'union-sqlite-'));
  const dbPath = path.join(tmpDir, 'union.db');
  const rawDir = path.join(tmpDir, '_raw');
  const conn = await openSqliteConnection(dbPath);

  try {
    const applied = await migrateSqlite(conn.client, MIGRATIONS_DIR);
    assert.deepEqual(applied, ['0000_initial.sql', '0001_officer_governance.sql']);

    // Idempotent rerun
    const second = await migrateSqlite(conn.client, MIGRATIONS_DIR);
    assert.deepEqual(second, []);

    const repos = new SqliteUnionRepositories(conn.db);
    const blobs = new LocalFileStorage(rawDir);
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
      {
        code: 'AY',
        name: '안물',
        officialName: '안양지부',
        shortName: '안물',
        fullName: '안양지부',
        status: 'active',
        openedOn: '2023-01',
        closedOn: null,
        ledgerSheet: '원장_안물',
        rawDir: '_raw/AY',
        note: '',
      },
    ]);

    // Physical FK must reject unknown personId in person_roles
    await assert.rejects(async () => {
      await repos.people.upsertRole({
        roleId: 'R-9999',
        personId: 'M-DOES-NOT-EXIST',
        org: '본조',
        title: '위원장',
        publicDisclosure: 'public_official',
        validFrom: null,
        validTo: null,
        isPrimary: true,
      });
    });

    // BlobStorage must block path traversal
    await assert.rejects(async () => {
      await blobs.put('../outside.txt', Buffer.from('nope'));
    });

    // Member lifecycle: join -> transfer -> withdraw -> auto rejoin by birthday
    const sampleDoc = path.join(tmpDir, 'sample-join.jpg');
    await fs.writeFile(sampleDoc, Buffer.from('fake-jpg-bytes'));

    const j = await service.joinMember({
      name: '홍길동',
      unit: '안양지부',
      birth: '900101',
      phone: '010-0000-0000',
      docs: [`가입서=${sampleDoc}`],
      date: '2026-01-10',
    });
    assert.equal(j.mode, 'join');
    assert.equal(j.member.personId, 'M-0001');
    assert.equal(j.member.unitCode, 'AY');
    assert.equal(await blobs.exists(j.member.applicationDocKey), true);

    const tr = await service.transferMember({
      id: 'M-0001',
      toUnit: 'HQ',
      date: '2026-03-01',
    });
    assert.equal(tr.member.unitCode, 'HQ');
    assert.equal(tr.event.fromUnit, 'AY');
    assert.equal(tr.event.toUnit, 'HQ');

    const wd = await service.withdrawMember({
      id: 'M-0001',
      category: '계약만료',
      date: '2026-05-01',
    });
    assert.equal(wd.member.status, 'withdrawn');
    assert.equal(wd.event.reasonCategory, '계약만료·퇴직');

    const rj = await service.joinMember({
      name: '홍길동',
      unit: 'AY',
      birth: '900101',
      date: '2026-07-01',
    });
    assert.equal(rj.mode, 'rejoin');
    assert.equal(rj.member.personId, 'M-0001');
    assert.equal(rj.event.rejoinCategory, '계약만료 후 재입사');

    // Officer role governance: staff_rotating guard -> appoint -> transfer -> end & auto-close on withdraw
    await assert.rejects(async () => {
      await service.appointRole({
        personId: 'M-0001',
        title: '소통간사',
        roleScope: 'staff_rotating',
        disclosure: 'public_official',
      });
    });

    const app = await service.appointRole({
      personId: 'M-0001',
      title: '조직국장',
      org: '본조',
      roleScope: 'executive',
      termLabel: '제3기',
      appointedOn: '2026-07-05',
      sortOrder: 43,
      evidenceDocId: 'mom:202607',
    });
    assert.equal(app.roleScope, 'executive');
    assert.equal(app.publicDisclosure, 'public_official');
    assert.equal(app.validFrom, '2026-07');

    const trRole = await service.transferRole({
      roleId: app.roleId,
      newTitle: '사무국장',
      date: '2026-09-01',
      sortOrder: 30,
      reason: '보직변경',
    });
    assert.equal(trRole.closedRole.validTo, '2026-09');
    assert.equal(trRole.closedRole.endReason, '보직변경');
    assert.equal(trRole.appointedRole.title, '사무국장');
    assert.equal(trRole.appointedRole.validTo, null);

    // Transferring an already-closed role must throw
    await assert.rejects(async () => {
      await service.transferRole({ roleId: app.roleId, newTitle: '중복변경' });
    });

    const j2 = await service.joinMember({
      name: '김철수',
      unit: 'AY',
      birth: '910202',
      date: '2026-08-01',
    });
    const r2 = await service.appointRole({
      personId: j2.member.personId,
      title: '운영위원',
      roleScope: 'executive',
      validFrom: '2026-08',
    });
    await service.withdrawMember({ id: j2.member.personId, date: '2026-10-15' });
    const r2After = await repos.people.findRoleById(r2.roleId);
    assert.equal(r2After?.validTo, '2026-10');
    assert.equal(r2After?.endReason, '탈퇴');

    await service.endRole({
      roleId: trRole.appointedRole.roleId,
      validTo: '2026-11',
      reason: '사임',
    });
    const closedFinal = await repos.people.findRoleById(trRole.appointedRole.roleId);
    assert.equal(closedFinal?.endReason, '사임');
    assert.equal(closedFinal?.validTo, '2026-11');
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
