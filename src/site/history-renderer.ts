import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { parseYamlFrontMatter } from '../domain/content-graph.js';
import { findMarkdownSyntaxResidues, sanitizeLinkUrl } from './mom-renderer.js';
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

export interface UnionAboutMeta {
  title: string;
  summary: string;
  updatedOn: string;
}

export interface UnionAboutDocument {
  meta: UnionAboutMeta;
  markdown: string;
  sourcePath: string;
}

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

interface HudChip {
  label: string;
  value: string;
  tone?: 'accent' | 'income' | 'expense' | 'grant';
}

interface DiffItem {
  kind: 'change' | 'add';
  text: string;
}

interface LegendItem {
  tone: 'accent' | 'income' | 'expense' | 'grant';
  label: string;
}

interface FocusHint {
  defaultText: string;
  zones: string[];
}

interface SceneDef {
  slug: string;
  actIndex: number;
  stepperLabel: string;
  toneLabel: string;
  tone: 'accent' | 'income' | 'expense' | 'grant';
  legacyIds: string[];
  headline: string;
  paragraphs: string[];
  callout: string;
  diffs: DiffItem[];
  hud: HudChip[];
  legend: LegendItem[];
  svgHtml: string;
  sourceHtml: string;
  focusHint?: FocusHint;
  isFinale?: boolean;
}

const ACTS: Array<{ index: number; label: string; startScene: number }> = [
  { index: 0, label: '1막 · 탄생과 전략', startScene: 0 },
  { index: 1, label: '2막 · 고용 사수', startScene: 2 },
  { index: 2, label: '3막 · 차별 철폐', startScene: 4 },
  { index: 3, label: '4막 · 현장 안전', startScene: 8 },
  { index: 4, label: '5막 · 원청과 2030', startScene: 9 },
];

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

export function loadUnionAboutDocument(projectRoot: string): UnionAboutDocument | null {
  const filePath = path.join(projectRoot, '_source', 'union', 'about.md');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const { metadata, body } = parseYamlFrontMatter(raw, '_source/union/about.md');
  const residues = findMarkdownSyntaxResidues(body);
  if (residues.length > 0) {
    throw new Error(
      `_source/union/about.md:${residues[0]!.line}:${residues[0]!.column} ${residues[0]!.message}`,
    );
  }
  const title =
    typeof metadata.title === 'string' && metadata.title.trim()
      ? metadata.title.trim()
      : '왜 물류노동조합인가 — 9년의 투쟁과 역사';
  const summary = typeof metadata.summary === 'string' ? metadata.summary.trim() : '';
  const updatedOn = typeof metadata.updatedOn === 'string' ? metadata.updatedOn.trim() : '';
  return {
    meta: { title, summary, updatedOn },
    markdown: body,
    sourcePath: filePath,
  };
}

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

function renderSubSectionHtml(sub: SubSection, env: Record<string, unknown>): string {
  const { leadTokens, phases } = splitSubSectionPhases(sub.tokens);
  const leadHtml = leadTokens.length > 0 ? renderTokens(leadTokens, env) : '';
  const phasesHtml = phases
    .map(
      (phase) => `<div class="about-source-phase">
        <h5>${escapeHtml(phase.headingText)}</h5>
        ${renderTokens(phase.tokens, env)}
      </div>`,
    )
    .join('\n');
  return `<section class="about-source-section">
    <h4>${escapeHtml(sub.headingText)}</h4>
    ${leadHtml}
    ${phasesHtml}
  </section>`;
}

function renderChapterSourceHtml(
  ch: Chapter | undefined,
  env: Record<string, unknown>,
  subPrefixFilter?: string[],
): string {
  if (!ch) return '';
  if (subPrefixFilter && subPrefixFilter.length > 0) {
    const matched = ch.subSections.filter((sub) =>
      subPrefixFilter.some((p) => sub.headingText.startsWith(p)),
    );
    return matched.map((sub) => renderSubSectionHtml(sub, env)).join('\n');
  }
  const leadHtml = ch.leadTokens.length > 0 ? renderTokens(ch.leadTokens, env) : '';
  const subsHtml = ch.subSections.map((sub) => renderSubSectionHtml(sub, env)).join('\n');
  return `${leadHtml}${subsHtml}`;
}

/* =========================================================
   12 Bespoke Animated Scene SVGs (680 x 390)
   ========================================================= */

function svgScene01Why(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="서서울·부평·안양 물류지회 설립에서 2021년 물류노동조합 독립 출범과 2026년 중노위·인천지노위 결정으로 이어지는 조직 탄생 도식">
    <defs>
      <marker id="arr-why" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--color-accent)"/>
      </marker>
    </defs>

    <!-- 3 Branch Platforms -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="34" y="42" width="166" height="72" rx="6" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <rect x="34" y="42" width="166" height="6" rx="2" fill="var(--color-accent)"/>
      <text x="50" y="69" class="svg-eyebrow" fill="var(--color-accent)">2017.09.20</text>
      <text x="50" y="90" class="svg-title" fill="var(--color-ink)">서서울물류 지회</text>
      <text x="50" y="105" class="svg-cap" fill="var(--color-muted)">고용 유지 투쟁의 출발</text>
    </g>

    <g class="svg-pop" style="--anim-order:1">
      <rect x="34" y="159" width="166" height="72" rx="6" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <rect x="34" y="159" width="166" height="6" rx="2" fill="var(--color-accent)"/>
      <text x="50" y="186" class="svg-eyebrow" fill="var(--color-accent)">2019.01.12</text>
      <text x="50" y="207" class="svg-title" fill="var(--color-ink)">부평물류 지회</text>
      <text x="50" y="222" class="svg-cap" fill="var(--color-muted)">수도권 거점 조직 확대</text>
    </g>

    <g class="svg-pop" style="--anim-order:2">
      <rect x="34" y="276" width="166" height="72" rx="6" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <rect x="34" y="276" width="166" height="6" rx="2" fill="var(--color-accent)"/>
      <text x="50" y="303" class="svg-eyebrow" fill="var(--color-accent)">2019.06.06</text>
      <text x="50" y="324" class="svg-title" fill="var(--color-ink)">안양물류 지회</text>
      <text x="50" y="339" class="svg-cap" fill="var(--color-muted)">물류사업소 연대 완성</text>
    </g>

    <!-- Animated Signal Pipes -->
    <path class="svg-draw" d="M200 78 C246 78, 238 195, 276 195" fill="none" stroke="var(--color-rule)" stroke-width="2" pathLength="100" stroke-dasharray="100"/>
    <path class="svg-flow" d="M200 78 C246 78, 238 195, 276 195" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="8 8"/>

    <path class="svg-draw" d="M200 195 L276 195" fill="none" stroke="var(--color-rule)" stroke-width="2" pathLength="100" stroke-dasharray="100"/>
    <path class="svg-flow" d="M200 195 L276 195" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="8 8"/>

    <path class="svg-draw" d="M200 312 C246 312, 238 195, 276 195" fill="none" stroke="var(--color-rule)" stroke-width="2" pathLength="100" stroke-dasharray="100"/>
    <path class="svg-flow" d="M200 312 C246 312, 238 195, 276 195" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="8 8"/>

    <!-- Center Independent Union Node -->
    <g class="svg-pop" style="--anim-order:3">
      <rect x="278" y="102" width="194" height="186" rx="8" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="2"/>
      <!-- Mini Hex Emblem -->
      <g transform="translate(352, 120) scale(0.56)">
        <polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="var(--brand-emblem-blue)"/>
        <polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="var(--brand-emblem-ink)"/>
        <polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="var(--brand-emblem-ink)"/>
        <polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="var(--brand-emblem-blue)"/>
      </g>
      <text x="375" y="198" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent-soft-ink)">2021.11.08 독립 출범</text>
      <text x="375" y="220" text-anchor="middle" class="svg-title" fill="var(--color-ink)">물류노동조합</text>
      <text x="375" y="242" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">2021.01 운송·물류 분리</text>
      <text x="375" y="259" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">2025.12 임기 3년 규약 개정</text>
      <text x="375" y="276" text-anchor="middle" class="svg-cap" fill="var(--color-accent)">물류사업소 전담 대변</text>
    </g>

    <!-- Forward Arrow to 2026 -->
    <path class="svg-flow" d="M472 195 L514 195" fill="none" stroke="var(--color-income)" stroke-width="2.5" stroke-dasharray="6 6" marker-end="url(#arr-why)"/>

    <!-- 2026 Outcomes -->
    <g class="svg-pop" style="--anim-order:4">
      <rect x="520" y="96" width="132" height="88" rx="6" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="1.8"/>
      <text x="534" y="122" class="svg-eyebrow" fill="var(--color-income)">2026.09~11</text>
      <text x="534" y="143" class="svg-title" fill="var(--color-ink)">중노위 인용</text>
      <text x="534" y="162" class="svg-cap" fill="var(--color-ink-2)">유급병가 차별 시정</text>
    </g>

    <g class="svg-pop" style="--anim-order:5">
      <rect x="520" y="206" width="132" height="88" rx="6" fill="var(--color-sheet)" stroke="var(--color-income)" stroke-width="1.8"/>
      <text x="534" y="232" class="svg-eyebrow" fill="var(--color-income)">2026.11.23</text>
      <text x="534" y="253" class="svg-title" fill="var(--color-ink)">원청 교섭 인정</text>
      <text x="534" y="272" class="svg-cap" fill="var(--color-ink-2)">우정사업본부 직접 교섭</text>
    </g>
    <path class="svg-flow" d="M492 195 L492 140 L516 140 M492 195 L492 250 L516 250" fill="none" stroke="var(--color-income)" stroke-width="2" stroke-dasharray="6 6"/>
  </svg>`;
}

function svgScene02How(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="교섭창구 단일화 제약을 법적 권리구제, 단체교섭 견인, 차별적 노사합의 감시 3대 경로로 돌파하는 인터랙티브 구조도">
    <!-- Top Problem Node -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="130" y="24" width="420" height="66" rx="6" fill="var(--color-expense-soft)" stroke="var(--color-expense)" stroke-width="1.8"/>
      <text x="340" y="49" text-anchor="middle" class="svg-eyebrow" fill="var(--color-expense)">제도적 제약 · 교섭창구 단일화</text>
      <text x="340" y="72" text-anchor="middle" class="svg-title" fill="var(--color-ink)">교섭참여노조 지위 — 직접 협약 체결권 제한</text>
    </g>

    <!-- Barrier Line -->
    <line x1="60" y1="114" x2="620" y2="114" stroke="var(--color-rule-ui)" stroke-width="2" stroke-dasharray="5 5"/>
    <rect x="262" y="102" width="156" height="24" rx="12" fill="var(--color-well)" stroke="var(--color-rule-ui)"/>
    <text x="340" y="118" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">침묵·타협 없는 돌파</text>

    <!-- 3 Bypass Bridges -->
    <path class="svg-flow" d="M220 90 C130 98, 130 132, 130 156" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="8 7"/>
    <path class="svg-flow" d="M340 90 L340 156" fill="none" stroke="var(--color-income)" stroke-width="2.5" stroke-dasharray="8 7"/>
    <path class="svg-flow" d="M460 90 C550 98, 550 132, 550 156" fill="none" stroke="var(--color-grant)" stroke-width="2.5" stroke-dasharray="8 7"/>

    <!-- Interactive Focus Cards -->
    <g class="svg-zone is-focused" data-focus-zone="0" tabindex="0" role="button" aria-label="1. 법적·제도적 권리구제 직접 신청 자세히 보기">
      <rect x="34" y="158" width="192" height="126" rx="6" fill="var(--color-sheet)" stroke="var(--color-accent)" stroke-width="2"/>
      <rect x="34" y="158" width="192" height="6" rx="2" fill="var(--color-accent)"/>
      <text x="50" y="186" class="svg-num" fill="var(--color-accent)">01</text>
      <text x="50" y="210" class="svg-title" fill="var(--color-ink)">법적·제도적</text>
      <text x="50" y="230" class="svg-title" fill="var(--color-ink)">권리구제 직접 신청</text>
      <text x="50" y="256" class="svg-cap" fill="var(--color-muted)">노동위 차별시정</text>
      <text x="50" y="271" class="svg-cap" fill="var(--color-muted)">고용노동청 진정·고발</text>
    </g>

    <g class="svg-zone" data-focus-zone="1" tabindex="0" role="button" aria-label="2. 차별 시정 의제 제기와 단체교섭 견인 자세히 보기">
      <rect x="244" y="158" width="192" height="126" rx="6" fill="var(--color-sheet)" stroke="var(--color-income)" stroke-width="2"/>
      <rect x="244" y="158" width="192" height="6" rx="2" fill="var(--color-income)"/>
      <text x="260" y="186" class="svg-num" fill="var(--color-income)">02</text>
      <text x="260" y="210" class="svg-title" fill="var(--color-ink)">차별 시정 의제 제기</text>
      <text x="260" y="230" class="svg-title" fill="var(--color-ink)">단체교섭 견인</text>
      <text x="260" y="256" class="svg-cap" fill="var(--color-muted)">법적 판정 → 여론 공론화</text>
      <text x="260" y="271" class="svg-cap" fill="var(--color-muted)">임금·단체협약 개선 유도</text>
    </g>

    <g class="svg-zone" data-focus-zone="2" tabindex="0" role="button" aria-label="3. 차별적 노사합의 감시와 시정 자세히 보기">
      <rect x="454" y="158" width="192" height="126" rx="6" fill="var(--color-sheet)" stroke="var(--color-grant)" stroke-width="2"/>
      <rect x="454" y="158" width="192" height="6" rx="2" fill="var(--color-grant)"/>
      <text x="470" y="186" class="svg-num" fill="var(--color-grant)">03</text>
      <text x="470" y="210" class="svg-title" fill="var(--color-ink)">차별적 노사합의</text>
      <text x="470" y="230" class="svg-title" fill="var(--color-ink)">감시와 시정</text>
      <text x="470" y="256" class="svg-cap" fill="var(--color-muted)">공정대표의무 위반 대응</text>
      <text x="470" y="271" class="svg-cap" fill="var(--color-muted)">단시간·비정규 권익 방어</text>
    </g>

    <!-- Bottom Convergence -->
    <path class="svg-flow" d="M130 284 L130 308 L340 308 M340 284 L340 322 M550 284 L550 308 L340 308" fill="none" stroke="var(--color-accent)" stroke-width="2.2" stroke-dasharray="7 6"/>
    <rect x="110" y="324" width="460" height="44" rx="6" fill="var(--color-accent)"/>
    <text x="340" y="351" text-anchor="middle" class="svg-title" fill="var(--color-accent-ink)">현장 차별 인정 · 전액 소급 · 제도 개선 관철</text>
  </svg>`;
}

