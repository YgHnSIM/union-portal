import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import YAML from 'yaml';
import type { DocCategory, DocumentRecordV3 } from './types.js';

const require = createRequire(import.meta.url);

export const SCHEMA_VERSION = 3;

export interface CategoryMeta {
  key: DocCategory;
  label: string;
  directory: string;
  title: string;
  description: string;
  action: string;
  actions?: Record<'minutes' | 'report', string>;
  order: number;
}

export const CATEGORY_REGISTRY: readonly CategoryMeta[] = [
  {
    key: 'statement',
    label: '성명서',
    directory: 'archive/statement',
    title: '성명서',
    description: '조합 공식 성명서입니다.',
    action: '성명서 보기',
    order: 0,
  },
  {
    key: 'newsletter',
    label: '소식지',
    directory: 'archive/newsletter',
    title: '현장 소식지',
    description: '현장 쟁점과 주요 소식을 담은 소식지입니다.',
    action: '소식지 보기',
    order: 1,
  },
  {
    key: 'mom',
    label: '회의록',
    directory: 'archive/mom',
    title: '운영위원회 회의록',
    description: '운영위원회 정기·임시 회의록입니다.',
    action: '회의록 전문 보기',
    actions: { minutes: '회의록 전문 보기', report: '결산 자료 전문 보기' },
    order: 2,
  },
  {
    key: 'knowledge',
    label: '지식',
    directory: 'archive/knowledge',
    title: '지식',
    description: '노동·법률 쟁점 해설 자료입니다.',
    action: '지식 자료 보기',
    order: 3,
  },
  {
    key: 'notice',
    label: '알림',
    directory: 'archive/notice',
    title: '알림',
    description: '조합 활동 및 공지 안내입니다.',
    action: '알림 보기',
    order: 4,
  },
];

export const CATEGORY_BY_ID = new Map(
  CATEGORY_REGISTRY.map((c) => [c.key, c] as const),
);

export interface TopicEntry {
  id: string;
  label: string;
}

export interface SourceEntry {
  id: string;
  label: string;
  url?: string;
  retrievedOn?: string;
}

export interface MomSourceItem {
  filePath: string;
  label: string;
  metadata: Record<string, unknown>;
  body: string;
}

export interface ContentGraph {
  schemaVersion: number;
  projectRoot: string;
  documents: DocumentRecordV3[];
  listedDocuments: DocumentRecordV3[];
  documentsById: Map<string, DocumentRecordV3>;
  topicsById: Map<string, TopicEntry>;
  sourcesById: Map<string, SourceEntry>;
  sourcePathsById: Map<string, string | undefined>;
  momSourcesById: Map<string, MomSourceItem>;
}

export class ContentGraphValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'ContentGraphValidationError';
  }
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function normalizeKey(value: string): string {
  return String(value).normalize('NFC').toLocaleLowerCase('en-US');
}

