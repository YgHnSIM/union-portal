import fs from 'node:fs';
import path from 'node:path';
import {
  type AssetManifest,
  assetHref,
  computePrefixForRoute,
  escapeAttr,
  escapeHtml,
  renderDocumentToolsWidget,
  renderPageShell,
  renderUnionSubnav,
} from './shell.js';

export type BylawsRevisionChangeType =
  | 'substantive'
  | 'renumbered'
  | 'wording'
  | 'unchanged';

export type BylawsDeliberationStatus =
  | 'pending'
  | 'scheduled'
  | 'discussing'
  | 'confirmed_revision'
  | 'confirmed_current';

export type BylawsTargetWave = 'unassigned' | 'wave-1' | 'wave-2';

export type BylawsTftPriority = 'P1' | 'P2' | 'P3' | null;

export interface BylawsArticleMeetingLog {
  meetingId: string;
  date: string;
  meetingTitle: string;
  speakerRole: string;
  summary: string;
  decision: string;
  updatedLines?: string[];
  archiveDocId?: string | null;
}

export interface BylawsArticleDeliberation {
  status: BylawsDeliberationStatus;
  targetWave: BylawsTargetWave;
  tftPriority: BylawsTftPriority;
  workingLines: string[] | null;
  meetingLogs: BylawsArticleMeetingLog[];
  updatedOn: string | null;
}

export interface BylawsRevisionMeta {
  title: string;
  subtitle: string;
  enactedOn: string;
  lastAmendedOn: string;
  draftDate: string;
  lawRefNote: string;
  auditedNote: string;
  changeLabels: Record<BylawsRevisionChangeType, string>;
  deliberationStatusLabels?: Record<BylawsDeliberationStatus, string>;
  targetWaveLabels?: Record<BylawsTargetWave, string>;
}

export interface BylawsRevisionPreamble {
  id: string;
  label: string;
  changeType: BylawsRevisionChangeType;
  reason: string;
  currentText: string;
  revisedText: string;
  currentArtId: string | null;
  lawCmpId: string | null;
  deliberation?: BylawsArticleDeliberation;
}

export interface BylawsRevisionArticle {
  id: string;
  currentRef: string;
  revisedRef: string;
  changeType: BylawsRevisionChangeType;
  reason: string;
  currentLines: string[];
  revisedLines: string[];
  currentArtId: string | null;
  lawCmpId: string | null;
  deliberation?: BylawsArticleDeliberation;
}

export interface BylawsRevisionSection {
  id: string;
  heading: string;
  currentHeading?: string;
  articles: BylawsRevisionArticle[];
}

export interface BylawsRevisionChapter {
  id: string;
  number: number;
  heading: string;
  currentHeading?: string;
  articles?: BylawsRevisionArticle[];
  sections?: BylawsRevisionSection[];
}

export interface BylawsRevisionAttachment {
  id: string;
  currentRef: string;
  revisedRef: string;
  changeType: BylawsRevisionChangeType;
  reason: string;
  currentText: string;
  revisedText: string;
  currentArtId: string | null;
  lawCmpId: string | null;
  deliberation?: BylawsArticleDeliberation;
}

export interface BylawsRevisionAddenda {
  id: string;
  heading: string;
  articles: BylawsRevisionArticle[];
  attachments: BylawsRevisionAttachment[];
}

export interface BylawsRevisionDocument {
  meta: BylawsRevisionMeta;
  preamble: BylawsRevisionPreamble;
  chapters: BylawsRevisionChapter[];
  addenda: BylawsRevisionAddenda;
}

const CHANGE_ORDER: BylawsRevisionChangeType[] = [
  'substantive',
  'renumbered',
  'wording',
  'unchanged',
];

const STATUS_ORDER: BylawsDeliberationStatus[] = [
  'pending',
  'scheduled',
  'discussing',
  'confirmed_revision',
  'confirmed_current',
];

const DEFAULT_CHANGE_LABELS: Record<BylawsRevisionChangeType, string> = {
  substantive: '법령·실질 개정',
  renumbered: '조 번호 재정렬·자구 정비',
  wording: '자구·표기 정비',
  unchanged: '현행 유지',
};

const DEFAULT_STATUS_LABELS: Record<BylawsDeliberationStatus, string> = {
  pending: '검토 대기',
  scheduled: '차기 의제',
  discussing: '논의·보류',
  confirmed_revision: '개정 잠정확정',
  confirmed_current: '현행유지 확정',
};

const DEFAULT_WAVE_LABELS: Record<BylawsTargetWave, string> = {
  unassigned: '차수 미정',
  'wave-1': '1차 상정(차기 대의원대회)',
  'wave-2': '2차 상정(차차기 대의원대회)',
};

export function loadBylawsRevisionDocument(
  projectRoot: string,
): BylawsRevisionDocument | null {
  const filePath = path.join(projectRoot, '_source', 'union', 'bylaws-revision.json');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as BylawsRevisionDocument;
}

export function renderUnlistedBylawsSuiteNav(
  active: 'law' | 'diff' | 'full',
): string {
  const items: Array<{
    key: 'law' | 'diff' | 'full';
    step: string;
    label: string;
    href: string;
  }> = [
    { key: 'law', step: '01', label: '노조법 비교 분석', href: 'bylaws-law.html' },
    { key: 'diff', step: '02', label: '신·구조문대비표', href: 'bylaws-revision-diff.html' },
    { key: 'full', step: '03', label: '개정안 전문 시안', href: 'bylaws-revision-full.html' },
  ];

  return `<nav class="unlisted-suite-nav no-print" aria-label="미등재 규약 개정 검토 모음">
    ${items
      .map((item) => {
        const isCurrent = item.key === active;
        return `<a class="unlisted-suite-link${isCurrent ? ' active' : ''}" href="${escapeAttr(item.href)}"${isCurrent ? ' aria-current="page"' : ''}>
          <span class="unlisted-suite-step">${escapeHtml(item.step)}</span>
          <span class="unlisted-suite-label">${escapeHtml(item.label)}</span>
        </a>`;
      })
      .join('')}
  </nav>`;
}

interface FlattenedRevisionEntry {
  id: string;
  chapterId: string;
  groupHeading: string;
  currentRef: string;
  revisedRef: string;
  changeType: BylawsRevisionChangeType;
  reason: string;
  currentLines: string[];
  revisedLines: string[];
  currentArtId: string | null;
  lawCmpId: string | null;
  deliberation: BylawsArticleDeliberation;
}

