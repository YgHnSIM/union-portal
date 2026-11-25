import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_REGISTRY } from '../domain/content-graph.js';
import {
  publicLedgerToEntries,
  type OrgSummaryJson,
  type PublicDocumentLinksJson,
  type PublicLedgerJson,
  type PublicLinkEntry,
  type PublicOfficialsJson,
} from '../domain/public-projection.js';
import type { DocumentRecordV3, Unit } from '../domain/types.js';
import { loadContentGraph } from '../storage/content-source.js';
import { loadBylawsDocument } from './bylaws.js';
import { loadBylawsLawDocument } from './bylaws-law.js';
import { loadBylawsRevisionDocument } from './bylaws-revision.js';
import { buildAccountingPages } from './pages/accounting.js';
import { buildArchiveDetailPages, buildArchiveIndexPages } from './pages/archive.js';
import { buildPortalHomeHtml } from './pages/home.js';
import { buildUnionPages } from './pages/union.js';
import {
  SITE_BASE_URL,
  canonicalUrlForRoute,
  copyAndHashAssets,
  escapeHtml,
} from './shell.js';
import {
  type CoaConfigJson,
  readJsonFile,
  writeOutFile,
} from './site-context.js';

export interface BuildSiteOptions {
  projectRoot: string;
  outDir?: string;
  baseUrl?: string;
  currentYm?: string;
}

export interface BuildSiteResult {
  outDir: string;
  pagesWritten: number;
  docsPublished: number;
  docsUnlisted: number;
  docsSkippedInternal: number;
  monthlyReports: number;
  annualReports: number;
  warnings: string[];
}

