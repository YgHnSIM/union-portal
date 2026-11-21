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
