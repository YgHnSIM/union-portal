import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AliasMatchMode,
  PersonStatus,
  PublicDisclosure,
} from '../domain/types.js';
import { type PdfPaperSize, generateDocumentPdf } from '../pdf/generate-pdf.js';
import { buildInternalReports } from '../reports/build-internal-reports.js';
import { runPrivacyAudit } from '../services/audit-privacy.js';
import { exportDirectoryMarkdown } from '../services/export-markdown.js';
import { exportPublicProjection } from '../services/export-public.js';
import { importLegacyData } from '../services/import-legacy.js';
import { MemberService } from '../services/member-service.js';
import { syncLedgerFromFile } from '../services/sync-ledger.js';
import { buildSite } from '../site/build-site.js';
import { generateRedirects } from '../site/generate-redirects.js';
import { validateSite } from '../site/validate-site.js';
import { LocalFileStorage } from '../storage/blob-storage.js';
import { openSqliteConnection } from '../storage/sqlite/client.js';
import { migrateSqlite } from '../storage/sqlite/migrate.js';
import { SqliteUnionRepositories } from '../storage/sqlite/repositories.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'local', 'union.db');
const DEFAULT_MIGRATIONS_DIR = path.join(ROOT, 'drizzle');
const DEFAULT_RAW_DIR = path.join(ROOT, '_raw');

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        const arr = flags.get(key) ?? [];
        arr.push(next);
        flags.set(key, arr);
        i += 1;
      } else {
        const arr = flags.get(key) ?? [];
        arr.push('true');
        flags.set(key, arr);
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

function flagOne(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.get(name)?.[0];
}

function flagAll(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

function requireFlag(parsed: ParsedArgs, name: string): string {
  const val = flagOne(parsed, name);
  if (!val) {
    throw new Error(`필수 옵션이 누락되었습니다: --${name}`);
  }
  return val;
}

function printHelp(): void {
  console.log(`union-portal CLI

사용법:
  union migrate
  union import-legacy --accounting <path> --workplace <path>
  union sync-ledger --file <ledger.xlsx|ledger.json>
  union member list [--unit <CODE>] [--status <status|all>] [--include-external]
  union member join --name <name> --unit <unit> [--birth YYMMDD] [--phone ...] [--doc ...]
  union member withdraw [--id M-XXXX | --name <name>] [--category ...] [--refund-tx ...]
  union member rejoin [--id M-XXXX | --name <name>] [--unit ...]
  union member transfer [--id M-XXXX | --name <name>] --to-unit <unit>
  union external list
  union external add --name <name> [--org ...] [--category ...] [--phone ...]
  union role list [--person M-XXXX|E-XXXX]
  union role add --person <person_id> --org <org> --title <title> --disclosure <public_official|masked> [--valid-from YYYY-MM] [--valid-to YYYY-MM]
  union role set-disclosure --role R-XXXX --disclosure <public_official|masked>
  union alias list
  union alias add --alias <alias> --person <person_id> [--mode exact|context_title]
  union link list [--doc <doc_id> | --tx <tx_id>]
  union link add --doc <doc_id> --tx <tx_id> [--note ...]
  union export-md
  union export-public
  union audit-privacy
  union build-site [--out <_site>] [--base-url <url>]
  union validate-site [--ci] [--site <_site>]
  union build-reports [--month YYYY-MM|latest] [--year YYYY] [--out <reports>]
  union pdf <doc_id> [--size A2|A3|A4] [--out <path>] [--site <_site>]
  union generate-redirects [--out <redirects>] [--base-url <url>]`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [cmd, sub] = parsed.positionals;

  if (!cmd || cmd === '--help' || cmd === 'help') {
    printHelp();
    return;
  }

  // DB-free site, PDF, CI validation, and redirect commands
  if (cmd === 'build-site') {
    const res = await buildSite({
      projectRoot: ROOT,
      outDir: flagOne(parsed, 'out'),
      baseUrl: flagOne(parsed, 'base-url'),
    });
    console.log(
      `정적 사이트 빌드 완료: pages=${res.pagesWritten}, public=${res.docsPublished}, unlisted=${res.docsUnlisted}, skippedInternal=${res.docsSkippedInternal}, monthly=${res.monthlyReports}, annual=${res.annualReports}`,
    );
    if (res.warnings.length > 0) {
      for (const w of res.warnings) {
        console.log('  경고:', w);
      }
    }
    return;
  }

  if (cmd === 'pdf') {
    const docId = sub ?? flagOne(parsed, 'doc');
    if (!docId) {
      throw new Error('문서 ID가 필요합니다: union pdf <doc_id>');
    }
    const sizeRaw = flagOne(parsed, 'size')?.toUpperCase() as PdfPaperSize | undefined;
    if (sizeRaw && !['A2', 'A3', 'A4'].includes(sizeRaw)) {
      throw new Error('--size 옵션은 A2, A3, A4 중 하나여야 합니다.');
    }
    const res = await generateDocumentPdf({
      projectRoot: ROOT,
      docId,
      size: sizeRaw,
      outPath: flagOne(parsed, 'out'),
      siteDir: flagOne(parsed, 'site'),
    });
    console.log(
      `PDF 생성 완료: ${res.outPath} (${res.size}, ${res.pageCount}p, ${res.fileSize} bytes)`,
    );
    return;
  }

  if (cmd === 'generate-redirects') {
    const res = await generateRedirects({
      projectRoot: ROOT,
      outDir: flagOne(parsed, 'out'),
      baseUrl: flagOne(parsed, 'base-url'),
    });
    console.log(
      `리다이렉트 생성 완료: accounting=${res.accountingRedirects}, workplace=${res.workplaceRedirects} (${res.outDir})`,
    );
    return;
  }

  const dbPath = flagOne(parsed, 'db') ?? DEFAULT_DB_PATH;

  if (cmd === 'validate-site') {
    const ci = parsed.flags.has('ci');
    const siteDir = flagOne(parsed, 'site');
    if (ci) {
      const res = await validateSite({ projectRoot: ROOT, siteDir, ci: true });
      console.log(
        `사이트 검증 (CI): ok=${res.ok}, html=${res.htmlFilesChecked}, links=${res.linksChecked}, ledger=${res.ledgerRecordsChecked}, errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        for (const err of res.errors.slice(0, 20)) console.error(' -', err);
        process.exitCode = 1;
      }
      return;
    }

    if (!fs.existsSync(dbPath)) {
      throw new Error(
        `로컬 DB(${dbPath})가 없습니다. CI 환경에서는 --ci 플래그를 사용하세요.`,
      );
    }
    const connLocal = await openSqliteConnection(dbPath);
    try {
      await migrateSqlite(connLocal.client, DEFAULT_MIGRATIONS_DIR);
      const repos = new SqliteUnionRepositories(connLocal.db);
      const res = await validateSite({
        projectRoot: ROOT,
        siteDir,
        ci: false,
        repos,
      });
      console.log(
        `사이트 검증 (로컬): ok=${res.ok}, html=${res.htmlFilesChecked}, links=${res.linksChecked}, ledger=${res.ledgerRecordsChecked}, errors=${res.errors.length}`,
      );
      if (res.errors.length > 0) {
        for (const err of res.errors.slice(0, 20)) console.error(' -', err);
        process.exitCode = 1;
      }
    } finally {
      connLocal.close();
    }
    return;
  }

  const conn = await openSqliteConnection(dbPath);
  try {
    if (cmd === 'migrate') {
      const applied = await migrateSqlite(conn.client, DEFAULT_MIGRATIONS_DIR);
      console.log(
        `DB 마이그레이션 완료 (${dbPath}): ${applied.length > 0 ? applied.join(', ') : '최신 상태'}`,
      );
      return;
    }

    // Ensure schema exists before running data commands
    await migrateSqlite(conn.client, DEFAULT_MIGRATIONS_DIR);
    const repos = new SqliteUnionRepositories(conn.db);
    const blobs = new LocalFileStorage(DEFAULT_RAW_DIR);
    const service = new MemberService(repos, blobs);

    if (cmd === 'import-legacy') {
      const acc = requireFlag(parsed, 'accounting');
      const wp = requireFlag(parsed, 'workplace');
      const summary = await importLegacyData({
        projectRoot: ROOT,
        accountingRoot: path.resolve(acc),
        workplaceRoot: path.resolve(wp),
        repos,
        blobs,
      });
      console.log('레거시 이관 완료:', JSON.stringify(summary));
      return;
    }

    if (cmd === 'sync-ledger') {
      const file = requireFlag(parsed, 'file');
      const res = await syncLedgerFromFile(repos, file);
      console.log('원장 단방향 동기화 완료:', JSON.stringify(res));
      return;
    }

    if (cmd === 'member') {
      if (sub === 'list') {
        const unit = flagOne(parsed, 'unit');
        const status = (flagOne(parsed, 'status') ?? 'active') as
          | PersonStatus
          | 'all';
        const includeExternal = parsed.flags.has('include-external');
        const members = await repos.people.listMembers();
        const filtered = members.filter((m) => {
          if (unit && m.unitCode !== unit.toUpperCase()) return false;
          if (status !== 'all' && m.status !== status) return false;
          return true;
        });
        console.log(`조합원 ${filtered.length}명 (status=${status}):`);
        for (const m of filtered) {
          console.log(
            `  ${m.personId} | ${m.unitCode} | ${m.status} | ${m.shift || '-'} | ${m.employmentType || '-'}`,
          );
        }
        if (includeExternal) {
          const exts = await repos.people.listExternals();
          console.log(`외부인 ${exts.length}명`);
        }
        return;
      }
      if (sub === 'join') {
        const res = await service.joinMember({
          name: requireFlag(parsed, 'name'),
          unit: requireFlag(parsed, 'unit'),
          birth: flagOne(parsed, 'birth'),
          phone: flagOne(parsed, 'phone'),
          email: flagOne(parsed, 'email'),
          shift: flagOne(parsed, 'shift'),
          empType: flagOne(parsed, 'emp-type'),
          date: flagOne(parsed, 'date'),
          wish: flagOne(parsed, 'wish'),
          docs: flagAll(parsed, 'doc'),
          docNote: flagOne(parsed, 'doc-note'),
          rejoinCategory: flagOne(parsed, 'rejoin-category'),
          note: flagOne(parsed, 'note'),
        });
        console.log(
          `${res.mode} 처리 완료: ${res.member.personId} (${res.member.unitCode}, 증빙 ${res.documents.length}건)`,
        );
        return;
      }
      if (sub === 'withdraw') {
        const res = await service.withdrawMember({
          id: flagOne(parsed, 'id'),
          name: flagOne(parsed, 'name'),
          category: flagOne(parsed, 'category'),
          reason: flagOne(parsed, 'reason'),
          date: flagOne(parsed, 'date'),
          refundTx: flagOne(parsed, 'refund-tx'),
          docs: flagAll(parsed, 'doc'),
          docNote: flagOne(parsed, 'doc-note'),
        });
        console.log(
          `탈퇴 처리 완료: ${res.member.personId} (${res.event.eventDate}, 증빙 ${res.documents.length}건)`,
        );
        return;
      }
      if (sub === 'rejoin') {
        const res = await service.rejoinMember({
          id: flagOne(parsed, 'id'),
          name: flagOne(parsed, 'name'),
          unit: flagOne(parsed, 'unit'),
          birth: flagOne(parsed, 'birth'),
          phone: flagOne(parsed, 'phone'),
          email: flagOne(parsed, 'email'),
          shift: flagOne(parsed, 'shift'),
          empType: flagOne(parsed, 'emp-type'),
          wish: flagOne(parsed, 'wish'),
          date: flagOne(parsed, 'date'),
          rejoinCategory: flagOne(parsed, 'rejoin-category'),
          reason: flagOne(parsed, 'reason'),
          docs: flagAll(parsed, 'doc'),
          docNote: flagOne(parsed, 'doc-note'),
          note: flagOne(parsed, 'note'),
        });
        console.log(
          `재가입 처리 완료: ${res.member.personId} (${res.member.unitCode}, 증빙 ${res.documents.length}건)`,
        );
        return;
      }
      if (sub === 'transfer') {
        const res = await service.transferMember({
          id: flagOne(parsed, 'id'),
          name: flagOne(parsed, 'name'),
          toUnit: requireFlag(parsed, 'to-unit'),
          date: flagOne(parsed, 'date'),
          reason: flagOne(parsed, 'reason'),
        });
        console.log(
          `소속 이동 완료: ${res.member.personId} (${res.event.fromUnit} -> ${res.event.toUnit})`,
        );
        return;
      }
    }

    if (cmd === 'external') {
      if (sub === 'list') {
        const exts = await repos.people.listExternals();
        console.log(`외부인 ${exts.length}명:`);
        for (const e of exts) {
          console.log(`  ${e.personId} | ${e.org} | ${e.category} | ${e.status}`);
        }
        return;
      }
      if (sub === 'add') {
        const rec = await service.addExternal({
          name: requireFlag(parsed, 'name'),
          org: flagOne(parsed, 'org'),
          category: flagOne(parsed, 'category'),
          phone: flagOne(parsed, 'phone'),
          email: flagOne(parsed, 'email'),
          note: flagOne(parsed, 'note'),
        });
        console.log(`외부인 추가 완료: ${rec.personId} (${rec.org})`);
        return;
      }
    }

    if (cmd === 'role') {
      if (sub === 'list') {
        const roles = await repos.people.listRoles(flagOne(parsed, 'person'));
        for (const r of roles) {
          console.log(
            `${r.roleId} | ${r.personId} | ${r.org} | ${r.title} | ${r.publicDisclosure} | ${r.validFrom ?? '-'}..${r.validTo ?? '-'}`,
          );
        }
        return;
      }
      if (sub === 'add') {
        const disclosure = requireFlag(parsed, 'disclosure') as PublicDisclosure;
        if (disclosure !== 'public_official' && disclosure !== 'masked') {
          throw new Error('disclosure는 public_official 또는 masked 여야 합니다.');
        }
        const role = await service.addRole({
          personId: requireFlag(parsed, 'person'),
          org: flagOne(parsed, 'org') ?? '',
          title: requireFlag(parsed, 'title'),
          disclosure,
          validFrom: flagOne(parsed, 'valid-from') ?? null,
          validTo: flagOne(parsed, 'valid-to') ?? null,
        });
        console.log(
          `직책 추가 완료: ${role.roleId} | ${role.personId} | ${role.title} | ${role.publicDisclosure}`,
        );
        return;
      }
      if (sub === 'set-disclosure') {
        const roleId = requireFlag(parsed, 'role');
        const disclosure = requireFlag(parsed, 'disclosure') as PublicDisclosure;
        if (disclosure !== 'public_official' && disclosure !== 'masked') {
          throw new Error('disclosure는 public_official 또는 masked 여야 합니다.');
        }
        await service.setRoleDisclosure(roleId, disclosure);
        console.log(`공개 등급 변경 완료: ${roleId} -> ${disclosure}`);
        return;
      }
    }

    if (cmd === 'alias') {
      if (sub === 'list') {
        const aliases = await repos.people.listAliases();
        console.log(`별칭 규칙 ${aliases.length}건`);
        return;
      }
      if (sub === 'add') {
        const row = await service.addAlias({
          alias: requireFlag(parsed, 'alias'),
          personId: requireFlag(parsed, 'person'),
          matchMode: (flagOne(parsed, 'mode') ?? 'exact') as AliasMatchMode,
          note: flagOne(parsed, 'note'),
        });
        console.log(`별칭 추가 완료: ${row.personId} (${row.matchMode})`);
        return;
      }
    }

    if (cmd === 'link') {
      if (sub === 'list') {
        const docId = flagOne(parsed, 'doc');
        const txId = flagOne(parsed, 'tx');
        const rows = docId
          ? await repos.links.listByDocId(docId)
          : txId
            ? await repos.links.listByTxId(txId)
            : await repos.links.listAll();
        console.log(`문서-거래 연결 ${rows.length}건`);
        for (const l of rows) {
          console.log(`  ${l.docId} <-> ${l.txId} (${l.relationNote || '-'})`);
        }
        return;
      }
      if (sub === 'add') {
        const row = await service.linkDocumentLedger({
          docId: requireFlag(parsed, 'doc'),
          txId: requireFlag(parsed, 'tx'),
          relationNote: flagOne(parsed, 'note'),
        });
        console.log(`연결 추가 완료: ${row.docId} <-> ${row.txId}`);
        return;
      }
    }

    if (cmd === 'export-md') {
      const res = await exportDirectoryMarkdown({ projectRoot: ROOT, repos });
      console.log(
        `마크다운 생성 완료: directory/ ${res.directoryFiles.length}개 + 서류 카드 ${res.applicationCards.length}개`,
      );
      return;
    }

    if (cmd === 'export-public') {
      const res = await exportPublicProjection({ projectRoot: ROOT, repos });
      console.log('공개 투영 내보내기 완료:', JSON.stringify(res));
      return;
    }

    if (cmd === 'build-reports') {
      const month = flagOne(parsed, 'month') ?? 'latest';
      const yearStr = flagOne(parsed, 'year');
      const year = yearStr ? Number(yearStr) : undefined;
      if (yearStr && !Number.isInteger(year)) {
        throw new Error('--year 옵션은 4자리 정수여야 합니다.');
      }
      const res = await buildInternalReports({
        projectRoot: ROOT,
        repos,
        month,
        year,
        outDir: flagOne(parsed, 'out'),
      });
      console.log(
        `내부 보고서 생성 완료: monthly=${res.monthlyPath}, annual=${res.annualPath} (month=${res.targetMonth}, year=${res.targetYear}, records=${res.totalRecords})`,
      );
      return;
    }

    if (cmd === 'audit-privacy') {
      const report = await runPrivacyAudit({ projectRoot: ROOT, repos });
      console.log(
        `공개 투영 검사: files=${report.publicFilesScanned}, ledgerErrors=${report.publicLedgerErrors.length}, privacyErrors=${report.publicPrivacyErrors.length}`,
      );
      if (report.publicLedgerErrors.length > 0) {
        console.log('  원장 오류:', report.publicLedgerErrors.slice(0, 10));
      }
      if (report.publicPrivacyErrors.length > 0) {
        console.log('  공개 개인정보 오류:', report.publicPrivacyErrors.slice(0, 10));
      }

      const totalDocFindings = report.documentFindings.reduce(
        (acc, d) => acc + d.findings.length,
        0,
      );
      console.log(
        `문서 감사 완료: audited=${report.documentsAudited}, flaggedDocs=${report.documentFindings.length}, totalFindings=${totalDocFindings}`,
      );
      for (const item of report.documentFindings) {
        const byType: Record<string, number> = {};
        for (const f of item.findings) {
          byType[f.type] = (byType[f.type] ?? 0) + 1;
        }
        const detail = item.findings
          .map((f) => `L${f.line}:${f.type}(${f.maskedToken})`)
          .join(', ');
        console.log(
          `  - [${item.docId}] ${item.file} (${item.visibility}) => ${JSON.stringify(byType)} | ${detail}`,
        );
      }

      if (
        report.publicLedgerErrors.length > 0 ||
        report.publicPrivacyErrors.length > 0
      ) {
        process.exitCode = 1;
      }
      return;
    }

    throw new Error(`알 수 없는 명령입니다: ${cmd} ${sub ?? ''}`);
  } finally {
    conn.close();
  }
}

main().catch((err) => {
  console.error('오류:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
