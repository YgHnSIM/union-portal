(function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildSearchTokens(rawQuery) {
    var q = normalizeText(rawQuery);
    if (!q) return [];
    return q.split(' ').filter(Boolean).map(function (token) {
      var artNumOnly = token.match(/^(\d+)조$/);
      if (artNumOnly) {
        return { raw: token, alt: '제' + artNumOnly[1] + '조' };
      }
      return { raw: token, alt: null };
    });
  }

  function matchesTokens(haystack, tokens) {
    if (!tokens.length) return true;
    for (var i = 0; i < tokens.length; i += 1) {
      var tk = tokens[i];
      if (!haystack.includes(tk.raw) && (!tk.alt || !haystack.includes(tk.alt))) {
        return false;
      }
    }
    return true;
  }

  function bindImeSafeSearch(form, input, clearBtn, onApply) {
    if (!form || !input) return;

    function syncClearBtn() {
      if (clearBtn) {
        clearBtn.hidden = input.value.trim().length === 0;
      }
    }

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.isComposing || event.keyCode === 229) return;
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      syncClearBtn();
      onApply();
    });

    input.addEventListener('input', function () {
      syncClearBtn();
      onApply();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        syncClearBtn();
        onApply();
        input.focus();
      });
    }

    syncClearBtn();
  }

  function initFilterChips(scopeEl, onChange) {
    var chips = Array.prototype.slice.call(
      scopeEl.querySelectorAll('[data-rev-filter]'),
    );
    var active = 'all';

    function setFilter(next) {
      active = next || 'all';
      chips.forEach(function (chip) {
        var isOn = chip.getAttribute('data-rev-filter') === active;
        chip.classList.toggle('active', isOn);
        chip.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      });
      onChange(active);
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        setFilter(chip.getAttribute('data-rev-filter'));
      });
    });

    return {
      get: function () {
        return active;
      },
      reset: function () {
        setFilter('all');
      },
    };
  }

  function initDiffPage(page) {
    var listEl = document.getElementById('rev-diff-list');
    var form = document.getElementById('rev-diff-search-form');
    var input = document.getElementById('rev-diff-search');
    var clearBtn = document.getElementById('rev-diff-search-clear');
    var summary = document.getElementById('rev-diff-summary');
    var noResults = document.getElementById('rev-diff-no-results');
    var resetBtn = document.getElementById('rev-diff-reset');
    if (!listEl) return;

    var rows = Array.prototype.slice.call(
      listEl.querySelectorAll('[data-rev-item="true"]'),
    );
    var groups = Array.prototype.slice.call(
      listEl.querySelectorAll('[data-rev-group="true"]'),
    );
    var totalCount = rows.length;
    var defaultSummary = summary ? summary.textContent : '';

    var filterCtrl = initFilterChips(page, function () {
      apply();
    });

    function apply() {
      var activeFilter = filterCtrl.get();
      var tokens = buildSearchTokens(input ? input.value : '');
      var visibleTotal = 0;

      groups.forEach(function (group) {
        var groupRows = group.querySelectorAll('[data-rev-item="true"]');
        var visibleInGroup = 0;
        Array.prototype.forEach.call(groupRows, function (row) {
          var rowType = row.getAttribute('data-change-type') || '';
          var haystack = row.getAttribute('data-search') || '';
          var typeOk = activeFilter === 'all' || rowType === activeFilter;
          var queryOk = matchesTokens(haystack, tokens);
          var show = typeOk && queryOk;
          row.hidden = !show;
          if (show) visibleInGroup += 1;
        });
        group.hidden = visibleInGroup === 0;
        visibleTotal += visibleInGroup;
      });

      if (noResults) {
        noResults.hidden = visibleTotal > 0;
      }
      if (summary) {
        if (activeFilter === 'all' && tokens.length === 0) {
          summary.textContent = defaultSummary;
        } else {
          summary.textContent =
            '전체 ' + totalCount + '건 중 ' + visibleTotal + '건 표시 중';
        }
      }
    }

    bindImeSafeSearch(form, input, clearBtn, apply);

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (input) input.value = '';
        if (clearBtn) clearBtn.hidden = true;
        filterCtrl.reset();
        apply();
      });
    }
  }

  function initFullPage(page) {
    var contentEl = document.getElementById('rev-full-content');
    var form = document.getElementById('rev-full-search-form');
    var input = document.getElementById('rev-full-search');
    var clearBtn = document.getElementById('rev-full-search-clear');
    var summary = document.getElementById('rev-full-summary');
    var copyStatus = document.getElementById('rev-full-copy-status');
    var noResults = document.getElementById('rev-full-no-results');
    var resetBtn = document.getElementById('rev-full-reset');
    var notesToggle = document.getElementById('rev-notes-toggle');
    if (!contentEl) return;

    var items = Array.prototype.slice.call(
      contentEl.querySelectorAll('[data-rev-item="true"]'),
    );
    var sections = Array.prototype.slice.call(
      contentEl.querySelectorAll('.bylaw-section'),
    );
    var chapters = Array.prototype.slice.call(
      contentEl.querySelectorAll('[data-rev-chapter]'),
    );
    var attachmentsWrap = contentEl.querySelector('.bylaw-attachments');
    var totalCount = items.length;
    var defaultSummary = summary ? summary.textContent : '';

    var filterCtrl = initFilterChips(page, function () {
      apply();
    });

    function apply() {
      var activeFilter = filterCtrl.get();
      var tokens = buildSearchTokens(input ? input.value : '');
      var visibleTotal = 0;

      items.forEach(function (item) {
        var itemType = item.getAttribute('data-change-type') || '';
        var haystack = item.getAttribute('data-search') || '';
        var typeOk = activeFilter === 'all' || itemType === activeFilter;
        var queryOk = matchesTokens(haystack, tokens);
        var show = typeOk && queryOk;
        item.hidden = !show;
        if (show) visibleTotal += 1;
      });

      sections.forEach(function (sec) {
        var secItems = sec.querySelectorAll('[data-rev-item="true"]');
        var hasVisible = Array.prototype.some.call(secItems, function (el) {
          return !el.hidden;
        });
        sec.hidden = !hasVisible;
      });

      if (attachmentsWrap) {
        var attItems = attachmentsWrap.querySelectorAll('[data-rev-item="true"]');
        var hasVisibleAtt = Array.prototype.some.call(attItems, function (el) {
          return !el.hidden;
        });
        attachmentsWrap.hidden = !hasVisibleAtt;
      }

      chapters.forEach(function (ch) {
        var chItems = ch.querySelectorAll('[data-rev-item="true"]');
        var hasVisible = Array.prototype.some.call(chItems, function (el) {
          return !el.hidden;
        });
        ch.hidden = !hasVisible;
      });

      if (noResults) {
        noResults.hidden = visibleTotal > 0;
      }
      if (summary) {
        if (activeFilter === 'all' && tokens.length === 0) {
          summary.textContent = defaultSummary;
        } else {
          summary.textContent =
            '전체 ' + totalCount + '건 중 ' + visibleTotal + '건 표시 중';
        }
      }
    }

    bindImeSafeSearch(form, input, clearBtn, apply);

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (input) input.value = '';
        if (clearBtn) clearBtn.hidden = true;
        filterCtrl.reset();
        apply();
      });
    }

    if (notesToggle) {
      notesToggle.addEventListener('click', function () {
        var hiding = contentEl.classList.toggle('hide-rev-notes');
        notesToggle.setAttribute('aria-pressed', hiding ? 'false' : 'true');
        notesToggle.textContent = hiding
          ? '수정 사유 주석 숨김'
          : '수정 사유 주석 표시 중';
      });
    }

    // Copy article permalink buttons
    contentEl.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var btn = target.closest('[data-rev-copy-id]');
      if (!btn) return;
      var id = btn.getAttribute('data-rev-copy-id') || '';
      var ref = btn.getAttribute('data-rev-copy-ref') || id;
      var url =
        window.location.origin + window.location.pathname + '#' + id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            if (copyStatus) {
              copyStatus.textContent = ref + ' 링크를 복사했습니다.';
            }
          },
          function () {
            if (copyStatus) {
              copyStatus.textContent = ref + ' 주소: #' + id;
            }
          },
        );
      } else if (copyStatus) {
        copyStatus.textContent = ref + ' 주소: #' + id;
      }
    });

    // Responsive TOC disclosure + scrollspy
    var tocDisclosure = document.getElementById('rev-full-toc-disclosure');
    var tocNav = document.getElementById('rev-full-toc-nav');
    if (tocDisclosure && window.matchMedia) {
      var narrowMq = window.matchMedia('(max-width: 979px)');
      tocDisclosure.open = !narrowMq.matches;
      if (narrowMq.addEventListener) {
        narrowMq.addEventListener('change', function (mqEvent) {
          tocDisclosure.open = !mqEvent.matches;
        });
      }
      if (tocNav) {
        tocNav.addEventListener('click', function (event) {
          var target = event.target;
          if (target && target.closest && target.closest('a') && narrowMq.matches) {
            tocDisclosure.open = false;
          }
        });
      }
    }

    if (tocNav) {
      var tocLinks = Array.prototype.slice.call(tocNav.querySelectorAll('a[href^="#"]'));
      var supportsTargetGroup =
        typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('scroll-target-group: auto');

      if (supportsTargetGroup) {
        var syncAriaCurrent = function () {
          var currentLink = tocNav.querySelector('a:target-current');
          tocLinks.forEach(function (link) {
            if (link === currentLink) {
              link.setAttribute('aria-current', 'true');
            } else {
              link.removeAttribute('aria-current');
            }
          });
        };
        syncAriaCurrent();
        document.addEventListener('scrollend', syncAriaCurrent, { passive: true });
      } else if ('IntersectionObserver' in window) {
        var targets = tocLinks
          .map(function (link) {
            var id = (link.getAttribute('href') || '').slice(1);
            return id ? document.getElementById(id) : null;
          })
          .filter(Boolean);

        var io = new IntersectionObserver(
          function (entries) {
            for (var i = 0; i < entries.length; i += 1) {
              if (entries[i].isIntersecting) {
                var activeId = entries[i].target.id;
                tocLinks.forEach(function (link) {
                  var isActive = link.getAttribute('href') === '#' + activeId;
                  link.classList.toggle('target-current', isActive);
                  if (isActive) {
                    link.setAttribute('aria-current', 'true');
                  } else {
                    link.removeAttribute('aria-current');
                  }
                });
                break;
              }
            }
          },
          { rootMargin: '-22% 0px -65% 0px', threshold: 0 },
        );

        targets.forEach(function (el) {
          io.observe(el);
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var diffPage = document.querySelector('.bylaws-revision-diff-page');
    if (diffPage) initDiffPage(diffPage);

    var fullPage = document.querySelector('.bylaws-revision-full-page');
    if (fullPage) initFullPage(fullPage);
  });
})();
