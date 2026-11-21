import fs from 'node:fs';
import path from 'node:path';
import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { summarizePeriod } from '../domain/accounting.js';
import {
  CATEGORY_BY_ID,
  CATEGORY_REGISTRY,
  type ContentGraph,
  loadContentGraph,
} from '../domain/content-graph.js';
import type {
  DocCategory,
  DocumentLedgerLink,
  DocumentRecordV3,
  LedgerEntry,
  Unit,
} from '../domain/types.js';
import { findMarkdownSyntaxResidues, renderMomMarkdown, type TocItem } from './mom-renderer.js';
import {
  type AssetManifest,
  SITE_BASE_URL,
  assetHref,
  canonicalUrlForRoute,
  computePrefixForRoute,
  copyAndHashAssets,
  escapeAttr,
  escapeHtml,
  fmtMan,
  fmtWon,
  renderAccountingSubnav,
  renderArchiveCategoryNav,
  renderDocumentToolsWidget,
  renderPageShell,
} from './shell.js';
import {
  inspectStatementFragment,
  isElement,
  normalizeTitleLines,
  selectPrintDensity,
  visitNodes,
} from './statement-fragment.js';
import {
  allocateWaffleCells,
  CHART_PALETTE_CSS,
  renderActivityBarsSvg,
  renderMonthlyFlowSvg,
  renderUnitComparisonSvg,
} from './svg-charts.js';

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

interface PublicLedgerJson {
  meta: {
    syncedAt: string;
    totalRecords: number;
    monthsRange: [string, string];
    sanitized: boolean;
  };
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
}

interface OrgSummaryJson {
  generatedAt: string;
  totalActive: number;
  totalHistorical: number;
  units: Array<{
    code: string;
    officialName: string;
    shortName: string;
    fullName: string;
    status: string;
    activeCount: number;
    byEmployment: Record<string, number>;
    byShift: Record<string, number>;
  }>;
  monthlyFlows: Array<{
    ym: string;
    joins: number;
    rejoins: number;
    withdraws: number;
    transfers: number;
  }>;
}

interface PublicOfficialsJson {
  officials: Array<{
    roleId: string;
    personId: string;
    kind: string;
    roleScope?: string;
    termLabel?: string;
    sortOrder?: number;
    name: string;
    org: string;
    title: string;
    memberUnitCode?: string | null;
    memberUnitName?: string | null;
    validFrom: string | null;
    validTo: string | null;
    isPrimary: boolean;
  }>;
}

interface CoaAccountRaw {
  category: string;
  gwan: string;
  hang: string;
  mok: string;
  description: string;
}

interface CoaConfigJson {
  accounts: CoaAccountRaw[];
  expenseTypes: string[];
  fundTypes: string[];
}

interface PublicLinkEntry {
  txId: string;
  docId: string;
  docTitle: string;
  category: DocCategory;
  route: string;
  relationNote: string;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as T;
}

