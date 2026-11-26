import {
  isActiveUnionOfficialForPortal,
  type OrgSummaryJson,
  type PublicOfficialsJson,
} from '../../domain/public-projection.js';
import {
  type UnionAboutDocument,
  buildUnionAboutHtml,
} from '../history-renderer.js';
import {
  type BylawsDocument,
  buildBylawsFullHtml,
  buildBylawsGuideHtml,
} from '../bylaws.js';
import {
  type BylawsLawDocument,
  buildBylawsLawHtml,
} from '../bylaws-law.js';
import {
  type BylawsRevisionDocument,
  buildBylawsRevisionDiffHtml,
  buildBylawsRevisionFullHtml,
} from '../bylaws-revision.js';
import {
  type AssetManifest,
  computePrefixForRoute,
  escapeAttr,
  escapeHtml,
  renderPageShell,
  renderUnionEmblemSvg,
  renderUnionSubnav,
} from '../shell.js';
import { writeOutFile } from '../site-context.js';
import { renderUnitComparisonSvg } from '../svg-charts.js';

export function buildUnionPages(
  outDir: string,
  orgSummary: OrgSummaryJson,
  officialsJson: PublicOfficialsJson,
  bylawsDoc: BylawsDocument | null,
  bylawsLawDoc: BylawsLawDocument | null,
  bylawsRevisionDoc: BylawsRevisionDocument | null,
  currentYm: string,
  assets: AssetManifest,
  baseUrl: string,
  aboutDoc: UnionAboutDocument | null = null,
): number {
  let pages = 0;
  const route = 'union/index.html';
  const prefix = computePrefixForRoute(route);

  // Exclude external_rep (other unions) and staff_rotating (so-tong-gan-sa); show only active union officers
  const activeOfficials = officialsJson.officials
    .filter((o) => isActiveUnionOfficialForPortal(o, currentYm))
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

  const bylawsSectionHtml = bylawsDoc
    ? `
  <section class="section-band" aria-labelledby="sec-union-bylaws">
    <div class="section-head">
      <h2 id="sec-union-bylaws">3. 노동조합 규약 안내</h2>
      <span class="section-sub">${escapeHtml(bylawsDoc.meta.enactedOn.replace(/-/g, '.'))} 제정 · ${escapeHtml(bylawsDoc.meta.amendedOn.replace(/-/g, '.'))} 개정</span>
    </div>
    <div class="union-bylaws-banner">
      <div>
        <h3>조합 운영의 근간이 되는 규약과 핵심 체계를 확인하세요</h3>
        <p>총 ${bylawsDoc.chapters.length}장 ${bylawsDoc.allArticles.filter((a) => a.chapterNumber < 99).length}개 조항(부칙 ${bylawsDoc.addenda.articles.length}조·별첨 ${bylawsDoc.addenda.attachments.length}건)의 기관 구성, 의결정족수, 권리·의무, 단체교섭·쟁의·징계 절차를 시각화 자료와 검색 가능한 전문으로 제공합니다.</p>
      </div>
      <div class="portal-actions">
        <a class="btn small" href="bylaws-guide.html">규약 한눈에 보기 →</a>
        <a class="btn secondary small" href="bylaws.html">규약 전문 읽기</a>
      </div>
    </div>
  </section>`
    : '';

  const historyFeatureHtml = aboutDoc
    ? `
  <section class="section-band" aria-labelledby="sec-union-history">
    <div class="union-history-feature">
      <div class="union-history-mark" aria-hidden="true">
        ${renderUnionEmblemSvg('union-history-emblem')}
        <span class="union-history-years">2017-2026</span>
      </div>
      <div class="union-history-copy">
        <h2 id="sec-union-history">${escapeHtml(aboutDoc.meta.title)}</h2>
        <p>${escapeHtml(aboutDoc.meta.summary)}</p>
      </div>
      <div class="portal-actions">
        <a class="btn" href="about.html">조합 소개 읽기 →</a>
      </div>
    </div>
  </section>`
    : '';

  const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>노동조합 조직 및 임원 현황</h1>
      <p class="lead">지부별 조합원 현황과 현 임기 임원, 조합 소개 및 규약 안내입니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">기준월 ${escapeHtml(currentYm)}</span>
    </div>
  </header>
  ${historyFeatureHtml}

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
  </section>
  ${bylawsSectionHtml}`;

  writeOutFile(
    outDir,
    route,
    renderPageShell({
      title: '조합 조직·임원 현황',
      description: '우체국물류지원단 물류노동조합 지부별 조합원 통계, 현 임기 임원, 조합 소개 및 규약 안내',
      activeNav: 'union',
      route,
      prefix,
      baseUrl,
      assets,
      subnavHtml: aboutDoc || bylawsDoc ? renderUnionSubnav('', 'org') : undefined,
      bodyHtml,
    }),
  );
  pages += 1;

  if (aboutDoc) {
    writeOutFile(
      outDir,
      'union/about.html',
      buildUnionAboutHtml(aboutDoc, assets, baseUrl),
    );
    pages += 1;
  }

  if (bylawsDoc) {
    writeOutFile(
      outDir,
      'union/bylaws-guide.html',
      buildBylawsGuideHtml(bylawsDoc, assets, baseUrl),
    );
    writeOutFile(
      outDir,
      'union/bylaws.html',
      buildBylawsFullHtml(bylawsDoc, assets, baseUrl),
    );
    pages += 2;
  }

  // Unlisted comparison & revision suite (excluded from sitemap.xml and public union links)
  if (bylawsLawDoc) {
    writeOutFile(
      outDir,
      'union/bylaws-law.html',
      buildBylawsLawHtml(bylawsLawDoc, assets, baseUrl),
    );
    pages += 1;
  }

  if (bylawsRevisionDoc) {
    writeOutFile(
      outDir,
      'union/bylaws-revision-diff.html',
      buildBylawsRevisionDiffHtml(bylawsRevisionDoc, assets, baseUrl),
    );
    writeOutFile(
      outDir,
      'union/bylaws-revision-full.html',
      buildBylawsRevisionFullHtml(bylawsRevisionDoc, assets, baseUrl),
    );
    pages += 2;
  }

  return pages;
}