function svgScene03Spark2017(): string {
  const personDots = [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 52 + col * 40;
      const y = 165 + row * 48;
      return `<g class="svg-pop" style="--anim-order:${i}">
        <circle cx="${x}" cy="${y}" r="8" fill="var(--color-expense)"/>
        <path d="M${x - 10} ${y + 22} C${x - 10} ${y + 11}, ${x + 10} ${y + 11}, ${x + 10} ${y + 22} Z" fill="var(--color-expense)" opacity="0.85"/>
      </g>`;
    })
    .join('');

  const wonDots = [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 510 + col * 42;
      const y = 165 + row * 48;
      return `<g class="svg-pop" style="--anim-order:${i + 2}">
        <circle cx="${x}" cy="${y}" r="8" fill="var(--color-income)"/>
        <path d="M${x - 10} ${y + 22} C${x - 10} ${y + 11}, ${x + 10} ${y + 11}, ${x + 10} ${y + 22} Z" fill="var(--color-income)"/>
      </g>`;
    })
    .join('');

  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="2017년 7월 28일 서서울물류사업소 기간제 6명 계약 만료 통보 위기에서 국회 방문·긴급 면담을 거쳐 전원 고용 연장과 공동 서명을 이룬 변화">
    <!-- Crisis Platform -->
    <rect x="24" y="54" width="166" height="278" rx="8" fill="var(--color-expense-soft)" stroke="var(--color-expense)" stroke-width="1.8"/>
    <text x="107" y="84" text-anchor="middle" class="svg-eyebrow" fill="var(--color-expense)">2017.07.28 오전 · 위기</text>
    <text x="107" y="106" text-anchor="middle" class="svg-title" fill="var(--color-ink)">계약 종료 통보</text>
    <text x="107" y="126" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">1개월 단위 쪼개기 계약</text>
    ${personDots}
    <text x="107" y="294" text-anchor="middle" class="svg-cap" fill="var(--color-expense)">7.31 자 만료 통보</text>
    <text x="107" y="311" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">송별회 · 체념 분위기</text>

    <!-- Flow Arrow 1 -->
    <path class="svg-flow" d="M192 193 L242 193" fill="none" stroke="var(--color-accent)" stroke-width="3" stroke-dasharray="8 6"/>

    <!-- Action Shield -->
    <g class="svg-pop" style="--anim-order:1">
      <rect x="244" y="64" width="192" height="258" rx="8" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="2"/>
      <text x="340" y="96" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent-soft-ink)">같은 날 오후 4~6시</text>
      <text x="340" y="120" text-anchor="middle" class="svg-title" fill="var(--color-ink)">국회 방문·긴급 면담</text>
      <rect x="262" y="142" width="156" height="52" rx="4" fill="var(--color-sheet)" stroke="var(--color-accent)"/>
      <text x="340" y="164" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">국회 환노위 의원실 방문</text>
      <text x="340" y="182" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">비서관 배석 노사 면담</text>
      <rect x="262" y="210" width="156" height="86" rx="4" fill="var(--color-sheet)" stroke="var(--color-rule-strong)"/>
      <text x="340" y="234" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent)">현장 지침</text>
      <text x="340" y="256" text-anchor="middle" class="svg-title" fill="var(--color-ink)">개별 접촉 차단</text>
      <text x="340" y="276" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">"6명 전원 함께 서명"</text>
    </g>

    <!-- Flow Arrow 2 -->
    <path class="svg-flow" d="M438 193 L486 193" fill="none" stroke="var(--color-income)" stroke-width="3" stroke-dasharray="8 6"/>

    <!-- Victory Platform -->
    <rect x="488" y="54" width="168" height="278" rx="8" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="2"/>
    <text x="572" y="84" text-anchor="middle" class="svg-eyebrow" fill="var(--color-income)">공동 서명 · 승리</text>
    <text x="572" y="106" text-anchor="middle" class="svg-title" fill="var(--color-ink)">6명 전원 고용 유지</text>
    <text x="572" y="126" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">체념을 깬 자체 조직 출발</text>
    ${wonDots}
    <text x="572" y="290" text-anchor="middle" class="svg-cap" fill="var(--color-income)">하루 8시간 전일제 보장</text>
    <text x="572" y="308" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">무기계약직 전환 추진 합의</text>
  </svg>`;
}

function svgScene04Jobs2021(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="2021년 3.9 투쟁 115명 계약 연장과 100여 명 공무직 전환, 서서울 폐국 전원 고용승계, 2030 근속 인정 소송 연대">
    <!-- Top Conversion Gauge Band -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="30" y="24" width="620" height="122" rx="8" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <text x="50" y="52" class="svg-eyebrow" fill="var(--color-income)">2021.03.09 본사 앞 긴급 기자회견 · 집단 해고 저지</text>
      <text x="50" y="75" class="svg-title" fill="var(--color-ink)">기간제 115명 전원 계약 연장 → 100여 명 공무직 대규모 전환</text>
      <rect x="50" y="94" width="580" height="24" rx="4" fill="var(--color-well)" stroke="var(--color-rule)"/>
      <rect class="svg-bar-x" x="50" y="94" width="580" height="24" rx="4" fill="var(--color-accent)" opacity="0.22"/>
      <rect class="svg-bar-x" x="50" y="94" width="504" height="24" rx="4" fill="var(--color-income)"/>
      <text x="64" y="110" class="svg-cap" fill="var(--color-accent-ink)">상시·지속 업무 9개월 이상 공무직 전환 기준 (100여 명 전환)</text>
      <text x="618" y="110" text-anchor="end" class="svg-cap" fill="var(--color-ink)">115명 전원 연장</text>
    </g>

    <!-- Middle 2022-2023 Succession Flow -->
    <path class="svg-flow" d="M340 146 L340 172" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="6 6"/>

    <g class="svg-pop" style="--anim-order:1">
      <rect x="30" y="174" width="246" height="90" rx="6" fill="var(--color-well)" stroke="var(--color-rule-strong)"/>
      <text x="48" y="199" class="svg-eyebrow" fill="var(--color-accent)">2022–2023 서서울물류사업소 폐국</text>
      <text x="48" y="221" class="svg-title" fill="var(--color-ink)">2023.06 집단 연차 투쟁</text>
      <text x="48" y="241" class="svg-cap" fill="var(--color-muted)">규탄 성명 및 고용 보장 확약 요구</text>
    </g>

    <path class="svg-flow" d="M276 219 L348 219" fill="none" stroke="var(--color-income)" stroke-width="3" stroke-dasharray="8 6"/>

    <g class="svg-pop" style="--anim-order:2">
      <rect x="350" y="174" width="300" height="90" rx="6" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="1.8"/>
      <text x="370" y="199" class="svg-eyebrow" fill="var(--color-income)">희망퇴직 제외 전원 고용승계</text>
      <text x="370" y="221" class="svg-title" fill="var(--color-ink)">부천우편집중국 · 부평사업소</text>
      <text x="370" y="241" class="svg-cap" fill="var(--color-ink-2)">2022년 3월 입사자 포함 전원 승계</text>
    </g>

    <!-- Bottom 2024-2026 Continuity Solidarity -->
    <path class="svg-flow" d="M500 264 L500 288" fill="none" stroke="var(--color-expense)" stroke-width="2.5" stroke-dasharray="6 6"/>

    <g class="svg-pop" style="--anim-order:3">
      <rect x="30" y="290" width="620" height="76" rx="6" fill="var(--color-expense-soft)" stroke="var(--color-expense)" stroke-width="1.6"/>
      <text x="50" y="316" class="svg-eyebrow" fill="var(--color-expense)">2024–2026 진행 · 2030년 부천 폐국·광역센터 통합 대비 선례</text>
      <text x="50" y="340" class="svg-title" fill="var(--color-ink)">우정사업본부 공무직노조 근속 인정 소송 연대 — "고용승계 시 100% 근속 인정"</text>
    </g>
  </svg>`;
}

