import {
  summarizeAnnualCoa,
  summarizePeriod,
} from '../../domain/accounting.js';
import type { ContentGraph } from '../../domain/content-graph.js';
import type {
  PublicLedgerJson,
  PublicLinkEntry,
} from '../../domain/public-projection.js';
import type { DocumentRecordV3, LedgerEntry, Unit } from '../../domain/types.js';
import {
  type AssetManifest,
  assetHref,
  computePrefixForRoute,
  escapeAttr,
  escapeHtml,
  fmtMan,
  fmtWon,
  renderAccountingSubnav,
  renderPageShell,
} from '../shell.js';
import {
  type CoaConfigJson,
  writeOutFile,
  yearTone,
} from '../site-context.js';
import {
  allocateWaffleCells,
  CHART_PALETTE_CSS,
  renderActivityBarsSvg,
  renderMonthlyFlowSvg,
  renderUnitComparisonSvg,
} from '../svg-charts.js';

export function buildAccountingPages(
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

    const annualSummaryRows = summarizeAnnualCoa(yRecs, prevRecs, coaCfg.accounts, cs);
    const coaRows = annualSummaryRows.map((row) => {
      const catDisp = row.category === '내부이전' ? '지부 교부·정산' : row.category;
      return `<tr><th scope="row">${escapeHtml(row.mok)}</th>
        <td class="ctr" data-label="구분">${escapeHtml(catDisp)}</td>
        <td data-label="대분류">${escapeHtml(row.gwan)}</td>
        <td data-label="중분류">${escapeHtml(row.hang)}</td>
        <td class="ctr" data-label="건수">${row.count}</td>
        <td class="num" data-label="${prevYear}년">${ps ? fmtWon(row.prevAmount) : '-'}</td>
        <td class="num" data-label="${targetYear}년"><b>${fmtWon(row.currentAmount)}</b></td>
        <td class="num" data-label="증감">${ps ? `${row.diffAmount >= 0 ? '+' : ''}${fmtWon(row.diffAmount)}` : '-'}</td>
        <td class="num" data-label="비중">${row.pctText}</td></tr>`;
    });

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
