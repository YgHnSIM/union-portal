import { createHmac } from 'node:crypto';
import {
  collectPersonEmails,
  collectPersonNames,
  collectPersonPhones,
  escapeRegExp,
  normalizePersonMentions,
} from './person-normalizer.js';
import type {
  DirectoryBundle,
  LedgerEntry,
  PersonRole,
  PublicDisclosure,
  RoleScope,
} from './types.js';

export const VALID_ROLE_SCOPES = new Set<RoleScope>([
  'executive',
  'branch_head',
  'auditor',
  'committee',
  'staff_rotating',
  'external_rep',
  'other',
]);

export function parseRoleScope(raw: string | undefined, fallback: RoleScope): RoleScope {
  if (!raw?.trim()) return fallback;
  const val = raw.trim() as RoleScope;
  if (!VALID_ROLE_SCOPES.has(val)) {
    throw new Error(
      `허용되지 않은 직책 구분(role_scope)입니다: ${raw} (허용: ${[...VALID_ROLE_SCOPES].join(', ')})`,
    );
  }
  return val;
}

/**
 * Enforces ADR-0003 invariant: rotating staff roles may never be marked public_official.
 */
export function assertValidRoleDisclosure(
  roleScope: RoleScope | undefined,
  disclosure: PublicDisclosure,
): void {
  if (roleScope === 'staff_rotating' && disclosure === 'public_official') {
    throw new Error(
      '순번제·비공개 관리 직책(staff_rotating)은 public_official로 공개할 수 없습니다 (ADR-0003).',
    );
  }
}

export const PHONE_RE = /01[016789]-?\d{3,4}-?\d{4}/g;
export const PERSONAL_EMAIL_RE =
  /[A-Za-z0-9._%+-]+@(?:naver\.com|gmail\.com|hanmail\.net|daum\.net|kakao\.com|nate\.com)\b/gi;
export const GENERIC_FAMILY_EVENT_RE =
  /[가-힣]{2,4}(?:님|팀장|조합원|위원장|사무국장)\s*(?:모친상|부친상|장인상|장모상|빙모상|빙부상|시모상|시부상|조모상|조부상)/g;

export interface PrivacyHashIndex {
  algorithm: 'hmac-sha256';
  hangulLengths: number[];
  phraseTokens: boolean;
  hashes: string[];
}

export type PrivacyFindingType =
  | 'masked_person'
  | 'finance_context_name'
  | 'phone'
  | 'email'
  | 'family_event'
  | 'hash_match';

export interface PrivacyFinding {
  line: number;
  type: PrivacyFindingType;
  maskedToken: string;
  section?: string;
}

export function maskToken(value: string): string {
  const s = String(value ?? '').trim();
  if (!s) return '***';
  if (s.includes('@')) {
    const [, domain = '***'] = s.split('@');
    return `***@${domain}`;
  }
  if (/^01/.test(s)) {
    return `${s.slice(0, 3)}-****-${s.slice(-4)}`;
  }
  if (s.length <= 2) return `${s[0]}*`;
  return `${s[0]}${'*'.repeat(Math.max(1, s.length - 2))}${s[s.length - 1]}`;
}

export function isPublicOfficialOn(
  roles: PersonRole[],
  personId: string,
  isoDate?: string | null,
): boolean {
  const targetYm =
    isoDate && isoDate.trim().length >= 7 ? isoDate.trim().slice(0, 7) : null;
  return roles.some((role) => {
    if (role.personId !== personId) return false;
    if (role.publicDisclosure !== 'public_official') return false;
    if (!targetYm) return true;
    const fromYm = role.validFrom ? role.validFrom.slice(0, 7) : null;
    const toYm = role.validTo ? role.validTo.slice(0, 7) : null;
    if (fromYm && targetYm < fromYm) return false;
    if (toYm && targetYm > toYm) return false;
    return true;
  });
}