function normalizeDeliberation(
  delib?: BylawsArticleDeliberation,
): BylawsArticleDeliberation {
  return {
    status: delib?.status ?? 'pending',
    targetWave: delib?.targetWave ?? 'unassigned',
    tftPriority: delib?.tftPriority ?? null,
    workingLines:
      Array.isArray(delib?.workingLines) && delib.workingLines.length > 0
        ? delib.workingLines
        : null,
    meetingLogs: Array.isArray(delib?.meetingLogs) ? delib.meetingLogs : [],
    updatedOn: delib?.updatedOn ?? null,
  };
}

function collectChapterArticles(ch: BylawsRevisionChapter): BylawsRevisionArticle[] {
  const out: BylawsRevisionArticle[] = [];
  if (ch.articles) out.push(...ch.articles);
  if (ch.sections) {
    for (const sec of ch.sections) out.push(...sec.articles);
  }
  return out;
}

function flattenRevisionEntries(doc: BylawsRevisionDocument): FlattenedRevisionEntry[] {
  const entries: FlattenedRevisionEntry[] = [
    {
      id: doc.preamble.id,
      chapterId: 'preamble',
      groupHeading: doc.preamble.label,
      currentRef: doc.preamble.label,
      revisedRef: doc.preamble.label,
      changeType: doc.preamble.changeType,
      reason: doc.preamble.reason,
      currentLines: [doc.preamble.currentText],
      revisedLines: [doc.preamble.revisedText],
      currentArtId: doc.preamble.currentArtId,
      lawCmpId: doc.preamble.lawCmpId,
      deliberation: normalizeDeliberation(doc.preamble.deliberation),
    },
  ];

  for (const ch of doc.chapters) {
    for (const art of collectChapterArticles(ch)) {
      entries.push({
        id: art.id,
        chapterId: ch.id,
        groupHeading: ch.heading,
        currentRef: art.currentRef,
        revisedRef: art.revisedRef,
        changeType: art.changeType,
        reason: art.reason,
        currentLines: art.currentLines,
        revisedLines: art.revisedLines,
        currentArtId: art.currentArtId,
        lawCmpId: art.lawCmpId,
        deliberation: normalizeDeliberation(art.deliberation),
      });
    }
  }

  for (const art of doc.addenda.articles) {
    entries.push({
      id: art.id,
      chapterId: doc.addenda.id,
      groupHeading: doc.addenda.heading,
      currentRef: art.currentRef,
      revisedRef: art.revisedRef,
      changeType: art.changeType,
      reason: art.reason,
      currentLines: art.currentLines,
      revisedLines: art.revisedLines,
      currentArtId: art.currentArtId,
      lawCmpId: art.lawCmpId,
      deliberation: normalizeDeliberation(art.deliberation),
    });
  }

  for (const att of doc.addenda.attachments) {
    entries.push({
      id: att.id,
      chapterId: doc.addenda.id,
      groupHeading: doc.addenda.heading,
      currentRef: att.currentRef,
      revisedRef: att.revisedRef,
      changeType: att.changeType,
      reason: att.reason,
      currentLines: [att.currentText],
      revisedLines: [att.revisedText],
      currentArtId: att.currentArtId,
      lawCmpId: att.lawCmpId,
      deliberation: normalizeDeliberation(att.deliberation),
    });
  }

  return entries;
}

function countByChangeType(
  entries: FlattenedRevisionEntry[],
): Record<BylawsRevisionChangeType, number> {
  const counts: Record<BylawsRevisionChangeType, number> = {
    substantive: 0,
    renumbered: 0,
    wording: 0,
    unchanged: 0,
  };
  for (const item of entries) {
    counts[item.changeType] += 1;
  }
  return counts;
}

function countByDelibStatus(
  entries: FlattenedRevisionEntry[],
): Record<BylawsDeliberationStatus, number> {
  const counts: Record<BylawsDeliberationStatus, number> = {
    pending: 0,
    scheduled: 0,
    discussing: 0,
    confirmed_revision: 0,
    confirmed_current: 0,
  };
  for (const item of entries) {
    counts[item.deliberation.status] += 1;
  }
  return counts;
}

function countByPriority(entries: FlattenedRevisionEntry[]): {
  P1: number;
  P2: number;
  P3: number;
} {
  const out = { P1: 0, P2: 0, P3: 0 };
  for (const item of entries) {
    const p = item.deliberation.tftPriority;
    if (p) out[p] += 1;
  }
  return out;
}

function changeLabel(
  meta: BylawsRevisionMeta,
  changeType: BylawsRevisionChangeType,
): string {
  return meta.changeLabels?.[changeType] ?? DEFAULT_CHANGE_LABELS[changeType];
}

function statusLabel(
  meta: BylawsRevisionMeta,
  status: BylawsDeliberationStatus,
): string {
  return meta.deliberationStatusLabels?.[status] ?? DEFAULT_STATUS_LABELS[status];
}

function waveLabel(meta: BylawsRevisionMeta, wave: BylawsTargetWave): string {
  return meta.targetWaveLabels?.[wave] ?? DEFAULT_WAVE_LABELS[wave];
}

function splitArticleHeading(ref: string): { num: string; title: string } {
  const m = ref.match(/^(제\d+조|부칙\s*제\d+조)\(([^)]+)\)$/);
  if (m) return { num: m[1]!, title: m[2]! };
  return { num: ref, title: '' };
}

function renderLinesHtml(lines: string[]): string {
  return lines
    .map((line) => {
      const trimmed = line.trim();
      const circled = trimmed.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/);
      if (circled) {
        return `<p class="bylaw-para rev-line-para"><span class="bylaw-para-marker">${escapeHtml(circled[1]!)}</span> <span class="bylaw-para-text">${escapeHtml(circled[2]!)}</span></p>`;
      }
      const numbered = trimmed.match(/^(\d+\.)\s*(.+)$/);
      if (numbered) {
        return `<p class="bylaw-item-line rev-line-item"><span class="bylaw-item-num">${escapeHtml(numbered[1]!)}</span> <span class="bylaw-item-text">${escapeHtml(numbered[2]!)}</span></p>`;
      }
      return `<p class="bylaw-para rev-line-plain"><span class="bylaw-para-text">${escapeHtml(trimmed)}</span></p>`;
    })
    .join('');
}

