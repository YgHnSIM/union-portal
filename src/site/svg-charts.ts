export interface SvgChartOptions {
  standalone?: boolean;
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
    ink: st ? '#0b051a' : 'var(--color-ink, #0b051a)',
    tick: st ? '#4d5160' : 'var(--chart-tick, #4d5160)',
    grid: st ? '#d1d5e0' : 'var(--chart-grid, rgba(104, 112, 134, 0.24))',
    sheet: st ? '#ffffff' : 'var(--color-sheet, #ffffff)',
    inc: st ? '#10b981' : 'var(--chart-income, #10b981)',
    exp: st ? '#f43f5e' : 'var(--chart-expense, #f43f5e)',
    bal: st ? '#002fa7' : 'var(--chart-blue, #002fa7)',
    cobalt: st ? '#3b82f6' : 'var(--chart-cobalt, #3b82f6)',
    grant: st ? '#f59e0b' : 'var(--chart-grant, #f59e0b)',
  };
}

export function renderMonthlyFlowSvg(
  points: MonthlyFlowPoint[],
  title: string,
  opts?: SvgChartOptions,
): string {
  const pal = palette(opts);
  const w = 840;
  const h = 340;
  const ml = 62;
  const mr = 64;
  const mt = 56;
  const mb = 44;
  const pw = w - ml - mr;
  const ph = h - mt - mb;

  if (points.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="${w / 2}" y="28" text-anchor="middle" font-size="15" font-weight="700" fill="${pal.ink}">${esc(title)}</text>
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
      `<text x="${ml - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${pal.tick}">${flowTick}</text>`,
      `<text x="${w - mr + 8}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-size="11" fill="${pal.bal}">${balTick}</text>`,
    );
  }

  const slotW = pw / points.length;
  const barW = Math.min(20, Math.max(6, slotW * 0.28));
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
      `<circle cx="${cx.toFixed(1)}" cy="${yBal.toFixed(1)}" r="4" fill="${pal.bal}" stroke="${pal.sheet}" stroke-width="1.5"><title>${esc(p.label)} 잔액: ${Math.round(p.endBal).toLocaleString('ko-KR')}원</title></circle>`,
      `<text x="${cx.toFixed(1)}" y="${Math.max(mt + 12, yBal - 9).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${pal.bal}">${fmtManVal(p.endBal)}</text>`,
    );

    const showLabel = points.length <= 12 || idx % 2 === 0 || idx === points.length - 1;
    if (showLabel) {
      xLabels.push(
        `<text x="${cx.toFixed(1)}" y="${h - 16}" text-anchor="middle" font-size="11" fill="${pal.tick}">${esc(p.label)}</text>`,
      );
    }
  });

  const desc = `${points.length}개 기간의 수입·지출 및 기말 잔액 추이 (단위: 만원)`;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(desc)}</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="${ml}" y="26" font-size="15" font-weight="700" fill="${pal.ink}">${esc(title)} (단위: 만원)</text>
  <g font-size="11.5" fill="${pal.ink}">
    <rect x="${w - 246}" y="14" width="12" height="12" rx="2" fill="${pal.inc}"/>
    <text x="${w - 230}" y="24">수입</text>
    <rect x="${w - 190}" y="14" width="12" height="12" rx="2" fill="${pal.exp}"/>
    <text x="${w - 174}" y="24">지출</text>
    <circle cx="${w - 126}" cy="20" r="4.5" fill="${pal.bal}"/>
    <text x="${w - 116}" y="24">기말잔액</text>
  </g>
  ${gridLines.join('\n  ')}
  <line x1="${ml}" y1="${mt + ph}" x2="${w - mr}" y2="${mt + ph}" stroke="${pal.tick}"/>
  ${bars.join('\n  ')}
  <polyline fill="none" stroke="${pal.bal}" stroke-width="2.4" stroke-linejoin="round" points="${lineCoords.join(' ')}"/>
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
  const w = 720;

  if (items.length === 0) {
    const h = 180;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="16" y="28" font-size="15" font-weight="700" fill="${pal.ink}">${esc(title)}</text>
  <text x="${w / 2}" y="102" text-anchor="middle" font-size="13.5" fill="${pal.tick}">해당 기간 지출 내역이 없습니다</text>
</svg>`;
  }

  const rowH = 34;
  const mt = 52;
  const mb = 22;
  const h = mt + items.length * rowH + mb;
  const ml = 195;
  const mr = 138;
  const pw = w - ml - mr;
  const maxVal = niceMax(Math.max(...items.map((it) => it.value), 0));
  const defaultPalette = [pal.cobalt, pal.bal, pal.inc, pal.grant, pal.exp];

  const rows = items.map((it, idx) => {
    const y = mt + idx * rowH;
    const barW = Math.max(2, (it.value / maxVal) * pw);
    const fill = it.color ?? defaultPalette[idx % defaultPalette.length] ?? pal.cobalt;
    const rawLabel = it.label.length > 18 ? `${it.label.slice(0, 17)}…` : it.label;
    const valStr =
      it.pct !== undefined
        ? `${fmtManVal(it.value)}만원 (${it.pct.toFixed(1)}%)`
        : `${fmtManVal(it.value)}만원`;
    return `<g>
    <text x="${ml - 10}" y="${y + 19}" text-anchor="end" font-size="12" fill="${pal.ink}"><title>${esc(it.label)}</title>${esc(rawLabel)}</text>
    <rect x="${ml}" y="${y + 5}" width="${barW.toFixed(1)}" height="20" rx="3" fill="${fill}"><title>${esc(it.label)}: ${Math.round(it.value).toLocaleString('ko-KR')}원</title></rect>
    <text x="${(ml + barW + 8).toFixed(1)}" y="${y + 19}" font-size="11.5" font-weight="600" fill="${pal.tick}">${esc(valStr)}</text>
  </g>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(title)} 상위 ${items.length}개 항목</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="16" y="28" font-size="15" font-weight="700" fill="${pal.ink}">${esc(title)}</text>
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
  const w = 780;
  const h = 320;
  const ml = 58;
  const mr = 24;
  const mt = 64;
  const mb = 44;
  const pw = w - ml - mr;
  const ph = h - mt - mb;

  if (groups.length === 0) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="14" fill="${pal.tick}">표시할 비교 데이터가 없습니다</text>
