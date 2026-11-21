import fs from 'node:fs';
import path from 'node:path';
import {
  type AssetManifest,
  assetHref,
  computePrefixForRoute,
  escapeAttr,
  escapeHtml,
  renderDocumentToolsWidget,
  renderPageShell,
  renderUnionSubnav,
} from './shell.js';

export type LawDiagnosisSeverity = 'risk' | 'recommend' | 'caution' | 'aligned';

export type LawComparisonTopic =
  | 'organization'
  | 'governance'
  | 'officers'
  | 'finance'
  | 'bargaining-dispute'
  | 'discipline-dissolution';

export type LawReferenceKind = 'statute' | 'decree' | 'precedent' | 'interpretation';

export interface BylawRefLink {
  id: string;
  label: string;
}

export interface BylawsLawMeta {
  title: string;
  subtitle: string;
  bylawsEnactedOn: string;
  bylawsAmendedOn: string;
  lawName: string;
  lawEffectiveOn: string;
  lawMst: string;
  decreeName: string;
  decreeEffectiveOn: string;
  decreeMst: string;
  verifiedOn: string;
  disclaimer: string;
}

export interface AmendmentHighlightItem {
  id: string;
  badge: string;
  title: string;
  bylawRefs: BylawRefLink[];
  lawChange: string;
  unionImpact: string;
}

export interface MandatoryArt11Item {
  no: number;
  lawItem: string;
  bylawRefs: BylawRefLink[];
  status: LawDiagnosisSeverity;
  note: string;
}

export interface LawReferenceEntry {
  kind: LawReferenceKind;
  citation: string;
  excerpt: string;
}

export interface BylawsLawComparison {
  id: string;
  topic: LawComparisonTopic;
  severity: LawDiagnosisSeverity;
  title: string;
  bylawRefs: BylawRefLink[];
  lawRefs: string[];
  bylawSummary: string;
  lawSummary: string;
  analysis: string;
  references: LawReferenceEntry[];
}

export interface TftChecklistItem {
  priority: string;
  severity: LawDiagnosisSeverity;
  targetRef: BylawRefLink;
  issue: string;
  basis: string;
  currentDraft: string;
  proposedDraft: string;
}

export interface ChapterMappingItem {
  chapterId: string;
  chapterLabel: string;
  lawArticles: string;
  severity: LawDiagnosisSeverity;
  summary: string;
}

export interface BylawsLawDocument {
  meta: BylawsLawMeta;
  amendment2026Highlights: AmendmentHighlightItem[];
  mandatoryItems: MandatoryArt11Item[];
  comparisons: BylawsLawComparison[];
  tftChecklist: TftChecklistItem[];
  chapterMapping: ChapterMappingItem[];
}

export const SEVERITY_META: Record<
  LawDiagnosisSeverity,
  { label: string; shortLabel: string; description: string }
> = {
  risk: {
    label: '시정·효력 리스크',
    shortLabel: '시정·효력 리스크',
    description: '법령과 직접 충돌하거나 결의 무효·시정명령 우려가 있어 우선 정비가 필요한 항목',
  },
  recommend: {
    label: '개정 권고',
    shortLabel: '개정 권고',
    description: '차기 개정 시 법령 기준·시행령 또는 내부 정합성에 맞추어 보완을 권고하는 항목',
  },
  caution: {
    label: '해석·운영 유의',
    shortLabel: '해석·운영 유의',
    description: '규약 문언 자체는 유효하나 실무 집행·신고·표결권 배제 등 운영 시 유의가 필요한 항목',
  },
  aligned: {
    label: '법령 부합',
    shortLabel: '법령 부합',
    description: '현행 노조법 및 시행령 기준에 충실히 부합하는 항목',
  },
};

export const LAW_TOPIC_META: Array<{ key: 'all' | LawComparisonTopic; label: string }> = [
  { key: 'all', label: '전체 주제' },
  { key: 'organization', label: '조직·자격' },
  { key: 'governance', label: '총회·소집·정합성' },
  { key: 'officers', label: '임원·대의원' },
  { key: 'finance', label: '회계·공표' },
  { key: 'bargaining-dispute', label: '교섭·쟁의·노사협의' },
  { key: 'discipline-dissolution', label: '징계·탄핵·해산' },
];

const TOPIC_LABEL_MAP = new Map<string, string>(
  LAW_TOPIC_META.map((t) => [t.key, t.label]),
);

const REF_KIND_LABEL: Record<LawReferenceKind, string> = {
  statute: '법령 원문',
  decree: '시행령',
  precedent: '대법원 판례',
  interpretation: '행정해석',
};

