// 회계기준·단위: 다이어그램 / 표 tabs (ARIA tabs pattern, URL hash, no-JS = both panels stacked).
(function () {
  const mount = document.getElementById("coa-tabs-mount");
  const panels = [...document.querySelectorAll(".coa-panel[data-tab]")];
  if (!mount || panels.length < 2) return;
  const DEFAULT = panels[0].dataset.tab;

  const list = document.createElement("div");
  list.className = "coa-tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "회계기준 보기 방식");
  const tabs = panels.map((panel) => {
    const key = panel.dataset.tab;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "coa-tab";
    tab.id = `tab-${key}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.dataset.tab = key;
    tab.textContent = panel.dataset.tabLabel || key;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = -1;
    list.appendChild(tab);
    return tab;
  });
  mount.appendChild(list);
  document.documentElement.classList.add("coa-tabs-on");

  // Hash → tab: "#table" / "#diagram", or any element id inside a panel (e.g. #sec-units).
  function resolve(hash) {
    const id = decodeURIComponent((hash || "").replace(/^#/, ""));
    if (!id) return { key: DEFAULT, target: null };
    const byKey = panels.find((p) => p.dataset.tab === id);
    if (byKey) return { key: id, target: null };
    const el = document.getElementById(id);
    const owner = el && panels.find((p) => p.contains(el));
    return owner ? { key: owner.dataset.tab, target: el } : { key: DEFAULT, target: null };
  }

  function select(key, opts = {}) {
    tabs.forEach((tab, i) => {
      const on = tab.dataset.tab === key;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (opts.focusTab) tabs.find((t) => t.dataset.tab === key).focus();
  }

  function activate(key, focusTab) {
    const current = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    if (current && current.dataset.tab === key) return;
    select(key, { focusTab });
    const hash = key === DEFAULT ? location.pathname + location.search : `#${key}`;
    try { history.pushState({ coaTab: key }, "", hash); } catch (_) { location.hash = key; }
  }

  list.addEventListener("click", (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) activate(tab.dataset.tab, false);
  });
  list.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    if (n === null) return;
    e.preventDefault();
    activate(tabs[n].dataset.tab, true);
  });

  function fromLocation(scroll) {
    const { key, target } = resolve(location.hash);
    select(key);
    if (scroll && target) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }
  window.addEventListener("popstate", () => fromLocation(false));
  window.addEventListener("hashchange", () => fromLocation(true));
  fromLocation(true);
})();