function svgScene05AllowanceBonus(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="기간제 노동자 직무수당·가족수당 차별시정 소급 지급 및 경영평가 성과급 공무직 동일 지급률 100% 관철 비교">
    <!-- Left Card: Allowances -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="28" y="30" width="300" height="330" rx="8" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <rect x="28" y="30" width="300" height="6" rx="2" fill="var(--color-accent)"/>
      <text x="48" y="62" class="svg-eyebrow" fill="var(--color-accent)">2018.11~2019.05 · 2022</text>
      <text x="48" y="86" class="svg-title" fill="var(--color-ink)">직무수당 · 가족수당 차별 시정</text>

      <!-- Before vs After Bar -->
      <text x="48" y="126" class="svg-cap" fill="var(--color-muted)">2017.09 신설 당시 기간제</text>
      <rect x="48" y="136" width="260" height="28" rx="4" fill="var(--color-expense-soft)" stroke="var(--color-expense)"/>
      <text x="60" y="155" class="svg-cap" fill="var(--color-expense)">지급 대상 제외 (0%)</text>

      <path class="svg-flow" d="M178 168 L178 192" fill="none" stroke="var(--color-income)" stroke-width="2.5" stroke-dasharray="5 5"/>

      <text x="48" y="210" class="svg-cap" fill="var(--color-income)">2019.05 서울지노위 조정 노사합의</text>
      <rect x="48" y="220" width="260" height="32" rx="4" fill="var(--color-well)"/>
      <rect class="svg-bar-x" x="48" y="220" width="260" height="32" rx="4" fill="var(--color-income)"/>
      <text x="60" y="241" class="svg-cap" fill="var(--color-accent-ink)">차별 인정 · 2018분 전액 소급 (100%)</text>

      <rect x="48" y="274" width="260" height="66" rx="4" fill="var(--color-accent-soft)" stroke="var(--color-accent)"/>
      <text x="62" y="297" class="svg-eyebrow" fill="var(--color-accent-soft-ink)">2022 교섭 견인 추가 성과</text>
      <text x="62" y="317" class="svg-cap" fill="var(--color-ink)">둘째 자녀 가족수당 2만 → 4만원</text>
      <text x="62" y="332" class="svg-cap" fill="var(--color-muted)">셋째 자녀 이상 가산금 신설</text>
    </g>

    <!-- Right Card: Performance Bonus -->
    <g class="svg-pop" style="--anim-order:1">
      <rect x="352" y="30" width="300" height="330" rx="8" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <rect x="352" y="30" width="300" height="6" rx="2" fill="var(--color-income)"/>
      <text x="372" y="62" class="svg-eyebrow" fill="var(--color-income)">2022 ~ 2023.09.19</text>
      <text x="372" y="86" class="svg-title" fill="var(--color-ink)">경영평가 성과급 동일 지급률</text>

      <text x="372" y="126" class="svg-cap" fill="var(--color-muted)">기존 기간제 차별 지급</text>
      <rect x="372" y="136" width="260" height="28" rx="4" fill="var(--color-expense-soft)" stroke="var(--color-expense)"/>
      <text x="384" y="155" class="svg-cap" fill="var(--color-expense)">공무직 대비 차등·제외</text>

      <path class="svg-flow" d="M502 168 L502 192" fill="none" stroke="var(--color-income)" stroke-width="2.5" stroke-dasharray="5 5"/>

      <text x="372" y="210" class="svg-cap" fill="var(--color-income)">2023.07 손해액 2배 배상 예고 → 관철</text>
      <rect x="372" y="220" width="260" height="32" rx="4" fill="var(--color-well)"/>
      <rect class="svg-bar-x" x="372" y="220" width="260" height="32" rx="4" fill="var(--color-income)"/>
      <text x="384" y="241" class="svg-cap" fill="var(--color-accent-ink)">공무직과 동일 지급률 100% 지급</text>

      <rect x="372" y="274" width="260" height="66" rx="4" fill="var(--color-income-soft)" stroke="var(--color-income)"/>
      <text x="386" y="297" class="svg-eyebrow" fill="var(--color-income)">2023.09.19 지급 범위</text>
      <text x="386" y="317" class="svg-cap" fill="var(--color-ink)">2022년도 경영평가 성과급</text>
      <text x="386" y="332" class="svg-cap" fill="var(--color-ink-2)">6개월 이상 근무 후 퇴사자 포함</text>
    </g>
  </svg>`;
}

function svgScene06Welfare(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="단시간 복지포인트 20만 포인트 삭감에서 2020년 차액 소급, 2022년 50만 포인트 인상, 2024년 정규직 동일 평준화까지의 계단 상승 차트">
    <!-- Baseline & Reference Grid -->
    <line x1="64" y1="88" x2="636" y2="88" stroke="var(--color-rule)" stroke-dasharray="4 4"/>
    <text x="54" y="92" text-anchor="end" class="svg-cap" fill="var(--color-income)">정규직 동일</text>
    <line x1="64" y1="164" x2="636" y2="164" stroke="var(--color-rule)" stroke-dasharray="4 4"/>
    <text x="54" y="168" text-anchor="end" class="svg-cap" fill="var(--color-muted)">50만P</text>
    <line x1="64" y1="240" x2="636" y2="240" stroke="var(--color-rule)" stroke-dasharray="4 4"/>
    <text x="54" y="244" text-anchor="end" class="svg-cap" fill="var(--color-muted)">30만P</text>
    <line x1="64" y1="316" x2="636" y2="316" stroke="var(--color-rule-strong)" stroke-width="1.5"/>

    <!-- Step 1: 2017 Cut -->
    <g class="svg-bar" style="--anim-order:0; transform-origin: 140px 316px">
      <rect x="96" y="256" width="88" height="60" rx="3" fill="var(--color-expense)" opacity="0.9"/>
      <text x="140" y="234" text-anchor="middle" class="svg-title" fill="var(--color-expense)">20만P</text>
      <text x="140" y="338" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">2017.09</text>
      <text x="140" y="354" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">단시간 일방 삭감</text>
    </g>

    <!-- Step 2: 2020 Retroactive Recovery -->
    <g class="svg-bar" style="--anim-order:1; transform-origin: 280px 316px">
      <rect x="236" y="214" width="88" height="102" rx="3" fill="var(--color-accent)" opacity="0.78"/>
      <text x="280" y="192" text-anchor="middle" class="svg-title" fill="var(--color-accent)">30만P 환수</text>
      <text x="280" y="338" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">2020.01.15</text>
      <text x="280" y="354" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">18·19 차액 소급</text>
    </g>

    <!-- Step 3: 2022 Increase -->
    <g class="svg-bar" style="--anim-order:2; transform-origin: 420px 316px">
      <rect x="376" y="160" width="88" height="156" rx="3" fill="var(--color-accent)"/>
      <text x="420" y="138" text-anchor="middle" class="svg-title" fill="var(--color-accent)">50만P</text>
      <text x="420" y="338" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">2022 임금교섭</text>
      <text x="420" y="354" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">동일 근속 기준</text>
    </g>

    <!-- Step 4: 2024 Parity -->
    <g class="svg-bar" style="--anim-order:3; transform-origin: 564px 316px">
      <rect x="516" y="88" width="96" height="228" rx="3" fill="var(--color-income)"/>
      <text x="564" y="66" text-anchor="middle" class="svg-title" fill="var(--color-income)">+20만P 평준화</text>
      <text x="564" y="338" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">2024 임금협약</text>
      <text x="564" y="354" text-anchor="middle" class="svg-cap" fill="var(--color-income)">정규직과 동일</text>
    </g>

    <!-- Rising Trend Line along Bar Tops -->
    <path class="svg-draw" d="M140 256 L280 214 L420 160 L564 88" fill="none" stroke="var(--color-ink)" stroke-width="2" pathLength="100" stroke-dasharray="100"/>
    <circle cx="140" cy="256" r="4" fill="var(--color-expense)" stroke="var(--color-sheet)" stroke-width="1.5"/>
    <circle cx="280" cy="214" r="4" fill="var(--color-accent)" stroke="var(--color-sheet)" stroke-width="1.5"/>
    <circle cx="420" cy="160" r="4" fill="var(--color-accent)" stroke="var(--color-sheet)" stroke-width="1.5"/>
    <circle cx="564" cy="88" r="6" fill="var(--color-income)" stroke="var(--color-sheet)" stroke-width="2"/>
  </svg>`;
}

function svgScene07SickLeave(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="2019년 발착직 유급병가 확대와 2022년 제수당 100% 보전, 2025년 말 단시간 30일 축소 합의에 대한 2026년 9월 중노위 재심 인용 및 조정안 수용">
    <!-- Top Historical Foundation -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="30" y="24" width="620" height="70" rx="6" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="1.5"/>
      <text x="50" y="49" class="svg-eyebrow" fill="var(--color-accent-soft-ink)">2019.02 확대 적용 → 2022.02.22 제수당 100% 보전</text>
      <text x="50" y="73" class="svg-title" fill="var(--color-ink)">발착직 유급병가 도입 및 병가 중 제수당 일할 공제 폐지</text>
    </g>

    <!-- 2025 Discrimination Drop -->
    <g class="svg-pop" style="--anim-order:1">
      <rect x="30" y="114" width="250" height="148" rx="6" fill="var(--color-expense-soft)" stroke="var(--color-expense)" stroke-width="1.8"/>
      <text x="48" y="140" class="svg-eyebrow" fill="var(--color-expense)">2025 말 · 차별적 노사합의</text>
      <text x="48" y="164" class="svg-title" fill="var(--color-ink)">단시간 병가 60일 → 30일</text>
      <!-- 60 vs 30 gauge -->
      <rect x="48" y="182" width="214" height="14" rx="2" fill="var(--color-sheet)" stroke="var(--color-rule)"/>
      <rect x="48" y="182" width="214" height="14" rx="2" fill="var(--color-muted)" opacity="0.35"/>
      <rect x="48" y="182" width="107" height="14" rx="2" fill="var(--color-expense)"/>
      <text x="48" y="218" class="svg-cap" fill="var(--color-ink-2)">단시간(비율 약 3.6%) 건강권 축소</text>
      <text x="48" y="236" class="svg-cap" fill="var(--color-muted)">진단서·소견서 증빙 요건 강화</text>
    </g>

    <!-- Center Solidarity & Legal Path -->
    <path class="svg-flow" d="M280 188 L330 188" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-dasharray="6 5"/>

    <g class="svg-pop" style="--anim-order:2">
      <rect x="332" y="114" width="136" height="148" rx="6" fill="var(--color-sheet)" stroke="var(--color-rule-strong)"/>
      <text x="400" y="140" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent)">현장 연대</text>
      <text x="400" y="164" text-anchor="middle" class="svg-title" fill="var(--color-ink)">재심 반박</text>
      <text x="400" y="190" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">안양·부평 연대 서명</text>
      <text x="400" y="208" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">2026.05 지노위 기각</text>
      <text x="400" y="226" text-anchor="middle" class="svg-cap" fill="var(--color-accent)">중노위 재심 신청</text>
    </g>

    <path class="svg-flow" d="M468 188 L508 188" fill="none" stroke="var(--color-income)" stroke-width="2.8" stroke-dasharray="6 5"/>

    <!-- NLRC Win -->
    <g class="svg-pop" style="--anim-order:3">
      <rect x="510" y="114" width="140" height="148" rx="6" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="2"/>
      <text x="580" y="140" text-anchor="middle" class="svg-eyebrow" fill="var(--color-income)">2026.09~11</text>
      <text x="580" y="164" text-anchor="middle" class="svg-title" fill="var(--color-ink)">중노위 인용</text>
      <text x="580" y="190" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">위법 차별 인정</text>
      <text x="580" y="210" text-anchor="middle" class="svg-cap" fill="var(--color-income)">조정안 최종 수용</text>
      <text x="580" y="230" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">권리 회복 확정</text>
    </g>

    <!-- Bottom Takeaway Bar -->
    <rect x="30" y="286" width="620" height="72" rx="6" fill="var(--color-sheet)" stroke="var(--color-income)" stroke-width="1.6"/>
    <text x="340" y="315" text-anchor="middle" class="svg-eyebrow" fill="var(--color-income)">판정의 의미</text>
    <text x="340" y="338" text-anchor="middle" class="svg-title" fill="var(--color-ink)">교섭대표노조와 사측의 합의라도 법적 절차로 차별을 시정할 수 있음을 증명</text>
  </svg>`;
}

function svgScene08WagesCourt(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="2017년·2019년 임금 원칙 확립에서 2024년 2월 물류노동조합 단독 고용노동청 신고를 거쳐 2026년 6월 대법원 확정 판결로 정당성이 입증된 흐름">
    <!-- Top Principle Card -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="30" y="24" width="620" height="82" rx="6" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.5"/>
      <text x="50" y="51" class="svg-eyebrow" fill="var(--color-accent)">2017 · 2019 임금 원칙</text>
      <text x="50" y="75" class="svg-title" fill="var(--color-ink)">"임금은 기다려 받는 혜택이 아니라 정해진 시점에 지급할 확정 채무"</text>
      <text x="50" y="94" class="svg-cap" fill="var(--color-muted)">2017 급여 인상분 조속 반영 · 2019 기존 수당 최저임금 산입 시도 차단</text>
    </g>

    <!-- 2024 Solo Filing -->
    <path class="svg-flow" d="M180 106 L180 142" fill="none" stroke="var(--color-expense)" stroke-width="2.5" stroke-dasharray="6 5"/>

    <g class="svg-pop" style="--anim-order:1">
      <rect x="30" y="144" width="286" height="196" rx="8" fill="var(--color-expense-soft)" stroke="var(--color-expense)" stroke-width="1.8"/>
      <text x="50" y="174" class="svg-eyebrow" fill="var(--color-expense)">2024.02 · 서서울 폐국·퇴직</text>
      <text x="50" y="198" class="svg-title" fill="var(--color-ink)">물류노조 단독 노동청 신고</text>
      <text x="50" y="226" class="svg-cap" fill="var(--color-ink-2)">• 회계연도 기준(12.16) 발생 연차 임의 삭감</text>
      <text x="50" y="246" class="svg-cap" fill="var(--color-ink-2)">• 동의 없이 마지막 급여에서 연차수당 공제</text>
      <text x="50" y="274" class="svg-cap" fill="var(--color-expense)">「단체협약 위반 및 임금체불」 정식 신고</text>
      <text x="50" y="294" class="svg-cap" fill="var(--color-muted)">교섭대표노조·사측 소극 태도로 미해결 지속</text>
    </g>

    <!-- Bridge to Supreme Court -->
    <path class="svg-flow" d="M316 242 L362 242" fill="none" stroke="var(--color-income)" stroke-width="3" stroke-dasharray="8 6"/>

    <!-- 2026 Supreme Court Ruling + Balance Scale -->
    <g class="svg-pop" style="--anim-order:2">
      <rect x="364" y="144" width="286" height="196" rx="8" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="2"/>
      <!-- Scale Icon -->
      <g transform="translate(570, 162)" fill="none" stroke="var(--color-income)" stroke-width="2">
        <line x1="26" y1="6" x2="26" y2="48"/>
        <line x1="8" y1="14" x2="44" y2="14"/>
        <path d="M8 14 L2 30 L14 30 Z M44 14 L38 30 L50 30 Z"/>
        <line x1="16" y1="48" x2="36" y2="48"/>
      </g>
      <text x="384" y="174" class="svg-eyebrow" fill="var(--color-income)">2026.06 · 동종 사건</text>
      <text x="384" y="198" class="svg-title" fill="var(--color-ink)">대법원 확정 판결</text>
      <text x="384" y="226" class="svg-cap" fill="var(--color-ink)">별도 정산 규정이 없으면 퇴직 시에도</text>
      <text x="384" y="246" class="svg-cap" fill="var(--color-ink)">회계연도 기준 연차 100% 지급 확정</text>
      <rect x="384" y="268" width="244" height="50" rx="4" fill="var(--color-sheet)" stroke="var(--color-income)"/>
      <text x="506" y="290" text-anchor="middle" class="svg-eyebrow" fill="var(--color-income)">일방 삭감은 위법·무효</text>
      <text x="506" y="307" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">2년 전 단독 신고의 정당성 입증</text>
    </g>
  </svg>`;
}

