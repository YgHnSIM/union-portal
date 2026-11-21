(function () {
  'use strict';

  var STORAGE_KEY = 'union_bylaws_deliberation_v1';
  var SESSION_KEY = 'union_bylaws_session_v1';

  var STATUS_LABELS = {
    pending: '검토 대기',
    scheduled: '차기 의제',
    discussing: '논의·보류',
    confirmed_revision: '개정 잠정확정',
    confirmed_current: '현행유지 확정',
  };

  var WAVE_LABELS = {
    unassigned: '차수 미정',
    'wave-1': '1차 상정(차기 대의원대회)',
    'wave-2': '2차 상정(차차기 대의원대회)',
  };

  function escHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch];
    });
  }

  function cloneJson(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function todayIso() {
    var d = new Date();
    var yyyy = String(d.getFullYear());
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildSearchTokens(rawQuery) {
    var q = normalizeText(rawQuery);
    if (!q) return [];
    return q
      .split(' ')
      .filter(Boolean)
      .map(function (token) {
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

  function detectPossiblePii(text) {
    var s = String(text || '');
    if (/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/.test(s)) {
      return '전화번호 패턴이 감지되었습니다. 개인 연락처는 기록할 수 없습니다.';
    }
    if (/\b\d{6}[-\s]?[1-4]\d{6}\b/.test(s)) {
      return '주민등록번호 유사 패턴이 감지되었습니다.';
    }
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) {
      return '이메일 주소는 기록할 수 없습니다.';
    }
    var honorificMatch = s.match(/([가-힣]{2,4})\s?(?:님|씨)(?:\s|$|[,.])/);
    if (
      honorificMatch &&
      !/^(?:위원장|부위원장|사무국장|지부장|감사|조합원|대의원|운영위원|의장|선생)$/.test(
        honorificMatch[1],
      )
    ) {
      return '실명("OOO 님/씨")으로 보이는 표현이 감지되었습니다. 직책·기구명만 입력하세요.';
    }
    return null;
  }

  function renderLinesHtml(lines) {
    return (lines || [])
      .map(function (line) {
        var trimmed = String(line || '').trim();
        var circled = trimmed.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/);
        if (circled) {
          return (
            '<p class="bylaw-para rev-line-para"><span class="bylaw-para-marker">' +
            escHtml(circled[1]) +
            '</span> <span class="bylaw-para-text">' +
            escHtml(circled[2]) +
            '</span></p>'
          );
        }
        var numbered = trimmed.match(/^(\d+\.)\s*(.+)$/);
        if (numbered) {
          return (
            '<p class="bylaw-item-line rev-line-item"><span class="bylaw-item-num">' +
            escHtml(numbered[1]) +
            '</span> <span class="bylaw-item-text">' +
            escHtml(numbered[2]) +
            '</span></p>'
          );
        }
        return (
          '<p class="bylaw-para rev-line-plain"><span class="bylaw-para-text">' +
          escHtml(trimmed) +
          '</span></p>'
        );
      })
      .join('');
  }

  function renderLogsHtml(logs) {
    if (!logs || !logs.length) return '';
    return (
      '<ul class="rev-meeting-log-list">' +
      logs
        .map(function (log, idx) {
          return (
            '<li class="rev-meeting-log-item">' +
            '<div class="rev-log-meta">' +
            '<span class="rev-log-date">' +
            escHtml(log.date) +
            '</span>' +
            '<strong class="rev-log-meeting">' +
            escHtml(log.meetingTitle) +
            '</strong>' +
            '<span class="rev-log-role">' +
            escHtml(log.speakerRole) +
            '</span>' +
            (log.archiveDocId
              ? '<span class="rev-log-doc-badge">공식 회의록 ' +
                escHtml(log.archiveDocId) +
                '</span>'
              : '') +
            '<button type="button" class="rev-log-delete-btn no-print" data-delete-log-index="' +
            idx +
            '" aria-label="회의 기록 삭제">삭제</button>' +
            '</div>' +
            (log.summary
              ? '<p class="rev-log-summary">' + escHtml(log.summary) + '</p>'
              : '') +
            (log.decision
              ? '<p class="rev-log-decision"><strong>결정:</strong> ' +
                escHtml(log.decision) +
                '</p>'
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
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

  function flattenCanonicalItems(doc) {
    var map = Object.create(null);
    var order = [];

    function pushEntry(id, currentRef, revisedRef, reason, currentLines, revisedLines, delib) {
      var d = delib || {
        status: 'pending',
        targetWave: 'unassigned',
        tftPriority: null,
        workingLines: null,
        meetingLogs: [],
        updatedOn: null,
      };
      map[id] = {
        id: id,
        currentRef: currentRef,
        revisedRef: revisedRef,
        reason: reason,
        currentLines: currentLines,
        revisedLines: revisedLines,
        baseDelib: {
          status: d.status || 'pending',
          targetWave: d.targetWave || 'unassigned',
          tftPriority: d.tftPriority || null,
          workingLines: Array.isArray(d.workingLines) ? d.workingLines : null,
          meetingLogs: Array.isArray(d.meetingLogs) ? d.meetingLogs : [],
          updatedOn: d.updatedOn || null,
        },
      };
      order.push(id);
    }

    if (doc.preamble) {
      pushEntry(
        doc.preamble.id,
        doc.preamble.label,
        doc.preamble.label,
        doc.preamble.reason,
        [doc.preamble.currentText],
        [doc.preamble.revisedText],
        doc.preamble.deliberation,
      );
    }
    (doc.chapters || []).forEach(function (ch) {
      (ch.articles || []).forEach(function (art) {
        pushEntry(
          art.id,
          art.currentRef,
          art.revisedRef,
          art.reason,
          art.currentLines,
          art.revisedLines,
          art.deliberation,
        );
      });
      (ch.sections || []).forEach(function (sec) {
        (sec.articles || []).forEach(function (art) {
          pushEntry(
            art.id,
            art.currentRef,
            art.revisedRef,
            art.reason,
            art.currentLines,
            art.revisedLines,
            art.deliberation,
          );
        });
      });
    });
    if (doc.addenda) {
      (doc.addenda.articles || []).forEach(function (art) {
        pushEntry(
          art.id,
          art.currentRef,
          art.revisedRef,
          art.reason,
          art.currentLines,
          art.revisedLines,
          art.deliberation,
        );
      });
      (doc.addenda.attachments || []).forEach(function (att) {
        pushEntry(
          att.id,
          att.currentRef,
          att.revisedRef,
          att.reason,
          [att.currentText],
          [att.revisedText],
          att.deliberation,
        );
      });
    }

    return { map: map, order: order };
  }

  function createDeliberationStore(doc) {
    var flattened = flattenCanonicalItems(doc);
    var overrides = { items: {} };

    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.items && typeof parsed.items === 'object') {
          overrides = parsed;
        }
      }
    } catch (_e) {
      // ignore storage failures
    }

    function persist() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
      } catch (_e) {
        // ignore storage failures
      }
    }

    function getBase(id) {
      return flattened.map[id];
    }

    function getDelib(id) {
      var baseEntry = flattened.map[id];
      var baseDelib = baseEntry ? cloneJson(baseEntry.baseDelib) : {
        status: 'pending',
        targetWave: 'unassigned',
        tftPriority: null,
        workingLines: null,
        meetingLogs: [],
        updatedOn: null,
      };
      var ov = overrides.items[id];
      if (!ov) return baseDelib;
      if (ov.status) baseDelib.status = ov.status;
      if (ov.targetWave) baseDelib.targetWave = ov.targetWave;
      if (Object.prototype.hasOwnProperty.call(ov, 'workingLines')) {
        baseDelib.workingLines = ov.workingLines ? ov.workingLines.slice() : null;
      }
      if (Array.isArray(ov.meetingLogs)) {
        baseDelib.meetingLogs = cloneJson(ov.meetingLogs);
      }
      if (ov.updatedOn) baseDelib.updatedOn = ov.updatedOn;
      return baseDelib;
    }

    function setOverride(id, updater) {
      var current = getDelib(id);
      var next = updater(current);
      next.updatedOn = todayIso();
      overrides.items[id] = {
        status: next.status,
        targetWave: next.targetWave,
        workingLines: next.workingLines,
        meetingLogs: next.meetingLogs,
        updatedOn: next.updatedOn,
      };
      persist();
      return next;
    }

    function clearAll() {
      overrides = { items: {} };
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (_e) {
        // ignore
      }
    }

    function dirtyCount() {
      return Object.keys(overrides.items).length;
    }

    function buildMergedDocument() {
      var merged = cloneJson(doc);
      if (merged.preamble) {
        merged.preamble.deliberation = getDelib(merged.preamble.id);
      }
      (merged.chapters || []).forEach(function (ch) {
        (ch.articles || []).forEach(function (art) {
          art.deliberation = getDelib(art.id);
        });
        (ch.sections || []).forEach(function (sec) {
          (sec.articles || []).forEach(function (art) {
            art.deliberation = getDelib(art.id);
          });
        });
      });
      if (merged.addenda) {
        (merged.addenda.articles || []).forEach(function (art) {
          art.deliberation = getDelib(art.id);
        });
        (merged.addenda.attachments || []).forEach(function (att) {
          att.deliberation = getDelib(att.id);
        });
      }
      return merged;
    }

    return {
      order: flattened.order,
      getBase: getBase,
      getDelib: getDelib,
      setOverride: setOverride,
      clearAll: clearAll,
      dirtyCount: dirtyCount,
      buildMergedDocument: buildMergedDocument,
    };
  }

  function initRevisionSuitePage(page, mode) {
    var dataEl = document.getElementById('bylaws-revision-data');
    var doc = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
    var store = createDeliberationStore(doc);

    var isDiff = mode === 'diff';
    var containerEl = document.getElementById(
      isDiff ? 'rev-diff-list' : 'rev-full-content',
    );
    var form = document.getElementById(
      isDiff ? 'rev-diff-search-form' : 'rev-full-search-form',
    );
    var input = document.getElementById(
      isDiff ? 'rev-diff-search' : 'rev-full-search',
    );
    var clearBtn = document.getElementById(
      isDiff ? 'rev-diff-search-clear' : 'rev-full-search-clear',
    );
    var summaryEl = document.getElementById(
      isDiff ? 'rev-diff-summary' : 'rev-full-summary',
    );
    var noResults = document.getElementById(
      isDiff ? 'rev-diff-no-results' : 'rev-full-no-results',
    );
    var resetBtn = document.getElementById(
      isDiff ? 'rev-diff-reset' : 'rev-full-reset',
    );

    if (!containerEl) return;

    var items = Array.prototype.slice.call(
      containerEl.querySelectorAll('[data-rev-item="true"]'),
    );
    var groups = isDiff
      ? Array.prototype.slice.call(
          containerEl.querySelectorAll('[data-rev-group="true"]'),
        )
      : [];
    var sections = !isDiff
      ? Array.prototype.slice.call(
          containerEl.querySelectorAll('.bylaw-section'),
        )
      : [];
    var chapters = !isDiff
      ? Array.prototype.slice.call(
          containerEl.querySelectorAll('[data-rev-chapter]'),
        )
      : [];
    var attachmentsWrap = !isDiff
      ? containerEl.querySelector('.bylaw-attachments')
      : null;

    var totalCount = items.length;
    var defaultSummary = summaryEl ? summaryEl.textContent : '';

    var state = {
      preset: 'all',
      changeType: 'all',
      delibStatus: 'all',
      priorityOrWave: 'all',
      pinnedEditId: null,
    };

    // Session defaults persistence
    var sessionDateEl = document.getElementById('delib-session-date');
    var sessionTitleEl = document.getElementById('delib-session-title');
    var sessionRoleEl = document.getElementById('delib-session-role');
    var sessionDocEl = document.getElementById('delib-session-doc');
    var studioStatusEl = document.getElementById('delib-studio-status');
    var dirtyPillEl = document.getElementById('delib-dirty-pill');

    function setStudioStatus(msg, isError) {
      if (!studioStatusEl) return;
      studioStatusEl.textContent = msg;
      studioStatusEl.classList.toggle('is-error', Boolean(isError));
    }

    function loadSessionDefaults() {
      if (sessionDateEl && !sessionDateEl.value) sessionDateEl.value = todayIso();
      try {
        var raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return;
        var saved = JSON.parse(raw);
        if (saved.date && sessionDateEl) sessionDateEl.value = saved.date;
        if (saved.title && sessionTitleEl) sessionTitleEl.value = saved.title;
        if (saved.role && sessionRoleEl) sessionRoleEl.value = saved.role;
        if (saved.doc && sessionDocEl) sessionDocEl.value = saved.doc;
      } catch (_e) {
        // ignore
      }
    }

    function saveSessionDefaults() {
      try {
        window.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            date: sessionDateEl ? sessionDateEl.value : todayIso(),
            title: sessionTitleEl ? sessionTitleEl.value : '',
            role: sessionRoleEl ? sessionRoleEl.value : '운영위 합의',
            doc: sessionDocEl ? sessionDocEl.value : '',
          }),
        );
      } catch (_e) {
        // ignore
      }
    }

    [sessionDateEl, sessionTitleEl, sessionRoleEl, sessionDocEl].forEach(function (el) {
      if (el) el.addEventListener('change', saveSessionDefaults);
    });
    loadSessionDefaults();

    function getSessionDefaults() {
      return {
        date: (sessionDateEl && sessionDateEl.value) || todayIso(),
        meetingTitle:
          (sessionTitleEl && sessionTitleEl.value.trim()) ||
          '규약개정 TF · 정기 운영위원회',
        speakerRole: (sessionRoleEl && sessionRoleEl.value) || '운영위 합의',
        archiveDocId: (sessionDocEl && sessionDocEl.value.trim()) || '',
      };
    }

    function buildDynamicSearchText(baseEntry, delib) {
      var logText = (delib.meetingLogs || [])
        .map(function (l) {
          return (
            l.date +
            ' ' +
            l.meetingTitle +
            ' ' +
            l.speakerRole +
            ' ' +
            l.summary +
            ' ' +
            l.decision
          );
        })
        .join(' ');
      return [
        baseEntry.currentRef,
        baseEntry.revisedRef,
        baseEntry.reason,
        (baseEntry.currentLines || []).join(' '),
        (baseEntry.revisedLines || []).join(' '),
        (delib.workingLines || []).join(' '),
        delib.tftPriority || '',
        logText,
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
    }

    function syncItemUi(id) {
      var baseEntry = store.getBase(id);
      if (!baseEntry) return;
      var delib = store.getDelib(id);
      var itemEl = containerEl.querySelector('[data-delib-id="' + id + '"]');
      if (!itemEl) return;

      itemEl.setAttribute('data-delib-status', delib.status);
      itemEl.setAttribute('data-target-wave', delib.targetWave);
      itemEl.setAttribute('data-search', buildDynamicSearchText(baseEntry, delib));

      var statusBadge = itemEl.querySelector('[data-status-badge-for="' + id + '"]');
      if (statusBadge) {
        statusBadge.setAttribute('data-delib-status', delib.status);
        statusBadge.textContent = STATUS_LABELS[delib.status] || delib.status;
      }

      var waveBadge = itemEl.querySelector('[data-wave-badge-for="' + id + '"]');
      if (waveBadge) {
        waveBadge.setAttribute('data-target-wave', delib.targetWave);
        waveBadge.textContent = WAVE_LABELS[delib.targetWave] || delib.targetWave;
        waveBadge.hidden = delib.targetWave === 'unassigned';
      }

      var isKeepCurrent = delib.status === 'confirmed_current';
      var hasCustomWorking =
        !isKeepCurrent &&
        Array.isArray(delib.workingLines) &&
        delib.workingLines.length > 0;
      var activeLines = isKeepCurrent
        ? baseEntry.currentLines
        : hasCustomWorking
          ? delib.workingLines
          : baseEntry.revisedLines;
      var originKind = isKeepCurrent
        ? 'confirmed_current'
        : hasCustomWorking
          ? 'working'
          : 'initial';
      var originText = isKeepCurrent
        ? '현행유지 확정본'
        : hasCustomWorking
          ? '회의 수정 잠정안'
          : '초기 검토 시안';

      var originEl = itemEl.querySelector('[data-origin-for="' + id + '"]');
      if (originEl) {
        originEl.textContent = originText;
        originEl.setAttribute('data-origin-kind', originKind);
      }

      var activeLinesEl = itemEl.querySelector('[data-active-lines-for="' + id + '"]');
      if (activeLinesEl) {
        activeLinesEl.innerHTML = renderLinesHtml(activeLines);
      }

      var initialDetails = itemEl.querySelector('[data-initial-details-for="' + id + '"]');
      if (initialDetails) {
        initialDetails.hidden = !(isKeepCurrent || hasCustomWorking);
      }

      var toggleBtn = itemEl.querySelector('[data-delib-toggle="' + id + '"]');
      if (toggleBtn) {
        toggleBtn.textContent =
          '회의 기록 · 상태 (' + (delib.meetingLogs ? delib.meetingLogs.length : 0) + ')';
      }

      var logsContainer = itemEl.querySelector('[data-meeting-logs-for="' + id + '"]');
      if (logsContainer) {
        var logs = delib.meetingLogs || [];
        logsContainer.hidden = logs.length === 0;
        logsContainer.innerHTML = renderLogsHtml(logs);
      }
    }

    function syncStudioSummaryUi() {
      var counts = {
        pending: 0,
        scheduled: 0,
        discussing: 0,
        confirmed_revision: 0,
        confirmed_current: 0,
      };
      store.order.forEach(function (id) {
        var st = store.getDelib(id).status;
        if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      });
      var total = store.order.length || 1;

      Object.keys(counts).forEach(function (st) {
        var cnt = counts[st];
        Array.prototype.forEach.call(
          page.querySelectorAll('[data-delib-count="' + st + '"]'),
          function (el) {
            el.textContent = cnt + '건';
          },
        );
        Array.prototype.forEach.call(
          page.querySelectorAll('[data-delib-chip-count="' + st + '"]'),
          function (el) {
            el.textContent = String(cnt);
          },
        );
        Array.prototype.forEach.call(
          page.querySelectorAll('[data-delib-seg="' + st + '"]'),
          function (el) {
            el.style.width = ((cnt / total) * 100).toFixed(2) + '%';
          },
        );
        Array.prototype.forEach.call(
          page.querySelectorAll('[data-delib-kpi="' + st + '"]'),
          function (el) {
            el.textContent = String(cnt);
          },
        );
      });

      if (dirtyPillEl) {
        var dirty = store.dirtyCount();
        dirtyPillEl.hidden = dirty === 0;
        dirtyPillEl.textContent = '로컬 변경 ' + dirty + '건';
      }
    }

    function renderEditorInto(id) {
      var editorHost = document.getElementById('delib-editor-' + id);
      var baseEntry = store.getBase(id);
      if (!editorHost || !baseEntry) return;
      var delib = store.getDelib(id);
      var sess = getSessionDefaults();
      var currentDraftLines =
        Array.isArray(delib.workingLines) && delib.workingLines.length
          ? delib.workingLines
          : baseEntry.revisedLines;

      editorHost.innerHTML =
        '<form class="rev-editor-form" data-editor-form="' +
        escHtml(id) +
        '">' +
        '<div class="rev-editor-grid">' +
        '<label><span>심의 상태</span>' +
        '<select data-field="status">' +
        Object.keys(STATUS_LABELS)
          .map(function (st) {
            return (
              '<option value="' +
              st +
              '"' +
              (delib.status === st ? ' selected' : '') +
              '>' +
              escHtml(STATUS_LABELS[st]) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '<label><span>상정 차수</span>' +
        '<select data-field="targetWave">' +
        Object.keys(WAVE_LABELS)
          .map(function (wv) {
            return (
              '<option value="' +
              wv +
              '"' +
              (delib.targetWave === wv ? ' selected' : '') +
              '>' +
              escHtml(WAVE_LABELS[wv]) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>' +
        '<div class="rev-editor-inline-actions">' +
        '<button type="button" class="btn secondary small" data-action="save-meta">상태·차수 저장</button>' +
        '</div>' +
        '</div>' +
        '<div class="rev-editor-draft-box">' +
        '<label><span>회의 반영 잠정안 문구 (줄바꿈으로 항·호 구분)</span>' +
        '<textarea rows="4" data-field="workingText">' +
        escHtml(currentDraftLines.join('\n')) +
        '</textarea></label>' +
        '<div class="rev-editor-inline-actions">' +
        '<button type="button" class="btn secondary small" data-action="save-working">문구 수정 적용</button>' +
        '<button type="button" class="btn secondary small" data-action="reset-working">초기 시안으로 복원</button>' +
        '</div>' +
        '</div>' +
        '<div class="rev-editor-log-box">' +
        '<div class="rev-editor-log-head">이번 회의 논의·결정 기록 추가</div>' +
        '<div class="rev-editor-grid">' +
        '<label><span>일자</span><input type="date" data-field="logDate" value="' +
        escHtml(sess.date) +
        '"></label>' +
        '<label><span>회의명</span><input type="text" data-field="logMeeting" value="' +
        escHtml(sess.meetingTitle) +
        '"></label>' +
        '<label><span>주체(직책·기구)</span><input type="text" data-field="logRole" value="' +
        escHtml(sess.speakerRole) +
        '"></label>' +
        '<label><span>회의록 ID(선택)</span><input type="text" data-field="logDocId" value="' +
        escHtml(sess.archiveDocId) +
        '" placeholder="mom:202612"></label>' +
        '</div>' +
        '<label><span>논의 요지</span><textarea rows="2" data-field="logSummary" placeholder="예: 위원장 외 임원 임기 공백 해소 필요성에 전원 동의"></textarea></label>' +
        '<label><span>결정 사항</span><input type="text" data-field="logDecision" placeholder="예: 개정안 시안대로 1차 대의원대회 상정 확정"></label>' +
        '<p class="rev-editor-error" role="alert" hidden></p>' +
        '<div class="rev-editor-inline-actions">' +
        '<button type="submit" class="btn small">회의 기록 추가</button>' +
        '</div>' +
        '</div>' +
        '</form>';
    }

    function refreshFilterChipsActive() {
      Array.prototype.forEach.call(
        page.querySelectorAll('[data-delib-preset]'),
        function (btn) {
          var on = btn.getAttribute('data-delib-preset') === state.preset;
          btn.classList.toggle('active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        },
      );
      Array.prototype.forEach.call(
        page.querySelectorAll('[data-rev-filter]'),
        function (chip) {
          var on = chip.getAttribute('data-rev-filter') === state.changeType;
          chip.classList.toggle('active', on);
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        },
      );
      Array.prototype.forEach.call(
        page.querySelectorAll('[data-delib-status-filter]'),
        function (chip) {
          var on = chip.getAttribute('data-delib-status-filter') === state.delibStatus;
          chip.classList.toggle('active', on);
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        },
      );
      Array.prototype.forEach.call(
        page.querySelectorAll('[data-delib-priority-filter]'),
        function (chip) {
          var on =
            chip.getAttribute('data-delib-priority-filter') === state.priorityOrWave;
          chip.classList.toggle('active', on);
          chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        },
      );
    }

    function itemMatches(item) {
      if (state.pinnedEditId && item.getAttribute('data-delib-id') === state.pinnedEditId) {
        return true;
      }
      var chg = item.getAttribute('data-change-type') || '';
      var delibStatus = item.getAttribute('data-delib-status') || 'pending';
      var wave = item.getAttribute('data-target-wave') || 'unassigned';
      var prio = item.getAttribute('data-tft-priority') || '';
      var haystack = item.getAttribute('data-search') || '';
      var tokens = buildSearchTokens(input ? input.value : '');

      if (state.preset === 'agenda') {
        if (delibStatus !== 'scheduled' && delibStatus !== 'discussing') {
          return false;
        }
      } else if (state.preset === 'final') {
        if (delibStatus !== 'confirmed_revision') {
          return false;
        }
      }

      if (state.changeType !== 'all' && chg !== state.changeType) {
        return false;
      }

      if (state.delibStatus !== 'all' && delibStatus !== state.delibStatus) {
        return false;
      }

      if (state.priorityOrWave !== 'all') {
        if (state.priorityOrWave.indexOf('wave-') === 0) {
          if (wave !== state.priorityOrWave) return false;
        } else if (prio !== state.priorityOrWave) {
          return false;
        }
      }

      return matchesTokens(haystack, tokens);
    }

    function applyFilters() {
      refreshFilterChipsActive();
      var visibleTotal = 0;

      items.forEach(function (item) {
        var show = itemMatches(item);
        item.hidden = !show;
        if (show) visibleTotal += 1;
      });

      if (isDiff) {
        groups.forEach(function (group) {
          var gItems = group.querySelectorAll('[data-rev-item="true"]');
          var any = Array.prototype.some.call(gItems, function (el) {
            return !el.hidden;
          });
          group.hidden = !any;
        });
      } else {
        sections.forEach(function (sec) {
          var sItems = sec.querySelectorAll('[data-rev-item="true"]');
          var any = Array.prototype.some.call(sItems, function (el) {
            return !el.hidden;
          });
          sec.hidden = !any;
        });
        if (attachmentsWrap) {
          var aItems = attachmentsWrap.querySelectorAll('[data-rev-item="true"]');
          var anyAtt = Array.prototype.some.call(aItems, function (el) {
            return !el.hidden;
          });
          attachmentsWrap.hidden = !anyAtt;
        }
        chapters.forEach(function (ch) {
          var cItems = ch.querySelectorAll('[data-rev-item="true"]');
          var anyCh = Array.prototype.some.call(cItems, function (el) {
            return !el.hidden;
          });
          ch.hidden = !anyCh;
        });
      }

      if (noResults) noResults.hidden = visibleTotal > 0;
      if (summaryEl) {
        var hasTokens = buildSearchTokens(input ? input.value : '').length > 0;
        var isDefault =
          state.preset === 'all' &&
          state.changeType === 'all' &&
          state.delibStatus === 'all' &&
          state.priorityOrWave === 'all' &&
          !hasTokens;
        summaryEl.textContent = isDefault
          ? defaultSummary
          : '전체 ' + totalCount + '건 중 ' + visibleTotal + '건 표시 중';
      }
    }

    // Initial sync with any existing localStorage edits
    store.order.forEach(syncItemUi);
    syncStudioSummaryUi();
    applyFilters();

    // Preset / filter button wiring
    Array.prototype.forEach.call(
      page.querySelectorAll('[data-delib-preset]'),
      function (btn) {
        btn.addEventListener('click', function () {
          state.preset = btn.getAttribute('data-delib-preset') || 'all';
          state.delibStatus = 'all';
          state.pinnedEditId = null;
          applyFilters();
        });
      },
    );

    Array.prototype.forEach.call(
      page.querySelectorAll('[data-rev-filter]'),
      function (chip) {
        chip.addEventListener('click', function () {
          state.changeType = chip.getAttribute('data-rev-filter') || 'all';
          state.pinnedEditId = null;
          applyFilters();
        });
      },
    );

    Array.prototype.forEach.call(
      page.querySelectorAll('[data-delib-status-filter]'),
      function (chip) {
        chip.addEventListener('click', function () {
          state.delibStatus = chip.getAttribute('data-delib-status-filter') || 'all';
          state.preset = 'all';
          state.pinnedEditId = null;
          applyFilters();
        });
      },
    );

    Array.prototype.forEach.call(
      page.querySelectorAll('[data-delib-priority-filter]'),
      function (chip) {
        chip.addEventListener('click', function () {
          state.priorityOrWave =
            chip.getAttribute('data-delib-priority-filter') || 'all';
          state.pinnedEditId = null;
          applyFilters();
        });
      },
    );

    bindImeSafeSearch(form, input, clearBtn, function () {
      state.pinnedEditId = null;
      applyFilters();
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (input) input.value = '';
        if (clearBtn) clearBtn.hidden = true;
        state.preset = 'all';
        state.changeType = 'all';
        state.delibStatus = 'all';
        state.priorityOrWave = 'all';
        state.pinnedEditId = null;
        applyFilters();
      });
    }

    // Editor toggle & actions via event delegation
    containerEl.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      var toggleBtn = target.closest('[data-delib-toggle]');
      if (toggleBtn) {
        var id = toggleBtn.getAttribute('data-delib-toggle');
        var host = id ? document.getElementById('delib-editor-' + id) : null;
        if (!host) return;
        var opening = host.hidden;
        host.hidden = !opening;
        toggleBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) {
          state.pinnedEditId = id;
          renderEditorInto(id);
        } else if (state.pinnedEditId === id) {
          state.pinnedEditId = null;
          applyFilters();
        }
        return;
      }

      var deleteLogBtn = target.closest('[data-delete-log-index]');
      if (deleteLogBtn) {
        var itemWrap = deleteLogBtn.closest('[data-delib-id]');
        var itemId = itemWrap ? itemWrap.getAttribute('data-delib-id') : '';
        var idx = Number(deleteLogBtn.getAttribute('data-delete-log-index'));
        if (!itemId || Number.isNaN(idx)) return;
        store.setOverride(itemId, function (cur) {
          var nextLogs = (cur.meetingLogs || []).slice();
          nextLogs.splice(idx, 1);
          cur.meetingLogs = nextLogs;
          return cur;
        });
        syncItemUi(itemId);
        syncStudioSummaryUi();
        setStudioStatus('회의 기록 1건을 삭제했습니다.', false);
        return;
      }

      var actionBtn = target.closest('[data-action]');
      if (!actionBtn) return;
      var formEl = actionBtn.closest('[data-editor-form]');
      if (!formEl) return;
      var editId = formEl.getAttribute('data-editor-form');
      var action = actionBtn.getAttribute('data-action');
      var errEl = formEl.querySelector('.rev-editor-error');
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }

      if (action === 'save-meta') {
        var stVal = formEl.querySelector('[data-field="status"]').value;
        var wvVal = formEl.querySelector('[data-field="targetWave"]').value;
        state.pinnedEditId = editId;
        store.setOverride(editId, function (cur) {
          cur.status = stVal;
          cur.targetWave = wvVal;
          return cur;
        });
        syncItemUi(editId);
        syncStudioSummaryUi();
        applyFilters();
        setStudioStatus(
          store.getBase(editId).revisedRef +
            ' 심의 상태를 [' +
            STATUS_LABELS[stVal] +
            ']로 저장했습니다.',
          false,
        );
      } else if (action === 'save-working') {
        var rawText = formEl.querySelector('[data-field="workingText"]').value;
        var piiErr = detectPossiblePii(rawText);
        if (piiErr) {
          if (errEl) {
            errEl.textContent = piiErr;
            errEl.hidden = false;
          }
          return;
        }
        var lines = rawText
          .split(/\r?\n/)
          .map(function (l) {
            return l.trim();
          })
          .filter(Boolean);
        var nextStatus = formEl.querySelector('[data-field="status"]').value;
        var nextWave = formEl.querySelector('[data-field="targetWave"]').value;
        state.pinnedEditId = editId;
        store.setOverride(editId, function (cur) {
          cur.workingLines = lines.length ? lines : null;
          cur.status = nextStatus;
          cur.targetWave = nextWave;
          return cur;
        });
        syncItemUi(editId);
        syncStudioSummaryUi();
        applyFilters();
        setStudioStatus(
          store.getBase(editId).revisedRef + ' 회의 반영 잠정안 문구를 적용했습니다.',
          false,
        );
      } else if (action === 'reset-working') {
        var baseLines = store.getBase(editId).revisedLines;
        state.pinnedEditId = editId;
        store.setOverride(editId, function (cur) {
          cur.workingLines = null;
          return cur;
        });
        var ta = formEl.querySelector('[data-field="workingText"]');
        if (ta) ta.value = baseLines.join('\n');
        syncItemUi(editId);
        syncStudioSummaryUi();
        applyFilters();
        setStudioStatus(
          store.getBase(editId).revisedRef + ' 문구를 초기 검토 시안으로 복원했습니다.',
          false,
        );
      }
    });

    containerEl.addEventListener('submit', function (event) {
      var formEl = event.target;
      if (!formEl || !formEl.matches || !formEl.matches('[data-editor-form]')) {
        return;
      }
      event.preventDefault();
      var editId = formEl.getAttribute('data-editor-form');
      var errEl = formEl.querySelector('.rev-editor-error');
      var dateVal = formEl.querySelector('[data-field="logDate"]').value || todayIso();
      var meetingVal =
        formEl.querySelector('[data-field="logMeeting"]').value.trim() ||
        getSessionDefaults().meetingTitle;
      var roleVal =
        formEl.querySelector('[data-field="logRole"]').value.trim() || '운영위 합의';
      var docVal = formEl.querySelector('[data-field="logDocId"]').value.trim();
      var summaryVal = formEl.querySelector('[data-field="logSummary"]').value.trim();
      var decisionVal = formEl
        .querySelector('[data-field="logDecision"]')
        .value.trim();
      var statusVal = formEl.querySelector('[data-field="status"]').value;
      var waveVal = formEl.querySelector('[data-field="targetWave"]').value;

      if (!summaryVal && !decisionVal) {
        if (errEl) {
          errEl.textContent = '논의 요지 또는 결정 사항 중 하나 이상 입력하세요.';
          errEl.hidden = false;
        }
        return;
      }

      var combinedInput = [meetingVal, roleVal, summaryVal, decisionVal].join(' ');
      var piiWarn = detectPossiblePii(combinedInput);
      if (piiWarn) {
        if (errEl) {
          errEl.textContent = piiWarn;
          errEl.hidden = false;
        }
        return;
      }

      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }

      var logId = 'mtg-' + Date.now();
      state.pinnedEditId = editId;
      store.setOverride(editId, function (cur) {
        cur.status = statusVal;
        cur.targetWave = waveVal;
        var logs = (cur.meetingLogs || []).slice();
        logs.push({
          meetingId: logId,
          date: dateVal,
          meetingTitle: meetingVal,
          speakerRole: roleVal,
          summary: summaryVal,
          decision: decisionVal,
          archiveDocId: docVal || null,
        });
        cur.meetingLogs = logs;
        return cur;
      });

      formEl.querySelector('[data-field="logSummary"]').value = '';
      formEl.querySelector('[data-field="logDecision"]').value = '';
      syncItemUi(editId);
      syncStudioSummaryUi();
      applyFilters();
      setStudioStatus(
        store.getBase(editId).revisedRef + ' 회의 기록을 추가했습니다.',
        false,
      );
    });

    // Batch queue & export helpers
    function queuePendingByPriority(allowedSet, label) {
      var changed = 0;
      store.order.forEach(function (id) {
        var delib = store.getDelib(id);
        if (
          delib.status === 'pending' &&
          delib.tftPriority &&
          allowedSet[delib.tftPriority]
        ) {
          store.setOverride(id, function (cur) {
            cur.status = 'scheduled';
            return cur;
          });
          syncItemUi(id);
          changed += 1;
        }
      });
      syncStudioSummaryUi();
      state.preset = 'agenda';
      state.delibStatus = 'all';
      state.pinnedEditId = null;
      applyFilters();
      setStudioStatus(
        label + ' ' + changed + '건을 [차기 의제]로 지정하고 차기 회의 안건지 보기로 전환했습니다.',
        false,
      );
    }

    var queueP1Btn = document.getElementById('delib-queue-p1');
    if (queueP1Btn) {
      queueP1Btn.addEventListener('click', function () {
        queuePendingByPriority({ P1: true }, 'P1 시급 조문');
      });
    }

    var queueP1P2Btn = document.getElementById('delib-queue-p1p2');
    if (queueP1P2Btn) {
      queueP1P2Btn.addEventListener('click', function () {
        queuePendingByPriority({ P1: true, P2: true }, 'P1·P2 우선 조문');
      });
    }

    function downloadTextFile(filename, mime, content) {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    }

    var downloadJsonBtn = document.getElementById('delib-download-json');
    if (downloadJsonBtn) {
      downloadJsonBtn.addEventListener('click', function () {
        var jsonText =
          JSON.stringify(store.buildMergedDocument(), null, 2) + '\n';
        downloadTextFile(
          'bylaws-revision.json',
          'application/json;charset=utf-8',
          jsonText,
        );
        setStudioStatus(
          '정본 반영용 bylaws-revision.json 파일을 다운로드했습니다. (_source/union/bylaws-revision.json 에 덮어써 커밋하세요)',
          false,
        );
      });
    }

    var copyJsonBtn = document.getElementById('delib-copy-json');
    if (copyJsonBtn) {
      copyJsonBtn.addEventListener('click', function () {
        var jsonText =
          JSON.stringify(store.buildMergedDocument(), null, 2) + '\n';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonText).then(
            function () {
              setStudioStatus('전체 정본 bylaws-revision.json 을 클립보드에 복사했습니다.', false);
            },
            function () {
              setStudioStatus('클립보드 복사에 실패했습니다. [정본 JSON 다운로드]를 이용해 주세요.', true);
            },
          );
        }
      });
    }

    var downloadMdBtn = document.getElementById('delib-download-md');
    if (downloadMdBtn) {
      downloadMdBtn.addEventListener('click', function () {
        var visibleIds = items
          .filter(function (el) {
            return !el.hidden;
          })
          .map(function (el) {
            return el.getAttribute('data-delib-id');
          })
          .filter(Boolean);

        var lines = [
          '# 규약 개정 심의 회의자료 (' + todayIso() + ')',
          '',
          '- 대상 건수: ' + visibleIds.length + '건',
          '',
        ];
        visibleIds.forEach(function (id) {
          var base = store.getBase(id);
          var delib = store.getDelib(id);
          if (!base) return;
          var activeLines =
            delib.status === 'confirmed_current'
              ? base.currentLines
              : delib.workingLines && delib.workingLines.length
                ? delib.workingLines
                : base.revisedLines;
          lines.push('## ' + base.revisedRef + ' [' + (STATUS_LABELS[delib.status] || delib.status) + ']');
          if (delib.targetWave && delib.targetWave !== 'unassigned') {
            lines.push('- 상정 차수: ' + (WAVE_LABELS[delib.targetWave] || delib.targetWave));
          }
          lines.push('- 현행: ' + base.currentLines.join(' / '));
          lines.push('- 심의안: ' + activeLines.join(' / '));
          if (delib.meetingLogs && delib.meetingLogs.length) {
            lines.push('- 회의 기록:');
            delib.meetingLogs.forEach(function (l) {
              lines.push(
                '  - [' +
                  l.date +
                  ' ' +
                  l.meetingTitle +
                  ' / ' +
                  l.speakerRole +
                  '] ' +
                  [l.summary, l.decision ? '결정: ' + l.decision : '']
                    .filter(Boolean)
                    .join(' · '),
              );
            });
          }
          lines.push('');
        });
        downloadTextFile(
          'bylaws-deliberation-packet.md',
          'text/markdown;charset=utf-8',
          lines.join('\n'),
        );
        setStudioStatus(
          '현재 화면의 조문 ' + visibleIds.length + '건을 Markdown 회의자료로 다운로드했습니다.',
          false,
        );
      });
    }

    var clearLocalBtn = document.getElementById('delib-clear-local');
    if (clearLocalBtn) {
      clearLocalBtn.addEventListener('click', function () {
        state.pinnedEditId = null;
        store.clearAll();
        store.order.forEach(syncItemUi);
        syncStudioSummaryUi();
        Array.prototype.forEach.call(
          containerEl.querySelectorAll('.rev-delib-editor:not([hidden])'),
          function (host) {
            var hid = host.id.replace('delib-editor-', '');
            if (hid) renderEditorInto(hid);
          },
        );
        applyFilters();
        setStudioStatus('브라우저 임시 변경사항을 모두 초기화하고 Git 정본 상태로 되돌렸습니다.', false);
      });
    }

    // Full-page-only features (notes toggle, copy link, mobile TOC, scrollspy)
    if (!isDiff) {
      var notesToggle = document.getElementById('rev-notes-toggle');
      var copyStatus = document.getElementById('rev-full-copy-status');

      if (notesToggle) {
        notesToggle.addEventListener('click', function () {
          var hiding = containerEl.classList.toggle('hide-rev-notes');
          notesToggle.setAttribute('aria-pressed', hiding ? 'false' : 'true');
          notesToggle.textContent = hiding
            ? '수정 사유 주석 숨김'
            : '수정 사유 주석 표시 중';
        });
      }

      containerEl.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var btn = target.closest('[data-rev-copy-id]');
        if (!btn) return;
        var cid = btn.getAttribute('data-rev-copy-id') || '';
        var cref = btn.getAttribute('data-rev-copy-ref') || cid;
        var url = window.location.origin + window.location.pathname + '#' + cid;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () {
              if (copyStatus) copyStatus.textContent = cref + ' 링크를 복사했습니다.';
            },
            function () {
              if (copyStatus) copyStatus.textContent = cref + ' 주소: #' + cid;
            },
          );
        } else if (copyStatus) {
          copyStatus.textContent = cref + ' 주소: #' + cid;
        }
      });

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
              var tid = (link.getAttribute('href') || '').slice(1);
              return tid ? document.getElementById(tid) : null;
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
  }

  document.addEventListener('DOMContentLoaded', function () {
    var diffPage = document.querySelector('.bylaws-revision-diff-page');
    if (diffPage) initRevisionSuitePage(diffPage, 'diff');

    var fullPage = document.querySelector('.bylaws-revision-full-page');
    if (fullPage) initRevisionSuitePage(fullPage, 'full');
  });
})();
