(function () {
  const list = document.getElementById('law-cmp-list');
  if (!list) return;

  const cards = Array.from(list.querySelectorAll('.law-cmp-card'));
  const sevButtons = Array.from(document.querySelectorAll('[data-severity-filter]'));
  const topicButtons = Array.from(document.querySelectorAll('[data-topic-filter]'));
  const summaryEl = document.getElementById('law-result-summary');
  const noResultsEl = document.getElementById('law-no-results');
  const resetBtn = document.getElementById('law-reset-btn');
  const toggleAllBtn = document.getElementById('law-toggle-all-refs');

  let activeSeverity = 'all';
  let activeTopic = 'all';

  function visibleCards() {
    return cards.filter((card) => !card.hidden);
  }

  function syncToggleAllState() {
    if (!toggleAllBtn) return;
    const detailsList = visibleCards()
      .map((card) => card.querySelector('.law-ref-details'))
      .filter(Boolean);
    const allOpen = detailsList.length > 0 && detailsList.every((d) => d.open);
    toggleAllBtn.setAttribute('aria-expanded', String(allOpen));
  }

  function applyFilters() {
    let shown = 0;
    cards.forEach((card) => {
      const sevOk = activeSeverity === 'all' || card.dataset.severity === activeSeverity;
      const topicOk = activeTopic === 'all' || card.dataset.topic === activeTopic;
      const show = sevOk && topicOk;
      card.hidden = !show;
      if (show) shown += 1;
    });

    if (noResultsEl) {
      noResultsEl.hidden = shown > 0;
    }

    if (summaryEl) {
      if (activeSeverity === 'all' && activeTopic === 'all') {
        summaryEl.textContent = `전체 ${cards.length}건 표시`;
      } else {
        const sevBtn = sevButtons.find((b) => b.dataset.severityFilter === activeSeverity);
        const topicBtn = topicButtons.find((b) => b.dataset.topicFilter === activeTopic);
        const parts = [];
        if (activeSeverity !== 'all' && sevBtn) parts.push(sevBtn.textContent.replace(/\s*\(\d+\)$/, '').trim());
        if (activeTopic !== 'all' && topicBtn) parts.push(topicBtn.textContent.trim());
        summaryEl.textContent = `[${parts.join(' · ')}] 조건 일치 ${shown}건 / 전체 ${cards.length}건`;
      }
    }

    syncToggleAllState();
  }

  sevButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSeverity = btn.dataset.severityFilter || 'all';
      sevButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyFilters();
    });
  });

  topicButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTopic = btn.dataset.topicFilter || 'all';
      topicButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyFilters();
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeSeverity = 'all';
      activeTopic = 'all';
      sevButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.severityFilter === 'all')));
      topicButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.topicFilter === 'all')));
      applyFilters();
    });
  }

  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const expand = toggleAllBtn.getAttribute('aria-expanded') !== 'true';
      visibleCards().forEach((card) => {
        const details = card.querySelector('.law-ref-details');
        if (details) details.open = expand;
      });
      syncToggleAllState();
    });
  }

  // toggle does not bubble, so listen in capture phase to keep Expand/Collapse All button synced
  document.addEventListener(
    'toggle',
    (event) => {
      const target = event.target;
      if (target && target.matches && target.matches('.law-ref-details')) {
        syncToggleAllState();
      }
    },
    { capture: true },
  );
})();
