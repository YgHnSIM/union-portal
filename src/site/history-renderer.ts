import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { CATEGORY_BY_ID, type ContentGraph } from '../domain/content-graph.js';
import type { DocumentRecordV3 } from '../domain/types.js';
import { sanitizeLinkUrl } from './mom-renderer.js';
import {
  escapeAttr,
  escapeHtml,
  renderDocumentToolsWidget,
} from './shell.js';
import { primaryDateOf } from './site-context.js';

interface SubPhase {
  headingText: string;
  tokens: Token[];
}

interface SubSection {
  headingText: string;
  tokens: Token[];
}

interface Chapter {
  id: string;
  headingText: string;
  rawTokens: Token[];
  leadTokens: Token[];
  subSections: SubSection[];
  isConclusion: boolean;
}

function createHistoryMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]!;
    const hrefIdx = token.attrIndex('href');
    if (hrefIdx >= 0 && token.attrs?.[hrefIdx]) {
      token.attrs[hrefIdx]![1] = sanitizeLinkUrl(token.attrs[hrefIdx]![1]);
    }
    token.attrJoin('class', 'content-link');
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  // Handle CommonMark flanking-delimiter misses on Korean particles after quoted/bracketed bold spans (e.g. **'표현'**의)
  md.core.ruler.after('inline', 'korean_strong_fix', (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children) continue;
      const nextChildren: Token[] = [];
      let changed = false;

      for (const child of blockToken.children) {
        if (child.type !== 'text' || !child.content.includes('**')) {
          nextChildren.push(child);
          continue;
        }
        const pattern = /\*\*([^*\n]+?)\*\*/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(child.content)) !== null) {
          changed = true;
          if (match.index > lastIndex) {
            const pre = new state.Token('text', '', 0);
            pre.content = child.content.slice(lastIndex, match.index);
            nextChildren.push(pre);
          }
          const open = new state.Token('strong_open', 'strong', 1);
          open.markup = '**';
          const inner = new state.Token('text', '', 0);
          inner.content = match[1]!;
          const close = new state.Token('strong_close', 'strong', -1);
          close.markup = '**';
          nextChildren.push(open, inner, close);
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < child.content.length) {
          const tail = new state.Token('text', '', 0);
          tail.content = child.content.slice(lastIndex);
          nextChildren.push(tail);
        }
      }

      if (changed) {
        blockToken.children = nextChildren;
      }
    }
  });

  return md;
}

const historyMd = createHistoryMarkdownRenderer();

function inlineText(token: Token | undefined): string {
  if (!token) return '';
  if (token.type === 'text' || token.type === 'code_inline') return token.content;
  if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
  if (token.children) return token.children.map((c) => inlineText(c)).join('');
  return '';
}

function renderTokens(tokens: Token[], env: Record<string, unknown>): string {
  if (tokens.length === 0) return '';
  return historyMd.renderer.render(tokens, historyMd.options, env);
}

function splitChapters(tokens: Token[]): {
  heroTitle: string;
  chapters: Chapter[];
} {
  let heroTitle = '';
  const rawChapters: Array<{ headingText: string; rawTokens: Token[] }> = [];
  let current: { headingText: string; rawTokens: Token[] } | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.type === 'heading_open' && tok.tag === 'h1') {
      const text = inlineText(tokens[i + 1]).replace(/\s+/g, ' ').trim();
      if (!heroTitle && text) heroTitle = text;
      i += 2;
      continue;
    }
    if (tok.type === 'heading_open' && tok.tag === 'h2') {
      const text = inlineText(tokens[i + 1]).replace(/\s+/g, ' ').trim();
      current = { headingText: text, rawTokens: [] };
      rawChapters.push(current);
      i += 2;
      continue;
    }
    if (tok.type === 'hr' && tok.level === 0) {
      continue;
    }
    if (current) {
      current.rawTokens.push(tok);
    }
  }

  let sectionCounter = 0;
  const chapters: Chapter[] = rawChapters.map((ch) => {
    const isConclusion = ch.headingText.startsWith('결론');
    let id: string;
    if (isConclusion) {
      id = 'conclusion';
    } else {
      sectionCounter += 1;
      id = `sec-${sectionCounter}`;
    }

    const leadTokens: Token[] = [];
    const subSections: SubSection[] = [];
    let curSub: SubSection | null = null;

    for (let i = 0; i < ch.rawTokens.length; i += 1) {
      const tok = ch.rawTokens[i]!;
      if (tok.type === 'heading_open' && tok.tag === 'h3') {
        const subText = inlineText(ch.rawTokens[i + 1]).replace(/\s+/g, ' ').trim();
        curSub = { headingText: subText, tokens: [] };
        subSections.push(curSub);
        i += 2;
        continue;
      }
      if (curSub) curSub.tokens.push(tok);
      else leadTokens.push(tok);
    }

    return {
      id,
      headingText: ch.headingText,
      rawTokens: ch.rawTokens,
      leadTokens,
      subSections,
      isConclusion,
    };
  });

  return { heroTitle, chapters };
}