export function sanitizeLedgerRecords(
  records: LedgerEntry[],
  bundle: DirectoryBundle,
): LedgerEntry[] {
  const targetMask = bundle.privacy.targetMask;
  const noteMap = bundle.privacy.exactNoteReplacements;
  const forbidden = collectPersonNames(bundle);

  return records.map((r) => {
    const nr: LedgerEntry = { ...r };

    const rawTarget = normalizePersonMentions(nr.target, forbidden, bundle);
    nr.target = targetMask[rawTarget] ?? targetMask[nr.target] ?? rawTarget;
    for (const name of forbidden) {
      if (nr.target.includes(name)) {
        nr.target = '개인';
      }
    }

    const rawNote = normalizePersonMentions(nr.note, forbidden, bundle);
    let note: string;
    if (rawNote in noteMap) {
      note = noteMap[rawNote]!;
    } else if (nr.note in noteMap) {
      note = noteMap[nr.note]!;
    } else {
      note = rawNote;
      for (const name of forbidden) {
        if (note.includes(name)) {
          const re = new RegExp(
            `${escapeRegExp(name)}(?:\\s*(?:님|팀장|조합원|위원장|사무국장|단장|지부장|처장|실장|반장))?`,
            'g',
          );
          note = note.replace(re, '관계자');
        }
      }
    }
    nr.note = note;

    let memo = normalizePersonMentions(nr.memo, forbidden, bundle);
    for (const name of forbidden) {
      if (memo.includes(name)) {
        memo = memo.split(name).join('관계자');
      }
    }
    nr.memo = memo;
    return nr;
  });
}

export function hmacToken(token: string, salt: string): string {
  return createHmac('sha256', salt).update(token.normalize('NFC')).digest('hex');
}

export function computePrivacyHashes(
  bundle: Partial<DirectoryBundle>,
  salt: string,
): PrivacyHashIndex {
  if (!salt) {
    throw new Error('PRIVACY_HMAC_SALT must not be empty');
  }
  const names = collectPersonNames(bundle);
  const emails = collectPersonEmails(bundle);
  const phones = collectPersonPhones(bundle);
  const exactAliases = (bundle.aliases ?? [])
    .filter((a) => a.matchMode === 'exact')
    .map((a) => a.alias.trim())
    .filter(Boolean);

  const allTokens = new Set<string>([...names, ...exactAliases, ...emails, ...phones]);
  for (const ph of phones) {
    const digits = ph.replace(/\D/g, '');
    if (digits.length >= 10) allTokens.add(digits);
  }

  const hangulLengths = new Set<number>();
  let phraseTokens = false;
  const hashes = new Set<string>();

  for (const token of allTokens) {
    const clean = token.normalize('NFC').trim();
    if (!clean) continue;
    hashes.add(hmacToken(clean, salt));
    if (/^[가-힣]+$/.test(clean)) {
      hangulLengths.add(clean.length);
    } else if (!clean.includes('@') && !/^\d+$/.test(clean.replace(/-/g, ''))) {
      phraseTokens = true;
    }
  }

  return {
    algorithm: 'hmac-sha256',
    hangulLengths: [...hangulLengths].sort((a, b) => a - b),
    phraseTokens,
    hashes: [...hashes].sort(),
  };
}

