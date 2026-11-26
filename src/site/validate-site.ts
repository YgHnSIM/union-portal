import fs from 'node:fs';
import path from 'node:path';
import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { validateLedgerRecords } from '../domain/accounting.js';
import { CATEGORY_REGISTRY } from '../domain/content-graph.js';
import {
  collectPersonEmails,
  collectPersonNames,
  collectPersonPhones,
} from '../domain/person-normalizer.js';
import {
  GENERIC_FAMILY_EVENT_RE,
  isFinanceHeading,
  isPublicOfficialOn,
  maskToken,
  PERSONAL_EMAIL_RE,
  PHONE_RE,
  type PrivacyHashIndex,
  scanTextWithHashes,
} from '../domain/privacy.js';
import {
  isActiveUnionOfficialForPortal,
  type PublicLedgerJson,
  type PublicOfficialsJson,
  publicLedgerToEntries,
} from '../domain/public-projection.js';
import type {
  Account,
  DirectoryBundle,
  DocumentRecordV3,
  PersonRole,
} from '../domain/types.js';
import { loadContentGraph } from '../storage/content-source.js';
import { readConfiguredPrivacySalt } from '../storage/privacy-salt.js';
import type { UnionRepositories } from '../storage/repositories.js';
import { findMarkdownSyntaxResidues } from './mom-renderer.js';
import { isElement } from './statement-fragment.js';

export interface ValidateSiteOptions {
  projectRoot: string;
  siteDir?: string;
  ci?: boolean;
  repos?: UnionRepositories;
  salt?: string;
  currentYm?: string;
}

export interface ValidateSiteResult {
  ok: boolean;
  mode: 'ci' | 'local';
  htmlFilesChecked: number;
  linksChecked: number;
  ledgerRecordsChecked: number;
  errors: string[];
  warnings: string[];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as T;
}

function listFilesRecursive(dir: string, suffix?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (cur: string): void => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const target = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && (!suffix || entry.name.endsWith(suffix))) {
        results.push(target);
      }
    }
  };
  walk(dir);
  return results;
}

interface ExtractedZones {
  hasViewport: boolean;
  robotsContent?: string;
  financeText: string;
  nonFinanceText: string;
  visibleArchiveText: string;
  links: Array<{ tag: string; attr: string; value: string }>;
}