function extractTopLevelListItems(
  tokens: Token[],
  listOpenType: 'bullet_list_open' | 'ordered_list_open',
  listCloseType: 'bullet_list_close' | 'ordered_list_close',
): {
  beforeTokens: Token[];
  items: Token[][];
  afterTokens: Token[];
  found: boolean;
} {
  const openIdx = tokens.findIndex((t) => t.type === listOpenType);
  if (openIdx === -1) {
    return { beforeTokens: tokens, items: [], afterTokens: [], found: false };
  }

  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < tokens.length; i += 1) {
    const t = tokens[i]!.type;
    if (t === 'bullet_list_open' || t === 'ordered_list_open') depth += 1;
    else if (t === 'bullet_list_close' || t === 'ordered_list_close') {
      depth -= 1;
      if (depth === 0 && t === listCloseType) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    return { beforeTokens: tokens, items: [], afterTokens: [], found: false };
  }

  const beforeTokens = tokens.slice(0, openIdx);
  const afterTokens = tokens.slice(closeIdx + 1);
  const inner = tokens.slice(openIdx + 1, closeIdx);

  const items: Token[][] = [];
  let itemDepth = 0;
  let curItem: Token[] | null = null;
  for (const tok of inner) {
    if (tok.type === 'list_item_open') {
      if (itemDepth === 0) {
        curItem = [];
        itemDepth = 1;
        continue;
      }
      itemDepth += 1;
    } else if (tok.type === 'list_item_close') {
      itemDepth -= 1;
      if (itemDepth === 0) {
        if (curItem) items.push(curItem);
        curItem = null;
        continue;
      }
    }
    if (curItem) curItem.push(tok);
  }

  return { beforeTokens, items, afterTokens, found: true };
}