function writeOutFile(outDir: string, relPosix: string, content: string): void {
  const fullPath = path.join(outDir, ...relPosix.split('/'));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function yearTone(year: number): 'odd' | 'even' {
  return year % 2 === 1 ? 'odd' : 'even';
}

function primaryDateOf(doc: DocumentRecordV3): string {
  return doc.dates.eventOn ?? doc.dates.publishedOn ?? '';
}

function sortDocumentsDesc(docs: DocumentRecordV3[]): DocumentRecordV3[] {
  return [...docs].sort((a, b) => {
    const da = primaryDateOf(a);
    const db = primaryDateOf(b);
    if (db !== da) return db.localeCompare(da);
    return (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.id.localeCompare(b.id);
  });
}

function toLedgerEntries(pub: PublicLedgerJson, unitByName: Map<string, Unit>): LedgerEntry[] {
  return pub.records.map((r) => ({
    txId: r.tx_id,
    unitCode: unitByName.get(r.unit)?.code ?? '',
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
}

function renderDocumentToc(toc: TocItem[]): string {
  if (toc.length === 0) return '';
  interface TocGroup {
    id: string;
    text: string;
    children: TocItem[];
  }
  const groups: TocGroup[] = [];
  let cur: TocGroup | undefined;
  for (const item of toc) {
    if (item.level <= 2) {
      cur = { id: item.id, text: item.text, children: [] };
      groups.push(cur);
    } else {
      if (!cur) {
        cur = { id: '', text: '세부 항목', children: [] };
        groups.push(cur);
      }
      cur.children.push(item);
    }
  }
  const listHtml = groups
    .map((g) => {
      const top = g.id
        ? `<a class="document-toc-link document-toc-section" href="#${escapeAttr(g.id)}">${escapeHtml(g.text)}</a>`
        : `<span class="document-toc-section">${escapeHtml(g.text)}</span>`;
      const kids =
        g.children.length > 0
          ? `<ol class="document-toc-children">${g.children
              .map(
                (c) =>
                  `<li><a class="document-toc-link document-toc-child" href="#${escapeAttr(c.id)}">${escapeHtml(c.text)}</a></li>`,
              )
              .join('')}</ol>`
          : '';
      return `<li class="document-toc-group">${top}${kids}</li>`;
    })
    .join('\n');

  return `<nav class="document-toc" aria-label="문서 목차" data-generated-toc="true">
      <div class="document-toc-heading">
        <h2 class="document-toc-title">문서 목차</h2>
        <button class="document-toc-toggle no-print" type="button">목차 접기</button>
      </div>
      <ol class="document-toc-sections">
        ${listHtml}
      </ol>
    </nav>`;
}

function renderLinkedLedgerPanel(
  links: PublicLinkEntry[],
  txById: Map<string, PublicLedgerJson['records'][number]>,
  prefix: string,
): string {
  const valid = links
    .map((lk) => ({ lk, tx: txById.get(lk.txId) }))
    .filter((pair): pair is { lk: PublicLinkEntry; tx: PublicLedgerJson['records'][number] } =>
      Boolean(pair.tx),
    );
  if (valid.length === 0) return '';

  const rows = valid
    .map(({ lk, tx }) => {
      const amt = tx.inc ? `+${fmtWon(tx.inc)}원` : tx.exp ? `-${fmtWon(tx.exp)}원` : '0원';
      const rel = lk.relationNote ? ` · ${lk.relationNote}` : '';
      return `<li class="linked-ledger-item">
        <div>
          <strong>${escapeHtml(tx.date)}</strong> · ${escapeHtml(tx.mok)} (${escapeHtml(amt)})
          <span class="muted"> — ${escapeHtml(tx.note)}${escapeHtml(rel)}</span>
        </div>
        <a class="linked-ledger-link" href="${escapeAttr(`${prefix}accounting/ledger.html?tx=${encodeURIComponent(tx.tx_id)}`)}">${escapeHtml(tx.tx_id)} 내역 보기 →</a>
      </li>`;
    })
    .join('\n      ');

  return `<section class="linked-ledger-panel no-print" data-privacy-zone="finance" aria-labelledby="sec-linked-ledger">
    <h2 id="sec-linked-ledger">연계된 회계 원장 내역 (${valid.length}건)</h2>
    <ul class="linked-ledger-list">
      ${rows}
    </ul>
  </section>`;
}

function cardTitleOf(doc: DocumentRecordV3): string {
  if (doc.category === 'statement') {
    const lines = doc.presentation?.print?.titleLines;
    if (lines && lines.length > 0) {
      const mainLines = lines.filter((line) => !/^—.*—$/.test(line.trim()));
      if (mainLines.length > 0) {
        return mainLines.join(' ');
      }
    }
    return doc.title.replace(/\s*—[^—]+—\s*$/, '').trim() || doc.title;
  }
  return doc.title;
}

function renderRelatedDocsSection(
  doc: DocumentRecordV3,
  graph: ContentGraph,
  prefix: string,
): string {
  const related = doc.relatedDocumentIds
    .map((id) => graph.documentsById.get(id))
    .filter(
      (r): r is DocumentRecordV3 =>
        Boolean(r && r.workflow.visibility === 'public'),
    );
  if (related.length === 0) return '';
  const cards = related
    .map((r) => {
      const catLabel = CATEGORY_BY_ID.get(r.category)?.label ?? r.category;
      return `<a class="related-document" href="${escapeAttr(`${prefix}${r.route}`)}">
        <span>${escapeHtml(catLabel)} · ${escapeHtml(primaryDateOf(r))}</span>
        <strong>${escapeHtml(cardTitleOf(r))}</strong>
      </a>`;
    })
    .join('\n      ');
  return `<section class="related-documents no-print" aria-labelledby="sec-related-docs">
    <h2 id="sec-related-docs">관련 공개 문서</h2>
    <div class="related-document-grid">
      ${cards}
    </div>
  </section>`;
}

function renderDocCard(
  doc: DocumentRecordV3,
  graph: ContentGraph,
  prefixToRoot: string,
  linkCount: number,
): string {
  const catMeta = CATEGORY_BY_ID.get(doc.category);
  const topicLabels = doc.topicIds.map((id) => graph.topicsById.get(id)?.label ?? id);
  const dateText = primaryDateOf(doc) || '연혁';
  const searchBlob = [doc.title, doc.summary, catMeta?.label ?? '', ...topicLabels, doc.id].join(' ');
  const pills = topicLabels
    .map((t) => `<span class="doc-topic-pill">${escapeHtml(t)}</span>`)
    .join('');
  const ledgerBadge =
    linkCount > 0 ? `<span class="doc-topic-pill">회계 연계 ${linkCount}건</span>` : '';
  const href = `${prefixToRoot}${doc.route}`;

  return `<article class="doc-card" data-category="${escapeAttr(doc.category)}" data-topics="${escapeAttr(topicLabels.join('|'))}" data-search="${escapeAttr(searchBlob)}">
      <div>
        <div class="doc-meta">
          <span class="doc-cat-badge" data-cat="${escapeAttr(doc.category)}">${escapeHtml(catMeta?.label ?? doc.category)}</span>
          <time>${escapeHtml(dateText)}</time>
          ${doc.financePeriod ? `<span>· 재정 기준월 ${escapeHtml(doc.financePeriod)}</span>` : ''}
        </div>
        <h3 class="doc-title"><a href="${escapeAttr(href)}">${escapeHtml(cardTitleOf(doc))}</a></h3>
        <p class="doc-summary">${escapeHtml(doc.summary)}</p>
      </div>
      <div>
        <div class="doc-topics">${pills}${ledgerBadge}</div>
        <div class="doc-card-footer">
          <span class="doc-meta">${escapeHtml(doc.evidence.note ?? catMeta?.label ?? '')}</span>
          <a class="doc-card-link" href="${escapeAttr(href)}">${escapeHtml(catMeta?.action ?? '원문 보기')} →</a>
        </div>
      </div>
    </article>`;
}

function buildPortalHomeHtml(
  graph: ContentGraph,
  ledger: PublicLedgerJson,
  entries: LedgerEntry[],
  orgSummary: OrgSummaryJson,
  linksByDoc: Map<string, PublicLinkEntry[]>,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const sortedPublic = sortDocumentsDesc(graph.listedDocuments);
  const latestDocs = sortedPublic.slice(0, 5);
  const months = [...new Set(entries.map((r) => r.ym).filter(Boolean))].sort();
  const latestYm = months[months.length - 1] ?? '';
  const latestYear = latestYm ? latestYm.slice(0, 4) : '';
  const totalBal = entries.reduce((acc, r) => acc + r.inc - r.exp, 0);
  const latestMonthRecs = entries.filter((r) => r.ym === latestYm);
  const latestMonthSum = summarizePeriod(latestMonthRecs);
  const latestMonthNet = latestMonthSum.inc - latestMonthSum.exp;
  const latestMonthNetText =
    latestMonthNet > 0
      ? `+${fmtWon(latestMonthNet)}원`
      : latestMonthNet < 0
        ? `-${fmtWon(Math.abs(latestMonthNet))}원`
        : '0원';

  const latestListHtml = latestDocs
    .map((doc) => {
      const catLabel = CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category;
      const dateTxt = primaryDateOf(doc) || '상시';
      const lCount = linksByDoc.get(doc.id)?.length ?? 0;
      const badge = lCount > 0 ? `<span class="doc-topic-pill">거래 ${lCount}건</span>` : '';
      return `<li class="portal-latest-item">
        <div>
          <span class="doc-cat-badge" data-cat="${escapeAttr(doc.category)}">${escapeHtml(catLabel)}</span>
          <a href="${escapeAttr(doc.route)}">${escapeHtml(cardTitleOf(doc))}</a>
        </div>
        <span class="portal-latest-meta">${badge}<time>${escapeHtml(dateTxt)}</time></span>
      </li>`;
    })
    .join('\n      ');

  const bodyHtml = `
  <section class="portal-hero" aria-labelledby="hero-title">
    <span class="portal-hero-kicker">우체국물류지원단 물류노동조합 · 통합 공개 포털</span>
    <h1 id="hero-title">조합 활동과 회계·조직 현황을 한곳에서 확인하세요</h1>
    <p class="portal-hero-lead">성명서·소식지·회의록·지식 자료와 회계 원장, 조합 현황을 열람할 수 있습니다.</p>
    <div class="portal-actions">
      <a class="btn" href="archive/index.html">자료실</a>
      <a class="btn secondary" href="accounting/index.html">회계 대시보드</a>
      <a class="btn secondary" href="union/index.html">조직·임원 현황</a>
    </div>
  </section>

  <div class="kpi-strip" role="region" aria-label="조합 통합 주요 지표">
    <div class="kpi"><div class="label">자료실 공개 문서</div><div class="value">${sortedPublic.length}건</div><div class="sub">성명·소식지·회의록·지식·알림</div></div>
    <div class="kpi" data-tone="balance"><div class="label">현재 조합 통장 잔액</div><div class="value">${fmtWon(totalBal)}원</div><div class="sub">기준월 ${escapeHtml(latestYm)}</div></div>
    <div class="kpi kpi-split">
      <div class="label">최근월 수지 (${escapeHtml(latestYm)})</div>
      <div class="kpi-split-rows">
        <div class="kpi-split-row"><span class="kpi-split-tag">수입</span><span class="kpi-income">${fmtWon(latestMonthSum.inc)}원</span></div>
        <div class="kpi-split-row"><span class="kpi-split-tag">지출</span><span class="kpi-expense">${fmtWon(latestMonthSum.exp)}원</span></div>
      </div>
      <div class="sub">순수지 ${escapeHtml(latestMonthNetText)}</div>
    </div>
    <div class="kpi"><div class="label">활동 조합원 수</div><div class="value">${orgSummary.totalActive}명</div><div class="sub">안양·부평지부 합계</div></div>
  </div>

  <section class="section-band" aria-labelledby="sec-axes">
    <div class="section-head">
      <h2 id="sec-axes">포털 주요 서비스 안내</h2>
      <span class="section-sub">자료실 · 회계 · 조합</span>
    </div>
    <div class="portal-grid">
      <article class="portal-card" data-axis="archive">
        <div>
          <span class="portal-card-kicker">ARCHIVE · 자료실</span>
          <h3>회의록 · 성명서 · 소식지 · 지식</h3>
          <p>성명서, 소식지, 회의록, 지식, 알림 자료를 열람할 수 있습니다.</p>
        </div>
        <a class="portal-card-link" href="archive/index.html">자료실 이동 →</a>
      </article>
      <article class="portal-card" data-axis="accounting">
        <div>
          <span class="portal-card-kicker">ACCOUNTING · 회계</span>
          <h3>회계 대시보드 · 원장 · 결산 보고</h3>
          <p>${escapeHtml(ledger.meta.monthsRange[0])} ~ ${escapeHtml(ledger.meta.monthsRange[1])} 수지 현황과 결산 보고서를 제공합니다.</p>
        </div>
        <a class="portal-card-link" href="accounting/index.html">회계 포털 이동 →</a>
      </article>
      <article class="portal-card" data-axis="union">
        <div>
          <span class="portal-card-kicker">UNION · 조합</span>
          <h3>지부별 조직 통계 및 공개 임원</h3>
          <p>지부별 조합원 통계와 현 임기 임원 현황을 안내합니다.</p>
        </div>
        <a class="portal-card-link" href="union/index.html">조합 현황 이동 →</a>
      </article>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-latest">
    <div class="section-head">
      <h2 id="sec-latest">최근 공개 자료 (${latestDocs.length}건)</h2>
      <span class="section-sub"><a href="archive/index.html">전체 ${sortedPublic.length}건 모두 보기 →</a></span>
    </div>
    <ul class="portal-latest-list">
      ${latestListHtml}
    </ul>
  </section>

  <section class="section-band" aria-labelledby="sec-latest-report">
    <div class="section-head">
      <h2 id="sec-latest-report">최근 공개 재정 보고서</h2>
      <span class="section-sub">${escapeHtml(latestYm)} 월간 · ${escapeHtml(latestYear)}년 연간</span>
    </div>
    <div class="portal-latest-item">
      <div>
        <strong>${escapeHtml(latestYm)} 운영위원회 공개 재정 보고서</strong>
        <p class="muted" style="font-size:0.86rem;">조합 수입 ${fmtWon(latestMonthSum.inc)}원 · 사업 지출 ${fmtWon(latestMonthSum.exp)}원 · 기말 잔액 ${fmtWon(totalBal)}원</p>
      </div>
      <div class="portal-actions">
        ${latestYm ? `<a class="btn small" href="${escapeAttr(`accounting/reports/monthly/${latestYm}.html`)}">${escapeHtml(latestYm)} 월간 보고 →</a>` : ''}
        <a class="btn secondary small" href="accounting/reports/index.html">전체 보고서 목록</a>
      </div>
    </div>
  </section>`;

  return renderPageShell({
    title: '우체국물류지원단 물류노동조합 통합 포털',
    description:
      '우체국물류지원단 물류노동조합 공개 자료실(성명서·소식지·회의록·지식), 공개 회계 원장·결산 보고서, 지부별 조직 통계 통합 포털입니다.',
    activeNav: 'home',
    route: 'index.html',
    baseUrl,
    assets,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: '우체국물류지원단 물류노동조합',
      url: `${baseUrl.replace(/\/+$/, '')}/`,
    },
    bodyHtml,
  });
}

function buildArchiveIndexPages(
  outDir: string,
  graph: ContentGraph,
  linksByDoc: Map<string, PublicLinkEntry[]>,
  assets: AssetManifest,
  baseUrl: string,
): number {
  let count = 0;
  const publicDocs = sortDocumentsDesc(graph.listedDocuments);
  const counts: Record<string, number> = { all: publicDocs.length };
  for (const cat of CATEGORY_REGISTRY) {
    counts[cat.key] = publicDocs.filter((d) => d.category === cat.key).length;
  }

  const renderIndex = (categoryKey: 'all' | DocCategory, route: string): void => {
    const docs =
      categoryKey === 'all'
        ? publicDocs
        : publicDocs.filter((d) => d.category === categoryKey);
    const catMeta = categoryKey === 'all' ? undefined : CATEGORY_BY_ID.get(categoryKey);
    const pageTitle = catMeta ? `${catMeta.title} · 자료실` : '공개 자료실';
    const pageDesc =
      catMeta?.description ??
      '성명서, 소식지, 회의록, 지식, 알림 자료를 제공합니다.';
    const prefix = computePrefixForRoute(route);
    const prefixToArchive = categoryKey === 'all' ? '' : '../';

    const topicSet = new Set<string>();
    for (const d of docs) {
      for (const tid of d.topicIds) {
        topicSet.add(graph.topicsById.get(tid)?.label ?? tid);
      }
    }
    const topicOptions = [...topicSet]
      .sort((a, b) => a.localeCompare(b, 'ko-KR'))
      .map((label) => `<option value="${escapeAttr(label)}">${escapeHtml(label)}</option>`)
      .join('');

    const cardsHtml = docs
      .map((d) => renderDocCard(d, graph, prefix, linksByDoc.get(d.id)?.length ?? 0))
      .join('\n    ');

    const bodyHtml = `
  <div data-archive-category="${escapeAttr(categoryKey)}">
    <header class="page-masthead">
      <div>
        <h1>${escapeHtml(catMeta?.title ?? '노동조합 공개 자료실')}</h1>
        <p class="lead">${escapeHtml(pageDesc)}</p>
      </div>
      <div class="masthead-meta">
        <span class="data-stamp">${escapeHtml(catMeta?.label ?? '전체')} ${docs.length}건 공개</span>
      </div>
    </header>

    ${renderArchiveCategoryNav(prefixToArchive, categoryKey, counts)}

    <section class="archive-tools" aria-label="자료 검색 및 주제 필터">
      <div class="archive-ledger-meta">
        <span id="archive-result-summary">자료 ${docs.length}건</span>
      </div>
      <div class="archive-query-row">
        <form class="archive-search" role="search">
          <label for="archive-search-input">자료 검색</label>
          <div class="archive-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <input id="archive-search-input" type="search" placeholder="제목, 주제, 핵심 키워드 입력">
            <button type="button" class="archive-search-clear" hidden>지우기</button>
          </div>
        </form>
        <div class="topic-filter">
          <label for="archive-topic-select">주제별 보기</label>
          <select id="archive-topic-select">
            <option value="all">전체 주제</option>
            ${topicOptions}
          </select>
        </div>
      </div>
    </section>

    <section id="archive-results" class="archive-list" aria-live="polite">
      ${cardsHtml}
      <p class="archive-no-results" hidden>조건에 맞는 공개 문서가 없습니다. 검색어나 주제를 초기화해 보세요.</p>
    </section>
  </div>`;

    const htmlOut = renderPageShell({
      title: pageTitle,
      description: pageDesc,
      activeNav: 'archive',
      route,
      prefix,
      baseUrl,
      assets,
      bodyHtml,
      extraScriptsHtml: `<script src="${escapeAttr(assetHref(prefix, 'archive-filter.js', assets))}" defer></script>`,
    });
    writeOutFile(outDir, route, htmlOut);
    count += 1;
  };

  renderIndex('all', 'archive/index.html');
  for (const cat of CATEGORY_REGISTRY) {
    renderIndex(cat.key, `${cat.directory}/index.html`);
  }
  return count;
}

function buildMomFinancePanelHtml(
  doc: DocumentRecordV3,
  momBody: string,
  entries: LedgerEntry[],
  orgSummary: OrgSummaryJson,
  prefix: string,
  warnings: string[],
): string {
  const ym = doc.financePeriod;
  if (!ym) return '';
  const priorBal = entries
    .filter((r) => r.ym < ym)
    .reduce((acc, r) => acc + r.inc - r.exp, 0);
  const currRecs = entries.filter((r) => r.ym === ym);
  const currSum = summarizePeriod(currRecs);
  const opBal = priorBal + currSum.op;
  const endBal = opBal + currSum.net;

  // Cross-check against explicit ending-balance figures mentioned inside body finance section
  let matchNote = `회계 원장 기준월(${ym}) ${currRecs.length}건 자동 대조 완료`;
  let statusAttr = 'ok';
  if (currRecs.length === 0) {
    matchNote = `${ym} 기준 공개 원장 거래 0건 (이월잔액 기준)`;
  } else {
    const balLineMatch = momBody.match(/(?:기말\s*잔액|통장\s*잔액|잔액)[^\n]{0,30}?([\d,]{4,})\s*원/);
    if (balLineMatch && balLineMatch[1]) {
      const cited = Number(balLineMatch[1].replace(/,/g, ''));
      if (Number.isFinite(cited) && Math.abs(cited - endBal) > 0) {
        statusAttr = 'warn';
        matchNote = `본문 기재 금액(${fmtWon(cited)}원)과 원장 잔액(${fmtWon(endBal)}원) 차이 확인 필요`;
        warnings.push(
          `[교차검증 경고] ${doc.id} (${ym}): 본문 잔액 ${fmtWon(cited)}원 vs 원장 기말잔액 ${fmtWon(endBal)}원`,
        );
      }
    }
  }

  const unitFlow = orgSummary.monthlyFlows.find((f) => f.ym === ym);
  const flowSummary = unitFlow
    ? `당월 변동(가입 ${unitFlow.joins} · 재가입 ${unitFlow.rejoins} · 탈퇴 ${unitFlow.withdraws} · 이동 ${unitFlow.transfers})`
    : `전체 활동 조합원 ${orgSummary.totalActive}명`;

  return `<section class="mom-finance-panel" data-privacy-zone="finance" aria-labelledby="sec-mom-finance">
    <div class="mom-finance-head">
      <h2 id="sec-mom-finance">${escapeHtml(ym)} 회계·조직 자동 연동 요약</h2>
      <span class="mom-finance-verify" data-status="${statusAttr}">${escapeHtml(matchNote)}</span>
    </div>
    <div class="kpi-strip" role="region" aria-label="${escapeHtml(ym)} 재정 요약">
      <div class="kpi"><div class="label">기초 잔액</div><div class="value">${fmtWon(opBal)}원</div></div>
      <div class="kpi" data-tone="income"><div class="label">조합 수입</div><div class="value">${fmtWon(currSum.inc)}원</div></div>
      <div class="kpi" data-tone="expense"><div class="label">사업 지출</div><div class="value">${fmtWon(currSum.exp)}원</div></div>
      <div class="kpi" data-tone="grant"><div class="label">지부 교부·지원</div><div class="value">${fmtWon(currSum.trOut)}원</div></div>
      <div class="kpi" data-tone="balance"><div class="label">기말 잔액</div><div class="value">${fmtWon(endBal)}원</div></div>
    </div>
    <p class="muted" style="font-size:0.84rem;">조합원 현황: ${escapeHtml(flowSummary)}</p>
    <div class="mom-finance-actions no-print">
      <a class="btn small" href="${escapeAttr(`${prefix}accounting/reports/monthly/${ym}.html`)}">${escapeHtml(ym)} 재정보고서 보기 →</a>
      <a class="btn secondary small" href="${escapeAttr(`${prefix}accounting/ledger.html?year=${encodeURIComponent(ym.slice(0, 4))}&q=${encodeURIComponent(ym)}`)}">${escapeHtml(ym)} 원장 거래 검색</a>
    </div>
  </section>`;
}

function buildArchiveDetailPages(
  projectRoot: string,
  outDir: string,
  graph: ContentGraph,
  entries: LedgerEntry[],
  txById: Map<string, PublicLedgerJson['records'][number]>,
  orgSummary: OrgSummaryJson,
  linksByDoc: Map<string, PublicLinkEntry[]>,
  assets: AssetManifest,
  baseUrl: string,
  warnings: string[],
): { published: number; unlisted: number; skippedInternal: number } {
  let published = 0;
  let unlisted = 0;
  let skippedInternal = 0;

  // Copy non-HTML sibling assets (images/pdfs) from _source/knowledge and _source/notice
  for (const cat of ['knowledge', 'notice'] as const) {
    const srcDir = path.join(projectRoot, '_source', cat);
    if (!fs.existsSync(srcDir)) continue;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith('.html')) continue;
      const dest = path.join(outDir, 'archive', cat, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(srcDir, entry.name), dest);
    }
  }

  for (const doc of graph.documents) {
    if (doc.workflow.visibility === 'internal_only') {
      skippedInternal += 1;
      continue;
    }
    if (doc.workflow.visibility === 'unlisted') unlisted += 1;
    else published += 1;

    const prefix = computePrefixForRoute(doc.route);
    const robots = doc.workflow.visibility === 'unlisted' ? 'noindex,follow' : undefined;
    const topicLabels = doc.topicIds.map((id) => graph.topicsById.get(id)?.label ?? id);
    const docLinks = linksByDoc.get(doc.id) ?? [];
    const linkedLedgerHtml = renderLinkedLedgerPanel(docLinks, txById, prefix);
    const relatedHtml =
      doc.workflow.visibility === 'public' ? renderRelatedDocsSection(doc, graph, prefix) : '';

    if (doc.category === 'mom') {
      const momSource = graph.momSourcesById.get(doc.id);
      if (!momSource) {
        throw new Error(`회의록 원본을 찾을 수 없습니다: ${doc.id}`);
      }
      const residues = findMarkdownSyntaxResidues(momSource.body);
      if (residues.length > 0) {
        throw new Error(
          `${momSource.label}:${residues[0]!.line}:${residues[0]!.column} ${residues[0]!.message}`,
        );
      }
      const parsed = renderMomMarkdown(momSource.body, doc.title);
      const financePanel = buildMomFinancePanelHtml(
        doc,
        momSource.body,
        entries,
        orgSummary,
        prefix,
        warnings,
      );
      const bodyHtml = `
  <article class="mom-container document-article" id="mom-article" data-document-category="회의록">
    <header class="document-header">
      <nav class="document-breadcrumb no-print" aria-label="현재 위치">
        <ol>
          <li><a href="${escapeAttr(`${prefix}archive/index.html`)}">공개 자료실</a></li>
          <li><a href="${escapeAttr(`${prefix}archive/mom/index.html`)}">회의록</a></li>
          <li aria-current="page">${escapeHtml(primaryDateOf(doc) || doc.id)}</li>
        </ol>
      </nav>
      <h1 class="document-title">${escapeHtml(doc.title)}</h1>
      ${doc.summary ? `<p class="document-summary">${escapeHtml(doc.summary)}</p>` : ''}
    </header>
    <section class="document-facts" aria-label="문서 정보">
      <dl>
        <div><dt>분류</dt><dd>운영위원회 회의록</dd></div>
        <div><dt>회의일자</dt><dd>${escapeHtml(primaryDateOf(doc) || '-')}</dd></div>
        ${doc.financePeriod ? `<div><dt>연동 회계월</dt><dd>${escapeHtml(doc.financePeriod)}</dd></div>` : ''}
        <div><dt>주제</dt><dd>${topicLabels.map((t) => escapeHtml(t)).join(', ')}</dd></div>
      </dl>
    </section>
    ${financePanel}
    ${renderDocumentToc(parsed.toc)}
    <div class="mom-body" data-copy-body>
      ${parsed.contentHtml}
    </div>
    ${linkedLedgerHtml}
    ${relatedHtml}
  </article>
  ${renderDocumentToolsWidget()}`;

      const htmlOut = renderPageShell({
        title: doc.title,
        description: doc.summary,
        activeNav: 'archive',
        route: doc.route,
        prefix,
        baseUrl,
        assets,
        robots,
        ogType: 'article',
        publishedTime: doc.dates.publishedOn,
        modifiedTime: doc.dates.modifiedOn,
        keywords: topicLabels,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: doc.title,
          datePublished: doc.dates.publishedOn,
          dateModified: doc.dates.modifiedOn,
        },
        bodyHtml,
        extraScriptsHtml: `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      });
      writeOutFile(outDir, doc.route, htmlOut);
      continue;
    }

    if (doc.category === 'statement') {
      const srcPath = graph.sourcePathsById.get(doc.id);
      if (!srcPath || !fs.existsSync(srcPath)) {
        throw new Error(`성명서 본문 조각 파일이 없습니다: ${doc.id}`);
      }
      const fragment = fs.readFileSync(srcPath, 'utf8').replace(/^\uFEFF/, '');
      const analysis = inspectStatementFragment(fragment, srcPath);
      const rawLines = doc.presentation?.print?.titleLines;
      const lines = normalizeTitleLines(doc.title, rawLines);
      const density = selectPrintDensity(analysis.metrics, doc.title, lines);
      const titleHtml = lines
        .map((line) => {
          const isSub = /^—.*—$/.test(line.trim());
          const cls = isSub
            ? 'statement-title-line statement-title-line--subtitle'
            : 'statement-title-line';
          return `<span class="${cls}">${escapeHtml(line)}</span>`;
        })
        .join('\n        ');
      const sigDate = doc.dates.eventOn ?? doc.dates.publishedOn ?? '';
      const logo600 = assetHref(prefix, 'logo-header-600.webp', assets);
      const logoFull = assetHref(prefix, 'logo-header-600.webp', assets);

      const bodyHtml = `
  <article class="statement-container print-light-surface document-article" data-print-density="${density}" data-document-category="성명서">
    <nav class="document-breadcrumb no-print" aria-label="현재 위치">
      <ol>
        <li><a href="${escapeAttr(`${prefix}archive/index.html`)}">공개 자료실</a></li>
        <li><a href="${escapeAttr(`${prefix}archive/statement/index.html`)}">성명서</a></li>
        <li aria-current="page">${escapeHtml(sigDate)}</li>
      </ol>
    </nav>
    <header class="statement-header">
      <p class="statement-identity">
        <span>우체국물류지원단 물류노동조합</span>
        <span>성명서</span>
      </p>
      <div class="statement-brand-mark" aria-hidden="true">
        <img src="${escapeAttr(logo600)}" alt="">
      </div>
      <h1 class="statement-title${density === 'long' ? ' statement-title--long' : ''}">
        ${titleHtml}
      </h1>
      <p class="statement-meta"><time datetime="${escapeAttr(sigDate)}">${escapeHtml(sigDate)}</time> · ${escapeHtml(doc.evidence.note ?? '노동조합 공식 성명서')}</p>
    </header>
    <div class="statement-body" data-copy-body>
      ${analysis.html}
    </div>
    <div class="signature-block">
      <p class="signature-date"><time datetime="${escapeAttr(sigDate)}">${escapeHtml(sigDate)}</time></p>
      <div class="signature-org-row">
        <img src="${escapeAttr(logoFull)}" alt="우체국물류지원단 물류노동조합" class="signature-org-logo">
      </div>
    </div>
    ${linkedLedgerHtml}
    ${relatedHtml}
  </article>
  ${renderDocumentToolsWidget()}`;

      const htmlOut = renderPageShell({
        title: doc.title,
        description: doc.summary,
        activeNav: 'archive',
        route: doc.route,
        prefix,
        baseUrl,
        assets,
        robots,
        ogType: 'article',
        publishedTime: doc.dates.publishedOn,
        modifiedTime: doc.dates.modifiedOn,
        keywords: topicLabels,
        extraHeadHtml: '<style>@media print { @page { size: 420mm 594mm; margin: 10mm 15mm; } }</style>',
        bodyHtml,
        extraScriptsHtml: `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      });
      writeOutFile(outDir, doc.route, htmlOut);
      continue;
    }

    if (doc.category === 'newsletter') {
      const srcPath = graph.sourcePathsById.get(doc.id);
      if (!srcPath || !fs.existsSync(srcPath)) {
        throw new Error(`소식지 원본 HTML이 없습니다: ${doc.id}`);
      }
      const rawHtml = fs.readFileSync(srcPath, 'utf8').replace(/^\uFEFF/, '');
      const nlCssHref = assetHref(prefix, 'newsletter.css', assets);

      const ast = parse5.parse(rawHtml, { sourceCodeLocationInfo: true });
      let mainEl: DefaultTreeAdapterTypes.Element | undefined;
      visitNodes(ast, (node) => {
        if (!mainEl && isElement(node) && node.tagName === 'main') {
          mainEl = node;
        }
      });
      if (!mainEl) {
        throw new Error(`${srcPath}: <main> 요소를 찾을 수 없습니다.`);
      }

      const loc = mainEl.sourceCodeLocation;
      const mainInnerHtml =
        loc?.startTag?.endOffset !== undefined && loc?.endTag?.startOffset !== undefined
          ? rawHtml.slice(loc.startTag.endOffset, loc.endTag.startOffset)
          : mainEl.childNodes
              .map((child) =>
                parse5.serialize({
                  childNodes: [child],
                } as unknown as DefaultTreeAdapterTypes.DocumentFragment),
              )
              .join('');

      const nlDate = primaryDateOf(doc) || doc.id;
      const bodyHtml = `
  <div class="newsletter-chrome no-print">
    <nav class="document-breadcrumb" aria-label="현재 위치">
      <ol>
        <li><a href="${escapeAttr(`${prefix}archive/index.html`)}">공개 자료실</a></li>
        <li><a href="${escapeAttr(`${prefix}archive/newsletter/index.html`)}">소식지</a></li>
        <li aria-current="page">${escapeHtml(nlDate)}</li>
      </ol>
    </nav>
    <button type="button" class="btn small newsletter-print-btn" onclick="window.print()">인쇄 / A3 PDF</button>
  </div>
  <article class="page-a3 print-light-surface newsletter-sheet" data-document-category="소식지" data-copy-body>
    ${mainInnerHtml}
  </article>`;

      const htmlOut = renderPageShell({
        title: doc.title,
        description: doc.summary,
        activeNav: 'archive',
        route: doc.route,
        prefix,
        baseUrl,
        assets,
        robots,
        ogType: 'article',
        publishedTime: doc.dates.publishedOn,
        modifiedTime: doc.dates.modifiedOn,
        keywords: topicLabels,
        extraHeadHtml: `<link rel="stylesheet" href="${escapeAttr(nlCssHref)}">`,
        bodyHtml,
      });
      writeOutFile(outDir, doc.route, htmlOut);
      continue;
    }

    // knowledge & notice (extract <style> from head and <main> inner content)
    const srcPath = graph.sourcePathsById.get(doc.id);
    if (!srcPath || !fs.existsSync(srcPath)) {
      throw new Error(`문서 원본 HTML이 없습니다: ${doc.id}`);
    }
    const rawHtml = fs.readFileSync(srcPath, 'utf8').replace(/^\uFEFF/, '');
    const headMatch = rawHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
    const headRaw = headMatch?.[1] ?? '';
    const inlineStyles = [...headRaw.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
      .map((m) => m[0])
      .join('\n');

    const ast = parse5.parse(rawHtml, { sourceCodeLocationInfo: true });
    let mainEl: DefaultTreeAdapterTypes.Element | undefined;
    visitNodes(ast, (node) => {
      if (!mainEl && isElement(node) && node.tagName === 'main') {
        mainEl = node;
      }
    });
    if (!mainEl) {
      throw new Error(`${srcPath}: <main> 요소를 찾을 수 없습니다.`);
    }

    const loc = mainEl.sourceCodeLocation;
    let mainInnerHtml = '';
    if (loc?.startTag?.endOffset !== undefined && loc?.endTag?.startOffset !== undefined) {
      mainInnerHtml = rawHtml.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    } else {
      mainInnerHtml = mainEl.childNodes.map((child) => parse5.serialize({ childNodes: [child] } as unknown as DefaultTreeAdapterTypes.DocumentFragment)).join('');
    }

    mainInnerHtml = mainInnerHtml
      .replace(/<!--\s*document-tools:start\s*-->[\s\S]*?<!--\s*document-tools:end\s*-->/gi, '')
      .replace(/href=(["'])\.\.\/MoM\//g, 'href=$1../mom/')
      .replace(
        /\b(src|href)=(["'])\.\.\/assets\/([^"'?]+)(?:\?[^"']*)?\2/gi,
        (_full, attr: string, quote: string, rel: string) =>
          `${attr}=${quote}${assetHref(prefix, rel, assets)}${quote}`,
      );

    const origClasses =
      mainEl.attrs.find((a) => a.name === 'class')?.value ?? 'archive-container document-article';
    const origId = mainEl.attrs.find((a) => a.name === 'id')?.value;
    const idAttr = origId ? ` id="${escapeAttr(origId)}"` : '';
    const usesLightWrapper =
      inlineStyles.length > 0 || origClasses.includes('archive-container') || origClasses.includes('history-container');
    const articleClasses = usesLightWrapper
      ? `${origClasses} print-light-surface`
      : origClasses;

    const bodyHtml = `
  <article class="${escapeAttr(articleClasses)}"${idAttr} data-document-category="${escapeAttr(CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category)}">
    ${mainInnerHtml}
    ${linkedLedgerHtml}
  </article>
  ${renderDocumentToolsWidget()}`;

    const needsVideoJs = /class=["'][^"']*video-(?:facade|embed)/i.test(mainInnerHtml);
    const extraScripts = [
      needsVideoJs
        ? `<script src="${escapeAttr(assetHref(prefix, 'video-embed.js', assets))}" defer></script>`
        : '',
      `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
    ]
      .filter(Boolean)
      .join('\n');

    const htmlOut = renderPageShell({
      title: doc.title,
      description: doc.summary,
      activeNav: 'archive',
      route: doc.route,
      prefix,
      baseUrl,
      assets,
      robots,
      ogType: 'article',
      publishedTime: doc.dates.publishedOn,
      modifiedTime: doc.dates.modifiedOn,
      keywords: topicLabels,
      extraHeadHtml: inlineStyles,
      bodyHtml,
      extraScriptsHtml: extraScripts,
    });
    writeOutFile(outDir, doc.route, htmlOut);
  }

  return { published, unlisted, skippedInternal };
}

function buildAccountingPages(
  outDir: string,
  ledger: PublicLedgerJson,
  entries: LedgerEntry[],
  coaCfg: CoaConfigJson,
  units: Unit[],
  publicLinks: PublicLinkEntry[],
  graph: ContentGraph,
  assets: AssetManifest,
  baseUrl: string,
): { pages: number; monthlyReports: number; annualReports: number } {
  let pages = 0;

  // 1. Emit _site/accounting/data/{public_ledger.json, public_ledger.js, public_links.js}
  writeOutFile(
    outDir,
    'accounting/data/public_ledger.json',
    JSON.stringify(ledger, null, 2) + '\n',
  );
  writeOutFile(
    outDir,
    'accounting/data/public_ledger.js',
    `window.__PUBLIC_LEDGER__ = ${JSON.stringify(ledger).replace(/</g, '\\u003c')};\n`,
  );
  writeOutFile(
    outDir,
    'accounting/data/public_links.js',
    `window.__PUBLIC_DOC_LINKS__ = ${JSON.stringify(publicLinks).replace(/</g, '\\u003c')};\n`,
  );

  // Links index for monthly reports too
  const linksByTx = new Map<string, PublicLinkEntry[]>();
  for (const lk of publicLinks) {
    const arr = linksByTx.get(lk.txId) ?? [];
    arr.push(lk);
    linksByTx.set(lk.txId, arr);
  }

  // 2. /accounting/index.html (Dashboard)
  {
    const route = 'accounting/index.html';
    const prefix = computePrefixForRoute(route);
    const minY = (ledger.meta.monthsRange[0] ?? '').slice(0, 4);
    const maxY = (ledger.meta.monthsRange[1] ?? '').slice(0, 4);

    const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>노동조합 회계 대시보드</h1>
      <p class="lead">대분류·중분류·세부활동 기준 재정 현황입니다.</p>
    </div>
    <div class="masthead-meta">
      <span id="sync-badge" class="data-stamp">기준: ${escapeHtml(ledger.meta.monthsRange[0])} ~ ${escapeHtml(ledger.meta.monthsRange[1])} (${ledger.meta.totalRecords}건)</span>
    </div>
  </header>

  <div class="toolbar" role="region" aria-label="대시보드 필터">
    <div class="filter-field">
      <label for="f-year">회계연도</label>
      <select id="f-year">
        <option value="${escapeAttr(maxY)}" selected>${escapeHtml(maxY)}년</option>
        <option value="전체">전체 기간 (${escapeHtml(minY)}~${escapeHtml(maxY)})</option>
      </select>
    </div>
    <div class="filter-field">
      <label for="f-unit">회계단위</label>
      <select id="f-unit"><option value="전체">전체 (통합 기준)</option></select>
    </div>
    <div class="filter-field">
      <label for="f-fund">자금 구분</label>
      <select id="f-fund"><option value="전체">전체 자금</option></select>
    </div>
    <button id="btn-reset" type="button" class="btn secondary">초기화</button>
  </div>

  <div class="kpi-strip" role="region" aria-label="주요 재정 요약">
    <div class="kpi"><div class="label">기초 잔액</div><div id="kpi-open" class="value">-</div><div class="sub">기간 개시 통장잔액</div></div>
    <div class="kpi" data-tone="income"><div class="label">조합 수입</div><div id="kpi-inc" class="value">-</div><div class="sub">조합비·찬조·기타수입</div></div>
    <div class="kpi" data-tone="expense"><div class="label">사업 지출</div><div id="kpi-exp" class="value">-</div><div class="sub">지부 교부금 제외 순사업비</div></div>
    <div class="kpi" data-tone="grant"><div class="label">지부 교부·지원</div><div id="kpi-tr" class="value">-</div><div id="kpi-tr-sub" class="sub">-</div></div>
    <div class="kpi" data-tone="balance"><div class="label">기말 잔액</div><div id="kpi-end" class="value">-</div><div id="kpi-end-sub" class="sub">-</div></div>
  </div>

  <section class="section-band" aria-labelledby="sec-charts">
    <div class="section-head">
      <h2 id="sec-charts">월별 추이 및 활동별 시각화</h2>
      <span class="section-sub">항목 선택 시 하위 통계 반영</span>
    </div>

    <div class="chart-grid">
      <section class="chart-card full">
        <div class="chart-head">
          <h3>월별 수입·지출 및 통장 잔액 추이</h3>
          <div id="monthly-mode-switch" class="view-mode-switch" role="group" aria-label="추이 차트 보기 방식">
            <button type="button" id="btn-mode-fit" class="mode-btn" aria-pressed="true">한눈에 보기</button>
            <button type="button" id="btn-mode-pan" class="mode-btn" aria-pressed="false">확대 탐색</button>
          </div>
        </div>
        <div id="readout-monthly" class="chart-readout" aria-live="polite">월을 누르거나 짚으면 수치가 여기에 표시됩니다</div>
        <div id="monthly-scroll" class="chart-scroll-x" tabindex="0" role="region" aria-label="월별 수입·지출 및 통장 잔액 차트">
          <div id="monthly-stage" class="chart-stage-wide"><canvas id="chart-monthly"></canvas></div>
        </div>
        <div id="monthly-minimap-wrap" class="minimap-wrap" hidden>
          <div class="minimap-head">
            <span class="minimap-title">전체 기간 잔액 흐름 (눌러서 시기 이동)</span>
            <span id="minimap-range" class="minimap-range">-</span>
          </div>
          <div id="minimap-viewport" class="minimap-viewport" role="slider" tabindex="0" aria-label="전체 추세 미니맵 이동" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
            <canvas id="chart-monthly-minimap"></canvas>
            <div id="minimap-lens" class="minimap-lens" aria-hidden="true"></div>
          </div>
        </div>
      </section>
    </div>

    <div class="chart-deck" aria-roledescription="carousel" aria-label="활동별 분석 차트 모음">
      <nav id="chart-deck-tabs" class="chart-deck-tabs" aria-label="분석 차트 선택">
        <button type="button" class="chart-deck-tab" aria-current="true">1. 활동별 지출 탐색</button>
        <button type="button" class="chart-deck-tab">2. 세부활동 TOP 10</button>
        <button type="button" class="chart-deck-tab">3. 지출방식별 구성비</button>
        <button type="button" class="chart-deck-tab">4. 조합비 vs 교부금</button>
      </nav>

      <div id="chart-deck-track" class="chart-deck-track" tabindex="0" role="group" aria-label="분석 차트 슬라이드">
        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 1번째: 활동별 지출 탐색">
          <div class="chart-head">
            <h3>활동별 지출 탐색</h3>
            <span id="drill-hint" class="chart-hint" aria-live="polite">1단계 대분류 · 항목 선택 시 중분류 이동</span>
          </div>
          <div class="drill-bar-wrap">
            <div id="drill-breadcrumbs" class="breadcrumb-bar"></div>
            <a id="drill-ledger-link" class="drill-ledger-link" href="ledger.html">전체 지출 내역 보기 →</a>
          </div>
          <div id="readout-drill" class="chart-readout" aria-live="polite"></div>
          <div id="waffle-drill" class="waffle-wrap"></div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 2번째: 주요 세부활동 지출 TOP 10">
          <div class="chart-head">
            <h3>주요 세부활동 지출 TOP 10</h3>
            <span class="chart-hint">대분류 색상 연동 · 막대 선택 시 거래내역 이동</span>
          </div>
          <div id="readout-top-mok" class="chart-readout" aria-live="polite"></div>
          <div id="top-mok-legend" class="top-mok-legend" aria-label="대분류 색상 범례"></div>
          <div class="chart-canvas-wrap"><canvas id="chart-top-mok"></canvas></div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 3번째: 지출방식별 구성비">
          <div class="chart-head">
            <h3>지출방식별 구성비</h3>
            <span class="chart-hint">항목 선택 시 해당 지출 내역 이동</span>
          </div>
          <div id="readout-exp-type" class="chart-readout" aria-live="polite"></div>
          <div id="exp-type-viz" class="exp-rank-wrap"></div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 4번째: 정기조합비 vs 지부 교부금 추이">
          <div class="chart-head">
            <h3>정기조합비 vs 지부 교부금 추이</h3>
            <span class="chart-hint">조합비 수납과 지부 배분 비교</span>
          </div>
          <div id="readout-dues-grant" class="chart-readout" aria-live="polite"></div>
          <div class="chart-canvas-wrap"><canvas id="chart-dues-grant"></canvas></div>
        </section>
      </div>
      <p id="chart-deck-status" class="visually-hidden" role="status" aria-live="polite"></p>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-act-tbl">
    <div class="section-head">
      <h2 id="sec-act-tbl">선택 조건별 세부활동 지출 집계</h2>
      <span class="section-sub">세부활동 선택 시 거래 내역 이동</span>
    </div>
    <div tabindex="0" role="region" aria-labelledby="sec-act-tbl" class="table-wrapper">
      <table>
        <caption class="visually-hidden">선택 조건별 세부활동 지출 집계표</caption>
        <thead><tr><th scope="col">세부활동</th><th scope="col">대분류</th><th scope="col">중분류</th><th scope="col">건수</th><th scope="col">지출액</th><th scope="col">비중</th></tr></thead>
        <tbody id="summary-tbody"></tbody>
      </table>
    </div>
  </section>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title: '회계 대시보드',
        description: '우체국물류지원단 물류노동조합 공개 회계 대시보드',
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('', 'dashboard'),
        bodyHtml,
        extraScriptsHtml: [
          `<script src="${escapeAttr(assetHref(prefix, 'vendor/chart.umd.min.js', assets))}"></script>`,
          '<script src="data/public_ledger.js"></script>',
          `<script src="${escapeAttr(assetHref(prefix, 'dashboard.js', assets))}"></script>`,
        ].join('\n'),
      }),
    );
    pages += 1;
  }

  // 3. /accounting/ledger.html (Ledger Explorer + bidirectional document badges)
  {
    const route = 'accounting/ledger.html';
    const prefix = computePrefixForRoute(route);
    const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>공개 거래 탐색기</h1>
      <p class="lead">연도, 구분, 대분류, 검색어, 거래번호로 원장 내역을 조회합니다.</p>
    </div>
    <div class="masthead-meta">
      <button id="btn-csv" type="button" class="btn secondary small">필터 결과 CSV 저장</button>
    </div>
  </header>

  <div class="toolbar" role="region" aria-label="원장 검색 필터">
    <div class="filter-field">
      <label for="l-year">연도</label>
      <select id="l-year"><option value="전체">전체 기간</option></select>
    </div>
    <div class="filter-field">
      <label for="l-gubun">구분</label>
      <select id="l-gubun"><option value="전체">전체 구분</option></select>
    </div>
    <div class="filter-field">
      <label for="l-gwan">대분류</label>
      <select id="l-gwan"><option value="전체">전체 대분류</option></select>
    </div>
    <div class="filter-field">
      <label for="l-query">검색어 (내용·세부활동·거래번호)</label>
      <input id="l-query" type="search" placeholder="예: 운영위, 초복, HQ-2026-002">
    </div>
    <button id="btn-ledger-reset" type="button" class="btn secondary">초기화</button>
  </div>

  <p id="ledger-stats" class="stats-line" aria-live="polite"></p>

  <div tabindex="0" role="region" aria-label="거래 내역 목록" class="table-wrapper">
    <table>
      <caption class="visually-hidden">공개 원장 거래 내역 목록</caption>
      <thead><tr><th scope="col">일자 · 세부활동</th><th scope="col">거래번호</th><th scope="col">단위</th><th scope="col">구분</th><th scope="col">분류(대·중·세부)</th><th scope="col">지출방식</th><th scope="col">대상·귀속</th><th scope="col">수입금액</th><th scope="col">지출금액</th><th scope="col">내용(적요)</th></tr></thead>
      <tbody id="ledger-tbody"></tbody>
    </table>
  </div>

  <div class="pager-bar">
    <button id="btn-prev" type="button" class="btn secondary small">이전</button>
    <span id="page-info" class="pager-info">1 / 1</span>
    <button id="btn-next" type="button" class="btn secondary small">다음</button>
  </div>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title: '공개 거래 탐색기',
        description: '우체국물류지원단 물류노동조합 공개 원장 거래 탐색기',
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('', 'ledger'),
        bodyHtml,
        extraScriptsHtml: [
          '<script src="data/public_ledger.js"></script>',
          '<script src="data/public_links.js"></script>',
          `<script src="${escapeAttr(assetHref(prefix, 'ledger.js', assets))}"></script>`,
        ].join('\n'),
      }),
    );
    pages += 1;
  }

  // 4. /accounting/coa.html (COA & Standardized Official Unit Names)
  {
    const route = 'accounting/coa.html';
    const prefix = computePrefixForRoute(route);
    const mapGroupsMeta = [
      { key: 'income', label: '수입', cats: ['수입'] },
      { key: 'expense', label: '지출', cats: ['지출'] },
      { key: 'transfer', label: '교부·이월', cats: ['내부이전', '기초이월', '이월차액'] },
    ];
    const groups = mapGroupsMeta
      .map((grp) => {
        const gwans: Array<{
          name: string;
          category: string;
          hangs: Array<{ name: string; moks: Array<{ name: string; desc: string }> }>;
        }> = [];
        const byGid = new Map<string, (typeof gwans)[number]>();
        for (const a of coaCfg.accounts) {
          if (!grp.cats.includes(a.category)) continue;
          const gid = `${a.category}::${a.gwan}`;
          let gw = byGid.get(gid);
          if (!gw) {
            gw = { name: a.gwan, category: a.category, hangs: [] };
            byGid.set(gid, gw);
            gwans.push(gw);
          }
          let hang = gw.hangs.find((h) => h.name === a.hang);
          if (!hang) {
            hang = { name: a.hang, moks: [] };
            gw.hangs.push(hang);
          }
          hang.moks.push({ name: a.mok, desc: a.description });
        }
        return { key: grp.key, label: grp.label, gwans };
      })
      .filter((g) => g.gwans.length > 0);

    const mapData = {
      groups,
      units: units.map((u) => ({
        code: u.code,
        name: u.officialName,
        fullName: `${u.fullName} (원장 약칭: ${u.shortName})`,
        active: u.status === 'active',
        note: u.note,
        period: `${u.openedOn} ~ ${u.closedOn ?? '현재'}`,
      })),
    };

    const hqUnits = mapData.units.filter((u) => u.code === 'HQ');
    const brUnits = mapData.units.filter((u) => u.code !== 'HQ');
    const fallbackTree = `<ul class="coa-tree"><li><strong>물류노동조합 회계</strong><ul>
      <li><strong>회계단위</strong><ul>${hqUnits
        .map(
          (u) =>
            `<li>${escapeHtml(u.name)} <span class="coa-tree-note">${escapeHtml(u.note)}</span><ul>${brUnits
              .map(
                (b) =>
                  `<li>${escapeHtml(b.name)} <span class="coa-tree-note">${escapeHtml(b.fullName)}${b.active ? '' : ' · 폐지'}</span></li>`,
              )
              .join('')}</ul></li>`,
        )
        .join('')}</ul></li>
      <li><strong>수입·지출 분류</strong><ul>${groups
        .map(
          (g) =>
            `<li><strong>${escapeHtml(g.label)}</strong><ul>${g.gwans
              .map(
                (w) =>
                  `<li><strong>${escapeHtml(w.name)}</strong><ul>${w.hangs
                    .map(
                      (h) =>
                        `<li>${escapeHtml(h.name)}<ul>${h.moks
                          .map(
                            (m) =>
                              `<li><b>${escapeHtml(m.name)}</b> <span class="coa-tree-note">${escapeHtml(m.desc)}</span></li>`,
                          )
                          .join('')}</ul></li>`,
                    )
                    .join('')}</ul></li>`,
              )
              .join('')}</ul></li>`,
        )
        .join('')}</ul></li>
    </ul></li></ul>`;

    const unitRows = units
      .map((u) => {
        const st = u.status === 'active' ? '운영중' : '폐지';
        const per = `${u.openedOn} ~ ${u.closedOn ?? '현재'}`;
        return `<tr><th scope="row">${escapeHtml(u.code)}</th>
          <td class="ctr" data-label="표준명칭">${escapeHtml(u.officialName)}</td>
          <td class="ctr" data-label="원장약칭">${escapeHtml(u.shortName)}</td>
          <td data-label="정식명칭">${escapeHtml(u.fullName)}</td>
          <td class="ctr" data-label="상태">${st}</td>
          <td class="ctr" data-label="운영기간">${escapeHtml(per)}</td>
          <td data-label="비고">${escapeHtml(u.note)}</td></tr>`;
      })
      .join('\n');

    const coaRows = coaCfg.accounts
      .map((a) => {
        const catDisp =
          a.category === '내부이전'
            ? '지부 교부·정산'
            : a.category === '이월차액'
              ? '이월 잔액 조정'
              : a.category;
        return `<tr><th scope="row">${escapeHtml(a.mok)}</th>
          <td class="ctr" data-label="구분">${escapeHtml(catDisp)}</td>
          <td data-label="대분류">${escapeHtml(a.gwan)}</td>
          <td data-label="중분류">${escapeHtml(a.hang)}</td>
          <td data-label="설명">${escapeHtml(a.description)}</td></tr>`;
      })
      .join('\n');

    const mapJson = JSON.stringify(mapData).replace(/</g, '\\u003c');
    const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>수입·지출 분류 기준 및 회계단위 안내</h1>
      <p class="lead">수입·지출 3단계 분류와 회계단위 기준표입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">${coaCfg.accounts.length}개 세부활동 · ${units.length}개 단위</span>
    </div>
  </header>

  <div class="coa-tabs-mount" id="coa-tabs-mount"></div>

  <div class="coa-panel" id="panel-diagram" data-tab="diagram" data-tab-label="다이어그램">
    <section class="section-band" aria-labelledby="sec-coa-map">
      <div class="section-head">
        <h2 id="sec-coa-map">한눈에 보는 회계 구조</h2>
        <span class="section-sub">항목 선택 시 하위 분류 펼침</span>
      </div>
      <div class="coa-map" id="coa-map">
        <div class="coa-map-fallback" id="coa-map-fallback">${fallbackTree}</div>
      </div>
      <script type="application/json" id="coa-map-data">${mapJson}</script>
    </section>
  </div>

  <div class="coa-panel" id="panel-table" data-tab="table" data-tab-label="표">
    <section class="section-band" aria-labelledby="sec-units">
      <div class="section-head">
        <h2 id="sec-units">1. 회계단위 안내 (본조 · 지부)</h2>
        <span class="section-sub">본조 및 지부 회계단위</span>
      </div>
      <div tabindex="0" role="region" aria-labelledby="sec-units" class="table-wrapper">
        <table>
          <caption class="visually-hidden">회계단위 목록</caption>
          <thead><tr><th scope="col">코드</th><th scope="col">표준명칭</th><th scope="col">원장약칭</th><th scope="col">정식명칭</th><th scope="col">상태</th><th scope="col">운영기간</th><th scope="col">비고</th></tr></thead>
          <tbody>${unitRows}</tbody>
        </table>
      </div>
    </section>

    <section class="section-band" aria-labelledby="sec-coa-list">
      <div class="section-head">
        <h2 id="sec-coa-list">2. 수입·지출 분류 기준표 (대분류 · 중분류 · 세부활동 · ${coaCfg.accounts.length}개)</h2>
        <span class="section-sub">대분류 · 중분류 · 세부활동</span>
      </div>
      <div tabindex="0" role="region" aria-labelledby="sec-coa-list" class="table-wrapper">
        <table>
          <caption class="visually-hidden">수입·지출 분류 기준표</caption>
          <thead><tr><th scope="col">세부활동</th><th scope="col">구분</th><th scope="col">대분류</th><th scope="col">중분류</th><th scope="col">항목 설명</th></tr></thead>
          <tbody>${coaRows}</tbody>
        </table>
      </div>
    </section>
  </div>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title: '회계기준·단위 안내',
        description: '노동조합 수입·지출 분류 기준 및 본조·지부 회계단위 안내',
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('', 'coa'),
        bodyHtml,
        extraScriptsHtml: [
          `<script src="${escapeAttr(assetHref(prefix, 'coa-tabs.js', assets))}"></script>`,
          `<script src="${escapeAttr(assetHref(prefix, 'coa-map.js', assets))}"></script>`,
        ].join('\n'),
      }),
    );
    pages += 1;
  }

  // Helper for public gubun display label
  const gubunDisp: Record<string, string> = {
    '내부이전(전출)': '지부 교부·지원(전출)',
    '내부이전(전입)': '지부 회수·환수(전입)',
    '이월차액': '이월 잔액 조정',
  };

  // Map financePeriod -> public MoM document for report-to-MoM cross-linking
  const momByFinancePeriod = new Map<string, DocumentRecordV3>();
  for (const d of graph.listedDocuments) {
    if (d.category === 'mom' && d.financePeriod) {
      momByFinancePeriod.set(d.financePeriod, d);
    }
  }

  // 5. /accounting/reports/monthly/<YYYY-MM>.html
  const months = [...new Set(entries.map((r) => r.ym).filter(Boolean))].sort();
  const years = [...new Set(entries.map((r) => r.year).filter(Boolean))].sort((a, b) => a - b);

  for (let idx = 0; idx < months.length; idx += 1) {
    const ym = months[idx]!;
    const route = `accounting/reports/monthly/${ym}.html`;
    const prefix = computePrefixForRoute(route);
    const priorBal = entries
      .filter((r) => r.ym < ym)
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const curr = entries.filter((r) => r.ym === ym);
    const cs = summarizePeriod(curr);
    const endBal = priorBal + cs.op + cs.net;
    const recentYms = months.slice(Math.max(0, idx - 2), idx + 1);

    let runB = entries
      .filter((r) => r.ym < (recentYms[0] ?? ym))
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const recentRows = recentYms
      .map((ry) => {
        const ms = summarizePeriod(entries.filter((r) => r.ym === ry));
        const opM = runB + ms.op;
        const endM = opM + ms.net;
        runB = endM;
        const cls = ry === ym ? ' class="subtot"' : '';
        return `<tr${cls}><th scope="row">${escapeHtml(ry)}</th>
          <td class="num" data-label="기초잔액">${fmtWon(opM)}</td>
          <td class="num" data-label="조합 수입">${fmtWon(ms.inc)}</td>
          <td class="num" data-label="사업 지출">${fmtWon(ms.exp)}</td>
          <td class="num" data-label="지부 교부·정산">${fmtWon(ms.trNet)}</td>
          <td class="num" data-label="이월 조정">${fmtWon(ms.adj)}</td>
          <td class="num" data-label="기말잔액">${fmtWon(endM)}</td></tr>`;
      })
      .join('\n');

    const txRows = curr
      .map((r) => {
        const cls = r.gubun === '이월차액' ? ' class="muted"' : '';
        const etCls = r.expType ? 'ctr' : 'ctr empty-cell';
        const ivCls = r.inc ? 'num num-inc' : 'num empty-cell';
        const evCls = r.exp ? 'num num-exp' : 'num empty-cell';
        const noteCls = r.note ? '' : 'empty-cell';
        const txLinks = linksByTx.get(r.txId) ?? [];
        const badges =
          txLinks.length > 0
            ? `<div class="tx-doc-badges">${txLinks
                .map(
                  (lk) =>
                    `<a class="tx-doc-badge" href="${escapeAttr(`${prefix}${lk.route}`)}">${escapeHtml(lk.docTitle)}</a>`,
                )
                .join('')}</div>`
            : '';
        return `<tr${cls}><th scope="row">${escapeHtml(r.date)} · ${escapeHtml(r.mok)}</th>
          <td class="ctr" data-label="거래번호"><a href="${escapeAttr(`../../ledger.html?tx=${encodeURIComponent(r.txId)}`)}">${escapeHtml(r.txId)}</a></td>
          <td class="ctr" data-label="단위">${escapeHtml(r.unitName)}</td>
          <td class="ctr" data-label="구분">${escapeHtml(gubunDisp[r.gubun] ?? r.gubun)}</td>
          <td class="coa-cell" data-label="분류(대·중·세부)"><span class="coa-path"><span class="coa-gwan">${escapeHtml(r.gwan)} <span class="coa-sep">&gt;</span></span> <span class="coa-hang">${escapeHtml(r.hang)} <span class="coa-sep">&gt;</span></span> <b class="coa-mok">${escapeHtml(r.mok)}</b></span></td>
          <td class="${etCls}" data-label="지출방식">${escapeHtml(r.expType)}</td>
          <td class="${ivCls}" data-label="수입">${r.inc ? `+${fmtWon(r.inc)}` : ''}</td>
          <td class="${evCls}" data-label="지출">${r.exp ? `-${fmtWon(r.exp)}` : ''}</td>
          <td class="num" data-label="단위잔액">${fmtWon(r.unitBal)}</td>
          <td class="${noteCls}" data-label="내용">${escapeHtml(r.note)}${badges}</td></tr>`;
      })
      .join('\n');

    const prevYm = idx > 0 ? months[idx - 1] : undefined;
    const nextYm = idx + 1 < months.length ? months[idx + 1] : undefined;
    const prevBtn = prevYm
      ? `<a class="btn secondary small" href="${escapeAttr(`${prevYm}.html`)}">← ${escapeHtml(prevYm)} 보고서</a>`
      : '<button type="button" class="btn secondary small" disabled>← 이전 없음</button>';
    const nextBtn = nextYm
      ? `<a class="btn secondary small" href="${escapeAttr(`${nextYm}.html`)}">${escapeHtml(nextYm)} 보고서 →</a>`
      : '<button type="button" class="btn secondary small" disabled>다음 없음 →</button>';
    const navBar = `<nav class="report-nav-bar" aria-label="월간 보고서 이동">
      ${prevBtn}
      <a class="btn secondary small" href="../index.html">전체 보고서 목록</a>
      ${nextBtn}
    </nav>`;

    const [yN = '', mN = '0'] = ym.split('-');
    const title = `${yN}년 ${Number(mN)}월 운영위원회 재정보고`;
    const matchedMom = momByFinancePeriod.get(ym);
    const momBanner = matchedMom
      ? `<div class="privacy-notice-banner no-print">연관 회의록: <a href="${escapeAttr(`${prefix}${matchedMom.route}`)}"><strong>${escapeHtml(matchedMom.title)}</strong> 원문 보기 →</a></div>`
      : '';

    const bodyHtml = `
  <header class="page-masthead" data-year-tone="${yearTone(Number(yN))}">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="lead">${escapeHtml(yN)}년 ${Number(mN)}월 수지 요약 및 거래 내역입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">${escapeHtml(yN)}년 · ${escapeHtml(ym)}</span>
    </div>
  </header>

  ${navBar}
  ${momBanner}

  <div class="kpi-strip" role="region" aria-label="당월 재정 요약">
    <div class="kpi"><div class="label">기초 잔액</div><div class="value">${fmtWon(priorBal + cs.op)}원</div></div>
    <div class="kpi" data-tone="income"><div class="label">조합 수입</div><div class="value">${fmtWon(cs.inc)}원</div></div>
    <div class="kpi" data-tone="expense"><div class="label">사업 지출</div><div class="value">${fmtWon(cs.exp)}원</div></div>
    <div class="kpi" data-tone="grant"><div class="label">지부 교부·지원</div><div class="value">${fmtWon(cs.trOut)}원</div></div>
    <div class="kpi" data-tone="balance"><div class="label">기말 잔액</div><div class="value">${fmtWon(endBal)}원</div></div>
  </div>

  <section class="section-band" aria-labelledby="sec-r">
    <div class="section-head">
      <h2 id="sec-r">1. 최근 3개월 수지 추이</h2>
      <span class="section-sub">당월 포함 최근 3개월 월간 잔액 흐름</span>
    </div>
    <div tabindex="0" role="region" aria-labelledby="sec-r" class="table-wrapper">
      <table>
        <caption class="visually-hidden">최근 3개월 수지 추이표</caption>
        <thead><tr><th scope="col">보고월</th><th scope="col">기초잔액</th><th scope="col">조합 수입</th><th scope="col">사업 지출</th><th scope="col">지부 교부·정산</th><th scope="col">이월 조정</th><th scope="col">기말잔액</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-d">
    <div class="section-head">
      <h2 id="sec-d">2. 당월 세부 거래 내역 (${curr.length}건)</h2>
      <span class="section-sub">일자 및 세부활동 기준 상세 원장</span>
    </div>
    <div tabindex="0" role="region" aria-labelledby="sec-d" class="table-wrapper">
      <table>
        <caption class="visually-hidden">당월 세부 거래 내역표</caption>
        <thead><tr><th scope="col">일자 · 세부활동</th><th scope="col">거래번호</th><th scope="col">단위</th><th scope="col">구분</th><th scope="col">분류(대·중·세부)</th><th scope="col">지출방식</th><th scope="col">수입</th><th scope="col">지출</th><th scope="col">단위잔액</th><th scope="col">내용</th></tr></thead>
        <tbody>${txRows}</tbody>
      </table>
    </div>
  </section>

  <nav class="report-nav-bar bottom" aria-label="하단 월간 보고서 이동">
    ${prevBtn}
    <a class="btn secondary small" href="../index.html">전체 보고서 목록</a>
    ${nextBtn}
  </nav>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title,
        description: `${title} 공개 재정 요약`,
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('../../', 'reports'),
        bodyHtml,
      }),
    );
    pages += 1;
  }

  // 6. /accounting/reports/annual/<YYYY>.html (using inline SVG charts)
  for (let idx = 0; idx < years.length; idx += 1) {
    const targetYear = years[idx]!;
    const route = `accounting/reports/annual/${targetYear}.html`;
    const prefix = computePrefixForRoute(route);
    const yRecs = entries.filter((r) => r.year === targetYear);
    const priorBal = entries
      .filter((r) => r.year < targetYear)
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const cs = summarizePeriod(yRecs);
    const opBal = priorBal + cs.op;
    const endBal = opBal + cs.net;
    const prevYear = targetYear - 1;
    const prevRecs = entries.filter((r) => r.year === prevYear);
    const ps = prevRecs.length > 0 ? summarizePeriod(prevRecs) : undefined;

    // Chart datasets (matched to Dashboard palette & visualization types)
    const yMonths = [...new Set(yRecs.map((r) => r.ym).filter(Boolean))].sort();
    let runBal = priorBal;
    const flowPoints = yMonths.map((ym) => {
      const mRecs = yRecs.filter((r) => r.ym === ym);
      const s = summarizePeriod(mRecs);
      runBal += s.op + s.net;
      return {
        label: `${Number(ym.slice(5, 7))}월`,
        inc: s.inc,
        exp: s.exp,
        endBal: runBal,
      };
    });

    const gwanMap = new Map<string, number>();
    const mokMap = new Map<string, number>();
    const mokGwanMap = new Map<string, string>();
    const etMap = new Map<string, number>();
    for (const r of yRecs) {
      if (r.gubun !== '지출') continue;
      gwanMap.set(r.gwan, (gwanMap.get(r.gwan) ?? 0) + r.exp);
      mokMap.set(r.mok, (mokMap.get(r.mok) ?? 0) + r.exp);
      if (!mokGwanMap.has(r.mok) && r.gwan) {
        mokGwanMap.set(r.mok, r.gwan);
      }
      if (r.expType) {
        etMap.set(r.expType, (etMap.get(r.expType) ?? 0) + r.exp);
      }
    }
    const totExpDenom = cs.exp || 1;
    const gwanRanked = [...gwanMap.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const gwanColorMap = new Map(
      gwanRanked.map(([gwan], i) => [gwan, CHART_PALETTE_CSS[i % CHART_PALETTE_CSS.length]!]),
    );
    const gwanItems = gwanRanked.map(([label, value], i) => ({
      label,
      value,
      pct: (value / totExpDenom) * 100,
      color: CHART_PALETTE_CSS[i % CHART_PALETTE_CSS.length]!,
    }));

    const mokRanked = [...mokMap.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const mokItems = mokRanked.map(([label, value]) => ({
      label,
      value,
      color: gwanColorMap.get(mokGwanMap.get(label) ?? '') ?? CHART_PALETTE_CSS[0],
    }));

    const etItems = [...etMap.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({
        label,
        value,
        pct: (value / totExpDenom) * 100,
        color: CHART_PALETTE_CSS[i % CHART_PALETTE_CSS.length]!,
      }));

    const svgMonthly = renderMonthlyFlowSvg(
      flowPoints,
      `${targetYear}년 월별 조합 수입·사업 지출 및 잔액 추이`,
      { hideTitle: true },
    );
    const svgMok = renderActivityBarsSvg(
      mokItems,
      `${targetYear}년 주요 세부활동별 지출 TOP 10`,
      { hideTitle: true },
    );

    const duesGrantGroups = yMonths.map((ym) => {
      const mRecs = yRecs.filter((r) => r.ym === ym);
      const dues = mRecs
        .filter((r) => r.gwan === '조합비수입')
        .reduce((acc, r) => acc + r.inc, 0);
      const grants = mRecs
        .filter((r) => r.mok === '지부 교부금')
        .reduce((acc, r) => acc + r.exp, 0);
      return {
        label: `${Number(ym.slice(5, 7))}월`,
        series: [
          { name: '정기조합비 수입', value: dues, color: 'var(--chart-cobalt, #516db2)' },
          { name: '지부 교부금', value: grants, color: 'var(--chart-grant, #c48823)' },
        ],
      };
    });
    const svgDuesGrant = renderUnitComparisonSvg(
      duesGrantGroups,
      `${targetYear}년 정기조합비 vs 지부 교부금 추이`,
      { hideTitle: true },
    );

    const ledgerBase = `${prefix}accounting/ledger.html`;
    const buildAnnualLedgerHref = (params: { gubun?: string; gwan?: string; q?: string }) => {
      const sp = new URLSearchParams({ year: String(targetYear) });
      if (params.gubun) sp.set('gubun', params.gubun);
      if (params.gwan) sp.set('gwan', params.gwan);
      if (params.q) sp.set('q', params.q);
      return `${ledgerBase}?${sp.toString()}`;
    };

    // Card 1: 100-Cell Waffle for Gwan
    const waffleGridItems = gwanItems.slice(0, 100);
    const waffleCounts = allocateWaffleCells(waffleGridItems.map((it) => it.value));
    const waffleCellsHtml = waffleGridItems
      .flatMap((it, i) => {
        const titleAttr = `${it.label}: ${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)`;
        return Array.from(
          { length: waffleCounts[i] ?? 0 },
          () =>
            `<div class="waffle-cell" data-idx="${i}" data-label="${escapeAttr(it.label)}" data-val="${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)" data-color="${escapeAttr(it.color)}" style="--cell-color:${escapeAttr(it.color)}" title="${escapeAttr(titleAttr)}" aria-hidden="true"></div>`,
        );
      })
      .join('');
    const waffleLegendHtml = gwanItems
      .map((it, i) => {
        const href = buildAnnualLedgerHref({ gubun: '지출', gwan: it.label });
        return `<a class="waffle-legend-btn" href="${escapeAttr(href)}" data-idx="${i}" data-label="${escapeAttr(it.label)}" data-val="${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)" data-color="${escapeAttr(it.color)}" style="--cell-color:${escapeAttr(it.color)}">
          <span class="waffle-swatch" aria-hidden="true"></span>
          <span class="waffle-lbl">${escapeHtml(it.label)}</span>
          <span class="waffle-meta"><strong>${it.pct.toFixed(1)}%</strong> <span class="waffle-amt">${fmtWon(it.value)}원</span></span>
          <span class="waffle-arrow" aria-hidden="true">→</span>
        </a>`;
      })
      .join('');
    const waffleHtml =
      gwanItems.length > 0
        ? `<div class="waffle-stage">
            <div class="waffle-grid" role="img" aria-label="${targetYear}년 대분류별 지출 비중 100칸 와플 그리드">${waffleCellsHtml}</div>
            <div class="waffle-caption">1칸 ≈ 1% · 총 100칸</div>
          </div>
          <div class="waffle-legend">${waffleLegendHtml}</div>`
        : `<p class="chart-empty">표시할 지출 내역이 없습니다.</p>`;
    const waffleDefaultReadout = gwanItems[0]
      ? `<span class="readout-key">${escapeHtml(gwanItems[0].label)} (1위)</span><span class="readout-items" data-count="1"><span class="readout-item" style="--swatch-color:${escapeAttr(gwanItems[0].color)}"><span class="readout-label">지출액</span><b class="readout-val">${fmtWon(gwanItems[0].value)}원 (${gwanItems[0].pct.toFixed(1)}%)</b></span></span>`
      : `<span class="readout-key">표시할 데이터가 없습니다</span>`;

    // Card 2: TOP 10 Gwan legend + default readout
    const usedTopGwans = new Set(mokRanked.map(([mok]) => mokGwanMap.get(mok)).filter(Boolean));
    const topMokLegendHtml = [...gwanColorMap.entries()]
      .filter(([g]) => usedTopGwans.has(g))
      .map(
        ([g, col]) =>
          `<span class="top-mok-pill"><span class="waffle-swatch" style="--cell-color:${escapeAttr(col)}" aria-hidden="true"></span>${escapeHtml(g)}</span>`,
      )
      .join('');
    const topMokDefaultReadout = mokRanked[0]
      ? (() => {
          const [lbl, val] = mokRanked[0]!;
          const gwan = mokGwanMap.get(lbl) ?? '지출액';
          const col = gwanColorMap.get(gwan) ?? CHART_PALETTE_CSS[0];
          return `<span class="readout-key">1위 · ${escapeHtml(lbl)}</span><span class="readout-items" data-count="1"><span class="readout-item" style="--swatch-color:${escapeAttr(col)}"><span class="readout-label">${escapeHtml(gwan)}</span><b class="readout-val">${fmtWon(val)}원</b></span></span>`;
        })()
      : `<span class="readout-key">표시할 데이터가 없습니다</span>`;

    // Card 3: 100% Stacked Bar + Ranked Rows for ExpType
    const expStackSegsHtml = etItems
      .map((it, i) => {
        const href = buildAnnualLedgerHref({ gubun: '지출', q: it.label });
        return `<a class="exp-stack-seg" href="${escapeAttr(href)}" data-idx="${i}" data-label="${escapeAttr(it.label)}" data-val="${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)" data-color="${escapeAttr(it.color)}" style="flex-grow:${it.value};--seg-color:${escapeAttr(it.color)}" aria-label="${escapeAttr(`${it.label} ${it.pct.toFixed(1)}% (${fmtWon(it.value)}원) 거래 내역 보기`)}" title="${escapeAttr(`${it.label}: ${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)`)}"></a>`;
      })
      .join('');
    const expRankRowsHtml = etItems
      .map((it, i) => {
        const href = buildAnnualLedgerHref({ gubun: '지출', q: it.label });
        return `<a class="exp-rank-row" href="${escapeAttr(href)}" data-idx="${i}" data-label="${escapeAttr(it.label)}" data-val="${fmtWon(it.value)}원 (${it.pct.toFixed(1)}%)" data-color="${escapeAttr(it.color)}" style="--item-color:${escapeAttr(it.color)}">
          <div class="exp-rank-top">
            <span class="exp-rank-swatch" aria-hidden="true"></span>
            <span class="exp-rank-name">${escapeHtml(it.label)}</span>
            <span class="exp-rank-nums">
              <strong>${it.pct.toFixed(1)}%</strong>
              <span class="exp-rank-amt">${fmtWon(it.value)}원</span>
              <span class="exp-rank-arrow" aria-hidden="true">→</span>
            </span>
          </div>
          <span class="exp-rank-track" aria-hidden="true"><span class="exp-rank-fill" style="width:${it.pct.toFixed(2)}%"></span></span>
        </a>`;
      })
      .join('');
    const expTypeHtml =
      etItems.length > 0
        ? `<div class="exp-stack-bar" role="group" aria-label="${targetYear}년 지출방식별 100% 누적 구성 막대">${expStackSegsHtml}</div>
          <div class="exp-rank-list">${expRankRowsHtml}</div>`
        : `<p class="chart-empty">표시할 지출 내역이 없습니다.</p>`;
    const expTypeDefaultReadout = etItems[0]
      ? `<span class="readout-key">${escapeHtml(etItems[0].label)} (최다)</span><span class="readout-items" data-count="1"><span class="readout-item" style="--swatch-color:${escapeAttr(etItems[0].color)}"><span class="readout-label">지출액</span><b class="readout-val">${fmtWon(etItems[0].value)}원 (${etItems[0].pct.toFixed(1)}%)</b></span></span>`
      : `<span class="readout-key">표시할 데이터가 없습니다</span>`;

    // Card 4: Dues vs Grant annual totals readout
    const totalDues = yRecs
      .filter((r) => r.gwan === '조합비수입')
      .reduce((acc, r) => acc + r.inc, 0);
    const totalGrants = yRecs
      .filter((r) => r.mok === '지부 교부금')
      .reduce((acc, r) => acc + r.exp, 0);
    const duesGrantReadout = `<span class="readout-key">${targetYear}년 합계</span><span class="readout-items" data-count="2"><span class="readout-item" style="--swatch-color:var(--chart-cobalt, #516db2)"><span class="readout-label">조합비</span><b class="readout-val">${fmtWon(totalDues)}원</b></span><span class="readout-item" style="--swatch-color:var(--chart-grant, #c48823)"><span class="readout-label">교부금</span><b class="readout-val">${fmtWon(totalGrants)}원</b></span></span>`;
    const monthlyReadout = `<span class="readout-key">${targetYear}년 총괄</span><span class="readout-items" data-count="3"><span class="readout-item" style="--swatch-color:var(--chart-income, #39793c)"><span class="readout-label">수입</span><b class="readout-val">${fmtWon(cs.inc)}원</b></span><span class="readout-item" style="--swatch-color:var(--chart-expense, #b3392b)"><span class="readout-label">지출</span><b class="readout-val">${fmtWon(cs.exp)}원</b></span><span class="readout-item" style="--swatch-color:var(--chart-cobalt, #516db2)"><span class="readout-label">기말잔액</span><b class="readout-val">${fmtWon(endBal)}원</b></span></span>`;

    const coaRows: string[] = [];
    for (const acc of coaCfg.accounts) {
      const { category: cat, gwan: gw, hang: ha, mok: mo } = acc;
      if (cat === '기초이월' || cat === '이월차액') continue;
      let curV = 0;
      let prvV = 0;
      let cnt = 0;
      let pctS = '-';
      let catDisp = cat;
      if (cat === '내부이전') {
        for (const r of yRecs) {
          if (r.gwan === gw && r.hang === ha && r.mok === mo) {
            curV += r.gubun.includes('전출') ? r.exp : r.inc;
            cnt += 1;
          }
        }
        for (const r of prevRecs) {
          if (r.gwan === gw && r.hang === ha && r.mok === mo) {
            prvV += r.gubun.includes('전출') ? r.exp : r.inc;
          }
        }
        catDisp = '지부 교부·정산';
      } else {
        const useInc = cat === '수입';
        for (const r of yRecs) {
          if (r.gubun === cat && r.gwan === gw && r.hang === ha && r.mok === mo) {
            curV += useInc ? r.inc : r.exp;
            cnt += 1;
          }
        }
        for (const r of prevRecs) {
          if (r.gubun === cat && r.gwan === gw && r.hang === ha && r.mok === mo) {
            prvV += useInc ? r.inc : r.exp;
          }
        }
        const denom = useInc ? cs.inc || 1 : cs.exp || 1;
        pctS = `${((curV / denom) * 100).toFixed(1)}%`;
      }
      if (curV === 0 && prvV === 0) continue;
      const diff = curV - prvV;
      coaRows.push(
        `<tr><th scope="row">${escapeHtml(mo)}</th>
          <td class="ctr" data-label="구분">${escapeHtml(catDisp)}</td>
          <td data-label="대분류">${escapeHtml(gw)}</td>
          <td data-label="중분류">${escapeHtml(ha)}</td>
          <td class="ctr" data-label="건수">${cnt}</td>
          <td class="num" data-label="${prevYear}년">${ps ? fmtWon(prvV) : '-'}</td>
          <td class="num" data-label="${targetYear}년"><b>${fmtWon(curV)}</b></td>
          <td class="num" data-label="증감">${ps ? `${diff >= 0 ? '+' : ''}${fmtWon(diff)}` : '-'}</td>
          <td class="num" data-label="비중">${pctS}</td></tr>`,
      );
    }

    const prevY = idx > 0 ? years[idx - 1] : undefined;
    const nextY = idx + 1 < years.length ? years[idx + 1] : undefined;
    const prevBtn = prevY
      ? `<a class="btn secondary small" href="${prevY}.html">← ${prevY}년 결산</a>`
      : '<button type="button" class="btn secondary small" disabled>← 이전 연도 없음</button>';
    const nextBtn = nextY
      ? `<a class="btn secondary small" href="${nextY}.html">${nextY}년 결산 →</a>`
      : '<button type="button" class="btn secondary small" disabled>다음 연도 없음 →</button>';
    const navBar = `<nav class="report-nav-bar" aria-label="연간 결산 보고서 이동">
      ${prevBtn}
      <a class="btn secondary small" href="../index.html">전체 보고서 목록</a>
      ${nextBtn}
    </nav>`;

    const title = `${targetYear}년 대의원대회 결산 보고서`;
    const bodyHtml = `
  <header class="page-masthead" data-year-tone="${yearTone(targetYear)}">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p class="lead">연간 수지 현황 및 활동별 결산입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">${targetYear}년 결산</span>
    </div>
  </header>

  ${navBar}

  <div class="kpi-strip" role="region" aria-label="${targetYear}년 재정 요약">
    <div class="kpi"><div class="label">기초 잔액</div><div class="value">${fmtWon(opBal)}원</div></div>
    <div class="kpi" data-tone="income"><div class="label">조합 수입</div><div class="value">${fmtWon(cs.inc)}원</div></div>
    <div class="kpi" data-tone="expense"><div class="label">사업 지출</div><div class="value">${fmtWon(cs.exp)}원</div></div>
    <div class="kpi" data-tone="grant"><div class="label">지부 교부·지원</div><div class="value">${fmtWon(cs.trOut)}원</div></div>
    <div class="kpi" data-tone="balance"><div class="label">기말 잔액</div><div class="value">${fmtWon(endBal)}원</div></div>
  </div>

  <section class="section-band" aria-labelledby="sec-annual-charts">
    <div class="section-head">
      <h2 id="sec-annual-charts">1. 연간 재정 시각화</h2>
      <span class="section-sub">월별 추이 및 지출 비중 (항목 선택 시 거래내역 이동)</span>
    </div>
    <div class="chart-grid">
      <section class="chart-card full">
        <div class="chart-head">
          <h3>월별 수입·지출 및 기말 잔액 추이</h3>
          <span class="chart-hint">단위: 만원 · 수입·지출 막대 및 잔액 추이선</span>
        </div>
        <div class="chart-readout">${monthlyReadout}</div>
        <div class="svg-chart-body">${svgMonthly}</div>
      </section>
    </div>

    <div class="chart-deck" aria-roledescription="carousel" aria-label="활동별 결산 분석 차트 모음">
      <nav id="annual-deck-tabs" class="chart-deck-tabs" aria-label="분석 차트 선택">
        <button type="button" class="chart-deck-tab" aria-current="true">1. 대분류별 지출</button>
        <button type="button" class="chart-deck-tab">2. 세부활동 TOP 10</button>
        <button type="button" class="chart-deck-tab">3. 지출방식별 구성비</button>
        <button type="button" class="chart-deck-tab">4. 조합비 vs 교부금</button>
      </nav>

      <div id="annual-deck-track" class="chart-deck-track" tabindex="0" role="group" aria-label="분석 차트 슬라이드">
        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 1번째: 대분류별 사업 지출 비중">
          <div class="chart-head">
            <h3>대분류별 사업 지출 비중</h3>
            <span class="chart-hint">100칸 와플 · 항목 선택 시 거래내역 이동</span>
          </div>
          <div id="annual-readout-waffle" class="chart-readout">${waffleDefaultReadout}</div>
          <div id="annual-waffle" class="waffle-wrap">${waffleHtml}</div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 2번째: 주요 세부활동별 지출 TOP 10">
          <div class="chart-head">
            <h3>주요 세부활동별 지출 TOP 10</h3>
            <span class="chart-hint">대분류 색상 연동 · 상위 10개 활동</span>
          </div>
          <div class="chart-readout">${topMokDefaultReadout}</div>
          <div class="top-mok-legend" aria-label="대분류 색상 범례">${topMokLegendHtml}</div>
          <div class="svg-chart-body">${svgMok}</div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 3번째: 지출방식별 구성비">
          <div class="chart-head">
            <h3>지출방식별 구성비</h3>
            <span class="chart-hint">항목 선택 시 해당 지출 내역 이동</span>
          </div>
          <div id="annual-readout-exptype" class="chart-readout">${expTypeDefaultReadout}</div>
          <div id="annual-exptype" class="exp-rank-wrap">${expTypeHtml}</div>
        </section>

        <section class="chart-card" role="group" aria-roledescription="slide" aria-label="4개 중 4번째: 정기조합비 vs 지부 교부금 추이">
          <div class="chart-head">
            <h3>정기조합비 vs 지부 교부금 추이</h3>
            <span class="chart-hint">단위: 만원 · 조합비 수납과 지부 배분 비교</span>
          </div>
          <div class="chart-readout">${duesGrantReadout}</div>
          <div class="svg-chart-body">${svgDuesGrant}</div>
        </section>
      </div>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-ac">
    <div class="section-head">
      <h2 id="sec-ac">2. 활동별 연간 결산표 (대분류 · 중분류 · 세부활동)</h2>
      <span class="section-sub">전년 대비 증감 및 구성비</span>
    </div>
    <div tabindex="0" role="region" aria-labelledby="sec-ac" class="table-wrapper">
      <table>
        <caption class="visually-hidden">${targetYear}년 활동별 연간 결산표</caption>
        <thead><tr><th scope="col">세부활동</th><th scope="col">구분</th><th scope="col">대분류</th><th scope="col">중분류</th><th scope="col">건수</th><th scope="col">${prevYear}년</th><th scope="col">${targetYear}년</th><th scope="col">증감</th><th scope="col">비중</th></tr></thead>
        <tbody>
          ${coaRows.join('\n')}
          <tr class="subtot"><th scope="row">조합 수입 합계</th><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="num" data-label="${prevYear}년">${ps ? fmtWon(ps.inc) : '-'}</td><td class="num" data-label="${targetYear}년">${fmtWon(cs.inc)}</td><td class="num" data-label="증감">${ps ? `${cs.inc - ps.inc >= 0 ? '+' : ''}${fmtWon(cs.inc - ps.inc)}` : '-'}</td><td class="num" data-label="비중">100.0%</td></tr>
          <tr class="subtot"><th scope="row">사업 지출 합계</th><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="num" data-label="${prevYear}년">${ps ? fmtWon(ps.exp) : '-'}</td><td class="num" data-label="${targetYear}년">${fmtWon(cs.exp)}</td><td class="num" data-label="증감">${ps ? `${cs.exp - ps.exp >= 0 ? '+' : ''}${fmtWon(cs.exp - ps.exp)}` : '-'}</td><td class="num" data-label="비중">100.0%</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <nav class="report-nav-bar bottom" aria-label="하단 연간 결산 보고서 이동">
    ${prevBtn}
    <a class="btn secondary small" href="../index.html">전체 보고서 목록</a>
    ${nextBtn}
  </nav>`;

    const annualScript = `<script>
(function(){
  var track=document.getElementById('annual-deck-track');
  var tabsWrap=document.getElementById('annual-deck-tabs');
  if(track&&tabsWrap){
    var slides=Array.prototype.slice.call(track.querySelectorAll('.chart-card'));
    var tabs=Array.prototype.slice.call(tabsWrap.querySelectorAll('.chart-deck-tab'));
    var pending=null,raf=0;
    function setTab(i){
      tabs.forEach(function(b,idx){
        if(idx===i)b.setAttribute('aria-current','true');
        else b.removeAttribute('aria-current');
      });
    }
    function nearest(){
      var c=track.scrollLeft+track.clientWidth/2,best=0,bd=Infinity;
      slides.forEach(function(s,i){
        var d=Math.abs(s.offsetLeft-track.offsetLeft+s.offsetWidth/2-c);
        if(d<bd){bd=d;best=i;}
      });
      return best;
    }
    tabs.forEach(function(b,i){
      b.addEventListener('click',function(){
        var sl=slides[i];if(!sl)return;
        pending=i;setTab(i);
        var red=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        track.scrollTo({left:sl.offsetLeft-track.offsetLeft,behavior:red?'auto':'smooth'});
      });
    });
    track.addEventListener('scroll',function(){
      if(pending!==null||raf)return;
      raf=requestAnimationFrame(function(){raf=0;setTab(nearest());});
    },{passive:true});
    var tm=0;
    track.addEventListener('scroll',function(){clearTimeout(tm);tm=setTimeout(function(){pending=null;setTab(nearest());},140);},{passive:true});
  }
  function bindSync(wrapId,readoutId){
    var w=document.getElementById(wrapId),r=document.getElementById(readoutId);
    if(!w||!r)return;
    var defHtml=r.innerHTML;
    function clear(){
      w.classList.remove('has-hover');
      w.querySelectorAll('.is-active').forEach(function(e){e.classList.remove('is-active');});
      r.innerHTML=defHtml;
    }
    function act(el){
      var idx=el.getAttribute('data-idx');
      w.classList.add('has-hover');
      w.querySelectorAll('[data-idx]').forEach(function(e){e.classList.toggle('is-active',e.getAttribute('data-idx')===idx);});
      var k=r.querySelector('.readout-key'),v=r.querySelector('.readout-val'),it=r.querySelector('.readout-item');
      if(k)k.textContent=el.getAttribute('data-label')||'';
      if(v)v.textContent=el.getAttribute('data-val')||'';
      if(it)it.style.setProperty('--swatch-color',el.getAttribute('data-color')||'');
    }
    w.addEventListener('pointerover',function(e){
      if(e.pointerType!=='mouse')return;
      var t=e.target.closest('[data-idx]');
      if(t)act(t);else clear();
    });
    w.addEventListener('focusin',function(e){
      var t=e.target.closest('[data-idx]');
      if(t&&t.matches(':focus-visible'))act(t);
    });
    w.addEventListener('pointerleave',clear);
    w.addEventListener('mouseleave',clear);
    w.addEventListener('focusout',function(e){if(!e.relatedTarget||!w.contains(e.relatedTarget))clear();});
  }
  bindSync('annual-waffle','annual-readout-waffle');
  bindSync('annual-exptype','annual-readout-exptype');
})();
</script>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title,
        description: `${title} 공개 결산`,
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('../../', 'reports'),
        bodyHtml,
        extraScriptsHtml: annualScript,
      }),
    );
    pages += 1;
  }

  // 7. /accounting/reports/index.html
  {
    const route = 'accounting/reports/index.html';
    const prefix = computePrefixForRoute(route);
    const sortedYears = [...years].sort((a, b) => b - a);
    const defaultYear = sortedYears[0];

    const annCards = sortedYears
      .map((y) => {
        const s = summarizePeriod(entries.filter((r) => r.year === y));
        return `<article class="report-entry" data-year-tone="${yearTone(y)}">
          <div>
            <h3>${y}년 대의원대회 결산</h3>
            <p class="meta-figures">조합 수입 ${fmtWon(s.inc)}원 / 사업 지출 ${fmtWon(s.exp)}원 / 교부금 ${fmtWon(s.trOut)}원</p>
          </div>
          <a class="btn small entry-link" href="annual/${y}.html">${y}년 결산 열기</a>
        </article>`;
      })
      .join('\n');

    let runningBal = 0;
    const monthInfo = new Map<
      string,
      {
        sum: ReturnType<typeof summarizePeriod>;
        count: number;
        endBal: number;
        topMok?: [string, number];
      }
    >();
    for (const ym of months) {
      const mr = entries.filter((r) => r.ym === ym);
      const ms = summarizePeriod(mr);
      runningBal += ms.op + ms.net;
      const expByMok = new Map<string, number>();
      for (const r of mr) {
        if (r.gubun === '지출') {
          expByMok.set(r.mok, (expByMok.get(r.mok) ?? 0) + r.exp);
        }
      }
      const topMok = [...expByMok.entries()].sort((a, b) => b[1] - a[1])[0];
      monthInfo.set(ym, { sum: ms, count: mr.length, endBal: runningBal, topMok });
    }

    const primaryChips: string[] = [];
    const olderChips: string[] = [];
    const yearSections: string[] = [];
    const hasOverflowYears = sortedYears.length > 4;
    for (const [idx, y] of sortedYears.entries()) {
      const yt = yearTone(y);
      const yMonths = months.filter((ym) => ym.startsWith(`${y}-`)).reverse();
      const ys = summarizePeriod(entries.filter((r) => r.year === y));
      const yrEnd = yMonths[0] ? monthInfo.get(yMonths[0])?.endBal ?? 0 : 0;
      const maxFlow = Math.max(
        ...yMonths.map((ym) => {
          const info = monthInfo.get(ym)!;
          return Math.max(info.sum.inc, info.sum.exp);
        }),
        1,
      );
      const isDefault = y === defaultYear;
      const chipHtml = `<button type="button" class="year-chip" data-filter-year="${y}" data-year-tone="${yt}" aria-pressed="${String(isDefault)}"><span class="year-chip-main"><span class="year-chip-swatch" aria-hidden="true"></span><span>${y}년</span></span><span class="year-chip-meta">${yMonths.length}개월</span></button>`;
      if (hasOverflowYears && idx >= 3) {
        olderChips.push(chipHtml);
      } else {
        primaryChips.push(chipHtml);
      }

      const monthCards = yMonths
        .map((ym) => {
          const info = monthInfo.get(ym)!;
          const ms = info.sum;
          const mNum = ym.split('-')[1] ?? '';
          const incPct = ms.inc ? Math.round((ms.inc / maxFlow) * 100) : 0;
          const expPct = ms.exp ? Math.round((ms.exp / maxFlow) * 100) : 0;
          const hiHtml = info.topMok
            ? `최대 지출: <strong>${escapeHtml(info.topMok[0])}</strong> (${escapeHtml(fmtMan(info.topMok[1]))})`
            : ms.trOut
              ? `지부 교부금 집행 (${escapeHtml(fmtMan(ms.trOut))})`
              : '조합비 수납 중심 (사업 지출 없음)';

          return `<article class="month-card">
            <div class="month-card-top">
              <span class="month-num">${escapeHtml(mNum)}월</span>
              <span class="month-tx-cnt">${info.count}건</span>
            </div>
            <div class="month-bars">
              <div class="month-bar-row"><span class="month-bar-label">수입</span><div class="month-bar-track"><div class="month-bar-fill inc" style="--bar-pct: ${incPct}%"></div></div><span class="month-bar-amt">${escapeHtml(fmtMan(ms.inc))}</span></div>
              <div class="month-bar-row"><span class="month-bar-label">지출</span><div class="month-bar-track"><div class="month-bar-fill exp" style="--bar-pct: ${expPct}%"></div></div><span class="month-bar-amt">${escapeHtml(fmtMan(ms.exp))}</span></div>
            </div>
            <div class="month-highlight">${hiHtml}</div>
            <div class="month-card-foot">
              <span class="month-bal">잔액 <b>${fmtWon(info.endBal)}원</b></span>
              <a class="month-open-link" href="monthly/${escapeAttr(ym)}.html" aria-label="${y}년 ${Number(mNum)}월 운영위원회 재정보고 열기">보고서 보기 →</a>
            </div>
          </article>`;
        })
        .join('\n');

      yearSections.push(
        `<section class="year-group" data-year="${y}" data-year-tone="${yt}" aria-labelledby="yg-${y}"${isDefault ? '' : ' hidden'}>
          <div class="year-group-head">
            <div class="year-group-title"><h3 id="yg-${y}">${y}년</h3><span class="year-group-count">${yMonths.length}개월</span></div>
            <div class="year-group-summary">
              <span>수입 ${fmtWon(ys.inc)}원 · 지출 ${fmtWon(ys.exp)}원 · 연말잔액 <b>${fmtWon(yrEnd)}원</b></span>
              <a class="year-annual-link" href="annual/${y}.html">${y}년 결산 보기 →</a>
            </div>
          </div>
          <div class="month-grid">${monthCards}</div>
        </section>`,
      );
    }

    const moreYearsHtml =
      olderChips.length > 0
        ? `<button type="button" class="year-chip year-chip--more" popovertarget="older-years-panel" aria-pressed="false" data-default-label="이전 연도" data-default-meta="${olderChips.length}개년 ▾"><span class="year-chip-main">이전 연도</span><span class="year-chip-meta">${olderChips.length}개년 ▾</span></button>
      <div id="older-years-panel" class="year-more-popover" popover="auto" role="group" aria-label="이전 연도 선택">
        ${olderChips.join('\n        ')}
      </div>`
        : '';

    const allYearsBtn = `<button type="button" class="year-chip year-chip--all" data-filter-year="all" aria-pressed="${String(defaultYear === undefined)}">전체 ${months.length}개월 보기</button>`;

    const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>보고서 아카이브</h1>
      <p class="lead">연간 결산 보고서와 월간 재정 보고서 목록입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">${years.length}개 연도 · ${months.length}개월</span>
    </div>
  </header>

  <section class="section-band" aria-labelledby="sec-ann">
    <div class="section-head">
      <h2 id="sec-ann">1. 연간 대의원대회 결산 보고서</h2>
      <span class="section-sub">연도별 수지 결산표</span>
    </div>
    <div class="archive-grid">${annCards}</div>
  </section>

  <section class="section-band" aria-labelledby="sec-mon">
    <div class="section-head">
      <h2 id="sec-mon">2. 월간 운영위원회 재정보고 (${months.length}개월)</h2>
      <div class="section-head-actions">
        <span class="section-sub">연도별 월간 보고서</span>
        ${allYearsBtn}
      </div>
    </div>
    <div class="year-filter-bar" role="group" aria-label="보고서 연도 필터">
      ${primaryChips.join('\n      ')}
      ${moreYearsHtml}
    </div>
    ${yearSections.join('\n')}
  </section>`;

    const toggleScript = `<script>
(function(){
  var chips=document.querySelectorAll('.year-chip[data-filter-year]');
  var groups=document.querySelectorAll('.year-group');
  var moreBtn=document.querySelector('.year-chip--more');
  var morePanel=document.getElementById('older-years-panel');
  chips.forEach(function(btn){
    btn.addEventListener('click',function(){
      var target=btn.getAttribute('data-filter-year');
      chips.forEach(function(c){c.setAttribute('aria-pressed',String(c===btn));});
      groups.forEach(function(g){
        g.hidden=(target!=='all'&&g.getAttribute('data-year')!==target);
      });
      if(moreBtn&&morePanel){
        var inMore=morePanel.contains(btn);
        moreBtn.setAttribute('aria-pressed',String(inMore));
        var mainEl=moreBtn.querySelector('.year-chip-main');
        var metaEl=moreBtn.querySelector('.year-chip-meta');
        if(inMore){
          var yTone=btn.getAttribute('data-year-tone');
          if(yTone)moreBtn.setAttribute('data-year-tone',yTone);
          if(mainEl)mainEl.textContent=target+'년';
          var mTxt=btn.querySelector('.year-chip-meta');
          if(metaEl)metaEl.textContent=(mTxt?mTxt.textContent+' ':'')+'▾';
          if(typeof morePanel.hidePopover==='function'){
            try{morePanel.hidePopover();}catch(_){}
          }
        }else{
          moreBtn.removeAttribute('data-year-tone');
          if(mainEl)mainEl.textContent=moreBtn.getAttribute('data-default-label')||'이전 연도';
          if(metaEl)metaEl.textContent=moreBtn.getAttribute('data-default-meta')||'';
        }
      }
    });
  });
})();
</script>`;

    writeOutFile(
      outDir,
      route,
      renderPageShell({
        title: '재정 보고서 아카이브',
        description: '우체국물류지원단 물류노동조합 월간·연간 공개 재정보고서 모음',
        activeNav: 'accounting',
        route,
        prefix,
        baseUrl,
        assets,
        subnavHtml: renderAccountingSubnav('../', 'reports'),
        bodyHtml,
        extraScriptsHtml: toggleScript,
      }),
    );
    pages += 1;
  }

  return {
    pages,
    monthlyReports: months.length,
    annualReports: years.length,
  };
}

function buildUnionPage(
  outDir: string,
  orgSummary: OrgSummaryJson,
  officialsJson: PublicOfficialsJson,
  currentYm: string,
  assets: AssetManifest,
  baseUrl: string,
): void {
  const route = 'union/index.html';
  const prefix = computePrefixForRoute(route);

  // Exclude external_rep (other unions) and staff_rotating (so-tong-gan-sa); show only active union officers
  const activeOfficials = officialsJson.officials
    .filter((o) => {
      if (o.kind !== 'member') return false;
      if (o.roleScope === 'external_rep' || o.roleScope === 'staff_rotating') {
        return false;
      }
      if (o.validFrom && o.validFrom.slice(0, 7) > currentYm) return false;
      if (o.validTo && o.validTo.slice(0, 7) < currentYm) return false;
      return true;
    })
    .sort(
      (a, b) =>
        (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
        a.roleId.localeCompare(b.roleId),
    );

  const scopeLabelMap: Record<string, string> = {
    executive: '집행부',
    branch_head: '지부장',
    auditor: '감사',
    committee: '특별기구',
  };

  const displayUnits = orgSummary.units.filter(
    (u) => u.code !== 'HQ' || u.activeCount > 0,
  );

  const unitCards = displayUnits
    .map((u) => {
      const empSummary =
        Object.entries(u.byEmployment)
          .map(([k, v]) => `${k} ${v}명`)
          .join(' · ') || '해당 없음';
      const shiftSummary =
        Object.entries(u.byShift)
          .map(([k, v]) => `${k} ${v}명`)
          .join(' · ') || '해당 없음';
      const stLabel = u.status === 'active' ? '운영중' : '폐지 지부';
      return `<article class="union-unit-card${u.status === 'active' ? '' : ' is-closed'}">
        <div class="doc-meta">
          <span class="doc-cat-badge">${escapeHtml(u.code)}</span>
          <span>${escapeHtml(stLabel)}</span>
        </div>
        <h3>${escapeHtml(u.officialName)} (${escapeHtml(u.shortName)})</h3>
        <div class="union-unit-count">${u.activeCount}명</div>
        <div class="union-unit-meta">
          <span>${escapeHtml(u.fullName)}</span>
          <span>직종: ${escapeHtml(empSummary)}</span>
          <span>근무형태: ${escapeHtml(shiftSummary)}</span>
        </div>
      </article>`;
    })
    .join('\n    ');

  const unitSvg = renderUnitComparisonSvg(
    displayUnits
      .filter((u) => u.activeCount > 0 || (u.status === 'active' && u.code !== 'HQ'))
      .map((u) => ({
        label: u.officialName,
        series: [
          {
            name: '공무직',
            value: u.byEmployment['공무직'] ?? 0,
            color: 'var(--chart-cobalt, #516db2)',
          },
          {
            name: '기간제',
            value: u.byEmployment['기간제'] ?? 0,
            color: 'var(--chart-income, #39793c)',
          },
          {
            name: '활동 조합원 합계',
            value: u.activeCount,
            color: 'var(--chart-blue, #12354e)',
          },
        ],
      })),
    '지부별 조합원 구성 현황',
  );

  const officialCards = activeOfficials
    .map((o) => {
      const scopeTag = o.roleScope ? scopeLabelMap[o.roleScope] ?? '임원' : '임원';
      const headerParts = [o.termLabel, scopeTag].filter(Boolean).join(' · ');
      const affiliationParts = [
        o.memberUnitName ? `소속: ${o.memberUnitName}` : '',
        o.validFrom ? `임기 시작: ${o.validFrom}` : '',
      ].filter(Boolean);
      return `<article class="official-card">
      <div class="official-card-role">${escapeHtml(headerParts)} · ${escapeHtml(o.title)}</div>
      <div class="official-card-name">${escapeHtml(o.name)}</div>
      <div class="official-card-term">${escapeHtml(affiliationParts.join(' · ') || o.org || '본조')}</div>
    </article>`;
    })
    .join('\n    ');

  const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>노동조합 조직 및 임원 현황</h1>
      <p class="lead">지부별 조합원 현황과 현 임기 임원 안내입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">활동 조합원 ${orgSummary.totalActive}명 · 기준월 ${escapeHtml(currentYm)}</span>
    </div>
  </header>

  <section class="section-band" aria-labelledby="sec-units-org">
    <div class="section-head">
      <h2 id="sec-units-org">1. 지부별 조합원 현황 (총 ${orgSummary.totalActive}명)</h2>
      <span class="section-sub">안양·부평지부 조합원 구성 통계</span>
    </div>
    <div class="union-unit-grid">
      ${unitCards}
    </div>
    <figure class="chart-card svg-chart-wrap" style="margin-top:1rem;">
      ${unitSvg}
    </figure>
  </section>

  <section class="section-band" aria-labelledby="sec-officials">
    <div class="section-head">
      <h2 id="sec-officials">2. 현 임기 조합 임원 현황 (${activeOfficials.length}명)</h2>
      <span class="section-sub">집행부 · 지부장 · 감사 · 선거관리위원회</span>
    </div>
    <div class="officials-grid">
      ${officialCards || '<p class="muted">현재 등록된 현직 공개 직책 임원이 없습니다.</p>'}
    </div>
  </section>`;

  writeOutFile(
    outDir,
    route,
    renderPageShell({
      title: '조합 조직·임원 현황',
      description: '우체국물류지원단 물류노동조합 지부별 조합원 통계 및 현 임기 임원 안내',
      activeNav: 'union',
      route,
      prefix,
      baseUrl,
      assets,
      bodyHtml,
    }),
  );
}

function buildSitemapXml(
  outDir: string,
  baseUrl: string,
  listedDocs: DocumentRecordV3[],
  months: string[],
  years: number[],
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
  const rawLinks = readJsonFile<{ links: DocumentLedgerLink[] }>(
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
  const entries = toLedgerEntries(ledger, unitByName);
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

  // 1. Portal Home (/)
  writeOutFile(
    outDir,
    'index.html',
    buildPortalHomeHtml(graph, ledger, entries, orgSummary, linksByDoc, assets, baseUrl),
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

  // 4. Union Page
  buildUnionPage(outDir, orgSummary, officialsJson, currentYm, assets, baseUrl);

  // 5. Meta files (.nojekyll, robots.txt, sitemap.xml)
  const months = [...new Set(entries.map((r) => r.ym).filter(Boolean))].sort();
  const years = [...new Set(entries.map((r) => r.year).filter(Boolean))].sort((a, b) => a - b);
  writeOutFile(outDir, '.nojekyll', '');
  writeOutFile(
    outDir,
    'robots.txt',
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`,
  );
  buildSitemapXml(outDir, baseUrl, graph.listedDocuments, months, years);

  const pagesWritten =
    1 +
    indexPages +
    detailCounts.published +
    detailCounts.unlisted +
    accStats.pages +
    1;

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
