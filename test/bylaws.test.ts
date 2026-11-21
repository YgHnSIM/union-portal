import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildBylawsFullHtml,
  buildBylawsGuideHtml,
  loadBylawsDocument,
} from '../src/site/bylaws.js';
import {
  buildBylawsLawHtml,
  loadBylawsLawDocument,
} from '../src/site/bylaws-law.js';
import {
  buildBylawsRevisionDiffHtml,
  buildBylawsRevisionFullHtml,
  loadBylawsRevisionDocument,
} from '../src/site/bylaws-revision.js';
import type { AssetManifest } from '../src/site/shell.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY_ASSETS: AssetManifest = { hashes: new Map() };

test('규약 정본(_source/union/bylaws.md)을 정확히 파싱하고 중복 조항·편집 주석·목 구조를 보존한다', () => {
  const doc = loadBylawsDocument(REPO_ROOT);
  assert.ok(doc, 'bylaws.md가 로드되어야 합니다.');

  assert.equal(doc.meta.enactedOn, '2020-02-20');
  assert.equal(doc.meta.amendedOn, '2025-12-05');
  assert.match(doc.preamble, /진정한 민주주의 사회의 노동자/);

  // 12장, 본문 59조(제37조 중복), 부칙 3조, 별첨 2건
  assert.equal(doc.chapters.length, 12);
  const bodyArticles = doc.allArticles.filter((a) => a.chapterNumber < 99);
  assert.equal(bodyArticles.length, 59);
  assert.equal(doc.addenda.articles.length, 3);
  assert.equal(doc.addenda.attachments.length, 2);

  // 제4장 4개 절 확인
  const ch4 = doc.chapters.find((c) => c.number === 4);
  assert.ok(ch4);
  assert.equal(ch4.leadArticles.length, 1); // 제13조
  assert.equal(ch4.sections.length, 4);

  // 제37조 중복 조항 고유 ID 분리 확인
  const art37Finance = doc.articleById.get('art-37');
  const art37Dispute = doc.articleById.get('art-37-2');
  assert.ok(art37Finance);
  assert.ok(art37Dispute);
  assert.equal(art37Finance.title, '결산');
  assert.equal(art37Dispute.title, '노동쟁의');
  assert.ok(art37Dispute.editorialNotes.some((n) => n.includes('중복 표기')));

  // 제19조② 원문 괄호 누락 보완 확인
  const art19 = doc.articleById.get('art-19');
  assert.ok(art19);
  const p2 = art19.paragraphs.find((p) => p.marker === '②');
  assert.ok(p2);
  assert.match(p2.text, /【잔여임기의 50% 이상이 남았을 때】로부터/);
  assert.ok(p2.editorialNote?.includes('괄호 누락 보완'));

  // 제31조①7 직무대행 4단계 목(가~라) 파싱 확인
  const art31 = doc.articleById.get('art-31');
  assert.ok(art31);
  const chairmanPara = art31.paragraphs.find((p) => p.marker === '①');
  assert.ok(chairmanPara);
  assert.equal(chairmanPara.leadBold, '위원장');
  const successionItem = chairmanPara.items.find((it) => it.num === '7.');
  assert.ok(successionItem);
  assert.equal(successionItem.subItems.length, 4);
  assert.equal(successionItem.subItems[0]!.text, '수석부위원장');
  assert.equal(successionItem.subItems[3]!.text, '운영위원회에서 선출');
});

