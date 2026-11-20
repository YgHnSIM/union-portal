(function () {
  const fmt = (n) => (n ? Number(n).toLocaleString("ko-KR") : "");
  const PAGE_SIZE = 30;
  let ALL_RECORDS = [];
  let FILTERED = [];
  let curPage = 1;
  let DEFAULT_YEAR = "전체";
  let DOC_LINKS_BY_TX = new Map();
  let HIGHLIGHT_TX = "";

  const GUBUN_LABELS = {
    "수입": "수입",
    "지출": "지출",
    "내부이전(전출)": "지부 교부·지원(전출)",
    "내부이전(전입)": "지부 회수·환수(전입)",
    "기초이월": "기초이월",
    "이월차액": "이월 잔액 조정",
  };
  const labelGubun = (g) => GUBUN_LABELS[g] || g;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function syncUrlParams(yr, gb, gw, q) {
    if (!window.history || !window.history.replaceState) return;
    const sp = new URLSearchParams();
    if (yr && yr !== DEFAULT_YEAR) sp.set("year", yr);
    if (gb && gb !== "전체") sp.set("gubun", gb);
    if (gw && gw !== "전체") sp.set("gwan", gw);
    if (HIGHLIGHT_TX && q === HIGHLIGHT_TX) sp.set("tx", HIGHLIGHT_TX);
    else if (q) sp.set("q", q);
    const qs = sp.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }

  function applyFilters() {
    const yr = document.getElementById("l-year").value;
    const gb = document.getElementById("l-gubun").value;
    const gw = document.getElementById("l-gwan").value;
    const qRaw = document.getElementById("l-query").value.trim();
    const q = qRaw.toLowerCase();

    syncUrlParams(yr, gb, gw, qRaw);

    FILTERED = ALL_RECORDS.filter((r) => {
      if (yr !== "전체" && String(r.year) !== yr) return false;
      if (gb !== "전체" && r.gubun !== gb) return false;
      if (gw !== "전체" && r.gwan !== gw) return false;
      if (q) {
        const hay = `${r.tx_id} ${r.date} ${r.gwan} ${r.hang} ${r.mok} ${r.exp_type} ${r.target} ${r.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    curPage = 1;
    renderPage();
  }

  function renderPage() {
    const total = FILTERED.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (curPage > totalPages) curPage = totalPages;

    const sumIn = FILTERED.reduce((a, r) => a + r.inc, 0);
    const sumOut = FILTERED.reduce((a, r) => a + r.exp, 0);
    const statsEl = document.getElementById("ledger-stats");
    const countLine = document.createElement("span");
    countLine.textContent = `검색 결과 ${total}건`;
    const sumLine = document.createElement("span");
    sumLine.textContent = `입금합계 ${fmt(sumIn) || 0}원 · 출금합계 ${fmt(sumOut) || 0}원`;
    statsEl.replaceChildren(countLine, sumLine);

    const slice = FILTERED.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
    const tbody = document.getElementById("ledger-tbody");
    tbody.innerHTML = slice.map((r) => {
      const rowClasses = [];
      if (r.gubun === "이월차액") rowClasses.push("muted");
      if (HIGHLIGHT_TX && r.tx_id === HIGHLIGHT_TX) rowClasses.push("is-highlighted");
      const rowCls = rowClasses.length ? ` class="${rowClasses.join(" ")}"` : "";
      const etCls = r.exp_type ? "ctr" : "ctr empty-cell";
      const inCls = r.inc ? "num num-inc" : "num empty-cell";
      const outCls = r.exp ? "num num-exp" : "num empty-cell";
      const noteCls = r.note ? "" : "empty-cell";
      const links = DOC_LINKS_BY_TX.get(r.tx_id) || [];
      const linkBadges = links.length
        ? `<div class="tx-doc-badges">${links
            .map((lk) => {
              const label = lk.docTitle || lk.docId;
              const hint = lk.relationNote ? `${label} — ${lk.relationNote}` : label;
              return `<a class="tx-doc-badge" href="../${escapeHtml(lk.route)}" title="${escapeHtml(hint)}">${escapeHtml(label)}</a>`;
            })
            .join("")}</div>`
        : "";
      return `<tr${rowCls} data-tx="${escapeHtml(r.tx_id)}">
        <th scope="row">${escapeHtml(r.date)} · ${escapeHtml(r.mok)}</th>
        <td class="ctr" data-label="거래번호">${escapeHtml(r.tx_id)}</td>
        <td class="ctr" data-label="단위">${escapeHtml(r.unit)}</td>
        <td class="ctr" data-label="구분">${escapeHtml(labelGubun(r.gubun))}</td>
        <td class="coa-cell" data-label="분류(대·중·세부)"><span class="coa-path"><span class="coa-gwan">${escapeHtml(r.gwan)} <span class="coa-sep">&gt;</span></span> <span class="coa-hang">${escapeHtml(r.hang)} <span class="coa-sep">&gt;</span></span> <b class="coa-mok">${escapeHtml(r.mok)}</b></span></td>
        <td class="${etCls}" data-label="지출방식">${escapeHtml(r.exp_type)}</td>
        <td class="ctr" data-label="대상·귀속">${escapeHtml(r.target)}${r.attr_ym ? " (" + escapeHtml(r.attr_ym) + ")" : ""}</td>
        <td class="${inCls}" data-label="수입금액">${r.inc ? "+" + fmt(r.inc) : ""}</td>
        <td class="${outCls}" data-label="지출금액">${r.exp ? "-" + fmt(r.exp) : ""}</td>
        <td class="${noteCls}" data-label="내용(적요)">${escapeHtml(r.note)}${linkBadges}</td>
      </tr>`;
    }).join("");

    document.getElementById("page-info").textContent = `${curPage} / ${totalPages} 페이지`;
    document.getElementById("btn-prev").disabled = curPage <= 1;
    document.getElementById("btn-next").disabled = curPage >= totalPages;
  }

  function downloadCsv() {
    const header = ["거래번호", "회계단위", "연도", "보고월", "거래일자", "구분", "대분류", "중분류", "세부활동", "지출방식", "자금구분", "대상", "귀속월", "수입금액", "지출금액", "내용"];
    const lines = [header.join(",")];
    for (const r of FILTERED) {
      const vals = [r.tx_id, r.unit, r.year, r.ym, r.date, labelGubun(r.gubun), r.gwan, r.hang, r.mok, r.exp_type, r.fund, r.target, r.attr_ym, r.inc || "", r.exp || "", r.note]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(vals.join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "union_ledger_filtered.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function init() {
    let payload = window.__PUBLIC_LEDGER__;
    if (!payload) {
      const res = await fetch("data/public_ledger.json");
      payload = await res.json();
    }
    ALL_RECORDS = [...(payload.records || [])].reverse();
    DOC_LINKS_BY_TX = new Map();
    if (Array.isArray(window.__PUBLIC_DOC_LINKS__)) {
      for (const lk of window.__PUBLIC_DOC_LINKS__) {
        if (!lk || !lk.txId) continue;
        const arr = DOC_LINKS_BY_TX.get(lk.txId) || [];
        arr.push(lk);
        DOC_LINKS_BY_TX.set(lk.txId, arr);
      }
    }

    const years = [...new Set(ALL_RECORDS.map((r) => r.year).filter(Boolean))].sort((a, b) => b - a);
    const gubuns = [...new Set(ALL_RECORDS.map((r) => r.gubun).filter(Boolean))];
    const gwans = [...new Set(ALL_RECORDS.map((r) => r.gwan).filter(Boolean))];
    const currentYear = String(new Date().getFullYear());
    DEFAULT_YEAR = years.map(String).includes(currentYear)
      ? currentYear
      : (years.length ? String(years[0]) : "전체");

    const lYear = document.getElementById("l-year");
    lYear.innerHTML = "";
    years.forEach((y) => lYear.add(new Option(`${y}년`, String(y))));
    const allYearLabel = years.length ? `전체 기간 (${years[years.length - 1]}~${years[0]})` : "전체 기간";
    lYear.add(new Option(allYearLabel, "전체"));

    const lGubun = document.getElementById("l-gubun");
    gubuns.forEach((g) => lGubun.add(new Option(labelGubun(g), g)));
    const lGwan = document.getElementById("l-gwan");
    gwans.forEach((g) => lGwan.add(new Option(g, g)));
    const lQuery = document.getElementById("l-query");

    // Apply initial URL query parameters (deep-link from dashboard or archive docs) or default to current year
    const sp = new URLSearchParams(window.location.search);
    HIGHLIGHT_TX = sp.get("tx") || "";
    if (sp.has("year") && [...lYear.options].some((o) => o.value === sp.get("year"))) {
      lYear.value = sp.get("year");
    } else if (HIGHLIGHT_TX) {
      lYear.value = "전체";
    } else {
      lYear.value = DEFAULT_YEAR;
    }
    if (sp.get("gubun") && [...lGubun.options].some((o) => o.value === sp.get("gubun"))) {
      lGubun.value = sp.get("gubun");
    }
    if (sp.get("gwan") && [...lGwan.options].some((o) => o.value === sp.get("gwan"))) {
      lGwan.value = sp.get("gwan");
    }
    if (sp.get("q") || sp.get("mok") || HIGHLIGHT_TX) {
      lQuery.value = sp.get("q") || sp.get("mok") || HIGHLIGHT_TX;
    }

    [lYear, lGubun, lGwan].forEach((el) => el.addEventListener("change", applyFilters));
    lQuery.addEventListener("input", () => {
      if (HIGHLIGHT_TX && lQuery.value.trim() !== HIGHLIGHT_TX) {
        HIGHLIGHT_TX = "";
      }
      applyFilters();
    });
    const btnReset = document.getElementById("btn-ledger-reset");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        HIGHLIGHT_TX = "";
        lYear.value = DEFAULT_YEAR;
        lGubun.value = "전체";
        lGwan.value = "전체";
        lQuery.value = "";
        applyFilters();
      });
    }
    document.getElementById("btn-prev").addEventListener("click", () => { if (curPage > 1) { curPage--; renderPage(); } });
    document.getElementById("btn-next").addEventListener("click", () => { curPage++; renderPage(); });
    document.getElementById("btn-csv").addEventListener("click", downloadCsv);

    applyFilters();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
