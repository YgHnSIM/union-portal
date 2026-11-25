import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemberDocument, Unit } from '../domain/types.js';
import type { UnionRepositories } from '../storage/repositories.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function mdCell(val: string | null | undefined): string {
  const s = String(val ?? '').trim();
  return s ? s.replace(/\|/g, '\\|') : '-';
}

function renderEvidenceMarkdown(
  evDocs: MemberDocument[],
  mdParent: string,
  rawDirAbs: string,
): string[] {
  if (evDocs.length === 0) {
    return ['*(첨부된 증빙 자료 없음 — 무증빙/구두 처리)*'];
  }
  const lines = [
    '| 문서 ID | 유형 | 파일명 | 비고 | 등록일 |',
    '| :--- | :---: | :--- | :--- | :---: |',
  ];
  const previews: string[] = [];
  for (const d of evDocs) {
    const fname = d.blobKey ? path.posix.basename(d.blobKey) : '-';
    lines.push(
      `| \`${d.docId}\` | \`${d.docType}\` | ${mdCell(fname)} | ${mdCell(d.note)} | ${d.createdAt || '-'} |`,
    );
    const ext = d.blobKey ? path.extname(d.blobKey).toLowerCase() : '';
    if (d.blobKey && IMAGE_EXTS.has(ext)) {
      const absImg = path.join(rawDirAbs, ...d.blobKey.split('/'));
      const rel = path.relative(mdParent, absImg).replace(/\\/g, '/');
      previews.push(
        '',
        `### ${d.docType} 원본 (\`${d.docId}\`)`,
        `![${d.docType} 원본](${rel})`,
      );
    }
  }
  return [...lines, ...previews];
}

