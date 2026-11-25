import fs from 'node:fs';
import path from 'node:path';
import type { Account, DocumentRecordV3 } from '../domain/types.js';

export interface CoaConfigJson {
  accounts: Account[];
  expenseTypes: string[];
  fundTypes: string[];
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as T;
}

export function writeOutFile(outDir: string, relPosix: string, content: string): void {
  const fullPath = path.join(outDir, ...relPosix.split('/'));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

export function yearTone(year: number): 'odd' | 'even' {
  return year % 2 === 1 ? 'odd' : 'even';
}

export function primaryDateOf(doc: DocumentRecordV3): string {
  return doc.dates.eventOn ?? doc.dates.publishedOn ?? '';
}

export function sortDocumentsDesc(docs: DocumentRecordV3[]): DocumentRecordV3[] {
  return [...docs].sort((a, b) => {
    const da = primaryDateOf(a);
    const db = primaryDateOf(b);
    if (db !== da) return db.localeCompare(da);
    return (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.id.localeCompare(b.id);
  });
}

export function cardTitleOf(doc: DocumentRecordV3): string {
  if (doc.category === 'statement') {
    const lines = doc.presentation?.print?.titleLines;
    if (lines && lines.length > 0) {
      const mainLines = lines.filter((line) => !/^—.*—$/.test(line.trim()));
      if (mainLines.length > 0) {
        return mainLines.join(' ');
      }
    }
    return doc.title.replace(/\s*—[^—]+—\s*$/, '').trim() || doc.title;
  }
  return doc.title;
}