function buildSitemapXml(
  outDir: string,
  baseUrl: string,
  listedDocs: DocumentRecordV3[],
  months: string[],
  years: number[],
  hasBylaws: boolean,
): void {
  const routes = [
    'index.html',
    'archive/index.html',
    ...CATEGORY_REGISTRY.map((c) => `${c.directory}/index.html`),
    ...listedDocs.map((d) => d.route),
    'accounting/index.html',
    'accounting/ledger.html',
    'accounting/coa.html',
    'accounting/reports/index.html',
    ...months.map((m) => `accounting/reports/monthly/${m}.html`),
    ...years.map((y) => `accounting/reports/annual/${y}.html`),
    'union/index.html',
    ...(hasBylaws ? ['union/bylaws-guide.html', 'union/bylaws.html'] : []),
  ];

  const entries = routes
    .map((r) => `  <url><loc>${escapeHtml(canonicalUrlForRoute(r, baseUrl))}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
  writeOutFile(outDir, 'sitemap.xml', xml);
}

export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const outDir = path.resolve(options.outDir ?? path.join(projectRoot, '_site'));
  const baseUrl = (options.baseUrl ?? SITE_BASE_URL).replace(/\/+$/, '');
  const currentYm = options.currentYm ?? new Date().toISOString().slice(0, 7);
  const warnings: string[] = [];

  // Load ONLY Git-tracked sources & sanitized public projections (never SQLite or _raw)
  const graph = loadContentGraph(projectRoot);
  const coaCfg = readJsonFile<CoaConfigJson>(path.join(projectRoot, 'config', 'coa.json'));
  const unitsCfg = readJsonFile<{ units: Unit[] }>(path.join(projectRoot, 'config', 'units.json'));
  const ledger = readJsonFile<PublicLedgerJson>(
    path.join(projectRoot, 'data', 'public', 'ledger_public.json'),
  );
  const orgSummary = readJsonFile<OrgSummaryJson>(
    path.join(projectRoot, 'data', 'public', 'org_summary.json'),
  );
  const officialsJson = readJsonFile<PublicOfficialsJson>(
    path.join(projectRoot, 'data', 'public', 'public_officials.json'),
  );
  const rawLinks = readJsonFile<PublicDocumentLinksJson>(
    path.join(projectRoot, 'data', 'public', 'document_ledger_links.json'),
  );

  // Clean rebuild of _site/
  fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
  fs.mkdirSync(outDir, { recursive: true });

  const assets = copyAndHashAssets(
    path.join(projectRoot, 'web', 'assets'),
    path.join(outDir, 'assets'),
  );

  const unitByName = new Map<string, Unit>();
  for (const u of unitsCfg.units) {
    unitByName.set(u.shortName, u);
    unitByName.set(u.officialName, u);
    unitByName.set(u.code, u);
  }
  const entries = publicLedgerToEntries(ledger, unitByName);
  const txById = new Map(ledger.records.map((r) => [r.tx_id, r]));

  // Only include links whose document exists & is NOT internal_only
  const publicLinks: PublicLinkEntry[] = [];
  const linksByDoc = new Map<string, PublicLinkEntry[]>();
  for (const lk of rawLinks.links) {
    const doc = graph.documentsById.get(lk.docId);
    if (!doc || doc.workflow.visibility === 'internal_only') continue;
    const item: PublicLinkEntry = {
      txId: lk.txId,
      docId: doc.id,
      docTitle: doc.title,
      category: doc.category,
      route: doc.route,
      relationNote: lk.relationNote,
    };
    publicLinks.push(item);
    const arr = linksByDoc.get(doc.id) ?? [];
    arr.push(item);
    linksByDoc.set(doc.id, arr);
  }

  const bylawsDoc = loadBylawsDocument(projectRoot);
  const bylawsLawDoc = loadBylawsLawDocument(projectRoot);
  const bylawsRevisionDoc = loadBylawsRevisionDocument(projectRoot);

  // 1. Portal Home (/)
  writeOutFile(
    outDir,
    'index.html',
    buildPortalHomeHtml(
      graph,
      ledger,
      entries,
      orgSummary,
      linksByDoc,
      Boolean(bylawsDoc),
      assets,
      baseUrl,
    ),
  );

  // 2. Archive Indices & Document Detail Pages
  const indexPages = buildArchiveIndexPages(outDir, graph, linksByDoc, assets, baseUrl);
  const detailCounts = buildArchiveDetailPages(
    projectRoot,
    outDir,
    graph,
    entries,
    txById,
    orgSummary,
    linksByDoc,
    assets,
    baseUrl,
    warnings,
  );

  // 3. Accounting Pages
  const accStats = buildAccountingPages(
    outDir,
    ledger,
    entries,
    coaCfg,
    unitsCfg.units,
    publicLinks,
    graph,
    assets,
    baseUrl,
  );

  // 4. Union Pages (Organization + Bylaws Guide + Bylaws Full Text + Unlisted Review Suite)
  const unionPages = buildUnionPages(
    outDir,
    orgSummary,
    officialsJson,
    bylawsDoc,
    bylawsLawDoc,
    bylawsRevisionDoc,
    currentYm,
    assets,
    baseUrl,
  );

  // 5. Meta files (.nojekyll, robots.txt, sitemap.xml)
  const months = [...new Set(entries.map((r) => r.ym).filter(Boolean))].sort();
  const years = [...new Set(entries.map((r) => r.year).filter(Boolean))].sort((a, b) => a - b);
  writeOutFile(outDir, '.nojekyll', '');
  writeOutFile(
    outDir,
    'robots.txt',
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
  );
  buildSitemapXml(outDir, baseUrl, graph.listedDocuments, months, years, Boolean(bylawsDoc));

  const pagesWritten =
    1 +
    indexPages +
    detailCounts.published +
    detailCounts.unlisted +
    accStats.pages +
    unionPages;

  return {
    outDir,
    pagesWritten,
    docsPublished: detailCounts.published,
    docsUnlisted: detailCounts.unlisted,
    docsSkippedInternal: detailCounts.skippedInternal,
    monthlyReports: accStats.monthlyReports,
    annualReports: accStats.annualReports,
    warnings,
  };
}