function splitLeadingStrong(
  itemTokens: Token[],
): { leadingTitle: string; bodyTokens: Token[] } {
  const cloned = itemTokens.map((t) => ({
    ...t,
    children: t.children ? t.children.map((c) => ({ ...c })) : t.children,
  })) as Token[];

  const firstInlineIdx = cloned.findIndex((t) => t.type === 'inline');
  if (firstInlineIdx === -1) {
    return { leadingTitle: '', bodyTokens: cloned };
  }

  const inlineTok = cloned[firstInlineIdx]!;
  const children = inlineTok.children ?? [];
  let startIdx = 0;
  while (
    startIdx < children.length &&
    children[startIdx]?.type === 'text' &&
    !children[startIdx]!.content.trim()
  ) {
    startIdx += 1;
  }
  if (children[startIdx]?.type !== 'strong_open') {
    return { leadingTitle: '', bodyTokens: cloned };
  }

  let strongDepth = 0;
  let closeIdx = -1;
  for (let i = startIdx; i < children.length; i += 1) {
    if (children[i]!.type === 'strong_open') strongDepth += 1;
    else if (children[i]!.type === 'strong_close') {
      strongDepth -= 1;
      if (strongDepth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    return { leadingTitle: '', bodyTokens: cloned };
  }

  const leadingTitle = children
    .slice(startIdx + 1, closeIdx)
    .map((c) => c.content || '')
    .join('')
    .trim();
  const restChildren = children.slice(closeIdx + 1);
  if (restChildren[0]?.type === 'text') {
    restChildren[0] = {
      ...restChildren[0],
      content: restChildren[0].content.replace(/^\s+/, ''),
    } as Token;
  }
  inlineTok.children = restChildren;
  return { leadingTitle, bodyTokens: cloned };
}

function renderTimelineChapter(
  chapter: Chapter,
  env: Record<string, unknown>,
): string {
  const { beforeTokens, items, afterTokens } = extractTopLevelListItems(
    chapter.leadTokens,
    'bullet_list_open',
    'bullet_list_close',
  );

  const introHtml =
    beforeTokens.length > 0
      ? renderTokens(beforeTokens, env)
      : '<p>2017년 서서울물류 지회 설립부터 2021년 단위 노동조합 출범, 2026년 중앙노동위원회 재심 인용과 인천지방노동위원회 원청 교섭참여 인정 결정까지 물류노동조합의 주요 연혁입니다.</p>';

  const rowsHtml = items
    .map((item) => {
      const { leadingTitle, bodyTokens } = splitLeadingStrong(item);
      const bodyHtml = renderTokens(bodyTokens, env);
      const isMilestone =
        /독자 노선|공식 출범|중앙노동위원회 재심 인용|교섭참여 노동조합 인정 결정/.test(leadingTitle + bodyHtml);
      return `<div class="timeline-row${isMilestone ? ' is-milestone' : ''}">
          <div class="timeline-date">${escapeHtml(leadingTitle)}</div>
          <div class="timeline-text history-prose">${bodyHtml}</div>
        </div>`;
    })
    .join('\n        ');

  const afterHtml =
    afterTokens.length > 0
      ? `<div class="history-prose">${renderTokens(afterTokens, env)}</div>`
      : '';

  return `<section class="history-section history-split-timeline history-reveal" id="${escapeAttr(chapter.id)}" aria-labelledby="title-${escapeAttr(chapter.id)}">
      <div class="split-intro">
        <h2 id="title-${escapeAttr(chapter.id)}">${escapeHtml(chapter.headingText)}</h2>
        <div class="history-prose">${introHtml}</div>
      </div>
      <div>
        <div class="timeline-rail">
          ${rowsHtml}
        </div>
        ${afterHtml}
      </div>
    </section>`;
}

function renderStrategyChapter(
  chapter: Chapter,
  env: Record<string, unknown>,
): string {
  const { beforeTokens, items, afterTokens } = extractTopLevelListItems(
    chapter.leadTokens,
    'ordered_list_open',
    'ordered_list_close',
  );

  const leadHtml =
    beforeTokens.length > 0
      ? `<div class="history-prose history-prose--lead">${renderTokens(beforeTokens, env)}</div>`
      : '';

  const cardsHtml = items
    .map((item, idx) => {
      const { leadingTitle, bodyTokens } = splitLeadingStrong(item);
      const cleanTitle = leadingTitle.replace(/[:：]\s*$/, '');
      const bodyHtml = renderTokens(bodyTokens, env);
      return `<article class="strategy-card">
          <div class="strategy-index">${idx + 1}</div>
          <h3>${escapeHtml(cleanTitle || `투쟁 방식 ${idx + 1}`)}</h3>
          <div class="history-prose">${bodyHtml}</div>
        </article>`;
    })
    .join('\n        ');

  const afterHtml =
    afterTokens.length > 0
      ? `<div class="history-prose">${renderTokens(afterTokens, env)}</div>`
      : '';

  return `<section class="history-section history-reveal" id="${escapeAttr(chapter.id)}" aria-labelledby="title-${escapeAttr(chapter.id)}">
      <div class="history-section-head">
        <h2 id="title-${escapeAttr(chapter.id)}">${escapeHtml(chapter.headingText)}</h2>
      </div>
      ${leadHtml}
      <div class="strategy-grid">
        ${cardsHtml}
      </div>
      ${afterHtml}
    </section>`;
}

function splitSubSectionPhases(tokens: Token[]): {
  leadTokens: Token[];
  phases: SubPhase[];
} {
  const leadTokens: Token[] = [];
  const phases: SubPhase[] = [];
  let curPhase: SubPhase | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.type === 'heading_open' && tok.tag === 'h4') {
      const headingText = inlineText(tokens[i + 1]).replace(/\s+/g, ' ').trim();
      curPhase = { headingText, tokens: [] };
      phases.push(curPhase);
      i += 2;
      continue;
    }
    if (curPhase) curPhase.tokens.push(tok);
    else leadTokens.push(tok);
  }

  return { leadTokens, phases };
}

