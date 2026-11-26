import fs from 'node:fs';
import path from 'node:path';
import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { summarizePeriod } from '../../domain/accounting.js';
import {
  CATEGORY_BY_ID,
  CATEGORY_REGISTRY,
  type ContentGraph,
} from '../../domain/content-graph.js';
import type {
  OrgSummaryJson,
  PublicLedgerRecord,
  PublicLinkEntry,
} from '../../domain/public-projection.js';
import type {
  DocCategory,
  DocumentRecordV3,
  LedgerEntry,
} from '../../domain/types.js';
import { findMarkdownSyntaxResidues, renderMomMarkdown, type TocItem } from '../mom-renderer.js';
import {
  type AssetManifest,
  assetHref,
  computePrefixForRoute,
  escapeAttr,
  escapeHtml,
  fmtWon,
  renderArchiveCategoryNav,
  renderDocumentToolsWidget,
  renderPageShell,
  renderUnionBrandLockup,
  renderUnionEmblemSvg,
} from '../shell.js';
import {
  cardTitleOf,
  primaryDateOf,
  sortDocumentsDesc,
  writeOutFile,
} from '../site-context.js';
import {
  inspectStatementFragment,
  isElement,
  normalizeTitleLines,
  selectPrintDensity,
  visitNodes,
} from '../statement-fragment.js';

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
  txById: Map<string, PublicLedgerRecord>,
  prefix: string,
): string {
  const valid = links
    .map((lk) => ({ lk, tx: txById.get(lk.txId) }))
    .filter((pair): pair is { lk: PublicLinkEntry; tx: PublicLedgerRecord } =>
      Boolean(pair.tx),
    );
  if (valid.length === 0) return '';

  const rows = valid
    .map(({ lk, tx }) => {
      const amt = tx.inc ? `+${fmtWon(tx.inc)}원` : tx.exp ? `-${fmtWon(tx.exp)}원` : '0원';
      const amtTone = tx.inc ? 'inc' : tx.exp ? 'exp' : 'zero';
      const rel = lk.relationNote ? ` · ${lk.relationNote}` : '';
      return `<li class="linked-ledger-item">
        <div class="linked-ledger-main">
          <span class="linked-ledger-date">${escapeHtml(tx.date)}</span>
          <strong>${escapeHtml(tx.mok)}</strong>
          <span class="linked-ledger-amt" data-amt="${amtTone}">${escapeHtml(amt)}</span>
          <span class="muted">· ${escapeHtml(tx.note)}${escapeHtml(rel)}</span>
        </div>
        <a class="linked-ledger-link" href="${escapeAttr(`${prefix}accounting/ledger.html?tx=${encodeURIComponent(tx.tx_id)}`)}">${escapeHtml(tx.tx_id)} 원장 대조 →</a>
      </li>`;
    })
    .join('\n      ');

  return `<section class="linked-ledger-panel no-print" data-privacy-zone="finance" aria-labelledby="sec-linked-ledger">
    <div class="linked-ledger-head">
      <h2 id="sec-linked-ledger">연계된 회계 원장 내역 (${valid.length}건)</h2>
      <span class="ledger-audit-stamp">문서·거래 교차 대조</span>
    </div>
    <ul class="linked-ledger-list">
      ${rows}
    </ul>
  </section>`;
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
  const catLabel = catMeta?.label ?? doc.category;
  const topicLabels = doc.topicIds.map((id) => graph.topicsById.get(id)?.label ?? id);
  const dateText = primaryDateOf(doc) || '연혁';
  const searchBlob = [doc.title, doc.summary, catLabel, ...topicLabels, doc.id].join(' ');
  const href = `${prefixToRoot}${doc.route}`;

  const metaParts: string[] = [
    `<strong class="doc-cat-label" data-cat="${escapeAttr(doc.category)}">${escapeHtml(catLabel)}</strong>`,
    `<time>${escapeHtml(dateText)}</time>`,
  ];
  if (doc.financePeriod) {
    metaParts.push(`<span>재정 기준월 ${escapeHtml(doc.financePeriod)}</span>`);
  }
  if (topicLabels.length > 0) {
    metaParts.push(`<span>${escapeHtml(topicLabels.join(' · '))}</span>`);
  }
  if (linkCount > 0) {
    metaParts.push(`<span class="doc-ledger-trace">회계 원장 연계 ${linkCount}건</span>`);
  }

  return `<article class="doc-card" data-category="${escapeAttr(doc.category)}" data-topics="${escapeAttr(topicLabels.join('|'))}" data-search="${escapeAttr(searchBlob)}">
      <div class="doc-card-body">
        <h3 class="doc-title"><a href="${escapeAttr(href)}">${escapeHtml(cardTitleOf(doc))}</a></h3>
        <p class="doc-summary">${escapeHtml(doc.summary)}</p>
      </div>
      <div class="doc-card-footer">
        <div class="doc-meta">${metaParts.join(' <span class="doc-meta-sep" aria-hidden="true">·</span> ')}</div>
        <a class="doc-card-link" href="${escapeAttr(href)}">${escapeHtml(catMeta?.action ?? '원문 보기')} →</a>
      </div>
    </article>`;
}

