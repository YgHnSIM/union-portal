import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { parseYamlFrontMatter } from '../domain/content-graph.js';
import { collectPersonNames, normalizePersonMentions } from '../domain/person-normalizer.js';
import type {
  Account,
  AliasMatchMode,
  DirectoryBundle,
  ExternalRecord,
  MemberDocType,
  MemberDocument,
  MemberRecord,
  MembershipEvent,
  PersonAlias,
  PersonRole,
  PersonStatus,
  PrivacyRule,
  PublicDisclosure,
  StripToken,
  Unit,
  WithdrawReasonCategory,
} from '../domain/types.js';
import type { BlobStorage } from '../storage/blob-storage.js';
import type { UnionRepositories } from '../storage/repositories.js';
import { syncLedgerFromFile } from './sync-ledger.js';

interface LegacyUnitsJson {
  units: Array<{
    code: string;
    name: string;
    officialName?: string;
    shortName?: string;
    fullName: string;
    status: 'active' | 'closed';
    openedOn: string | null;
    closedOn: string | null;
    ledgerSheet: string | null;
    rawDir: string | null;
    note?: string;
  }>;
}

interface LegacyCoaJson {
  accounts: Array<{
    category: string;
    gwan: string;
    hang: string;
    mok: string;
    description?: string;
  }>;
}

interface LegacyMembersJson {
  members: Array<Record<string, unknown>>;
  membership_events?: Array<Record<string, unknown>>;
  member_documents?: Array<Record<string, unknown>>;
}

interface LegacyExternalJson {
  external_people: Array<Record<string, unknown>>;
}

interface LegacyTitleRulesJson {
  strip_tokens?: {
    honorifics?: string[];
    modifiers?: string[];
    titles?: string[];
  };
  person_aliases?: Array<{
    alias: string;
    person_id: string;
    match_mode?: string;
    note?: string;
  }>;
  person_roles?: Array<{
    role_id: string;
    person_id: string;
    org?: string;
    title: string;
    valid_from?: string | null;
    valid_to?: string | null;
    is_primary?: boolean;
  }>;
}

interface LegacyPrivacyJson {
  forbiddenNames?: string[];
  targetMask?: Record<string, string>;
  exactNoteReplacements?: Record<string, string>;
}

const DEFAULT_OFFICIAL_UNIT_NAMES: Record<string, { official: string; short: string }> = {
  HQ: { official: '본조', short: '본부' },
  AY: { official: '안양지부', short: '안물' },
  BP: { official: '부평지부', short: '부평물' },
  SS: { official: '서서울지부', short: '서물' },
};

function classifyLegacyRoleDisclosure(org: string, title: string): PublicDisclosure {
  if (org.includes('개인찬조') || title.includes('개인 찬조')) {
    return 'masked';
  }
  if (org.includes('본사') || title === '팀장') {
    return 'masked';
  }
  const unionTitleRe = /(위원장|부위원장|수석부위원장|사무국장|지부장|부지부장|운영위원|감사|단장)/;
  if (unionTitleRe.test(title)) {
    return 'public_official';
  }
  return 'masked';
}

async function copyDirIfExists(srcDir: string, destDir: string): Promise<number> {
  let stat;
  try {
    stat = await fs.stat(srcDir);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return 0;

  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += await copyDirIfExists(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
      count += 1;
    }
  }
  return count;
}

function mapLegacyRouteToV3(rawRoute: string): string {
  const clean = rawRoute.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.startsWith('archive/')) return clean;
  if (clean.startsWith('MoM/')) return `archive/mom/${clean.slice(4)}`;
  return `archive/${clean}`;
}

export interface LegacyImportSummary {
  units: number;
  accounts: number;
  members: number;
  externals: number;
  events: number;
  memberDocuments: number;
  aliases: number;
  roles: number;
  ledgerEntries: number;
  ledgerPersonLinks: number;
  rawFilesCopied: number;
  documentsMigrated: number;
  momOriginalsBackedUp: number;
}