test('규약 개괄 페이지의 모든 조항·장 앵커 링크가 규약 전문 HTML에 실제로 존재한다', () => {
  const doc = loadBylawsDocument(REPO_ROOT);
  assert.ok(doc);

  const guideHtml = buildBylawsGuideHtml(doc, EMPTY_ASSETS, 'https://example.test');
  const fullHtml = buildBylawsFullHtml(doc, EMPTY_ASSETS, 'https://example.test');

  // 전문 HTML에 원시 마크다운 강조/주석 잔재가 없어야 함
  assert.ok(!fullHtml.includes('**'), '전문 HTML에 ** 마크다운 잔재가 남아서는 안 됩니다.');
  assert.ok(!fullHtml.includes('*(※'), '전문 HTML에 *(※ 마크다운 잔재가 남아서는 안 됩니다.');

  // 개괄 페이지의 모든 bylaws.html#<id> 참조가 전문 HTML id 속성과 일치하는지 검증
  const fullIds = new Set<string>();
  for (const m of fullHtml.matchAll(/\sid="([^"]+)"/g)) {
    fullIds.add(m[1]!);
  }

  const refs = [...guideHtml.matchAll(/href="bylaws\.html#([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(refs.length >= 25, `개괄 페이지에 충분한 조항·장 상호 링크가 있어야 합니다 (${refs.length}개).`);
  for (const refId of refs) {
    assert.ok(
      fullIds.has(refId),
      `개괄 페이지가 참조하는 앵커 #${refId} 가 규약 전문 HTML에 존재하지 않습니다.`,
    );
  }
});

test('규약·노조법 비교 분석 정본(_source/union/bylaws-law.json)과 미등재 HTML 앵커 무결성을 검증한다', () => {
  const bylawsDoc = loadBylawsDocument(REPO_ROOT);
  const lawDoc = loadBylawsLawDocument(REPO_ROOT);
  assert.ok(bylawsDoc);
  assert.ok(lawDoc, 'bylaws-law.json 이 로드되어야 합니다.');

  assert.equal(lawDoc.amendment2026Highlights.length, 3);
  assert.equal(lawDoc.mandatoryItems.length, 15);
  assert.equal(lawDoc.comparisons.length, 14);
  assert.equal(lawDoc.tftChecklist.length, 7);
  assert.equal(lawDoc.chapterMapping.length, 13);

  const lawHtml = buildBylawsLawHtml(lawDoc, EMPTY_ASSETS, 'https://example.test');
  const fullHtml = buildBylawsFullHtml(bylawsDoc, EMPTY_ASSETS, 'https://example.test');

  assert.match(lawHtml, /<meta name="robots" content="noindex,follow">/);
  assert.ok(!lawHtml.includes('**'), '비교 페이지 HTML에 ** 마크다운 잔재가 남아서는 안 됩니다.');

  const fullIds = new Set<string>();
  for (const m of fullHtml.matchAll(/\sid="([^"]+)"/g)) {
    fullIds.add(m[1]!);
  }

  const refs = [...lawHtml.matchAll(/href="bylaws\.html#([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(refs.length >= 30, `비교 페이지에 충분한 규약 조항·장 참조 링크가 있어야 합니다 (${refs.length}개).`);
  for (const refId of refs) {
    assert.ok(
      fullIds.has(refId),
      `비교 페이지가 참조하는 앵커 #${refId} 가 규약 전문 HTML에 존재하지 않습니다.`,
    );
  }
});

test('규약 개정안 정본(_source/union/bylaws-revision.json)·교차검수 4대 보완·3종 미등재 스위트 앵커 무결성을 검증한다', () => {
  const bylawsDoc = loadBylawsDocument(REPO_ROOT);
  const lawDoc = loadBylawsLawDocument(REPO_ROOT);
  const revDoc = loadBylawsRevisionDocument(REPO_ROOT);
  assert.ok(bylawsDoc);
  assert.ok(lawDoc);
  assert.ok(revDoc, 'bylaws-revision.json 이 로드되어야 합니다.');

  assert.equal(revDoc.chapters.length, 12);
  const revBodyArts = revDoc.chapters.flatMap((ch) => [
    ...(ch.articles ?? []),
    ...(ch.sections?.flatMap((s) => s.articles) ?? []),
  ]);
  assert.equal(revBodyArts.length, 59);
  assert.equal(revDoc.addenda.articles.length, 3);
  assert.equal(revDoc.addenda.attachments.length, 3);

  // 교차 검수 4건 자구 검증
  const art21 = revBodyArts.find((a) => a.id === 'art-21');
  const art37 = revBodyArts.find((a) => a.id === 'art-37');
  const art53 = revBodyArts.find((a) => a.id === 'art-53');
  const art57 = revBodyArts.find((a) => a.id === 'art-57');
  assert.ok(art21 && art37 && art53 && art57);

  const art21Joined = art21.revisedLines.join(' ');
  assert.ok(!art21Joined.includes('또는 제2호'), '제21조②에 제1항제2호가 포함되어서는 안 됩니다.');
  assert.ok(art21Joined.includes('제1항제1호에 따른 소집 요구'));

  assert.ok(
    art37.revisedLines[0]!.includes(
      '이내에 전체 조합원에게 공표하고 차기 총회(또는 대의원대회)의 승인을 얻어야 하며',
    ),
    '제37조①은 공표 후 차기 총회 승인 구조여야 합니다.',
  );

  assert.ok(
    art53.revisedLines[0]!.includes('임원 및 운영위원에 대한 징계는 총회의 결의로 행한다.'),
    '제53조① 단서는 총회 결의로 유지되어야 합니다.',
  );
  assert.ok(!art53.revisedLines[0]!.includes('총회(또는 대의원대회)의 결의로 행한다'));

  assert.ok(
    art57.revisedLines[0]!.includes(
      '임원(위원장·수석부위원장·부위원장·회계감사대표위원·사무국장) 및 지부장 등 대표자가 규약을 위반하였을 때',
    ),
    '제57조①은 임원 및 지부장 등 대표자로 명확히 한정되어야 합니다.',
  );

  const fullCurrentHtml = buildBylawsFullHtml(bylawsDoc, EMPTY_ASSETS, 'https://example.test');
  const lawHtml = buildBylawsLawHtml(lawDoc, EMPTY_ASSETS, 'https://example.test');
  const revDiffHtml = buildBylawsRevisionDiffHtml(revDoc, EMPTY_ASSETS, 'https://example.test');
  const revFullHtml = buildBylawsRevisionFullHtml(revDoc, EMPTY_ASSETS, 'https://example.test');

  for (const [name, html] of [
    ['bylaws-revision-diff.html', revDiffHtml],
    ['bylaws-revision-full.html', revFullHtml],
  ] as const) {
    assert.match(html, /<meta name="robots" content="noindex,follow">/, `${name} robots 메타 확인`);
    assert.ok(!html.includes('**'), `${name} 에 ** 마크다운 잔재가 남아서는 안 됩니다.`);
    assert.ok(html.includes('unlisted-suite-nav'), `${name} 에 미등재 스위트 내비게이션이 있어야 합니다.`);
  }

  // 제9장 제38조(현행 제37조 중복) -> 현행 원문 #art-37-2 매핑 및 신규 별첨3 미링크 확인
  assert.ok(revDiffHtml.includes('href="bylaws.html#art-37-2"'));
  assert.ok(!revDiffHtml.includes('href="bylaws.html#attachment-3"'));
  assert.ok(!revFullHtml.includes('href="bylaws.html#attachment-3"'));

  // 4개 규약 페이지(#id) 전수 100% 상호 앵커 검증
  const collectIds = (html: string): Set<string> => {
    const ids = new Set<string>();
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]!);
    return ids;
  };
  const idsByPage: Record<string, Set<string>> = {
    'bylaws.html': collectIds(fullCurrentHtml),
    'bylaws-law.html': collectIds(lawHtml),
    'bylaws-revision-diff.html': collectIds(revDiffHtml),
    'bylaws-revision-full.html': collectIds(revFullHtml),
  };

  let totalCrossChecked = 0;
  for (const [sourceName, sourceHtml] of [
    ['bylaws-law.html', lawHtml],
    ['bylaws-revision-diff.html', revDiffHtml],
    ['bylaws-revision-full.html', revFullHtml],
  ] as const) {
    for (const m of sourceHtml.matchAll(
      /href="(bylaws\.html|bylaws-law\.html|bylaws-revision-diff\.html|bylaws-revision-full\.html)#([^"]+)"/g,
    )) {
      const targetPage = m[1]!;
      const targetAnchor = m[2]!;
      totalCrossChecked += 1;
      assert.ok(
        idsByPage[targetPage]?.has(targetAnchor),
        `${sourceName} 의 링크 ${targetPage}#${targetAnchor} 대상 ID가 존재하지 않습니다.`,
      );
    }
  }
  assert.ok(totalCrossChecked >= 150, `상호 앵커 링크 검증 수가 충분해야 합니다 (${totalCrossChecked}개).`);
});