export function buildArchiveIndexPages(
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

function extractMainElementInnerHtml(rawHtml: string, srcPath: string): {
  mainEl: DefaultTreeAdapterTypes.Element;
  innerHtml: string;
} {
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
  const innerHtml =
    loc?.startTag?.endOffset !== undefined && loc?.endTag?.startOffset !== undefined
      ? rawHtml.slice(loc.startTag.endOffset, loc.endTag.startOffset)
      : mainEl.childNodes
          .map((child) =>
            parse5.serialize({
              childNodes: [child],
            } as unknown as DefaultTreeAdapterTypes.DocumentFragment),
          )
          .join('');
  return { mainEl, innerHtml };
}

export function buildArchiveDetailPages(
  projectRoot: string,
  outDir: string,
  graph: ContentGraph,
  entries: LedgerEntry[],
  txById: Map<string, PublicLedgerRecord>,
  orgSummary: OrgSummaryJson,
  linksByDoc: Map<string, PublicLinkEntry[]>,
  assets: AssetManifest,
  baseUrl: string,
  warnings: string[],
): { published: number; unlisted: number; skippedInternal: number } {
  let published = 0;
  let unlisted = 0;
  let skippedInternal = 0;

  // Copy non-HTML, non-Markdown sibling assets (images/pdfs) from _source/knowledge and _source/notice
  for (const cat of ['knowledge', 'notice'] as const) {
    const srcDir = path.join(projectRoot, '_source', cat);
    if (!fs.existsSync(srcDir)) continue;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith('.html') || entry.name.endsWith('.md')) continue;
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
          const trimmed = line.trim();
          const isSub = /^—.*—$/.test(trimmed);
          const displayLine = isSub
            ? trimmed.replace(/^—\s*/, '').replace(/\s*—$/, '')
            : line;
          const cls = isSub
            ? 'statement-title-line statement-title-line--subtitle'
            : 'statement-title-line';
          return `<span class="${cls}">${escapeHtml(displayLine)}</span>`;
        })
        .join('\n        ');
      const pageTitle = doc.title.replace(/\s*—\s*([^—]+?)\s*—\s*$/, ' · $1');
      const sigDate = doc.dates.eventOn ?? doc.dates.publishedOn ?? '';
      const statementSealSvg = renderUnionEmblemSvg('statement-seal-svg', true);
      const statementSignatureLogo = renderUnionBrandLockup('signature-brand-svg', {
        lightOnly: true,
        ariaLabel: '우체국물류지원단 물류노동조합',
      });

      const bodyHtml = `
  <article class="statement-container print-light-surface document-article" data-print-density="${density}" data-document-category="성명서" data-skip-auto-toc="true">
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
        ${statementSealSvg}
      </div>
      <h1 class="statement-title${density === 'long' ? ' statement-title--long' : ''}">
        ${titleHtml}
      </h1>
    </header>
    <div class="statement-body" data-copy-body>
      ${analysis.html}
    </div>
    <div class="signature-block">
      <p class="signature-date"><time datetime="${escapeAttr(sigDate)}">${escapeHtml(sigDate)}</time></p>
      <div class="signature-org-row">
        ${statementSignatureLogo}
      </div>
    </div>
    ${linkedLedgerHtml}
    ${relatedHtml}
  </article>
  ${renderDocumentToolsWidget()}`;

      const htmlOut = renderPageShell({
        title: pageTitle,
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
      const { innerHtml: mainInnerHtml } = extractMainElementInnerHtml(rawHtml, srcPath);

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

    // knowledge & notice (supports .md feature/markdown sources and .html fragments)
    const srcPath = graph.sourcePathsById.get(doc.id);
    if (!srcPath || !fs.existsSync(srcPath)) {
      throw new Error(`문서 원본 파일이 없습니다: ${doc.id}`);
    }
    const rawSource = fs.readFileSync(srcPath, 'utf8').replace(/^\uFEFF/, '');

    if (srcPath.endsWith('.md')) {
      const residues = findMarkdownSyntaxResidues(rawSource);
      if (residues.length > 0) {
        throw new Error(
          `${srcPath}:${residues[0]!.line}:${residues[0]!.column} ${residues[0]!.message}`,
        );
      }

      const parsed = renderMomMarkdown(rawSource, doc.title);
      const catLabel = CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category;
      const catDir = CATEGORY_BY_ID.get(doc.category)?.directory ?? `archive/${doc.category}`;
      const bodyHtml = `
  <article class="archive-container document-article" data-document-category="${escapeAttr(catLabel)}">
    <header class="document-header">
      <nav class="document-breadcrumb no-print" aria-label="현재 위치">
        <ol>
          <li><a href="${escapeAttr(`${prefix}archive/index.html`)}">공개 자료실</a></li>
          <li><a href="${escapeAttr(`${prefix}${catDir}/index.html`)}">${escapeHtml(catLabel)}</a></li>
          <li aria-current="page">${escapeHtml(primaryDateOf(doc) || doc.id)}</li>
        </ol>
      </nav>
      <h1 class="document-title">${escapeHtml(doc.title)}</h1>
      ${doc.summary ? `<p class="document-summary">${escapeHtml(doc.summary)}</p>` : ''}
    </header>
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
        bodyHtml,
        extraScriptsHtml: `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      });
      writeOutFile(outDir, doc.route, htmlOut);
      continue;
    }

    const rawHtml = rawSource;
    const headMatch = rawHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
    const headRaw = headMatch?.[1] ?? '';
    const inlineStyles = [...headRaw.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
      .map((m) => m[0])
      .join('\n');

    const { mainEl, innerHtml } = extractMainElementInnerHtml(rawHtml, srcPath);
    const mainInnerHtml = innerHtml
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
    const skipAutoToc = mainEl.attrs.find((a) => a.name === 'data-skip-auto-toc')?.value;
    const skipAutoTocAttr = skipAutoToc ? ` data-skip-auto-toc="${escapeAttr(skipAutoToc)}"` : '';
    const usesLightWrapper =
      inlineStyles.length > 0 ||
      origClasses.includes('archive-container') ||
      origClasses.includes('history-container');
    const articleClasses = usesLightWrapper
      ? `${origClasses} print-light-surface`
      : origClasses;

    const bodyHtml = `
  <article class="${escapeAttr(articleClasses)}"${idAttr}${skipAutoTocAttr} data-document-category="${escapeAttr(CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category)}">
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

    const extraHeadHtml = inlineStyles;

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
      extraHeadHtml,
      bodyHtml,
      extraScriptsHtml: extraScripts,
    });
    writeOutFile(outDir, doc.route, htmlOut);
  }

  return { published, unlisted, skippedInternal };
}
