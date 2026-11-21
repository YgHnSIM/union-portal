import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
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

export interface BylawsMeta {
  title: string;
  enactedOn: string;
  amendedOn: string;
  summary: string;
  historyItems: string[];
}

export interface BylawSubItem {
  marker: string;
  text: string;
}

export interface BylawItem {
  num: string;
  leadBold?: string;
  text: string;
  editorialNote?: string;
  subItems: BylawSubItem[];
}

export interface BylawParagraph {
  marker?: string;
  leadBold?: string;
  text: string;
  editorialNote?: string;
  items: BylawItem[];
}

export interface BylawArticle {
  id: string;
  num: number;
  label: string;
  title: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionId?: string;
  sectionTitle?: string;
  topicGroup: string;
  paragraphs: BylawParagraph[];
  editorialNotes: string[];
  plainText: string;
}

export interface BylawSection {
  id: string;
  heading: string;
  articles: BylawArticle[];
}

export interface BylawChapter {
  id: string;
  number: number;
  label: string;
  title: string;
  fullHeading: string;
  topicGroup: string;
  leadArticles: BylawArticle[];
  sections: BylawSection[];
}

export interface BylawAttachment {
  id: string;
  label: string;
  text: string;
}

export interface BylawsDocument {
  meta: BylawsMeta;
  preamble: string;
  chapters: BylawChapter[];
  addenda: {
    id: string;
    heading: string;
    articles: BylawArticle[];
    attachments: BylawAttachment[];
  };
  allArticles: BylawArticle[];
  articleById: Map<string, BylawArticle>;
}

export const BYLAW_TOPIC_GROUPS = [
  { key: 'all', label: '전체' },
  { key: 'general-org', label: '총칙·조직' },
  { key: 'rights-dues', label: '권리·조합비' },
  { key: 'organs-meetings', label: '기관·회의' },
  { key: 'officers-depts', label: '임원·부서' },
  { key: 'finance', label: '회계' },
  { key: 'dispute-bargaining', label: '쟁의·교섭' },
  { key: 'discipline-dissolution', label: '징계·탄핵·해산' },
  { key: 'addenda', label: '부칙·별첨' },
] as const;

function chapterTopicGroup(chNum: number): string {
  if (chNum <= 2) return 'general-org';
  if (chNum === 3) return 'rights-dues';
  if (chNum <= 5) return 'organs-meetings';
  if (chNum <= 7) return 'officers-depts';
  if (chNum === 8) return 'finance';
  if (chNum <= 10) return 'dispute-bargaining';
  return 'discipline-dissolution';
}

function extractEditorialNote(raw: string): { clean: string; note?: string } {
  const m = raw.match(/\s*\*\((※[^)]+)\)\*\s*$/);
  if (!m) return { clean: raw.trim() };
  return {
    clean: raw.slice(0, m.index).trim(),
    note: m[1]!.trim(),
  };
}

function extractLeadBold(raw: string): { leadBold?: string; text: string } {
  const m = raw.match(/^\*\*([^*]+)\*\*\s*(?:[:：]\s*)?(.*)$/);
  if (!m) return { text: raw.trim() };
  return {
    leadBold: m[1]!.trim(),
    text: m[2]!.trim(),
  };
}

function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function parseFrontmatter(source: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const normalized = source.replace(/^\uFEFF/, '');
  const m = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    return { data: {}, body: normalized };
  }
  const parsed = YAML.parse(m[1]!) as Record<string, unknown> | null;
  return { data: parsed ?? {}, body: m[2]! };
}