function inspectHtmlAst(html: string): {
  parseErrors: string[];
  extracted: ExtractedZones;
} {
  const parseErrors: string[] = [];
  const ast = parse5.parse(html, {
    onParseError: (err) => {
      // Ignore benign duplicate/trailing formatting hints; catch structural tag mismatches
      if (
        err.code === 'unexpected-solidus-in-tag' ||
        err.code === 'unexpected-null-character' ||
        err.code === 'abrupt-closing-of-empty-comment' ||
        err.code === 'end-tag-with-attributes' ||
        err.code === 'end-tag-with-trailing-solidus'
      ) {
        parseErrors.push(`L${err.startLine}:${err.startCol} ${err.code}`);
      }
    },
  });

  let hasViewport = false;
  let robotsContent: string | undefined;
  const financeChunks: string[] = [];
  const nonFinanceChunks: string[] = [];
  const visibleArchiveChunks: string[] = [];
  const links: Array<{ tag: string; attr: string; value: string }> = [];

  const getAttr = (el: DefaultTreeAdapterTypes.Element, name: string): string | undefined =>
    el.attrs.find((a) => a.name.toLowerCase() === name)?.value;

  const walk = (
    node: DefaultTreeAdapterTypes.Node,
    inHead: boolean,
    inFinanceZone: boolean,
    skipText: boolean,
    skipCode: boolean,
  ): void => {
    if ('value' in node && node.nodeName === '#text') {
      if (!skipText) {
        const txt = String(node.value || '');
        if (txt.trim()) {
          if (inFinanceZone) financeChunks.push(txt);
          else nonFinanceChunks.push(txt);
          if (!skipCode && !inHead) visibleArchiveChunks.push(txt);
        }
      }
      return;
    }

    if (!isElement(node)) {
      if ('childNodes' in node && Array.isArray(node.childNodes)) {
        for (const c of node.childNodes) {
          walk(c, inHead, inFinanceZone, skipText, skipCode);
        }
      }
      return;
    }

    const tag = node.tagName.toLowerCase();
    const nextInHead = inHead || tag === 'head';
    const nextSkipText = skipText || tag === 'script' || tag === 'style';
    const nextSkipCode = skipCode || nextSkipText || tag === 'code' || tag === 'pre';

    if (inHead && tag === 'meta') {
      const mName = (getAttr(node, 'name') ?? '').toLowerCase();
      const mContent = getAttr(node, 'content') ?? '';
      if (mName === 'viewport' && mContent.trim()) {
        hasViewport = true;
      } else if (mName === 'robots') {
        robotsContent = mContent.trim();
      } else if (mName === 'description' && mContent.trim()) {
        nonFinanceChunks.push(mContent);
      }
    }

    if (tag === 'a' || tag === 'link') {
      const href = getAttr(node, 'href');
      if (href !== undefined) links.push({ tag, attr: 'href', value: href });
    }
    if (tag === 'img' || tag === 'script' || tag === 'source' || tag === 'iframe') {
      const src = getAttr(node, 'src');
      if (src !== undefined) links.push({ tag, attr: 'src', value: src });
    }

    const explicitZone = (getAttr(node, 'data-privacy-zone') ?? '').toLowerCase();
    let nextFinance = inFinanceZone || explicitZone === 'finance';

    // Heuristic section check for raw HTML/Markdown sections titled as finance sections
    if (!nextFinance && (tag === 'section' || tag === 'div')) {
      const firstHeading = node.childNodes.find(
        (c) => isElement(c) && /^h[2-6]$/.test(c.tagName.toLowerCase()),
      );
      if (firstHeading && isElement(firstHeading)) {
        const headingText = firstHeading.childNodes
          .map((c) => ('value' in c && c.nodeName === '#text' ? c.value : ''))
          .join('');
        if (isFinanceHeading(headingText)) {
          nextFinance = true;
        }
      }
    }

    for (const c of node.childNodes) {
      walk(c, nextInHead, nextFinance, nextSkipText, nextSkipCode);
    }
  };

  walk(ast, false, false, false, false);

  return {
    parseErrors,
    extracted: {
      hasViewport,
      robotsContent,
      financeText: financeChunks.join('\n'),
      nonFinanceText: nonFinanceChunks.join('\n'),
      visibleArchiveText: visibleArchiveChunks.join(' '),
      links,
    },
  };
}

function checkTextPrivacy(params: {
  text: string;
  label: string;
  allowedPlaintext: Set<string>;
  bundle?: DirectoryBundle;
  hashIndex?: PrivacyHashIndex;
  salt?: string;
  errors: string[];
}): void {
  const { text, label, allowedPlaintext, bundle, hashIndex, salt, errors } = params;
  if (!text.trim()) return;

  for (const m of text.matchAll(PHONE_RE)) {
    errors.push(`${label}: 휴대전화 번호 노출 [${maskToken(m[0])}]`);
  }
  for (const m of text.matchAll(PERSONAL_EMAIL_RE)) {
    errors.push(`${label}: 개인 이메일 노출 [${maskToken(m[0])}]`);
  }
  for (const m of text.matchAll(GENERIC_FAMILY_EVENT_RE)) {
    errors.push(`${label}: 경조사 성명 노출 [${maskToken(m[0])}]`);
  }

  if (hashIndex && salt) {
    const hashHits = scanTextWithHashes(text, hashIndex, salt, allowedPlaintext);
    for (const hit of hashHits) {
      errors.push(`${label}: 해시 비공개 인물 노출 [${hit.maskedToken}]`);
    }
  }

  if (bundle) {
    const names = collectPersonNames(bundle).filter((n) => !allowedPlaintext.has(n));
    const phones = collectPersonPhones(bundle);
    const emails = collectPersonEmails(bundle);

    for (const ph of phones) {
      if (text.includes(ph)) {
        errors.push(`${label}: DB 등록 전화번호 노출 [${maskToken(ph)}]`);
      }
    }
    for (const em of emails) {
      if (text.toLowerCase().includes(em.toLowerCase())) {
        errors.push(`${label}: DB 등록 이메일 노출 [${maskToken(em)}]`);
      }
    }

    // Track matched ranges so shorter substring aliases don't double-report longer names
    const matchedRanges: Array<[number, number]> = [];
    for (const tok of names) {
      let idx = text.indexOf(tok);
      while (idx !== -1) {
        const end = idx + tok.length;
        const covered = matchedRanges.some(([s, e]) => idx >= s && end <= e);
        if (!covered) {
          matchedRanges.push([idx, end]);
          errors.push(`${label}: 비공개 인물 성명 노출 [${maskToken(tok)}]`);
        }
        idx = text.indexOf(tok, idx + tok.length);
      }
    }
  }
}

