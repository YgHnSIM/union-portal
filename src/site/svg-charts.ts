export interface SvgChartOptions {
  standalone?: boolean;
  hideTitle?: boolean;
}

export const CHART_PALETTE_CSS = [
  'var(--chart-cobalt, #516db2)',
  'var(--chart-blue, #12354e)',
  'var(--chart-income, #39793c)',
  'var(--chart-expense, #b3392b)',
  'var(--chart-grant, #c48823)',
  'var(--chart-teal, #2e7573)',
  'var(--chart-plum, #6e66a6)',
  'var(--chart-slate, #698096)',
] as const;

export const CHART_PALETTE_HEX = [
  '#516db2',
  '#12354e',
  '#39793c',
  '#b3392b',
  '#c48823',
  '#2e7573',
  '#6e66a6',
  '#698096',
] as const;

export function allocateWaffleCells(values: number[]): number[] {
  if (values.length === 0) return [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const baseEach = values.length <= 100 ? 1 : 0;
  const remaining = Math.max(0, 100 - baseEach * values.length);
  const alloc = values.map((val, idx) => {
    const exact = (val / total) * remaining;
    const floor = Math.floor(exact);
    return { idx, cells: baseEach + floor, rem: exact - floor };
  });
  let used = alloc.reduce((s, a) => s + a.cells, 0);
  const byRem = [...alloc].sort((a, b) => b.rem - a.rem);
  let cursor = 0;
  while (used < 100 && byRem.length > 0) {
    byRem[cursor % byRem.length]!.cells += 1;
    used += 1;
    cursor += 1;
  }
  return alloc.map((a) => a.cells);
}

export interface MonthlyFlowPoint {
  label: string;
  inc: number;
  exp: number;
  endBal: number;
}

export interface ActivityBarItem {
  label: string;
  value: number;
  pct?: number;
  color?: string;
}

export interface UnitComparisonSeriesItem {
  name: string;
  value: number;
  color: string;
}

export interface UnitComparisonGroup {
  label: string;
  series: UnitComparisonSeriesItem[];
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

function niceMax(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 10;
  const padded = val * 1.16;
  const mag = 10 ** Math.floor(Math.log10(padded));
  const norm = padded / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function fmtManVal(won: number): string {
  const man = won / 10000;
  if (Math.abs(man) >= 100) return `${Math.round(man).toLocaleString('ko-KR')}`;
  if (Math.abs(man) >= 10) return `${man.toFixed(1)}`;
  return `${man.toFixed(1)}`;
}

function palette(opts?: SvgChartOptions) {
  const st = Boolean(opts?.standalone);
  return {
    ink: st ? '#0d1b2a' : 'var(--color-ink, #0d1b2a)',
    tick: st ? '#52657a' : 'var(--chart-tick, #52657a)',
    grid: st ? '#c8d6e2' : 'var(--chart-grid, rgba(105, 128, 150, 0.22))',
    sheet: st ? '#ffffff' : 'var(--color-sheet, #ffffff)',
    inc: st ? '#39793c' : 'var(--chart-income, #39793c)',
    exp: st ? '#b3392b' : 'var(--chart-expense, #b3392b)',
    bal: st ? '#12354e' : 'var(--chart-blue, #12354e)',
    cobalt: st ? '#516db2' : 'var(--chart-cobalt, #516db2)',
    grant: st ? '#c48823' : 'var(--chart-grant, #c48823)',
    teal: st ? '#2e7573' : 'var(--chart-teal, #2e7573)',
    plum: st ? '#6e66a6' : 'var(--chart-plum, #6e66a6)',
    slate: st ? '#698096' : 'var(--chart-slate, #698096)',
  };
}

export function renderMonthlyFlowSvg(
  points: MonthlyFlowPoint[],
  title: string,
  opts?: SvgChartOptions,
): string {
  const pal = palette(opts);
  const hideTitle = Boolean(opts?.hideTitle);
  const w = 640;
  const h = hideTitle ? 296 : 326;
  const ml = 54;
  const mr = 54;
  const mt = hideTitle ? 38 : 66;
  const mb = 42;
  const pw = w - ml - mr;
  const ph = h - mt - mb;

  if (points.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  ${hideTitle ? '' : `<text x="${w / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700" fill="${pal.ink}">${esc(title)}</text>`}
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="14" fill="${pal.tick}">표시할 데이터가 없습니다</text>
</svg>`;
  }

  const maxFlow = niceMax(Math.max(...points.flatMap((p) => [p.inc, p.exp, 0])));
  const maxBal = niceMax(Math.max(...points.map((p) => p.endBal), 0));

  const gridLines: string[] = [];
  for (let t = 0; t <= 4; t += 1) {
    const ratio = t / 4;
    const y = mt + ph - ph * ratio;
    const flowTick = Math.round((maxFlow * ratio) / 10000).toLocaleString('ko-KR');
    const balTick = Math.round((maxBal * ratio) / 10000).toLocaleString('ko-KR');
    gridLines.push(
      `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${w - mr}" y2="${y.toFixed(1)}" stroke="${pal.grid}" stroke-dasharray="4 3"/>`,
      `<text x="${ml - 8}" y="${(y + 4.5).toFixed(1)}" text-anchor="end" font-size="12.5" fill="${pal.tick}">${flowTick}</text>`,
      `<text x="${w - mr + 8}" y="${(y + 4.5).toFixed(1)}" text-anchor="start" font-size="12.5" fill="${pal.cobalt}">${balTick}</text>`,
    );
  }

  const slotW = pw / points.length;
  const barW = Math.min(20, Math.max(6, slotW * 0.3));
  const gap = Math.min(4, barW * 0.25);

  const bars: string[] = [];
  const lineCoords: string[] = [];
  const dots: string[] = [];
  const xLabels: string[] = [];

  points.forEach((p, idx) => {
    const cx = ml + slotW * idx + slotW / 2;
    const hInc = Math.max(0, (p.inc / maxFlow) * ph);
    const hExp = Math.max(0, (p.exp / maxFlow) * ph);
    const yInc = mt + ph - hInc;
    const yExp = mt + ph - hExp;

    bars.push(
      `<rect x="${(cx - barW - gap / 2).toFixed(1)}" y="${yInc.toFixed(1)}" width="${barW.toFixed(1)}" height="${hInc.toFixed(1)}" rx="2" fill="${pal.inc}"><title>${esc(p.label)} 수입: ${Math.round(p.inc).toLocaleString('ko-KR')}원</title></rect>`,
      `<rect x="${(cx + gap / 2).toFixed(1)}" y="${yExp.toFixed(1)}" width="${barW.toFixed(1)}" height="${hExp.toFixed(1)}" rx="2" fill="${pal.exp}"><title>${esc(p.label)} 지출: ${Math.round(p.exp).toLocaleString('ko-KR')}원</title></rect>`,
    );

    const yBal = mt + ph - Math.max(0, Math.min(1, p.endBal / maxBal)) * ph;
    lineCoords.push(`${cx.toFixed(1)},${yBal.toFixed(1)}`);
    dots.push(
      `<circle cx="${cx.toFixed(1)}" cy="${yBal.toFixed(1)}" r="4.5" fill="${pal.cobalt}" stroke="${pal.sheet}" stroke-width="1.5"><title>${esc(p.label)} 잔액: ${Math.round(p.endBal).toLocaleString('ko-KR')}원</title></circle>`,
      `<text x="${cx.toFixed(1)}" y="${Math.max(mt + 13, yBal - 10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${pal.cobalt}">${fmtManVal(p.endBal)}</text>`,
    );

    const showLabel = points.length <= 12 || idx % 2 === 0 || idx === points.length - 1;
    if (showLabel) {
      xLabels.push(
        `<text x="${cx.toFixed(1)}" y="${h - 14}" text-anchor="middle" font-size="12.5" font-weight="600" fill="${pal.tick}">${esc(p.label)}</text>`,
      );
    }
  });

  const desc = `${points.length}개 기간의 수입·지출 및 기말 잔액 추이 (단위: 만원)`;
  const legendY = hideTitle ? 8 : 38;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(desc)}</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  ${hideTitle ? '' : `<text x="${ml}" y="24" font-size="16" font-weight="700" fill="${pal.ink}">${esc(title)} (단위: 만원)</text>`}
  <g font-size="13" font-weight="600" fill="${pal.ink}">
    <rect x="${w - 252}" y="${legendY}" width="13" height="13" rx="2" fill="${pal.inc}"/>
    <text x="${w - 234}" y="${legendY + 11}">수입</text>
    <rect x="${w - 190}" y="${legendY}" width="13" height="13" rx="2" fill="${pal.exp}"/>
    <text x="${w - 172}" y="${legendY + 11}">지출</text>
    <circle cx="${w - 120}" cy="${legendY + 6.5}" r="5" fill="${pal.cobalt}"/>
    <text x="${w - 109}" y="${legendY + 11}">기말잔액</text>
  </g>
  ${gridLines.join('\n  ')}
  <line x1="${ml}" y1="${mt + ph}" x2="${w - mr}" y2="${mt + ph}" stroke="${pal.tick}"/>
  ${bars.join('\n  ')}
  <polyline fill="none" stroke="${pal.cobalt}" stroke-width="2.6" stroke-linejoin="round" points="${lineCoords.join(' ')}"/>
  ${dots.join('\n  ')}
  ${xLabels.join('\n  ')}
</svg>`;
}

export function renderActivityBarsSvg(
  items: ActivityBarItem[],
  title: string,
  opts?: SvgChartOptions,
): string {
  const pal = palette(opts);
  const hideTitle = Boolean(opts?.hideTitle);
  const w = 560;

  if (items.length === 0) {
    const h = hideTitle ? 140 : 180;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  ${hideTitle ? '' : `<text x="16" y="28" font-size="16" font-weight="700" fill="${pal.ink}">${esc(title)}</text>`}
  <text x="${w / 2}" y="${Math.round(h / 2) + 4}" text-anchor="middle" font-size="14" fill="${pal.tick}">해당 기간 지출 내역이 없습니다</text>
</svg>`;
  }

  const rowH = 38;
  const mt = hideTitle ? 12 : 52;
  const mb = 18;
  const h = mt + items.length * rowH + mb;
  const ml = 164;
  const mr = 136;
  const pw = w - ml - mr;
  const maxVal = niceMax(Math.max(...items.map((it) => it.value), 0));
  const defaultPalette = [
    pal.cobalt,
    pal.bal,
    pal.inc,
    pal.exp,
    pal.grant,
    pal.teal,
    pal.plum,
    pal.slate,
  ];

  const rows = items.map((it, idx) => {
    const y = mt + idx * rowH;
    const barW = Math.max(2, (it.value / maxVal) * pw);
    const fill = it.color ?? defaultPalette[idx % defaultPalette.length] ?? pal.cobalt;
    const rawLabel = it.label.length > 13 ? `${it.label.slice(0, 12)}…` : it.label;
    const valStr =
      it.pct !== undefined
        ? `${fmtManVal(it.value)}만원 (${it.pct.toFixed(1)}%)`
        : `${fmtManVal(it.value)}만원`;
    return `<g>
    <text x="${ml - 10}" y="${y + 21}" text-anchor="end" font-size="13.5" font-weight="600" fill="${pal.ink}"><title>${esc(it.label)}</title>${esc(rawLabel)}</text>
    <rect x="${ml}" y="${y + 5}" width="${barW.toFixed(1)}" height="22" rx="3" fill="${fill}"><title>${esc(it.label)}: ${Math.round(it.value).toLocaleString('ko-KR')}원</title></rect>
    <text x="${(ml + barW + 8).toFixed(1)}" y="${y + 21}" font-size="13" font-weight="700" fill="${pal.tick}">${esc(valStr)}</text>
  </g>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(title)} 상위 ${items.length}개 항목</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  ${hideTitle ? '' : `<text x="16" y="28" font-size="16" font-weight="700" fill="${pal.ink}">${esc(title)}</text>`}
  <line x1="${ml}" y1="${mt - 6}" x2="${ml}" y2="${h - mb}" stroke="${pal.grid}"/>
  ${rows.join('\n  ')}
</svg>`;
}

export function renderUnitComparisonSvg(
  groups: UnitComparisonGroup[],
  title: string,
  opts?: SvgChartOptions,
): string {
  const pal = palette(opts);
  const hideTitle = Boolean(opts?.hideTitle);
  const compact = groups.length <= 4;
  const w = compact ? 500 : 640;
  const h = hideTitle ? 286 : 316;
  const ml = 48;
  const mr = 20;
  const mt = hideTitle ? 42 : 72;
  const mb = 44;
  const pw = w - ml - mr;
  const ph = h - mt - mb;

  if (groups.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="15" fill="${pal.tick}">표시할 비교 데이터가 없습니다</text>
</svg>`;
  }

  const allVals = groups.flatMap((g) => g.series.map((s) => s.value));
  const maxVal = niceMax(Math.max(...allVals, 1));

  const legendSeries = groups[0]?.series ?? [];
  const legendStep = compact ? 132 : 148;
  const legendStart = Math.max(ml, w - mr - legendSeries.length * legendStep);
  const legendY = hideTitle ? 10 : 40;
  const legendHtml = legendSeries
    .map((s, idx) => {
      const lx = legendStart + idx * legendStep;
      return `<rect x="${lx}" y="${legendY}" width="13" height="13" rx="2" fill="${esc(s.color)}"/><text x="${lx + 18}" y="${legendY + 11}" font-size="13.5" font-weight="600" fill="${pal.ink}">${esc(s.name)}</text>`;
    })
    .join('\n  ');

  const gridLines: string[] = [];
  for (let t = 0; t <= 4; t += 1) {
    const ratio = t / 4;
    const y = mt + ph - ph * ratio;
    const tickNum = maxVal >= 10000
      ? Math.round((maxVal * ratio) / 10000).toLocaleString('ko-KR')
      : Math.round(maxVal * ratio).toLocaleString('ko-KR');
    gridLines.push(
      `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${w - mr}" y2="${y.toFixed(1)}" stroke="${pal.grid}" stroke-dasharray="4 3"/>`,
      `<text x="${ml - 8}" y="${(y + 4.5).toFixed(1)}" text-anchor="end" font-size="13" fill="${pal.tick}">${tickNum}</text>`,
    );
  }

  const slotW = pw / groups.length;
  const groupHtml = groups.map((g, gi) => {
    const gx = ml + gi * slotW;
    const count = Math.max(1, g.series.length);
    const barW = Math.min(compact ? 38 : 26, (slotW * 0.7) / count);
    const barGap = compact ? 6 : 4;
    const totalBarsW = count * barW + (count - 1) * barGap;
    const startX = gx + (slotW - totalBarsW) / 2;

    const bars = g.series
      .map((s, si) => {
        const x = startX + si * (barW + barGap);
        const bh = Math.max(0, (s.value / maxVal) * ph);
        const y = mt + ph - bh;
        const valText =
          s.value >= 10000 ? `${Math.round(s.value / 10000).toLocaleString('ko-KR')}` : `${s.value}`;
        const valFont = compact ? '14' : '12';
        const labelSvg =
          s.value > 0
            ? `\n        <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(mt + 13, y - 6).toFixed(1)}" text-anchor="middle" font-size="${valFont}" font-weight="700" fill="${pal.ink}">${valText}</text>`
            : '';
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${esc(s.color)}"><title>${esc(g.label)} ${esc(s.name)}: ${s.value.toLocaleString('ko-KR')}</title></rect>${labelSvg}`;
      })
      .join('\n  ');

    const xFont = compact ? '14.5' : '12.5';
    return `${bars}
    <text x="${(gx + slotW / 2).toFixed(1)}" y="${h - 14}" text-anchor="middle" font-size="${xFont}" font-weight="700" fill="${pal.ink}">${esc(g.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(title)} 그룹별 비교 막대 차트</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  ${hideTitle ? '' : `<text x="${ml}" y="25" font-size="16.5" font-weight="700" fill="${pal.ink}">${esc(title)}</text>`}
  ${legendHtml}
  ${gridLines.join('\n  ')}
  <line x1="${ml}" y1="${mt + ph}" x2="${w - mr}" y2="${mt + ph}" stroke="${pal.tick}"/>
  ${groupHtml.join('\n  ')}
</svg>`;
}
