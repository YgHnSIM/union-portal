(function () {
  const deck = document.querySelector('[data-about-deck]');
  if (!deck) return;

  const scenes = Array.from(deck.querySelectorAll('[data-scene-index]'));
  const actTabs = Array.from(deck.querySelectorAll('[data-act-tab]'));
  const sceneTabs = Array.from(deck.querySelectorAll('[data-scene-tab]'));
  const modeButtons = Array.from(deck.querySelectorAll('[data-deck-mode]'));
  const prevButtons = Array.from(deck.querySelectorAll('[data-deck-prev]'));
  const nextButtons = Array.from(deck.querySelectorAll('[data-deck-next]'));
  const replayButtons = Array.from(deck.querySelectorAll('[data-deck-replay]'));
  const pauseButtons = Array.from(deck.querySelectorAll('[data-deck-pause]'));
  const progressTrack = deck.querySelector('.about-deck-progress-track');
  const progressFill = deck.querySelector('.about-deck-progress-fill');
  const posEl = deck.querySelector('[data-deck-position]');
  const theaterShell = deck.querySelector('.about-theater-shell');
  const fullArticle = deck.querySelector('.about-full-article');

  if (scenes.length === 0) return;

  const sceneModels = scenes.map((el, idx) => ({
    el,
    idx,
    slug: el.dataset.sceneSlug || `scene-${idx}`,
    actIndex: Number(el.dataset.actIndex || '0'),
    legacyIds: (el.dataset.legacyIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    canvas: el.querySelector('.about-stage-canvas'),
    stepBtn: sceneTabs[idx] || null,
  }));

  let activeIdx = 0;
  let currentView = deck.dataset.view === 'article' ? 'article' : 'deck';
  let isPaused = deck.dataset.paused === 'true';
  let isTransitioning = false;
  const visited = new Set([0]);

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function parseHashTarget() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return null;

    if (raw === 'full' || raw === 'article' || raw.startsWith('full-')) {
      return { view: 'article', sceneIdx: activeIdx };
    }

    // Match #/<slug> or #/<slug>/<step>
    const slashMatch = raw.match(/^\/([^/]+?)(?:\/(\d+))?\/?$/);
    if (slashMatch) {
      const slug = decodeURIComponent(slashMatch[1]);
      // Direct slug match
      const directIdx = sceneModels.findIndex((m) => m.slug === slug);
      if (directIdx >= 0) {
        return { view: 'deck', sceneIdx: directIdx };
      }
      // Special legacy multi-step mapping for #/equality/2 -> welfare, /3 -> sick-leave, /4 -> allowance-bonus
      if (slug === 'equality') {
        const step = Number(slashMatch[2] || '1');
        if (step === 2) return { view: 'deck', sceneIdx: 5 };
        if (step === 3) return { view: 'deck', sceneIdx: 6 };
        return { view: 'deck', sceneIdx: 4 };
      }
      // Legacy slug match
      const legacyIdx = sceneModels.findIndex((m) => m.legacyIds.includes(slug));
      if (legacyIdx >= 0) {
        return { view: 'deck', sceneIdx: legacyIdx };
      }
    }

    // Legacy ID / anchor match (#sec-4, #conclusion, #scene-why, etc.)
    const legacyMatch = sceneModels.findIndex(
      (m) => `scene-${m.slug}` === raw || m.legacyIds.includes(raw),
    );
    if (legacyMatch >= 0) {
      return { view: 'deck', sceneIdx: legacyMatch };
    }

    const targetEl = document.getElementById(raw);
    if (targetEl) {
      const parentScene = targetEl.closest('[data-scene-index]');
      if (parentScene) {
        return { view: 'deck', sceneIdx: Number(parentScene.dataset.sceneIndex) };
      }
    }

    return null;
  }

  function updateHash(sceneIdx, viewMode) {
    if (viewMode === 'article') {
      if (window.location.hash !== '#full') {
        window.history.replaceState(null, '', '#full');
      }
      return;
    }
    const model = sceneModels[sceneIdx];
    if (!model) return;
    const nextHash = `#/${model.slug}/1`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }

  function syncPauseState() {
    deck.dataset.paused = isPaused ? 'true' : 'false';
    pauseButtons.forEach((btn) => {
      btn.textContent = isPaused ? '재생' : '일시정지';
      btn.setAttribute(
        'title',
        isPaused ? '애니메이션 재생 (Space)' : '애니메이션 일시정지 (Space)',
      );
    });
  }

  function applyDeckDomState() {
    deck.dataset.view = currentView;
    const activeModel = sceneModels[activeIdx];
    const activeAct = activeModel ? activeModel.actIndex : 0;

    modeButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.deckMode === currentView ? 'true' : 'false');
    });

    if (currentView === 'article') {
      if (theaterShell) theaterShell.hidden = true;
      if (fullArticle) fullArticle.hidden = false;
      actTabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', i === activeAct ? 'true' : 'false');
        tab.tabIndex = i === activeAct ? 0 : -1;
      });
      return;
    }

    if (theaterShell) theaterShell.hidden = false;
    if (fullArticle) fullArticle.hidden = true;

    visited.add(activeIdx);
    const total = sceneModels.length;
    const pct = Math.round(((activeIdx + 1) / Math.max(1, total)) * 100);

    if (progressTrack) {
      progressTrack.setAttribute('aria-valuenow', String(activeIdx + 1));
    }
    if (progressFill) {
      progressFill.style.inlineSize = `${pct}%`;
    }
    if (posEl) {
      posEl.textContent = `${activeIdx + 1} / ${total}`;
    }

    actTabs.forEach((tab) => {
      const isAct = Number(tab.dataset.actTab) === activeAct;
      tab.setAttribute('aria-selected', isAct ? 'true' : 'false');
      tab.tabIndex = isAct ? 0 : -1;
    });

    sceneModels.forEach((sm) => {
      const isCurrent = sm.idx === activeIdx;
      if (isCurrent) {
        sm.el.removeAttribute('hidden');
        sm.el.classList.add('is-active');
      } else {
        sm.el.setAttribute('hidden', 'until-found');
        sm.el.classList.remove('is-active');
      }
      if (sm.stepBtn) {
        sm.stepBtn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        sm.stepBtn.tabIndex = isCurrent ? 0 : -1;
        sm.stepBtn.dataset.visited = visited.has(sm.idx) ? 'true' : 'false';
      }
    });

    prevButtons.forEach((btn) => {
      btn.disabled = activeIdx <= 0;
    });
    nextButtons.forEach((btn) => {
      btn.disabled = activeIdx >= total - 1;
    });

    const activeStepBtn = activeModel && activeModel.stepBtn;
    const stepperTrack = deck.querySelector('.about-stepper-track');
    if (activeStepBtn && stepperTrack) {
      const targetLeft =
        activeStepBtn.offsetLeft -
        stepperTrack.clientWidth / 2 +
        activeStepBtn.offsetWidth / 2;
      stepperTrack.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }

  function replayCanvas(sceneIdx) {
    if (prefersReducedMotion()) return;
    const sm = sceneModels[sceneIdx];
    if (!sm || !sm.canvas) return;
    if (isPaused) {
      isPaused = false;
      syncPauseState();
    }
    sm.canvas.classList.remove('is-animating');
    void sm.canvas.offsetWidth;
    sm.canvas.classList.add('is-animating');
  }

  function goToScene(targetIdx, opts) {
    const options = opts || {};
    const clamped = Math.min(Math.max(0, targetIdx), sceneModels.length - 1);
    if (clamped === activeIdx && !options.force && currentView === 'deck') return;

    const direction = clamped >= activeIdx ? 'forward' : 'backward';
    activeIdx = clamped;
    currentView = 'deck';

    if (options.updateUrl !== false) {
      updateHash(activeIdx, 'deck');
    }

    const commit = () => {
      applyDeckDomState();
      replayCanvas(activeIdx);
    };

    if (
      options.animate !== false &&
      !prefersReducedMotion() &&
      typeof document.startViewTransition === 'function' &&
      !isTransitioning
    ) {
      isTransitioning = true;
      try {
        const vt = document.startViewTransition({
          update: commit,
          types: [direction],
        });
        vt.finished.finally(() => {
          isTransitioning = false;
        });
      } catch (_err) {
        isTransitioning = false;
        commit();
      }
    } else {
      commit();
    }
  }

  function setMode(nextMode) {
    if (nextMode !== 'deck' && nextMode !== 'article') return;
    if (currentView === nextMode) return;
    currentView = nextMode;
    updateHash(activeIdx, currentView);
    applyDeckDomState();
    if (currentView === 'deck') {
      replayCanvas(activeIdx);
    }
  }

  // Interactive SVG focus zones (Scene 2 & Scene 9)
  function activateFocusZone(zoneEl) {
    const canvas = zoneEl.closest('.about-stage-canvas');
    if (!canvas) return;
    const idxStr = zoneEl.getAttribute('data-focus-zone') || '0';
    canvas.dataset.focusActive = idxStr;
    canvas.querySelectorAll('[data-focus-zone]').forEach((z) => {
      z.classList.toggle('is-focused', z === zoneEl);
    });
    const captionEl = canvas.querySelector('[data-focus-caption]');
    if (captionEl) {
      try {
        const zones = JSON.parse(captionEl.dataset.zones || '[]');
        const idx = Number(idxStr);
        if (zones[idx]) captionEl.textContent = zones[idx];
      } catch (_err) {
        // keep existing caption
      }
    }
  }

  deck.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const zone = target.closest('[data-focus-zone]');
    if (zone) {
      activateFocusZone(zone);
      return;
    }

    const actBtn = target.closest('[data-act-tab]');
    if (actBtn) {
      const startScene = Number(actBtn.dataset.startScene || '0');
      goToScene(startScene);
      return;
    }

    const stepBtn = target.closest('[data-scene-tab]');
    if (stepBtn) {
      const sceneIdx = Number(stepBtn.dataset.sceneTab || '0');
      goToScene(sceneIdx);
      return;
    }

    const modeBtn = target.closest('[data-deck-mode]');
    if (modeBtn) {
      setMode(modeBtn.dataset.deckMode);
      return;
    }

    if (target.closest('[data-deck-prev]')) {
      goToScene(activeIdx - 1);
      return;
    }

    if (target.closest('[data-deck-next]')) {
      goToScene(activeIdx + 1);
      return;
    }

    if (target.closest('[data-deck-replay]')) {
      replayCanvas(activeIdx);
      return;
    }

    if (target.closest('[data-deck-pause]')) {
      isPaused = !isPaused;
      syncPauseState();
    }
  });

  // Keyboard activation for SVG focus zones
  deck.addEventListener('keydown', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const zone = target.closest('[data-focus-zone]');
    if (zone && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      activateFocusZone(zone);
    }
  });

  // Roving arrow keys on Act tabs and Stepper tabs
  function bindTablistArrows(tabs, onSelect) {
    tabs.forEach((tab, idx) => {
      tab.addEventListener('keydown', (e) => {
        let next = idx;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        tabs[next].focus();
        onSelect(tabs[next], next);
      });
    });
  }

  bindTablistArrows(actTabs, (tab) => {
    goToScene(Number(tab.dataset.startScene || '0'));
  });
  bindTablistArrows(sceneTabs, (_tab, idx) => {
    goToScene(idx);
  });

  // Global keyboard shortcuts in deck mode (←/→, R replay, Space pause/play)
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'deck') return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.matches('input, textarea, select, [contenteditable]') ||
        target.closest('[role="dialog"]'))
    ) {
      return;
    }

    if (e.key === ' ' && target instanceof HTMLElement) {
      if (target.closest('button, a, summary, [role="button"], [role="tab"]')) {
        return;
      }
      e.preventDefault();
      isPaused = !isPaused;
      syncPauseState();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (target instanceof HTMLElement && target.closest('input, textarea')) return;
      e.preventDefault();
      replayCanvas(activeIdx);
      return;
    }

    if (target instanceof HTMLElement && target.closest('[role="tablist"]')) {
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      goToScene(activeIdx + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goToScene(activeIdx - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToScene(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToScene(sceneModels.length - 1);
    }
  });

  // Touch horizontal swipe on stage
  if (theaterShell) {
    let touchStartX = 0;
    let touchStartY = 0;
    theaterShell.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true },
    );
    theaterShell.addEventListener(
      'touchend',
      (e) => {
        if (currentView !== 'deck' || e.changedTouches.length !== 1) return;
        const target = e.target;
        if (target instanceof Element && target.closest('.about-stepper-track')) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) >= 54 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          goToScene(activeIdx + (dx < 0 ? 1 : -1));
        }
      },
      { passive: true },
    );

    // Find-in-Page sync for hidden="until-found" scenes
    theaterShell.addEventListener('beforematch', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const sceneEl = target.closest('[data-scene-index]');
      if (!sceneEl) return;
      const idx = Number(sceneEl.dataset.sceneIndex);
      if (Number.isFinite(idx)) {
        goToScene(idx, { animate: false });
      }
    });
  }

  window.addEventListener('hashchange', () => {
    const parsed = parseHashTarget();
    if (!parsed) return;
    if (parsed.view === 'article') {
      currentView = 'article';
      applyDeckDomState();
      return;
    }
    goToScene(parsed.sceneIdx, {
      animate: true,
      updateUrl: false,
      force: true,
    });
  });

  const initial = parseHashTarget();
  if (initial) {
    currentView = initial.view;
    activeIdx = initial.sceneIdx;
  }
  syncPauseState();
  applyDeckDomState();
  if (currentView === 'deck') {
    replayCanvas(activeIdx);
  }
})();
