(function () {
  // Conditional Popover polyfill only when native support is missing
  if (!Object.hasOwn(HTMLElement.prototype, "popover")) {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js";
    s.defer = true;
    document.head.appendChild(s);
  }

  // Theme Toggle (System preference "light dark" default, manual override when different from OS)
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  const themeBtn = document.getElementById("theme-toggle");
  const darkMql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function getSystemScheme() {
    return darkMql && darkMql.matches ? "dark" : "light";
  }

  function resolveEffectiveScheme(contentValue) {
    if (contentValue === "dark") return "dark";
    if (contentValue === "light") return "light";
    return getSystemScheme();
  }

  function applyScheme(schemeContent, notify = true) {
    const normalized = schemeContent === "dark" || schemeContent === "light" ? schemeContent : "light dark";
    const effective = resolveEffectiveScheme(normalized);
    if (metaScheme) metaScheme.content = normalized;
    document.documentElement.dataset.theme = effective;
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", String(effective === "dark"));
      themeBtn.setAttribute("aria-label", effective === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
    }
    if (notify) {
      window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: effective, mode: normalized } }));
    }
  }

  if (themeBtn && metaScheme) {
    applyScheme(metaScheme.content, false);

    themeBtn.addEventListener("click", () => {
      const currentEffective = resolveEffectiveScheme(metaScheme.content);
      const next = currentEffective === "dark" ? "light" : "dark";
      const systemScheme = getSystemScheme();
      try {
        if (next === systemScheme) {
          localStorage.removeItem("color-scheme");
          applyScheme("light dark");
        } else {
          localStorage.setItem("color-scheme", next);
          applyScheme(next);
        }
      } catch (_) {
        applyScheme(next === systemScheme ? "light dark" : next);
      }
    });

    window.addEventListener("storage", (e) => {
      if (e.key === "color-scheme") {
        const nextMode = e.newValue === "dark" || e.newValue === "light" ? e.newValue : "light dark";
        applyScheme(nextMode);
      }
    });

    if (darkMql && typeof darkMql.addEventListener === "function") {
      darkMql.addEventListener("change", () => {
        if (metaScheme.content === "light dark") {
          applyScheme("light dark");
        }
      });
    }
  }

  // Responsive Navigation Bar
  const header = document.querySelector(".site-header");
  const inner = header ? header.querySelector(".header-inner") : null;
  const menu = document.getElementById("site-menu");
  if (!header || !inner || !menu) return;

  let lastWidth = inner.clientWidth;

  function updateLayout(forceCheck) {
    const isCurrentlyWide = header.classList.contains("is-wide");
    const curW = inner.clientWidth;
    if (!forceCheck && !isCurrentlyWide && curW <= lastWidth) {
      lastWidth = curW;
      return;
    }
    lastWidth = curW;

    const wasOpen = !isCurrentlyWide && menu.matches(":popover-open");
    header.classList.add("is-measuring", "is-wide");
    menu.removeAttribute("popover");

    const fits = inner.scrollWidth <= inner.clientWidth + 1;
    if (!fits) {
      header.classList.remove("is-wide");
      menu.setAttribute("popover", "auto");
      if (wasOpen && typeof menu.showPopover === "function") {
        try { menu.showPopover(); } catch (_) {}
      }
    }

    requestAnimationFrame(() => {
      header.classList.remove("is-measuring");
    });
  }

  const ro = new ResizeObserver(() => updateLayout(false));
  ro.observe(inner);
  ro.observe(menu);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => updateLayout(true));
  }
  updateLayout(true);
})();
