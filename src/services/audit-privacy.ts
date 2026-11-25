import fs from 'node:fs/promises';
import path from 'node:path';
import { validateLedgerRecords } from '../domain/accounting.js';
import {
  collectPersonEmails,
  collectPersonNames,
} from '../domain/person-normalizer.js';
import {
  auditDocumentPrivacy,
  computePrivacyHashes,
  GENERIC_FAMILY_EVENT_RE,
  maskToken,
  PERSONAL_EMAIL_RE,
  PHONE_RE,
  scanTextWithHashes,
  type PrivacyFinding,
  type PrivacyHashIndex,
} from '../domain/privacy.js';
import {
  publicLedgerToEntries,
  type PublicLedgerJson,
} from '../domain/public-projection.js';
import {
  FileSystemContentSource,
  type ContentSource,
} from '../storage/content-source.js';
import { readConfiguredPrivacySalt } from '../storage/privacy-salt.js';
import type { UnionRepositories } from '../storage/repositories.js';

export interface DocumentAuditSummary {
  docId: string;
  file: string;
  category: string;
  visibility: string;
  findings: PrivacyFinding[];
}

export interface PrivacyAuditReport {
  publicFilesScanned: number;
  publicLedgerErrors: string[];
  publicPrivacyErrors: string[];
  documentsAudited: number;
  documentFindings: DocumentAuditSummary[];
}

