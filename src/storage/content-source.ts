import fs from 'node:fs';
import path from 'node:path';
import {
  buildContentGraphFromSnapshot,
  type ContentGraph,
  ContentGraphValidationError,
  type ContentSchemaBundle,
} from '../domain/content-graph.js';

export interface ContentSource {
  validate(): { success: boolean; data?: ContentGraph; errors: string[] };
  load(): ContentGraph;
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function relativePosix(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
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

function loadSchemaBundle(projectRoot: string): ContentSchemaBundle {
  const schemasDir = path.join(projectRoot, '_source', 'schemas');
  const readSchema = (name: string) =>
    JSON.parse(readText(path.join(schemasDir, name))) as Record<string, unknown>;

  return {
    documentSchema: readSchema('document.schema.json'),
    catalogSchema: readSchema('catalog.schema.json'),
    topicsSchema: readSchema('topics.schema.json'),
    sourcesSchema: readSchema('sources.schema.json'),
  };
}

export class FileSystemContentSource implements ContentSource {
  private readonly absRoot: string;

  constructor(projectRoot: string) {
    this.absRoot = path.resolve(projectRoot);
  }

  validate(): { success: boolean; data?: ContentGraph; errors: string[] } {
    let schemas: ContentSchemaBundle;
    try {
      schemas = loadSchemaBundle(this.absRoot);
    } catch (err) {
      return { success: false, errors: [(err as Error).message] };
    }

    const preErrors: string[] = [];
    const readJson = (filePath: string, label: string): unknown => {
      if (!fs.existsSync(filePath)) {
        preErrors.push(`${label}: file is missing`);
        return undefined;
      }
      try {
        return JSON.parse(readText(filePath));
      } catch (err) {
        preErrors.push(`${label}: invalid JSON (${(err as Error).message})`);
        return undefined;
      }
    };

    const topicsRaw = readJson(
      path.join(this.absRoot, '_source', 'topics.json'),
      '_source/topics.json',
    );
    const sourcesRaw = readJson(
      path.join(this.absRoot, '_source', 'sources.json'),
      '_source/sources.json',
    );
    const catalogRaw = readJson(
      path.join(this.absRoot, '_source', 'catalog.json'),
      '_source/catalog.json',
    );

    const momDir = path.join(this.absRoot, '_source', 'mom');
    const momPaths = readDirectoryFiles(
      momDir,
      (_p, name) => path.extname(name).toLowerCase() === '.md' && name !== 'README.md',
    ).sort((a, b) =>
      relativePosix(this.absRoot, a).localeCompare(relativePosix(this.absRoot, b), 'ko'),
    );

    const momFiles = momPaths.map((filePath) => ({
      filePath,
      label: relativePosix(this.absRoot, filePath),
      rawText: readText(filePath),
    }));

    return buildContentGraphFromSnapshot({
      projectRoot: this.absRoot,
      schemas,
      topicsRaw,
      sourcesRaw,
      catalogRaw,
      preErrors,
      momFiles,
      resolveManualSourcePath: (_doc, relPosixPath) =>
        path.join(this.absRoot, ...relPosixPath.split('/')),
      hasManualSourceFile: (_doc, relPosixPath) =>
        fs.existsSync(path.join(this.absRoot, ...relPosixPath.split('/'))),
      hasSocialImage: (socialImage) => {
        const imgAbs = path.join(this.absRoot, '_source', ...socialImage.split('/'));
        const legacyImgAbs = path.join(this.absRoot, ...socialImage.split('/'));
        return fs.existsSync(imgAbs) || fs.existsSync(legacyImgAbs);
      },
    });
  }

  load(): ContentGraph {
    const result = this.validate();
    if (!result.success || !result.data) {
      throw new ContentGraphValidationError(result.errors);
    }
    return result.data;
  }
}

export function validateSourceTree(projectRoot: string): {
  success: boolean;
  data?: ContentGraph;
  errors: string[];
} {
  return new FileSystemContentSource(projectRoot).validate();
}

export function loadContentGraph(projectRoot: string): ContentGraph {
  return new FileSystemContentSource(projectRoot).load();
}