function renderDraftContentHtml(entry: FlattenedRevisionEntry): string {
  const delib = entry.deliberation;
  const isKeepCurrent = delib.status === 'confirmed_current';
  const hasCustomWorking =
    !isKeepCurrent &&
    Array.isArray(delib.workingLines) &&
    delib.workingLines.length > 0;
  const activeLines = isKeepCurrent
    ? entry.currentLines
    : hasCustomWorking
      ? delib.workingLines!
      : entry.revisedLines;
  const originKind = isKeepCurrent
    ? 'confirmed_current'
    : hasCustomWorking
      ? 'working'
      : 'initial';
  const originText = isKeepCurrent
    ? '현행유지 확정본'
    : hasCustomWorking
      ? '회의 수정 잠정안'
      : '초기 검토 시안';
  const showInitialDetails = isKeepCurrent || hasCustomWorking;

  return `<div class="rev-draft-origin" data-origin-for="${escapeAttr(entry.id)}" data-origin-kind="${escapeAttr(originKind)}">${escapeHtml(originText)}</div>
    <div class="rev-active-lines" data-active-lines-for="${escapeAttr(entry.id)}">${renderLinesHtml(activeLines)}</div>
    <details class="rev-initial-draft-details" data-initial-details-for="${escapeAttr(entry.id)}"${showInitialDetails ? '' : ' hidden'}>
      <summary class="rev-initial-draft-summary">초기 검토 시안(기준안) 원문 대조</summary>
      <div class="rev-initial-draft-body">${renderLinesHtml(entry.revisedLines)}</div>
    </details>`;
}

function renderDelibBadgesHtml(
  meta: BylawsRevisionMeta,
  entry: FlattenedRevisionEntry,
): string {
  const delib = entry.deliberation;
  const waveHidden = delib.targetWave === 'unassigned';
  return `<span class="rev-status-badge" data-delib-status="${escapeAttr(delib.status)}" data-status-badge-for="${escapeAttr(entry.id)}">${escapeHtml(statusLabel(meta, delib.status))}</span>
    <span class="rev-priority-badge"${delib.tftPriority ? ` data-priority="${escapeAttr(delib.tftPriority)}"` : ' hidden'}>${delib.tftPriority ? `${escapeHtml(delib.tftPriority)} 우선검토` : ''}</span>
    <span class="rev-wave-badge" data-wave-badge-for="${escapeAttr(entry.id)}" data-target-wave="${escapeAttr(delib.targetWave)}"${waveHidden ? ' hidden' : ''}>${escapeHtml(waveLabel(meta, delib.targetWave))}</span>`;
}