function svgScene09Workplace(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="물류 현장 작업환경 4대 개선: 기계 가동 중단 휴게, 불법 연차 금지 저지, 시멘트 분진 바닥 코팅, 부평 환기구 덕트 하향 인출 배관 공사">
    <!-- Zone 1: Conveyor Pause -->
    <g class="svg-zone is-focused" data-focus-zone="0" tabindex="0" role="button" aria-label="7.1 기계 가동 중단을 통한 휴게시간 확보 보기">
      <rect x="28" y="24" width="302" height="162" rx="8" fill="var(--color-sheet)" stroke="var(--color-accent)" stroke-width="2"/>
      <text x="46" y="52" class="svg-eyebrow" fill="var(--color-accent)">7.1 휴게시간 보장</text>
      <text x="46" y="76" class="svg-title" fill="var(--color-ink)">구분 기계 가동 전면 중단</text>
      <!-- Conveyor Graphic -->
      <rect x="48" y="96" width="220" height="18" rx="9" fill="var(--color-well)" stroke="var(--color-rule-strong)"/>
      <rect x="68" y="80" width="24" height="16" rx="2" fill="var(--color-accent)" opacity="0.85"/>
      <rect x="116" y="80" width="24" height="16" rx="2" fill="var(--color-accent)" opacity="0.85"/>
      <!-- Pause Badge -->
      <circle cx="294" cy="105" r="14" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="1.5"/>
      <rect x="289" y="98" width="3.5" height="14" fill="var(--color-accent)"/>
      <rect x="295.5" y="98" width="3.5" height="14" fill="var(--color-accent)"/>
      <text x="46" y="142" class="svg-cap" fill="var(--color-ink-2)">과거: 오후 7시 이후 교대 휴게 관행</text>
      <text x="46" y="160" class="svg-cap" fill="var(--color-accent)">현재: 전 사업소 휴게시간 동시 정지·휴식</text>
    </g>

    <!-- Zone 2: Annual Leave Ban Defeated -->
    <g class="svg-zone" data-focus-zone="1" tabindex="0" role="button" aria-label="7.2 불법적 연차 금지 통보 저지 보기">
      <rect x="350" y="24" width="302" height="162" rx="8" fill="var(--color-sheet)" stroke="var(--color-expense)" stroke-width="2"/>
      <text x="368" y="52" class="svg-eyebrow" fill="var(--color-expense)">7.2 휴식권 사수 (2026.07.31)</text>
      <text x="368" y="76" class="svg-title" fill="var(--color-ink)">특정일 연차 금지 일방 통보 저지</text>
      <rect x="368" y="92" width="112" height="44" rx="4" fill="var(--color-expense-soft)" stroke="var(--color-expense)"/>
      <text x="424" y="111" text-anchor="middle" class="svg-cap" fill="var(--color-expense)">8.3 연차 전면 금지</text>
      <text x="424" y="126" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">사측 일방 통보</text>
      <path class="svg-flow" d="M482 114 L518 114" fill="none" stroke="var(--color-income)" stroke-width="2.5" stroke-dasharray="5 4"/>
      <rect x="520" y="92" width="114" height="44" rx="4" fill="var(--color-income-soft)" stroke="var(--color-income)"/>
      <text x="577" y="111" text-anchor="middle" class="svg-cap" fill="var(--color-income)">즉각 성명 발표</text>
      <text x="577" y="126" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">권리침해 선언·저지</text>
      <text x="368" y="160" class="svg-cap" fill="var(--color-ink-2)">「사용자에게 연차휴가를 금지할 권한은 없다」</text>
    </g>

    <!-- Zone 3: Dust Floor Coating -->
    <g class="svg-zone" data-focus-zone="2" tabindex="0" role="button" aria-label="7.3 서서울 지하 작업장 시멘트 분진 차단 바닥 코팅 공사 보기">
      <rect x="28" y="204" width="302" height="162" rx="8" fill="var(--color-sheet)" stroke="var(--color-grant)" stroke-width="2"/>
      <text x="46" y="232" class="svg-eyebrow" fill="var(--color-grant)">7.3 호흡기 안전</text>
      <text x="46" y="256" class="svg-title" fill="var(--color-ink)">지하 작업장 시멘트 분진 차단</text>
      <rect x="46" y="286" width="266" height="16" rx="2" fill="var(--color-accent-soft)" stroke="var(--color-accent)"/>
      <text x="179" y="298" text-anchor="middle" class="svg-cap" fill="var(--color-accent-soft-ink)">예산 반영 · 바닥 전체 코팅 시공 완료</text>
      <text x="46" y="328" class="svg-cap" fill="var(--color-ink-2)">임시 마스크 지급 대책 거부</text>
      <text x="46" y="346" class="svg-cap" fill="var(--color-muted)">양천우체국 지하 주차장 근본 설비 개선</text>
    </g>

    <!-- Zone 4: Bupyeong Ceiling Duct Cooling -->
    <g class="svg-zone" data-focus-zone="3" tabindex="0" role="button" aria-label="7.4 혹서기 건강권 및 부평물류사업소 냉방 덕트 하향 인출 공사 보기">
      <rect x="350" y="204" width="302" height="162" rx="8" fill="var(--color-sheet)" stroke="var(--color-income)" stroke-width="2"/>
      <text x="368" y="232" class="svg-eyebrow" fill="var(--color-income)">7.4 혹서·혹한기 &amp; 2026.10 협의</text>
      <text x="368" y="256" class="svg-title" fill="var(--color-ink)">부평 환기구 덕트 하향 인출 공사</text>
      <!-- Ceiling Duct & Cool Airflow Arrows -->
      <path d="M372 276 L596 276 L596 296 L568 296 L568 310" fill="none" stroke="var(--color-accent)" stroke-width="6" stroke-linecap="round"/>
      <path class="svg-flow" d="M568 314 L568 346 M548 320 L548 346 M588 320 L588 346" fill="none" stroke="var(--color-accent)" stroke-width="2.2" stroke-dasharray="5 5"/>
      <text x="368" y="314" class="svg-cap" fill="var(--color-ink-2)">이온음료·난방기구 배치</text>
      <text x="368" y="332" class="svg-cap" fill="var(--color-income)">2027.05 말 완공 목표</text>
      <text x="368" y="349" class="svg-cap" fill="var(--color-muted)">작업자 위치로 냉기 직접 공급</text>
    </g>
  </svg>`;
}

function svgScene10PrincipalWin(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="4대 실증 자료로 원청 우정사업본부의 교섭 배제와 법무법인 태평양 주장을 반박하고 2026년 11월 23일 인천지방노동위원회 교섭참여 노동조합 인정을 받아낸 구조">
    <!-- Left: Union & 4 Evidence Cards -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="24" y="54" width="166" height="282" rx="8" fill="var(--color-accent-soft)" stroke="var(--color-accent)" stroke-width="2"/>
      <text x="107" y="88" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent-soft-ink)">개정 노조법 제2·3조</text>
      <text x="107" y="112" text-anchor="middle" class="svg-title" fill="var(--color-ink)">물류노동조합</text>
      <rect x="40" y="138" width="134" height="58" rx="4" fill="var(--color-sheet)" stroke="var(--color-rule)"/>
      <text x="107" y="162" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">10.24 원청 교섭 배제</text>
      <text x="107" y="180" text-anchor="middle" class="svg-cap" fill="var(--color-expense)">이의신청마저 거부</text>
      <rect x="40" y="214" width="134" height="96" rx="4" fill="var(--color-sheet)" stroke="var(--color-accent)"/>
      <text x="107" y="238" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent)">11.02 시정신청</text>
      <text x="107" y="259" text-anchor="middle" class="svg-cap" fill="var(--color-ink)">원청 대리인</text>
      <text x="107" y="276" text-anchor="middle" class="svg-cap" fill="var(--color-muted)">(법무법인 태평양)</text>
      <text x="107" y="294" text-anchor="middle" class="svg-cap" fill="var(--color-accent)">주장 전면 반박</text>
    </g>

    <!-- Center: 4 Empirical Proof Pillars Breaking the Wall -->
    <path class="svg-flow" d="M190 195 L234 195" fill="none" stroke="var(--color-accent)" stroke-width="3" stroke-dasharray="6 5"/>

    <g class="svg-pop" style="--anim-order:1">
      <rect x="236" y="42" width="212" height="306" rx="8" fill="var(--color-sheet)" stroke="var(--color-rule-strong)" stroke-width="1.6"/>
      <text x="342" y="69" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent)">4대 실증 입증</text>

      <rect x="252" y="84" width="180" height="52" rx="4" fill="var(--color-well)" stroke="var(--color-rule)"/>
      <text x="266" y="106" class="svg-title" fill="var(--color-ink)">1. 절차적 위법성</text>
      <text x="266" y="124" class="svg-cap" fill="var(--color-muted)">확정 공고 일방 제외 위법</text>

      <rect x="252" y="146" width="180" height="52" rx="4" fill="var(--color-well)" stroke="var(--color-rule)"/>
      <text x="266" y="168" class="svg-title" fill="var(--color-ink)">2. 국유재산 물적 지배</text>
      <text x="266" y="186" class="svg-cap" fill="var(--color-muted)">부평·안양 물류사업소</text>

      <rect x="252" y="208" width="180" height="52" rx="4" fill="var(--color-well)" stroke="var(--color-rule)"/>
      <text x="266" y="230" class="svg-title" fill="var(--color-ink)">3. 매출 99.9% 전속성</text>
      <text x="266" y="248" class="svg-cap" fill="var(--color-muted)">우체국물류지원단 전속 구조</text>

      <rect x="252" y="270" width="180" height="52" rx="4" fill="var(--color-well)" stroke="var(--color-rule)"/>
      <text x="266" y="292" class="svg-title" fill="var(--color-ink)">4. 인사·지배구조 종속</text>
      <text x="266" y="310" class="svg-cap" fill="var(--color-muted)">실질적 사용자성 입증</text>
    </g>

    <!-- Direct Bridge Open -->
    <path class="svg-flow" d="M448 195 L490 195" fill="none" stroke="var(--color-income)" stroke-width="3.5" stroke-dasharray="8 6"/>

    <!-- Right: Principal Employer Table -->
    <g class="svg-pop" style="--anim-order:2">
      <rect x="492" y="72" width="164" height="246" rx="8" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="2"/>
      <text x="574" y="106" text-anchor="middle" class="svg-eyebrow" fill="var(--color-income)">2026.11.23 결정</text>
      <text x="574" y="132" text-anchor="middle" class="svg-title" fill="var(--color-ink)">인천지노위 인정</text>
      <line x1="512" y1="150" x2="636" y2="150" stroke="var(--color-income)" opacity="0.4"/>
      <text x="574" y="180" text-anchor="middle" class="svg-title" fill="var(--color-income)">원청</text>
      <text x="574" y="202" text-anchor="middle" class="svg-title" fill="var(--color-ink)">우정사업본부</text>
      <text x="574" y="228" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">교섭참여 노동조합</text>
      <text x="574" y="246" text-anchor="middle" class="svg-cap" fill="var(--color-ink-2)">공식 지위 확보</text>
      <rect x="512" y="266" width="124" height="30" rx="4" fill="var(--color-income)"/>
      <text x="574" y="286" text-anchor="middle" class="svg-cap" fill="var(--color-accent-ink)">직접 교섭 문 개방</text>
    </g>
  </svg>`;
}