export function parseBylawsMarkdown(source: string): BylawsDocument {
  const { data, body } = parseFrontmatter(source);
  const lines = body.split(/\r?\n/);

  const historyItems: string[] = [];
  let preambleLines: string[] = [];
  const chapters: BylawChapter[] = [];
  const addendaArticles: BylawArticle[] = [];
  const attachments: BylawAttachment[] = [];

  type Mode = 'header' | 'preamble' | 'chapter' | 'addenda';
  let mode: Mode = 'header';
  let currentChapter: BylawChapter | undefined;
  let currentSection: BylawSection | undefined;
  let currentArticle: BylawArticle | undefined;
  let currentParagraph: BylawParagraph | undefined;
  let currentItem: BylawItem | undefined;

  const usedArticleIds = new Set<string>();

  const allocateArticleId = (prefix: string, num: number): string => {
    const base = `${prefix}-${num}`;
    if (!usedArticleIds.has(base)) {
      usedArticleIds.add(base);
      return base;
    }
    let suffix = 2;
    while (usedArticleIds.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    const id = `${base}-${suffix}`;
    usedArticleIds.add(id);
    return id;
  };

  const finalizeArticle = (art: BylawArticle | undefined): void => {
    if (!art) return;
    const chunks: string[] = [art.label, art.title, art.chapterTitle];
    if (art.sectionTitle) chunks.push(art.sectionTitle);
    for (const p of art.paragraphs) {
      if (p.marker) chunks.push(p.marker);
      if (p.leadBold) chunks.push(p.leadBold);
      if (p.text) chunks.push(p.text);
      for (const it of p.items) {
        chunks.push(it.num);
        if (it.leadBold) chunks.push(it.leadBold);
        if (it.text) chunks.push(it.text);
        for (const sub of it.subItems) {
          chunks.push(sub.marker, sub.text);
        }
      }
    }
    art.plainText = chunks.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === '---') {
      continue;
    }

    // Top title (# 규 약)
    if (mode === 'header' && /^#\s+/.test(trimmed)) {
      continue;
    }

    // History bullets in header (* **2020년 2월 20일 제정**)
    if (mode === 'header' && /^\*\s+/.test(trimmed)) {
      historyItems.push(stripInlineMarkdown(trimmed.replace(/^\*\s+/, '')));
      continue;
    }

    // ## Headings: Preamble, Chapters, Addenda
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      finalizeArticle(currentArticle);
      currentArticle = undefined;
      currentParagraph = undefined;
      currentItem = undefined;
      currentSection = undefined;

      const headingText = h2[1]!.trim();
      const compact = headingText.replace(/\s+/g, '');
      if (compact === '전문') {
        mode = 'preamble';
        continue;
      }
      if (compact === '부칙') {
        mode = 'addenda';
        currentChapter = undefined;
        continue;
      }

      const chMatch = headingText.match(/^제(\d+)장\s+(.+)$/);
      if (chMatch) {
        mode = 'chapter';
        const chNum = Number(chMatch[1]);
        const chTitle = chMatch[2]!.trim();
        const ch: BylawChapter = {
          id: `ch-${chNum}`,
          number: chNum,
          label: `제${chNum}장`,
          title: chTitle,
          fullHeading: `제${chNum}장 ${chTitle}`,
          topicGroup: chapterTopicGroup(chNum),
          leadArticles: [],
          sections: [],
        };
        chapters.push(ch);
        currentChapter = ch;
        continue;
      }
    }

    if (mode === 'preamble') {
      preambleLines.push(trimmed);
      continue;
    }

    // ### Section heading inside chapter (e.g., ### 제1절 총회)
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3 && mode === 'chapter' && currentChapter) {
      finalizeArticle(currentArticle);
      currentArticle = undefined;
      currentParagraph = undefined;
      currentItem = undefined;
      const secHeading = h3[1]!.trim();
      const secNumMatch = secHeading.match(/^제(\d+)절/);
      const secIndex = secNumMatch
        ? Number(secNumMatch[1])
        : currentChapter.sections.length + 1;
      const sec: BylawSection = {
        id: `${currentChapter.id}-sec-${secIndex}`,
        heading: secHeading,
        articles: [],
      };
      currentChapter.sections.push(sec);
      currentSection = sec;
      continue;
    }

    // Attachments under addenda (* **별첨1.** ...)
    if (mode === 'addenda') {
      const attMatch = trimmed.match(/^\*\s+\*\*(별첨\d+\.?)\*\*\s*(.+)$/);
      if (attMatch) {
        finalizeArticle(currentArticle);
        currentArticle = undefined;
        currentParagraph = undefined;
        currentItem = undefined;
        attachments.push({
          id: `attachment-${attachments.length + 1}`,
          label: attMatch[1]!.replace(/\.$/, ''),
          text: stripInlineMarkdown(attMatch[2]!),
        });
        continue;
      }
    }

    // Article heading (**제1조(명칭)** ...)
    const artMatch = trimmed.match(/^\*\*제(\d+)조\(([^)]+)\)\*\*\s*(.*)$/);
    if (artMatch && (mode === 'chapter' || mode === 'addenda')) {
      finalizeArticle(currentArticle);
      currentParagraph = undefined;
      currentItem = undefined;

      const artNum = Number(artMatch[1]);
      const artTitle = artMatch[2]!.trim();
      const restRaw = artMatch[3]!.trim();
      const isAddendum = mode === 'addenda';
      const id = allocateArticleId(isAddendum ? 'addendum' : 'art', artNum);

      const art: BylawArticle = {
        id,
        num: artNum,
        label: `제${artNum}조`,
        title: artTitle,
        chapterId: isAddendum ? 'addenda' : currentChapter!.id,
        chapterNumber: isAddendum ? 99 : currentChapter!.number,
        chapterTitle: isAddendum ? '부칙' : currentChapter!.fullHeading,
        sectionId: currentSection?.id,
        sectionTitle: currentSection?.heading,
        topicGroup: isAddendum ? 'addenda' : currentChapter!.topicGroup,
        paragraphs: [],
        editorialNotes: [],
        plainText: '',
      };

      if (restRaw) {
        const { clean, note } = extractEditorialNote(restRaw);
        const { leadBold, text } = extractLeadBold(clean);
        const para: BylawParagraph = {
          leadBold,
          text,
          editorialNote: note,
          items: [],
        };
        art.paragraphs.push(para);
        if (note) art.editorialNotes.push(note);
        currentParagraph = para;
      }

      if (isAddendum) {
        addendaArticles.push(art);
      } else if (currentSection) {
        currentSection.articles.push(art);
      } else if (currentChapter) {
        currentChapter.leadArticles.push(art);
      }
      currentArticle = art;
      continue;
    }

    if (!currentArticle) continue;

    // Circled-number paragraph (①, ②, ③, ④, ⑤...)
    const circledMatch = trimmed.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/);
    if (circledMatch) {
      const marker = circledMatch[1]!;
      const { clean, note } = extractEditorialNote(circledMatch[2]!);
      const { leadBold, text } = extractLeadBold(clean);
      const para: BylawParagraph = {
        marker,
        leadBold,
        text,
        editorialNote: note,
        items: [],
      };
      currentArticle.paragraphs.push(para);
      if (note) currentArticle.editorialNotes.push(note);
      currentParagraph = para;
      currentItem = undefined;
      continue;
    }

    // Nested sub-item (* 가) 수석부위원장)
    const subItemMatch = trimmed.match(/^\*\s+([가-힣]\))\s*(.+)$/);
    if (subItemMatch && currentItem) {
      currentItem.subItems.push({
        marker: subItemMatch[1]!,
        text: stripInlineMarkdown(subItemMatch[2]!),
      });
      continue;
    }

    // Numbered item (1. ...)
    const itemMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (itemMatch) {
      const { clean, note } = extractEditorialNote(itemMatch[2]!);
      const { leadBold, text } = extractLeadBold(clean);
      if (!currentParagraph) {
        currentParagraph = { text: '', items: [] };
        currentArticle.paragraphs.push(currentParagraph);
      }
      const item: BylawItem = {
        num: `${itemMatch[1]!}.`,
        leadBold,
        text,
        editorialNote: note,
        subItems: [],
      };
      currentParagraph.items.push(item);
      if (note) currentArticle.editorialNotes.push(note);
      currentItem = item;
      continue;
    }

    // Fallback continuation paragraph inside an article
    const { clean, note } = extractEditorialNote(trimmed);
    const { leadBold, text } = extractLeadBold(clean);
    const para: BylawParagraph = {
      leadBold,
      text,
      editorialNote: note,
      items: [],
    };
    currentArticle.paragraphs.push(para);
    if (note) currentArticle.editorialNotes.push(note);
    currentParagraph = para;
    currentItem = undefined;
  }

  finalizeArticle(currentArticle);

  const allArticles: BylawArticle[] = [];
  const articleById = new Map<string, BylawArticle>();
  for (const ch of chapters) {
    for (const a of ch.leadArticles) {
      allArticles.push(a);
      articleById.set(a.id, a);
    }
    for (const s of ch.sections) {
      for (const a of s.articles) {
        allArticles.push(a);
        articleById.set(a.id, a);
      }
    }
  }
  for (const a of addendaArticles) {
    allArticles.push(a);
    articleById.set(a.id, a);
  }

  return {
    meta: {
      title: String(data.title ?? '우체국물류지원단 물류노동조합 규약'),
      enactedOn: String(data.enactedOn ?? '2020-02-20'),
      amendedOn: String(data.amendedOn ?? '2025-12-05'),
      summary: String(
        data.summary ??
          '우체국물류지원단 물류노동조합의 조직, 권리·의무, 기관과 회의, 임원·부서, 회계, 쟁의, 단체교섭 및 규율 통제에 관한 기본 규약입니다.',
      ),
      historyItems,
    },
    preamble: preambleLines.join(' ').trim(),
    chapters,
    addenda: {
      id: 'addenda',
      heading: '부칙',
      articles: addendaArticles,
      attachments,
    },
    allArticles,
    articleById,
  };
}

export function loadBylawsDocument(projectRoot: string): BylawsDocument | null {
  const filePath = path.join(projectRoot, '_source', 'union', 'bylaws.md');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseBylawsMarkdown(raw);
}