export async function runPrivacyAudit(options: {
  projectRoot: string;
  repos: UnionRepositories;
  contentSource?: ContentSource;
}): Promise<PrivacyAuditReport> {
  const { projectRoot, repos } = options;
  const publicDir = path.join(projectRoot, 'data', 'public');
  const [accounts, bundle] = await Promise.all([
    repos.accounts.listAll(),
    repos.people.getDirectoryBundle(),
  ]);

  const salt = readConfiguredPrivacySalt(projectRoot);
  const hashIndex = JSON.parse(
    await fs.readFile(path.join(publicDir, 'privacy_hashes.json'), 'utf8'),
  ) as PrivacyHashIndex;

  // 1. Validate public ledger JSON math & COA
  const publicLedgerErrors: string[] = [];
  const pubLedgerRaw = JSON.parse(
    await fs.readFile(path.join(publicDir, 'ledger_public.json'), 'utf8'),
  ) as PublicLedgerJson;
  const pubEntries = publicLedgerToEntries(pubLedgerRaw);
  const mathRes = validateLedgerRecords(pubEntries, accounts);
  publicLedgerErrors.push(...mathRes.errors);

  // 2. Scan data/public/* (excluding public_officials.json where official names are intentional, and privacy_hashes.json)
  const publicPrivacyErrors: string[] = [];
  if (!salt) {
    publicPrivacyErrors.push(
      'PRIVACY_HMAC_SALT가 설정되지 않아 해시 대조 검사를 수행할 수 없습니다 (.env 또는 환경변수 확인).',
    );
  } else {
    const expectedHashes = computePrivacyHashes(bundle, salt);
    const actualHashSet = new Set(hashIndex.hashes);
    const missingHashes = expectedHashes.hashes.filter((h) => !actualHashSet.has(h));
    if (missingHashes.length > 0) {
      publicPrivacyErrors.push(
        `privacy_hashes.json: 로컬 정본 대비 누락된 해시 ${missingHashes.length}건 (export:public 재실행 또는 PRIVACY_HMAC_SALT 일치 확인 필요)`,
      );
    }
  }

  const forbiddenNames = collectPersonNames(bundle);
  const forbiddenEmails = collectPersonEmails(bundle);
  const publicFiles = (await fs.readdir(publicDir)).filter((f) =>
    f.endsWith('.json'),
  );
  let publicFilesScanned = 0;

  for (const fname of publicFiles) {
    if (fname === 'privacy_hashes.json') continue;
    const text = await fs.readFile(path.join(publicDir, fname), 'utf8');
    publicFilesScanned += 1;

    if (fname !== 'public_officials.json') {
      for (const name of forbiddenNames) {
        if (text.includes(name)) {
          publicPrivacyErrors.push(
            `${fname}: forbidden name (${maskToken(name)})`,
          );
        }
      }
      if (salt) {
        const hashHits = scanTextWithHashes(text, hashIndex, salt);
        for (const h of hashHits) {
          publicPrivacyErrors.push(`${fname}: hash match (${h.maskedToken})`);
        }
      }
    }

    for (const em of forbiddenEmails) {
      if (text.includes(em)) {
        publicPrivacyErrors.push(`${fname}: email (${maskToken(em)})`);
      }
    }
    for (const m of text.matchAll(PHONE_RE)) {
      publicPrivacyErrors.push(`${fname}: phone (${maskToken(m[0])})`);
    }
    for (const m of text.matchAll(PERSONAL_EMAIL_RE)) {
      publicPrivacyErrors.push(`${fname}: email pattern (${maskToken(m[0])})`);
    }
    for (const m of text.matchAll(GENERIC_FAMILY_EVENT_RE)) {
      publicPrivacyErrors.push(`${fname}: family event (${maskToken(m[0])})`);
    }
  }

  // 3. Audit all _source documents under tiered privacy policy (ADR-0003)
  const contentSource =
    options.contentSource ?? new FileSystemContentSource(projectRoot);
  const graph = contentSource.load();
  const documentFindings: DocumentAuditSummary[] = [];
  let documentsAudited = 0;

  for (const doc of graph.documents) {
    if (doc.workflow.visibility === 'internal_only') continue;
    documentsAudited += 1;

    const auditOpts = {
      eventOn: doc.dates.eventOn ?? doc.dates.publishedOn,
      category: doc.category,
      allowHistoricalOfficials:
        !doc.dates.eventOn && doc.topicIds.includes('union-history'),
    };
    const combinedFindings: PrivacyFinding[] = [];

    // Audit title & summary metadata for non-internal documents
    const metaFindings = auditDocumentPrivacy(
      { ...auditOpts, isHtml: false },
      `${doc.title}\n${doc.summary}`,
      bundle,
    ).map((f) => ({ ...f, line: 0, section: 'metadata' }));
    combinedFindings.push(...metaFindings);

    const srcPath = graph.sourcePathsById.get(doc.id);
    if (srcPath) {
      const rawText = await fs.readFile(srcPath, 'utf8');
      const isHtml = srcPath.endsWith('.html');
      const bodyFindings = auditDocumentPrivacy(
        { ...auditOpts, isHtml },
        rawText,
        bundle,
      );
      combinedFindings.push(...bodyFindings);
    }

    if (combinedFindings.length > 0) {
      documentFindings.push({
        docId: doc.id,
        file: srcPath
          ? path.relative(projectRoot, srcPath).replace(/\\/g, '/')
          : '_source/catalog.json',
        category: doc.category,
        visibility: doc.workflow.visibility,
        findings: combinedFindings,
      });
    }
  }

  // 4. Audit union bylaws & revision sources strictly (zero PII allowed)
  const zeroOfficialBundle = { ...bundle, roles: [] };
  const unionZeroPiiFiles: Array<{ rel: string; docId: string; visibility: string }> = [
    { rel: '_source/union/bylaws.md', docId: 'union:bylaws', visibility: 'public' },
    { rel: '_source/union/bylaws-law.json', docId: 'union:bylaws-law', visibility: 'unlisted' },
    {
      rel: '_source/union/bylaws-revision.json',
      docId: 'union:bylaws-revision',
      visibility: 'unlisted',
    },
  ];
  for (const item of unionZeroPiiFiles) {
    const absFile = path.join(projectRoot, ...item.rel.split('/'));
    let rawText: string;
    try {
      rawText = await fs.readFile(absFile, 'utf8');
    } catch {
      continue;
    }
    documentsAudited += 1;
    const findings = auditDocumentPrivacy(
      { category: 'union', isHtml: false, allowHistoricalOfficials: false },
      rawText,
      zeroOfficialBundle,
    );
    if (findings.length > 0) {
      documentFindings.push({
        docId: item.docId,
        file: item.rel,
        category: 'union',
        visibility: item.visibility,
        findings,
      });
    }
  }

  return {
    publicFilesScanned,
    publicLedgerErrors,
    publicPrivacyErrors,
    documentsAudited,
    documentFindings,
  };
}