function svgScene11Vision2030(): string {
  return `<svg class="about-scene-svg" viewBox="0 0 680 390" role="img" aria-label="원청 우정사업본부 직접 교섭 3대 과제와 2030년 수도권 광역물류센터 신설·부천 폐국·부평 리모델링 대비 100% 고용승계 계획">
    <!-- Top Hub -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="170" y="22" width="340" height="58" rx="6" fill="var(--color-accent)" />
      <text x="340" y="46" text-anchor="middle" class="svg-eyebrow" fill="var(--color-accent-ink)" opacity="0.9">건물 · 설비 · 예산 권한 주체</text>
      <text x="340" y="67" text-anchor="middle" class="svg-title" fill="var(--color-accent-ink)">우정사업본부 원청 직접 교섭 3대 과제</text>
    </g>

    <path class="svg-flow" d="M340 80 L340 100 M130 100 L550 100 M130 100 L130 120 M340 100 L340 120 M550 100 L550 120" fill="none" stroke="var(--color-accent)" stroke-width="2.2" stroke-dasharray="6 5"/>

    <!-- 3 Tasks -->
    <g class="svg-pop" style="--anim-order:1">
      <rect x="30" y="122" width="198" height="96" rx="6" fill="var(--color-sheet)" stroke="var(--color-accent)" stroke-width="1.6"/>
      <text x="48" y="149" class="svg-eyebrow" fill="var(--color-accent)">과제 01</text>
      <text x="48" y="172" class="svg-title" fill="var(--color-ink)">냉·난방·공조 개선</text>
      <text x="48" y="194" class="svg-cap" fill="var(--color-muted)">중앙 설비·환기 기준 개선</text>
    </g>

    <g class="svg-pop" style="--anim-order:2">
      <rect x="241" y="122" width="198" height="96" rx="6" fill="var(--color-sheet)" stroke="var(--color-accent)" stroke-width="1.6"/>
      <text x="259" y="149" class="svg-eyebrow" fill="var(--color-accent)">과제 02</text>
      <text x="259" y="172" class="svg-title" fill="var(--color-ink)">휴게·노조 공간</text>
      <text x="259" y="194" class="svg-cap" fill="var(--color-muted)">휴게실·노조 사무실 확충</text>
    </g>

    <g class="svg-pop" style="--anim-order:3">
      <rect x="452" y="122" width="198" height="96" rx="6" fill="var(--color-sheet)" stroke="var(--color-accent)" stroke-width="1.6"/>
      <text x="470" y="149" class="svg-eyebrow" fill="var(--color-accent)">과제 03</text>
      <text x="470" y="172" class="svg-title" fill="var(--color-ink)">물류설비 안전 보강</text>
      <text x="470" y="194" class="svg-cap" fill="var(--color-muted)">구분기·부평 리모델링 협의</text>
    </g>

    <path class="svg-flow" d="M130 218 L130 238 L340 238 M340 218 L340 256 M550 218 L550 238 L340 238" fill="none" stroke="var(--color-income)" stroke-width="2.2" stroke-dasharray="6 5"/>

    <!-- Bottom 2030 Shield -->
    <g class="svg-pop" style="--anim-order:4">
      <rect x="30" y="258" width="620" height="108" rx="8" fill="var(--color-income-soft)" stroke="var(--color-income)" stroke-width="2"/>
      <text x="52" y="286" class="svg-eyebrow" fill="var(--color-income)">2030년 물류망 재편 대비 (수도권 광역물류센터 · 부천 폐국 · 부평 리모델링)</text>
      <rect x="52" y="302" width="182" height="44" rx="4" fill="var(--color-sheet)" stroke="var(--color-income)"/>
      <text x="143" y="329" text-anchor="middle" class="svg-title" fill="var(--color-ink)">100% 고용승계</text>
      <rect x="249" y="302" width="182" height="44" rx="4" fill="var(--color-sheet)" stroke="var(--color-income)"/>
      <text x="340" y="329" text-anchor="middle" class="svg-title" fill="var(--color-ink)">근속 경력 완전 인정</text>
      <rect x="446" y="302" width="182" height="44" rx="4" fill="var(--color-sheet)" stroke="var(--color-income)"/>
      <text x="537" y="329" text-anchor="middle" class="svg-title" fill="var(--color-ink)">공정한 배치 전환</text>
    </g>
  </svg>`;
}

function svgScene12Together(): string {
  return `<svg class="about-scene-svg about-scene-svg--finale" viewBox="0 0 680 390" role="img" aria-label="물류노동조합 9년의 4대 핵심 성과와 조합원 참여를 상징하는 피날레 도식">
    <rect x="16" y="16" width="648" height="358" rx="8" fill="#0b051a" stroke="var(--color-accent)" stroke-width="2"/>

    <!-- Pulse Rings behind Center Emblem -->
    <circle class="svg-pulse" cx="340" cy="186" r="78" fill="none" stroke="#84a9ff" stroke-width="1.5" opacity="0.35"/>
    <circle class="svg-pulse" style="--anim-order:1" cx="340" cy="186" r="108" fill="none" stroke="#8ca5e8" stroke-width="1" opacity="0.22"/>

    <!-- Center Emblem -->
    <g transform="translate(299, 134)">
      <polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="#8ca5e8"/>
      <polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="#f5f3ee"/>
      <polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="#f5f3ee"/>
      <polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="#8ca5e8"/>
    </g>
    <text x="340" y="256" text-anchor="middle" class="svg-title" fill="#f5f3ee">우체국물류지원단 물류노동조합</text>
    <text x="340" y="276" text-anchor="middle" class="svg-cap" fill="#ced7ee">조직된 숫자가 현장을 바꾸는 힘입니다</text>

    <!-- 4 Corner Medallions -->
    <g class="svg-pop" style="--anim-order:0">
      <rect x="38" y="42" width="184" height="72" rx="6" fill="#16203a" stroke="#84a9ff"/>
      <text x="54" y="68" class="svg-eyebrow" fill="#84a9ff">차별 시정·교섭 견인</text>
      <text x="54" y="92" class="svg-title" fill="#f5f3ee">수당·복지·성과급</text>
    </g>

    <g class="svg-pop" style="--anim-order:1">
      <rect x="458" y="42" width="184" height="72" rx="6" fill="#16203a" stroke="#6ed390"/>
      <text x="474" y="68" class="svg-eyebrow" fill="#6ed390">2026.09~11</text>
      <text x="474" y="92" class="svg-title" fill="#f5f3ee">중노위 재심 인용</text>
    </g>

    <g class="svg-pop" style="--anim-order:2">
      <rect x="38" y="286" width="184" height="72" rx="6" fill="#16203a" stroke="#f4b65e"/>
      <text x="54" y="312" class="svg-eyebrow" fill="#f4b65e">2026.06 확정</text>
      <text x="54" y="336" class="svg-title" fill="#f5f3ee">대법원 연차수당 판결</text>
    </g>

    <g class="svg-pop" style="--anim-order:3">
      <rect x="458" y="286" width="184" height="72" rx="6" fill="#16203a" stroke="#6ed390"/>
      <text x="474" y="312" class="svg-eyebrow" fill="#6ed390">2026.11.23 결정</text>
      <text x="474" y="336" class="svg-title" fill="#f5f3ee">원청 직접 교섭 인정</text>
    </g>
  </svg>`;
}

