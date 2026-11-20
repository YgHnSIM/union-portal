import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

export const PRINT_DENSITIES = ['short', 'standard', 'long'] as const;
export type PrintDensity = (typeof PRINT_DENSITIES)[number];

export interface StatementMetrics {
  sectionCount: number;
  sectionTitleCount: number;
  paragraphCount: number;
  lineBreakCount: number;
  demandCount: number;
  closingRowCount: number;
  characterCount: number;
}

export interface StatementAnalysisResult {
  errors: string[];
  html: string;
  metrics: StatementMetrics;
  success: boolean;
}

const ALLOWED_TAGS = new Set([
  'section',
  'h2',
  'p',
  'div',
  'ol',
  'ul',
  'li',
  'strong',
  'em',
  'br',
  'a',
]);

const ALLOWED_CLASSES = new Set([
  'intro-section',
  'section-title',
  'body-text',
  'no-indent',
  'demands',
  'closing-block',
  'closing-highlight',
  'closing-text',
]);

type AstNode = DefaultTreeAdapterTypes.Node;
type AstElement = DefaultTreeAdapterTypes.Element;

export function isElement(node: AstNode): node is AstElement {
  return 'tagName' in node && typeof node.tagName === 'string';
}

export function getAttr(node: AstElement, name: string): string | undefined {
  return node.attrs.find((a) => a.name === name)?.value;
}