function renderMeetingLogsListHtml(logs: BylawsArticleMeetingLog[]): string {
  if (!logs.length) return '';
  return `<ul class="rev-meeting-log-list">${logs
    .map(
      (log) => `<li class="rev-meeting-log-item">
        <div class="rev-log-meta">
          <span class="rev-log-date">${escapeHtml(log.date)}</span>
          <strong class="rev-log-meeting">${escapeHtml(log.meetingTitle)}</strong>
          <span class="rev-log-role">${escapeHtml(log.speakerRole)}</span>
          ${log.archiveDocId ? `<span class="rev-log-doc-badge">공식 회의록 ${escapeHtml(log.archiveDocId)}</span>` : ''}
        </div>
        ${log.summary ? `<p class="rev-log-summary">${escapeHtml(log.summary)}</p>` : ''}
        ${log.decision ? `<p class="rev-log-decision"><strong>결정:</strong> ${escapeHtml(log.decision)}</p>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}

function renderDelibPanelHtml(entry: FlattenedRevisionEntry): string {
  const delib = entry.deliberation;
  return `<div class="rev-delib-panel" data-delib-panel-for="${escapeAttr(entry.id)}">
    <div class="rev-meeting-logs" data-meeting-logs-for="${escapeAttr(entry.id)}"${delib.meetingLogs.length === 0 ? ' hidden' : ''}>
      ${renderMeetingLogsListHtml(delib.meetingLogs)}
    </div>
    <div class="rev-delib-editor no-print" id="${escapeAttr(`delib-editor-${entry.id}`)}" hidden></div>
  </div>`;
}

function renderCrossLinksHtml(
  opts: {
    id: string;
    currentArtId: string | null;
    lawCmpId: string | null;
  },
  mode: 'diff' | 'full',
): string {
  const chips: string[] = [];
  if (mode === 'diff') {
    chips.push(
      `<a class="rev-cross-chip is-primary" href="${escapeAttr(`bylaws-revision-full.html#${opts.id}`)}" title="개정안 전문 해당 조항으로 이동">개정안 전문 →</a>`,
    );
  } else {
    chips.push(
      `<a class="rev-cross-chip is-primary" href="${escapeAttr(`bylaws-revision-diff.html#diff-${opts.id}`)}" title="신·구조문대비표 해당 조항으로 이동">대비표 ↔</a>`,
    );
  }
  if (opts.currentArtId) {
    chips.push(
      `<a class="rev-cross-chip" href="${escapeAttr(`bylaws.html#${opts.currentArtId}`)}" title="공개 현행 규약 해당 조항으로 이동">현행 원문 ↗</a>`,
    );
  }
  if (opts.lawCmpId) {
    chips.push(
      `<a class="rev-cross-chip is-law" href="${escapeAttr(`bylaws-law.html#${opts.lawCmpId}`)}" title="관련 노조법 비교 분석 카드로 이동">노조법 분석 ⚖</a>`,
    );
  }
  return `<div class="rev-cross-links no-print">${chips.join('')}</div>`;
}

function buildSearchText(entry: FlattenedRevisionEntry): string {
  const delib = entry.deliberation;
  const logText = delib.meetingLogs
    .map((l) => `${l.date} ${l.meetingTitle} ${l.speakerRole} ${l.summary} ${l.decision}`)
    .join(' ');
  return [
    entry.currentRef,
    entry.revisedRef,
    entry.reason,
    entry.currentLines.join(' '),
    entry.revisedLines.join(' '),
    (delib.workingLines ?? []).join(' '),
    delib.tftPriority ?? '',
    logText,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function renderUnlistedBanner(
  badgeText: string,
  description: string,
): string {
  return `<div class="bylaws-unlisted-banner no-print" role="note" aria-label="미등재 규약 검토 문서 안내">
    <div>
      <span class="doc-cat-badge">${escapeHtml(badgeText)}</span>
      <p>${description}</p>
    </div>
    <a class="btn secondary small" href="bylaws.html">현행 규약 원문 →</a>
  </div>`;
}

function renderFilterChipsHtml(
  meta: BylawsRevisionMeta,
  total: number,
  counts: Record<BylawsRevisionChangeType, number>,
): string {
  return `<div class="bylaws-topic-bar" role="group" aria-label="개정 유형 빠른 필터">
    <button type="button" class="bylaws-topic-chip active" data-rev-filter="all" aria-pressed="true">유형 전체 (${total})</button>
    ${CHANGE_ORDER.map(
      (key) =>
        `<button type="button" class="bylaws-topic-chip" data-rev-filter="${escapeAttr(key)}" aria-pressed="false">${escapeHtml(changeLabel(meta, key))} (${counts[key]})</button>`,
    ).join('')}
  </div>`;
}

function renderDeliberationStudioHtml(
  doc: BylawsRevisionDocument,
  entries: FlattenedRevisionEntry[],
): string {
  const total = entries.length || 1;
  const statusCounts = countByDelibStatus(entries);
  const prioCounts = countByPriority(entries);

  const progressSegs = STATUS_ORDER.map((st) => {
    const pct = ((statusCounts[st] / total) * 100).toFixed(2);
    return `<div class="delib-progress-seg" data-delib-seg="${escapeAttr(st)}" style="width:${pct}%"></div>`;
  }).join('');

  const statusCountersHtml = STATUS_ORDER.map(
    (st) => `<div class="delib-count-pill" data-delib-status="${escapeAttr(st)}">
      <span>${escapeHtml(statusLabel(doc.meta, st))}</span>
      <strong data-delib-count="${escapeAttr(st)}">${statusCounts[st]}건</strong>
    </div>`,
  ).join('');

  const statusChipsHtml = [
    `<button type="button" class="bylaws-topic-chip active" data-delib-status-filter="all" aria-pressed="true">상태 전체 (${entries.length})</button>`,
    ...STATUS_ORDER.map(
      (st) =>
        `<button type="button" class="bylaws-topic-chip" data-delib-status-filter="${escapeAttr(st)}" aria-pressed="false">${escapeHtml(statusLabel(doc.meta, st))} (<span data-delib-chip-count="${escapeAttr(st)}">${statusCounts[st]}</span>)</button>`,
    ),
  ].join('');

  const priorityChipsHtml = `
    <button type="button" class="bylaws-topic-chip active" data-delib-priority-filter="all" aria-pressed="true">우선·차수 전체</button>
    <button type="button" class="bylaws-topic-chip" data-delib-priority-filter="P1" aria-pressed="false">P1 시급 (${prioCounts.P1})</button>
    <button type="button" class="bylaws-topic-chip" data-delib-priority-filter="P2" aria-pressed="false">P2 권고 (${prioCounts.P2})</button>
    <button type="button" class="bylaws-topic-chip" data-delib-priority-filter="P3" aria-pressed="false">P3 유의 (${prioCounts.P3})</button>
    <button type="button" class="bylaws-topic-chip" data-delib-priority-filter="wave-1" aria-pressed="false">1차 상정</button>
    <button type="button" class="bylaws-topic-chip" data-delib-priority-filter="wave-2" aria-pressed="false">2차 상정</button>
  `;

  return `<section class="delib-studio no-print" aria-label="다회차 규약 심의 현황판 및 회의 기록 도우미">
    <div class="delib-studio-head">
      <div>
        <h2>다회차 TF·운영위원회 규약 심의 현황</h2>
        <p class="delib-studio-sub">시안 66건을 여러 차례 정기 운영위·TF 회의에서 의제로 나눠 심의·수정하고 잠정확정분을 모아 최종 상정합니다.</p>
      </div>
      <div class="delib-preset-bar" role="group" aria-label="회의 목적별 보기 프리셋">
        <button type="button" class="btn secondary small active" data-delib-preset="all" aria-pressed="true">전체 심의 현황</button>
        <button type="button" class="btn secondary small" data-delib-preset="agenda" aria-pressed="false">차기 회의 안건지</button>
        <button type="button" class="btn secondary small" data-delib-preset="final" aria-pressed="false">최종 의결·대의원대회 발표안</button>
      </div>
    </div>

    <div class="delib-progress-track" aria-label="조문별 심의 진행률">
      <div class="delib-progress-bar">${progressSegs}</div>
      <div class="delib-counts-row">${statusCountersHtml}</div>
    </div>

    <div class="delib-filter-rows">
      <div class="bylaws-topic-bar" role="group" aria-label="조문별 심의 상태 필터">${statusChipsHtml}</div>
      <div class="bylaws-topic-bar" role="group" aria-label="TF 우선순위 및 상정 차수 필터">${priorityChipsHtml}</div>
    </div>

    <details class="delib-session-drawer" id="delib-session-drawer">
      <summary class="delib-session-summary">
        <span>회의 기록 · 의제 관리 및 정본 JSON/회의자료 내보내기</span>
        <span class="delib-dirty-pill" id="delib-dirty-pill" hidden>로컬 변경 0건</span>
      </summary>
      <div class="delib-session-body">
        <div class="delib-session-grid">
          <label>
            <span>회의 일자</span>
            <input type="date" id="delib-session-date" value="2026-11-22">
          </label>
          <label>
            <span>회의명</span>
            <input type="text" id="delib-session-title" placeholder="예: 2026-12 정기 운영위원회 / 규약개정 TF 1차">
          </label>
          <label>
            <span>발언·결의 주체 (직책·기구만 기재)</span>
            <select id="delib-session-role">
              <option value="운영위 합의">운영위 합의</option>
              <option value="규약개정 TF">규약개정 TF</option>
              <option value="위원장">위원장</option>
              <option value="수석부위원장">수석부위원장</option>
              <option value="부위원장">부위원장</option>
              <option value="사무국장">사무국장</option>
              <option value="회계감사대표위원">회계감사대표위원</option>
              <option value="안양지부장">안양지부장</option>
              <option value="부평지부장">부평지부장</option>
            </select>
          </label>
          <label>
            <span>공식 회의록 ID (선택)</span>
            <input type="text" id="delib-session-doc" placeholder="예: mom:202612">
          </label>
        </div>
        <div class="delib-actions-row">
          <button type="button" class="btn secondary small" id="delib-queue-p1">P1 시급 조문(${prioCounts.P1}건) 차기 의제로 담기</button>
          <button type="button" class="btn secondary small" id="delib-queue-p1p2">P1·P2 조문(${prioCounts.P1 + prioCounts.P2}건) 차기 의제로 담기</button>
          <button type="button" class="btn small" id="delib-download-json">정본 JSON 다운로드 (bylaws-revision.json)</button>
          <button type="button" class="btn secondary small" id="delib-copy-json">정본 JSON 복사</button>
          <button type="button" class="btn secondary small" id="delib-download-md">현재 필터 조문 회의자료(.md) 다운로드</button>
          <button type="button" class="btn secondary small" id="delib-clear-local">브라우저 임시변경 초기화</button>
        </div>
        <p id="delib-studio-status" class="delib-studio-status" role="status" aria-live="polite">각 조문의 [회의 기록 · 상태] 버튼으로 심의 상태·문구 수정·논의 요지를 기록하세요. 브라우저에 자동 임시 저장되며 [정본 JSON 다운로드]로 저장소에 반영합니다. (개인 실명 입력 금지)</p>
      </div>
    </details>
  </section>`;
}

function serializeEmbeddedRevisionJson(doc: BylawsRevisionDocument): string {
  const safeJson = JSON.stringify(doc)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script type="application/json" id="bylaws-revision-data">${safeJson}</script>`;
}

export function buildBylawsRevisionDiffHtml(
  doc: BylawsRevisionDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/bylaws-revision-diff.html';
  const prefix = computePrefixForRoute(route);
  const allEntries = flattenRevisionEntries(doc);
  const counts = countByChangeType(allEntries);
  const statusCounts = countByDelibStatus(allEntries);

  const groups: Array<{
    id: string;
    heading: string;
    entries: FlattenedRevisionEntry[];
  }> = [
    {
      id: 'preamble',
      heading: doc.preamble.label,
      entries: allEntries.filter((e) => e.chapterId === 'preamble'),
    },
    ...doc.chapters.map((ch) => ({
      id: ch.id,
      heading: ch.heading,
      entries: allEntries.filter((e) => e.chapterId === ch.id),
    })),
    {
      id: doc.addenda.id,
      heading: '부칙 및 별첨',
      entries: allEntries.filter((e) => e.chapterId === doc.addenda.id),
    },
  ];

  const jumpLinksHtml = groups
    .map(
      (g) =>
        `<a class="bylaw-ref-chip" href="${escapeAttr(`#diff-group-${g.id}`)}">${escapeHtml(g.heading)}</a>`,
    )
    .join('');

  const groupsHtml = groups
    .map((group) => {
      const capId = `diff-cap-${group.id}`;
      const rowsHtml = group.entries
        .map((entry) => {
          const delib = entry.deliberation;
          const label = changeLabel(doc.meta, entry.changeType);
          const refMoved =
            entry.currentRef !== entry.revisedRef && entry.currentRef !== '(신설)';
          return `<tr id="${escapeAttr(`diff-${entry.id}`)}" tabindex="-1" class="rev-diff-row" data-rev-item="true" data-delib-id="${escapeAttr(entry.id)}" data-change-type="${escapeAttr(entry.changeType)}" data-delib-status="${escapeAttr(delib.status)}" data-target-wave="${escapeAttr(delib.targetWave)}" data-tft-priority="${escapeAttr(delib.tftPriority ?? '')}" data-search="${escapeAttr(buildSearchText(entry))}">
            <th scope="row" class="rev-cell-meta">
              <div class="rev-row-head">
                <strong class="rev-row-title">${escapeHtml(entry.revisedRef)}</strong>
                <span class="rev-change-badge" data-change-type="${escapeAttr(entry.changeType)}">${escapeHtml(label)}</span>
              </div>
              <div class="rev-delib-badges">
                ${renderDelibBadgesHtml(doc.meta, entry)}
              </div>
              ${
                refMoved
                  ? `<p class="rev-prev-ref">현행: ${escapeHtml(entry.currentRef)}</p>`
                  : entry.currentRef === '(신설)'
                    ? `<p class="rev-prev-ref">신설 조항</p>`
                    : ''
              }
              <div class="rev-meta-actions no-print">
                <button type="button" class="rev-delib-toggle-btn" data-delib-toggle="${escapeAttr(entry.id)}" aria-expanded="false">회의 기록 · 상태 (${delib.meetingLogs.length})</button>
              </div>
              ${renderCrossLinksHtml(entry, 'diff')}
            </th>
            <td class="rev-cell-current" data-label="현행 규약">${renderLinesHtml(entry.currentLines)}</td>
            <td class="rev-cell-revised" data-label="개정안·잠정확정안">
              ${renderDraftContentHtml(entry)}
            </td>
            <td class="rev-cell-reason" data-label="개정 사유 · 회의 경과">
              <p class="rev-reason-text">${escapeHtml(entry.reason)}</p>
              ${renderDelibPanelHtml(entry)}
            </td>
          </tr>`;
        })
        .join('');

      return `<section class="rev-diff-group" id="${escapeAttr(`diff-group-${group.id}`)}" tabindex="-1" data-rev-group="true">
        <h2 id="${escapeAttr(capId)}" class="rev-diff-group-title">${escapeHtml(group.heading)}</h2>
        <div tabindex="0" role="region" aria-labelledby="${escapeAttr(capId)}" class="table-wrapper rev-diff-wrap">
          <table class="rev-diff-table">
            <caption class="visually-hidden">${escapeHtml(group.heading)} 신·구조문대비표</caption>
            <thead>
              <tr>
                <th scope="col">조항 · 심의 상태</th>
                <th scope="col">현행 규약</th>
                <th scope="col">개정안 · 잠정확정안</th>
                <th scope="col">개정 사유 · 회의 경과</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </section>`;
    })
    .join('');

  const bodyHtml = `
  <article class="document-article bylaws-revision-page bylaws-revision-diff-page" data-document-category="규약 개정안 신·구조문대비표" data-skip-auto-toc="true">
    ${renderUnlistedBanner(
      '미등재 검토·심의 시안 · noindex',
      '이 페이지는 규약 개정 TFT·정기 운영위원회 다회차 심의용 <strong>신·구조문대비표</strong> 미등재 화면이며, 포털 메뉴·<code>sitemap.xml</code> 및 공개 규약 화면에서는 링크되지 않습니다.',
    )}
    ${renderUnlistedBylawsSuiteNav('diff')}

    <header class="page-masthead">
      <div>
        <h1>규약 신·구조문대비표 (개정안 시안 · 다회차 심의대장)</h1>
        <p class="lead">${escapeHtml(doc.meta.subtitle)} · ${escapeHtml(doc.meta.auditedNote)}</p>
      </div>
      <div class="masthead-meta">
        <span class="data-stamp">${escapeHtml(doc.meta.enactedOn)} · ${escapeHtml(doc.meta.lastAmendedOn)} · ${escapeHtml(doc.meta.draftDate)}</span>
        <div class="bylaws-head-actions no-print">
          <a class="btn secondary small" href="bylaws-revision-full.html">개정안 전문 보기 →</a>
          <button type="button" class="btn secondary small" data-action="print">인쇄</button>
        </div>
      </div>
    </header>

    <div class="kpi-strip" role="region" aria-label="개정 항목 요약 지표">
      <div class="kpi">
        <div class="label">전체 검토 대상</div>
        <div class="value">${allEntries.length}건</div>
        <div class="sub">잠정확정 <span data-delib-kpi="confirmed_revision">${statusCounts.confirmed_revision}</span> · 현행유지 <span data-delib-kpi="confirmed_current">${statusCounts.confirmed_current}</span></div>
      </div>
      <div class="kpi" data-tone="expense">
        <div class="label">법령·실질 개정</div>
        <div class="value">${counts.substantive}건</div>
        <div class="sub">노조법·근참법 정합 및 절차 보완</div>
      </div>
      <div class="kpi" data-tone="grant">
        <div class="label">조 번호 재정렬·자구</div>
        <div class="value">${counts.renumbered}건</div>
        <div class="sub">제9~12장 중복 제37조 해소</div>
      </div>
      <div class="kpi" data-tone="income">
        <div class="label">자구 정비 · 현행 유지</div>
        <div class="value">${counts.wording} / ${counts.unchanged}건</div>
        <div class="sub">법제 표현 통일 및 원문 보존</div>
      </div>
    </div>

    ${renderDeliberationStudioHtml(doc, allEntries)}

    <section class="bylaws-toolbar no-print" aria-label="대비표 검색 및 유형 필터">
      <form class="bylaws-search-form" id="rev-diff-search-form" role="search">
        <label for="rev-diff-search">조항 번호·개정 사유·회의록 키워드 검색</label>
        <div class="bylaws-search-row">
          <div class="archive-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <input id="rev-diff-search" type="search" placeholder="예: 제21조, 결산, 탄핵, 노조법, 운영위" autocomplete="off">
            <button type="button" id="rev-diff-search-clear" class="archive-search-clear" hidden>지우기</button>
          </div>
          <button type="submit" class="btn small">검색</button>
        </div>
      </form>
      ${renderFilterChipsHtml(doc.meta, allEntries.length, counts)}
      <nav class="rev-jump-strip" aria-label="장·부칙 바로가기">
        <span class="rev-jump-label">장 이동</span>
        ${jumpLinksHtml}
      </nav>
      <div class="bylaws-search-meta">
        <p id="rev-diff-summary" role="status" aria-live="polite" data-total-count="${allEntries.length}">전체 ${allEntries.length}건 표시 중 (법령·실질 개정 ${counts.substantive}건 · 재정렬 ${counts.renumbered}건 · 자구 ${counts.wording}건 · 유지 ${counts.unchanged}건)</p>
      </div>
    </section>

    <div class="rev-diff-list" id="rev-diff-list" data-copy-body>
      ${groupsHtml}
      <div class="bylaws-no-results" id="rev-diff-no-results" hidden>
        <p>현재 필터·검색 조건에 일치하는 대비표 조항이 없습니다.</p>
        <button type="button" class="btn secondary small" id="rev-diff-reset">전체 조항 보기</button>
      </div>
    </div>

    <aside class="law-disclaimer" aria-label="검토 기준 안내">
      <strong>검토 및 의결 절차 안내</strong>
      <p>${escapeHtml(doc.meta.lawRefNote)} · ${escapeHtml(doc.meta.auditedNote)}. 각 조문은 TF·운영위원회 다회차 심의를 거쳐 잠정확정 후 최종 TF/운영위 의결을 통해 대의원대회(또는 총회) 특별결의로 최종 확정됩니다.</p>
    </aside>
    ${serializeEmbeddedRevisionJson(doc)}
  </article>
  ${renderDocumentToolsWidget()}`;

  return renderPageShell({
    title: '규약 신·구조문대비표 (개정안 시안)',
    description: `${doc.meta.title} 신·구조문대비표. 현행 규약과 개정안 시안, 다회차 회의 심의 상태 및 노조법 비교 분석 교차 참조를 제공합니다.`,
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    robots: 'noindex,follow',
    subnavHtml: renderUnionSubnav('', null),
    bodyHtml,
    extraScriptsHtml: [
      `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      `<script src="${escapeAttr(assetHref(prefix, 'bylaws-revision.js', assets))}" defer></script>`,
    ].join('\n'),
  });
}

function renderRevisionFullArticleHtml(
  doc: BylawsRevisionDocument,
  art: BylawsRevisionArticle,
  chapterId: string,
  sectionId: string | null,
): string {
  const { num, title } = splitArticleHeading(art.revisedRef);
  const label = changeLabel(doc.meta, art.changeType);
  const delib = normalizeDeliberation(art.deliberation);
  const entry: FlattenedRevisionEntry = {
    id: art.id,
    chapterId,
    groupHeading: '',
    currentRef: art.currentRef,
    revisedRef: art.revisedRef,
    changeType: art.changeType,
    reason: art.reason,
    currentLines: art.currentLines,
    revisedLines: art.revisedLines,
    currentArtId: art.currentArtId,
    lawCmpId: art.lawCmpId,
    deliberation: delib,
  };

  const noteHtml =
    art.changeType !== 'unchanged'
      ? `<p class="rev-reason-note"><strong>정비 요지${art.currentRef !== art.revisedRef ? ` (현행 ${escapeHtml(art.currentRef)})` : ''}:</strong> ${escapeHtml(art.reason)}</p>`
      : '';

  return `<article class="bylaw-article" id="${escapeAttr(art.id)}" tabindex="-1" data-rev-item="true" data-delib-id="${escapeAttr(art.id)}" data-chapter-id="${escapeAttr(chapterId)}"${sectionId ? ` data-section-id="${escapeAttr(sectionId)}"` : ''} data-change-type="${escapeAttr(art.changeType)}" data-delib-status="${escapeAttr(delib.status)}" data-target-wave="${escapeAttr(delib.targetWave)}" data-tft-priority="${escapeAttr(delib.tftPriority ?? '')}" data-search="${escapeAttr(buildSearchText(entry))}">
    <header class="bylaw-article-head">
      <h3>
        <span class="bylaw-article-num">${escapeHtml(num)}</span>${title ? `<span class="bylaw-article-title">(${escapeHtml(title)})</span>` : ''}
      </h3>
      <div class="rev-article-tools">
        <span class="rev-change-badge" data-change-type="${escapeAttr(art.changeType)}">${escapeHtml(label)}</span>
        ${renderDelibBadgesHtml(doc.meta, entry)}
        <button type="button" class="rev-delib-toggle-btn no-print" data-delib-toggle="${escapeAttr(art.id)}" aria-expanded="false">회의 기록 · 상태 (${delib.meetingLogs.length})</button>
        <button type="button" class="bylaw-anchor-btn no-print" data-rev-copy-id="${escapeAttr(art.id)}" data-rev-copy-ref="${escapeAttr(art.revisedRef)}" aria-label="${escapeAttr(art.revisedRef)} 링크 복사" title="조항 링크 복사">#</button>
      </div>
    </header>
    <div class="bylaw-article-body">
      ${renderDraftContentHtml(entry)}
      ${noteHtml}
      ${renderDelibPanelHtml(entry)}
      ${renderCrossLinksHtml(entry, 'full')}
    </div>
  </article>`;
}

export function buildBylawsRevisionFullHtml(
  doc: BylawsRevisionDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/bylaws-revision-full.html';
  const prefix = computePrefixForRoute(route);
  const allEntries = flattenRevisionEntries(doc);
  const counts = countByChangeType(allEntries);

  const preambleEntry = allEntries[0]!;
  const tocItems: string[] = [
    `<li class="bylaw-toc-item"><a class="bylaws-toc-link" href="#preamble">전문</a></li>`,
  ];

  for (const ch of doc.chapters) {
    const secHtml = ch.sections?.length
      ? `<ol class="bylaws-toc-sub">${ch.sections
          .map(
            (s) =>
              `<li><a class="bylaws-toc-link is-sub" href="${escapeAttr(`#${s.id}`)}">${escapeHtml(s.heading)}</a></li>`,
          )
          .join('')}</ol>`
      : '';
    tocItems.push(
      `<li class="bylaw-toc-item"><a class="bylaws-toc-link" href="${escapeAttr(`#${ch.id}`)}">${escapeHtml(ch.heading)}</a>${secHtml}</li>`,
    );
  }
  tocItems.push(
    `<li class="bylaw-toc-item"><a class="bylaws-toc-link" href="#addenda">부칙·별첨</a></li>`,
  );

  const chaptersHtml = doc.chapters
    .map((ch) => {
      const leadHtml = (ch.articles ?? [])
        .map((art) => renderRevisionFullArticleHtml(doc, art, ch.id, null))
        .join('');
      const secsHtml = (ch.sections ?? [])
        .map(
          (sec) => `<section class="bylaw-section" id="${escapeAttr(sec.id)}" tabindex="-1">
            <h3 class="bylaw-section-title">${escapeHtml(sec.heading)}</h3>
            <div class="bylaw-article-list">
              ${sec.articles.map((art) => renderRevisionFullArticleHtml(doc, art, ch.id, sec.id)).join('')}
            </div>
          </section>`,
        )
        .join('');

      return `<section class="bylaw-chapter" id="${escapeAttr(ch.id)}" tabindex="-1" data-rev-chapter="${escapeAttr(ch.id)}">
        <header class="bylaw-chapter-head">
          <h2>${escapeHtml(ch.heading)}</h2>
          ${ch.currentHeading && ch.currentHeading !== ch.heading ? `<span class="bylaw-chapter-meta">현행: ${escapeHtml(ch.currentHeading)}</span>` : ''}
        </header>
        ${leadHtml ? `<div class="bylaw-article-list">${leadHtml}</div>` : ''}
        ${secsHtml}
      </section>`;
    })
    .join('');

  const addendaArticlesHtml = doc.addenda.articles
    .map((art) => renderRevisionFullArticleHtml(doc, art, doc.addenda.id, null))
    .join('');

  const attachmentsHtml = `<section class="bylaw-attachments" aria-label="별첨 개정 시안">
    <h3>별첨</h3>
    <ul class="bylaw-attachment-list">
      ${doc.addenda.attachments
        .map((att) => {
          const label = changeLabel(doc.meta, att.changeType);
          const delib = normalizeDeliberation(att.deliberation);
          const attEntry: FlattenedRevisionEntry = {
            id: att.id,
            chapterId: doc.addenda.id,
            groupHeading: doc.addenda.heading,
            currentRef: att.currentRef,
            revisedRef: att.revisedRef,
            changeType: att.changeType,
            reason: att.reason,
            currentLines: [att.currentText],
            revisedLines: [att.revisedText],
            currentArtId: att.currentArtId,
            lawCmpId: att.lawCmpId,
            deliberation: delib,
          };
          return `<li id="${escapeAttr(att.id)}" tabindex="-1" class="bylaw-attachment-item rev-attachment-item" data-rev-item="true" data-delib-id="${escapeAttr(att.id)}" data-chapter-id="${escapeAttr(doc.addenda.id)}" data-change-type="${escapeAttr(att.changeType)}" data-delib-status="${escapeAttr(delib.status)}" data-target-wave="${escapeAttr(delib.targetWave)}" data-tft-priority="${escapeAttr(delib.tftPriority ?? '')}" data-search="${escapeAttr(buildSearchText(attEntry))}">
            <div class="rev-attachment-head">
              <strong>${escapeHtml(att.revisedRef)}</strong>
              <span class="rev-change-badge" data-change-type="${escapeAttr(att.changeType)}">${escapeHtml(label)}</span>
              ${renderDelibBadgesHtml(doc.meta, attEntry)}
              <button type="button" class="rev-delib-toggle-btn no-print" data-delib-toggle="${escapeAttr(att.id)}" aria-expanded="false">회의 기록 · 상태 (${delib.meetingLogs.length})</button>
            </div>
            ${renderDraftContentHtml(attEntry)}
            <p class="rev-reason-note"><strong>정비 요지:</strong> ${escapeHtml(att.reason)}</p>
            ${renderDelibPanelHtml(attEntry)}
            ${renderCrossLinksHtml(attEntry, 'full')}
          </li>`;
        })
        .join('')}
    </ul>
  </section>`;

  const bodyHtml = `
  <article class="document-article bylaws-document bylaws-revision-page bylaws-revision-full-page" data-document-category="규약 개정안 전문 시안" data-skip-auto-toc="true">
    ${renderUnlistedBanner(
      '미등재 검토·심의 시안 · noindex',
      '이 페이지는 규약 개정 TFT·정기 운영위원회 다회차 심의용 <strong>개정안 전문 시안</strong>이며, 포털 메뉴·<code>sitemap.xml</code> 및 공개 규약 화면에서는 링크되지 않습니다.',
    )}
    ${renderUnlistedBylawsSuiteNav('full')}

    <header class="page-masthead">
      <div>
        <h1>${escapeHtml(doc.meta.title)}</h1>
        <p class="lead">${escapeHtml(doc.meta.subtitle)} · ${escapeHtml(doc.meta.lawRefNote)}</p>
      </div>
      <div class="masthead-meta">
        <span class="data-stamp">${escapeHtml(doc.meta.enactedOn)} · ${escapeHtml(doc.meta.lastAmendedOn)} · ${escapeHtml(doc.meta.draftDate)}</span>
        <div class="bylaws-head-actions no-print">
          <a class="btn secondary small" href="bylaws-revision-diff.html">신·구조문대비표 →</a>
          <button type="button" class="btn secondary small" data-action="print">인쇄</button>
        </div>
      </div>
    </header>

    ${renderDeliberationStudioHtml(doc, allEntries)}

    <section class="bylaws-toolbar no-print" aria-label="개정안 전문 검색 및 유형 필터">
      <form class="bylaws-search-form" id="rev-full-search-form" role="search">
        <label for="rev-full-search">조항 번호·개정 사유·회의록 키워드 검색</label>
        <div class="bylaws-search-row">
          <div class="archive-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <input id="rev-full-search" type="search" placeholder="예: 제30조, 38조, 결산, 탄핵, 운영위" autocomplete="off">
            <button type="button" id="rev-full-search-clear" class="archive-search-clear" hidden>지우기</button>
          </div>
          <button type="submit" class="btn small">검색</button>
        </div>
      </form>
      <div class="rev-toolbar-row">
        ${renderFilterChipsHtml(doc.meta, allEntries.length, counts)}
        <button type="button" class="btn secondary small" id="rev-notes-toggle" aria-pressed="true">수정 사유 주석 표시 중</button>
      </div>
      <div class="bylaws-search-meta">
        <p id="rev-full-summary" role="status" aria-live="polite" data-total-count="${allEntries.length}">전체 ${allEntries.length}건 표시 중 (본문 59조·전문 1건·부칙 3조·별첨 3건)</p>
        <p id="rev-full-copy-status" class="bylaws-copy-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <div class="bylaws-layout">
      <aside class="bylaws-sidebar no-print" aria-label="개정안 목차 탐색">
        <details class="bylaws-toc-disclosure" id="rev-full-toc-disclosure" open>
          <summary class="bylaws-toc-summary">목차 (전문 · 12장 · 부칙)</summary>
          <nav class="bylaws-toc-nav" id="rev-full-toc-nav" aria-label="개정안 장·절 목차">
            <ol class="bylaws-toc-list">
              ${tocItems.join('')}
            </ol>
          </nav>
        </details>
      </aside>

      <div class="bylaws-content" id="rev-full-content" data-copy-body>
        <section class="bylaw-preamble" id="preamble" tabindex="-1" data-rev-item="true" data-delib-id="preamble" data-chapter-id="preamble" data-change-type="${escapeAttr(doc.preamble.changeType)}" data-delib-status="${escapeAttr(preambleEntry.deliberation.status)}" data-target-wave="${escapeAttr(preambleEntry.deliberation.targetWave)}" data-tft-priority="${escapeAttr(preambleEntry.deliberation.tftPriority ?? '')}" data-search="${escapeAttr(buildSearchText(preambleEntry))}">
          <div class="bylaw-preamble-meta">
            <h2>${escapeHtml(doc.preamble.label)}</h2>
            <div class="rev-article-tools">
              <span class="rev-change-badge" data-change-type="${escapeAttr(doc.preamble.changeType)}">${escapeHtml(changeLabel(doc.meta, doc.preamble.changeType))}</span>
              ${renderDelibBadgesHtml(doc.meta, preambleEntry)}
              <button type="button" class="rev-delib-toggle-btn no-print" data-delib-toggle="preamble" aria-expanded="false">회의 기록 · 상태 (${preambleEntry.deliberation.meetingLogs.length})</button>
            </div>
          </div>
          ${renderDraftContentHtml(preambleEntry)}
          <p class="rev-reason-note"><strong>정비 요지:</strong> ${escapeHtml(doc.preamble.reason)}</p>
          ${renderDelibPanelHtml(preambleEntry)}
          ${renderCrossLinksHtml(preambleEntry, 'full')}
        </section>

        ${chaptersHtml}

        <section class="bylaw-chapter bylaw-addenda" id="${escapeAttr(doc.addenda.id)}" tabindex="-1" data-rev-chapter="${escapeAttr(doc.addenda.id)}">
          <header class="bylaw-chapter-head">
            <h2>${escapeHtml(doc.addenda.heading)}</h2>
            <span class="bylaw-chapter-meta">부칙 ${doc.addenda.articles.length}조 · 별첨 ${doc.addenda.attachments.length}건</span>
          </header>
          <div class="bylaw-article-list">
            ${addendaArticlesHtml}
          </div>
          ${attachmentsHtml}
        </section>

        <div class="bylaws-no-results" id="rev-full-no-results" hidden>
          <p>현재 필터·검색 조건에 일치하는 조항이 없습니다.</p>
          <button type="button" class="btn secondary small" id="rev-full-reset">전체 조항 보기</button>
        </div>
      </div>
    </div>
    ${serializeEmbeddedRevisionJson(doc)}
  </article>
  ${renderDocumentToolsWidget()}`;

  return renderPageShell({
    title: doc.meta.title,
    description: `${doc.meta.title}. ${doc.meta.lawRefNote} 기준으로 자구·조항 번호를 정비하고 다회차 회의 심의 결과를 누적 관리하는 전문 시안입니다.`,
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    robots: 'noindex,follow',
    subnavHtml: renderUnionSubnav('', null),
    bodyHtml,
    extraScriptsHtml: [
      `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      `<script src="${escapeAttr(assetHref(prefix, 'bylaws-revision.js', assets))}" defer></script>`,
    ].join('\n'),
  });
}