function buildTheaterScenes(
  aboutDoc: UnionAboutDocument,
  chapters: Chapter[],
  env: Record<string, unknown>,
): SceneDef[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));

  const ch1 = byId.get('sec-1');
  const ch2 = byId.get('sec-2');
  const ch3 = byId.get('sec-3');
  const ch4 = byId.get('sec-4');
  const ch5 = byId.get('sec-5');
  const ch6 = byId.get('sec-6');
  const ch7 = byId.get('sec-7');
  const ch8 = byId.get('sec-8');
  const chConclusion = byId.get('conclusion');

  return [
    {
      slug: 'why',
      actIndex: 0,
      stepperLabel: '탄생',
      toneLabel: '출발과 정체성',
      tone: 'accent',
      legacyIds: ['intro', 'timeline', 'roadmap', 'sec-1'],
      headline: '물류사업소만의 노동조합이 필요했던 이유',
      paragraphs: [
        '우체국물류지원단 물류사업소 노동자는 소포·수하물 구분과 발착을 맡지만, 직종 간 이해관계와 교섭대표노조 중심 구조에서 오랫동안 후순위로 밀려 있었습니다.',
        '2017년 서서울 지회를 시작으로 부평·안양 지회가 세워졌고, 2021년 11월 8일 오직 물류사업소 노동자의 생존권과 존엄을 대변하는 독립 단위 노동조합으로 출범했습니다.',
      ],
      callout:
        '3개 사업소 지회에서 출발해 2026년 중앙노동위원회 재심 인용과 원청(우정사업본부) 교섭참여 인정까지, 9년의 시간은 현장이 스스로 세운 기록입니다.',
      diffs: [
        { kind: 'change', text: '2021.01 운송·물류 운영위 분리 → 2021.11.08 독립 노조 출범' },
        { kind: 'add', text: '2025.12 규약 개정으로 임기 3년 연장 (제3기 집행부 안정 운영)' },
        { kind: 'add', text: '2026.11.23 인천지노위 원청 교섭참여 노동조합 인정 결정' },
      ],
      hud: [
        { label: '출발 지회', value: '3개 사업소', tone: 'accent' },
        { label: '독립 출범', value: '2021.11.08', tone: 'accent' },
        { label: '원청 교섭 인정', value: '2026.11.23', tone: 'income' },
      ],
      legend: [
        { tone: 'accent', label: '지회·독립 출범' },
        { tone: 'income', label: '2026 핵심 승리' },
      ],
      svgHtml: svgScene01Why(),
      sourceHtml: renderChapterSourceHtml(ch1, env),
    },
    {
      slug: 'how',
      actIndex: 0,
      stepperLabel: '3대 실력',
      toneLabel: '활동 방식',
      tone: 'accent',
      legacyIds: ['strategy', 'sec-2'],
      headline: '교섭권의 제약을 실력으로 넘은 3가지 방식',
      paragraphs: [
        '교섭창구 단일화 제도 아래에서 소수 노조는 교섭참여노조 지위를 가져 단체협약을 직접 체결하기 어렵습니다.',
        '물류노동조합은 제약을 핑계로 침묵하지 않았습니다. 법적 권리구제, 의제 제기를 통한 교섭 견인, 차별적 노사합의 감시라는 세 가지 실력으로 현장을 바꿨습니다.',
      ],
      callout:
        '체결권이 없어도 법적 판정과 현장 연대로 교섭 의제를 주도할 수 있음을 지난 9년이 증명합니다.',
      diffs: [
        { kind: 'add', text: '1. 노동위원회 차별시정·고용노동청 진정·고발 직접 진행' },
        { kind: 'change', text: '2. 법적 판정과 공론화로 교섭대표노조·사측의 교섭 합의 견인' },
        { kind: 'add', text: '3. 공정대표의무 위반 대응으로 차별적 노사합의 감시·시정' },
      ],
      hud: [
        { label: '제도 조건', value: '교섭참여노조', tone: 'expense' },
        { label: '돌파 경로', value: '3대 실행 축', tone: 'accent' },
        { label: '결과', value: '차별 시정 관철', tone: 'income' },
      ],
      legend: [
        { tone: 'expense', label: '제도적 제약' },
        { tone: 'accent', label: '권리구제' },
        { tone: 'income', label: '교섭 견인' },
        { tone: 'grant', label: '합의 감시' },
      ],
      svgHtml: svgScene02How(),
      sourceHtml: renderChapterSourceHtml(ch2, env),
      focusHint: {
        defaultText: '무대의 01·02·03 카드를 클릭해 각 실행 축의 역할을 살펴보세요.',
        zones: [
          '01 법적·제도적 권리구제: 근로기준법·기간제법·노조법 위반 사안을 노동위원회·노동청에 직접 신청했습니다.',
          '02 차별 시정 교섭 견인: 수당·복지·병가·성과급 판정으로 교섭대표노조와 사측의 처우 개선 합의를 이끌었습니다.',
          '03 차별적 노사합의 감시: 단시간 유급병가 축소 등 소수 권익 침해 합의에 공정대표의무 법리로 맞섰습니다.',
        ],
      },
    },
    {
      slug: 'spark-2017',
      actIndex: 1,
      stepperLabel: '2017 출발',
      toneLabel: '고용 사수',
      tone: 'expense',
      legacyIds: ['origin-2017', 'sec-3'],
      headline: '체념을 깬 하루: 2017년 7월 28일',
      paragraphs: [
        '2017년 7월 28일 오전, 사측은 서서울물류사업소 기간제 노동자 6명에게 사흘 뒤(7.31) 계약 종료를 통보했습니다. 1개월 단위 쪼개기 계약이 낳은 상시 고용 불안이었습니다.',
        '노조 설립을 준비하던 임원진은 즉시 국회 환노위 의원실을 방문해 실태를 알렸고, 같은 날 오후 4~6시 비서관 배석 긴급 면담에서 6명 전원 고용 연장을 이끌어냈습니다.',
      ],
      callout:
        '개별 회유를 막기 위해 "계약서 서명은 6명 전원이 함께한다"는 원칙을 세워 기존 근무 조건 그대로 계약을 지켜냈고, 이는 자체 조직 설립의 출발점이 되었습니다.',
      diffs: [
        { kind: 'change', text: '7.31 계약 종료 통보 → 6명 전원 고용 연장 합의' },
        { kind: 'add', text: '하루 8시간 전일제 보장 및 무기계약직(공무직) 전환 추진' },
        { kind: 'add', text: '개별 접촉 차단·공동 서명 원칙 확립' },
      ],
      hud: [
        { label: '대상 노동자', value: '6명 전원', tone: 'income' },
        { label: '근무 형태', value: '8시간 전일제', tone: 'accent' },
        { label: '대응 시간', value: '당일 오후 긴급면담', tone: 'expense' },
      ],
      legend: [
        { tone: 'expense', label: '해고 위기' },
        { tone: 'accent', label: '국회·긴급 면담' },
        { tone: 'income', label: '공동 서명 승리' },
      ],
      svgHtml: svgScene03Spark2017(),
      sourceHtml: renderChapterSourceHtml(ch3, env),
    },
    {
      slug: 'jobs-2021',
      actIndex: 1,
      stepperLabel: '고용 사수',
      toneLabel: '고용안정·승계',
      tone: 'income',
      legacyIds: ['employment', 'sec-6'],
      headline: '115명 해고 저지와 서서울 폐국 전원 승계',
      paragraphs: [
        '2021년 3월 공무직 전환을 앞둔 기간제 대거 만료 통보에 맞서 3.9 본사 앞 긴급 기자회견을 열고, 전국 물류센터 기간제 115명 전원 계약 연장과 100여 명의 공무직 전환을 이끌어냈습니다.',
        '2022~2023년 서서울물류사업소 폐국 때도 집단 연차 투쟁 등으로 맞서 희망퇴직자를 제외한 전원(2022.03 입사자 포함)의 부천·부평 고용승계를 관철했습니다.',
      ],
      callout:
        '현재는 우정사업본부 공무직노조의 근속 인정 청구 소송에 연대하며, 2030년 부천 폐국과 광역물류센터 통합 시에도 "100% 근속 인정" 기준이 적용되도록 대비하고 있습니다.',
      diffs: [
        { kind: 'add', text: '2021.03 전국 115명 전원 계약 연장 · 100여 명 공무직 전환' },
        { kind: 'add', text: '2023 서서울 폐국 시 희망퇴직 제외 전원 부천·부평 고용승계' },
        { kind: 'change', text: '2024~2026 공무직노조 근속 인정 소송 연대 (2030 선례 사수)' },
      ],
      hud: [
        { label: '계약 연장', value: '115명 전원', tone: 'accent' },
        { label: '공무직 전환', value: '100여 명', tone: 'income' },
        { label: '전환 기준', value: '9개월 이상', tone: 'accent' },
      ],
      legend: [
        { tone: 'income', label: '전환·고용승계' },
        { tone: 'accent', label: '기준 확립' },
        { tone: 'expense', label: '2030 근속 연대' },
      ],
      svgHtml: svgScene04Jobs2021(),
      sourceHtml: renderChapterSourceHtml(ch6, env),
    },
    {
      slug: 'allowance-bonus',
      actIndex: 2,
      stepperLabel: '수당·성과급',
      toneLabel: '임금 차별 철폐',
      tone: 'income',
      legacyIds: ['equality', 'sec-4'],
      headline: '기간제 수당·성과급 배제를 소급으로 뒤집다',
      paragraphs: [
        '2017년 9월 신설된 직무·가족수당에서 기간제 노동자가 배제되자, 2018년 말 서울지방노동위원회에 차별시정을 신청해 2019년 5월 차별 인정과 2018년분 전액 소급 지급을 끌어냈습니다.',
        '경영평가 성과급 차별에 대해서도 2023년 7월 징벌적 손해배상(손해액 2배) 청구를 예고하며 압박해, 같은 해 9월 공무직과 동일한 지급률(6개월 이상 근무 퇴사자 포함)을 관철했습니다.',
      ],
      callout:
        '직무수당·가족수당 차별시정으로 원칙을 세운 뒤 2022년 임금교섭에서 둘째 자녀 가족수당 인상(월 2만→4만 원)과 셋째 이상 가산금까지 견인했습니다.',
      diffs: [
        { kind: 'change', text: '기간제 직무·가족수당 제외 → 명문화 및 2018분 전액 소급' },
        { kind: 'add', text: '2022 교섭 견인: 둘째 자녀 수당 2만 → 4만 원 · 셋째 가산금 신설' },
        { kind: 'add', text: '2023.09.19 기간제 경영평가 성과급 공무직 동일 지급률(퇴사자 포함)' },
      ],
      hud: [
        { label: '수당 소급', value: '2018분 전액', tone: 'income' },
        { label: '둘째 자녀 수당', value: '2만→4만원', tone: 'accent' },
        { label: '성과급 지급률', value: '공무직 동일', tone: 'income' },
      ],
      legend: [
        { tone: 'expense', label: '차별 배제' },
        { tone: 'income', label: '동일 지급·소급' },
        { tone: 'accent', label: '교섭 견인' },
      ],
      svgHtml: svgScene05AllowanceBonus(),
      sourceHtml: renderChapterSourceHtml(ch4, env, ['4.1.', '4.4.']),
    },
    {
      slug: 'welfare',
      actIndex: 2,
      stepperLabel: '복지포인트',
      toneLabel: '정규직 평준화',
      tone: 'income',
      legacyIds: [],
      headline: '20만P 삭감에서 정규직 동일 수준 평준화까지',
      paragraphs: [
        '2017년 9월 교섭대표노조와 사측이 기본 복지포인트를 40만P로 올리면서 주 20시간 단시간 노동자 포인트는 30만P에서 20만P로 오히려 삭감했습니다.',
        '2018년 12월 서울지노위 차별시정 신청과 고용노동청 신고로 2020년 1월 미지급 차액을 전액 소급 환수했고, 끝까지 동일 적용을 요구해 2024년 정규직과 같은 수준으로 맞췄습니다.',
      ],
      callout:
        '협약 서명은 교섭대표노조가 했지만, 2018년 법적 문제 제기로 물꼬를 트고 6년간 끝까지 평준화를 추진한 주체는 물류노동조합입니다.',
      diffs: [
        { kind: 'change', text: '2017 단시간 20만P 삭감 → 2020.01 2018·19년 차액 소급 환수' },
        { kind: 'change', text: '2022 임금교섭: 기본 40만 → 50만P 인상 및 근속 기준 동일 적용' },
        { kind: 'add', text: '2024 임금협약: 물류사업소 +20만P 인상으로 정규직 동일 평준화' },
      ],
      hud: [
        { label: '2017 삭감', value: '20만P', tone: 'expense' },
        { label: '2022 기본 인상', value: '50만P', tone: 'accent' },
        { label: '2024 평준화', value: '+20만P 동일', tone: 'income' },
      ],
      legend: [
        { tone: 'expense', label: '일방 삭감' },
        { tone: 'accent', label: '소급·인상' },
        { tone: 'income', label: '정규직 동일 수준' },
      ],
      svgHtml: svgScene06Welfare(),
      sourceHtml: renderChapterSourceHtml(ch4, env, ['4.2.']),
    },
    {
      slug: 'sick-leave',
      actIndex: 2,
      stepperLabel: '유급병가',
      toneLabel: '중노위 재심 인용',
      tone: 'income',
      legacyIds: [],
      headline: '3.6% 소수의 건강권을 되찾은 중노위 인용',
      paragraphs: [
        '2019년 발착직 유급병가 확대와 2022년 제수당 100% 보전을 이룬 데 이어, 2025년 말 교섭대표노조와 사측이 단시간(전체 조합원 약 3.6%) 유급병가를 60일에서 30일로 축소 합의했습니다.',
        '안양·부평지부는 조합원·비조합원·타 노조 연대 서명을 모아 2026년 봄 차별시정을 신청했고, 지노위 기각을 넘어 2026년 9월 중앙노동위원회 재심 인용과 조정안 수용을 이끌어냈습니다.',
      ],
      callout:
        '교섭대표노조와 사측이 합의로 제도화한 차별이라도, 물류노동조합이 법적 절차를 통해 현장의 건강권을 되찾을 수 있음을 증명했습니다.',
      diffs: [
        { kind: 'add', text: '2019.02 발착직 유급병가 도입 · 2022.02 제수당 일할 공제 폐지' },
        { kind: 'change', text: '2025 말 단시간 60일→30일 축소 합의 · 안양·부평 현장 연대 서명' },
        { kind: 'add', text: '2026.09 중노위 초심 뒤집고 위법 차별 인정 · 조정안 최종 수용' },
      ],
      hud: [
        { label: '병가 제수당', value: '100% 보전', tone: 'accent' },
        { label: '지노위 초심', value: '2026.05 기각', tone: 'expense' },
        { label: '중노위 재심', value: '2026.09 인용', tone: 'income' },
      ],
      legend: [
        { tone: 'expense', label: '차별 축소' },
        { tone: 'accent', label: '연대·재심' },
        { tone: 'income', label: '재심 인용·수용' },
      ],
      svgHtml: svgScene07SickLeave(),
      sourceHtml: renderChapterSourceHtml(ch4, env, ['4.3.']),
    },
    {
      slug: 'wages-court',
      actIndex: 2,
      stepperLabel: '대법원 판결',
      toneLabel: '임금·연차 사수',
      tone: 'income',
      legacyIds: ['wages', 'sec-5'],
      headline: '2년 전 단독 신고, 대법원 확정 판결로 증명되다',
      paragraphs: [
        '2017년 급여 인상 지연 시정과 2019년 최저임금 산입 꼼수 차단으로 "임금은 확정 채무"라는 원칙을 세웠습니다.',
        '2024년 2월 서서울 폐국·퇴직 시 사측이 회계연도 기준 연차를 임의 삭감·공제하자 물류노조만 단독으로 고용노동청에 신고했고, 2026년 6월 대법원이 동종 사건에서 "100% 지급·일방 삭감 위법"을 최종 확정했습니다.',
      ],
      callout:
        '사측과 교섭대표노조의 소극적 태도로 미해결로 남아 있던 연차수당 부당 삭감 문제에서, 2년 전 물류노동조합의 단독 문제 제기가 옳았음을 대법원이 확인했습니다.',
      diffs: [
        { kind: 'add', text: '2017·2019 임금 지연 지급 시정 및 최저임금법 위반 차단' },
        { kind: 'change', text: '2024.02 물류노조 단독 고용노동청 「임금체불」 정식 신고' },
        { kind: 'add', text: '2026.06 대법원 확정 판결: 회계연도 기준 연차 100% 지급 확인' },
      ],
      hud: [
        { label: '단독 신고', value: '2024.02', tone: 'expense' },
        { label: '대법원 판결', value: '2026.06 확정', tone: 'income' },
        { label: '지급 기준', value: '연차 100%', tone: 'income' },
      ],
      legend: [
        { tone: 'accent', label: '임금 원칙' },
        { tone: 'expense', label: '단독 신고' },
        { tone: 'income', label: '대법원 확정' },
      ],
      svgHtml: svgScene08WagesCourt(),
      sourceHtml: renderChapterSourceHtml(ch5, env),
    },
    {
      slug: 'workplace',
      actIndex: 3,
      stepperLabel: '현장 안전',
      toneLabel: '작업 환경 개선',
      tone: 'accent',
      legacyIds: ['workplace', 'sec-7'],
      headline: '기계를 멈추고, 분진을 막고, 냉기를 내리다',
      paragraphs: [
        '현장 요구를 구체적인 설비와 절차 개선으로 바꿉니다. 창립 직후 휴게시간 기계 가동 전면 중단으로 전 사업소 동시 휴식을 정착시켰고, 2026년 7월 사측의 "8월 3일 연차 전면 금지" 일방 통보도 다음 날 성명으로 즉각 저지했습니다.',
        '서서울 지하 주차장 시멘트 분진은 바닥 전체 코팅으로 막았고, 부평물류사업소 노후 냉방 문제는 2026년 10월 소장 면담에서 "환기구 덕트 하향 인출 배관 공사(2027.05 말 완공 목표)" 최우선 시공 합의로 풀었습니다.',
      ],
      callout:
        '임시방편(마스크 지급, 교대 휴식)을 거부하고 예산 반영과 설비 개선으로 병들지 않는 일터를 만들어 갑니다.',
      diffs: [
        { kind: 'add', text: '7.1 전 사업소·전 근무시간대 휴게시간 중 구분 기계 가동 중단' },
        { kind: 'add', text: '7.2 2026.07.31 성명으로 불법적 특정일 연차휴가 금지 통보 저지' },
        { kind: 'change', text: '7.3~7.4 시멘트 분진 바닥 코팅 · 부평 덕트 하향 인출 공사 협의' },
      ],
      hud: [
        { label: '휴게 원칙', value: '기계 전면 정지', tone: 'accent' },
        { label: '연차 금지 저지', value: '2026.07.31', tone: 'expense' },
        { label: '부평 냉방 완공', value: '2027.05 목표', tone: 'income' },
      ],
      legend: [
        { tone: 'accent', label: '휴게 보장' },
        { tone: 'expense', label: '연차 금지 저지' },
        { tone: 'grant', label: '분진 코팅' },
        { tone: 'income', label: '냉방 덕트' },
      ],
      svgHtml: svgScene09Workplace(),
      sourceHtml: renderChapterSourceHtml(ch7, env),
      focusHint: {
        defaultText: '도면의 4개 현장 개선 구역을 클릭해 세부 내용을 확인하세요.',
        zones: [
          '7.1 기계 가동 중단: 오후 7시 이후 교대 휴게 관행을 폐지하고 전 사업소 동시 휴식을 정착시켰습니다.',
          '7.2 불법 연차 금지 저지: 2026.07.30 일방 통보를 다음 날 성명으로 반박해 노동자의 정당한 휴식권을 지켰습니다.',
          '7.3 시멘트 분진 차단: 임시 마스크 대신 예산을 반영한 지하 작업장 바닥 전체 코팅 공사를 이끌어냈습니다.',
          '7.4 부평 냉방 덕트 협의: 2026.10 안양 사례를 대안으로 제시해 2027년 5월 말 완공 목표 최우선 시공을 협의했습니다.',
        ],
      },
    },
    {
      slug: 'principal-win',
      actIndex: 4,
      stepperLabel: '원청 인정',
      toneLabel: '교섭 지위 확보',
      tone: 'income',
      legacyIds: ['direct-bargaining', 'sec-8'],
      headline: '법무법인 태평양을 넘은 원청 교섭 인정 결정',
      paragraphs: [
        '냉·난방, 설비 안전, 휴게·노조 공간, 사업소 통폐합의 실질 결정 주체는 하청이 아닌 원청 우정사업본부입니다. 그러나 우본은 2026년 10월 24일 물류노조를 교섭 참여에서 일방 제외하고 이의마저 거부했습니다.',
        '물류노조는 11월 2일 인천지노위에 시정신청을 내고, 절차 위법성·국유재산 물적 지배·매출 99.9% 전속성·인사 종속성 4대 실증으로 원청 대리인(법무법인 태평양) 주장을 반박해 11월 23일 교섭참여 노조 인정을 받아냈습니다.',
      ],
      callout:
        '개정 노동조합법(제2·3조) 시행 이후, 원청이 교섭 배제를 시도한 사안을 실증 자료로 뒤집고 공식 원·하청 교섭 지위를 확보한 결정적 승리입니다.',
      diffs: [
        { kind: 'change', text: '2026.10.24 우본 교섭 배제 공고 → 11.02 인천지노위 시정신청' },
        { kind: 'add', text: '4대 실증 입증 (절차 위법·국유재산 지배·매출 99.9%·지배종속)' },
        { kind: 'add', text: '2026.11.23 인천지방노동위원회 원청 교섭참여 노동조합 인정' },
      ],
      hud: [
        { label: '매출 전속성', value: '99.9%', tone: 'accent' },
        { label: '실증 반박', value: '4대 근거', tone: 'accent' },
        { label: '인정 결정', value: '2026.11.23', tone: 'income' },
      ],
      legend: [
        { tone: 'expense', label: '원청 배제 시도' },
        { tone: 'accent', label: '4대 실증 반박' },
        { tone: 'income', label: '직접 교섭 인정' },
      ],
      svgHtml: svgScene10PrincipalWin(),
      sourceHtml: renderChapterSourceHtml(ch8, env, ['8.1.']),
    },
    {
      slug: 'vision-2030',
      actIndex: 4,
      stepperLabel: '2030 과제',
      toneLabel: '미래 대비',
      tone: 'accent',
      legacyIds: [],
      headline: '원청 직접 교섭 3대 과제와 2030년 대비',
      paragraphs: [
        '건물·설비·예산 권한을 가진 우정사업본부와의 직접 교섭 테이블에서 ① 중앙 냉·난방 및 공조·환기 기준 개선, ② 휴게공간 및 노조 사무실 확충, ③ 국유 물류설비 안전 보강 및 부평 리모델링 사전 협의를 우선 추진합니다.',
        '앞으로 예정된 수도권 광역물류센터 신설, 부천우편집중국 폐국, 부평물류사업소 리모델링 등 원청 주도의 대규모 사업재편도 앞두고 있습니다.',
      ],
      callout:
        '원청과의 공식 교섭 테이블에서 전 조합원 100% 고용승계, 근속 경력 완전 인정, 공정한 배치 전환을 요구하고 끝까지 관철할 것입니다.',
      diffs: [
        { kind: 'add', text: '과제 1·2: 중앙 냉난방·공조 기준 개선 및 휴게·노조 공간 확충' },
        { kind: 'add', text: '과제 3: 소포구분기·컨베이어 안전 보강 및 부평 리모델링 사전 협의' },
        { kind: 'add', text: '2030 물류망 재편 대비: 100% 고용승계 · 근속 완전 인정 · 공정 배치' },
      ],
      hud: [
        { label: '직접 교섭', value: '3대 과제', tone: 'accent' },
        { label: '고용 목표', value: '100% 승계', tone: 'income' },
        { label: '대비 시점', value: '2030 재편', tone: 'accent' },
      ],
      legend: [
        { tone: 'accent', label: '3대 교섭 과제' },
        { tone: 'income', label: '2030 고용·근속 방어' },
      ],
      svgHtml: svgScene11Vision2030(),
      sourceHtml: renderChapterSourceHtml(ch8, env, ['8.2.']),
    },
    {
      slug: 'together',
      actIndex: 4,
      stepperLabel: '함께하기',
      toneLabel: '결론과 연대',
      tone: 'income',
      legacyIds: ['join', 'conclusion'],
      headline: '과거의 성과가 미래의 기준이 됩니다',
      paragraphs: [
        '직무·가족수당·복지포인트·성과급 차별 철폐, 단시간 유급병가 중노위 재심 인용, 퇴직자 연차수당 대법원 확정 판결, 우정사업본부 원청 직접 교섭 인정까지 — 물류사업소 노동자 곁에서 끝까지 싸워 바꾼 노동조합은 우체국물류지원단 물류노동조합뿐입니다.',
        '조합원의 수가 힘이고, 조직된 숫자가 현장을 바꾸는 협상력입니다. 물류노동조합은 언제나 열려 있으며, 여러분의 가입을 환영합니다.',
      ],
      callout:
        '과거의 성과는 오늘 조합의 투명한 회계·조직·규약 위에서 이어지고 있습니다. 아래에서 직접 확인하고 함께해 주세요.',
      diffs: [
        { kind: 'add', text: '수당·복지·성과급 차별 시정 및 임금·단체교섭 견인' },
        { kind: 'add', text: '단시간 유급병가 중노위 재심 인용 · 연차수당 대법원 확정 판결' },
        { kind: 'add', text: '2026.11.23 원청(우정사업본부) 교섭참여 노동조합 인정 결정' },
      ],
      hud: [
        { label: '활동 기간', value: '2017–2026', tone: 'accent' },
        { label: '핵심 결정', value: '중노위·대법원·지노위', tone: 'income' },
        { label: '가입 자격', value: '물류사업소 노동자', tone: 'income' },
      ],
      legend: [
        { tone: 'accent', label: '교섭·제도' },
        { tone: 'income', label: '노동위·원청' },
        { tone: 'grant', label: '대법원 확정' },
      ],
      svgHtml: svgScene12Together(),
      sourceHtml: renderChapterSourceHtml(chConclusion, env),
      isFinale: true,
    },
  ];
}