</svg>`;
  }

  const allVals = groups.flatMap((g) => g.series.map((s) => s.value));
  const maxVal = niceMax(Math.max(...allVals, 1));

  const legendSeries = groups[0]?.series ?? [];
  const legendStart = Math.max(ml, w - mr - legendSeries.length * 135);
  const legendHtml = legendSeries
    .map((s, idx) => {
      const lx = legendStart + idx * 135;
      return `<rect x="${lx}" y="18" width="12" height="12" rx="2" fill="${esc(s.color)}"/><text x="${lx + 17}" y="28" font-size="11.5" fill="${pal.ink}">${esc(s.name)}</text>`;
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
      `<text x="${ml - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${pal.tick}">${tickNum}</text>`,
    );
  }

  const slotW = pw / groups.length;
  const groupHtml = groups.map((g, gi) => {
    const gx = ml + gi * slotW;
    const count = Math.max(1, g.series.length);
    const barW = Math.min(34, (slotW * 0.7) / count);
    const totalBarsW = count * barW + (count - 1) * 4;
    const startX = gx + (slotW - totalBarsW) / 2;

    const bars = g.series
      .map((s, si) => {
        const x = startX + si * (barW + 4);
        const bh = Math.max(0, (s.value / maxVal) * ph);
        const y = mt + ph - bh;
        const valText =
          s.value >= 10000 ? `${Math.round(s.value / 10000).toLocaleString('ko-KR')}` : `${s.value}`;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${esc(s.color)}"><title>${esc(g.label)} ${esc(s.name)}: ${s.value.toLocaleString('ko-KR')}</title></rect>
        <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(mt + 11, y - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${pal.ink}">${valText}</text>`;
      })
      .join('\n  ');

    return `${bars}
    <text x="${(gx + slotW / 2).toFixed(1)}" y="${h - 16}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">${esc(g.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" style="font-family: sans-serif;">
  <title>${esc(title)}</title>
  <desc>${esc(title)} 그룹별 비교 막대 차트</desc>
  <rect x="0" y="0" width="${w}" height="${h}" fill="${pal.sheet}"/>
  <text x="${ml}" y="28" font-size="15" font-weight="700" fill="${pal.ink}">${esc(title)}</text>
  ${legendHtml}
  ${gridLines.join('\n  ')}
  <line x1="${ml}" y1="${mt + ph}" x2="${w - mr}" y2="${mt + ph}" stroke="${pal.tick}"/>
  ${groupHtml.join('\n  ')}
</svg>`;
}
