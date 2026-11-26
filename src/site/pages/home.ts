import { summarizePeriod } from '../../domain/accounting.js';
import { CATEGORY_BY_ID, type ContentGraph } from '../../domain/content-graph.js';
import type {
  OrgSummaryJson,
  PublicLedgerJson,
  PublicLinkEntry,
} from '../../domain/public-projection.js';
import type { LedgerEntry } from '../../domain/types.js';
import {
  type AssetManifest,
  escapeAttr,
  escapeHtml,
  fmtWon,
  renderPageShell,
} from '../shell.js';
import { cardTitleOf, primaryDateOf, sortDocumentsDesc } from '../site-context.js';

export function buildPortalHomeHtml(
  graph: ContentGraph,
  ledger: PublicLedgerJson,
  entries: LedgerEntry[],
  orgSummary: OrgSummaryJson,
  linksByDoc: Map<string, PublicLinkEntry[]>,
  hasBylaws: boolean,
  hasAbout: boolean,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const sortedPublic = sortDocumentsDesc(graph.listedDocuments);
  const leadDoc =
    sortedPublic.find((d) => d.category === 'statement' || d.category === 'newsletter') ??
    sortedPublic[0];
  const chronicleDocs = sortedPublic.filter((d) => d !== leadDoc).slice(0, 5);

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

  const maxFlow = Math.max(latestMonthSum.inc, latestMonthSum.exp, latestMonthSum.trOut, 1);
  const incBarPct = latestMonthSum.inc ? Math.max(4, Math.round((latestMonthSum.inc / maxFlow) * 100)) : 0;
  const expBarPct = latestMonthSum.exp ? Math.max(4, Math.round((latestMonthSum.exp / maxFlow) * 100)) : 0;
  const grantBarPct = latestMonthSum.trOut ? Math.max(4, Math.round((latestMonthSum.trOut / maxFlow) * 100)) : 0;

  let leadVoiceHtml = '';
  if (leadDoc) {
    const leadCatMeta = CATEGORY_BY_ID.get(leadDoc.category);
    const leadCatLabel = leadCatMeta?.label ?? leadDoc.category;
    const leadDate = primaryDateOf(leadDoc) || '상시';
    const leadLinkCnt = linksByDoc.get(leadDoc.id)?.length ?? 0;
    const leadTrace = leadLinkCnt > 0 ? ` · <span class="doc-ledger-trace">회계 연계 ${leadLinkCnt}건</span>` : '';
    leadVoiceHtml = `<article class="frontpage-lead" data-cat="${escapeAttr(leadDoc.category)}">
          <h2 id="sec-lead-voice" class="frontpage-lead-title">
            <a href="${escapeAttr(leadDoc.route)}">${escapeHtml(cardTitleOf(leadDoc))}</a>
          </h2>
          <p class="frontpage-lead-meta">
            <strong class="doc-cat-label" data-cat="${escapeAttr(leadDoc.category)}">${escapeHtml(leadCatLabel)}</strong>
            <span aria-hidden="true">·</span>
            <time>${escapeHtml(leadDate)}</time>${leadTrace}
          </p>
          <p class="frontpage-lead-summary">${escapeHtml(leadDoc.summary)}</p>
          <div class="frontpage-lead-action">
            <a class="btn" href="${escapeAttr(leadDoc.route)}">${escapeHtml(leadCatMeta?.action ?? '전문 읽기')} →</a>
          </div>
        </article>`;
  } else {
    leadVoiceHtml = `<div class="frontpage-lead">
          <h2 id="sec-lead-voice" class="frontpage-lead-title">공개 자료실</h2>
          <p class="frontpage-lead-summary">성명서, 현장소식지, 운영위원회 회의록, 지식 자료를 열람할 수 있습니다.</p>
          <div class="frontpage-lead-action">
            <a class="btn" href="archive/index.html">자료실 열기 →</a>
          </div>
        </div>`;
  }

  const chronicleHtml = chronicleDocs
    .map((doc) => {
      const catLabel = CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category;
      const dateTxt = primaryDateOf(doc) || '상시';
      const lCount = linksByDoc.get(doc.id)?.length ?? 0;
      const trace = lCount > 0 ? `<span class="doc-ledger-trace">원장 ${lCount}건</span>` : '';
      return `<li class="frontpage-chronicle-row">
            <div class="frontpage-chronicle-main">
              <strong class="doc-cat-label" data-cat="${escapeAttr(doc.category)}">${escapeHtml(catLabel)}</strong>
              <a href="${escapeAttr(doc.route)}">${escapeHtml(cardTitleOf(doc))}</a>
            </div>
            <span class="frontpage-chronicle-meta">${trace}<time>${escapeHtml(dateTxt)}</time></span>
          </li>`;
    })
    .join('\n          ');

  const activeBranchSummary = orgSummary.units
    .filter((u) => u.status === 'active' && u.code !== 'HQ')
    .map((u) => `${u.officialName}(${u.shortName}) ${u.activeCount}명`)
    .join(' · ');

  const aboutHomeCell = hasAbout
    ? `<div class="frontpage-union-cell">
        <h3>왜 물류노동조합인가 — 9년의 기록</h3>
        <p>2017년 지회 설립부터 차별 철폐, 중앙노동위원회 재심 인용, 원청 직접 교섭 인정까지 9년의 발자취를 슬라이드와 전문으로 소개합니다.</p>
        <a class="frontpage-inline-link" href="union/about.html">조합 소개 보기 →</a>
      </div>`
    : '';

  const stripClass = hasAbout
    ? 'frontpage-union-strip frontpage-union-strip--3'
    : 'frontpage-union-strip';

  const bodyHtml = `
  <header class="broadsheet-header">
    <div>
      <h1 class="broadsheet-title">현장의 목소리와 투명한 조합 살림</h1>
      <p class="broadsheet-sub">성명서 · 현장소식지 · 운영위원회 회의록과 1원 단위까지 공개되는 조합비 회계 원장</p>
    </div>
    <div class="broadsheet-issue">
      <span>기준월 <strong>${escapeHtml(latestYm || '-')}</strong></span>
      <span>활동 조합원 <strong>${orgSummary.totalActive}명</strong></span>
      <span>공개 문서 <strong>${sortedPublic.length}건</strong></span>
    </div>
  </header>

  <div class="frontpage-stage">
    <section class="frontpage-voice" aria-labelledby="sec-lead-voice">
      ${leadVoiceHtml}
      ${
        chronicleDocs.length > 0
          ? `<div class="frontpage-chronicle-wrap">
        <div class="frontpage-chronicle-head">
          <h3>최근 공개 기록</h3>
          <a href="archive/index.html">자료실 전체 ${sortedPublic.length}건 보기 →</a>
        </div>
        <ul class="frontpage-chronicle">
          ${chronicleHtml}
        </ul>
      </div>`
          : ''
      }
    </section>

    <aside class="frontpage-ledger" data-privacy-zone="finance" aria-labelledby="sec-live-ledger">
      <div class="frontpage-ledger-head">
        <h2 id="sec-live-ledger">이달의 조합 살림 (${escapeHtml(latestYm)})</h2>
        <span class="ledger-audit-stamp">원장 대조 필</span>
      </div>

      <div class="frontpage-balance-block">
        <span class="frontpage-balance-label">현재 조합 통합 통장 잔액</span>
        <strong class="frontpage-balance-value">${fmtWon(totalBal)}원</strong>
        <span class="frontpage-balance-range">집계 기간 ${escapeHtml(ledger.meta.monthsRange[0])} ~ ${escapeHtml(ledger.meta.monthsRange[1])} (${ledger.meta.totalRecords}건)</span>
      </div>

      <dl class="frontpage-flow-list">
        <div class="frontpage-flow-row">
          <div class="frontpage-flow-top">
            <dt>조합 수입 (조합비·찬조)</dt>
            <dd class="flow-amt inc">+${fmtWon(latestMonthSum.inc)}원</dd>
          </div>
          <div class="frontpage-flow-track" aria-hidden="true"><span class="frontpage-flow-fill inc" style="inline-size: ${incBarPct}%"></span></div>
        </div>
        <div class="frontpage-flow-row">
          <div class="frontpage-flow-top">
            <dt>사업 지출 (교섭·복지·운영)</dt>
            <dd class="flow-amt exp">-${fmtWon(latestMonthSum.exp)}원</dd>
          </div>
          <div class="frontpage-flow-track" aria-hidden="true"><span class="frontpage-flow-fill exp" style="inline-size: ${expBarPct}%"></span></div>
        </div>
        <div class="frontpage-flow-row">
          <div class="frontpage-flow-top">
            <dt>지부 교부·지원</dt>
            <dd class="flow-amt grant">${fmtWon(latestMonthSum.trOut)}원</dd>
          </div>
          <div class="frontpage-flow-track" aria-hidden="true"><span class="frontpage-flow-fill grant" style="inline-size: ${grantBarPct}%"></span></div>
        </div>
        <div class="frontpage-flow-row is-net">
          <div class="frontpage-flow-top">
            <dt>${escapeHtml(latestYm)} 당월 순수지</dt>
            <dd class="flow-amt">${escapeHtml(latestMonthNetText)}</dd>
          </div>
        </div>
      </dl>

      <div class="frontpage-ledger-foot">
        ${latestYm ? `<a class="btn" href="${escapeAttr(`accounting/reports/monthly/${latestYm}.html`)}">${escapeHtml(latestYm)} 월간 재정보고서 보기 →</a>` : `<a class="btn" href="accounting/index.html">회계 대시보드 보기 →</a>`}
        <div class="frontpage-ledger-links">
          <a href="accounting/index.html">회계 대시보드</a>
          <span aria-hidden="true">·</span>
          <a href="accounting/ledger.html">공개 거래 탐색기</a>
          ${latestYear ? `<span aria-hidden="true">·</span><a href="accounting/reports/index.html">${escapeHtml(latestYear)}년 결산 목록</a>` : ''}
        </div>
      </div>
    </aside>
  </div>

  <section class="section-band" aria-labelledby="sec-union-solidarity">
    <div class="section-head">
      <h2 id="sec-union-solidarity">조합 소개 · 조직 현황 · 규약</h2>
      <span class="section-sub">본조 · 안양지부 · 부평지부</span>
    </div>
    <div class="${stripClass}">
      ${aboutHomeCell}
      <div class="frontpage-union-cell">
        <h3>지부별 조합원 구성 및 현 임기 임원 안내</h3>
        <p>${escapeHtml(activeBranchSummary ? `${activeBranchSummary} (합계 ${orgSummary.totalActive}명)` : `활동 조합원 ${orgSummary.totalActive}명`)}의 직종·근무형태별 비식별 통계와 공식 직무자 현황을 공개합니다.</p>
        <a class="frontpage-inline-link" href="union/index.html">조직·임원 현황 확인 →</a>
      </div>
      <div class="frontpage-union-cell">
        <h3>노동조합 규약과 민주적 의사결정 기준</h3>
        <p>총회·대의원대회·운영위원회 의결정족수, 조합원의 권리와 의무, 단체교섭·쟁의·회계감사 규정을 시각 요약과 전문으로 열람할 수 있습니다.</p>
        <a class="frontpage-inline-link" href="${hasBylaws ? 'union/bylaws-guide.html' : 'union/index.html'}">${hasBylaws ? '규약 한눈에 보기 →' : '조합 안내 보기 →'}</a>
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
