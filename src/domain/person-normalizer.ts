import type { DirectoryBundle, StripTokensConfig } from './types.js';

export const DEFAULT_STRIP_TOKENS: StripTokensConfig = {
  honorifics: ['선생님', '여사님', '여사', '선생', '귀하', '님', '씨'],
  modifiers: ['직무대행', '신임', '전', '현'],
  titles: [
    '경영기획처장',
    '경영지원실장',
    '수석부위원장',
    '부위원장',
    '위원장',
    '사무국장',
    '부지부장',
    '지부장',
    '분회장',
    '본부장',
    '단장',
    '처장',
    '실장',
    '팀장',
    '과장',
    '반장',
    '조장',
    '조합원',
    '의장',
    '간사',
    '강사',
    '노무사',
    '변호사',
  ],
};

export const NON_PERSON_WORDS = new Set([
  '부모님',
  '어머님',
  '아버님',
  '할머님',
  '할아버님',
  '선생님',
  '스승님',
  '하느님',
  '하나님',
  '부처님',
]);

const SPACED_HONORIFIC_RE =
  /(^|[\s(/,-])([가-힣]{2,4})\s+(?:선생님|여사님|귀하|님|씨)(?=$|[^가-힣])/g;

const EVENT_NIM_RE =
  /(^|[\s(/,-])([가-힣]{2,4})님(?=\s*(?:모친상|부친상|장인상|장모상|빙모상|빙부상|시모상|시부상|조모상|조부상|결혼|백일|돌|입원|퇴직|\())/g;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueSortedByLengthDesc(values: string[]): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    const t = String(v ?? '').trim();
    if (t) seen.add(t);
  }
  return [...seen].sort((a, b) => b.length - a.length || a.localeCompare(b, 'ko'));
}

export function stripTokensFromBundle(
  bundle?: Partial<DirectoryBundle> | null,
): { honorifics: string[]; modifiers: string[]; titles: string[] } {
  const cfg = bundle?.stripTokens;
  const honorifics = uniqueSortedByLengthDesc(
    cfg?.honorifics && cfg.honorifics.length > 0
      ? cfg.honorifics
      : DEFAULT_STRIP_TOKENS.honorifics,
  );
  const modifiers = uniqueSortedByLengthDesc(
    cfg?.modifiers && cfg.modifiers.length > 0
      ? cfg.modifiers
      : DEFAULT_STRIP_TOKENS.modifiers,
  );
  const titles = uniqueSortedByLengthDesc(
    cfg?.titles && cfg.titles.length > 0 ? cfg.titles : DEFAULT_STRIP_TOKENS.titles,
  );
  return { honorifics, modifiers, titles };
}

export function collectPersonNames(
  bundle?: Partial<DirectoryBundle> | null,
): string[] {
  const names = new Set<string>();
  for (const p of bundle?.people ?? []) {
    const n = String(p.name ?? '').trim();
    if (n) names.add(n);
  }
  for (const m of bundle?.members ?? []) {
    const n = String(m.name ?? '').trim();
    if (n) names.add(n);
  }
  for (const e of bundle?.externals ?? []) {
    const n = String(e.name ?? '').trim();
    if (n) names.add(n);
  }
  for (const n of bundle?.privacy?.forbiddenNames ?? []) {
    const t = String(n ?? '').trim();
    if (t) names.add(t);
  }
  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b, 'ko'));
}

export function collectPersonEmails(
  bundle?: Partial<DirectoryBundle> | null,
): string[] {
  const emails = new Set<string>();
  for (const p of [
    ...(bundle?.people ?? []),
    ...(bundle?.members ?? []),
    ...(bundle?.externals ?? []),
  ]) {
    const em = String(p.email ?? '').trim();
    if (em) emails.add(em);
  }
  return [...emails].sort();
}