function allowedOfficialsForDoc(
  doc: DocumentRecordV3 | undefined,
  roles: PersonRole[],
  nameByPersonId: Map<string, string>,
  officialsJson: PublicOfficialsJson,
  currentYm: string,
): Set<string> {
  const allowed = new Set<string>();
  const refDate = doc ? (doc.dates.eventOn ?? doc.dates.publishedOn ?? null) : null;
  const allowHistorical = Boolean(
    doc && !doc.dates.eventOn && doc.topicIds.includes('union-history'),
  );

  // Use roles from DB if available, otherwise public_officials.json (which holds active/historical official terms)
  if (roles.length > 0 && nameByPersonId.size > 0) {
    for (const r of roles) {
      if (r.publicDisclosure !== 'public_official') continue;
      if (
        allowHistorical ||
        isPublicOfficialOn(roles, r.personId, refDate ?? `${currentYm}-01`)
      ) {
        const name = nameByPersonId.get(r.personId);
        if (name) allowed.add(name);
      }
    }
  } else {
    const targetYm = refDate ? refDate.slice(0, 7) : currentYm;
    for (const o of officialsJson.officials) {
      if (!o.name) continue;
      if (allowHistorical) {
        allowed.add(o.name);
        continue;
      }
      const fromOk = !o.validFrom || o.validFrom.slice(0, 7) <= targetYm;
      const toOk = !o.validTo || o.validTo.slice(0, 7) >= targetYm;
      if (fromOk && toOk) allowed.add(o.name);
    }
  }
  return allowed;
}