export function scanTextWithHashes(
  text: string,
  hashIndex: PrivacyHashIndex,
  salt: string,
  allowedPlaintextTokens?: Set<string>,
): Array<{ hash: string; maskedToken: string }> {
  const hashSet = new Set(hashIndex.hashes);
  const allowed = new Set(
    [...(allowedPlaintextTokens ?? [])].map((t) => t.normalize('NFC').trim()),
  );
  const hits: Array<{ hash: string; maskedToken: string }> = [];
  const seen = new Set<string>();

  const checkCandidate = (cand: string): void => {
    const norm = cand.normalize('NFC').trim();
    if (!norm || allowed.has(norm)) return;
    const digest = hmacToken(norm, salt);
    if (hashSet.has(digest) && !seen.has(digest)) {
      seen.add(digest);
      hits.push({ hash: digest, maskedToken: maskToken(norm) });
    }
  };

  // 1. Scan Hangul runs for lengths registered in index
  const hangulRunRe = /[가-힣]{2,}/g;
  for (const match of text.matchAll(hangulRunRe)) {
    const run = match[0];
    for (const len of hashIndex.hangulLengths) {
      if (run.length < len) continue;
      for (let i = 0; i <= run.length - len; i += 1) {
        checkCandidate(run.slice(i, i + len));
      }
    }
  }

  // 2. Scan multi-word Hangul/title phrases if present in index (e.g. 'OOO 반장')
  if (hashIndex.phraseTokens) {
    const phraseRe = /[가-힣A-Za-z0-9]{1,6}(?:\s+[가-힣A-Za-z0-9]{1,6}){1,2}/g;
    for (const match of text.matchAll(phraseRe)) {
      const collapsed = match[0].replace(/\s+/g, ' ');
      checkCandidate(collapsed);
    }
  }

  // 3. Scan email and phone candidates
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const match of text.matchAll(emailRe)) {
    checkCandidate(match[0]);
  }
  const phoneRe = /01[016789]-?\d{3,4}-?\d{4}/g;
  for (const match of text.matchAll(phoneRe)) {
    checkCandidate(match[0]);
    checkCandidate(match[0].replace(/\D/g, ''));
  }

  return hits;
}

export function isFinanceHeading(headingText: string): boolean {
  return /(?:재정\s*(?:현황|운영|결산|과\s*운영)|조합원\s*및\s*재정|찬조금|통장\s*잔액|수입·지출|지출\s*내역)/.test(
    headingText,
  );
}

function stripNonVisibleHtmlBlocksPreservingLines(html: string): string {
  return html.replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,
    (block) => block.replace(/[^\r\n]/g, ' '),
  );
}

function stripHtmlTagsForAudit(line: string): string {
  return line.replace(/<[^>]+>/g, ' ');
}