export async function exportDirectoryMarkdown(options: {
  projectRoot: string;
  repos: UnionRepositories;
  outDir?: string;
}): Promise<{ directoryFiles: string[]; applicationCards: string[] }> {
  const { projectRoot, repos } = options;
  const outDir = path.resolve(options.outDir ?? path.join(projectRoot, 'directory'));
  const rawDirAbs = path.join(projectRoot, '_raw');
  const appDir = path.join(rawDirAbs, 'applications');
  const absProjectRoot = path.resolve(projectRoot);
  const UNIT_DISPLAY_ORDER = new Map<string, number>([
    ['AY', 0],
    ['BP', 1],
    ['HQ', 2],
    ['SS', 3],
  ]);

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });

  const [units, bundle] = await Promise.all([
    repos.units.listAll(),
    repos.people.getDirectoryBundle(),
  ]);

  const unitMap = new Map<string, Unit>(units.map((u) => [u.code, u]));
  const memberMap = new Map(bundle.members.map((m) => [m.personId, m]));
  const docsByEvent = new Map<string, MemberDocument[]>();
  for (const doc of bundle.memberDocuments) {
    const arr = docsByEvent.get(doc.eventId) ?? [];
    arr.push(doc);
    docsByEvent.set(doc.eventId, arr);
  }

  const applicationCards: string[] = [];
  for (const ev of bundle.membershipEvents) {
    if (!['join', 'rejoin', 'withdraw'].includes(ev.eventType) || !ev.docMdPath) {
      continue;
    }
    const m = memberMap.get(ev.personId);
    if (!m) continue;
    const evDocs = docsByEvent.get(ev.eventId) ?? [];
    const normDocPath = ev.docMdPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const outPath = path.resolve(absProjectRoot, ...normDocPath.split('/'));
    const relFromAppDir = path.relative(appDir, outPath);
    if (
      !relFromAppDir ||
      relFromAppDir.startsWith('..') ||
      path.isAbsolute(relFromAppDir)
    ) {
      throw new Error(`허용되지 않은 서류 카드 출력 경로입니다: ${ev.docMdPath}`);
    }
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    let lines: string[];
    if (ev.eventType === 'join' || ev.eventType === 'rejoin') {
      const uc = ev.toUnit || m.unitCode;
      const uFull = unitMap.get(uc)?.fullName ?? uc;
      const kindTitle = ev.eventType === 'rejoin' ? '조합 재가입서' : '조합 가입서';
      lines = [
        `# ${kindTitle} — ${m.name} (\`${ev.personId}\`)`,
        '',
        '| 항목 | 내용 | 항목 | 내용 |',
        '| :--- | :--- | :--- | :--- |',
        `| **소속 지부** | ${uFull} (\`${uc}\`) | **생년월일** | \`${mdCell(m.birthDate)}\` |`,
        `| **고용 / 근무** | ${mdCell(m.employmentType)} / ${mdCell(m.shift)} | **제출일자** | \`${ev.eventDate}\` |`,
        `| **휴대전화** | ${mdCell(m.phone)} | **이메일** | ${mdCell(m.email)} |`,
        `| **접수 이벤트** | \`${ev.eventId}\` (\`${ev.eventType}\`) | **최초 가입일** | \`${mdCell(m.firstJoinedOn || m.joinedOn)}\` |`,
        '',
        '## 노동조합에 바라는 점 (기재 원문)',
        m.memberWish ? `> ${m.memberWish}` : '*(기재 없음)*',
        '',
        '## 첨부 증빙 목록',
        ...renderEvidenceMarkdown(evDocs, path.dirname(outPath), rawDirAbs),
        '',
      ];
    } else {
      const uc = ev.fromUnit || m.unitCode;
      const uFull = unitMap.get(uc)?.fullName ?? uc;
      const refund = ev.refundTxId ? `\`${ev.refundTxId}\`` : '-';
      lines = [
        `# 조합 탈퇴 기록서 — ${m.name} (\`${ev.personId}\`)`,
        '',
        '| 항목 | 내용 | 항목 | 내용 |',
        '| :--- | :--- | :--- | :--- |',
        `| **소속 지부** | ${uFull} (\`${uc}\`) | **생년월일** | \`${mdCell(m.birthDate)}\` |`,
        `| **고용 / 근무** | ${mdCell(m.employmentType)} / ${mdCell(m.shift)} | **탈퇴일자** | \`${ev.eventDate}\` |`,
        `| **탈퇴 사유 분류** | **${ev.reasonCategory || '기타'}** | **이벤트 ID** | \`${ev.eventId}\` |`,
        `| **조합비 환급 거래** | ${refund} | **최초 가입일** | \`${mdCell(m.firstJoinedOn || m.joinedOn)}\` |`,
        '',
        '## 세부 탈퇴 사유',
        `> ${ev.reason || '-'}`,
        '',
        '## 첨부 증빙 목록',
        ...renderEvidenceMarkdown(evDocs, path.dirname(outPath), rawDirAbs),
        '',
      ];
    }

    await fs.writeFile(outPath, lines.join('\n'), 'utf8');
    applicationCards.push(outPath);
  }

  const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const activeMembers = bundle.members.filter((m) => m.status === 'active');
  const formerMembers = bundle.members.filter((m) => m.status !== 'active');
  const withdrawEvents = bundle.membershipEvents.filter(
    (ev) => ev.eventType === 'withdraw',
  );

  const countBy = <T>(items: T[], fn: (item: T) => string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = fn(item);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };

  const byUnitActive = countBy(activeMembers, (m) => m.unitCode);
  const byShiftActive = countBy(activeMembers, (m) => m.shift || '미지정');
  const byEmpActive = countBy(activeMembers, (m) => m.employmentType || '미지정');
  const byWdCat = countBy(withdrawEvents, (ev) => ev.reasonCategory || '기타');

  const latestJoinMd = new Map<string, string>();
  for (const ev of bundle.membershipEvents) {
    if ((ev.eventType === 'join' || ev.eventType === 'rejoin') && ev.docMdPath) {
      latestJoinMd.set(ev.personId, ev.docMdPath);
    }
  }

  const orderedUnits = [...units].sort(
    (a, b) =>
      (UNIT_DISPLAY_ORDER.get(a.code) ?? 99) - (UNIT_DISPLAY_ORDER.get(b.code) ?? 99) ||
      a.code.localeCompare(b.code),
  );

  const unitRows = orderedUnits.map((u) => {
    const cnt = byUnitActive.get(u.code) ?? 0;
    const tot = bundle.members.filter((m) => m.unitCode === u.code).length;
    return `| \`${u.code}\` | ${u.officialName} (${u.shortName}) | ${u.fullName} | **${cnt}명** | ${tot}명 |`;
  });

  const shiftSummary = [...byShiftActive.entries()]
    .map(([k, v]) => `${k} ${v}명`)
    .join(' · ');
  const empSummary = [...byEmpActive.entries()]
    .map(([k, v]) => `${k} ${v}명`)
    .join(' · ');

  const readmePath = path.join(outDir, 'README.md');
  await fs.writeFile(
    readmePath,
    [
      '# 인명·직책 관리 사전 안내 (로컬 전용 · Git 제외)',
      '',
      `> 마지막 동기화: \`${nowStr}\` · 정본: \`data/local/union.db\``,
      '> 이 폴더(`directory/`)와 `_raw/`는 `.gitignore`에 등록되어 GitHub에 올라가지 않습니다.',
      '',
      '## 문서 목록',
      '',
      '| 문서 | 내용 | 건수 |',
      '| :--- | :--- | :---: |',
      `| [members.md](members.md) | 지부별 현직 조합원 명부 · 과거/이력 조합원 · 탈퇴 사유 집계 · 변동 로그 | ${bundle.members.length}명 |`,
      `| [officers.md](officers.md) | 현 임기 조합 임원 · 순번제 간사(비공개) · 역대 이력 · 외부 타노조 분리 명부 | ${bundle.roles.length}건 |`,
      `| [external_people.md](external_people.md) | 본사·연대노조·상급단체 등 외부인 인명사전 | ${bundle.externals.length}명 |`,
      `| [title_rules.md](title_rules.md) | 정식 성명 통일 정책 · 제외 목록 · 별칭 매핑 · 직책·공개등급 표 | 별칭 ${bundle.aliases.length} · 직책 ${bundle.roles.length} |`,
      `| \`_raw/applications/*.md\` | 개별 가입서·탈퇴 기록서 마크다운 카드 & 원본 이미지 링크 | 서류 ${applicationCards.length} · 증빙 ${bundle.memberDocuments.length} |`,
      '',
      '## 현직 조합원 요약',
      '',
      '| 코드 | 조직단위 | 정식 명칭 | 현직 인원 | 누적(과거 포함) |',
      '| :--- | :--- | :--- | :---: | :---: |',
      ...unitRows,
      '',
      `- **근무 구분 (현직 ${activeMembers.length}명)**: ${shiftSummary}`,
      `- **고용 구분 (현직 ${activeMembers.length}명)**: ${empSummary}`,
      '',
    ].join('\n'),
    'utf8',
  );

  const memLines = [
    '# 조합원 관리 명부',
    '',
    `> 기준: \`${nowStr}\` · 현직 \`${activeMembers.length}명\` · 과거/비현역 \`${formerMembers.length}명\` · 전체 \`${bundle.members.length}명\` · 증빙 \`${bundle.memberDocuments.length}건\``,
    '',
  ];
  for (const u of orderedUnits.filter((unit) => unit.status === 'active')) {
    const sub = activeMembers.filter((m) => m.unitCode === u.code);
    if (sub.length === 0) continue;
    const heading = `${u.officialName} (\`${u.code}\`)`;
    const subShift = countBy(sub, (m) => m.shift || '미지정');
    const subEmp = countBy(sub, (m) => m.employmentType || '미지정');
    memLines.push(
      `## ${heading} — ${sub.length}명`,
      '',
      `- **근무**: ${[...subShift.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      `- **고용**: ${[...subEmp.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      '',
      '| ID | 성명 | 생년월일 | 연락처 | 이메일 | 근무 | 고용 | 가입일 | 가입서 | 비고 |',
      '| :--- | :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |',
    );
    for (const m of sub) {
      const jMd = latestJoinMd.get(m.personId);
      const docCell = jMd
        ? `[열람](../${jMd})`
        : m.applicationDocKey
          ? '보관'
          : '-';
      memLines.push(
        `| \`${m.personId}\` | **${m.name}** | ${mdCell(m.birthDate)} | ${mdCell(m.phone)} | ${mdCell(m.email)} | ${mdCell(m.shift)} | ${mdCell(m.employmentType)} | ${mdCell(m.joinedOn)} | ${docCell} | ${mdCell(m.note)} |`,
      );
    }
    memLines.push('');
  }

  if (withdrawEvents.length > 0) {
    const wdSummary = (['정년퇴직', '계약만료·퇴직', '기타'] as const)
      .map((c) => `${c} ${byWdCat.get(c) ?? 0}건`)
      .join(' · ');
    memLines.push(
      `## 탈퇴 현황 및 사유 집계 (${withdrawEvents.length}건)`,
      '',
      `- **사유 분류**: ${wdSummary}`,
      '',
      '| 이벤트 ID | 탈퇴일 | 대상 | 소속 | 사유 분류 | 세부 사유 | 환급 거래 | 기록서 |',
      '| :--- | :---: | :--- | :---: | :---: | :--- | :---: | :--- |',
    );
    for (const ev of [...withdrawEvents].reverse()) {
      const pname = bundle.idToName[ev.personId] ?? '';
      const wLink = ev.docMdPath ? `[열람](../${ev.docMdPath})` : '-';
      memLines.push(
        `| \`${ev.eventId}\` | ${ev.eventDate} | \`${ev.personId}\` ${pname} | \`${ev.fromUnit ?? '-'}\` | \`${ev.reasonCategory || '기타'}\` | ${mdCell(ev.reason)} | ${mdCell(ev.refundTxId)} | ${wLink} |`,
      );
    }
    memLines.push('');
  }

  if (formerMembers.length > 0) {
    memLines.push(
      `## 과거·비현역 조합원 (${formerMembers.length}명)`,
      '',
      '| ID | 성명 | 소속 | 상태 | 최초가입일 | 탈퇴/종료일 | 비고 |',
      '| :--- | :--- | :---: | :---: | :---: | :---: | :--- |',
    );
    for (const m of formerMembers) {
      const uname = unitMap.get(m.unitCode)?.shortName ?? m.unitCode;
      memLines.push(
        `| \`${m.personId}\` | **${m.name}** | ${uname} (\`${m.unitCode}\`) | ${m.status} | ${mdCell(m.firstJoinedOn || m.joinedOn)} | ${mdCell(m.leftOn)} | ${mdCell(m.note)} |`,
      );
    }
    memLines.push('');
  }

  memLines.push(
    `## 변동 이력 로그 (최근 ${Math.min(bundle.membershipEvents.length, 50)}건)`,
    '',
    '| 이벤트 ID | 일자 | 대상 | 구분 | 이동 | 사유 분류 | 사유/비고 |',
    '| :--- | :---: | :--- | :--- | :---: | :---: | :--- |',
  );
  for (const ev of [...bundle.membershipEvents].slice(-50).reverse()) {
    const pname = bundle.idToName[ev.personId] ?? '';
    const move = `${ev.fromUnit ?? '-'} → ${ev.toUnit ?? '-'}`;
    const cat = ev.reasonCategory || ev.rejoinCategory || '-';
    memLines.push(
      `| \`${ev.eventId}\` | ${ev.eventDate} | \`${ev.personId}\` ${pname} | \`${ev.eventType}\` | ${move} | ${cat} | ${mdCell(ev.reason)} |`,
    );
  }
  memLines.push('');
  const membersPath = path.join(outDir, 'members.md');
  await fs.writeFile(membersPath, memLines.join('\n'), 'utf8');

  const extLines = [
    '# 외부인 인명사전',
    '',
    `> 기준: \`${nowStr}\` · 비조합원 \`${bundle.externals.length}명\` (회계 원장은 정식 성명만 표기)`,
    '',
    '| ID | 성명 | 소속/기관 | 구분 | 연락처 | 상태 | 비고 |',
    '| :--- | :--- | :--- | :---: | :--- | :---: | :--- |',
  ];
  for (const e of bundle.externals) {
    extLines.push(
      `| \`${e.personId}\` | **${e.name}** | ${mdCell(e.org)} | ${mdCell(e.category)} | ${mdCell(e.phone)} | ${e.status} | ${mdCell(e.note)} |`,
    );
  }
  extLines.push('');
  const extPath = path.join(outDir, 'external_people.md');
  await fs.writeFile(extPath, extLines.join('\n'), 'utf8');

  const ruleLines = [
    '# 직책 · 별칭 · 공개등급 · 제외 목록 관리 사전',
    '',
    `> 기준: \`${nowStr}\``,
    '',
    '## 1. 제외 목록 (이름 앞·뒤 결합 시 자동 제거)',
    '',
    `- **존칭**: ${bundle.stripTokens.honorifics.map((t) => `\`${t}\``).join(', ')}`,
    `- **수식어**: ${bundle.stripTokens.modifiers.map((t) => `\`${t}\``).join(', ')}`,
    `- **직책·호칭**: ${bundle.stripTokens.titles.map((t) => `\`${t}\``).join(', ')}`,
    '',
    `## 2. 별칭 → 정식 성명 매핑 (${bundle.aliases.length}건)`,
    '',
    '| 별칭/약칭 표기 | 정식 성명 (`person_id`) | 매칭 방식 | 비고 |',
    '| :--- | :--- | :---: | :--- |',
  ];
  for (const a of bundle.aliases) {
    const formal = bundle.idToName[a.personId] ?? '';
    ruleLines.push(
      `| \`${a.alias}\` | **${formal}** (\`${a.personId}\`) | \`${a.matchMode}\` | ${mdCell(a.note)} |`,
    );
  }
  ruleLines.push(
    '',
    `## 3. 인물별 직책 및 공적 노출 등급 (${bundle.roles.length}건)`,
    '',
    '| 규칙 ID | 구분 | 기수 | 성명 (`person_id`) | 소속/기관 | 직책 | 공적 노출 등급 | 시작 | 종료 | 종료사유 |',
    '| :--- | :---: | :---: | :--- | :--- | :--- | :---: | :---: | :---: | :--- |',
  );
  for (const r of bundle.roles) {
    const formal = bundle.idToName[r.personId] ?? '';
    ruleLines.push(
      `| \`${r.roleId}\` | \`${r.roleScope ?? 'other'}\` | ${mdCell(r.termLabel)} | **${formal}** (\`${r.personId}\`) | ${mdCell(r.org)} | ${r.title} | \`${r.publicDisclosure}\` | ${mdCell(r.validFrom)} | ${mdCell(r.validTo)} | ${mdCell(r.endReason)} |`,
    );
  }
  ruleLines.push('');
  const rulesPath = path.join(outDir, 'title_rules.md');
  await fs.writeFile(rulesPath, ruleLines.join('\n'), 'utf8');

  // 4. directory/officers.md (local-only separated officer registry)
  const personById = new Map(bundle.people.map((p) => [p.personId, p]));
  const scopeLabel: Record<string, string> = {
    executive: '집행부',
    branch_head: '지부장',
    auditor: '감사',
    committee: '특별기구',
    staff_rotating: '순번제간사',
    external_rep: '외부대표',
    other: '기타',
  };
  const memberRoles = bundle.roles.filter((r) => {
    const p = personById.get(r.personId);
    return p?.kind === 'member' && r.roleScope !== 'external_rep';
  });
  const activeOfficers = memberRoles.filter(
    (r) =>
      !r.validTo &&
      !r.endedOn &&
      r.roleScope !== 'staff_rotating' &&
      r.roleScope !== 'other',
  );
  const rotatingStaff = memberRoles.filter(
    (r) => r.roleScope === 'staff_rotating' && !r.validTo && !r.endedOn,
  );
  const historicalMemberRoles = memberRoles.filter((r) => Boolean(r.validTo || r.endedOn));
  const externalRoles = bundle.roles.filter((r) => {
    const p = personById.get(r.personId);
    return p?.kind === 'external' || r.roleScope === 'external_rep';
  });

  const officersLines = [
    '# 노동조합 임원·직책 관리 대장 (로컬 전용 · Git 제외)',
    '',
    `> 기준: \`${nowStr}\` · 현 임기 임원 \`${activeOfficers.length}명\` · 순번제 간사(비공개) \`${rotatingStaff.length}명\` · 역대/보직변경 이력 \`${historicalMemberRoles.length}건\` · 타노조/외부 대표 \`${externalRoles.length}명\``,
    '',
    '## 1. 현 임기 조합 임원 (집행부 · 지부장 · 감사 · 특별기구)',
    '',
    '| 규칙 ID | 서열 | 기수 | 구분 | 직책 | 성명 (`person_id`) | 소속 지부 | 시작 | 임명근거 | 비고 |',
    '| :--- | :---: | :---: | :---: | :--- | :--- | :---: | :---: | :--- | :--- |',
    ...activeOfficers.map((r) => {
      const m = memberMap.get(r.personId);
      const uName = m ? unitMap.get(m.unitCode)?.officialName ?? m.unitCode : '-';
      const formal = bundle.idToName[r.personId] ?? '';
      return `| \`${r.roleId}\` | ${r.sortOrder ?? 100} | ${mdCell(r.termLabel)} | ${scopeLabel[r.roleScope ?? 'other'] ?? '기타'} | **${r.title}** | **${formal}** (\`${r.personId}\`) | ${uName} | ${mdCell(r.validFrom)} | ${mdCell(r.evidenceDocId)} | ${mdCell(r.note)} |`;
    }),
    '',
    '## 2. 순번제 · 비공개 관리 직책 (소통간사 등 — 공개 웹 노출 금지)',
    '',
    '| 규칙 ID | 기수 | 직책 | 성명 (`person_id`) | 소속 지부 | 시작 | 공개등급 | 비고 |',
    '| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :--- |',
    ...rotatingStaff.map((r) => {
      const m = memberMap.get(r.personId);
      const uName = m ? unitMap.get(m.unitCode)?.officialName ?? m.unitCode : '-';
      const formal = bundle.idToName[r.personId] ?? '';
      return `| \`${r.roleId}\` | ${mdCell(r.termLabel)} | ${r.title} | ${formal} (\`${r.personId}\`) | ${uName} | ${mdCell(r.validFrom)} | \`${r.publicDisclosure}\` | ${mdCell(r.note)} |`;
    }),
    '',
    '## 3. 역대 임원 및 보직 변경 · 임기 종료 이력',
    '',
    '| 규칙 ID | 기수 | 구분 | 직책 | 성명 (`person_id`) | 소속/기관 | 기간 | 종료사유 | 근거 |',
    '| :--- | :---: | :---: | :--- | :--- | :--- | :---: | :--- | :--- |',
    ...historicalMemberRoles.map((r) => {
      const formal = bundle.idToName[r.personId] ?? '';
      return `| \`${r.roleId}\` | ${mdCell(r.termLabel)} | ${scopeLabel[r.roleScope ?? 'other'] ?? '기타'} | ${r.title} | ${formal} (\`${r.personId}\`) | ${mdCell(r.org)} | ${mdCell(r.validFrom)}..${mdCell(r.validTo)} | ${mdCell(r.endReason)} | ${mdCell(r.evidenceDocId)} |`;
    }),
    '',
    '## 4. 타노조 · 외부 유관기관 대표 (조합 현황 비포함 · 회의록 검증용 별도 보관)',
    '',
    '| 규칙 ID | 성명 (`person_id`) | 소속 노조/기관 | 직책 | 공개등급 (회의록용) | 비고 |',
    '| :--- | :--- | :--- | :--- | :---: | :--- |',
    ...externalRoles.map((r) => {
      const formal = bundle.idToName[r.personId] ?? '';
      return `| \`${r.roleId}\` | ${formal} (\`${r.personId}\`) | ${mdCell(r.org)} | ${r.title} | \`${r.publicDisclosure}\` | ${mdCell(r.note)} |`;
    }),
    '',
  ];
  const officersPath = path.join(outDir, 'officers.md');
  await fs.writeFile(officersPath, officersLines.join('\n'), 'utf8');

  return {
    directoryFiles: [readmePath, membersPath, officersPath, extPath, rulesPath],
    applicationCards,
  };
}