export async function importLegacyData(options: {
  projectRoot: string;
  accountingRoot: string;
  workplaceRoot: string;
  repos: UnionRepositories;
  blobs: BlobStorage;
}): Promise<LegacyImportSummary> {
  const { projectRoot, accountingRoot, workplaceRoot, repos, blobs } = options;

  // 1. Read Accounting configs (prefer portal's standardized units.json if present)
  const portalUnitsPath = path.join(projectRoot, 'config', 'units.json');
  const accUnitsPath = path.join(accountingRoot, 'config', 'units.json');
  const unitsJson = JSON.parse(
    await fs.readFile(
      await fs
        .stat(portalUnitsPath)
        .then(() => portalUnitsPath)
        .catch(() => accUnitsPath),
      'utf8',
    ),
  ) as LegacyUnitsJson;

  const unitRows: Unit[] = unitsJson.units.map((u) => {
    const defaults = DEFAULT_OFFICIAL_UNIT_NAMES[u.code];
    return {
      code: u.code,
      name: u.name,
      officialName: u.officialName ?? defaults?.official ?? u.name,
      shortName: u.shortName ?? defaults?.short ?? u.name,
      fullName: u.fullName,
      status: u.status,
      openedOn: u.openedOn,
      closedOn: u.closedOn,
      ledgerSheet: u.ledgerSheet,
      rawDir: u.rawDir,
      note: u.note ?? '',
    };
  });

  const coaJson = JSON.parse(
    await fs.readFile(path.join(accountingRoot, 'config', 'coa.json'), 'utf8'),
  ) as LegacyCoaJson;
  const accountRows: Account[] = coaJson.accounts.map((a) => ({
    category: a.category,
    gwan: a.gwan,
    hang: a.hang,
    mok: a.mok,
    description: a.description ?? '',
  }));

  const membersJson = JSON.parse(
    await fs.readFile(path.join(accountingRoot, 'config', 'members.json'), 'utf8'),
  ) as LegacyMembersJson;
  const externalJson = JSON.parse(
    await fs.readFile(path.join(accountingRoot, 'config', 'external_people.json'), 'utf8'),
  ) as LegacyExternalJson;
  const titleRulesJson = JSON.parse(
    await fs.readFile(path.join(accountingRoot, 'config', 'title_rules.json'), 'utf8'),
  ) as LegacyTitleRulesJson;
  const privacyJson = JSON.parse(
    await fs.readFile(path.join(accountingRoot, 'config', 'privacy.json'), 'utf8'),
  ) as LegacyPrivacyJson;

  let syncMetaRaw: { syncedAt?: string } = {};
  try {
    syncMetaRaw = JSON.parse(
      await fs.readFile(
        path.join(accountingRoot, 'data', 'latest', 'sync_meta.json'),
        'utf8',
      ),
    ) as { syncedAt?: string };
  } catch {
    syncMetaRaw = {};
  }

  // Copy raw evidence files into portal _raw/ (gitignored)
  let rawFilesCopied = 0;
  for (const unitDir of ['HQ', 'AY', 'BP', 'SS']) {
    rawFilesCopied += await copyDirIfExists(
      path.join(accountingRoot, '_raw', unitDir),
      path.join(projectRoot, '_raw', unitDir),
    );
  }

  // Copy member application blobs through BlobStorage
  const appSrcDir = path.join(accountingRoot, '_raw', 'applications');
  const appFiles = await fs.readdir(appSrcDir, { withFileTypes: true }).catch(() => []);
  for (const entry of appFiles) {
    if (!entry.isFile()) continue;
    const data = await fs.readFile(path.join(appSrcDir, entry.name));
    await blobs.put(`applications/${entry.name}`, data);
    rawFilesCopied += 1;
  }

  const memberRecords: MemberRecord[] = membersJson.members.map((m) => {
    const rawDoc = String(m.application_doc ?? '').replace(/\\/g, '/');
    const blobKey = rawDoc.startsWith('_raw/') ? rawDoc.slice(5) : rawDoc;
    return {
      personId: String(m.person_id),
      kind: 'member',
      name: String(m.name),
      phone: String(m.phone ?? ''),
      email: String(m.email ?? ''),
      status: String(m.status ?? 'active') as PersonStatus,
      note: String(m.note ?? ''),
      unitCode: String(m.unit_code ?? ''),
      birthDate: String(m.birth_date ?? ''),
      shift: String(m.shift ?? ''),
      employmentType: String(m.employment_type ?? ''),
      firstJoinedOn: String(m.first_joined_on ?? m.joined_on ?? ''),
      joinedOn: String(m.joined_on ?? ''),
      leftOn: String(m.left_on ?? ''),
      memberWish: String(m.member_wish ?? ''),
      applicationDocKey: blobKey,
    };
  });

  const externalRecords: ExternalRecord[] = externalJson.external_people.map((e) => ({
    personId: String(e.person_id),
    kind: 'external',
    name: String(e.name),
    phone: String(e.phone ?? ''),
    email: String(e.email ?? ''),
    status: String(e.status ?? 'active') as PersonStatus,
    note: String(e.note ?? ''),
    org: String(e.org ?? ''),
    category: String(e.category ?? ''),
  }));

  const eventRows: MembershipEvent[] = (membersJson.membership_events ?? []).map((ev) => ({
    eventId: String(ev.event_id),
    personId: String(ev.person_id),
    eventType: String(ev.event_type) as MembershipEvent['eventType'],
    eventDate: String(ev.event_date),
    fromUnit: String(ev.from_unit ?? '').trim() || null,
    toUnit: String(ev.to_unit ?? '').trim() || null,
    reasonCategory: String(ev.reason_category ?? '') as WithdrawReasonCategory,
    rejoinCategory: String(ev.rejoin_category ?? ''),
    reason: String(ev.reason ?? ''),
    docMdPath: String(ev.doc_md_path ?? ''),
    refundTxId: String(ev.refund_tx_id ?? '').trim() || null,
  }));

  const docRows: MemberDocument[] = (membersJson.member_documents ?? []).map((d) => {
    const rawPath = String(d.file_path ?? '').replace(/\\/g, '/');
    const blobKey = rawPath.startsWith('_raw/') ? rawPath.slice(5) : rawPath;
    return {
      docId: String(d.doc_id),
      eventId: String(d.event_id),
      personId: String(d.person_id),
      docType: String(d.doc_type) as MemberDocType,
      blobKey,
      note: String(d.note ?? ''),
      createdAt: String(d.created_at),
    };
  });

  const stripRows: StripToken[] = [
    ...(titleRulesJson.strip_tokens?.honorifics ?? []).map((t) => ({
      category: 'honorific' as const,
      token: t,
    })),
    ...(titleRulesJson.strip_tokens?.modifiers ?? []).map((t) => ({
      category: 'modifier' as const,
      token: t,
    })),
    ...(titleRulesJson.strip_tokens?.titles ?? []).map((t) => ({
      category: 'title' as const,
      token: t,
    })),
  ];

  const aliasRows: PersonAlias[] = (titleRulesJson.person_aliases ?? []).map((a) => ({
    alias: a.alias,
    personId: a.person_id,
    matchMode: (a.match_mode ?? 'exact') as AliasMatchMode,
    note: a.note ?? '',
  }));

  const roleRows: PersonRole[] = (titleRulesJson.person_roles ?? []).map((r) => ({
    roleId: r.role_id,
    personId: r.person_id,
    org: r.org ?? '',
    title: r.title,
    publicDisclosure: classifyLegacyRoleDisclosure(r.org ?? '', r.title),
    validFrom: r.valid_from ?? null,
    validTo: r.valid_to ?? null,
    isPrimary: r.is_primary ?? true,
  }));

  // Build privacy rules matching sync_privacy_with_directory semantics
  const tempBundle: Partial<DirectoryBundle> = {
    members: memberRecords,
    externals: externalRecords,
    aliases: aliasRows,
    stripTokens: {
      honorifics: stripRows.filter((t) => t.category === 'honorific').map((t) => t.token),
      modifiers: stripRows.filter((t) => t.category === 'modifier').map((t) => t.token),
      titles: stripRows.filter((t) => t.category === 'title').map((t) => t.token),
    },
    privacy: {
      forbiddenNames: privacyJson.forbiddenNames ?? [],
      targetMask: privacyJson.targetMask ?? {},
      exactNoteReplacements: privacyJson.exactNoteReplacements ?? {},
    },
    idToName: Object.fromEntries(
      [...memberRecords, ...externalRecords].map((p) => [p.personId, p.name]),
    ),
  };

  const forbiddenSet = new Set<string>(collectPersonNames(tempBundle));
  for (const a of aliasRows) {
    if (a.matchMode === 'exact' && a.alias.trim()) forbiddenSet.add(a.alias.trim());
  }

  const privacyRuleRows: PrivacyRule[] = [];
  for (const fn of forbiddenSet) {
    privacyRuleRows.push({
      ruleType: 'forbidden_name',
      matchKey: fn,
      replacement: '',
      note: 'imported',
    });
  }

  const allNames = [...forbiddenSet];
  for (const [k, v] of Object.entries(privacyJson.targetMask ?? {})) {
    const normK = normalizePersonMentions(k, allNames, tempBundle);
    privacyRuleRows.push({ ruleType: 'target_mask', matchKey: k, replacement: v, note: 'imported' });
    if (normK && normK !== k) {
      privacyRuleRows.push({
        ruleType: 'target_mask',
        matchKey: normK,
        replacement: v,
        note: 'normalized',
      });
    }
  }
  for (const [k, v] of Object.entries(privacyJson.exactNoteReplacements ?? {})) {
    const normK = normalizePersonMentions(k, allNames, tempBundle);
    privacyRuleRows.push({
      ruleType: 'note_replacement',
      matchKey: k,
      replacement: v,
      note: 'imported',
    });
    if (normK && normK !== k) {
      privacyRuleRows.push({
        ruleType: 'note_replacement',
        matchKey: normK,
        replacement: v,
        note: 'normalized',
      });
    }
  }

  // Persist organization, accounting master, and people tables inside transaction
  await repos.transaction(async (txRepos) => {
    await txRepos.units.upsertMany(unitRows);
    await txRepos.accounts.replaceAll(accountRows);
    for (const m of memberRecords) {
      await txRepos.people.upsertMember(m);
    }
    for (const e of externalRecords) {
      await txRepos.people.upsertExternal(e);
    }
    await txRepos.people.replaceEvents(eventRows);
    for (const doc of docRows) {
      await txRepos.people.addMemberDocument(doc);
    }
    for (const alias of aliasRows) {
      await txRepos.people.upsertAlias(alias);
    }
    for (const role of roleRows) {
      await txRepos.people.upsertRole(role);
    }
    await txRepos.privacy.replaceStripTokens(stripRows);
    await txRepos.privacy.upsertRules(privacyRuleRows);
  });

  // Sync ledger.json (must come after units, accounts, people; preserves any existing links)
  const ledgerJsonPath = path.join(accountingRoot, 'data', 'latest', 'ledger.json');
  const ledgerRes = await syncLedgerFromFile(
    repos,
    ledgerJsonPath,
    syncMetaRaw.syncedAt,
  );

  // Copy workplace _source documents & migrate catalog/MoM to v3
  const wpSourceDir = path.join(workplaceRoot, '_source');
  const portalSourceDir = path.join(projectRoot, '_source');
  await fs.mkdir(portalSourceDir, { recursive: true });

  await fs.copyFile(
    path.join(wpSourceDir, 'topics.json'),
    path.join(portalSourceDir, 'topics.json'),
  );
  await fs.copyFile(
    path.join(wpSourceDir, 'sources.json'),
    path.join(portalSourceDir, 'sources.json'),
  );

  // Migrate catalog.json v2 -> v3
  const catalogRaw = JSON.parse(
    await fs.readFile(path.join(wpSourceDir, 'catalog.json'), 'utf8'),
  ) as {
    schemaVersion: number;
    documents: Array<Record<string, unknown>>;
  };
  const migratedCatalog = {
    $schema: 'https://yghnsim.github.io/union-portal/schema/catalog.schema.json',
    schemaVersion: 3,
    documents: catalogRaw.documents.map((doc) => ({
      ...doc,
      route: mapLegacyRouteToV3(String(doc.route ?? '')),
    })),
  };
  await fs.writeFile(
    path.join(portalSourceDir, 'catalog.json'),
    JSON.stringify(migratedCatalog, null, 2) + '\n',
    'utf8',
  );

  let documentsMigrated = migratedCatalog.documents.length;

  for (const catDir of ['statement', 'newsletter', 'knowledge', 'notice']) {
    await copyDirIfExists(
      path.join(wpSourceDir, catDir),
      path.join(portalSourceDir, catDir),
    );
  }

  // Copy notice social images so socialImage validation resolves inside _source/
  for (const imgName of ['2025-performance-pay.jpg', '2025-performance-pay.webp']) {
    const srcImg = path.join(workplaceRoot, 'notice', imgName);
    try {
      await fs.copyFile(srcImg, path.join(portalSourceDir, 'notice', imgName));
    } catch {
      // ignore if missing
    }
  }

  // Backup MoM originals to _raw/mom_originals/ and migrate MoM/*.md -> _source/mom/*.md
  const wpMomDir = path.join(wpSourceDir, 'MoM');
  const rawMomBackupDir = path.join(projectRoot, '_raw', 'mom_originals');
  const portalMomDir = path.join(portalSourceDir, 'mom');
  await fs.mkdir(rawMomBackupDir, { recursive: true });
  await fs.mkdir(portalMomDir, { recursive: true });

  const momEntries = await fs.readdir(wpMomDir, { withFileTypes: true });
  let momOriginalsBackedUp = 0;
  for (const entry of momEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const srcPath = path.join(wpMomDir, entry.name);
    const rawText = await fs.readFile(srcPath, 'utf8');
    await fs.writeFile(path.join(rawMomBackupDir, entry.name), rawText, 'utf8');
    momOriginalsBackedUp += 1;

    const { metadata, body } = parseYamlFrontMatter(rawText, entry.name);
    const nextMeta = {
      ...metadata,
      route: mapLegacyRouteToV3(String(metadata.route ?? '')),
    };
    const yamlBlock = YAML.stringify(nextMeta).trimEnd();
    const cleanBody = body.replace(/^\r?\n/, '');
    const migratedMd = `---\n${yamlBlock}\n---\n\n${cleanBody}`;
    await fs.writeFile(path.join(portalMomDir, entry.name), migratedMd, 'utf8');
    documentsMigrated += 1;
  }

  return {
    units: unitRows.length,
    accounts: accountRows.length,
    members: memberRecords.length,
    externals: externalRecords.length,
    events: eventRows.length,
    memberDocuments: docRows.length,
    aliases: aliasRows.length,
    roles: roleRows.length,
    ledgerEntries: ledgerRes.totalRecords,
    ledgerPersonLinks: ledgerRes.linksCount,
    rawFilesCopied,
    documentsMigrated,
    momOriginalsBackedUp,
  };
}
