// 회계기준·단위: click-to-drill diagram (전체 구조 → 중분류 → 세부활동).
// Progressive enhancement: the server-rendered nested list stays as the no-JS / print fallback.
(function () {
  const root = document.getElementById("coa-map");
  const dataEl = document.getElementById("coa-map-data");
  if (!root || !dataEl) return;
  let data;
  try { data = JSON.parse(dataEl.textContent); } catch (_) { return; }

  const STEP_LABELS = ["전체 구조", "중분류", "세부활동"];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mokCount = (gwan) => gwan.hangs.reduce((n, h) => n + h.moks.length, 0);

  let path = []; // [] | [groupIdx, gwanIdx] | [groupIdx, gwanIdx, hangIdx]
  let returnFocus = null;

  const view = document.createElement("div");
  view.className = "coa-map-view";
  view.innerHTML = `
    <div class="coa-map-bar">
      <button type="button" class="coa-back" data-act="back" hidden><span aria-hidden="true">‹</span> 이전 단계</button>
      <nav class="coa-crumbs" aria-label="다이어그램 위치"><ol></ol></nav>
      <p class="coa-steps"><span class="coa-steps-text"></span><span class="coa-pips" aria-hidden="true"><i></i><i></i><i></i></span></p>
    </div>
    <div class="coa-stage"></div>
    <p class="visually-hidden" aria-live="polite" data-live></p>`;
  const stage = view.querySelector(".coa-stage");
  const crumbs = view.querySelector(".coa-crumbs ol");
  const backBtn = view.querySelector(".coa-back");
  const stepsText = view.querySelector(".coa-steps-text");
  const pips = view.querySelectorAll(".coa-pips i");
  const live = view.querySelector("[data-live]");

  const goAttr = (p) => `data-go="${p.join(",")}"`;

  function nodeBtn(p, title, meta, extraClass = "") {
    return `<button type="button" class="coa-node ${extraClass}" aria-expanded="false" ${goAttr(p)}>
      <span class="coa-node-text"><span class="coa-node-name">${esc(title)}</span><span class="coa-node-meta">${esc(meta)}</span></span>
      <span class="coa-node-chev" aria-hidden="true">›</span></button>`;
  }

  function currentBtn(p, title, meta) {
    // The open node: aria-expanded=true, pressing it folds back one level.
    return `<button type="button" class="coa-node is-current" aria-expanded="true" ${goAttr(p)}>
      <span class="coa-node-text"><span class="coa-node-name">${esc(title)}</span><span class="coa-node-meta">${esc(meta)}</span></span>
      <span class="coa-node-fold">접기</span></button>`;
  }

  function renderOverview() {
    const hq = data.units.filter((u) => u.code === "HQ");
    const br = data.units.filter((u) => u.code !== "HQ");
    const unitCard = (u, cls) => `<li><div class="coa-unit ${cls}${u.active ? "" : " is-closed"}">
        <span class="coa-unit-name">${esc(u.name)}${u.active ? "" : ' <span class="coa-tag">폐지</span>'}</span>
        <span class="coa-unit-full">${esc(u.fullName)}</span>
        <span class="coa-unit-period">${esc(u.period)}</span></div></li>`;
    const units = `
      <div class="coa-block">
        <h4 class="coa-block-head">회계단위 <span>돈을 관리하는 곳</span></h4>
        <ul class="coa-org">${hq.map((u) => unitCard(u, "is-hq")).join("")}</ul>
        <p class="coa-flow"><span aria-hidden="true">↓</span> 정기교부금·특별지원 &nbsp;·&nbsp; <span aria-hidden="true">↑</span> 잔여금 정산</p>
        <ul class="coa-kids coa-kids-units" style="--n:${Math.min(br.length, 3)}">${br.map((u) => unitCard(u, "")).join("")}</ul>
      </div>`;
    const cols = data.groups.map((g, gi) => `
        <div class="coa-col" data-tone="${esc(g.key)}">
          <p class="coa-col-head">${esc(g.label)} <span>대분류 ${g.gwans.length}개</span></p>
          <ul class="coa-rail">${g.gwans.map((w, wi) => `<li>${nodeBtn([gi, wi], w.name, `중분류 ${w.hangs.length} · 세부 ${mokCount(w)}`)}</li>`).join("")}</ul>
        </div>`).join("");
    const cats = `
      <div class="coa-block">
        <h4 class="coa-block-head">수입·지출 분류 <span>돈이 들어오고 나가는 이유</span></h4>
        <div class="coa-cols">${cols}</div>
      </div>`;
    return `<h3 class="coa-stage-title" tabindex="-1"><span class="coa-stage-kicker">전체 구조</span> 대분류를 눌러 한 단계씩 펼쳐 보세요</h3>
      <div class="coa-overview">${units}${cats}</div>`;
  }

  function renderGwan(gi, wi) {
    const g = data.groups[gi], w = g.gwans[wi];
    const kids = w.hangs.map((h, hi) => `<li>${nodeBtn([gi, wi, hi], h.name, `세부활동 ${h.moks.length}개 · ${h.moks.map((m) => m.name).join(", ")}`)}</li>`).join("");
    return `<h3 class="coa-stage-title" tabindex="-1"><span class="coa-stage-kicker">대분류</span> ${esc(w.name)}</h3>
      <div class="coa-drill" data-tone="${esc(g.key)}">
        <div class="coa-focus">${currentBtn([], w.name, `${g.label} · 중분류 ${w.hangs.length} · 세부 ${mokCount(w)}`)}</div>
        <ul class="coa-kids" style="--n:${Math.min(w.hangs.length, 3)}">${kids}</ul>
      </div>`;
  }

  function renderHang(gi, wi, hi) {
    const g = data.groups[gi], w = g.gwans[wi], h = w.hangs[hi];
    const leaves = h.moks.map((m) => {
      const q = new URLSearchParams({ year: "전체", gwan: w.name, q: m.name });
      return `<li><div class="coa-leaf">
          <span class="coa-leaf-name">${esc(m.name)}</span>
          <span class="coa-leaf-desc">${esc(m.desc)}</span>
          <a class="coa-leaf-link" href="ledger.html?${q.toString()}">거래 내역 보기<span class="visually-hidden">: ${esc(m.name)}</span></a>
        </div></li>`;
    }).join("");
    return `<h3 class="coa-stage-title" tabindex="-1"><span class="coa-stage-kicker">중분류</span> ${esc(h.name)}</h3>
      <div class="coa-drill" data-tone="${esc(g.key)}">
        <div class="coa-focus">${currentBtn([gi, wi], h.name, `${w.name} · 세부활동 ${h.moks.length}개`)}</div>
        <ul class="coa-kids coa-leaves" style="--n:${Math.min(h.moks.length, 3)}">${leaves}</ul>
      </div>`;
  }

  function nameAt(p) {
    if (p.length === 0) return STEP_LABELS[0];
    const w = data.groups[p[0]].gwans[p[1]];
    return p.length === 2 ? w.name : w.hangs[p[2]].name;
  }

  // Where the reader was when they opened a node: key = that node's data-go.
  // Restored when they fold back (접기, 이전 단계, breadcrumb, Escape, browser back).
  const saved = new Map();
  const nodeFor = (key) => stage.querySelector(`.coa-node[data-go="${key}"]:not(.is-current)`);

  function render(next, opts = {}) {
    const prev = path;
    if (next.length > prev.length) {
      const key = next.slice(0, prev.length === 0 ? 2 : 3).join(",");
      const el = nodeFor(key);
      saved.set(key, { y: window.scrollY, top: el ? el.getBoundingClientRect().top : null });
    }
    path = next;
    const level = path.length === 0 ? 0 : path.length - 1;
    stage.innerHTML = level === 0 ? renderOverview() : level === 1 ? renderGwan(path[0], path[1]) : renderHang(path[0], path[1], path[2]);
    stage.dataset.level = String(level);

    const trail = [[]];
    if (path.length >= 2) trail.push(path.slice(0, 2));
    if (path.length === 3) trail.push(path.slice(0, 3));
    crumbs.innerHTML = trail.map((p, i) => i === trail.length - 1
      ? `<li><span aria-current="location">${esc(nameAt(p))}</span></li>`
      : `<li><button type="button" class="coa-crumb" ${goAttr(p)}>${esc(nameAt(p))}</button></li>`).join("");
    backBtn.hidden = level === 0;
    stepsText.textContent = `${level + 1} / 3단계 · ${STEP_LABELS[level]}`;
    pips.forEach((pip, i) => pip.classList.toggle("is-on", i <= level));
    if (opts.announce !== false) live.textContent = `${nameAt(path)}, ${level + 1}단계 ${STEP_LABELS[level]}`;

    if (opts.focus === false) return;
    // Going deeper: focus the new heading. Going back: return focus to the node we came from.
    if (next.length < prev.length) {
      const key = prev.slice(0, next.length === 0 ? 2 : 3).join(",");
      const node = nodeFor(key);
      if (node) node.focus({ preventScroll: true });
      restoreScroll(node, saved.get(key));
      return;
    }
    stage.querySelector(".coa-stage-title").focus({ preventScroll: true });
    const top = view.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) view.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function restoreScroll(node, pos) {
    // Measure the settled layout: drop the step-in animation's transform first.
    stage.getAnimations({ subtree: true }).forEach((a) => a.finish());
    if (pos) {
      const y = node && pos.top !== null ? window.scrollY + node.getBoundingClientRect().top - pos.top : pos.y;
      window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
    }
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) node.scrollIntoView({ block: "center", behavior: "instant" });
  }

  function parseGo(v) { return v === "" ? [] : v.split(",").map(Number); }

  function go(next) {
    if (next.join(",") === path.join(",")) return;
    try { history.pushState({ coaMap: next }, ""); } catch (_) {}
    render(next);
  }

  function back() {
    if (path.length === 0) return;
    go(path.length === 3 ? path.slice(0, 2) : []);
  }

  view.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !view.contains(btn)) return;
    if (btn.dataset.act === "back") return back();
    if (btn.hasAttribute("data-go")) go(parseGo(btn.dataset.go));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && path.length) { e.preventDefault(); back(); }
  });
  window.addEventListener("popstate", (e) => {
    // Tab switches (coa-tabs.js) push their own entries; only react to diagram states.
    if (!e.state || !Array.isArray(e.state.coaMap)) return;
    render(e.state.coaMap, { focus: !document.getElementById("panel-diagram")?.hidden });
  });

  // Diagram steps are same-document history entries; we place the scroll ourselves.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const fallback = document.getElementById("coa-map-fallback");
  root.classList.add("is-enhanced");
  root.appendChild(view);
  if (fallback) fallback.classList.add("is-print-only");
  try { history.replaceState(Object.assign({}, history.state, { coaMap: [] }), ""); } catch (_) {}
  render([], { focus: false, announce: false });
})();