export function collectPersonPhones(
  bundle?: Partial<DirectoryBundle> | null,
): string[] {
  const phones = new Set<string>();
  for (const p of [
    ...(bundle?.people ?? []),
    ...(bundle?.members ?? []),
    ...(bundle?.externals ?? []),
  ]) {
    const ph = String(p.phone ?? '').trim();
    if (ph) phones.add(ph);
  }
  return [...phones].sort();
}

export function normalizePersonMentions(
  text: string,
  knownNames?: string[] | Set<string> | null,
  bundle?: Partial<DirectoryBundle> | null,
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let out = text;
  const idToName = bundle?.idToName ?? {};
  const { honorifics, modifiers, titles } = stripTokensFromBundle(bundle);
  const allSuffixTokens = uniqueSortedByLengthDesc([...honorifics, ...titles]);
  const modPat = `(?:${modifiers.map(escapeRegExp).join('|')})`;
  const titlePat = `(?:${titles.map(escapeRegExp).join('|')})`;
  const honPat = `(?:${honorifics.map(escapeRegExp).join('|')})`;
  const suffixUnion = allSuffixTokens.map(escapeRegExp).join('|');

  // 1. Resolve person aliases -> formal full name
  const aliases = [...(bundle?.aliases ?? [])].sort(
    (a, b) => String(b.alias ?? '').length - String(a.alias ?? '').length,
  );
  for (const item of aliases) {
    const alias = String(item.alias ?? '').trim();
    const formal = idToName[item.personId] ?? '';
    const mode = item.matchMode ?? 'exact';
    if (!alias || !formal || alias === formal) continue;

    if (mode === 'exact') {
      if (out.includes(alias)) {
        const re = new RegExp(
          `(?<![가-힣])${escapeRegExp(alias)}(?=$|[^가-힣]|(?:${honPat})(?=$|[^가-힣]))`,
          'g',
        );
        out = out.replace(re, formal);
      }
    } else if (mode === 'context_title') {
      const ctxPat = new RegExp(
        `(?<![가-힣])${escapeRegExp(alias)}(?=(?:\\s*(?:${modPat}\\s*)?(?:${suffixUnion})(?:\\s*${honPat})?)(?=$|[^가-힣]))`,
        'g',
      );
      out = out.replace(ctxPat, formal);
    }
  }

  // Collect formal registered names (excluding pure alias strings resolved above)
  const aliasOnly = new Set(aliases.map((a) => String(a.alias ?? '').trim()));
  const baseNames = knownNames ? [...knownNames] : collectPersonNames(bundle);
  const formalNames = uniqueSortedByLengthDesc(baseNames).filter(
    (n) => !aliasOnly.has(n),
  );

  // 2. Strip pre-name titles/modifiers and post-name modifiers/titles/honorifics around formal names
  if (formalNames.length > 0) {
    const joined = formalNames.map(escapeRegExp).join('|');
    const preUnit = `(?:(?:${modPat}\\s+)?${titlePat}\\s+)`;
    const postUnit = `(?:\\s*-\\s*(?:${modPat}\\s*)?${titlePat}|\\s*(?:${modPat}\\s*)?${titlePat}|\\s*${honPat})`;
    const personCtxPat = new RegExp(
      `(?<![가-힣])(?:${preUnit})*(${joined})(?:${postUnit})*(?=$|[^가-힣])`,
      'g',
    );
    out = out.replace(personCtxPat, '$1');
  }

  // 3. Fallback: strip generic honorifics after titles and unregistered Hangul names
  const titleOnlyPat = new RegExp(
    `((?:전\\s*)?(?:${titlePat}))${honPat}(?=$|[^가-힣])`,
    'g',
  );
  out = out.replace(titleOnlyPat, '$1');

  out = out.replace(
    SPACED_HONORIFIC_RE,
    (full: string, p1: string, p2: string) =>
      NON_PERSON_WORDS.has(`${p2}님`) ? full : `${p1}${p2}`,
  );
  out = out.replace(
    EVENT_NIM_RE,
    (full: string, p1: string, p2: string) =>
      NON_PERSON_WORDS.has(`${p2}님`) ? full : `${p1}${p2}`,
  );

  return out;
}