function renderSubSectionChapter(
  chapter: Chapter,
  env: Record<string, unknown>,
): string {
  const hasPhases = chapter.subSections.some((sub) =>
    sub.tokens.some((t) => t.type === 'heading_open' && t.tag === 'h4'),
  );
  const subTotalChars = chapter.subSections.reduce(
    (acc, sub) =>
      acc + sub.tokens.map((t) => inlineText(t)).join(' ').length,
    0,
  );

  const leadHtml =
    chapter.subSections.length > 0 && chapter.leadTokens.length > 0
      ? `<div class="history-section-lead history-prose">${renderTokens(chapter.leadTokens, env)}</div>`
      : '';

  let bodyHtml = '';
  if (chapter.subSections.length === 0) {
    bodyHtml = `<div class="history-prose">${renderTokens(chapter.rawTokens, env)}</div>`;
  } else if (
    chapter.id === 'sec-3' &&
    chapter.subSections.length === 3 &&
    !hasPhases &&
    subTotalChars <= 1300
  ) {
    const tones = ['battle-card--crisis', 'battle-card--action', 'battle-card--win'];
    const cards = chapter.subSections
      .map((sub, idx) => {
        const tone = tones[idx] ?? 'battle-card--action';
        return `<article class="battle-card ${tone}">
            <h3>${escapeHtml(sub.headingText)}</h3>
            <div class="history-prose">${renderTokens(sub.tokens, env)}</div>
          </article>`;
      })
      .join('\n        ');
    bodyHtml = `<div class="battle-grid">${cards}</div>`;
  } else if (chapter.subSections.length === 2 && !hasPhases) {
    const cards = chapter.subSections
      .map(
        (sub) => `<article class="chapter-card">
          <h3>${escapeHtml(sub.headingText)}</h3>
          <div class="history-prose">${renderTokens(sub.tokens, env)}</div>
        </article>`,
      )
      .join('\n        ');
    bodyHtml = `<div class="chapter-grid--2">${cards}</div>`;
  } else {
    const entries = chapter.subSections
      .map((sub) => {
        const { leadTokens, phases } = splitSubSectionPhases(sub.tokens);
        const subLeadHtml =
          leadTokens.length > 0 ? renderTokens(leadTokens, env) : '';
        const phasesHtml = phases
          .map(
            (phase) => `<section class="chapter-phase">
              <h4>${escapeHtml(phase.headingText)}</h4>
              <div class="history-prose">${renderTokens(phase.tokens, env)}</div>
            </section>`,
          )
          .join('\n            ');
        return `<article class="chapter-entry">
          <div class="chapter-entry-head">
            <h3>${escapeHtml(sub.headingText)}</h3>
          </div>
          <div class="chapter-entry-body history-prose">
            ${subLeadHtml}
            ${phasesHtml}
          </div>
        </article>`;
      })
      .join('\n        ');
    bodyHtml = `<div class="chapter-entries">${entries}</div>`;
  }

  return `<section class="history-section history-reveal" id="${escapeAttr(chapter.id)}" aria-labelledby="title-${escapeAttr(chapter.id)}">
      <div class="history-section-head">
        <h2 id="title-${escapeAttr(chapter.id)}">${escapeHtml(chapter.headingText)}</h2>
        ${leadHtml}
      </div>
      ${bodyHtml}
    </section>`;
}