export function loadBylawsLawDocument(projectRoot: string): BylawsLawDocument | null {
  const filePath = path.join(projectRoot, '_source', 'union', 'bylaws-law.json');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as BylawsLawDocument;
}

function fmtDotDate(iso: string): string {
  return iso.replace(/-/g, '.');
}

function renderBylawRefChip(ref: BylawRefLink): string {
  return `<a class="bylaw-ref-chip" href="bylaws.html#${escapeAttr(ref.id)}">${escapeHtml(ref.label)}</a>`;
}

function renderSeverityBadge(severity: LawDiagnosisSeverity): string {
  const meta = SEVERITY_META[severity];
  return `<span class="law-severity-badge" data-severity="${escapeAttr(severity)}">${escapeHtml(meta.label)}</span>`;
}

export function buildBylawsLawHtml(
  doc: BylawsLawDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/bylaws-law.html';
  const prefix = computePrefixForRoute(route);

  const counts: Record<LawDiagnosisSeverity, number> = {
    risk: 0,
    recommend: 0,
    caution: 0,
    aligned: 0,
  };
  for (const cmp of doc.comparisons) {
    counts[cmp.severity] += 1;
  }

  const art11Counts: Record<LawDiagnosisSeverity, number> = {
    risk: 0,
    recommend: 0,
    caution: 0,
    aligned: 0,
  };
  for (const m of doc.mandatoryItems) {
    art11Counts[m.status] += 1;
  }

  const art11Total = doc.mandatoryItems.length || 1;
  const segOrder: LawDiagnosisSeverity[] = ['aligned', 'caution', 'recommend', 'risk'];
  const matrixBarHtml = segOrder
    .filter((sev) => art11Counts[sev] > 0)
    .map((sev) => {
      const pct = ((art11Counts[sev] / art11Total) * 100).toFixed(2);
      const label = `${SEVERITY_META[sev].label} ${art11Counts[sev]}건`;
      return `<div class="law-matrix-seg" data-severity="${escapeAttr(sev)}" style="width:${pct}%" title="${escapeAttr(label)}"><span class="visually-hidden">${escapeHtml(label)}</span></div>`;
    })
    .join('');

  const matrixLegendHtml = segOrder
    .map(
      (sev) =>
        `<span class="law-matrix-legend-item" data-severity="${escapeAttr(sev)}"><i aria-hidden="true"></i>${escapeHtml(SEVERITY_META[sev].label)} <strong>${art11Counts[sev]}호</strong></span>`,
    )
    .join('');

  const highlightsHtml = doc.amendment2026Highlights
    .map(
      (hl) => `<article class="law-2026-card" id="${escapeAttr(hl.id)}">
        <div class="law-2026-head">
          <span class="doc-cat-badge">${escapeHtml(hl.badge)}</span>
        </div>
        <h3>${escapeHtml(hl.title)}</h3>
        <dl class="law-2026-dl">
          <div><dt>법령 개정 요지</dt><dd>${escapeHtml(hl.lawChange)}</dd></div>
          <div><dt>우리 규약 접점</dt><dd>${escapeHtml(hl.unionImpact)}</dd></div>
        </dl>
        <div class="bylaw-ref-list">${hl.bylawRefs.map(renderBylawRefChip).join(' ')}</div>
      </article>`,
    )
    .join('\n');

  const art11RowsHtml = doc.mandatoryItems
    .map(
      (it) => `<tr>
        <th scope="row">제${it.no}호</th>
        <td data-label="법정 필수기재사항">${escapeHtml(it.lawItem)}</td>
        <td data-label="규약 대응 조항"><div class="bylaw-ref-list">${it.bylawRefs.map(renderBylawRefChip).join(' ')}</div></td>
        <td class="ctr" data-label="진단">${renderSeverityBadge(it.status)}</td>
        <td data-label="점검 의견">${escapeHtml(it.note)}</td>
      </tr>`,
    )
    .join('\n');

  const severityButtonsHtml = [
    { key: 'all', label: `전체 (${doc.comparisons.length})` },
    { key: 'risk', label: `시정·효력 리스크 (${counts.risk})` },
    { key: 'recommend', label: `개정 권고 (${counts.recommend})` },
    { key: 'caution', label: `해석·운영 유의 (${counts.caution})` },
    { key: 'aligned', label: `법령 부합 (${counts.aligned})` },
  ]
    .map(
      (b, idx) =>
        `<button type="button" class="bylaws-topic-chip" data-severity-filter="${escapeAttr(b.key)}" aria-pressed="${idx === 0 ? 'true' : 'false'}">${escapeHtml(b.label)}</button>`,
    )
    .join('\n        ');

  const topicButtonsHtml = LAW_TOPIC_META.map(
    (t, idx) =>
      `<button type="button" class="bylaws-topic-chip" data-topic-filter="${escapeAttr(t.key)}" aria-pressed="${idx === 0 ? 'true' : 'false'}">${escapeHtml(t.label)}</button>`,
  ).join('\n        ');

  const comparisonCardsHtml = doc.comparisons
    .map((cmp) => {
      const topicLabel = TOPIC_LABEL_MAP.get(cmp.topic) ?? cmp.topic;
      const refsHtml =
        cmp.references.length > 0
          ? `<details class="law-ref-details">
            <summary class="law-ref-summary">근거 법령 원문 · 시행령 · 판례 보기 (${cmp.references.length}건)</summary>
            <div class="law-ref-body">
              <ul class="law-ref-items">
                ${cmp.references
                  .map(
                    (ref) => `<li class="law-ref-item" data-kind="${escapeAttr(ref.kind)}">
                  <div class="law-ref-item-head">
                    <span class="law-ref-kind-badge" data-kind="${escapeAttr(ref.kind)}">${escapeHtml(REF_KIND_LABEL[ref.kind])}</span>
                    <strong>${escapeHtml(ref.citation)}</strong>
                  </div>
                  <p>${escapeHtml(ref.excerpt)}</p>
                </li>`,
                  )
                  .join('\n                ')}
              </ul>
            </div>
          </details>`
          : '';

      return `<article class="law-cmp-card" id="${escapeAttr(cmp.id)}" data-severity="${escapeAttr(cmp.severity)}" data-topic="${escapeAttr(cmp.topic)}">
        <header class="law-cmp-head">
          <div class="law-cmp-badges">
            ${renderSeverityBadge(cmp.severity)}
            <span class="doc-cat-badge">${escapeHtml(topicLabel)}</span>
          </div>
          <h3>${escapeHtml(cmp.title)}</h3>
        </header>
        <div class="law-cmp-pair">
          <div class="law-cmp-col is-bylaws">
            <div class="law-cmp-col-head">
              <span class="law-cmp-col-label">우리 조합 규약</span>
              <div class="bylaw-ref-list">${cmp.bylawRefs.map(renderBylawRefChip).join(' ')}</div>
            </div>
            <p>${escapeHtml(cmp.bylawSummary)}</p>
          </div>
          <div class="law-cmp-col is-law">
            <div class="law-cmp-col-head">
              <span class="law-cmp-col-label">현행 노조법 · 시행령</span>
              <div class="law-pill-list">${cmp.lawRefs.map((lr) => `<span class="law-pill">${escapeHtml(lr)}</span>`).join(' ')}</div>
            </div>
            <p>${escapeHtml(cmp.lawSummary)}</p>
          </div>
        </div>
        <div class="law-cmp-analysis">
          <strong>검토 및 실무 영향</strong>
          <p>${escapeHtml(cmp.analysis)}</p>
        </div>
        ${refsHtml}
      </article>`;
    })
    .join('\n');

  const tftCardsHtml = doc.tftChecklist
    .map(
      (item) => `<article class="law-tft-card" data-severity="${escapeAttr(item.severity)}">
        <header class="law-tft-head">
          <div class="law-cmp-badges">
            <span class="law-priority-badge" data-priority="${escapeAttr(item.priority)}">${escapeHtml(item.priority)}</span>
            ${renderSeverityBadge(item.severity)}
            ${renderBylawRefChip(item.targetRef)}
          </div>
          <span class="law-tft-basis">근거: ${escapeHtml(item.basis)}</span>
        </header>
        <h3>${escapeHtml(item.issue)}</h3>
        <div class="law-tft-diff">
          <div class="law-tft-box is-current">
            <span class="law-tft-box-label">현행 규약 요지</span>
            <p>${escapeHtml(item.currentDraft)}</p>
          </div>
          <div class="law-tft-box is-proposed">
            <span class="law-tft-box-label">차기 개정 검토 시안 (참고)</span>
            <p>${escapeHtml(item.proposedDraft)}</p>
          </div>
        </div>
      </article>`,
    )
    .join('\n');

  const mappingRowsHtml = doc.chapterMapping
    .map(
      (m) => `<tr>
        <th scope="row"><a class="law-map-link" href="bylaws.html#${escapeAttr(m.chapterId)}">${escapeHtml(m.chapterLabel)}</a></th>
        <td data-label="관련 노조법·관계법령">${escapeHtml(m.lawArticles)}</td>
        <td class="ctr" data-label="진단">${renderSeverityBadge(m.severity)}</td>
        <td data-label="종합 검토 의견">${escapeHtml(m.summary)}</td>
      </tr>`,
    )
    .join('\n');

  const bodyHtml = `
  <article class="document-article bylaws-law-page" data-document-category="규약·노조법 비교 분석" data-skip-auto-toc="true">
    <div class="bylaws-unlisted-banner" role="note" aria-label="미등재 문서 안내">
      <div>
        <span class="doc-cat-badge">미등재 · 내부 검토 전용</span>
        <p>이 페이지는 검색엔진과 공개 메뉴·사이트맵에서 제외된 미등재(<code>noindex,follow</code>) 비교 분석 자료입니다. 조합원 설명 및 부칙 별첨1에 따른 차기 규약 개정 TFT 검토용으로 링크 공유를 통해서만 열람할 수 있습니다.</p>
      </div>
      <div class="bylaws-head-actions no-print">
        <button type="button" class="btn secondary small" data-action="print">회의 자료 인쇄</button>
      </div>
    </div>

    <header class="page-masthead">
      <div>
        <h1>${escapeHtml(doc.meta.title)}</h1>
        <p class="lead">${escapeHtml(doc.meta.subtitle)}</p>
      </div>
      <div class="masthead-meta">
        <span class="data-stamp">법령 시행일 ${escapeHtml(fmtDotDate(doc.meta.lawEffectiveOn))} · 조회일 ${escapeHtml(fmtDotDate(doc.meta.verifiedOn))}</span>
        <div class="bylaws-head-actions no-print">
          <a class="btn secondary small" href="bylaws-guide.html">규약 한눈에 보기</a>
          <a class="btn secondary small" href="bylaws.html">규약 전문 열람 →</a>
        </div>
      </div>
    </header>

    <div class="kpi-strip" role="region" aria-label="규약 대비 노조법 진단 요약">
      <div class="kpi"><div class="label">핵심 비교 쟁점</div><div class="value">${doc.comparisons.length}건</div><div class="sub">12장 59조·부칙 전수 검토</div></div>
      <div class="kpi" data-tone="expense"><div class="label">시정·효력 리스크</div><div class="value">${counts.risk}건</div><div class="sub">우선 정비(P1) 권장 항목</div></div>
      <div class="kpi" data-tone="grant"><div class="label">개정 권고</div><div class="value">${counts.recommend}건</div><div class="sub">시행령·정합성 보완</div></div>
      <div class="kpi" data-tone="balance"><div class="label">해석·운영 유의</div><div class="value">${counts.caution}건</div><div class="sub">신고·표결권 실무 유념</div></div>
      <div class="kpi" data-tone="income"><div class="label">법령 부합</div><div class="value">${counts.aligned}건</div><div class="sub">제11조 필수기재 ${art11Total}호 점검</div></div>
    </div>

    <section class="section-band" aria-labelledby="sec-law-2026">
      <div class="section-head">
        <h2 id="sec-law-2026">1. 2026년 3월 10일 시행 개정 노조법과 우리 규약의 접점</h2>
        <span class="section-sub">현행 「노동조합 및 노동관계조정법」 (2025.9.9 공포 · 2026.3.10 시행)</span>
      </div>
      <div class="law-2026-grid">
        ${highlightsHtml}
      </div>
    </section>

    <section class="section-band" aria-labelledby="sec-law-art11">
      <div class="section-head">
        <h2 id="sec-law-art11">2. 노조법 제11조 필수기재사항 15호 점검 매트릭스</h2>
        <span class="section-sub">법정 필수기재사항별 규약 반영 및 보완 현황</span>
      </div>
      <div class="law-matrix-summary">
        <div class="law-matrix-bar" role="img" aria-label="노조법 제11조 15호 충족 분포: 법령 부합 ${art11Counts.aligned}호, 해석·운영 유의 ${art11Counts.caution}호, 개정 권고 ${art11Counts.recommend}호, 시정·효력 리스크 ${art11Counts.risk}호">
          ${matrixBarHtml}
        </div>
        <div class="law-matrix-legend">
          ${matrixLegendHtml}
        </div>
      </div>
      <div tabindex="0" role="region" aria-labelledby="sec-law-art11" class="table-wrapper">
        <table>
          <caption class="visually-hidden">노조법 제11조 필수기재사항 15호 규약 대조표</caption>
          <thead>
            <tr>
              <th scope="col">호</th>
              <th scope="col">법정 필수기재사항</th>
              <th scope="col">규약 대응 조항</th>
              <th scope="col">진단</th>
              <th scope="col">점검 의견</th>
            </tr>
          </thead>
          <tbody>
            ${art11RowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section-band" id="sec-law-comparisons-wrap" aria-labelledby="sec-law-comparisons">
      <div class="section-head">
        <h2 id="sec-law-comparisons">3. 주제별 핵심 비교 분석 (${doc.comparisons.length}건)</h2>
        <span class="section-sub">진단 등급·주제별 필터 및 근거 법령 원문·판례 대조</span>
      </div>

      <div class="law-filter-bar no-print" role="region" aria-label="비교 분석 필터 및 원문 펼치기">
        <div class="law-filter-group">
          <span class="law-filter-label">진단 등급</span>
          <div class="bylaws-topic-bar" role="group" aria-label="진단 등급 필터">
            ${severityButtonsHtml}
          </div>
        </div>
        <div class="law-filter-group">
          <span class="law-filter-label">주제 영역</span>
          <div class="bylaws-topic-bar" role="group" aria-label="주제 영역 필터">
            ${topicButtonsHtml}
          </div>
        </div>
        <div class="law-filter-actions">
          <p id="law-result-summary" role="status" aria-live="polite">전체 ${doc.comparisons.length}건 표시</p>
          <button type="button" class="btn secondary small" id="law-toggle-all-refs" aria-expanded="false">
            <span class="expand">근거 법령·판례 모두 펼치기</span>
            <span class="collapse">근거 법령·판례 모두 접기</span>
          </button>
        </div>
      </div>

      <div class="law-cmp-list" id="law-cmp-list">
        ${comparisonCardsHtml}
      </div>

      <div class="bylaws-no-results" id="law-no-results" hidden>
        <p>선택한 진단 등급과 주제에 해당하는 비교 항목이 없습니다.</p>
        <button type="button" class="btn secondary small" id="law-reset-btn">필터 초기화</button>
      </div>
    </section>

    <section class="section-band" aria-labelledby="sec-law-tft">
      <div class="section-head">
        <h2 id="sec-law-tft">4. 차기 규약 개정 TFT 검토 체크리스트 &amp; 신·구 대비 시안</h2>
        <span class="section-sub">부칙 별첨1에 따른 규약 재개정 준비용 우선순위 과제 (${doc.tftChecklist.length}건)</span>
      </div>
      <div class="law-tft-list">
        ${tftCardsHtml}
      </div>
    </section>

    <section class="section-band" aria-labelledby="sec-law-mapping">
      <div class="section-head">
        <h2 id="sec-law-mapping">5. 규약 제1장 ~ 제12장 · 부칙 전체 노조법 매핑표</h2>
        <span class="section-sub">장명을 선택하면 규약 전문의 해당 장으로 바로 이동합니다</span>
      </div>
      <div tabindex="0" role="region" aria-labelledby="sec-law-mapping" class="table-wrapper">
        <table>
          <caption class="visually-hidden">규약 장별 노조법 및 관계법령 매핑 색인표</caption>
          <thead>
            <tr>
              <th scope="col">규약 편제</th>
              <th scope="col">관련 노조법 · 관계법령</th>
              <th scope="col">진단</th>
              <th scope="col">종합 검토 의견</th>
            </tr>
          </thead>
          <tbody>
            ${mappingRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <aside class="law-disclaimer" aria-label="법령 기준 및 활용 안내">
      <strong>기준 법령 및 유의사항</strong>
      <p>${escapeHtml(doc.meta.disclaimer)}</p>
      <p class="law-disclaimer-meta">기준 법령: ${escapeHtml(doc.meta.lawName)} (시행 ${escapeHtml(doc.meta.lawEffectiveOn)}) · ${escapeHtml(doc.meta.decreeName)} (시행 ${escapeHtml(doc.meta.decreeEffectiveOn)}) · 조회·인용검증일 ${escapeHtml(doc.meta.verifiedOn)}</p>
    </aside>
  </article>
  ${renderDocumentToolsWidget()}`;

  return renderPageShell({
    title: '조합 규약 · 현행 노조법 비교 분석',
    description: `${doc.meta.subtitle}`,
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    robots: 'noindex,follow',
    subnavHtml: renderUnionSubnav('', null),
    bodyHtml,
    extraScriptsHtml: [
      `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      `<script src="${escapeAttr(assetHref(prefix, 'bylaws-law.js', assets))}" defer></script>`,
    ].join('\n'),
  });
}
