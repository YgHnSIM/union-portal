import fs from 'node:fs/promises';
import path from 'node:path';
import { summarizePeriod, validateLedgerRecords } from '../domain/accounting.js';
import type { Account, LedgerEntry, Unit } from '../domain/types.js';
import {
  renderActivityBarsSvg,
  renderMonthlyFlowSvg,
  renderUnitComparisonSvg,
} from '../site/svg-charts.js';
import type { UnionRepositories } from '../storage/repositories.js';

export interface BuildInternalReportsOptions {
  projectRoot: string;
  repos: UnionRepositories;
  month?: string;
  year?: number;
  outDir?: string;
}

export interface BuildInternalReportsResult {
  monthlyPath: string;
  annualPath: string;
  targetMonth: string;
  targetYear: number;
  totalRecords: number;
  unitBalances: Record<string, number>;
}

interface CoaConfigJson {
  accounts: Account[];
  expenseTypes: string[];
  fundTypes: string[];
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtSigned(n: number): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r.toLocaleString('ko-KR')}`;
}

const STANDALONE_CSS = `
  * { box-sizing: border-box; }
  :root, body { color-scheme: only light; }
  body {
    font-family: "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    color: #0b051a;
    margin: 0;
    padding: clamp(10px, 2vw, 24px);
    background: #f7f8fa;
    line-height: 1.5;
  }
  .page {
    max-width: 1100px;
    margin: 0 auto;
    background: #ffffff;
    padding: clamp(16px, 3vw, 32px);
    border: 1px solid #d1d5e0;
    border-radius: 6px;
    container-type: inline-size;
  }
  header {
    border-bottom: 3px solid #002fa7;
    padding-bottom: 14px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
  }
  h1 {
    font-size: clamp(1.18rem, 0.95rem + 1.1vw, 1.55rem);
    color: #0b051a;
    margin: 0 0 4px 0;
    line-height: 1.3;
  }
  .subtitle { font-size: 0.85rem; color: #4d5160; margin: 0; }
  .meta { text-align: right; font-size: 0.78rem; color: #4d5160; flex-shrink: 0; }
  .badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 700;
    background: #e5f4ef;
    color: #146c53;
    margin-bottom: 4px;
  }
  h2 {
    font-size: clamp(0.96rem, 0.88rem + 0.4vw, 1.08rem);
    color: #0b051a;
    margin: 24px 0 10px 0;
    border-left: 4px solid #002fa7;
    padding-left: 10px;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
    margin-bottom: 18px;
  }
  .kpi {
    background: #eef2fc;
    border: 1px solid #d1d5e0;
    border-radius: 6px;
    padding: 11px 13px;
    min-width: 0;
  }
  .kpi .label { font-size: 0.76rem; color: #4d5160; margin-bottom: 3px; }
  .kpi .value {
    font-size: clamp(1rem, 0.9rem + 0.6vw, 1.18rem);
    font-weight: 700;
    color: #0b051a;
    font-variant-numeric: tabular-nums;
    word-break: keep-all;
  }
  .kpi .sub { font-size: 0.72rem; color: #4d5160; margin-top: 2px; }
  .table-wrapper {
    overflow: auto;
    max-inline-size: 100%;
    max-block-size: min(560px, 75dvh);
    container-type: inline-size;
    margin-bottom: 14px;
    border: 1px solid #d1d5e0;
    border-radius: 4px;
  }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.8rem; }
  th, td { border-right: 1px solid #d1d5e0; border-bottom: 1px solid #d1d5e0; padding: 6px 8px; }
  thead { position: sticky; inset-block-start: 0; z-index: 2; }
  thead th { background: #0b051a; color: #ffffff; font-weight: 600; text-align: center; white-space: nowrap; }
  tbody th { background: #ffffff; font-weight: 600; text-align: left; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.ctr { text-align: center; }
  .coa-path { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; line-height: 1.3; }
  .coa-gwan, .coa-hang { font-size: 0.73rem; color: #4d5160; white-space: nowrap; }
  .coa-mok { font-size: 0.8rem; font-weight: 700; color: #0b051a; white-space: nowrap; }
  tr.subtot td, tr.subtot th { background: #eef2fc; font-weight: 700; }
  tr.tot td, tr.tot th { background: #dce4f9; font-weight: 700; }
  tr.muted td, tr.muted th { color: #4d5160; background: #f7f2e7; }
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  .chart-card { border: 1px solid #d1d5e0; border-radius: 6px; padding: 10px; background: #ffffff; break-inside: avoid; }
  .chart-card.full { grid-column: 1 / -1; }
  .chart-card svg { width: 100%; height: auto; display: block; }
  .note-box { background: #faf2df; border: 1px solid #e6cfa0; border-radius: 6px; padding: 12px 14px; font-size: 0.82rem; }
  .note-box ul { margin: 4px 0 0 18px; padding: 0; }
  @container (width < 680px) {
    header { flex-direction: column; align-items: flex-start; }
    .meta { text-align: left; }
    .chart-grid { grid-template-columns: 1fr; }
    .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container (width < 620px) {
    .table-wrapper { max-block-size: none; overflow: visible; border: 0; }
    table, thead, tbody, tr, th, td { display: block; }
    thead { display: none; }
    tr { margin-block-end: 10px; border: 1px solid #d1d5e0; border-radius: 6px; overflow: hidden; background: #ffffff; }
    th, td { border-right: none; border-bottom: 1px solid #eef2fc; padding: 7px 10px; }
    tbody th { background: #0b051a; color: #ffffff; text-align: left; }
    td { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; text-align: right; white-space: normal; }
    td::before { content: attr(data-label); font-weight: 600; color: #4d5160; text-align: left; flex-shrink: 0; }
    td.empty-cell { display: none; }
  }
  @media print {
    :root, body { color-scheme: only light; background: #ffffff; padding: 0; }
    .page { box-shadow: none; border: 0; padding: 0; max-width: none; container-type: normal; }
    .table-wrapper { max-block-size: none; overflow: visible; container-type: normal; }
    table { display: table; }
    thead { display: table-header-group; }
    tbody { display: table-row-group; }
    tr { display: table-row; }
    th, td, td.empty-cell { display: table-cell; }
    table, .chart-card, .kpi-grid { break-inside: avoid; }
    @page { size: A4; margin: 12mm; }
  }
`;

export async function buildInternalReports(
  options: BuildInternalReportsOptions,
): Promise<BuildInternalReportsResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const outRoot = path.resolve(options.outDir ?? path.join(projectRoot, 'reports'));
  const monthlyDir = path.join(outRoot, 'monthly');
  const annualDir = path.join(outRoot, 'annual');
  await fs.mkdir(monthlyDir, { recursive: true });
  await fs.mkdir(annualDir, { recursive: true });

  const coaCfg = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'config', 'coa.json'), 'utf8'),
  ) as CoaConfigJson;
  const unitsCfg = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'config', 'units.json'), 'utf8'),
  ) as { units: Unit[] };

  const [accountsDb, entries, bundle] = await Promise.all([
    options.repos.accounts.listAll(),
    options.repos.ledger.listEntries(),
    options.repos.people.getDirectoryBundle(),
  ]);

  const checkAccounts = accountsDb.length > 0 ? accountsDb : coaCfg.accounts;
  const validation = validateLedgerRecords(entries, checkAccounts);
  if (validation.errors.length > 0) {
    throw new Error(`원장 검증 실패: ${validation.errors.slice(0, 5).join('; ')}`);
  }

  const allYms = [...new Set(entries.map((r) => r.ym).filter(Boolean))].sort();
  if (allYms.length === 0) {
    throw new Error('원장에 거래 내역이 없어 보고서를 생성할 수 없습니다.');
  }
  const allYears = [...new Set(entries.map((r) => r.year).filter(Boolean))].sort(
    (a, b) => a - b,
  );

  const targetMonth =
    !options.month || options.month === 'latest'
      ? allYms[allYms.length - 1]!
      : options.month;
  if (!allYms.includes(targetMonth)) {
    throw new Error(
      `원장에 ${targetMonth} 데이터가 없습니다. (범위: ${allYms[0]} ~ ${allYms[allYms.length - 1]})`,
    );
  }
  const targetYear =
    options.year ?? Number(targetMonth.slice(0, 4)) ?? allYears[allYears.length - 1]!;
  if (!allYears.includes(targetYear)) {
    throw new Error(`${targetYear}년도 원장 데이터가 없습니다.`);
  }

  // Build Monthly Report (internal with name_only real names & org snapshot)
  const monthlyPath = path.join(monthlyDir, `${targetMonth}_운영위보고.html`);
  {
    const idxYm = allYms.indexOf(targetMonth);
    const priorBal = entries
      .filter((r) => r.ym < targetMonth)
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const curr = entries.filter((r) => r.ym === targetMonth);
    const currSum = summarizePeriod(curr);
    const endBal = priorBal + currSum.op + currSum.net;
    const recentYms = allYms.slice(Math.max(0, idxYm - 2), idxYm + 1);
    const prevYm = idxYm > 0 ? allYms[idxYm - 1] : undefined;
    const prevSum = prevYm
      ? summarizePeriod(entries.filter((r) => r.ym === prevYm))
      : undefined;

    let runB = entries
      .filter((r) => r.ym < (recentYms[0] ?? targetMonth))
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const recentRows: string[] = [];
    const trendPoints: Array<{ label: string; inc: number; exp: number; endBal: number }> = [];
    for (const ym of recentYms) {
      const ms = summarizePeriod(entries.filter((r) => r.ym === ym));
      const opM = runB + ms.op;
      const endM = opM + ms.net;
      runB = endM;
      trendPoints.push({ label: ym, inc: ms.inc, exp: ms.exp, endBal: endM });
      const cls = ym === targetMonth ? ' class="subtot"' : '';
      recentRows.push(
        `<tr${cls}><th scope="row">${esc(ym)}</th>
          <td class="num" data-label="기초잔액">${fmtWon(opM)}</td>
          <td class="num" data-label="외부 순수입">${fmtWon(ms.inc)}</td>
          <td class="num" data-label="외부 순지출">${fmtWon(ms.exp)}</td>
          <td class="num" data-label="내부이전(순)">${fmtWon(ms.trNet)}</td>
          <td class="num" data-label="이월차액">${fmtWon(ms.adj)}</td>
          <td class="num" data-label="기말잔액">${fmtWon(endM)}</td></tr>`,
      );
    }

    const monthlyTrendSvg = renderMonthlyFlowSvg(
      trendPoints,
      `최근 3개월 수지 추이 (${recentYms[0]} ~ ${targetMonth})`,
      { standalone: true },
    );

    // Organization & member stats snapshot (aggregated counts only, safe for committee tables)
    const activeMembers = bundle.members.filter((m) => m.status === 'active');
    const monthEvents = bundle.membershipEvents.filter(
      (ev) => ev.eventDate.slice(0, 7) === targetMonth,
    );
    const unitStatRows = unitsCfg.units
      .map((u) => {
        const uActive = activeMembers.filter((m) => m.unitCode === u.code);
        const gong = uActive.filter((m) => m.employmentType === '공무직').length;
        const gigan = uActive.filter((m) => m.employmentType === '기간제').length;
        const joins = monthEvents.filter(
          (e) =>
            (e.eventType === 'join' || e.eventType === 'rejoin') &&
            (e.toUnit === u.code || e.fromUnit === u.code),
        ).length;
        const withdraws = monthEvents.filter(
          (e) =>
            e.eventType === 'withdraw' &&
            (e.fromUnit === u.code || e.toUnit === u.code),
        ).length;
        return `<tr><th scope="row">${esc(u.officialName)} (${esc(u.shortName)})</th>
          <td class="ctr" data-label="상태">${u.status === 'active' ? '운영중' : '폐지'}</td>
          <td class="num" data-label="활동 조합원">${uActive.length}명</td>
          <td class="num" data-label="공무직">${gong}명</td>
          <td class="num" data-label="기간제">${gigan}명</td>
          <td class="num" data-label="당월 가입·재가입">${joins}건</td>
          <td class="num" data-label="당월 탈퇴">${withdraws}건</td></tr>`;
      })
      .join('\n');

    // COA activity aggregation
    const actAgg = new Map<string, { gb: string; gw: string; ha: string; mo: string; cnt: number; iv: number; ev: number }>();
    for (const r of curr) {
      if (r.gubun === '기초이월') continue;
      const k = `${r.gubun}||${r.gwan}||${r.hang}||${r.mok}`;
      const cur = actAgg.get(k) ?? { gb: r.gubun, gw: r.gwan, ha: r.hang, mo: r.mok, cnt: 0, iv: 0, ev: 0 };
      cur.cnt += 1;
      cur.iv += r.inc;
      cur.ev += r.exp;
      actAgg.set(k, cur);
    }
    const actRows = [...actAgg.values()]
      .sort((a, b) => a.gb.localeCompare(b.gb) || a.gw.localeCompare(b.gw) || a.mo.localeCompare(b.mo))
      .map(
        (it) => `<tr><th scope="row">${esc(it.mo)}</th>
          <td class="ctr" data-label="구분">${esc(it.gb)}</td>
          <td data-label="관(대분류)">${esc(it.gw)}</td>
          <td data-label="항(중분류)">${esc(it.ha)}</td>
          <td class="ctr" data-label="건수">${it.cnt}</td>
          <td class="${it.iv ? 'num' : 'num empty-cell'}" data-label="수입금액">${it.iv ? fmtWon(it.iv) : ''}</td>
          <td class="${it.ev ? 'num' : 'num empty-cell'}" data-label="지출금액">${it.ev ? fmtWon(it.ev) : ''}</td></tr>`,
      )
      .join('\n');

    const txRows = curr
      .map((r) => {
        const cls = r.gubun === '이월차액' ? ' class="muted"' : '';
        const attrTxt = `${r.target}${r.attrYm ? ` (${r.attrYm})` : ''}`;
        return `<tr${cls}><th scope="row">${esc(r.date)} · ${esc(r.mok)}</th>
          <td class="ctr" data-label="회계단위">${esc(r.unitName)}</td>
          <td class="ctr" data-label="구분">${esc(r.gubun)}</td>
          <td data-label="계정(관·항·목)"><span class="coa-path"><span class="coa-gwan">${esc(r.gwan)} &gt;</span> <span class="coa-hang">${esc(r.hang)} &gt;</span> <b class="coa-mok">${esc(r.mok)}</b></span></td>
          <td class="${r.expType ? 'ctr' : 'ctr empty-cell'}" data-label="지출형태">${esc(r.expType)}</td>
          <td class="ctr" data-label="대상·귀속">${esc(attrTxt)}</td>
          <td class="${r.inc ? 'num' : 'num empty-cell'}" data-label="수입">${r.inc ? fmtWon(r.inc) : ''}</td>
          <td class="${r.exp ? 'num' : 'num empty-cell'}" data-label="지출">${r.exp ? fmtWon(r.exp) : ''}</td>
          <td class="num" data-label="단위잔액">${fmtWon(r.unitBal)}</td>
          <td class="${r.note ? '' : 'empty-cell'}" data-label="적요(비고)">${esc(r.note)}</td></tr>`;
      })
      .join('\n');

    const duesGong = curr.filter((r) => r.mok === '공무직 조합비').reduce((a, r) => a + r.inc, 0);
    const duesGigan = curr.filter((r) => r.mok === '기간제 조합비').reduce((a, r) => a + r.inc, 0);
    const grantOut = curr.filter((r) => r.mok === '지부 교부금').reduce((a, r) => a + r.exp, 0);
    const alerts = curr.filter(
      (r) => r.gubun === '이월차액' || /오기|누락|확인/.test(r.memo),
    );
    const alertItems = [
      `<li>당월 조합비 입금: 공무직 <b>${fmtWon(duesGong)}원</b>, 기간제 <b>${fmtWon(duesGigan)}원</b> / 지부 교부금 전출: <b>${fmtWon(grantOut)}원</b></li>`,
      ...alerts.map(
        (a) => `<li>[${esc(a.date)}] ${esc(a.mok)} — ${esc(a.memo)}</li>`,
      ),
    ];

    const prevTxt = prevSum
      ? `전월(${prevYm}) 대비 순수입 ${fmtSigned(currSum.inc - prevSum.inc)}원 / 순지출 ${fmtSigned(currSum.exp - prevSum.exp)}원`
      : '최초 기준월';
    const [yN = '', mN = '0'] = targetMonth.split('-');
    const title = `${yN}년 ${Number(mN)}월 정기 운영위원회 재정보고`;

    const monthlyHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>${esc(title)}</h1>
      <p class="subtitle">우체국물류지원단 물류노동조합 · 내부 회의용(원본 적요 및 조합원 명부 집계 포함) · 단위: 원</p>
    </div>
    <div class="meta">
      <span class="badge">원장 검증 완료</span><br>
      보고 기준월: ${esc(targetMonth)}<br>
      생성일시: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
    </div>
  </header>

  <div class="kpi-grid">
    <div class="kpi"><div class="label">기초(이월) 잔액</div><div class="value">${fmtWon(priorBal + currSum.op)}원</div><div class="sub">전월 마감 승계</div></div>
    <div class="kpi"><div class="label">당월 외부 순수입</div><div class="value">${fmtWon(currSum.inc)}원</div><div class="sub">조합비·기부·기타수입</div></div>
    <div class="kpi"><div class="label">당월 외부 순지출</div><div class="value">${fmtWon(currSum.exp)}원</div><div class="sub">교부금 제외 실제 지출</div></div>
    <div class="kpi"><div class="label">내부이전 (전입-전출)</div><div class="value">${fmtSigned(currSum.trNet)}원</div><div class="sub">전출 ${fmtWon(currSum.trOut)}원</div></div>
    <div class="kpi"><div class="label">당월 기말잔액</div><div class="value">${fmtWon(endBal)}원</div><div class="sub">${esc(prevTxt)}</div></div>
  </div>

  <div class="chart-card full">${monthlyTrendSvg}</div>

  <h2 id="sec-trend">1. 최근 3개월 수지 추이 요약</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-trend" class="table-wrapper">
    <table>
      <thead><tr><th>보고월</th><th>기초잔액</th><th>외부 순수입</th><th>외부 순지출</th><th>내부이전(순)</th><th>이월차액</th><th>기말잔액</th></tr></thead>
      <tbody>${recentRows.join('\n')}</tbody>
    </table>
  </div>

  <h2 id="sec-org">2. 단위별 조합원 현황 (현재 활동 ${activeMembers.length}명)</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-org" class="table-wrapper">
    <table>
      <thead><tr><th>단위</th><th>상태</th><th>활동 조합원</th><th>공무직</th><th>기간제</th><th>당월 가입·재가입</th><th>당월 탈퇴</th></tr></thead>
      <tbody>${unitStatRows}</tbody>
    </table>
  </div>

  <h2 id="sec-act">3. 당월 활동별(관·항·목) 집계</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-act" class="table-wrapper">
    <table>
      <thead><tr><th>목(활동)</th><th>구분</th><th>관(대분류)</th><th>항(중분류)</th><th>건수</th><th>수입금액</th><th>지출금액</th></tr></thead>
      <tbody>
        ${actRows}
        <tr class="tot"><th scope="row">당월 합계</th><td class="ctr empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="ctr" data-label="총 건수">${curr.length}</td><td class="num" data-label="총 수입금액">${fmtWon(curr.reduce((a, r) => a + r.inc, 0))}</td><td class="num" data-label="총 지출금액">${fmtWon(curr.reduce((a, r) => a + r.exp, 0))}</td></tr>
      </tbody>
    </table>
  </div>

  <h2 id="sec-tx">4. 당월 세부 거래 내역 (${curr.length}건 · 실명 포함 내부본)</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-tx" class="table-wrapper">
    <table>
      <thead><tr><th>일자 · 활동</th><th>단위</th><th>구분</th><th>계정과목 (관 &gt; 항 &gt; 목)</th><th>지출형태</th><th>대상·귀속</th><th>수입</th><th>지출</th><th>단위잔액</th><th>적요(비고)</th></tr></thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>

  <h2>5. 조합비·교부금 및 회계 특이사항</h2>
  <div class="note-box"><ul>${alertItems.join('\n')}</ul></div>
</div>
</body>
</html>`;
    await fs.writeFile(monthlyPath, monthlyHtml, 'utf8');
  }

  // Build Annual Report (internal standalone HTML + 5 inline SVG charts)
  const annualPath = path.join(annualDir, `${targetYear}_대의원대회결산.html`);
  {
    const yRecs = entries.filter((r) => r.year === targetYear);
    const priorBal = entries
      .filter((r) => r.year < targetYear)
      .reduce((acc, r) => acc + r.inc - r.exp, 0);
    const currSum = summarizePeriod(yRecs);
    const opBal = priorBal + currSum.op;
    const endBal = opBal + currSum.net;
    const prevYear = targetYear - 1;
    const prevRecs = entries.filter((r) => r.year === prevYear);
    const prevSum = prevRecs.length > 0 ? summarizePeriod(prevRecs) : undefined;

    // 5 Inline SVG charts (standalone hex colors)
    const yMonths = [...new Set(yRecs.map((r) => r.ym).filter(Boolean))].sort();
    let runBal = priorBal;
    const monthlyPts = yMonths.map((ym) => {
      const ms = summarizePeriod(yRecs.filter((r) => r.ym === ym));
      runBal += ms.op + ms.net;
      return {
        label: `${Number(ym.slice(5, 7))}월`,
        inc: ms.inc,
        exp: ms.exp,
        endBal: runBal,
      };
    });

    const gwanMap = new Map<string, number>();
    const mokMap = new Map<string, number>();
    const etMap = new Map<string, number>();
    for (const r of yRecs) {
      if (r.gubun !== '지출') continue;
      gwanMap.set(r.gwan, (gwanMap.get(r.gwan) ?? 0) + r.exp);
      mokMap.set(`${r.mok} (${r.gwan})`, (mokMap.get(`${r.mok} (${r.gwan})`) ?? 0) + r.exp);
      if (r.expType) {
        etMap.set(r.expType, (etMap.get(r.expType) ?? 0) + r.exp);
      }
    }
    const totExp = currSum.exp || 1;
    const svgMonthly = renderMonthlyFlowSvg(
      monthlyPts,
      `${targetYear}년 월별 외부 수지 및 기말 잔액 추이`,
      { standalone: true },
    );
    const svgGwan = renderActivityBarsSvg(
      [...gwanMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value, pct: (value / totExp) * 100 })),
      `${targetYear}년 관(대분류)별 외부 순지출 비중`,
      { standalone: true },
    );
    const svgMok = renderActivityBarsSvg(
      [...mokMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value, color: '#3b82f6' })),
      `${targetYear}년 주요 활동(목)별 지출 TOP 10`,
      { standalone: true },
    );
    const svgEt = renderActivityBarsSvg(
      [...etMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({
          label,
          value,
          pct: (value / totExp) * 100,
          color: '#10b981',
        })),
      `${targetYear}년 지출형태별 집행 현황`,
      { standalone: true },
    );

    const compareYears = allYears.filter((y) => y <= targetYear);
    const multiYears = compareYears.length > 0 ? compareYears : allYears;
    const svgMulti = renderUnitComparisonSvg(
      multiYears.map((y) => {
        const yrRecs = entries.filter((r) => r.year === y);
        const dues = yrRecs
          .filter((r) => r.mok === '공무직 조합비' || r.mok === '기간제 조합비')
          .reduce((a, r) => a + r.inc, 0);
        const extExp = yrRecs
          .filter((r) => r.gubun === '지출')
          .reduce((a, r) => a + r.exp, 0);
        const grants = yrRecs
          .filter((r) => r.mok === '지부 교부금')
          .reduce((a, r) => a + r.exp, 0);
        return {
          label: `${y}년`,
          series: [
            { name: '정기조합비 합계', value: dues, color: '#3b82f6' },
            { name: '외부 순지출', value: extExp, color: '#f43f5e' },
            { name: '지부 교부금', value: grants, color: '#f59e0b' },
          ],
        };
      }),
      '연도별 정기조합비 · 외부 순지출 · 지부 교부금 비교 (만원)',
      { standalone: true },
    );

    const coaRows: string[] = [];
    for (const acc of coaCfg.accounts) {
      const { category: cat, gwan: gw, hang: ha, mok: mo } = acc;
      if (cat === '기초이월' || cat === '이월차액') continue;
      let curV = 0;
      let prvV = 0;
      let cnt = 0;
      let pctS = '-';
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
        const denom = useInc ? currSum.inc || 1 : currSum.exp || 1;
        pctS = `${((curV / denom) * 100).toFixed(1)}%`;
      }
      if (curV === 0 && prvV === 0) continue;
      coaRows.push(
        `<tr><th scope="row">${esc(mo)}</th>
          <td class="ctr" data-label="구분">${esc(cat)}</td>
          <td data-label="관(대분류)">${esc(gw)}</td>
          <td data-label="항(중분류)">${esc(ha)}</td>
          <td class="ctr" data-label="건수">${cnt}</td>
          <td class="num" data-label="${prevYear}년">${prevSum ? fmtWon(prvV) : '-'}</td>
          <td class="num" data-label="${targetYear}년"><b>${fmtWon(curV)}</b></td>
          <td class="num" data-label="전년 대비 증감">${prevSum ? fmtSigned(curV - prvV) : '-'}</td>
          <td class="num" data-label="비중">${pctS}</td></tr>`,
      );
    }

    const fundRows = coaCfg.fundTypes
      .map((fName) => {
        const fr = yRecs.filter((r) => r.fund === fName);
        const fs = summarizePeriod(fr);
        return `<tr><th scope="row">${esc(fName)}</th>
          <td class="num" data-label="외부 순수입">${fmtWon(fs.inc)}</td>
          <td class="num" data-label="외부 순지출">${fmtWon(fs.exp)}</td>
          <td class="num" data-label="내부이전(순)">${fmtWon(fs.trNet)}</td>
          <td class="num" data-label="재원 수지차">${fmtSigned(fs.inc - fs.exp)}</td></tr>`;
      })
      .join('\n');

    const adjRows = yRecs.filter(
      (r) => r.gubun === '이월차액' || /결산표|오기/.test(r.memo),
    );
    const auditItems =
      adjRows.length > 0
        ? adjRows.map(
            (r) =>
              `<li><b>[${esc(r.date)}] ${esc(r.mok)}</b>: ${esc(r.note)} (${esc(r.memo)})</li>`,
          )
        : ['<li>해당 연도 원장 검수 특이사항 없음 (월별 잔액 100% 일치)</li>'];

    const periodLabel = `${yMonths[0] ?? ''} ~ ${yMonths[yMonths.length - 1] ?? ''}`;
    const title = `${targetYear}년 정기 대의원대회 결산 보고서`;

    const annualHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>${esc(title)}</h1>
      <p class="subtitle">우체국물류지원단 물류노동조합 · 3단계 활동 결산 및 인라인 SVG 시각화 보고 · 단위: 원</p>
    </div>
    <div class="meta">
      <span class="badge">결산 검증 완료</span><br>
      대상 기간: ${esc(periodLabel)}<br>
      생성일시: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
    </div>
  </header>

  <div class="kpi-grid">
    <div class="kpi"><div class="label">기초 잔액</div><div class="value">${fmtWon(opBal)}원</div><div class="sub">${targetYear}년 개시</div></div>
    <div class="kpi"><div class="label">외부 순수입</div><div class="value">${fmtWon(currSum.inc)}원</div><div class="sub">전년 대비 ${fmtSigned(currSum.inc - (prevSum?.inc ?? 0))}원</div></div>
    <div class="kpi"><div class="label">외부 순지출</div><div class="value">${fmtWon(currSum.exp)}원</div><div class="sub">교부금 제외 순사업비</div></div>
    <div class="kpi"><div class="label">지부 교부·지원(내부이전)</div><div class="value">${fmtWon(currSum.trOut)}원</div><div class="sub">환입 ${fmtWon(currSum.trIn)}원</div></div>
    <div class="kpi"><div class="label">기말 통장잔액</div><div class="value">${fmtWon(endBal)}원</div><div class="sub">이월차액 ${fmtSigned(currSum.adj)}원 포함</div></div>
  </div>

  <h2>1. 재정 흐름 및 활동 비중 시각화 (SVG)</h2>
  <div class="chart-grid">
    <div class="chart-card full">${svgMonthly}</div>
    <div class="chart-card">${svgGwan}</div>
    <div class="chart-card">${svgMok}</div>
    <div class="chart-card">${svgEt}</div>
    <div class="chart-card">${svgMulti}</div>
  </div>

  <h2 id="sec-coa">2. 3단계 계정과목(관 · 항 · 목) 연간 결산표</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-coa" class="table-wrapper">
    <table>
      <thead><tr><th>목(활동)</th><th>구분</th><th>관(대분류)</th><th>항(중분류)</th><th>건수</th><th>${prevYear}년</th><th>${targetYear}년</th><th>증감</th><th>비중</th></tr></thead>
      <tbody>
        ${coaRows.join('\n')}
        <tr class="subtot"><th scope="row">외부 순수입 합계</th><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="num" data-label="${prevYear}년">${prevSum ? fmtWon(prevSum.inc) : '-'}</td><td class="num" data-label="${targetYear}년">${fmtWon(currSum.inc)}</td><td class="num" data-label="증감">${prevSum ? fmtSigned(currSum.inc - prevSum.inc) : '-'}</td><td class="num" data-label="비중">100.0%</td></tr>
        <tr class="subtot"><th scope="row">외부 순지출 합계</th><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="num" data-label="${prevYear}년">${prevSum ? fmtWon(prevSum.exp) : '-'}</td><td class="num" data-label="${targetYear}년">${fmtWon(currSum.exp)}</td><td class="num" data-label="증감">${prevSum ? fmtSigned(currSum.exp - prevSum.exp) : '-'}</td><td class="num" data-label="비중">100.0%</td></tr>
        <tr class="tot"><th scope="row">본부 기준 총지출</th><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="empty-cell"></td><td class="num" data-label="${prevYear}년">${prevSum ? fmtWon(prevSum.hqExp) : '-'}</td><td class="num" data-label="${targetYear}년">${fmtWon(currSum.hqExp)}</td><td class="num" data-label="증감">${prevSum ? fmtSigned(currSum.hqExp - prevSum.hqExp) : '-'}</td><td class="num empty-cell"></td></tr>
      </tbody>
    </table>
  </div>

  <h2 id="sec-fund">3. 재원별(일반회계 vs 특별모금·찬조) 결산 요약</h2>
  <div tabindex="0" role="region" aria-labelledby="sec-fund" class="table-wrapper">
    <table>
      <thead><tr><th>재원구분</th><th>외부 순수입</th><th>외부 순지출</th><th>내부이전(순)</th><th>재원 수지차(수입-지출)</th></tr></thead>
      <tbody>${fundRows}</tbody>
    </table>
  </div>

  <h2>4. 회계 검수 및 특이사항 보고</h2>
  <div class="note-box"><ul>${auditItems.join('\n')}</ul></div>
</div>
</body>
</html>`;
    await fs.writeFile(annualPath, annualHtml, 'utf8');
  }

  return {
    monthlyPath,
    annualPath,
    targetMonth,
    targetYear,
    totalRecords: entries.length,
    unitBalances: validation.unitBalances,
  };
}