function renderFinaleChapter(
  chapter: Chapter,
  env: Record<string, unknown>,
): string {
  return `<section class="history-finale history-reveal" id="conclusion" aria-labelledby="sec-conclusion-title">
      <svg class="history-finale-watermark" viewBox="0 0 82 94" width="164" height="188" aria-hidden="true" focusable="false">
        <polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="#8ca5e8"></polygon>
        <polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="#f5f3ee"></polygon>
        <polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="#f5f3ee"></polygon>
        <polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="#8ca5e8"></polygon>
      </svg>
      <h2 id="sec-conclusion-title">${escapeHtml(chapter.headingText)}</h2>
      <div class="history-finale-copy">
        ${renderTokens(chapter.rawTokens, env)}
      </div>
      <div class="history-share-bar no-print">
        <button type="button" class="btn btn-finale-primary" data-inline-action="share">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="2"></circle><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="19" r="2"></circle><path d="m8 11 8-5M8 13l8 5"></path></svg>
          <span>이 기록 공유하기</span>
        </button>
        <button type="button" class="btn btn-finale-secondary" data-inline-action="copy-link">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11"></rect><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"></path></svg>
          <span>링크 복사</span>
        </button>
        <span class="history-inline-status" data-inline-status role="status" aria-live="polite" aria-atomic="true"></span>
      </div>
    </section>`;
}

function formatKoreanDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[1]}년\u00A0${Number(m[2])}월\u00A0${Number(m[3])}일`;
}

export function renderHistoryFeaturePage(params: {
  markdown: string;
  doc: DocumentRecordV3;
  graph: ContentGraph;
  prefix: string;
  linkedLedgerHtml: string;
  relatedHtml: string;
}): string {
  const { markdown, doc, graph, prefix, linkedLedgerHtml, relatedHtml } = params;
  const env: Record<string, unknown> = {};
  const tokens = historyMd.parse(String(markdown || ''), env);
  const { heroTitle, chapters } = splitChapters(tokens);

  const chapterIds = new Set(chapters.map((c) => c.id));
  const safeAnchor = (target: string): string =>
    chapterIds.has(target) ? `#${target}` : `#${chapters[0]?.id ?? 'conclusion'}`;

  const sectionsHtml = chapters
    .map((ch, idx) => {
      if (ch.isConclusion) {
        return renderFinaleChapter(ch, env);
      }
      if (idx === 0 && ch.headingText.includes('연혁')) {
        return renderTimelineChapter(ch, env);
      }
      const hasOrdered = ch.leadTokens.some((t) => t.type === 'ordered_list_open');
      if (ch.subSections.length === 0 && hasOrdered) {
        return renderStrategyChapter(ch, env);
      }
      return renderSubSectionChapter(ch, env);
    })
    .join('\n\n      ');

  const statusLabel =
    doc.workflow.status === 'final'
      ? '확정'
      : doc.workflow.status === 'reviewed'
        ? '검토중'
        : '초안';
  const reviewedIso = doc.dates.reviewedOn || doc.dates.modifiedOn || primaryDateOf(doc);
  const reviewedDisplay = formatKoreanDate(reviewedIso);
  const topicLinks = doc.topicIds
    .map((tid) => {
      const label = graph.topicsById.get(tid)?.label ?? tid;
      return `<a href="../index.html?topic=${encodeURIComponent(label)}">${escapeHtml(label)}</a>`;
    })
    .join('');

  const colophonNote =
    doc.evidence.noteVisibility === 'public' && doc.evidence.note
      ? `<p class="history-colophon-note">${escapeHtml(doc.evidence.note)}</p>`
      : '';

  const categoryLabel = CATEGORY_BY_ID.get(doc.category)?.label ?? doc.category;

  return `
  <article class="history-feature document-article" id="history-article" data-document-category="${escapeAttr(categoryLabel)}" data-skip-auto-toc="true">
    <div class="history-scroll-progress no-print" aria-hidden="true"></div>

    <div data-copy-body>
      <header class="history-hero">
        <svg class="history-hero-emblem" viewBox="0 0 82 94" width="164" height="188" aria-hidden="true" focusable="false">
          <polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="var(--brand-emblem-blue, #516db2)"></polygon>
          <polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="var(--brand-emblem-ink, #0b051a)"></polygon>
          <polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="var(--brand-emblem-ink, #0b051a)"></polygon>
          <polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="var(--brand-emblem-blue, #516db2)"></polygon>
        </svg>

        <div class="history-hero-top">
          <nav class="document-breadcrumb no-print" aria-label="현재 위치">
            <ol>
              <li><a href="../index.html">공개 자료실</a></li>
              <li aria-current="page"><a href="./index.html">${escapeHtml(categoryLabel)}</a></li>
            </ol>
          </nav>
          <span class="history-hero-years">2017-2026</span>
        </div>

        <div class="history-hero-headline">
          <h1 class="document-title">${escapeHtml(heroTitle || doc.title)}</h1>
          <p class="history-hero-lead">${escapeHtml(doc.summary)}</p>
        </div>

        <div class="history-impact-band" aria-label="핵심 요약 성과">
          <div class="history-impact-cell">
            <strong>3개 사업소</strong>
            <span>서서울·부평·안양 지회 설립 및 단위 노조 출범</span>
          </div>
          <div class="history-impact-cell" data-tone="win">
            <strong>115명 · 100여&nbsp;명</strong>
            <span>기간제 노동자 전원 계약 연장 및 공무직 전환</span>
          </div>
          <div class="history-impact-cell" data-tone="solidarity">
            <strong>중노위 인용</strong>
            <span>단시간 노동자 유급병가 차별시정·조정안 수용</span>
          </div>
          <div class="history-impact-cell">
            <strong>원청 교섭 인정</strong>
            <span>2026.11.23. 인천지방노동위원회 교섭참여 인정</span>
          </div>
        </div>
      </header>

      <section class="history-roadmap" id="roadmap" aria-labelledby="history-roadmap-title">
        <div class="roadmap-head">
          <h2 id="history-roadmap-title">한눈에 보는 9년의 주요 성과 로드맵</h2>
          <div class="roadmap-range">2017-2026</div>
        </div>
        <nav class="roadmap-grid" aria-label="9년 변화 로드맵">
          <a class="roadmap-step" href="${escapeAttr(safeAnchor('sec-3'))}">
            <div class="roadmap-step-top">
              <span class="roadmap-year">2017</span>
              <h3>고용 유지와 출발</h3>
              <p>서서울물류사업소 기간제 노동자 6명의 계약 종료 통보에 맞서 전원 고용 연장과 8시간 전일제 일자리 보장을 이끌어냈습니다.</p>
            </div>
            <span class="roadmap-jump no-print">해당 기록 보기 →</span>
          </a>
          <a class="roadmap-step" href="${escapeAttr(safeAnchor('sec-6'))}">
            <div class="roadmap-step-top">
              <span class="roadmap-year">2021-2023</span>
              <h3>단위 노조 출범·고용승계</h3>
              <p>물류노동조합을 공식 출범하고, 115명 계약 연장·100여 명 공무직 전환과 서서울물류사업소 폐국 시 전원 고용승계를 관철했습니다.</p>
            </div>
            <span class="roadmap-jump no-print">해당 기록 보기 →</span>
          </a>
          <a class="roadmap-step" href="${escapeAttr(safeAnchor('sec-4'))}">
            <div class="roadmap-step-top">
              <span class="roadmap-year">2018-2026</span>
              <h3>차별 철폐와 처우 개선</h3>
              <p>직무·가족수당, 복지포인트, 유급병가, 성과급 차별을 노동위원회 차별시정 신청과 교섭 견인으로 바로잡았습니다.</p>
            </div>
            <span class="roadmap-jump no-print">해당 기록 보기 →</span>
          </a>
          <a class="roadmap-step" href="${escapeAttr(safeAnchor('sec-5'))}">
            <div class="roadmap-step-top">
              <span class="roadmap-year">2026</span>
              <h3>재심 인용·대법원 판결</h3>
              <p>단시간 노동자 유급병가 축소 합의를 중앙노동위원회 재심 인용과 조정안 수용으로 바로잡고, 퇴직자 연차수당 부당 삭감 문제 제기의 정당성도 대법원 확정 판결로 증명했습니다.</p>
            </div>
            <span class="roadmap-jump no-print">해당 기록 보기 →</span>
          </a>
          <a class="roadmap-step" href="${escapeAttr(safeAnchor('sec-8'))}">
            <div class="roadmap-step-top">
              <span class="roadmap-year">2026-2030</span>
              <h3>원청 직접 교섭 인정</h3>
              <p>2026년 11월 23일 인천지방노동위원회 인정 결정으로 우정사업본부 직접 교섭 지위를 확보하고 2030년 물류망 재편에 대비합니다.</p>
            </div>
            <span class="roadmap-jump no-print">해당 기록 보기 →</span>
          </a>
        </nav>
        <div class="roadmap-outcome">
          <strong>핵심 원칙</strong>
          <span>교섭권의 제약을 이유로 침묵하지 않고, 법적 권리구제와 현장 연대로 교섭을 견인하며 노동자의 권리를 지켜 왔습니다.</span>
        </div>
      </section>

      ${sectionsHtml}
    </div>

    <section class="history-trust-hub no-print" aria-labelledby="sec-trust-hub">
      <h2 id="sec-trust-hub">노동조합의 오늘을 직접 확인하세요</h2>
      <div class="trust-hub-grid">
        <a class="trust-hub-card" href="${escapeAttr(`${prefix}accounting/index.html`)}">
          <strong>투명한 조합비 회계 공개</strong>
          <p>조합비 수입과 교섭·복지·운영 지출 내역을 1원 단위까지 공개 원장과 결산 보고서로 확인할 수 있습니다.</p>
          <span class="trust-hub-link">회계 대시보드 보기 →</span>
        </a>
        <a class="trust-hub-card" href="${escapeAttr(`${prefix}union/index.html`)}">
          <strong>지부별 조직·임원 현황</strong>
          <p>안양·부평지부 조합원 구성 통계와 현 임기 공식 임원 현황을 공개합니다.</p>
          <span class="trust-hub-link">조직 현황 보기 →</span>
        </a>
        <a class="trust-hub-card" href="${escapeAttr(`${prefix}union/bylaws-guide.html`)}">
          <strong>노동조합 규약 한눈에 보기</strong>
          <p>총회·운영위원회 의결 기준과 조합원의 권리·의무를 시각 요약과 전문으로 열람할 수 있습니다.</p>
          <span class="trust-hub-link">규약 안내 보기 →</span>
        </a>
      </div>
    </section>

    <aside class="document-facts history-colophon" aria-label="문서 정보">
      <dl>
        <div>
          <dt>상태</dt>
          <dd><span class="document-status-badge" data-status="${escapeAttr(doc.workflow.status)}">${escapeHtml(statusLabel)}</span></dd>
        </div>
        <div>
          <dt>최근 검토</dt>
          <dd><time class="document-fact-date" datetime="${escapeAttr(reviewedIso)}">${reviewedDisplay}</time></dd>
        </div>
        <div>
          <dt>근거</dt>
          <dd>${doc.evidence.count}건</dd>
        </div>
        <div class="document-fact-topics">
          <dt>쟁점</dt>
          <dd>${topicLinks}</dd>
        </div>
      </dl>
      ${colophonNote}
    </aside>

    ${linkedLedgerHtml}
    ${relatedHtml}
  </article>
  ${renderDocumentToolsWidget()}`;
}