export function auditDocumentPrivacy(
  options: {
    eventOn?: string | null;
    category?: string;
    isHtml?: boolean;
    allowHistoricalOfficials?: boolean;
  },
  content: string,
  bundle: DirectoryBundle,
): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const docDate = options.eventOn ?? null;

  const peopleByName = new Map<string, string[]>();
  for (const p of bundle.people) {
    const arr = peopleByName.get(p.name) ?? [];
    arr.push(p.personId);
    peopleByName.set(p.name, arr);
  }
  const exactAliases = bundle.aliases.filter((a) => a.matchMode === 'exact');
  const aliasByToken = new Map<string, string>();
  for (const a of exactAliases) {
    aliasByToken.set(a.alias, a.personId);
  }

  const candidateNames = collectPersonNames(bundle);
  const preparedContent = options.isHtml
    ? stripNonVisibleHtmlBlocksPreservingLines(content)
    : content;
  const lines = preparedContent.split(/\r?\n/);

  let inYamlFrontmatter = false;
  let inFinanceSection = false;
  let financeHeadingLevel = 0;
  let financeHtmlTag: string | null = null;
  let financeHtmlDepth = 0;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx] ?? '';
    const lineNo = idx + 1;

    if (idx === 0 && rawLine.trim() === '---') {
      inYamlFrontmatter = true;
      continue;
    }
    if (inYamlFrontmatter) {
      if (rawLine.trim() === '---') {
        inYamlFrontmatter = false;
      }
      continue;
    }

    if (!options.isHtml) {
      const mdHeading = rawLine.match(/^(#{1,6})\s+(.+)$/);
      if (mdHeading) {
        const level = mdHeading[1]!.length;
        const title = mdHeading[2]!.replace(/[*_`]/g, '');
        if (level >= 2 && isFinanceHeading(title)) {
          inFinanceSection = true;
          financeHeadingLevel = level;
        } else if (inFinanceSection && level <= financeHeadingLevel) {
          inFinanceSection = false;
          financeHeadingLevel = 0;
        }
      }
    }

    let lineInFinanceZone = inFinanceSection;
    if (options.isHtml) {
      if (!financeHtmlTag) {
        const openMatch = rawLine.match(
          /<([a-z][a-z0-9-]*)\b[^>]*\bdata-privacy-zone=["']finance["'][^>]*>/i,
        );
        if (openMatch) {
          financeHtmlTag = openMatch[1]!.toLowerCase();
          financeHtmlDepth = 0;
          lineInFinanceZone = true;
        }
      } else {
        lineInFinanceZone = true;
      }
      if (financeHtmlTag) {
        const openTagRe = new RegExp(`<${financeHtmlTag}\\b[^>]*>`, 'gi');
        const closeTagRe = new RegExp(`</${financeHtmlTag}\\s*>`, 'gi');
        const opens = (rawLine.match(openTagRe) ?? []).length;
        const closes = (rawLine.match(closeTagRe) ?? []).length;
        financeHtmlDepth += opens - closes;
        if (financeHtmlDepth <= 0) {
          financeHtmlTag = null;
          financeHtmlDepth = 0;
        }
      }
    }

    const line = options.isHtml ? stripHtmlTagsForAudit(rawLine) : rawLine;

    for (const m of line.matchAll(PHONE_RE)) {
      findings.push({ line: lineNo, type: 'phone', maskedToken: maskToken(m[0]) });
    }
    for (const m of line.matchAll(PERSONAL_EMAIL_RE)) {
      findings.push({ line: lineNo, type: 'email', maskedToken: maskToken(m[0]) });
    }
    for (const m of line.matchAll(GENERIC_FAMILY_EVENT_RE)) {
      findings.push({
        line: lineNo,
        type: 'family_event',
        maskedToken: maskToken(m[0]),
      });
    }

    // Track matched character ranges so shorter substrings (e.g., 2-char alias inside 3-char name) don't double-fire
    const matchedRanges: Array<[number, number]> = [];
    const overlaps = (start: number, end: number): boolean =>
      matchedRanges.some(([s, e]) => start < e && end > s);

    for (const token of candidateNames) {
      if (!line.includes(token)) continue;
      let searchFrom = 0;
      while (true) {
        const pos = line.indexOf(token, searchFrom);
        if (pos === -1) break;
        const end = pos + token.length;
        searchFrom = pos + 1;

        const prevChar = pos > 0 ? line[pos - 1]! : '';
        const nextChar = end < line.length ? line[end]! : '';
        if (/[가-힣]/.test(prevChar) || /[가-힣]/.test(nextChar)) {
          continue;
        }
        if (overlaps(pos, end)) continue;
        matchedRanges.push([pos, end]);

        const pids = peopleByName.get(token) ?? [];
        const aliasPid = aliasByToken.get(token);
        const resolvedIds =
          pids.length > 0 ? pids : aliasPid ? [aliasPid] : [];

        const isOfficial =
          resolvedIds.length > 0 &&
          resolvedIds.some((pid) =>
            options.allowHistoricalOfficials
              ? bundle.roles.some(
                  (r) => r.personId === pid && r.publicDisclosure === 'public_official',
                )
              : isPublicOfficialOn(bundle.roles, pid, docDate),
          );

        if (lineInFinanceZone) {
          findings.push({
            line: lineNo,
            type: 'finance_context_name',
            maskedToken: maskToken(token),
            section: 'finance',
          });
        } else if (!isOfficial) {
          findings.push({
            line: lineNo,
            type: 'masked_person',
            maskedToken: maskToken(token),
          });
        }
      }
    }
  }

  return findings;
}
