(function () {
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");

  let ALL_RECORDS = [];
  let META = {};
  const charts = {};
  let drillState = { gwan: null, hang: null };
  let monthlyMode = "fit";
  let monthlyLabels = [];

  function readChartTheme() {
    const cs = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
      palette: [
        tok("--chart-cobalt", "#1b4079"),
        tok("--chart-blue", "#2d63a8"),
        tok("--chart-income", "#1c6b4e"),
        tok("--chart-expense", "#b3461d"),
        tok("--chart-grant", "#9e6b08"),
        tok("--chart-teal", "#177278"),
        tok("--chart-plum", "#6b468c"),
        tok("--chart-slate", "#5c6473"),
      ],
      cobalt: tok("--chart-cobalt", "#1b4079"),
      blue: tok("--chart-blue", "#2d63a8"),
      income: tok("--chart-income", "#1c6b4e"),
      expense: tok("--chart-expense", "#b3461d"),
      grant: tok("--chart-grant", "#9e6b08"),
      grid: tok("--chart-grid", "rgba(118, 116, 108, 0.22)"),
      tick: tok("--chart-tick", "#4a505e"),
      tooltipBg: tok("--chart-tooltip-bg", "#16181d"),
      tooltipInk: tok("--chart-tooltip-ink", "#fcfcfa"),
      sheet: tok("--color-sheet", "#fcfcfa"),
      minimapFill: tok("--minimap-fill", "rgba(27, 64, 121, 0.12)"),
      font: tok("--font-sans", "system-ui, sans-serif"),
    };
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function buildLedgerHref(params) {
    const sp = new URLSearchParams();
    if (params.year) sp.set("year", params.year);
    if (params.gubun && params.gubun !== "전체") sp.set("gubun", params.gubun);
    if (params.gwan && params.gwan !== "전체") sp.set("gwan", params.gwan);
    if (params.q) sp.set("q", params.q);
    const qs = sp.toString();
    return qs ? `ledger.html?${qs}` : "ledger.html";
  }

  function summarize(recs) {
    let op = 0, inc = 0, exp = 0, trIn = 0, trOut = 0, adj = 0;
    for (const r of recs) {
      if (r.gubun === "기초이월") op += r.inc;
      else if (r.gubun === "수입") inc += r.inc;
      else if (r.gubun === "지출") exp += r.exp;
      else if (r.gubun === "내부이전(전입)") trIn += r.inc;
      else if (r.gubun === "내부이전(전출)") trOut += r.exp;
      else if (r.gubun === "이월차액") adj += r.inc - r.exp;
    }
    return { op, inc, exp, trIn, trOut, trNet: trIn - trOut, adj, net: inc - exp + (trIn - trOut) + adj };
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      delete charts[key];
    }
  }

  function getFilters() {
    return {
      year: document.getElementById("f-year").value,
      unit: document.getElementById("f-unit").value,
      fund: document.getElementById("f-fund").value,
    };
  }

  function renderReadout(elId, keyText, items) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!keyText) {
      el.innerHTML = `<span class="readout-key">표시할 데이터가 없습니다</span>`;
      return;
    }
    const itemsHtml = items
      .map((it) => `<span class="readout-item" style="--swatch-color: ${escapeHtml(it.color)}"><span class="readout-label">${escapeHtml(it.label)}</span><b class="readout-val">${escapeHtml(it.value)}</b></span>`)
      .join("");
    el.innerHTML = `<span class="readout-key">${escapeHtml(keyText)}</span><span class="readout-items" data-count="${items.length}">${itemsHtml}</span>`;
  }

  function makeExternalTooltip(elId, defaultFn, activeFn) {
    return {
      enabled: false,
      external(context) {
        const { tooltip } = context;
        if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) {
          defaultFn();
          return;
        }
        activeFn(tooltip);
      },
    };
  }

  function baseScaleOpts(t) {
    return {
      grid: { color: t.grid },
      ticks: { color: t.tick, font: { family: t.font, size: 11 } },
      border: { color: t.grid },
    };
  }

  function basePluginOpts(t) {
    return {
      legend: { labels: { color: t.tick, font: { family: t.font, size: 11 }, boxWidth: 12 } },
    };
  }

  function applyFilters() {
    const f = getFilters();
    const matchUnitFund = (r) => (f.unit === "전체" || r.unit === f.unit) && (f.fund === "전체" || r.fund === f.fund);
    const scoped = ALL_RECORDS.filter(matchUnitFund);
    const filtered = f.year === "전체" ? scoped : scoped.filter((r) => String(r.year) === f.year);

    let priorBal = 0;
    if (f.year !== "전체") {
      const yNum = Number(f.year);
      for (const r of scoped) {
        if (r.year < yNum) priorBal += r.inc - r.exp;
      }
    }
    const sum = summarize(filtered);
    const opBal = priorBal + sum.op;
    const endBal = opBal + sum.net;

    document.getElementById("kpi-open").textContent = fmt(opBal) + "원";
    document.getElementById("kpi-inc").textContent = fmt(sum.inc) + "원";
    document.getElementById("kpi-exp").textContent = fmt(sum.exp) + "원";
    document.getElementById("kpi-tr").textContent = fmt(sum.trOut) + "원";
    document.getElementById("kpi-tr-sub").textContent = `환수·회수 ${fmt(sum.trIn)}원`;
    document.getElementById("kpi-end").textContent = fmt(endBal) + "원";
    document.getElementById("kpi-end-sub").textContent = `이월 조정 ${sum.adj >= 0 ? "+" : ""}${fmt(sum.adj)} · ${filtered.length}건`;

    const theme = readChartTheme();
    renderMonthlyChart(filtered, opBal, theme);
    renderDrillChart(filtered, theme);
    renderTopMokChart(filtered, theme);
    renderExpTypeChart(filtered, theme);
    renderDuesGrantChart(filtered, theme);
    renderSummaryTable(filtered, sum.exp || 1);
  }

  function syncMinimapLens() {
    const scroller = document.getElementById("monthly-scroll");
    const lens = document.getElementById("minimap-lens");
    const rangeEl = document.getElementById("minimap-range");
    const viewport = document.getElementById("minimap-viewport");
    if (!scroller || !lens || !monthlyLabels.length) return;

    const totalW = scroller.scrollWidth || 1;
    const viewW = scroller.clientWidth || totalW;
    const maxScroll = Math.max(0, totalW - viewW);
    const leftRatio = Math.min(1, Math.max(0, scroller.scrollLeft / totalW));
    const widthRatio = Math.min(1, Math.max(0.08, viewW / totalW));

    lens.style.setProperty("--lens-left", `${(leftRatio * 100).toFixed(2)}%`);
    lens.style.setProperty("--lens-width", `${(widthRatio * 100).toFixed(2)}%`);

    const n = monthlyLabels.length;
    const startIdx = Math.min(n - 1, Math.max(0, Math.floor(leftRatio * n)));
    const endIdx = Math.min(n - 1, Math.max(startIdx, Math.ceil((leftRatio + widthRatio) * n) - 1));
    const rangeLabel = startIdx === endIdx ? monthlyLabels[startIdx] : `${monthlyLabels[startIdx]} ~ ${monthlyLabels[endIdx]}`;
    if (rangeEl) rangeEl.textContent = `표시: ${rangeLabel}`;
    if (viewport) {
      const pct = maxScroll > 0 ? Math.round((scroller.scrollLeft / maxScroll) * 100) : 100;
      viewport.setAttribute("aria-valuenow", String(pct));
      viewport.setAttribute("aria-valuetext", rangeLabel);
    }
  }

  function renderMonthlyChart(filtered, opBal, t) {
    destroyChart("monthly");
    destroyChart("monthlyMinimap");
    const yms = [...new Set(filtered.map((r) => r.ym).filter(Boolean))].sort();
    monthlyLabels = yms;
    let run = opBal;
    const incs = [], exps = [], bals = [];
    for (const ym of yms) {
      const mr = filtered.filter((r) => r.ym === ym);
      const ms = summarize(mr);
      run += ms.net;
      incs.push(ms.inc);
      exps.push(ms.exp);
      bals.push(run);
    }

    const scroller = document.getElementById("monthly-scroll");
    const stage = document.getElementById("monthly-stage");
    const switchEl = document.getElementById("monthly-mode-switch");
    const minimapWrap = document.getElementById("monthly-minimap-wrap");
    const btnFit = document.getElementById("btn-mode-fit");
    const btnPan = document.getElementById("btn-mode-pan");

    const canExpand = yms.length > 6;
    const usePan = canExpand && monthlyMode === "pan";
    if (switchEl) switchEl.hidden = !canExpand;
    if (btnFit) btnFit.setAttribute("aria-pressed", String(!usePan));
    if (btnPan) btnPan.setAttribute("aria-pressed", String(usePan));
    if (stage) {
      stage.style.setProperty("--stage-min-width", usePan ? `${Math.max(540, yms.length * 40)}px` : "100%");
    }

    const showMonthlyDefault = () => {
      if (!yms.length) return renderReadout("readout-monthly", "", []);
      const last = yms.length - 1;
      renderReadout("readout-monthly", `${yms[last]} (최신)`, [
        { label: "수입", value: `${fmt(incs[last])}원`, color: t.income },
        { label: "지출", value: `${fmt(exps[last])}원`, color: t.expense },
        { label: "잔액", value: `${fmt(bals[last])}원`, color: t.cobalt },
      ]);
    };
    showMonthlyDefault();

    const ctx = document.getElementById("chart-monthly");
    charts.monthly = new Chart(ctx, {
      data: {
        labels: yms,
        datasets: [
          { type: "bar", label: "조합 수입", data: incs, backgroundColor: t.income, borderRadius: 2, yAxisID: "y" },
          { type: "bar", label: "사업 지출", data: exps, backgroundColor: t.expense, borderRadius: 2, yAxisID: "y" },
          {
            type: "line",
            label: "기말 잔액",
            data: bals,
            borderColor: t.cobalt,
            backgroundColor: t.cobalt,
            tension: 0.18,
            pointRadius: usePan ? 2.5 : (yms.length > 18 ? 1.5 : 2.5),
            pointHoverRadius: 5,
            borderWidth: 2,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            ...baseScaleOpts(t),
            grid: { display: false },
            ticks: {
              ...baseScaleOpts(t).ticks,
              maxRotation: 0,
              autoSkip: !usePan,
              maxTicksLimit: usePan ? undefined : (yms.length > 18 ? 6 : 8),
              autoSkipPadding: 14,
              font: { family: t.font, size: 10 },
            },
          },
          y: {
            ...baseScaleOpts(t),
            beginAtZero: true,
            ticks: { ...baseScaleOpts(t).ticks, maxTicksLimit: 5, callback: (v) => fmt(v / 10000) + "만" },
          },
          y1: {
            ...baseScaleOpts(t),
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { ...baseScaleOpts(t).ticks, maxTicksLimit: 5, callback: (v) => fmt(v / 10000) + "만" },
          },
        },
        plugins: {
          ...basePluginOpts(t),
          tooltip: makeExternalTooltip("readout-monthly", showMonthlyDefault, (tip) => {
            const idx = tip.dataPoints[0].dataIndex;
            renderReadout("readout-monthly", yms[idx], [
              { label: "수입", value: `${fmt(incs[idx])}원`, color: t.income },
              { label: "지출", value: `${fmt(exps[idx])}원`, color: t.expense },
              { label: "잔액", value: `${fmt(bals[idx])}원`, color: t.cobalt },
            ]);
          }),
        },
      },
    });

    if (minimapWrap) {
      minimapWrap.hidden = !usePan;
    }

    if (usePan && yms.length) {
      const mmCanvas = document.getElementById("chart-monthly-minimap");
      if (mmCanvas) {
        charts.monthlyMinimap = new Chart(mmCanvas, {
          type: "line",
          data: {
            labels: yms,
            datasets: [{
              data: bals,
              borderColor: t.cobalt,
              backgroundColor: t.minimapFill,
              fill: true,
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.2,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            events: [],
            layout: { padding: { top: 4, bottom: 2, left: 0, right: 0 } },
            scales: {
              x: { display: false },
              y: { display: false, beginAtZero: true },
            },
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false },
            },
          },
        });
      }
      if (scroller) {
        requestAnimationFrame(() => {
          scroller.scrollLeft = scroller.scrollWidth;
          syncMinimapLens();
        });
      }
    } else if (scroller) {
      scroller.scrollLeft = 0;
    }
  }

  function updateDrillBreadcrumbs() {
    const bar = document.getElementById("drill-breadcrumbs");
    const parts = [`<button type="button" class="btn small ${!drillState.gwan ? "" : "secondary"}" data-level="root">전체 대분류</button>`];
    if (drillState.gwan) {
      parts.push(`<span aria-hidden="true">&rsaquo;</span><button type="button" class="btn small ${!drillState.hang ? "" : "secondary"}" data-level="gwan">${escapeHtml(drillState.gwan)}</button>`);
    }
    if (drillState.hang) {
      parts.push(`<span aria-hidden="true">&rsaquo;</span><span class="crumb-active">${escapeHtml(drillState.hang)}</span>`);
    }
    bar.innerHTML = parts.join("");
    bar.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.level === "root") drillState = { gwan: null, hang: null };
        else if (b.dataset.level === "gwan") drillState = { gwan: drillState.gwan, hang: null };
        applyFilters();
      });
    });

    const dlLink = document.getElementById("drill-ledger-link");
    if (dlLink) {
      const f = getFilters();
      dlLink.href = buildLedgerHref({
        year: f.year,
        gubun: "지출",
        gwan: drillState.gwan || "전체",
        q: drillState.hang || "",
      });
      dlLink.textContent = drillState.hang
        ? `'${drillState.hang}' 거래 내역 보기 →`
        : drillState.gwan
          ? `'${drillState.gwan}' 거래 내역 보기 →`
          : "전체 지출 내역 보기 →";
    }
  }

  function allocateWaffleCells(items) {
    if (!items.length) return [];
    const total = items.reduce((a, b) => a + b[1], 0) || 1;
    const baseEach = items.length <= 100 ? 1 : 0;
    const remaining = Math.max(0, 100 - baseEach * items.length);
    const alloc = items.map(([, val], idx) => {
      const exact = (val / total) * remaining;
      const floor = Math.floor(exact);
      return { idx, cells: baseEach + floor, rem: exact - floor };
    });
    let used = alloc.reduce((s, a) => s + a.cells, 0);
    const byRem = [...alloc].sort((a, b) => b.rem - a.rem);
    let cursor = 0;
    while (used < 100 && byRem.length) {
      byRem[cursor % byRem.length].cells += 1;
      used += 1;
      cursor += 1;
    }
    return alloc.map((a) => a.cells);
  }

  function bindSyncedHighlight(container, selector, onFocusIdx, onReset) {
    container.classList.remove("has-hover");
    const clear = () => {
      container.classList.remove("has-hover");
      container.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
      onReset();
    };
    const activate = (idx) => {
      container.classList.add("has-hover");
      container.querySelectorAll(selector).forEach((el) => {
        el.classList.toggle("is-active", Number(el.dataset.idx) === idx);
      });
      onFocusIdx(idx);
    };
    container.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
      const target = e.target.closest(selector);
      if (target) activate(Number(target.dataset.idx));
      else clear();
    });
    container.addEventListener("focusin", (e) => {
      const target = e.target.closest(selector);
      if (target && target.matches(":focus-visible")) activate(Number(target.dataset.idx));
    });
    container.addEventListener("pointerleave", clear);
    container.addEventListener("mouseleave", clear);
    container.addEventListener("pointercancel", clear);
    container.addEventListener("focusout", (e) => {
      if (!e.relatedTarget || !container.contains(e.relatedTarget)) clear();
    });
  }

  window.addEventListener("pageshow", () => {
    document.querySelectorAll(".has-hover").forEach((el) => el.classList.remove("has-hover"));
    document.querySelectorAll(".is-active[data-idx]").forEach((el) => el.classList.remove("is-active"));
  });

  function renderDrillChart(filtered, t) {
    updateDrillBreadcrumbs();
    const expRows = filtered.filter((r) => r.gubun === "지출");
    let field = "gwan";
    let scoped = expRows;
    if (drillState.gwan) {
      scoped = scoped.filter((r) => r.gwan === drillState.gwan);
      field = "hang";
    }
    if (drillState.hang) {
      scoped = scoped.filter((r) => r.hang === drillState.hang);
      field = "mok";
    }
    const agg = new Map();
    for (const r of scoped) {
      agg.set(r[field], (agg.get(r[field]) || 0) + r.exp);
    }
    const items = [...agg.entries()].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const totalVal = items.reduce((a, b) => a + b[1], 0) || 1;
    const hint = document.getElementById("drill-hint");
    hint.textContent = field === "gwan"
      ? "1단계 대분류 · 항목 선택 시 중분류 이동"
      : field === "hang"
        ? "2단계 중분류 · 항목 선택 시 세부활동 이동"
        : "3단계 세부활동 · 항목 선택 시 거래내역 이동";

    const showDrillDefault = () => {
      if (!items.length) return renderReadout("readout-drill", "", []);
      const [lbl, val] = items[0];
      renderReadout("readout-drill", `${lbl} (1위)`, [
        { label: "지출액", value: `${fmt(val)}원 (${(val / totalVal * 100).toFixed(1)}%)`, color: t.palette[0] },
      ]);
    };
    showDrillDefault();

    const oldWrap = document.getElementById("waffle-drill");
    const wrap = oldWrap.cloneNode(false);
    wrap.classList.remove("has-hover");
    oldWrap.replaceWith(wrap);

    if (!items.length) {
      wrap.innerHTML = `<p class="chart-empty">표시할 지출 내역이 없습니다.</p>`;
      return;
    }

    const curYear = getFilters().year;
    const gridItems = items.slice(0, 100);
    const cellCounts = allocateWaffleCells(gridItems);
    const cellsHtml = [];
    gridItems.forEach(([lbl, val], idx) => {
      const color = t.palette[idx % t.palette.length];
      const pct = (val / totalVal * 100).toFixed(1);
      const title = `${lbl}: ${fmt(val)}원 (${pct}%)`;
      for (let c = 0; c < cellCounts[idx]; c += 1) {
        cellsHtml.push(
          `<div class="waffle-cell" data-idx="${idx}" style="--cell-color:${color}" title="${escapeHtml(title)}" aria-hidden="true"></div>`
        );
      }
    });

    const legendHtml = items.map(([lbl, val], idx) => {
      const color = t.palette[idx % t.palette.length];
      const pct = (val / totalVal * 100).toFixed(1);
      if (field === "mok") {
        const href = buildLedgerHref({
          year: curYear,
          gubun: "지출",
          gwan: drillState.gwan || "전체",
          q: lbl,
        });
        return `<a class="waffle-legend-btn" href="${escapeHtml(href)}" data-idx="${idx}" style="--cell-color:${color}">
          <span class="waffle-swatch" aria-hidden="true"></span>
          <span class="waffle-lbl">${escapeHtml(lbl)}</span>
          <span class="waffle-meta"><strong>${pct}%</strong> <span class="waffle-amt">${fmt(val)}원</span></span>
          <span class="waffle-arrow" aria-hidden="true">→</span>
        </a>`;
      }
      return `<button type="button" class="waffle-legend-btn" data-idx="${idx}" style="--cell-color:${color}">
        <span class="waffle-swatch" aria-hidden="true"></span>
        <span class="waffle-lbl">${escapeHtml(lbl)}</span>
        <span class="waffle-meta"><strong>${pct}%</strong> <span class="waffle-amt">${fmt(val)}원</span></span>
        <span class="waffle-arrow" aria-hidden="true">›</span>
      </button>`;
    }).join("");

    wrap.innerHTML = `
      <div class="waffle-stage">
        <div class="waffle-grid" role="img" aria-label="${field === "gwan" ? "대분류" : field === "hang" ? "중분류" : "세부활동"} 지출 비중 100칸 와플 그리드">${cellsHtml.join("")}</div>
        <div class="waffle-caption">1칸 ≈ 1% · 총 100칸</div>
      </div>
      <div class="waffle-legend">${legendHtml}</div>
    `;

    bindSyncedHighlight(wrap, "[data-idx]", (idx) => {
      const item = items[idx];
      if (!item) return;
      const [lbl, val] = item;
      renderReadout("readout-drill", lbl, [
        { label: "지출액", value: `${fmt(val)}원 (${(val / totalVal * 100).toFixed(1)}%)`, color: t.palette[idx % t.palette.length] },
      ]);
    }, showDrillDefault);

    wrap.addEventListener("click", (e) => {
      const btnOrCell = e.target.closest("[data-idx]");
      if (!btnOrCell) return;
      if (btnOrCell.tagName === "A") return; // native navigation handles mok links
      const idx = Number(btnOrCell.dataset.idx);
      const item = items[idx];
      if (!item) return;
      const label = item[0];
      if (field === "gwan") {
        drillState = { gwan: label, hang: null };
        renderDrillChart(filtered, readChartTheme());
      } else if (field === "hang") {
        drillState = { gwan: drillState.gwan, hang: label };
        renderDrillChart(filtered, readChartTheme());
      } else if (field === "mok") {
        window.location.href = buildLedgerHref({
          year: curYear,
          gubun: "지출",
          gwan: drillState.gwan || "전체",
          q: label,
        });
      }
    });
  }

  function getGwanColorMap(filtered, t) {
    const agg = new Map();
    for (const r of filtered) {
      if (r.gubun === "지출" && r.gwan) agg.set(r.gwan, (agg.get(r.gwan) || 0) + r.exp);
    }
    const ranked = [...agg.entries()].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    return new Map(ranked.map(([gwan], idx) => [gwan, t.palette[idx % t.palette.length]]));
  }

  function renderTopMokChart(filtered, t) {
    destroyChart("topMok");
    const agg = new Map();
    const mokGwan = new Map();
    for (const r of filtered) {
      if (r.gubun === "지출") {
        agg.set(r.mok, (agg.get(r.mok) || 0) + r.exp);
        if (!mokGwan.has(r.mok) && r.gwan) mokGwan.set(r.mok, r.gwan);
      }
    }
    const items = [...agg.entries()].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const gwanColorMap = getGwanColorMap(filtered, t);
    const barColors = items.map(([mok]) => gwanColorMap.get(mokGwan.get(mok)) || t.blue);

    const legendEl = document.getElementById("top-mok-legend");
    if (legendEl) {
      const usedGwans = new Set(items.map(([mok]) => mokGwan.get(mok)).filter(Boolean));
      const pills = [...gwanColorMap.entries()]
        .filter(([g]) => usedGwans.has(g))
        .map(([g, col]) => `<span class="top-mok-pill"><span class="waffle-swatch" style="--cell-color:${col}" aria-hidden="true"></span>${escapeHtml(g)}</span>`);
      legendEl.innerHTML = pills.join("");
    }

    const showTopDefault = () => {
      if (!items.length) return renderReadout("readout-top-mok", "", []);
      const [lbl, val] = items[0];
      const gwan = mokGwan.get(lbl) || "지출액";
      renderReadout("readout-top-mok", `1위 · ${lbl}`, [
        { label: gwan, value: `${fmt(val)}원`, color: barColors[0] },
      ]);
    };
    showTopDefault();

    charts.topMok = new Chart(document.getElementById("chart-top-mok"), {
      type: "bar",
      data: {
        labels: items.map((x) => x[0]),
        datasets: [{ label: "지출액", data: items.map((x) => x[1]), backgroundColor: barColors, borderRadius: 3 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", axis: "y", intersect: false },
        onHover: (e, els) => {
          if (e?.native?.target) e.native.target.style.cursor = els.length ? "pointer" : "default";
        },
        onClick: (_, els) => {
          if (!els.length) return;
          const lbl = items[els[0].index]?.[0];
          if (!lbl) return;
          window.location.href = buildLedgerHref({
            year: getFilters().year,
            gubun: "지출",
            gwan: mokGwan.get(lbl) || "전체",
            q: lbl,
          });
        },
        scales: {
          x: { ...baseScaleOpts(t), beginAtZero: true, ticks: { ...baseScaleOpts(t).ticks, maxTicksLimit: 5, callback: (v) => fmt(v / 10000) + "만" } },
          y: { ...baseScaleOpts(t), grid: { display: false } },
        },
        plugins: {
          ...basePluginOpts(t),
          legend: { display: false },
          tooltip: makeExternalTooltip("readout-top-mok", showTopDefault, (tip) => {
            const idx = tip.dataPoints[0].dataIndex;
            const [lbl, val] = items[idx];
            const gwan = mokGwan.get(lbl) || "지출액";
            renderReadout("readout-top-mok", `${idx + 1}위 · ${lbl}`, [
              { label: gwan, value: `${fmt(val)}원`, color: barColors[idx] },
            ]);
          }),
        },
      },
    });
  }

  function renderExpTypeChart(filtered, t) {
    const agg = new Map();
    for (const r of filtered) {
      if (r.gubun === "지출" && r.exp_type) agg.set(r.exp_type, (agg.get(r.exp_type) || 0) + r.exp);
    }
    const items = [...agg.entries()].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const totalVal = items.reduce((a, b) => a + b[1], 0) || 1;
    const showExpDefault = () => {
      if (!items.length) return renderReadout("readout-exp-type", "", []);
      renderReadout("readout-exp-type", `${items[0][0]} (최다)`, [
        { label: "지출액", value: `${fmt(items[0][1])}원 (${(items[0][1] / totalVal * 100).toFixed(1)}%)`, color: t.palette[0] },
      ]);
    };
    showExpDefault();

    const oldWrap = document.getElementById("exp-type-viz");
    const wrap = oldWrap.cloneNode(false);
    wrap.classList.remove("has-hover");
    oldWrap.replaceWith(wrap);

    if (!items.length) {
      wrap.innerHTML = `<p class="chart-empty">표시할 지출 내역이 없습니다.</p>`;
      return;
    }

    const curYear = getFilters().year;
    const stackSegs = items.map(([lbl, val], idx) => {
      const color = t.palette[idx % t.palette.length];
      const pct = (val / totalVal * 100).toFixed(1);
      const href = buildLedgerHref({ year: curYear, gubun: "지출", q: lbl });
      return `<a class="exp-stack-seg" href="${escapeHtml(href)}" data-idx="${idx}" style="flex-grow:${val};--seg-color:${color}" aria-label="${escapeHtml(lbl)} ${pct}% (${fmt(val)}원) 거래 내역 보기" title="${escapeHtml(lbl)}: ${fmt(val)}원 (${pct}%)"></a>`;
    }).join("");

    const rankRows = items.map(([lbl, val], idx) => {
      const color = t.palette[idx % t.palette.length];
      const pctNum = (val / totalVal) * 100;
      const pct = pctNum.toFixed(1);
      const href = buildLedgerHref({ year: curYear, gubun: "지출", q: lbl });
      return `<a class="exp-rank-row" href="${escapeHtml(href)}" data-idx="${idx}" style="--item-color:${color}">
        <div class="exp-rank-top">
          <span class="exp-rank-swatch" aria-hidden="true"></span>
          <span class="exp-rank-name">${escapeHtml(lbl)}</span>
          <span class="exp-rank-nums">
            <strong>${pct}%</strong>
            <span class="exp-rank-amt">${fmt(val)}원</span>
            <span class="exp-rank-arrow" aria-hidden="true">→</span>
          </span>
        </div>
        <span class="exp-rank-track" aria-hidden="true"><span class="exp-rank-fill" style="width:${pctNum.toFixed(2)}%"></span></span>
      </a>`;
    }).join("");

    wrap.innerHTML = `
      <div class="exp-stack-bar" role="group" aria-label="지출방식별 100% 누적 구성 막대">${stackSegs}</div>
      <div class="exp-rank-list">${rankRows}</div>
    `;

    bindSyncedHighlight(wrap, "[data-idx]", (idx) => {
      const item = items[idx];
      if (!item) return;
      const [lbl, val] = item;
      renderReadout("readout-exp-type", lbl, [
        { label: "지출액", value: `${fmt(val)}원 (${(val / totalVal * 100).toFixed(1)}%)`, color: t.palette[idx % t.palette.length] },
      ]);
    }, showExpDefault);
  }

  function renderDuesGrantChart(filtered, t) {
    destroyChart("duesGrant");
    const f = getFilters();
    const useYears = f.year === "전체";
    const keys = [...new Set(filtered.map((r) => (useYears ? String(r.year) : r.ym)).filter(Boolean))].sort();
    const dues = [], grants = [];
    for (const k of keys) {
      const sub = filtered.filter((r) => (useYears ? String(r.year) === k : r.ym === k));
      dues.push(sub.filter((r) => r.gwan === "조합비수입").reduce((a, b) => a + b.inc, 0));
      grants.push(sub.filter((r) => r.mok === "지부 교부금").reduce((a, b) => a + b.exp, 0));
    }
    const showDgDefault = () => {
      if (!keys.length) return renderReadout("readout-dues-grant", "", []);
      const last = keys.length - 1;
      renderReadout("readout-dues-grant", `${keys[last]} (최신)`, [
        { label: "조합비", value: `${fmt(dues[last])}원`, color: t.cobalt },
        { label: "교부금", value: `${fmt(grants[last])}원`, color: t.grant },
      ]);
    };
    showDgDefault();

    charts.duesGrant = new Chart(document.getElementById("chart-dues-grant"), {
      type: "bar",
      data: {
        labels: keys,
        datasets: [
          { label: "정기조합비 수입", data: dues, backgroundColor: t.cobalt, borderRadius: 2 },
          { label: "지부 교부금", data: grants, backgroundColor: t.grant, borderRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ...baseScaleOpts(t), grid: { display: false }, ticks: { ...baseScaleOpts(t).ticks, maxRotation: 0 } },
          y: { ...baseScaleOpts(t), beginAtZero: true, ticks: { ...baseScaleOpts(t).ticks, maxTicksLimit: 5, callback: (v) => fmt(v / 10000) + "만" } },
        },
        plugins: {
          ...basePluginOpts(t),
          tooltip: makeExternalTooltip("readout-dues-grant", showDgDefault, (tip) => {
            const idx = tip.dataPoints[0].dataIndex;
            renderReadout("readout-dues-grant", keys[idx], [
              { label: "조합비", value: `${fmt(dues[idx])}원`, color: t.cobalt },
              { label: "교부금", value: `${fmt(grants[idx])}원`, color: t.grant },
            ]);
          }),
        },
      },
    });
  }

  function renderSummaryTable(filtered, totExp) {
    const tbody = document.getElementById("summary-tbody");
    const agg = new Map();
    for (const r of filtered) {
      if (r.gubun !== "지출") continue;
      const key = `${r.gwan}|${r.hang}|${r.mok}`;
      const cur = agg.get(key) || { gwan: r.gwan, hang: r.hang, mok: r.mok, cnt: 0, amt: 0 };
      cur.cnt += 1;
      cur.amt += r.exp;
      agg.set(key, cur);
    }
    const items = [...agg.values()].sort((a, b) => b.amt - a.amt);
    const curYear = getFilters().year;
    tbody.innerHTML = items.map((it) => {
      const href = buildLedgerHref({ year: curYear, gubun: "지출", gwan: it.gwan, q: it.mok });
      return `
      <tr>
        <th scope="row"><a class="row-link" href="${escapeHtml(href)}">${escapeHtml(it.mok)}</a></th>
        <td data-label="대분류">${escapeHtml(it.gwan)}</td>
        <td data-label="중분류">${escapeHtml(it.hang)}</td>
        <td class="ctr" data-label="건수">${it.cnt}</td>
        <td class="num num-exp" data-label="지출액">${fmt(it.amt)}원</td>
        <td class="num" data-label="비중">${(it.amt / totExp * 100).toFixed(1)}%</td>
      </tr>`;
    }).join("");
  }

  function initScrollFadeFallback() {
    if (window.CSS && CSS.supports && CSS.supports("animation-timeline", "scroll()")) return;
    for (const scroller of document.querySelectorAll(".chart-scroll-x")) {
      const start = document.createElement("div");
      const end = document.createElement("div");
      for (const s of [start, end]) {
        s.setAttribute("aria-hidden", "true");
        s.style.cssText = "min-inline-size: 1px; min-block-size: 1px;";
      }
      scroller.prepend(start);
      scroller.append(end);
      const obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          scroller.classList.toggle(e.target === start ? "more-start" : "more-end", !e.isIntersecting);
        }
      }, { root: scroller, rootMargin: "1px" });
      obs.observe(start);
      obs.observe(end);
    }
  }

  function initChartDeck() {
    const track = document.getElementById("chart-deck-track");
    const tabsWrap = document.getElementById("chart-deck-tabs");
    const statusEl = document.getElementById("chart-deck-status");
    if (!track || !tabsWrap) return;

    const slides = [...track.querySelectorAll(".chart-card")];
    const tabs = [...tabsWrap.querySelectorAll(".chart-deck-tab")];
    let pendingIndex = null;
    let settledIndex = 0;
    let rafId = 0;

    function setActiveTab(idx) {
      tabs.forEach((btn, i) => {
        if (i === idx) btn.setAttribute("aria-current", "true");
        else btn.removeAttribute("aria-current");
      });
    }

    function nearestIndex() {
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      slides.forEach((sl, i) => {
        const slCenter = sl.offsetLeft - track.offsetLeft + sl.offsetWidth / 2;
        const d = Math.abs(slCenter - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    }

    function onSettle() {
      pendingIndex = null;
      const idx = nearestIndex();
      setActiveTab(idx);
      if (idx !== settledIndex) {
        settledIndex = idx;
        if (statusEl && tabs[idx]) {
          statusEl.textContent = `${slides.length}개 차트 중 ${idx + 1}번째: ${tabs[idx].textContent}`;
        }
      }
    }

    tabs.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const slide = slides[i];
        if (!slide) return;
        pendingIndex = i;
        setActiveTab(i);
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        track.scrollTo({
          left: slide.offsetLeft - track.offsetLeft,
          behavior: reduce ? "auto" : "smooth",
        });
        btn.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });

    track.addEventListener("scroll", () => {
      if (pendingIndex !== null || rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setActiveTab(nearestIndex());
      });
    }, { passive: true });

    if ("onscrollend" in window) {
      track.addEventListener("scrollend", onSettle);
    } else {
      let timer = 0;
      track.addEventListener("scroll", () => {
        clearTimeout(timer);
        timer = setTimeout(onSettle, 140);
      }, { passive: true });
    }
  }

  function initMonthlyModeAndMinimap() {
    const btnFit = document.getElementById("btn-mode-fit");
    const btnPan = document.getElementById("btn-mode-pan");
    const scroller = document.getElementById("monthly-scroll");
    const viewport = document.getElementById("minimap-viewport");

    const setMode = (nextMode) => {
      if (monthlyMode === nextMode) return;
      monthlyMode = nextMode;
      applyFilters();
    };
    if (btnFit) btnFit.addEventListener("click", () => setMode("fit"));
    if (btnPan) btnPan.addEventListener("click", () => setMode("pan"));

    if (scroller) {
      let scrollRaf = 0;
      scroller.addEventListener("scroll", () => {
        if (scrollRaf || monthlyMode !== "pan") return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          syncMinimapLens();
        });
      }, { passive: true });
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          if (monthlyMode === "pan") syncMinimapLens();
        }).observe(scroller);
      }
    }

    if (viewport && scroller) {
      const jumpToClientX = (clientX) => {
        const rect = viewport.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const targetCenter = ratio * scroller.scrollWidth;
        scroller.scrollLeft = Math.max(0, targetCenter - scroller.clientWidth / 2);
        syncMinimapLens();
      };

      let dragging = false;
      viewport.addEventListener("pointerdown", (e) => {
        dragging = true;
        if (viewport.setPointerCapture) viewport.setPointerCapture(e.pointerId);
        jumpToClientX(e.clientX);
      });
      viewport.addEventListener("pointermove", (e) => {
        if (dragging) jumpToClientX(e.clientX);
      });
      const stopDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        if (viewport.releasePointerCapture && e.pointerId != null) {
          try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };
      viewport.addEventListener("pointerup", stopDrag);
      viewport.addEventListener("pointercancel", stopDrag);

      viewport.addEventListener("keydown", (e) => {
        const step = Math.max(60, scroller.clientWidth * 0.35);
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          scroller.scrollLeft = Math.max(0, scroller.scrollLeft - step);
          syncMinimapLens();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          scroller.scrollLeft = Math.min(scroller.scrollWidth, scroller.scrollLeft + step);
          syncMinimapLens();
        }
      });
    }
  }

  async function init() {
    let payload = window.__PUBLIC_LEDGER__;
    if (!payload) {
      const res = await fetch("data/public_ledger.json");
      payload = await res.json();
    }
    ALL_RECORDS = payload.records || [];
    META = payload.meta || {};
    if (META.syncedAt) {
      document.getElementById("sync-badge").textContent = `기준: ${META.monthsRange[0]} ~ ${META.monthsRange[1]} (${META.totalRecords}건)`;
    }

    const years = [...new Set(ALL_RECORDS.map((r) => r.year).filter(Boolean))].sort((a, b) => b - a);
    const units = [...new Set(ALL_RECORDS.map((r) => r.unit).filter(Boolean))];
    const funds = [...new Set(ALL_RECORDS.map((r) => r.fund).filter(Boolean))];
    const currentYear = String(new Date().getFullYear());
    const defaultYear = years.map(String).includes(currentYear)
      ? currentYear
      : (years.length ? String(years[0]) : "전체");

    const fYear = document.getElementById("f-year");
    fYear.innerHTML = "";
    years.forEach((y) => fYear.add(new Option(`${y}년`, String(y))));
    const allYearLabel = years.length ? `전체 기간 (${years[years.length - 1]}~${years[0]})` : "전체 기간";
    fYear.add(new Option(allYearLabel, "전체"));
    fYear.value = defaultYear;

    const fUnit = document.getElementById("f-unit");
    units.forEach((u) => fUnit.add(new Option(u, u)));
    const fFund = document.getElementById("f-fund");
    funds.forEach((fd) => fFund.add(new Option(fd, fd)));

    [fYear, fUnit, fFund].forEach((el) => el.addEventListener("change", () => {
      drillState = { gwan: null, hang: null };
      applyFilters();
    }));
    document.getElementById("btn-reset").addEventListener("click", () => {
      fYear.value = defaultYear;
      fUnit.value = "전체";
      fFund.value = "전체";
      drillState = { gwan: null, hang: null };
      applyFilters();
    });

    window.addEventListener("themechange", applyFilters);
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyFilters);
    }

    initScrollFadeFallback();
    initChartDeck();
    initMonthlyModeAndMinimap();
    applyFilters();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