export async function validateSite(
  options: ValidateSiteOptions,
): Promise<ValidateSiteResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const siteDir = path.resolve(options.siteDir ?? path.join(projectRoot, '_site'));
  const ciMode = Boolean(options.ci);
  const currentYm = options.currentYm ?? new Date().toISOString().slice(0, 7);
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Source Graph validation
  const graph = loadContentGraph(projectRoot);
  const coaCfg = readJson<{ accounts: Account[] }>(
    path.join(projectRoot, 'config', 'coa.json'),
  );
  const publicDir = path.join(projectRoot, 'data', 'public');

  // 2. Load privacy verification material
  const officialsJson = readJson<PublicOfficialsJson>(
    path.join(publicDir, 'public_officials.json'),
  );
  const hashIndexPath = path.join(publicDir, 'privacy_hashes.json');
  let hashIndex: PrivacyHashIndex | undefined;
  if (fs.existsSync(hashIndexPath)) {
    hashIndex = readJson<PrivacyHashIndex>(hashIndexPath);
  }
  const salt = options.salt?.trim() || (ciMode ? process.env.PRIVACY_HMAC_SALT?.trim() : readConfiguredPrivacySalt(projectRoot));

  if (ciMode && (!salt || !hashIndex)) {
    errors.push(
      'CI 검증 모드에서는 PRIVACY_HMAC_SALT 환경변수와 data/public/privacy_hashes.json 이 필수입니다.',
    );
  }

  let bundle: DirectoryBundle | undefined;
  if (!ciMode && options.repos) {
    bundle = await options.repos.people.getDirectoryBundle();
  }
  const nameByPersonId = new Map<string, string>();
  if (bundle) {
    for (const p of bundle.people) {
      nameByPersonId.set(p.personId, p.name);
    }
  }

  // 3. Validate public ledger JSON math, COA, and formula cells
  let ledgerRecordsChecked = 0;
  for (const ledgerRel of [
    path.join(publicDir, 'ledger_public.json'),
    path.join(siteDir, 'accounting', 'data', 'public_ledger.json'),
  ]) {
    if (!fs.existsSync(ledgerRel)) {
      errors.push(`공개 원장 파일이 없습니다: ${path.relative(projectRoot, ledgerRel)}`);
      continue;
    }
    const pub = readJson<PublicLedgerJson>(ledgerRel);
    ledgerRecordsChecked = pub.records.length;
    const entries = publicLedgerToEntries(pub);
    const math = validateLedgerRecords(entries, coaCfg.accounts);
    errors.push(...math.errors);

    for (const r of pub.records) {
      for (const fieldVal of [r.target, r.note, r.memo, r.mok, r.unit]) {
        if (/^=/.test(fieldVal) || /#(?:REF!|VALUE!|NAME\?|N\/A|DIV\/0!)/.test(fieldVal)) {
          errors.push(`수식/시트 오류 잔재 (${r.tx_id}): ${fieldVal}`);
        }
      }
    }
  }

  // 4. Scan data/public/*.json strict zero-PII
  for (const jsonName of [
    'ledger_public.json',
    'org_summary.json',
    'document_ledger_links.json',
  ]) {
    const p = path.join(publicDir, jsonName);
    if (!fs.existsSync(p)) continue;
    checkTextPrivacy({
      text: fs.readFileSync(p, 'utf8'),
      label: `data/public/${jsonName}`,
      allowedPlaintext: new Set(),
      bundle,
      hashIndex,
      salt,
      errors,
    });
  }
  if (fs.existsSync(path.join(publicDir, 'public_officials.json'))) {
    const allowedAllOfficials = new Set(
      officialsJson.officials.map((o) => o.name).filter(Boolean),
    );
    checkTextPrivacy({
      text: fs.readFileSync(path.join(publicDir, 'public_officials.json'), 'utf8'),
      label: 'data/public/public_officials.json',
      allowedPlaintext: allowedAllOfficials,
      bundle,
      hashIndex,
      salt,
      errors,
    });
  }

  // 5. Inspect built _site/
  if (!fs.existsSync(siteDir)) {
    errors.push(`빌드 결과 디렉터리가 없습니다: ${siteDir}`);
    return {
      ok: false,
      mode: ciMode ? 'ci' : 'local',
      htmlFilesChecked: 0,
      linksChecked: 0,
      ledgerRecordsChecked,
      errors,
      warnings,
    };
  }

  const sitemapPath = path.join(siteDir, 'sitemap.xml');
  const sitemapContent = fs.existsSync(sitemapPath)
    ? fs.readFileSync(sitemapPath, 'utf8')
    : '';
  if (!sitemapContent) {
    errors.push('_site/sitemap.xml 파일이 없습니다.');
  }

  const docByRoute = new Map<string, DocumentRecordV3>();
  for (const doc of graph.documents) {
    docByRoute.set(doc.route, doc);
  }

  const publicLinksJsPath = path.join(siteDir, 'accounting', 'data', 'public_links.js');
  const publicLinksJsContent = fs.existsSync(publicLinksJsPath)
    ? fs.readFileSync(publicLinksJsPath, 'utf8')
    : '';

  // Enforce document visibility contracts
  for (const doc of graph.documents) {
    const builtFile = path.join(siteDir, ...doc.route.split('/'));
    if (doc.workflow.visibility === 'internal_only') {
      if (fs.existsSync(builtFile)) {
        errors.push(`internal_only 문서가 공개 빌드에 포함되었습니다: ${doc.route}`);
      }
      if (sitemapContent.includes(doc.route)) {
        errors.push(`internal_only 문서가 sitemap.xml에 노출되었습니다: ${doc.route}`);
      }
      if (publicLinksJsContent.includes(`"${doc.id}"`)) {
        errors.push(`internal_only 문서가 public_links.js에 포함되었습니다: ${doc.id}`);
      }
    } else if (doc.workflow.visibility === 'unlisted') {
      if (!fs.existsSync(builtFile)) {
        errors.push(`unlisted 문서 HTML이 빌드되지 않았습니다: ${doc.route}`);
      }
      if (sitemapContent.includes(doc.route)) {
        errors.push(`unlisted 문서가 sitemap.xml에 노출되었습니다: ${doc.route}`);
      }
    } else {
      if (!fs.existsSync(builtFile)) {
        errors.push(`public 문서 HTML이 빌드되지 않았습니다: ${doc.route}`);
      }
      const routeInSitemap =
        sitemapContent.includes(doc.route) ||
        sitemapContent.includes(encodeURI(doc.route));
      if (!routeInSitemap) {
        errors.push(`public 문서가 sitemap.xml에 누락되었습니다: ${doc.route}`);
      }
    }
  }

  const hasUnionAbout = fs.existsSync(
    path.join(projectRoot, '_source', 'union', 'about.md'),
  );
  if (hasUnionAbout) {
    const aboutBuilt = path.join(siteDir, 'union', 'about.html');
    if (!fs.existsSync(aboutBuilt)) {
      errors.push('조합 소개 HTML이 빌드되지 않았습니다: union/about.html');
    }
    if (!sitemapContent.includes('union/about.html')) {
      errors.push('조합 소개 페이지가 sitemap.xml에 누락되었습니다: union/about.html');
    }
  }

  const hasBylawsLaw = fs.existsSync(
    path.join(projectRoot, '_source', 'union', 'bylaws-law.json'),
  );
  const hasBylawsRevision = fs.existsSync(
    path.join(projectRoot, '_source', 'union', 'bylaws-revision.json'),
  );
  const unlistedUnionRoutes: string[] = [];
  if (hasBylawsLaw) unlistedUnionRoutes.push('union/bylaws-law.html');
  if (hasBylawsRevision) {
    unlistedUnionRoutes.push(
      'union/bylaws-revision-diff.html',
      'union/bylaws-revision-full.html',
    );
  }
  const unlistedUnionSet = new Set(unlistedUnionRoutes);

  for (const unlRoute of unlistedUnionRoutes) {
    const builtPath = path.join(siteDir, ...unlRoute.split('/'));
    if (!fs.existsSync(builtPath)) {
      errors.push(`unlisted 문서 HTML이 빌드되지 않았습니다: ${unlRoute}`);
    }
    const baseName = path.posix.basename(unlRoute);
    if (sitemapContent.includes(baseName)) {
      errors.push(`unlisted 문서가 sitemap.xml에 노출되었습니다: ${unlRoute}`);
    }
  }

  // Active union officials allowlist (for /union/index.html: strictly our union's active members)
  const activeOfficialNames = new Set(
    officialsJson.officials
      .filter((o) => isActiveUnionOfficialForPortal(o, currentYm))
      .map((o) => o.name),
  );

  // Union of allowed officials across listed public docs (for archive index pages)
  const allPublicDocOfficialNames = new Set<string>();
  for (const doc of graph.listedDocuments) {
    const docAllowed = allowedOfficialsForDoc(
      doc,
      bundle?.roles ?? [],
      nameByPersonId,
      officialsJson,
      currentYm,
    );
    for (const n of docAllowed) allPublicDocOfficialNames.add(n);
  }

  const unlistedRoutes = graph.documents
    .filter((d) => d.workflow.visibility === 'unlisted')
    .map((d) => path.posix.basename(d.route));

  // Scan all HTML files in _site/
  const htmlFiles = listFilesRecursive(siteDir, '.html');
  let linksChecked = 0;

  for (const htmlFile of htmlFiles) {
    const relPosix = path.relative(siteDir, htmlFile).replace(/\\/g, '/');
    const rawHtml = fs.readFileSync(htmlFile, 'utf8');
    const { parseErrors, extracted } = inspectHtmlAst(rawHtml);

    for (const perr of parseErrors) {
      errors.push(`${relPosix}: HTML 구문 오류 (${perr})`);
    }
    if (!extracted.hasViewport) {
      errors.push(`${relPosix}: <meta name="viewport"> 태그가 누락되었습니다.`);
    }

    const doc = docByRoute.get(relPosix);
    if (doc?.workflow.visibility === 'unlisted' || unlistedUnionSet.has(relPosix)) {
      const robots = (extracted.robotsContent ?? '').replace(/\s+/g, '');
      if (robots !== 'noindex,follow') {
        errors.push(`${relPosix}: unlisted 문서는 robots="noindex,follow" 여야 합니다.`);
      }
    }

    if (!unlistedUnionSet.has(relPosix)) {
      for (const unlRoute of unlistedUnionRoutes) {
        const unlBase = path.posix.basename(unlRoute);
        if (extracted.links.some((lk) => lk.value.includes(unlBase))) {
          errors.push(
            `${relPosix}: 공개 페이지에 unlisted 문서(${unlRoute}) 링크가 포함되었습니다.`,
          );
        }
      }
    }

    // Ensure archive index pages don't link unlisted docs
    if (
      relPosix === 'index.html' ||
      relPosix === 'archive/index.html' ||
      CATEGORY_REGISTRY.some((c) => relPosix === `${c.directory}/index.html`)
    ) {
      for (const unlName of unlistedRoutes) {
        if (extracted.links.some((lk) => lk.value.includes(unlName))) {
          errors.push(`${relPosix}: 목록 페이지에 unlisted 문서(${unlName}) 링크가 포함되었습니다.`);
        }
      }
    }

    // Verify links and check unsafe schemes
    const fileDir = path.dirname(htmlFile);
    for (const lk of extracted.links) {
      const rawVal = lk.value.trim();
      if (!rawVal || rawVal.startsWith('#')) continue;
      if (/^\s*(javascript|vbscript):/i.test(rawVal) || /^\s*data:text\/html/i.test(rawVal)) {
        errors.push(`${relPosix}: 위험한 URL 스킴 (${lk.tag}[${lk.attr}]="${rawVal}")`);
        continue;
      }
      if (rawVal.startsWith('//')) {
        errors.push(`${relPosix}: 프로토콜 생략 URL(//) 사용 금지 (${rawVal})`);
        continue;
      }
      if (/^(https?:|mailto:|tel:|data:)/i.test(rawVal)) continue;

      linksChecked += 1;
      const cleanRel = rawVal.split('#')[0]!.split('?')[0]!;
      let decodedRel = cleanRel;
      try {
        decodedRel = decodeURIComponent(cleanRel);
      } catch {
        // keep cleanRel
      }
      if (!decodedRel) continue;
      if (decodedRel.startsWith('/')) {
        errors.push(`${relPosix}: 루트 절대경로 대신 상대경로를 사용하세요 (${rawVal})`);
        continue;
      }
      let resolved = path.resolve(fileDir, decodedRel);
      if (decodedRel.endsWith('/') || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())) {
        resolved = path.join(resolved, 'index.html');
      }
      const relFromSite = path.relative(siteDir, resolved);
      if (relFromSite.startsWith('..') || path.isAbsolute(relFromSite)) {
        errors.push(`${relPosix}: 사이트 외부 경로 참조 (${rawVal})`);
      } else if (!fs.existsSync(resolved)) {
        errors.push(`${relPosix}: 깨진 내부 링크/에셋 (${lk.tag}[${lk.attr}]="${rawVal}")`);
      }
    }

    // Check rendered markdown syntax residues in archive MoM pages
    if (doc?.category === 'mom') {
      const mdIssues = findMarkdownSyntaxResidues(extracted.visibleArchiveText);
      for (const issue of mdIssues) {
        errors.push(`${relPosix}: 렌더링 마크다운 잔재 (${issue.code}: ${issue.message})`);
      }
    }

    // Dual-zone privacy verification on built HTML
    if (relPosix === 'index.html' || relPosix.startsWith('accounting/')) {
      checkTextPrivacy({
        text: `${extracted.financeText}\n${extracted.nonFinanceText}`,
        label: relPosix,
        allowedPlaintext: new Set(),
        bundle,
        hashIndex,
        salt,
        errors,
      });
    } else if (relPosix.startsWith('union/')) {
      const unionAllowed = relPosix === 'union/index.html' ? activeOfficialNames : new Set<string>();
      checkTextPrivacy({
        text: `${extracted.financeText}\n${extracted.nonFinanceText}`,
        label: relPosix,
        allowedPlaintext: unionAllowed,
        bundle,
        hashIndex,
        salt,
        errors,
      });
    } else if (relPosix.startsWith('archive/')) {
      // Finance zones inside archive docs allow ZERO names
      checkTextPrivacy({
        text: extracted.financeText,
        label: `${relPosix} [finance-zone]`,
        allowedPlaintext: new Set(),
        bundle,
        hashIndex,
        salt,
        errors,
      });

      const isIndex =
        relPosix === 'archive/index.html' ||
        CATEGORY_REGISTRY.some((c) => relPosix === `${c.directory}/index.html`);
      const nonFinanceAllowed = isIndex
        ? allPublicDocOfficialNames
        : allowedOfficialsForDoc(
            doc,
            bundle?.roles ?? [],
            nameByPersonId,
            officialsJson,
            currentYm,
          );
      checkTextPrivacy({
        text: extracted.nonFinanceText,
        label: relPosix,
        allowedPlaintext: nonFinanceAllowed,
        bundle,
        hashIndex,
        salt,
        errors,
      });
    }
  }

  return {
    ok: errors.length === 0,
    mode: ciMode ? 'ci' : 'local',
    htmlFilesChecked: htmlFiles.length,
    linksChecked,
    ledgerRecordsChecked,
    errors,
    warnings,
  };
}
