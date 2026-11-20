import fs from 'node:fs/promises';
import path from 'node:path';
import { validateLedgerRecords } from '../domain/accounting.js';
import { loadContentGraph } from '../domain/content-graph.js';
import {
  collectPersonEmails,
  collectPersonNames,
} from '../domain/person-normalizer.js';
import {
  auditDocumentPrivacy,
  GENERIC_FAMILY_EVENT_RE,
  maskToken,
  PERSONAL_EMAIL_RE,
  PHONE_RE,
  scanTextWithHashes,
  type PrivacyFinding,
  type PrivacyHashIndex,
} from '../domain/privacy.js';
import type { LedgerEntry } from '../domain/types.js';
import type { UnionRepositories } from '../storage/repositories.js';
import { ensureLocalPrivacySalt } from './export-public.js';

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
}): Promise<PrivacyAuditReport> {
  const { projectRoot, repos } = options;
  const publicDir = path.join(projectRoot, 'data', 'public');
  const [accounts, bundle] = await Promise.all([
    repos.accounts.listAll(),
    repos.people.getDirectoryBundle(),
  ]);

  const salt = await ensureLocalPrivacySalt(projectRoot);
  const hashIndex = JSON.parse(
    await fs.readFile(path.join(publicDir, 'privacy_hashes.json'), 'utf8'),
  ) as PrivacyHashIndex;

  // 1. Validate public ledger JSON math & COA
  const publicLedgerErrors: string[] = [];
  const pubLedgerRaw = JSON.parse(
    await fs.readFile(path.join(publicDir, 'ledger_public.json'), 'utf8'),
  ) as {
    records: Array<{
      tx_id: string;
      unit: string;
      year: number;
      ym: string;
      date: string;
      gubun: string;
      gwan: string;
      hang: string;
      mok: string;
      exp_type: string;
      fund: string;
      target: string;
      attr_ym: string;
      inc: number;
      exp: number;
      unit_bal: number;
      note: string;
      memo: string;
    }>;
  };
  const pubEntries: LedgerEntry[] = pubLedgerRaw.records.map((r) => ({
    txId: r.tx_id,
    unitCode: '',
    unitName: r.unit,
    year: r.year,
    ym: r.ym,
    date: r.date,
    gubun: r.gubun,
    gwan: r.gwan,
    hang: r.hang,
    mok: r.mok,
    expType: r.exp_type,
    fund: r.fund,
    target: r.target,
    attrYm: r.attr_ym,
    inc: r.inc,
    exp: r.exp,
    unitBal: r.unit_bal,
    note: r.note,
    memo: r.memo,
  }));
  const mathRes = validateLedgerRecords(pubEntries, accounts);
  publicLedgerErrors.push(...mathRes.errors);

  // 2. Scan data/public/* (excluding public_officials.json where official names are intentional, and privacy_hashes.json)
  const publicPrivacyErrors: string[] = [];
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
      const hashHits = scanTextWithHashes(text, hashIndex, salt);
      for (const h of hashHits) {
        publicPrivacyErrors.push(`${fname}: hash match (${h.maskedToken})`);
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
  const graph = loadContentGraph(projectRoot);
  const documentFindings: DocumentAuditSummary[] = [];

  for (const doc of graph.documents) {
    if (doc.workflow.visibility === 'internal_only') continue;
    const srcPath = graph.sourcePathsById.get(doc.id);
    if (!srcPath) continue;
    const rawText = await fs.readFile(srcPath, 'utf8');
    const isHtml = srcPath.endsWith('.html');
    const findings = auditDocumentPrivacy(
      {
        eventOn: doc.dates.eventOn ?? doc.dates.publishedOn,
        category: doc.category,
        isHtml,
        allowHistoricalOfficials:
          !doc.dates.eventOn && doc.topicIds.includes('union-history'),
      },
      rawText,
      bundle,
    );
    if (findings.length > 0) {
      documentFindings.push({
        docId: doc.id,
        file: path.relative(projectRoot, srcPath).replace(/\\/g, '/'),
        category: doc.category,
        visibility: doc.workflow.visibility,
        findings,
      });
    }
  }

  return {
    publicFilesScanned,
    publicLedgerErrors,
    publicPrivacyErrors,
    documentsAudited: graph.documents.filter(
      (d) => d.workflow.visibility !== 'internal_only',
    ).length,
    documentFindings,
  };
}