function renderTrustHubHtml(prefix: string): string {
  return `<section class="history-trust-hub no-print" aria-labelledby="sec-trust-hub">
    <h2 id="sec-trust-hub">노동조합의 오늘을 직접 확인하세요</h2>
    <div class="trust-hub-grid">
      <a class="trust-hub-card" href="${escapeAttr(`${prefix}accounting/index.html`)}">
        <strong>투명한 조합비 회계 공개</strong>
        <p>조합비 수입과 교섭·복지·운영 지출 내역을 1원 단위까지 공개 원장과 결산 보고서로 확인할 수 있습니다.</p>
        <span class="trust-hub-link">회계 대시보드 보기 →</span>
      </a>
      <a class="trust-hub-card" href="index.html">
        <strong>지부별 조직·임원 현황</strong>
        <p>안양·부평지부 조합원 구성 통계와 현 임기 공식 임원 현황을 공개합니다.</p>
        <span class="trust-hub-link">조직 현황 보기 →</span>
      </a>
      <a class="trust-hub-card" href="bylaws-guide.html">
        <strong>노동조합 규약 한눈에 보기</strong>
        <p>총회·운영위원회 의결 기준과 조합원의 권리·의무를 시각 요약과 전문으로 열람할 수 있습니다.</p>
        <span class="trust-hub-link">규약 안내 보기 →</span>
      </a>
    </div>
  </section>`;
}