test('다회차 심의 스키마·우선순위·초기시안 대비 회의수정안·누적 회의록 렌더링과 JSON 내장을 검증한다', () => {
  const revDoc = loadBylawsRevisionDocument(REPO_ROOT);
  assert.ok(revDoc);

  assert.ok(revDoc.meta.deliberationStatusLabels);
  assert.ok(revDoc.meta.targetWaveLabels);
  assert.equal(revDoc.meta.deliberationStatusLabels.confirmed_revision, '개정 잠정확정');
  assert.equal(revDoc.meta.targetWaveLabels['wave-1'], '1차 상정(차기 대의원대회)');

  const allItems = [
    revDoc.preamble,
    ...revDoc.chapters.flatMap((ch) => [
      ...(ch.articles ?? []),
      ...(ch.sections?.flatMap((s) => s.articles) ?? []),
    ]),
    ...revDoc.addenda.articles,
    ...revDoc.addenda.attachments,
  ];
  assert.equal(allItems.length, 66);

  const prioCounts = { P1: 0, P2: 0, P3: 0 };
  for (const item of allItems) {
    assert.ok(item.deliberation, `${item.id} 에 deliberation 필드가 있어야 합니다.`);
    assert.equal(item.deliberation.status, 'pending');
    assert.equal(item.deliberation.targetWave, 'unassigned');
    if (item.deliberation.tftPriority) {
      prioCounts[item.deliberation.tftPriority] += 1;
    }
  }
  assert.deepEqual(prioCounts, { P1: 4, P2: 10, P3: 6 });

  // 회의에서 제30조를 수정·잠정확정하고 회의록을 누적한 시나리오 검증
  const cloned = structuredClone(revDoc);
  const ch6 = cloned.chapters.find((c) => c.id === 'ch-6');
  assert.ok(ch6?.articles);
  const art30 = ch6.articles.find((a) => a.id === 'art-30');
  assert.ok(art30);
  art30.deliberation = {
    status: 'confirmed_revision',
    targetWave: 'wave-1',
    tftPriority: 'P1',
    workingLines: [
      '① 임원 및 지부장은 재단법인 우체국물류지원단에 종사하는 조합원 중에서 선출한다(운영위 수정합의).',
      '② 임원 전원 및 지부장의 임기는 3년으로 한다.',
    ],
    meetingLogs: [
      {
        meetingId: 'mtg-1',
        date: '2026-12-10',
        meetingTitle: '2026-12 정기 운영위원회',
        speakerRole: '운영위 합의',
        summary: '수석부위원장·부위원장·사무국장·회계감사 임기 누락 보완 확인',
        decision: '임기 3년 및 보선 잔여기간 조문 확정',
        archiveDocId: 'mom:202612',
      },
    ],
    updatedOn: '2026-12-10',
  };

  const diffHtml = buildBylawsRevisionDiffHtml(cloned, EMPTY_ASSETS, 'https://example.test');
  const fullHtml = buildBylawsRevisionFullHtml(cloned, EMPTY_ASSETS, 'https://example.test');

  for (const html of [diffHtml, fullHtml]) {
    assert.ok(html.includes('delib-studio'));
    assert.ok(html.includes('운영위 수정합의'));
    assert.ok(html.includes('회의 수정 잠정안'));
    assert.ok(html.includes('초기 검토 시안(기준안) 원문 대조'));
    assert.ok(html.includes('2026-12 정기 운영위원회'));
    assert.ok(html.includes('운영위 합의'));
    assert.ok(html.includes('임기 3년 및 보선 잔여기간 조문 확정'));
    assert.ok(html.includes('1차 상정(차기 대의원대회)'));
    assert.ok(html.includes('mom:202612'));

    const match = html.match(
      /<script type="application\/json" id="bylaws-revision-data">([\s\S]*?)<\/script>/,
    );
    assert.ok(match, '내장 JSON 스크립트 태그가 존재해야 합니다.');
    const parsed = JSON.parse(
      match[1]!
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&'),
    );
    assert.equal(parsed.chapters.length, 12);
  }
});
