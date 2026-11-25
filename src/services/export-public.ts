import fs from 'node:fs/promises';
import path from 'node:path';
import { computePrivacyHashes, sanitizeLedgerRecords } from '../domain/privacy.js';
import {
  toPublicLedgerRecord,
  type OrgSummaryJson,
  type PublicDocumentLinksJson,
  type PublicLedgerJson,
  type PublicOfficialsJson,
} from '../domain/public-projection.js';
import { ensureLocalPrivacySalt } from '../storage/privacy-salt.js';
import type { UnionRepositories } from '../storage/repositories.js';

export { ensureLocalPrivacySalt };

export async function exportPublicProjection(options: {
  projectRoot: string;
  repos: UnionRepositories;
  outDir?: string;
}): Promise<{
  outDir: string;
  ledgerRecords: number;
  publicOfficials: number;
  documentLinks: number;
  privacyHashes: number;
}> {
  const { projectRoot, repos } = options;
  const outDir = path.resolve(
    options.outDir ?? path.join(projectRoot, 'data', 'public'),
  );
  await fs.mkdir(outDir, { recursive: true });

  const salt = await ensureLocalPrivacySalt(projectRoot);
  const [units, bundle, ledgerEntries, docLinks, syncMetaRow] = await Promise.all([
    repos.units.listAll(),
    repos.people.getDirectoryBundle(),
    repos.ledger.listEntries(),
    repos.links.listAll(),
    repos.syncMeta.get('ledger_sync'),
  ]);

  const syncMeta = syncMetaRow
    ? (JSON.parse(syncMetaRow.valueJson) as {
        syncedAt?: string;
        monthsRange?: [string, string];
      })
    : {};

  // 1. data/public/ledger_public.json
  const sanitizedEntries = sanitizeLedgerRecords(ledgerEntries, bundle);
  const yms = sanitizedEntries.map((r) => r.ym).filter(Boolean).sort();
  const monthsRange: [string, string] = syncMeta.monthsRange ?? [
    yms[0] ?? '',
    yms[yms.length - 1] ?? '',
  ];
  const ledgerPayload: PublicLedgerJson = {
    meta: {
      syncedAt: syncMeta.syncedAt ?? new Date().toISOString().slice(0, 19),
      totalRecords: sanitizedEntries.length,
      monthsRange,
      sanitized: true,
    },
    records: sanitizedEntries.map(toPublicLedgerRecord),
  };
  await fs.writeFile(
    path.join(outDir, 'ledger_public.json'),
    JSON.stringify(ledgerPayload, null, 2) + '\n',
    'utf8',
  );

  // 2. data/public/org_summary.json (strictly aggregated, non-PII)
  const activeMembers = bundle.members.filter((m) => m.status === 'active');
  const byUnit = units.map((u) => {
    const unitActive = activeMembers.filter((m) => m.unitCode === u.code);
    const byEmployment: Record<string, number> = {};
    const byShift: Record<string, number> = {};
    for (const m of unitActive) {
      const emp = m.employmentType || '미지정';
      const sh = m.shift || '미지정';
      byEmployment[emp] = (byEmployment[emp] ?? 0) + 1;
      byShift[sh] = (byShift[sh] ?? 0) + 1;
    }
    return {
      code: u.code,
      officialName: u.officialName,
      shortName: u.shortName,
      fullName: u.fullName,
      status: u.status,
      activeCount: unitActive.length,
      byEmployment,
      byShift,
    };
  });

  const monthlyFlowsMap = new Map<
    string,
    { ym: string; joins: number; rejoins: number; withdraws: number; transfers: number }
  >();
  for (const ev of bundle.membershipEvents) {
    if (!['join', 'rejoin', 'withdraw', 'transfer'].includes(ev.eventType)) continue;
    const ym = ev.eventDate.slice(0, 7);
    const cur = monthlyFlowsMap.get(ym) ?? {
      ym,
      joins: 0,
      rejoins: 0,
      withdraws: 0,
      transfers: 0,
    };
    if (ev.eventType === 'join') cur.joins += 1;
    else if (ev.eventType === 'rejoin') cur.rejoins += 1;
    else if (ev.eventType === 'withdraw') cur.withdraws += 1;
    else if (ev.eventType === 'transfer') cur.transfers += 1;
    monthlyFlowsMap.set(ym, cur);
  }

  const orgSummaryPayload: OrgSummaryJson = {
    generatedAt: new Date().toISOString().slice(0, 19),
    totalActive: activeMembers.length,
    totalHistorical: bundle.members.length,
    units: byUnit,
    monthlyFlows: [...monthlyFlowsMap.values()].sort((a, b) =>
      a.ym.localeCompare(b.ym),
    ),
  };
  await fs.writeFile(
    path.join(outDir, 'org_summary.json'),
    JSON.stringify(orgSummaryPayload, null, 2) + '\n',
    'utf8',
  );

  // 3. data/public/public_officials.json (only public_official roles, no phone/email/birthDate)
  const personById = new Map(bundle.people.map((p) => [p.personId, p]));
  const memberById = new Map(bundle.members.map((m) => [m.personId, m]));
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  const officialEntries = bundle.roles
    .filter((r) => r.publicDisclosure === 'public_official')
    .sort(
      (a, b) =>
        (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
        a.roleId.localeCompare(b.roleId),
    )
    .map((r) => {
      const p = personById.get(r.personId);
      const m = memberById.get(r.personId);
      const kind = p?.kind ?? 'member';
      const inferredScope =
        r.roleScope ?? (kind === 'external' ? 'external_rep' : 'executive');
      const unitObj = m ? unitByCode.get(m.unitCode) : undefined;
      return {
        roleId: r.roleId,
        personId: r.personId,
        kind,
        roleScope: inferredScope,
        termLabel: r.termLabel ?? '',
        sortOrder: r.sortOrder ?? 100,
        name: p?.name ?? '',
        org: r.org,
        title: r.title,
        memberUnitCode: m?.unitCode ?? null,
        memberUnitName: m ? (unitObj?.officialName ?? m.unitCode) : null,
        validFrom: r.validFrom,
        validTo: r.validTo,
        isPrimary: r.isPrimary,
      };
    });
  const officialsPayload: PublicOfficialsJson = { officials: officialEntries };
  await fs.writeFile(
    path.join(outDir, 'public_officials.json'),
    JSON.stringify(officialsPayload, null, 2) + '\n',
    'utf8',
  );

  // 4. data/public/document_ledger_links.json
  const docLinksPayload: PublicDocumentLinksJson = { links: docLinks };
  await fs.writeFile(
    path.join(outDir, 'document_ledger_links.json'),
    JSON.stringify(docLinksPayload, null, 2) + '\n',
    'utf8',
  );

  // 5. data/public/privacy_hashes.json (HMAC-SHA256 index only, zero plaintext PII)
  const hashIndex = computePrivacyHashes(bundle, salt);
  await fs.writeFile(
    path.join(outDir, 'privacy_hashes.json'),
    JSON.stringify(hashIndex, null, 2) + '\n',
    'utf8',
  );

  return {
    outDir,
    ledgerRecords: sanitizedEntries.length,
    publicOfficials: officialEntries.length,
    documentLinks: docLinks.length,
    privacyHashes: hashIndex.hashes.length,
  };
}
