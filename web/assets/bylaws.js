(function () {
  const content = document.getElementById('bylaws-content');
  if (!content) return;

  const form = document.getElementById('bylaws-search-form');
  const input = document.getElementById('bylaws-search-input');
  const clearBtn = document.getElementById('bylaws-search-clear');
  const resetBtn = document.getElementById('bylaws-reset-btn');
  const summaryEl = document.getElementById('bylaws-result-summary');
  const copyStatusEl = document.getElementById('bylaws-copy-status');
  const noResultsEl = document.getElementById('bylaws-no-results');
  const topicChips = Array.from(document.querySelectorAll('[data-topic-filter]'));
  const articles = Array.from(content.querySelectorAll('.bylaw-article'));
  const attachments = Array.from(content.querySelectorAll('.bylaw-attachment-item'));
  const sections = Array.from(content.querySelectorAll('.bylaw-section'));
  const chapters = Array.from(content.querySelectorAll('.bylaw-chapter'));
  const preamble = document.getElementById('preamble');
  const tocDisclosure = document.getElementById('bylaws-toc-disclosure');
  const tocNav = document.getElementById('bylaws-toc-nav');
  const tocLinks = tocNav ? Array.from(tocNav.querySelectorAll('a[href^="#"]')) : [];

  const totalArticles = articles.length;
  const defaultSummary = summaryEl ? summaryEl.textContent : `전체 ${totalArticles}개 조항`;
  let activeTopic = 'all';

  function normalize(str) {
    return String(str || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function clearMarks(root) {
    const marks = root.querySelectorAll('mark.bylaws-mark');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    });
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightElement(el, tokens) {
    if (!tokens.length) return;
    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('.bylaw-anchor-btn') || parent.tagName === 'MARK') {
          return NodeFilter.FILTER_REJECT;
        }
        return pattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const textNodes = [];
    let cur;
    while ((cur = walker.nextNode())) {
      textNodes.push(cur);
    }
    textNodes.forEach((node) => {
      const text = node.nodeValue || '';
      pattern.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'bylaws-mark';
        mark.textContent = m[0];
        frag.appendChild(mark);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      if (node.parentNode) {
        node.parentNode.replaceChild(frag, node);
      }
    });
  }

  function matchesTokens(haystack, tokens) {
    if (!tokens.length) return true;
    const compactHaystack = haystack.replace(/\s+/g, '');
    return tokens.every((tok) => {
      if (haystack.includes(tok)) return true;
      // Allow searching "12조" or "12" to match "제12조"
      if (/^\d+조?$/.test(tok)) {
        const num = tok.replace(/조$/, '');
        return compactHaystack.includes(`제${num}조`);
      }
      return false;
    });
  }

  function applyFilter() {
    const rawQuery = input ? input.value.trim() : '';
    const tokens = rawQuery ? normalize(rawQuery).split(' ').filter(Boolean) : [];
    const isFiltering = Boolean(tokens.length || activeTopic !== 'all');

    if (clearBtn) {
      clearBtn.hidden = !rawQuery;
    }

    clearMarks(content);

    let matchedCount = 0;
    articles.forEach((art) => {
      const topicOk = activeTopic === 'all' || art.dataset.topic === activeTopic;
      const searchText = normalize(art.dataset.search || art.textContent);
      const queryOk = matchesTokens(searchText, tokens);
      const show = topicOk && queryOk;
      art.hidden = !show;
      if (show) {
        matchedCount += 1;
        if (tokens.length) highlightElement(art, tokens);
      }
    });

    // Attachments under addenda
    let matchedAttachments = 0;
    attachments.forEach((att) => {
      const topicOk = activeTopic === 'all' || activeTopic === 'addenda';
      const queryOk = matchesTokens(normalize(att.dataset.search || att.textContent), tokens);
      const show = topicOk && queryOk;
      att.hidden = !show;
      if (show) {
        matchedAttachments += 1;
        if (tokens.length) highlightElement(att, tokens);
      }
    });

    // Preamble visibility
    if (preamble) {
      const topicOk = activeTopic === 'all' || activeTopic === 'general-org';
      const queryOk = !tokens.length || matchesTokens(normalize(preamble.textContent), tokens);
      preamble.hidden = isFiltering && !(topicOk && queryOk);
      if (!preamble.hidden && tokens.length) highlightElement(preamble, tokens);
    }

    // Hide empty sub-sections (절)
    sections.forEach((sec) => {
      const hasVisible = Array.from(sec.querySelectorAll('.bylaw-article')).some((a) => !a.hidden);
      sec.hidden = !hasVisible;
    });

    // Hide empty chapters (장 / 부칙)
    chapters.forEach((ch) => {
      const hasVisibleArt = Array.from(ch.querySelectorAll('.bylaw-article')).some((a) => !a.hidden);
      const hasVisibleAtt = Array.from(ch.querySelectorAll('.bylaw-attachment-item')).some((a) => !a.hidden);
      const attWrap = ch.querySelector('.bylaw-attachments');
      if (attWrap) attWrap.hidden = !hasVisibleAtt;
      ch.hidden = !(hasVisibleArt || hasVisibleAtt);
    });

    const totalShown = matchedCount + (tokens.length ? matchedAttachments : 0);
    if (noResultsEl) {
      noResultsEl.hidden = totalShown > 0 || (preamble && !preamble.hidden && !tokens.length);
    }
    if (summaryEl) {
      if (!isFiltering) {
        summaryEl.textContent = defaultSummary;
      } else {
        const activeChip = topicChips.find((c) => c.dataset.topicFilter === activeTopic);
        const topicName = activeTopic !== 'all' && activeChip ? `[${activeChip.textContent}] ` : '';
        const queryLabel = rawQuery ? `"${rawQuery}" ` : '';
        const attNote = matchedAttachments > 0 && tokens.length ? ` · 별첨 ${matchedAttachments}건` : '';
        summaryEl.textContent = `${topicName}${queryLabel}일치 조항 ${matchedCount}건${attNote}`;
      }
    }
  }

  function resetFilters() {
    if (input) input.value = '';
    activeTopic = 'all';
    topicChips.forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.topicFilter === 'all'));
    });
    applyFilter();
  }

  if (input) {
    input.addEventListener('input', applyFilter);
    // IME-safe Enter handling for Korean search input (Chrome/Firefox/Safari)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.isComposing || event.keyCode === 229) {
          return;
        }
        applyFilter();
        const firstVisible = articles.find((a) => !a.hidden);
        if (firstVisible) {
          firstVisible.scrollIntoView({
            block: 'start',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          });
        }
      }
    });
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      applyFilter();
    });
  }

  if (clearBtn && input) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      applyFilter();
      input.focus();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetFilters();
      if (input) input.focus();
    });
  }

  topicChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      activeTopic = chip.dataset.topicFilter || 'all';
      topicChips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      applyFilter();
    });
  });

  // Copy direct article anchor link
  let copyTimer = 0;
  function announceCopy(msg) {
    if (!copyStatusEl) return;
    copyStatusEl.textContent = '';
    window.requestAnimationFrame(() => {
      copyStatusEl.textContent = msg;
    });
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      if (copyStatusEl) copyStatusEl.textContent = '';
    }, 3200);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    let ok = false;
    try {
      ta.select();
      ok = document.execCommand('copy') === true;
    } catch (_) {
      ok = false;
    } finally {
      ta.remove();
    }
    return ok;
  }

  content.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-copy-anchor]');
    if (!btn) return;
    const hash = btn.getAttribute('data-copy-anchor') || '';
    const base = window.location.href.split('#')[0];
    const url = `${base}${hash}`;
    const art = btn.closest('.bylaw-article');
    const titleEl = art ? art.querySelector('.bylaw-article-title') : null;
    const label = titleEl ? titleEl.textContent.trim() : hash;

    const onDone = (ok) => {
      if (ok) {
        btn.classList.add('is-copied');
        announceCopy(`${label} 링크를 복사했습니다.`);
        window.setTimeout(() => btn.classList.remove('is-copied'), 1600);
      } else {
        announceCopy('링크 복사에 실패했습니다.');
      }
    };

    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => onDone(true), () => onDone(fallbackCopy(url)));
    } else {
      onDone(fallbackCopy(url));
    }
  });

  // Responsive TOC disclosure behavior
  if (tocDisclosure) {
    const desktopMq = window.matchMedia('(min-width: 980px)');
    const syncDisclosure = () => {
      tocDisclosure.open = desktopMq.matches;
    };
    syncDisclosure();
    desktopMq.addEventListener('change', syncDisclosure);

    tocLinks.forEach((link) => {
      link.addEventListener('click', () => {
        if (activeTopic !== 'all' || (input && input.value.trim())) {
          resetFilters();
        }
        if (!desktopMq.matches) {
          tocDisclosure.open = false;
        }
      });
    });
  }

  // Scrollspy: native CSS scroll-target-group + :target-current with IntersectionObserver fallback
  if (tocNav && tocLinks.length > 0) {
    const supportsScrollTargetGroup =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('scroll-target-group: auto');

    if (supportsScrollTargetGroup) {
      const syncAriaCurrent = () => {
        const currentLink = tocNav.querySelector('a:target-current');
        tocLinks.forEach((link) => {
          link.setAttribute('aria-current', link === currentLink ? 'true' : 'false');
        });
      };
      syncAriaCurrent();
      document.addEventListener('scrollend', syncAriaCurrent, { passive: true });
      window.addEventListener('hashchange', syncAriaCurrent);
    } else if ('IntersectionObserver' in window) {
      const targetIds = tocLinks
        .map((l) => (l.getAttribute('href') || '').slice(1))
        .filter(Boolean);
      const targets = targetIds
        .map((id) => document.getElementById(id))
        .filter(Boolean);

      const setActive = (id) => {
        tocLinks.forEach((link) => {
          const isActive = link.getAttribute('href') === `#${id}`;
          link.classList.toggle('target-current', isActive);
          link.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
      };

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (visible) {
            setActive(visible.target.id);
          }
        },
        { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
      );

      targets.forEach((t) => observer.observe(t));
      if (targets[0]) setActive(targets[0].id);
    }
  }
})();