function renderFullArticleSection(
  aboutDoc: UnionAboutDocument,
  chapters: Chapter[],
  env: Record<string, unknown>,
  prefix: string,
): string {
  const ch1 = chapters.find((c) => c.id === 'sec-1');
  let timelineBlock = '';
  if (ch1) {
    const { beforeTokens, items, afterTokens } = extractTopLevelListItems(
      ch1.leadTokens,
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
          /독자 노선|공식 출범|중앙노동위원회 재심 인용|교섭참여 노동조합 인정 결정/.test(
            leadingTitle + bodyHtml,
          );
        return `<div class="timeline-row${isMilestone ? ' is-milestone' : ''}">
          <div class="timeline-date">${escapeHtml(leadingTitle)}</div>
          <div class="timeline-text history-prose">${bodyHtml}</div>
        </div>`;
      })
      .join('\n');
    const afterHtml =
      afterTokens.length > 0
        ? `<div class="history-prose">${renderTokens(afterTokens, env)}</div>`
        : '';
    timelineBlock = `<section class="history-section history-split-timeline" id="full-sec-1">
      <div class="split-intro">
        <h2>${escapeHtml(ch1.headingText)}</h2>
        <div class="history-prose">${introHtml}</div>
      </div>
      <div>
        <div class="timeline-rail">${rowsHtml}</div>
        ${afterHtml}
      </div>
    </section>`;
  }

  const ch2 = chapters.find((c) => c.id === 'sec-2');
  let strategyBlock = '';
  if (ch2) {
    const { beforeTokens, items, afterTokens } = extractTopLevelListItems(
      ch2.leadTokens,
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
        return `<article class="strategy-card">
          <div class="strategy-index">${idx + 1}</div>
          <h3>${escapeHtml(cleanTitle || `활동 방식 ${idx + 1}`)}</h3>
          <div class="history-prose">${renderTokens(bodyTokens, env)}</div>
        </article>`;
      })
      .join('\n');
    const afterHtml =
      afterTokens.length > 0
        ? `<div class="history-prose">${renderTokens(afterTokens, env)}</div>`
        : '';
    strategyBlock = `<section class="history-section" id="full-sec-2">
      <div class="history-section-head"><h2>${escapeHtml(ch2.headingText)}</h2></div>
      ${leadHtml}
      <div class="strategy-grid">${cardsHtml}</div>
      ${afterHtml}
    </section>`;
  }

  const middleBlocks = chapters
    .filter((c) => c.id !== 'sec-1' && c.id !== 'sec-2' && !c.isConclusion)
    .map((ch) => {
      const leadHtml =
        ch.subSections.length > 0 && ch.leadTokens.length > 0
          ? `<div class="history-section-lead history-prose">${renderTokens(ch.leadTokens, env)}</div>`
          : '';
      const entries = ch.subSections
        .map((sub) => {
          const { leadTokens, phases } = splitSubSectionPhases(sub.tokens);
          const subLeadHtml = leadTokens.length > 0 ? renderTokens(leadTokens, env) : '';
          const phasesHtml = phases
            .map(
              (phase) => `<section class="chapter-phase">
                <h4>${escapeHtml(phase.headingText)}</h4>
                <div class="history-prose">${renderTokens(phase.tokens, env)}</div>
              </section>`,
            )
            .join('\n');
          return `<article class="chapter-entry">
            <div class="chapter-entry-head"><h3>${escapeHtml(sub.headingText)}</h3></div>
            <div class="chapter-entry-body history-prose">${subLeadHtml}${phasesHtml}</div>
          </article>`;
        })
        .join('\n');
      return `<section class="history-section" id="full-${escapeAttr(ch.id)}">
        <div class="history-section-head">
          <h2>${escapeHtml(ch.headingText)}</h2>
          ${leadHtml}
        </div>
        <div class="chapter-entries">${entries}</div>
      </section>`;
    })
    .join('\n');

  const conclusion = chapters.find((c) => c.isConclusion);
  const finaleBlock = conclusion
    ? `<section class="history-finale" id="full-conclusion">
        <svg class="history-finale-watermark" viewBox="0 0 82 94" width="164" height="188" aria-hidden="true" focusable="false">
          <polygon points="39.8,1.7 1.2,24 1.2,70 39.8,92.3 39.8,74.8 16.3,61.3 16.3,32.7 39.8,19.2" fill="#8ca5e8"></polygon>
          <polygon points="42.2,1.7 80.8,24 80.8,70 42.2,92.3 42.2,74.8 65.7,61.3 65.7,32.7 42.2,19.2" fill="#f5f3ee"></polygon>
          <polygon points="39.8,22.8 21.2,33.5 39.8,44.3" fill="#f5f3ee"></polygon>
          <polygon points="42.2,22.8 60.8,33.5 42.2,44.3" fill="#8ca5e8"></polygon>
        </svg>
        <h2>${escapeHtml(conclusion.headingText)}</h2>
        <div class="history-finale-copy">${renderTokens(conclusion.rawTokens, env)}</div>
      </section>`
    : '';

  return `<div class="about-full-article" data-copy-body hidden>
    <header class="history-hero">
      <div class="history-hero-headline">
        <h2>${escapeHtml(aboutDoc.meta.title)}</h2>
        <p class="history-hero-lead">${escapeHtml(aboutDoc.meta.summary)}</p>
      </div>
    </header>
    ${timelineBlock}
    ${strategyBlock}
    ${middleBlocks}
    ${finaleBlock}
    ${renderTrustHubHtml(prefix)}
  </div>`;
}

export function buildUnionAboutHtml(
  aboutDoc: UnionAboutDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/about.html';
  const prefix = computePrefixForRoute(route);
  const env: Record<string, unknown> = {};
  const tokens = historyMd.parse(String(aboutDoc.markdown || ''), env);
  const { heroTitle, chapters } = splitChapters(tokens);
  const scenes = buildTheaterScenes(aboutDoc, chapters, env);
  const totalScenes = scenes.length;

  const actTabsHtml = ACTS.map(
    (act, i) =>
      `<button type="button" class="about-deck-tab" role="tab" id="about-act-${act.index}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}" data-act-tab="${act.index}" data-start-scene="${act.startScene}">${escapeHtml(act.label)}</button>`,
  ).join('\n          ');

  const scenesHtml = scenes
    .map((scene, idx) => {
      const hiddenAttr = idx === 0 ? '' : ' hidden="until-found"';
      const nextScene = scenes[idx + 1];
      const hudHtml = scene.hud
        .map(
          (chip) =>
            `<div class="about-hud-chip" data-tone="${escapeAttr(chip.tone ?? 'accent')}">
              <span class="about-hud-label">${escapeHtml(chip.label)}</span>
              <strong class="about-hud-value">${escapeHtml(chip.value)}</strong>
            </div>`,
        )
        .join('');
      const legendHtml = scene.legend
        .map(
          (lg) =>
            `<span class="about-legend-item" data-tone="${escapeAttr(lg.tone)}"><i></i>${escapeHtml(lg.label)}</span>`,
        )
        .join('');
      const paragraphsHtml = scene.paragraphs
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('');
      const diffsHtml = scene.diffs
        .map(
          (d) =>
            `<li class="about-diff-item" data-kind="${escapeAttr(d.kind)}">
              <span class="about-diff-mark" aria-hidden="true">${d.kind === 'add' ? '+' : '~'}</span>
              <span>${escapeHtml(d.text)}</span>
            </li>`,
        )
        .join('');
      const focusBannerHtml = scene.focusHint
        ? `<div class="about-focus-banner" data-focus-caption data-zones="${escapeAttr(JSON.stringify(scene.focusHint.zones))}">${escapeHtml(scene.focusHint.defaultText)}</div>`
        : '';

      const navFooterHtml = scene.isFinale
        ? `<div class="about-card-nav about-card-nav--finale no-print">
            <div class="history-share-bar">
              <button type="button" class="btn secondary" data-deck-prev>← 이전</button>
              <button type="button" class="btn" data-inline-action="share">조합 소개 공유하기</button>
              <button type="button" class="btn secondary" data-inline-action="copy-link">링크 복사</button>
              <span class="history-inline-status" data-inline-status role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
            <p class="about-shortcut-hint">← → 장면 이동 · R 다시 보기 · Space 일시정지</p>
          </div>`
        : `<div class="about-card-nav no-print">
            <div class="about-card-nav-btns">
              <button type="button" class="btn secondary about-nav-prev" data-deck-prev${idx === 0 ? ' disabled' : ''}>← 이전</button>
              <button type="button" class="btn about-nav-next" data-deck-next>다음: ${escapeHtml(nextScene?.stepperLabel ?? '')} →</button>
            </div>
            <p class="about-shortcut-hint">← → 장면 이동 · R 다시 보기 · Space 일시정지</p>
          </div>`;

      return `<section class="about-scene" id="scene-${escapeAttr(scene.slug)}" data-scene-index="${idx}" data-scene-slug="${escapeAttr(scene.slug)}" data-act-index="${scene.actIndex}" data-legacy-ids="${escapeAttr(scene.legacyIds.join(','))}" role="tabpanel" aria-labelledby="about-step-${idx}"${hiddenAttr}>
        <div class="about-scene-inner">
          <div class="about-theater-grid">
            <div class="about-stage-canvas is-animating" data-focus-active="0">
              <div class="about-stage-hud">
                <div class="about-hud-metrics">${hudHtml}</div>
                <div class="about-stage-controls no-print">
                  <button type="button" class="about-hud-btn" data-deck-replay title="애니메이션 다시 보기 (R)">다시 보기</button>
                  <button type="button" class="about-hud-btn" data-deck-pause title="애니메이션 일시정지/재생 (Space)">일시정지</button>
                </div>
              </div>
              <div class="about-stage-diagram">
                ${scene.svgHtml}
              </div>
              ${focusBannerHtml}
              <div class="about-stage-legend">${legendHtml}</div>
            </div>

            <aside class="about-story-card">
              <div class="about-story-top">
                <span class="about-story-count">${idx + 1} / ${totalScenes} 장면</span>
                <span class="about-tone-badge" data-tone="${escapeAttr(scene.tone)}">${escapeHtml(scene.toneLabel)}</span>
              </div>
              <h2 class="about-story-title">${escapeHtml(scene.headline)}</h2>
              <div class="about-story-prose">${paragraphsHtml}</div>
              <div class="about-callout">${escapeHtml(scene.callout)}</div>
              <div class="about-diff-block">
                <h3>현장의 변화</h3>
                <ul class="about-diff-list">${diffsHtml}</ul>
              </div>
              ${
                scene.sourceHtml
                  ? `<details class="about-source-details">
                <summary>원문 기록 펼쳐보기</summary>
                <div class="about-source-body history-prose">${scene.sourceHtml}</div>
              </details>`
                  : ''
              }
              ${navFooterHtml}
            </aside>
          </div>
          ${scene.isFinale ? renderTrustHubHtml(prefix) : ''}
        </div>
      </section>`;
    })
    .join('\n\n      ');

  const stepperHtml = scenes
    .map(
      (scene, idx) =>
        `<button type="button" class="about-step-btn" role="tab" id="about-step-${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}" tabindex="${idx === 0 ? '0' : '-1'}" data-scene-tab="${idx}" data-visited="${idx === 0 ? 'true' : 'false'}">
          <span class="about-step-dot" aria-hidden="true">${idx + 1}</span>
          <span class="about-step-label">${escapeHtml(scene.stepperLabel)}</span>
        </button>`,
    )
    .join('\n        ');

  const fullArticleHtml = renderFullArticleSection(aboutDoc, chapters, env, prefix);

  const bodyHtml = `
  <article class="history-feature about-deck document-article" id="history-article" data-about-deck data-view="deck" data-paused="false" data-document-category="조합 소개" data-skip-auto-toc="true">
    <header class="about-page-masthead">
      <div class="about-masthead-left">
        <nav class="document-breadcrumb no-print" aria-label="현재 위치">
          <ol>
            <li><a href="index.html">조합 안내</a></li>
            <li aria-current="page">조합 소개</li>
          </ol>
        </nav>
        <h1 class="about-page-title">${escapeHtml(heroTitle || aboutDoc.meta.title)}</h1>
      </div>
      <div class="about-masthead-meta">
        <span class="history-hero-years">2017–2026</span>
        <span class="about-masthead-sub">9년의 투쟁과 역사</span>
      </div>
    </header>

    <div class="about-deck-bar no-print">
      <div class="about-deck-bar-row">
        <div class="about-deck-tabs" role="tablist" aria-label="조합 소개 5막">
          ${actTabsHtml}
        </div>
        <div class="about-mode-toggle" role="group" aria-label="보기 방식">
          <button type="button" class="about-mode-btn" data-deck-mode="deck" aria-pressed="true">슬라이드</button>
          <button type="button" class="about-mode-btn" data-deck-mode="article" aria-pressed="false">전체 글로 보기</button>
        </div>
      </div>
      <div class="about-deck-progress-track" role="progressbar" aria-label="조합 소개 진행률" aria-valuemin="1" aria-valuemax="${totalScenes}" aria-valuenow="1">
        <div class="about-deck-progress-fill" style="inline-size: ${Math.round((1 / totalScenes) * 100)}%"></div>
      </div>
    </div>

    <div class="about-theater-shell">
      <div class="about-theater-stage">
        ${scenesHtml}
      </div>

      <nav class="about-stepper no-print" role="tablist" aria-label="12개 장면 바로가기">
        <div class="about-stepper-head">
          <span>전체 12개 장면</span>
          <strong data-deck-position>1 / ${totalScenes}</strong>
        </div>
        <div class="about-stepper-track">
          ${stepperHtml}
        </div>
      </nav>
    </div>

    ${fullArticleHtml}
  </article>
  ${renderDocumentToolsWidget()}`;

  const historyCssHref = assetHref(prefix, 'history.css', assets);
  const deckJsHref = assetHref(prefix, 'about-deck.js', assets);
  const toolsJsHref = assetHref(prefix, 'document-tools.js', assets);

  return renderPageShell({
    title: aboutDoc.meta.title,
    description: aboutDoc.meta.summary,
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    ogType: 'website',
    subnavHtml: renderUnionSubnav('', 'about'),
    extraHeadHtml: `<link rel="stylesheet" href="${escapeAttr(historyCssHref)}">\n  <noscript><style>.about-theater-shell{display:none !important;}.about-full-article[hidden]{display:block !important;}</style></noscript>`,
    bodyHtml,
    extraScriptsHtml: `<script src="${escapeAttr(deckJsHref)}" defer></script>\n<script src="${escapeAttr(toolsJsHref)}" defer></script>`,
  });
}