function relativePosix(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertDate(value: unknown, label: string, errors: string[]): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${label}: must be a valid YYYY-MM-DD date`);
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    errors.push(`${label}: must be a valid calendar date`);
    return false;
  }
  return true;
}

export function parseYamlFrontMatter(
  markdown: string,
  sourcePath: string,
): { metadata: Record<string, unknown>; body: string } {
  const source = String(markdown ?? '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`${sourcePath}: YAML frontmatter must start and end with ---`);
  }
  const doc = YAML.parseDocument(match[1]!, { uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new Error(
      `${sourcePath}: ${doc.errors.map((e) => e.message).join('; ')}`,
    );
  }
  const metadata = doc.toJS({ maxAliasCount: 0 });
  if (!isObject(metadata)) {
    throw new Error(`${sourcePath}: frontmatter must be a mapping`);
  }
  return { metadata, body: source.slice(match[0].length) };
}

function readDirectoryFiles(
  directory: string,
  predicate: (filePath: string, name: string) => boolean,
): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  const visit = (cur: string): void => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const target = path.join(cur, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && predicate(target, entry.name)) files.push(target);
    }
  };
  visit(directory);
  return files;
}

function sourcePathForDocument(
  projectRoot: string,
  document: DocumentRecordV3,
): string | undefined {
  if (document.category === 'mom') return undefined;
  const catPrefix = `archive/${document.category}/`;
  const rel = document.route.startsWith(catPrefix)
    ? document.route.slice(catPrefix.length)
    : document.route.split('/').slice(1).join('/');
  if (document.category === 'statement') {
    return path.join(
      projectRoot,
      '_source',
      'statement',
      `${rel.slice(0, -'.html'.length)}.body.html`,
    );
  }
  return path.join(projectRoot, '_source', document.category, rel);
}

export function validateRoute(
  route: unknown,
  category: DocCategory,
  label: string,
  errors: string[],
): string | undefined {
  if (typeof route !== 'string' || !route.trim()) {
    errors.push(`${label}.route: must be a non-empty POSIX relative .html path`);
    return undefined;
  }
  const value = route.trim();
  const categoryMeta = CATEGORY_BY_ID.get(category);
  const segments = value.split('/');
  const unsafe =
    !value.endsWith('.html') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    segments.some((s) => !s || s === '.' || s === '..');
  if (unsafe) {
    errors.push(`${label}.route: unsafe POSIX relative .html path (${value})`);
    return undefined;
  }
  if (categoryMeta && !value.startsWith(`${categoryMeta.directory}/`)) {
    errors.push(
      `${label}.route: must be inside ${categoryMeta.directory}/ for category ${category}`,
    );
  }
  if (path.posix.normalize(value) !== value) {
    errors.push(`${label}.route: must not contain redundant path segments`);
  }
  return value;
}

interface AjvValidator<T> {
  (data: unknown): data is T;
  errors?: Array<{ instancePath?: string; message?: string }> | null;
}

interface AjvInstance {
  addSchema(schema: object, key?: string): void;
  compile<T>(schema: object): AjvValidator<T>;
}

function loadSchemaValidators(projectRoot: string) {
  const schemasDir = path.join(projectRoot, '_source', 'schemas');
  const readSchema = (name: string) =>
    JSON.parse(readText(path.join(schemasDir, name))) as Record<string, unknown>;

  const documentSchema = readSchema('document.schema.json');
  const catalogSchema = readSchema('catalog.schema.json');
  const topicsSchema = readSchema('topics.schema.json');
  const sourcesSchema = readSchema('sources.schema.json');

  const Ajv2020 = require('ajv/dist/2020') as new (
    opts: Record<string, unknown>,
  ) => AjvInstance;
  const addFormats = require('ajv-formats') as (ajv: AjvInstance) => void;
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(documentSchema, String(documentSchema.$id));

  return {
    validateDocument: ajv.compile<DocumentRecordV3>(documentSchema),
    validateCatalog: ajv.compile<{
      $schema: string;
      schemaVersion: number;
      documents: DocumentRecordV3[];
    }>(catalogSchema),
    validateTopics: ajv.compile<{ topics: TopicEntry[] }>(topicsSchema),
    validateSources: ajv.compile<{ sources: SourceEntry[] }>(sourcesSchema),
  };
}

export function validateSourceTree(projectRoot: string): {
  success: boolean;
  data?: ContentGraph;
  errors: string[];
} {
  const errors: string[] = [];
  const absRoot = path.resolve(projectRoot);

  let validators: ReturnType<typeof loadSchemaValidators>;
  try {
    validators = loadSchemaValidators(absRoot);
  } catch (err) {
    return { success: false, errors: [(err as Error).message] };
  }

  const readJson = (filePath: string, label: string): unknown => {
    if (!fs.existsSync(filePath)) {
      errors.push(`${label}: file is missing`);
      return undefined;
    }
    try {
      return JSON.parse(readText(filePath));
    } catch (err) {
      errors.push(`${label}: invalid JSON (${(err as Error).message})`);
      return undefined;
    }
  };

  const addAjvErrors = (
    validator: { errors?: Array<{ instancePath?: string; message?: string }> | null },
    label: string,
  ): void => {
    for (const err of validator.errors ?? []) {
      const ptr = err.instancePath || '/';
      errors.push(`${label}${ptr === '/' ? '' : ptr}: ${err.message}`);
    }
  };

  const topicsRaw = readJson(
    path.join(absRoot, '_source', 'topics.json'),
    '_source/topics.json',
  );
  const sourcesRaw = readJson(
    path.join(absRoot, '_source', 'sources.json'),
    '_source/sources.json',
  );
  const catalogRaw = readJson(
    path.join(absRoot, '_source', 'catalog.json'),
    '_source/catalog.json',
  );

  const topics: TopicEntry[] =
    topicsRaw && validators.validateTopics(topicsRaw)
      ? topicsRaw.topics
      : (topicsRaw ? addAjvErrors(validators.validateTopics, '_source/topics.json') : undefined,
        []);
  const sources: SourceEntry[] =
    sourcesRaw && validators.validateSources(sourcesRaw)
      ? sourcesRaw.sources
      : (sourcesRaw ? addAjvErrors(validators.validateSources, '_source/sources.json') : undefined,
        []);

  const topicsById = new Map(topics.map((t) => [t.id, t]));
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  let manualDocs: DocumentRecordV3[] = [];
  if (catalogRaw) {
    if (validators.validateCatalog(catalogRaw)) {
      manualDocs = catalogRaw.documents;
    } else {
      addAjvErrors(validators.validateCatalog, '_source/catalog.json');
    }
  }

  const momDir = path.join(absRoot, '_source', 'mom');
  const momFiles = readDirectoryFiles(
    momDir,
    (_p, name) => path.extname(name).toLowerCase() === '.md' && name !== 'README.md',
  ).sort((a, b) => relativePosix(absRoot, a).localeCompare(relativePosix(absRoot, b), 'ko'));

  const momSources: MomSourceItem[] = [];
  for (const filePath of momFiles) {
    const label = relativePosix(absRoot, filePath);
    try {
      const parsed = parseYamlFrontMatter(readText(filePath), label);
      momSources.push({ filePath, label, metadata: parsed.metadata, body: parsed.body });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  const rawRecords: Array<{
    record: DocumentRecordV3;
    label: string;
    kind: 'manual' | 'mom';
    momSource?: MomSourceItem;
  }> = [];

  manualDocs.forEach((doc, idx) => {
    rawRecords.push({
      record: doc,
      label: `_source/catalog.json#/documents/${idx}`,
      kind: 'manual',
    });
  });

  momSources.forEach((src) => {
    const label = `${src.label}#/frontmatter`;
    if (validators.validateDocument(src.metadata)) {
      rawRecords.push({
        record: src.metadata,
        label,
        kind: 'mom',
        momSource: src,
      });
    } else {
      addAjvErrors(validators.validateDocument, label);
    }
  });

  const ids = new Map<string, string>();
  const canonicalIds = new Map<string, string>();
  const routes = new Map<string, string>();
  const items: Array<{
    record: DocumentRecordV3;
    label: string;
    kind: 'manual' | 'mom';
    sourcePath?: string;
    momSource?: MomSourceItem;
  }> = [];

  for (const entry of rawRecords) {
    const record = JSON.parse(JSON.stringify(entry.record)) as DocumentRecordV3;
    record.id = record.id.normalize('NFC');
    const idPrefix = record.id.slice(0, record.id.indexOf(':'));
    if (idPrefix !== record.category) {
      errors.push(`${entry.label}.id: must use category prefix ${record.category}`);
    }
    const validRoute = validateRoute(record.route, record.category, entry.label, errors);
    if (validRoute) record.route = validRoute;

    if (entry.kind === 'manual' && record.category === 'mom') {
      errors.push(`${entry.label}.category: catalog documents cannot be mom`);
    }
    if (entry.kind === 'mom' && record.category !== 'mom') {
      errors.push(`${entry.label}.category: MoM frontmatter must use mom`);
    }
    if (record.category === 'mom' && !['minutes', 'report'].includes(record.type ?? '')) {
      errors.push(`${entry.label}.type: must be minutes or report for category mom`);
    }
    if (record.category !== 'mom' && record.type !== undefined) {
      errors.push(`${entry.label}.type: only allowed for category mom`);
    }
    if (record.category !== 'mom' && record.financePeriod !== undefined) {
      errors.push(`${entry.label}.financePeriod: only allowed for category mom`);
    }

    assertDate(record.dates.publishedOn, `${entry.label}.dates.publishedOn`, errors);
    assertDate(record.dates.modifiedOn, `${entry.label}.dates.modifiedOn`, errors);
    assertDate(record.dates.reviewedOn, `${entry.label}.dates.reviewedOn`, errors);
    if (record.dates.eventOn !== undefined) {
      assertDate(record.dates.eventOn, `${entry.label}.dates.eventOn`, errors);
    }
    if (record.dates.modifiedOn < record.dates.publishedOn) {
      errors.push(`${entry.label}.dates.modifiedOn: must be on or after publishedOn`);
    }
    if (record.dates.reviewedOn < record.dates.publishedOn) {
      errors.push(`${entry.label}.dates.reviewedOn: must be on or after publishedOn`);
    }

    record.topicIds.forEach((tid, idx) => {
      if (!topicsById.has(tid)) {
        errors.push(`${entry.label}.topicIds[${idx}]: unknown topic ${tid}`);
      }
    });
    record.evidence.sourceIds.forEach((sid, idx) => {
      if (!sourcesById.has(sid)) {
        errors.push(`${entry.label}.evidence.sourceIds[${idx}]: unknown source ${sid}`);
      }
    });

    if (record.socialImage) {
      const imgAbs = path.join(absRoot, '_source', ...record.socialImage.split('/'));
      const legacyImgAbs = path.join(absRoot, ...record.socialImage.split('/'));
      if (!fs.existsSync(imgAbs) && !fs.existsSync(legacyImgAbs)) {
        errors.push(`${entry.label}.socialImage: image file is missing (${record.socialImage})`);
      }
    }

    const idKey = normalizeKey(record.id);
    if (ids.has(idKey)) {
      errors.push(`${entry.label}.id: duplicate identifier with ${ids.get(idKey)}`);
    } else {
      ids.set(idKey, entry.label);
      canonicalIds.set(idKey, record.id);
    }

    const routeKey = normalizeKey(record.route);
    if (routes.has(routeKey)) {
      errors.push(`${entry.label}.route: duplicate route with ${routes.get(routeKey)}`);
    } else {
      routes.set(routeKey, entry.label);
    }

    const sourcePath = sourcePathForDocument(absRoot, record);
    if (entry.kind === 'manual') {
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        errors.push(
          `${entry.label}: source file is missing (${sourcePath ? relativePosix(absRoot, sourcePath) : 'unknown'})`,
        );
      }
    }

    items.push({
      record,
      label: entry.label,
      kind: entry.kind,
      sourcePath,
      momSource: entry.momSource,
    });
  }

  for (const item of items) {
    item.record.relatedDocumentIds = item.record.relatedDocumentIds.map((rid, idx) => {
      const canonical = canonicalIds.get(normalizeKey(rid));
      if (!canonical) {
        errors.push(`${item.label}.relatedDocumentIds[${idx}]: unknown document ${rid}`);
        return rid;
      }
      if (canonical === item.record.id) {
        errors.push(`${item.label}.relatedDocumentIds[${idx}]: self reference is not allowed`);
      }
      return canonical;
    });
  }

  items.sort(
    (a, b) =>
      b.record.dates.publishedOn.localeCompare(a.record.dates.publishedOn) ||
      (CATEGORY_BY_ID.get(a.record.category)?.order ?? 99) -
        (CATEGORY_BY_ID.get(b.record.category)?.order ?? 99) ||
      a.record.displayOrder - b.record.displayOrder ||
      a.record.id.localeCompare(b.record.id, 'ko'),
  );

  const documents = items.map((i) => i.record);
  const data: ContentGraph = {
    schemaVersion: SCHEMA_VERSION,
    projectRoot: absRoot,
    documents,
    listedDocuments: documents.filter((d) => d.workflow.visibility === 'public'),
    documentsById: new Map(documents.map((d) => [d.id, d])),
    topicsById,
    sourcesById,
    sourcePathsById: new Map(
      items.map((i) => [i.record.id, i.sourcePath ?? i.momSource?.filePath]),
    ),
    momSourcesById: new Map(
      items
        .filter((i): i is typeof i & { momSource: MomSourceItem } => Boolean(i.momSource))
        .map((i) => [i.record.id, i.momSource]),
    ),
  };

  return { success: errors.length === 0, data, errors };
}

export function loadContentGraph(projectRoot: string): ContentGraph {
  const result = validateSourceTree(projectRoot);
  if (!result.success || !result.data) {
    throw new ContentGraphValidationError(result.errors);
  }
  return result.data;
}