export function classNames(node: AstNode): string[] {
  if (!isElement(node)) return [];
  const raw = getAttr(node, 'class') ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

export function hasClass(node: AstNode, cls: string): boolean {
  return classNames(node).includes(cls);
}

export function textContent(node: AstNode): string {
  if ('value' in node && node.nodeName === '#text') {
    return node.value;
  }
  if ('childNodes' in node && Array.isArray(node.childNodes)) {
    return node.childNodes.map((child) => textContent(child)).join('');
  }
  return '';
}

export function visitNodes(
  node: AstNode,
  callback: (node: AstNode, ancestors: AstElement[]) => void,
  ancestors: AstElement[] = [],
): void {
  callback(node, ancestors);
  if ('childNodes' in node && Array.isArray(node.childNodes)) {
    const nextAncestors = isElement(node) ? [...ancestors, node] : ancestors;
    for (const child of node.childNodes) {
      visitNodes(child, callback, nextAncestors);
    }
  }
}

function emptyMetrics(): StatementMetrics {
  return {
    sectionCount: 0,
    sectionTitleCount: 0,
    paragraphCount: 0,
    lineBreakCount: 0,
    demandCount: 0,
    closingRowCount: 0,
    characterCount: 0,
  };
}

export function analyzeStatementFragment(
  fragment: string,
  sourcePath = 'statement body fragment',
): StatementAnalysisResult {
  const source = String(fragment || '');
  const label = String(sourcePath);
  const errors: string[] = [];
  const metrics = emptyMetrics();
  const report = (message: string): void => {
    errors.push(`${label}: ${message}`);
  };

  if (!source.trim()) {
    report('statement body is empty');
    return { errors, html: '', metrics, success: false };
  }

  const document = parse5.parseFragment(source, { sourceCodeLocationInfo: true });
  const closingBlocks: AstElement[] = [];
  const closingParagraphs: AstElement[] = [];
  let demandBlockCount = 0;

  visitNodes(document, (node, ancestors) => {
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') {
      report('contains unsupported comment or doctype markup');
    }
    if (!isElement(node)) return;

    if (!ALLOWED_TAGS.has(node.tagName)) {
      report(`contains unsupported <${node.tagName}> markup`);
    }
    for (const attribute of node.attrs) {
      if (node.tagName === 'a' && ['href', 'target', 'rel'].includes(attribute.name)) {
        continue;
      }
      if (attribute.name !== 'class') {
        report(`contains unsupported ${attribute.name} attribute on <${node.tagName}>`);
      }
    }
    if (node.tagName === 'a') {
      const hrefVal = getAttr(node, 'href');
      if (!hrefVal || !hrefVal.trim()) {
        report('<a> must have a non-empty href attribute');
      } else if (/^\s*(javascript|vbscript|data|blob|file):/i.test(hrefVal)) {
        report(`contains unsafe href attribute on <a> (${hrefVal})`);
      }
    }
    for (const cls of classNames(node)) {
      if (!ALLOWED_CLASSES.has(cls)) {
        report(`contains unsupported class: ${cls}`);
      }
    }

    if (node.tagName === 'section') metrics.sectionCount += 1;
    if (node.tagName === 'h2' && hasClass(node, 'section-title')) {
      metrics.sectionTitleCount += 1;
    }
    if (node.tagName === 'p' && hasClass(node, 'body-text')) {
      metrics.paragraphCount += 1;
    }
    if (node.tagName === 'br') metrics.lineBreakCount += 1;
    if (node.tagName === 'div' && hasClass(node, 'demands')) {
      demandBlockCount += 1;
    }
    if (
      node.tagName === 'li' &&
      node.parentNode &&
      isElement(node.parentNode) &&
      ['ol', 'ul'].includes(node.parentNode.tagName) &&
      ancestors.some((ancestor) => hasClass(ancestor, 'demands'))
    ) {
      metrics.demandCount += 1;
    }
    if (node.tagName === 'div' && hasClass(node, 'closing-block')) {
      closingBlocks.push(node);
    }
    if (
      node.tagName === 'p' &&
      (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text'))
    ) {
      closingParagraphs.push(node);
    }
  });

  metrics.characterCount = textContent(document).replace(/\s+/g, '').length;
  if (
    metrics.sectionCount < 1 ||
    metrics.sectionTitleCount < 1 ||
    metrics.paragraphCount < 1
  ) {
    report('must contain sections, section-title headings, and body-text paragraphs');
  }
  if (demandBlockCount > 1) {
    report('may contain at most one demands block');
  }
  if (demandBlockCount === 1 && metrics.demandCount < 1) {
    report('demands block must contain at least one list item');
  }

  if (closingBlocks.length !== 1) {
    report('must contain one closing block with highlights and one closing-text row');
  } else {
    const closingBlock = closingBlocks[0]!;
    if (closingBlock.parentNode !== document) {
      report('closing block must be a top-level element');
    }

    const children = closingBlock.childNodes;
    const closingRows = children.filter(isElement);
    const invalidClosingText = children.some(
      (node) =>
        node.nodeName === '#text' &&
        'value' in node &&
        String(node.value || '').trim().length > 0,
    );
    const validClosingRows = closingRows.every(
      (node) =>
        node.tagName === 'p' &&
        (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text')),
    );
    const closingTextRows = closingRows.filter((node) => hasClass(node, 'closing-text'));
    const lastClosingRow = closingRows[closingRows.length - 1];
    if (
      invalidClosingText ||
      !validClosingRows ||
      closingRows.length < 2 ||
      closingTextRows.length !== 1 ||
      !lastClosingRow ||
      !hasClass(lastClosingRow, 'closing-text')
    ) {
      report('closing block must end with one closing-text row after its highlights');
    }
    if (closingParagraphs.some((node) => node.parentNode !== closingBlock)) {
      report('closing rows must be direct children of the closing block');
    }
    metrics.closingRowCount = closingRows.length;

    const topLevelElements = document.childNodes.filter(isElement);
    const invalidTopLevelNode = document.childNodes.find((node) => {
      if (node.nodeName === '#text' && 'value' in node) {
        return String(node.value || '').trim().length > 0;
      }
      if (isElement(node) && node.tagName === 'section') return false;
      return node !== closingBlock;
    });
    if (
      invalidTopLevelNode ||
      topLevelElements[topLevelElements.length - 1] !== closingBlock
    ) {
      report('may contain only sections followed by the closing block at the top level');
    }
  }

  return {
    errors,
    html: parse5.serialize(document).trim(),
    metrics,
    success: errors.length === 0,
  };
}

export function inspectStatementFragment(
  fragment: string,
  sourcePath = 'statement body fragment',
): StatementAnalysisResult {
  const source = String(fragment || '');
  const label = String(sourcePath);
  if (!source.trim()) {
    throw new Error(
      `${label} must contain sections, section-title headings, and body-text paragraphs`,
    );
  }
  const analysis = analyzeStatementFragment(fragment, label);
  if (!analysis.success) {
    const first = analysis.errors[0] ?? 'invalid statement fragment';
    throw new Error(first.replace(`${label}: `, `${label} `));
  }
  return analysis;
}

export function normalizeTitleLines(
  title: string,
  titleLines?: string[],
): string[] {
  if (Array.isArray(titleLines) && titleLines.length > 0) {
    return titleLines;
  }
  return [title];
}

export function selectPrintDensity(
  metrics: StatementMetrics,
  title: string,
  titleLines?: string[],
): PrintDensity {
  const lines = normalizeTitleLines(title, titleLines);
  const titleChars = lines.join('').replace(/\s+/g, '').length;
  const extraTitleLines = Math.max(0, lines.length - 1);
  const score =
    metrics.characterCount +
    metrics.paragraphCount * 45 +
    metrics.lineBreakCount * 35 +
    metrics.sectionTitleCount * 120 +
    metrics.demandCount * 85 +
    metrics.closingRowCount * 60 +
    titleChars * 6 +
    extraTitleLines * 80;

  if (score <= 1400) return 'short';
  if (score <= 2800) return 'standard';
  return 'long';
}
