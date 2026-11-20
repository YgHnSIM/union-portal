import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export interface MarkdownResidueIssue {
  code: 'unbalanced-strong-marker' | 'escaped-bracket-residue';
  line: number;
  column: number;
  message: string;
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export function sanitizeLinkUrl(value: string): string {
  const url = String(value || '').trim();
  if (!url) return '#';
  if (url.startsWith('//')) return '#';
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (
    /^[./#?A-Za-z0-9_%~가-힣-]/.test(url) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(url)
  ) {
    return url;
  }
  return '#';
}

function isEscapedAt(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findTokenPositions(
  markdown: string,
  token: string,
): Array<{ index: number; line: number; column: number }> {
  const positions: Array<{ index: number; line: number; column: number }> = [];
  let line = 1;
  let column = 1;
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      line += 1;
      column = 1;
      continue;
    }
    const isExactStrongMarker =
      token !== '**' ||
      (markdown[index - 1] !== '*' && markdown[index + token.length] !== '*');
    if (
      isExactStrongMarker &&
      markdown.startsWith(token, index) &&
      !isEscapedAt(markdown, index)
    ) {
      positions.push({ index, line, column });
      index += token.length - 1;
      column += token.length;
      continue;
    }
    column += 1;
  }
  return positions;
}

export function findMarkdownSyntaxResidues(markdown: string): MarkdownResidueIssue[] {
  const source = String(markdown || '');
  const issues: MarkdownResidueIssue[] = [];
  const strongMarkers = findTokenPositions(source, '**');
  if (strongMarkers.length % 2 === 1) {
    const marker = strongMarkers[strongMarkers.length - 1]!;
    issues.push({
      code: 'unbalanced-strong-marker',
      line: marker.line,
      column: marker.column,
      message: '짝이 맞지 않는 ** 강조 표시가 있습니다.',
    });
  }

  source.split(/\r?\n/).forEach((lineText, lineIndex) => {
    let offset = lineText.indexOf('\\[');
    while (offset !== -1) {
      issues.push({
        code: 'escaped-bracket-residue',
        line: lineIndex + 1,
        column: offset + 1,
        message: '화면에 남을 수 있는 \\[ 이스케이프 잔재가 있습니다.',
      });
      offset = lineText.indexOf('\\[', offset + 2);
    }
  });

  return issues;
}

function inlineTokenText(token: Token | undefined): string {
  if (!token) return '';
  if (token.type === 'text' || token.type === 'code_inline') return token.content;
  if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
  if (token.type === 'image') return token.content || '';
  if (token.children) return token.children.map((c) => inlineTokenText(c)).join('');
  return '';
}

function headingClass(level: number): [string, string] {
  if (level <= 2) return ['h2', 'section-title'];
  if (level === 3) return ['h3', 'subsection-title'];
  return ['h4', 'subsubsection-title'];
}

function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  md.inline.ruler.before('escape', 'safe_br', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^<br\s*\/?>/i);
    if (!match) return false;
    if (!silent) state.push('hardbreak', 'br', 0);
    state.pos += match[0].length;
    return true;
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

  md.renderer.rules.table_open = (tokens, index, options, _env, self) => {
    tokens[index]!.attrJoin('class', 'mom-table');
    return `<div class="table-wrapper" tabindex="0" role="region" aria-label="회의록 표">\n${self.renderToken(tokens, index, options)}`;
  };

  md.renderer.rules.table_close = (tokens, index, options, _env, self) =>
    `${self.renderToken(tokens, index, options)}</div>\n`;

  return md;
}

const markdownRenderer = createMarkdownRenderer();

function annotateTableCells(tokens: Token[]): void {
  let headers: string[] = [];
  let inHeader = false;
  let inBody = false;
  let bodyColumn = 0;

  tokens.forEach((token, index) => {
    if (token.type === 'table_open') headers = [];
    if (token.type === 'thead_open') inHeader = true;
    if (token.type === 'thead_close') inHeader = false;
    if (token.type === 'tbody_open') inBody = true;
    if (token.type === 'tbody_close') inBody = false;
    if (token.type === 'tr_open' && inBody) bodyColumn = 0;
    if (token.type === 'th_open' && inHeader) {
      token.attrSet('scope', 'col');
      headers.push(inlineTokenText(tokens[index + 1]).replace(/\s+/g, ' ').trim());
    }
    if (token.type === 'td_open' && inBody) {
      token.attrSet('data-label', headers[bodyColumn] ?? '');
      bodyColumn += 1;
    }
  });
}

function annotateDocumentTokens(tokens: Token[], title: string): TocItem[] {
  const toc: TocItem[] = [];
  let headingIndex = 0;
  let listDepth = 0;

  tokens.forEach((token, index) => {
    if (token.type === 'paragraph_open') token.attrJoin('class', 'body-text');
    if (token.type === 'blockquote_open') token.attrJoin('class', 'quote-block');
    if (token.type === 'hr') token.attrJoin('class', 'divider');

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth += 1;
      token.attrJoin('class', 'bullet-list');
    }
    if (token.type === 'list_item_open' && listDepth > 1) {
      token.attrJoin('class', `list-level-${Math.min(listDepth - 1, 3)}`);
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth = Math.max(0, listDepth - 1);
    }

    if (token.type !== 'heading_open') return;
    const inlineToken = tokens[index + 1];
    const closingToken = tokens[index + 2];
    const text = inlineTokenText(inlineToken).replace(/\s+/g, ' ').trim();
    if (text === title && inlineToken && closingToken) {
      token.hidden = true;
      inlineToken.hidden = true;
      inlineToken.content = '';
      inlineToken.children = [];
      closingToken.hidden = true;
      return;
    }

    const level = Number(token.tag.slice(1));
    const [tag, className] = headingClass(level);
    const id = `section-${headingIndex + 1}`;
    headingIndex += 1;
    token.tag = tag;
    if (closingToken) closingToken.tag = tag;
    token.attrSet('id', id);
    token.attrJoin('class', className);
    if (level <= 3 && text) {
      toc.push({ id, text, level });
    }
  });

  annotateTableCells(tokens);
  return toc;
}

export function renderMomMarkdown(
  markdown: string,
  title: string,
): { contentHtml: string; toc: TocItem[] } {
  const normalized = String(markdown || '').replace(/^\s*<br\s*\/?>\s*$/gim, '');
  const env: Record<string, unknown> = {};
  const tokens = markdownRenderer.parse(normalized, env);
  const toc = annotateDocumentTokens(tokens, title);
  if (!toc.some((item) => item.level === 2)) {
    for (const item of toc) {
      if (item.level === 3) item.level = 2;
    }
  }
  return {
    contentHtml: markdownRenderer.renderer.render(tokens, markdownRenderer.options, env),
    toc,
  };
}