function fmtDateKorean(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

function fmtDateDot(iso: string): string {
  return iso.replace(/-/g, '.');
}

function artLink(id: string, label: string): string {
  return `<a class="bylaw-ref-chip" href="bylaws.html#${escapeAttr(id)}">${escapeHtml(label)}</a>`;
}

function renderGovernanceSvg(): string {
  return `<svg class="bylaws-diagram-svg" viewBox="0 0 920 430" role="img" aria-labelledby="svg-gov-title svg-gov-desc">
  <title id="svg-gov-title">노동조합 의결·집행·견제 거버넌스 체계도</title>
  <desc id="svg-gov-desc">조합원 전원이 구성하는 총회와 대의원대회가 최고의결기구이며, 차상위 운영위원회와 위원장 중심 집행부, 10개 부서 및 지부조직이 실무를 수행하고, 회계감사위원회와 선거관리위원회가 독립 견제·관리를 맡는 구조입니다.</desc>
  <defs>
    <marker id="gov-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--color-rule-ui, #698096)" />
    </marker>
    <marker id="gov-arrow-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--color-accent, #12354e)" />
    </marker>
  </defs>

  <!-- Tier 1: Members -->
  <rect x="300" y="14" width="320" height="54" rx="4" fill="var(--color-accent, #12354e)" />
  <text x="460" y="37" text-anchor="middle" fill="var(--color-accent-ink, #ffffff)" font-size="15" font-weight="800">조합원 전원 (주권 주체)</text>
  <text x="460" y="56" text-anchor="middle" fill="var(--color-accent-ink, #ffffff)" font-size="11.5" opacity="0.9">정규직 공무직 · 기간제노동자 (제5조 · 제9조)</text>

  <!-- Connectors from Members -->
  <line x1="380" y1="68" x2="290" y2="104" stroke="var(--color-accent, #12354e)" stroke-width="1.8" marker-end="url(#gov-arrow-accent)" />
  <line x1="540" y1="68" x2="630" y2="104" stroke="var(--color-accent, #12354e)" stroke-width="1.8" marker-end="url(#gov-arrow-accent)" />

  <!-- Tier 2: General Assembly & Delegate Convention -->
  <rect x="135" y="106" width="295" height="72" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--color-accent, #12354e)" stroke-width="2" />
  <rect x="135" y="106" width="295" height="5" fill="var(--color-accent, #12354e)" />
  <text x="282.5" y="131" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="14.5" font-weight="800">총 회 (최고의결기구)</text>
  <text x="282.5" y="150" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">매년 12월 정기 · 전속: 해산·위원장 선출/불신임</text>
  <text x="282.5" y="167" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">제14조 ~ 제16조</text>

  <rect x="490" y="106" width="295" height="72" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--chart-cobalt, #516db2)" stroke-width="1.8" />
  <rect x="490" y="106" width="295" height="5" fill="var(--chart-cobalt, #516db2)" />
  <text x="637.5" y="131" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="14.5" font-weight="800">대의원대회 (총회 갈음)</text>
  <text x="637.5" y="150" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">10명당 1명 (단수 5명 초과 +1) · 임기 3년</text>
  <text x="637.5" y="167" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">직접·비밀·무기명 선출 · 제17조 ~ 제20조</text>

  <!-- Horizontal link between Assembly and Delegates -->
  <line x1="432" y1="142" x2="488" y2="142" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" stroke-dasharray="4 3" />

  <!-- Connectors down to Steering Committee -->
  <line x1="282" y1="178" x2="420" y2="218" stroke="var(--color-rule-ui, #698096)" stroke-width="1.6" marker-end="url(#gov-arrow)" />
  <line x1="638" y1="178" x2="500" y2="218" stroke="var(--color-rule-ui, #698096)" stroke-width="1.6" marker-end="url(#gov-arrow)" />

  <!-- Tier 3: Steering Committee (Center) + Audit (Left) + Election (Right) -->
  <rect x="295" y="220" width="330" height="76" rx="4" fill="var(--color-logo-soft, #e8eef9)" stroke="var(--chart-cobalt, #516db2)" stroke-width="1.8" />
  <text x="460" y="244" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="14.5" font-weight="800">운영위원회 (차상위 의결기관)</text>
  <text x="460" y="263" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">위원장 · 부위원장 · 사무국장 · 각 지부장 · 본조 간부</text>
  <text x="460" y="281" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">임단협 심의 · 규정 제개정 · 예산 전용 · 징계 등 15개 기능 (제23~25조)</text>

  <!-- Left Independent Wing: Audit Committee -->
  <rect x="24" y="220" width="230" height="76" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--chart-income, #39793c)" stroke-width="1.8" />
  <rect x="24" y="220" width="5" height="76" fill="var(--chart-income, #39793c)" />
  <text x="142" y="244" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="13.5" font-weight="800">회계감사위원회</text>
  <text x="142" y="263" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">회계감사대표위원 · 6개월 1회 감사</text>
  <text x="142" y="281" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">외부감사 선임 가능 (제13·31조)</text>
  <line x1="254" y1="258" x2="293" y2="258" stroke="var(--chart-income, #39793c)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#gov-arrow)" />

  <!-- Right Independent Wing: Election Commission -->
  <rect x="666" y="220" width="230" height="76" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--chart-grant, #c48823)" stroke-width="1.8" />
  <rect x="891" y="220" width="5" height="76" fill="var(--chart-grant, #c48823)" />
  <text x="778" y="244" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="13.5" font-weight="800">선거관리위원회</text>
  <text x="778" y="263" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">임원선거 · 쟁의투표 이의 심의</text>
  <text x="778" y="281" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">운영위 구성 결의 (제13·25·42조)</text>
  <line x1="625" y1="258" x2="664" y2="258" stroke="var(--chart-grant, #c48823)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#gov-arrow)" />

  <!-- Connectors to Tier 4 -->
  <line x1="460" y1="296" x2="460" y2="334" stroke="var(--color-rule-ui, #698096)" stroke-width="1.6" marker-end="url(#gov-arrow)" />
  <line x1="360" y1="296" x2="180" y2="334" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" marker-end="url(#gov-arrow)" />
  <line x1="560" y1="296" x2="740" y2="334" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" marker-end="url(#gov-arrow)" />

  <!-- Tier 4: Executive / 10 Departments / Branches -->
  <rect x="38" y="336" width="265" height="76" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" />
  <text x="170.5" y="360" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="13.5" font-weight="800">임원 · 집행부</text>
  <text x="170.5" y="379" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">위원장(3년·연임금지) · 수석부위원장</text>
  <text x="170.5" y="397" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">부위원장 · 사무국장 (제28~31조)</text>

  <rect x="328" y="336" width="264" height="76" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" />
  <text x="460" y="360" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="13.5" font-weight="800">본조 10개 부서 (국)</text>
  <text x="460" y="379" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">각 국장 1명 · 부장 약간명 (사무국장 지휘)</text>
  <text x="460" y="397" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">총무·조직·교육·쟁의·기획·문화·여성·법규·정책·보건안전</text>

  <rect x="617" y="336" width="265" height="76" rx="4" fill="var(--color-sheet, #ffffff)" stroke="var(--color-rule-ui, #698096)" stroke-width="1.5" />
  <text x="749.5" y="360" text-anchor="middle" fill="var(--color-ink, #0d1b2a)" font-size="13.5" font-weight="800">지부조직 (현장 단위)</text>
  <text x="749.5" y="379" text-anchor="middle" fill="var(--color-ink-2, #1e2d3d)" font-size="11.5">운영위 또는 대의원대회 결의로 설치</text>
  <text x="749.5" y="397" text-anchor="middle" fill="var(--color-muted, #52657a)" font-size="11">지부장 임기 3년 · 지부규약 심의 (제8·25·30조)</text>
</svg>`;
}

export function buildBylawsGuideHtml(
  doc: BylawsDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/bylaws-guide.html';
  const prefix = computePrefixForRoute(route);
  const bodyArticlesCount = doc.allArticles.filter((a) => a.chapterNumber < 99).length;

  const deadlineRows = [
    {
      period: '24시간 내 / 전',
      category: '소집·변경',
      content: '임시총회(대의원회) 소집공고(요청·필요 시 24시간 내) / 정기총회 공고 변경(최소 24시간 전)',
      refs: [artLink('art-16', '제16조②'), artLink('art-22', '제22조')],
    },
    {
      period: '2일 이내',
      category: '구제·청산',
      content: '징계 재심 청구 시 총회(대의원회) 의뢰 / 조합 해산 시 5인 이내 청산위원 임명',
      refs: [artLink('art-55', '제55조②'), artLink('art-58', '제58조①')],
    },
    {
      period: '3일 전 / 이내',
      category: '선거·쟁의·회의',
      content: '대의원 선출공고(3일 전) / 운영위 요청 소집(3일 내) / 쟁의 찬반투표 공고(3일 전) 및 결과 이의제기(공고 후 3일 내)',
      refs: [
        artLink('art-18', '제18조②'),
        artLink('art-24', '제24조'),
        artLink('art-39', '제39조②'),
        artLink('art-42', '제42조②'),
      ],
    },
    {
      period: '5일 전까지',
      category: '대의원 선출',
      content: '정기대의원대회에 참석할 대의원 선출 완료 기한',
      refs: [artLink('art-19', '제19조③')],
    },
    {
      period: '7일 전',
      category: '정기 소집공고',
      content: '정기총회 및 정기대의원대회 소집공고 (장소·일시·목적사항 제시)',
      refs: [artLink('art-16', '제16조①'), artLink('art-17', '제17조②')],
    },
    {
      period: '15일 이내',
      category: '징계 재심',
      content: '정권·제명 통고 후 위원장에게 재심 신청 가능 기간 (결정까지 징계 효력 유보)',
      refs: [artLink('art-55', '제55조①·②')],
    },
    {
      period: '30일 이내',
      category: '보궐선거',
      content: '대의원 자격상실 선거구 보궐선거 실시 (잔여임기 50% 이상 남았을 때)',
      refs: [artLink('art-19', '제19조②')],
    },
    {
      period: '3개월 (3월간)',
      category: '자료 보존·미납',
      content: '쟁의행위 찬반투표 명부·투표용지 보존 및 열람 보장 / 정당한 사유 없는 조합비 3개월 이상 미납 시 징계 사유',
      refs: [artLink('art-43', '제43조'), artLink('art-52', '제52조')],
    },
    {
      period: '6개월마다 1회',
      category: '회계감사',
      content: '회계감사위원의 조합 업무 및 경리 정기 감사 및 각종 회의 보고',
      refs: [artLink('art-31', '제31조④')],
    },
    {
      period: '매년 12월 · 3년',
      category: '정기대회·임기',
      content: '정기총회·정기대의원대회 매년 12월 개최 / 대의원·위원장·지부장 임기 3년 (위원장 연임 금지·차차기 출마 가능)',
      refs: [
        artLink('art-14', '제14조'),
        artLink('art-17', '제17조'),
        artLink('art-19', '제19조'),
        artLink('art-30', '제30조'),
      ],
    },
  ];

  const deadlineRowsHtml = deadlineRows
    .map(
      (r) => `<tr>
        <th scope="row">${escapeHtml(r.period)}</th>
        <td class="ctr" data-label="영역"><span class="doc-cat-badge">${escapeHtml(r.category)}</span></td>
        <td data-label="핵심 규정">${escapeHtml(r.content)}</td>
        <td data-label="근거 조항"><div class="bylaw-ref-list">${r.refs.join(' ')}</div></td>
      </tr>`,
    )
    .join('\n');

  const deptGroups = [
    {
      group: '운영 · 조직 관리',
      tone: 'cobalt',
      items: [
        { name: '총무국', desc: '문서·인장 보관, 문서 수발, 조합비 수납·지출 및 타부 미소속 사항' },
        { name: '조직국', desc: '조합 조직 확대 및 현장 조직력 강화' },
      ],
    },
    {
      group: '교섭 · 법규 · 정책',
      tone: 'accent',
      items: [
        { name: '쟁의국', desc: '노동쟁의 활동 및 쟁의 대책 수립' },
        { name: '법규국', desc: '법 위반 사항 검토 및 노동관계법 유권해석' },
        { name: '정책기획국', desc: '조합 정책 입법 대응 및 제도적 처우 개선' },
      ],
    },
    {
      group: '교육 · 홍보 · 문화',
      tone: 'grant',
      items: [
        { name: '교육국', desc: '조합원·임원 대내외 교육 및 교육자료 제작' },
        { name: '기획국', desc: '조합신문 및 각종 홍보·선전물 제작·배포' },
        { name: '문화국', desc: '노동자 문화 보급 및 창조 발전' },
      ],
    },
    {
      group: '여성 · 보건안전',
      tone: 'income',
      items: [
        { name: '여성국', desc: '여성 조합원 권익 신장 대책 수립 및 생활지도' },
        { name: '보건안전관리국', desc: '산업재해 예방, 직업병 및 유해·위험작업 근로조건 개선' },
      ],
    },
  ];

  const deptCardsHtml = deptGroups
    .map(
      (g) => `<article class="bylaw-dept-group" data-tone="${escapeAttr(g.tone)}">
        <h3 class="bylaw-dept-group-title">${escapeHtml(g.group)}</h3>
        <dl class="bylaw-dept-list">
          ${g.items
            .map(
              (it) => `<div class="bylaw-dept-row"><dt>${escapeHtml(it.name)}</dt><dd>${escapeHtml(it.desc)}</dd></div>`,
            )
            .join('')}
        </dl>
      </article>`,
    )
    .join('\n');

  const chapterSummaries: Record<number, string> = {
    1: '조합 명칭, 자주적·민주적 목적, 9대 핵심 사업, 본사 사무소 소재지',
    2: '가입 대상(공무직·기간제), 가입·탈퇴 절차, 자격 상실 사유, 지부 설치 근거',
    3: '조합원 5대 권리·5대 의무, 조합비 미납 시 권리정지, 기본급 1% 조합비·원천공제',
    4: '4대 기관, 총회·대의원대회·임시총회·운영위원회 구성, 소집 공고 및 권한',
    5: '일반결의(과반 출석·과반 찬성) 및 특별결의(과반 출석·2/3 찬성·직접비밀무기명)',
    6: '5대 임원 구성, 결선투표 포함 선거방식, 3년 임기·위원장 연임금지, 직무대행 순위',
    7: '본조 10개 국(총무·조직·교육·쟁의·기획·문화·여성·법규·정책기획·보건안전) 편제와 임무',
    8: '일반·특별회계 구분, 회계연도(1~12월), 총회 자산관리 의결, 결산 공포·상시 공개',
    9: '쟁의선언 4경로, 3일 전 찬반투표 공고·명부 열람·투개표·이의심의·3개월 보존·쟁대위',
    10: '위원장 대표 단체교섭(위임 가능), 교섭위원 3인+, 요구안 심의·총회 인준, 노사협의회',
    11: '조합원 표창, 징계 사유·3단계(경고·정권·제명), 15일 재심·효력유보, 임원 탄핵(1/3 발의·2/3 의결)',
    12: '회사 폐업 또는 특별결의 해산 사유, 해산 후 2일 내 5인 이내 청산위원 임명·청산',
  };

  const roadmapCardsHtml = [
    ...doc.chapters.map((ch) => {
      const arts = [
        ...ch.leadArticles,
        ...ch.sections.flatMap((s) => s.articles),
      ];
      const first = arts[0];
      const last = arts[arts.length - 1];
      const range =
        first && last
          ? first.num === last.num
            ? `${first.label}`
            : `${first.label} ~ ${last.label}`
          : '';
      return `<a class="bylaw-roadmap-card" href="bylaws.html#${escapeAttr(ch.id)}">
        <div class="bylaw-roadmap-head">
          <span class="doc-cat-badge">${escapeHtml(ch.label)}</span>
          <span class="bylaw-roadmap-range">${escapeHtml(range)} (${arts.length}조)</span>
        </div>
        <h3>${escapeHtml(ch.title)}</h3>
        <p>${escapeHtml(chapterSummaries[ch.number] ?? '')}</p>
      </a>`;
    }),
    `<a class="bylaw-roadmap-card is-addenda" href="bylaws.html#addenda">
      <div class="bylaw-roadmap-head">
        <span class="doc-cat-badge">부칙</span>
        <span class="bylaw-roadmap-range">제1~3조 · 별첨 ${doc.addenda.attachments.length}건</span>
      </div>
      <h3>시행·준용·해석 및 개정 공시</h3>
      <p>총회 통과일 효력 발생, 노동관계법 준용, 위원장 해석권, TFT 개정 절차 및 2025.12.05 임기 개정 공시</p>
    </a>`,
  ].join('\n');

  const bodyHtml = `
  <header class="page-masthead">
    <div>
      <h1>노동조합 규약 한눈에 보기</h1>
      <p class="lead">총 12장 ${bodyArticlesCount}개 조항으로 구성된 조합 규약의 기관 체계, 정족수, 권리·의무, 교섭·쟁의·징계 절차를 도식과 핵심 기준표로 개괄합니다.</p>
    </div>
    <div class="masthead-meta">
      <span class="data-stamp">${escapeHtml(fmtDateDot(doc.meta.enactedOn))} 제정 · ${escapeHtml(fmtDateDot(doc.meta.amendedOn))} 개정</span>
      <a class="btn small" href="bylaws.html">규약 전문 읽기 →</a>
    </div>
  </header>

  <div class="kpi-strip" role="region" aria-label="조합 규약 핵심 수치">
    <div class="kpi"><div class="label">규약 구성</div><div class="value">12장 · ${bodyArticlesCount}조</div><div class="sub">부칙 ${doc.addenda.articles.length}조 · 별첨 ${doc.addenda.attachments.length}건 (제37조 중복)</div></div>
    <div class="kpi" data-tone="balance"><div class="label">매월 조합비</div><div class="value">기본급의 1%</div><div class="sub">단체협약 명시 원천공제 가능 (제12조)</div></div>
    <div class="kpi" data-tone="grant"><div class="label">임원·대의원 임기</div><div class="value">3년</div><div class="sub">위원장 연임 금지 · 차차기 출마 가능 (제30조)</div></div>
    <div class="kpi" data-tone="income"><div class="label">정기 회계감사</div><div class="value">6개월마다 1회</div><div class="sub">운영위 결의로 외부감사 선임 가능 (제31조)</div></div>
  </div>

  <section class="section-band" aria-labelledby="sec-bylaws-gov">
    <div class="section-head">
      <h2 id="sec-bylaws-gov">1. 의결 · 집행 · 견제 거버넌스 체계</h2>
      <span class="section-sub">4대 기관과 임원·부서·지부 구조 ${artLink('art-13', '제13조')}</span>
    </div>
    <figure class="bylaws-diagram-frame">
      <p class="bylaws-diagram-scroll-hint" aria-hidden="true">← 좌우로 밀어 전체 체계도 보기 →</p>
      <div class="bylaws-diagram-scroll" tabindex="0" role="region" aria-label="노동조합 의결·집행·견제 거버넌스 체계도">
        ${renderGovernanceSvg()}
      </div>
      <figcaption class="bylaws-diagram-caption">총회와 대의원대회가 최고의결기구 역할을 수행하며, 회계감사위원회와 선거관리위원회가 재정·선거의 공정성을 독립 점검합니다.</figcaption>
    </figure>

    <div class="bylaws-callout-grid">
      <article class="bylaw-info-card">
        <h3>총회 전속 의결사항 (대의원대회 위임 불가)</h3>
        <p class="bylaw-card-desc">대의원대회가 총회를 갈음할 수 있으나, 아래 3가지는 반드시 조합원 전원 총회 의결을 거쳐야 합니다.</p>
        <ul class="bylaw-bullet-list">
          <li>조합의 해산에 관한 사항</li>
          <li>위원장 선출과 불신임에 관한 사항</li>
          <li>기타 중요한 사항</li>
        </ul>
        <div class="bylaw-ref-list">${artLink('art-15', '제15조②')} ${artLink('art-20', '제20조')}</div>
      </article>

      <article class="bylaw-info-card">
        <h3>위원장 유고 시 직무대행 4단계 순위</h3>
        <p class="bylaw-card-desc">위원장 유고 시 규약이 정한 순서대로 직무를 대행하며, 모든 순위가 유고일 때 운영위원회가 위촉합니다.</p>
        <ol class="bylaw-rank-steps">
          <li><span class="bylaw-step-badge">1순위</span><strong>수석부위원장</strong></li>
          <li><span class="bylaw-step-badge">2순위</span><strong>부위원장</strong></li>
          <li><span class="bylaw-step-badge">3순위</span><strong>사무국장</strong></li>
          <li><span class="bylaw-step-badge">4순위</span><strong>운영위원회 선출</strong></li>
        </ol>
        <div class="bylaw-ref-list">${artLink('art-31', '제31조①7')} ${artLink('art-25', '제25조13')}</div>
      </article>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-bylaws-quorum">
    <div class="section-head">
      <h2 id="sec-bylaws-quorum">2. 의사결정 정족수 비교 & 핵심 기한</h2>
      <span class="section-sub">안건 중요도에 따른 의결 요건과 법정 공고·구제 기한</span>
    </div>

    <div class="bylaw-quorum-grid">
      <article class="bylaw-quorum-card" data-tone="cobalt">
        <div class="bylaw-quorum-top">
          <span class="doc-cat-badge">일반결의</span>
          <span class="bylaw-quorum-ratio">출석 50%+</span>
        </div>
        <h3>재적 과반수 출석 · 출석 과반수 찬성</h3>
        <div class="bylaw-meter" aria-hidden="true">
          <div class="bylaw-meter-fill" style="width: 50.5%"></div>
          <span class="bylaw-meter-mark" style="left: 50%"></span>
        </div>
        <ul class="bylaw-bullet-list">
          <li>각종 회의의 일반 안건 의결</li>
          <li>임원 선출 1차 투표 (과반 미달 시 상위 2인 결선투표 다수결)</li>
          <li>단체교섭 권한 위임 (총회·대의원회 참석자 과반 동의)</li>
        </ul>
        <div class="bylaw-ref-list">${artLink('art-26', '제26조')} ${artLink('art-29', '제29조')} ${artLink('art-46', '제46조')}</div>
      </article>

      <article class="bylaw-quorum-card" data-tone="expense">
        <div class="bylaw-quorum-top">
          <span class="doc-cat-badge">특별결의</span>
          <span class="bylaw-quorum-ratio">출석 2/3 이상</span>
        </div>
        <h3>재적 과반수 출석 · 출석 2/3 이상 찬성</h3>
        <div class="bylaw-meter" aria-hidden="true">
          <div class="bylaw-meter-fill" style="width: 66.7%"></div>
          <span class="bylaw-meter-mark" style="left: 66.7%"></span>
        </div>
        <ul class="bylaw-bullet-list">
          <li>규약의 변경 (직접·비밀·무기명 투표 필수)</li>
          <li>임원의 해임·탄핵 (탄핵은 조합원 1/3 이상 발의)</li>
          <li>조합의 합병·분할·해산 및 조직형태 변경</li>
        </ul>
        <div class="bylaw-ref-list">${artLink('art-27', '제27조')} ${artLink('art-56', '제56조')} ${artLink('art-57', '제57조')}</div>
      </article>

      <article class="bylaw-quorum-card" data-tone="grant">
        <div class="bylaw-quorum-top">
          <span class="doc-cat-badge">쟁의행위 결의</span>
          <span class="bylaw-quorum-ratio">재적 50%+</span>
        </div>
        <h3>전체 재적 조합원 과반수 찬성</h3>
        <div class="bylaw-meter" aria-hidden="true">
          <div class="bylaw-meter-fill" style="width: 50.5%"></div>
          <span class="bylaw-meter-mark" style="left: 50%"></span>
        </div>
        <ul class="bylaw-bullet-list">
          <li>출석 기준이 아닌 <strong>전체 재적 조합원 과반수</strong> 찬성 요건</li>
          <li>조합원의 직접·비밀·무기명 투표 필수</li>
          <li>투표일 3일 전 공고 및 명부 비치·상시 열람 보장</li>
        </ul>
        <div class="bylaw-ref-list">${artLink('art-39', '제39조')} ${artLink('art-40', '제40조')} ${artLink('art-41', '제41조')}</div>
      </article>
    </div>

    <div class="bylaw-table-block">
      <h3 id="tbl-bylaw-deadlines" class="bylaw-sub-heading">규약상 핵심 소집 · 공고 · 구제 · 보존 기한표</h3>
      <div tabindex="0" role="region" aria-labelledby="tbl-bylaw-deadlines" class="table-wrapper">
        <table>
          <caption class="visually-hidden">노동조합 규약상 핵심 소집·공고·구제·보존 기한표</caption>
          <thead>
            <tr>
              <th scope="col">기준 기한</th>
              <th scope="col">영역</th>
              <th scope="col">핵심 규정</th>
              <th scope="col">근거 조항</th>
            </tr>
          </thead>
          <tbody>
            ${deadlineRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-bylaws-member">
    <div class="section-head">
      <h2 id="sec-bylaws-member">3. 조합원 권리 · 의무 & 자격 · 징계 흐름</h2>
      <span class="section-sub">가입에서 활동, 징계·재심 구제, 자격 상실까지의 기준</span>
    </div>

    <ol class="bylaw-flow-steps" aria-label="조합원 자격 생애주기">
      <li class="bylaw-flow-step">
        <span class="bylaw-flow-num">STEP 1</span>
        <h3>가입 신청 · 결재</h3>
        <p>정규직 공무직·기간제(사용자 제외)가 가입원서 제출 후 위원장 결재로 자격 발생 (운영위 의결로 거부 가능)</p>
        <div class="bylaw-ref-list">${artLink('art-5', '제5조')} ${artLink('art-6', '제6조')}</div>
      </li>
      <li class="bylaw-flow-step">
        <span class="bylaw-flow-num">STEP 2</span>
        <h3>조합비 납부 · 권리 행사</h3>
        <p>1회 조합비(기본급 1%) 납부 시 권리·의무 개시. 미납 기간 중 권리 정지</p>
        <div class="bylaw-ref-list">${artLink('art-6', '제6조2')} ${artLink('art-11', '제11조')} ${artLink('art-12', '제12조')}</div>
      </li>
      <li class="bylaw-flow-step">
        <span class="bylaw-flow-num">STEP 3</span>
        <h3>규율 통제 · 재심 구제</h3>
        <p>강령·규약 위반, 단결 저해, 3개월 미납(해고다툼·부득이 사유 제외) 시 경고·정권·제명. 정권·제명은 15일 내 재심(효력 유보)</p>
        <div class="bylaw-ref-list">${artLink('art-52', '제52조')} ${artLink('art-53', '제53조')} ${artLink('art-55', '제55조')}</div>
      </li>
      <li class="bylaw-flow-step">
        <span class="bylaw-flow-num">STEP 4</span>
        <h3>자격 상실</h3>
        <p>퇴직·해고·사망, 규약 절차에 의한 제명, 탈퇴서 위원장 결재, 비조합원 범위 해당 시 상실</p>
        <div class="bylaw-ref-list">${artLink('art-7', '제7조')}</div>
      </li>
    </ol>

    <div class="bylaws-dual-panel">
      <article class="bylaw-dual-card" data-tone="income">
        <div class="bylaw-dual-head">
          <h3>조합원의 5대 권리</h3>
          ${artLink('art-9', '제9조')}
        </div>
        <ol class="bylaw-numbered-list">
          <li>조합의 모든 활동에 균등히 참여할 권리</li>
          <li>조합의 각 급 선거권과 피선거권</li>
          <li>조합 운영에 관한 동등한 발언권 및 결의권</li>
          <li>결정사항과 업무집행 사항의 공개를 요구할 권리</li>
          <li>직접 선출한 임원·간부 및 대의원에 대한 불신임권</li>
        </ol>
      </article>

      <article class="bylaw-dual-card" data-tone="cobalt">
        <div class="bylaw-dual-head">
          <h3>조합원의 5대 의무</h3>
          ${artLink('art-10', '제10조')}
        </div>
        <ol class="bylaw-numbered-list">
          <li>조합 운영규정과 각종 기관의 결의사항을 준수할 의무</li>
          <li>조합활동에 필요한 기밀을 지킬 의무</li>
          <li>조합비(기본급 1%) 및 각종 기금을 납부할 의무</li>
          <li>조직의 규율을 준수하고 조합의 명예를 유지할 의무</li>
          <li>조합의 제반 활동에 적극 협력하고 참가할 의무</li>
        </ol>
      </article>
    </div>

    <div class="bylaw-remedy-bar" role="note" aria-label="징계 및 재심 구제 절차 요약">
      <div class="bylaw-remedy-title">징계 결정 권한 및 재심 절차 ${artLink('art-52', '제52조')} ${artLink('art-55', '제55조')}</div>
      <div class="bylaw-remedy-chain">
        <span class="bylaw-chain-node"><strong>징계 결의</strong><small>일반 조합원: 운영위 / 임원·운영위원: 총회</small></span>
        <span class="bylaw-chain-arrow" aria-hidden="true">→</span>
        <span class="bylaw-chain-node"><strong>처분 통고</strong><small>경고 · 정권 · 제명</small></span>
        <span class="bylaw-chain-arrow" aria-hidden="true">→</span>
        <span class="bylaw-chain-node is-highlight"><strong>15일 내 재심 청구</strong><small>정권·제명 한정 · 결정까지 효력 유보</small></span>
        <span class="bylaw-chain-arrow" aria-hidden="true">→</span>
        <span class="bylaw-chain-node"><strong>2일 내 총회 의뢰</strong><small>총회(대의원회) 최종 재심 결정</small></span>
      </div>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-bylaws-negotiation">
    <div class="section-head">
      <h2 id="sec-bylaws-negotiation">4. 단체교섭 · 노사협의 & 쟁의행위 절차</h2>
      <span class="section-sub">평화적 교섭 트랙(제10장)과 교섭 결렬 시 쟁의 트랙(제9장)</span>
    </div>

    <div class="bylaw-tracks">
      <article class="bylaw-track-card" data-tone="accent">
        <div class="bylaw-track-head">
          <span class="doc-cat-badge">TRACK A · 제10장</span>
          <h3>단체교섭 및 노사협의 절차</h3>
        </div>
        <ol class="bylaw-vertical-flow">
          <li>
            <strong>교섭위원 구성</strong> ${artLink('art-47', '제47조')}
            <p>위원장이 위원장 포함 3인 이상을 위촉하고 운영위원회 승인 획득</p>
          </li>
          <li>
            <strong>단체협약 요구안 심의</strong> ${artLink('art-48', '제48조')}
            <p>교섭위원이 참여하는 운영위원회를 거쳐 총회(또는 대의원회)에서 심의</p>
          </li>
          <li>
            <strong>단체교섭 진행</strong> ${artLink('art-46', '제46조')}
            <p>조합이 당사자이며 위원장이 교섭위원장 수행 (총회·대의원회 참석자 과반 동의로 위임 가능)</p>
          </li>
          <li>
            <strong>협약 체결 및 총회 인준</strong> ${artLink('art-49', '제49조')}
            <p>위원장이 대표로서 협약을 체결하고 총회의 인준을 받아 최종 확정</p>
          </li>
        </ol>
        <p class="bylaw-track-foot"><strong>노사협의회 ${artLink('art-50', '제50조')}</strong> · 위원장·부위원장 포함, 위원장 추천 및 운영위 승인으로 구성하며 위원장이 노조측 대표위원을 맡습니다.</p>
      </article>

      <article class="bylaw-track-card" data-tone="expense">
        <div class="bylaw-track-head">
          <span class="doc-cat-badge">TRACK B · 제9장</span>
          <h3>교섭 결렬 시 노동쟁의 절차</h3>
        </div>
        <ol class="bylaw-vertical-flow">
          <li>
            <strong>쟁의선언 (4개 경로)</strong> ${artLink('art-37-2', '제37조')} ${artLink('art-38', '제38조')}
            <p>평화적 교섭 결렬 시 ① 위원장 대표권 ② 상무집행·운영위 의결 ③ 대의원회 의결/과반 ④ 총회 의결/과반으로 선언</p>
          </li>
          <li>
            <strong>투표 공고 & 명부 비치</strong> ${artLink('art-39', '제39조')} ${artLink('art-40', '제40조')}
            <p>투표일 3일 전 일시·장소 공고, 동시에 노조 사무실에 투표자명부 비치(조합원 상시 열람)</p>
          </li>
          <li>
            <strong>직접·비밀·무기명 찬반투표</strong> ${artLink('art-39', '제39조①')} ${artLink('art-41', '제41조')}
            <p>신분증 대조 후 비밀 기표소에서 직접 기표, <strong>재적 조합원 과반수 찬성</strong>으로 가결</p>
          </li>
          <li>
            <strong>결과 공개 · 이의심의 · 보존</strong> ${artLink('art-42', '제42조')} ${artLink('art-43', '제43조')}
            <p>종료 후 지체 없이 재적·투표·찬성 수와 찬성률 공고(3일 내 이의제기·선관위 심의), 명부·용지 3개월 보존·열람</p>
          </li>
          <li>
            <strong>쟁의대책위원회 가동</strong> ${artLink('art-44', '제44조')} ${artLink('art-45', '제45조')}
            <p>운영위 즉시 소집해 쟁대위 구성, 구체안 수립 및 정당방위·후생복지위원회 등 필요 기구 설치</p>
          </li>
        </ol>
      </article>
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-bylaws-depts">
    <div class="section-head">
      <h2 id="sec-bylaws-depts">5. 본조 10개 부서(국) 역할 안내</h2>
      <span class="section-sub">각 국 국장 1명 · 부장 약간명 (사무국장 지휘) ${artLink('art-32', '제32조')} ${artLink('art-33', '제33조')}</span>
    </div>
    <div class="bylaw-dept-grid">
      ${deptCardsHtml}
    </div>
  </section>

  <section class="section-band" aria-labelledby="sec-bylaws-roadmap">
    <div class="section-head">
      <h2 id="sec-bylaws-roadmap">6. 장별 규약 로드맵 (전문 바로가기)</h2>
      <span class="section-sub">카드를 선택하면 규약 전문의 해당 장으로 바로 이동합니다</span>
    </div>
    <div class="bylaw-roadmap-grid">
      ${roadmapCardsHtml}
    </div>
  </section>`;

  return renderPageShell({
    title: '규약 한눈에 보기',
    description:
      '우체국물류지원단 물류노동조합 규약의 기관 체계, 의결정족수, 조합원 권리·의무, 단체교섭·쟁의 절차 및 10개 부서 역할을 시각적으로 정리한 안내 페이지입니다.',
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    subnavHtml: renderUnionSubnav('', 'bylaws-guide'),
    bodyHtml,
  });
}

function renderArticleParagraphHtml(para: BylawParagraph): string {
  const leadHtml = para.leadBold
    ? `<strong class="bylaw-lead-bold">${escapeHtml(para.leadBold)}</strong>${para.text ? ' : ' : ''}`
    : '';
  const bodyText = para.text ? escapeHtml(para.text) : '';
  const markerHtml = para.marker
    ? `<span class="bylaw-para-marker">${escapeHtml(para.marker)}</span>`
    : '';
  const noteHtml = para.editorialNote
    ? `<span class="bylaw-editorial-note">${escapeHtml(para.editorialNote)}</span>`
    : '';

  const itemsHtml =
    para.items.length > 0
      ? `<ol class="bylaw-items">${para.items
          .map((it) => {
            const itLead = it.leadBold
              ? `<strong class="bylaw-item-bold">${escapeHtml(it.leadBold)}</strong>${it.text ? ' : ' : ''}`
              : '';
            const itNote = it.editorialNote
              ? ` <span class="bylaw-editorial-note">${escapeHtml(it.editorialNote)}</span>`
              : '';
            const subHtml =
              it.subItems.length > 0
                ? `<ol class="bylaw-subitems">${it.subItems
                    .map(
                      (sub) =>
                        `<li><span class="bylaw-subitem-marker">${escapeHtml(sub.marker)}</span><span>${escapeHtml(sub.text)}</span></li>`,
                    )
                    .join('')}</ol>`
                : '';
            return `<li><div class="bylaw-item-line"><span class="bylaw-item-num">${escapeHtml(it.num)}</span><span class="bylaw-item-text">${itLead}${escapeHtml(it.text)}${itNote}</span></div>${subHtml}</li>`;
          })
          .join('')}</ol>`
      : '';

  const hasText = Boolean(markerHtml || leadHtml || bodyText || noteHtml);
  const paraLine = hasText
    ? `<p class="bylaw-para${para.marker ? ' has-marker' : ''}">${markerHtml}<span class="bylaw-para-text">${leadHtml}${bodyText}${noteHtml ? ` ${noteHtml}` : ''}</span></p>`
    : '';

  return `<div class="bylaw-para-block">${paraLine}${itemsHtml}</div>`;
}

function renderArticleHtml(art: BylawArticle): string {
  const paragraphsHtml = art.paragraphs.map(renderArticleParagraphHtml).join('\n');
  const displayTitle = `${art.label}(${art.title})`;
  return `<article class="bylaw-article" id="${escapeAttr(art.id)}" tabindex="-1" data-article-id="${escapeAttr(art.id)}" data-topic="${escapeAttr(art.topicGroup)}" data-search="${escapeAttr(art.plainText)}">
        <header class="bylaw-article-head">
          <h4 class="bylaw-article-title"><span class="bylaw-article-num">${escapeHtml(art.label)}</span><span class="bylaw-article-name">(${escapeHtml(art.title)})</span></h4>
          <button type="button" class="bylaw-anchor-btn no-print" data-copy-anchor="#${escapeAttr(art.id)}" aria-label="${escapeAttr(displayTitle)} 링크 복사" title="조항 링크 복사">
            <span aria-hidden="true">#</span>
            <span class="bylaw-anchor-label">링크</span>
          </button>
        </header>
        <div class="bylaw-article-body">
          ${paragraphsHtml}
        </div>
      </article>`;
}

export function buildBylawsFullHtml(
  doc: BylawsDocument,
  assets: AssetManifest,
  baseUrl: string,
): string {
  const route = 'union/bylaws.html';
  const prefix = computePrefixForRoute(route);
  const bodyArticlesCount = doc.allArticles.filter((a) => a.chapterNumber < 99).length;

  const tocLinksHtml = [
    `<li class="bylaws-toc-item"><a href="#preamble" class="bylaws-toc-link">전문</a></li>`,
    ...doc.chapters.map((ch) => {
      const subLinks =
        ch.sections.length > 0
          ? `<ol class="bylaws-toc-sub">${ch.sections
              .map(
                (s) =>
                  `<li><a href="#${escapeAttr(s.id)}" class="bylaws-toc-link is-sub">${escapeHtml(s.heading)}</a></li>`,
              )
              .join('')}</ol>`
          : '';
      return `<li class="bylaws-toc-item"><a href="#${escapeAttr(ch.id)}" class="bylaws-toc-link">${escapeHtml(ch.fullHeading)}</a>${subLinks}</li>`;
    }),
    `<li class="bylaws-toc-item"><a href="#addenda" class="bylaws-toc-link">부칙 · 별첨</a></li>`,
  ].join('\n          ');

  const topicChipsHtml = BYLAW_TOPIC_GROUPS.map(
    (g, idx) =>
      `<button type="button" class="bylaws-topic-chip" data-topic-filter="${escapeAttr(g.key)}" aria-pressed="${idx === 0 ? 'true' : 'false'}">${escapeHtml(g.label)}</button>`,
  ).join('\n        ');

  const chaptersHtml = doc.chapters
    .map((ch) => {
      const leadHtml = ch.leadArticles.map(renderArticleHtml).join('\n');
      const sectionsHtml = ch.sections
        .map(
          (sec) => `<div class="bylaw-section" id="${escapeAttr(sec.id)}" tabindex="-1">
        <h3 class="bylaw-section-title">${escapeHtml(sec.heading)}</h3>
        ${sec.articles.map(renderArticleHtml).join('\n')}
      </div>`,
        )
        .join('\n');
      const totalArts =
        ch.leadArticles.length + ch.sections.reduce((acc, s) => acc + s.articles.length, 0);
      return `<section class="bylaw-chapter" id="${escapeAttr(ch.id)}" tabindex="-1" data-chapter-id="${escapeAttr(ch.id)}" data-topic="${escapeAttr(ch.topicGroup)}">
        <header class="bylaw-chapter-head">
          <span class="bylaw-chapter-kicker">${escapeHtml(ch.label)}</span>
          <h2 class="bylaw-chapter-title">${escapeHtml(ch.title)}</h2>
          <span class="bylaw-chapter-count">${totalArts}개 조항</span>
        </header>
        ${leadHtml}
        ${sectionsHtml}
      </section>`;
    })
    .join('\n');

  const addendaHtml = `<section class="bylaw-chapter bylaw-addenda" id="addenda" tabindex="-1" data-chapter-id="addenda" data-topic="addenda">
        <header class="bylaw-chapter-head">
          <span class="bylaw-chapter-kicker">부칙</span>
          <h2 class="bylaw-chapter-title">부칙 및 별첨</h2>
          <span class="bylaw-chapter-count">${doc.addenda.articles.length}개 조항 · 별첨 ${doc.addenda.attachments.length}</span>
        </header>
        ${doc.addenda.articles.map(renderArticleHtml).join('\n')}
        ${
          doc.addenda.attachments.length > 0
            ? `<div class="bylaw-attachments">
          <h3 class="bylaw-section-title">별첨 공시</h3>
          <ul class="bylaw-attachment-list">
            ${doc.addenda.attachments
              .map(
                (att) => `<li class="bylaw-attachment-item" id="${escapeAttr(att.id)}" data-search="${escapeAttr(`${att.label} ${att.text}`)}">
              <strong>${escapeHtml(att.label)}.</strong>
              <span>${escapeHtml(att.text)}</span>
            </li>`,
              )
              .join('\n            ')}
          </ul>
        </div>`
            : ''
        }
      </section>`;

  const bodyHtml = `
  <article class="document-article bylaws-document" data-document-category="조합 규약" data-skip-auto-toc="true">
    <header class="page-masthead">
      <div>
        <h1>${escapeHtml(doc.meta.title)}</h1>
        <p class="lead">${escapeHtml(doc.meta.summary)}</p>
      </div>
      <div class="masthead-meta">
        <span class="data-stamp">${escapeHtml(fmtDateKorean(doc.meta.enactedOn))} 제정 · ${escapeHtml(fmtDateKorean(doc.meta.amendedOn))} 개정</span>
        <div class="bylaws-head-actions no-print">
          <a class="btn secondary small" href="bylaws-guide.html">규약 한눈에 보기 →</a>
          <button type="button" class="btn secondary small" data-action="print">인쇄</button>
        </div>
      </div>
    </header>

    <section class="bylaws-toolbar no-print" aria-label="규약 조항 검색 및 주제 필터">
      <form class="bylaws-search-form" id="bylaws-search-form" role="search">
        <label for="bylaws-search-input">조항 번호 또는 키워드 검색</label>
        <div class="bylaws-search-row">
          <div class="archive-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <input id="bylaws-search-input" type="search" placeholder="예: 조합비, 임기, 제12조, 특별결의, 재심, 탄핵" autocomplete="off">
            <button type="button" id="bylaws-search-clear" class="archive-search-clear" hidden>지우기</button>
          </div>
          <button type="submit" class="btn small">검색</button>
        </div>
      </form>
      <div class="bylaws-topic-bar" role="group" aria-label="규약 주제 빠른 필터">
        ${topicChipsHtml}
      </div>
      <div class="bylaws-search-meta">
        <p id="bylaws-result-summary" role="status" aria-live="polite">전체 ${doc.allArticles.length}개 조항 (본문 ${bodyArticlesCount}조 · 부칙 ${doc.addenda.articles.length}조)</p>
        <p id="bylaws-copy-status" class="bylaws-copy-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <div class="bylaws-layout">
      <aside class="bylaws-sidebar no-print" aria-label="규약 목차 탐색">
        <details class="bylaws-toc-disclosure" id="bylaws-toc-disclosure" open>
          <summary class="bylaws-toc-summary">규약 목차 (전문 · 12장 · 부칙)</summary>
          <nav class="bylaws-toc-nav" id="bylaws-toc-nav" aria-label="규약 장·절 목차">
            <ol class="bylaws-toc-list">
              ${tocLinksHtml}
            </ol>
          </nav>
        </details>
      </aside>

      <div class="bylaws-content" id="bylaws-content" data-copy-body>
        <section class="bylaw-preamble" id="preamble" tabindex="-1" data-chapter-id="preamble" data-topic="general-org">
          <div class="bylaw-preamble-meta">
            <h2>전문</h2>
            <ul class="bylaw-history-list">
              ${doc.meta.historyItems.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}
            </ul>
          </div>
          <p>${escapeHtml(doc.preamble)}</p>
        </section>

        ${chaptersHtml}
        ${addendaHtml}

        <div class="bylaws-no-results" id="bylaws-no-results" hidden>
          <p>검색 조건에 일치하는 조항이 없습니다.</p>
          <button type="button" class="btn secondary small" id="bylaws-reset-btn">전체 조항 보기</button>
        </div>
      </div>
    </div>
  </article>
  ${renderDocumentToolsWidget()}`;

  return renderPageShell({
    title: '노동조합 규약 전문',
    description: `${doc.meta.title} 전문 (${fmtDateKorean(doc.meta.enactedOn)} 제정, ${fmtDateKorean(doc.meta.amendedOn)} 개정). 조항 검색, 장·절 목차 및 조항별 링크 공유를 지원합니다.`,
    activeNav: 'union',
    route,
    prefix,
    baseUrl,
    assets,
    subnavHtml: renderUnionSubnav('', 'bylaws'),
    bodyHtml,
    extraScriptsHtml: [
      `<script src="${escapeAttr(assetHref(prefix, 'document-tools.js', assets))}" defer></script>`,
      `<script src="${escapeAttr(assetHref(prefix, 'bylaws.js', assets))}" defer></script>`,
    ].join('\n'),
  });
}
