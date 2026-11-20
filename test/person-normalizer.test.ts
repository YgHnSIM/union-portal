import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STRIP_TOKENS,
  normalizePersonMentions,
} from '../src/domain/person-normalizer.js';
import type { DirectoryBundle } from '../src/domain/types.js';

function makeTestBundle(): Partial<DirectoryBundle> {
  return {
    people: [
      {
        personId: 'M-9001',
        kind: 'member',
        name: '홍길동',
        phone: '010-0000-0000',
        email: '',
        status: 'active',
        note: '',
      },
      {
        personId: 'M-9002',
        kind: 'member',
        name: '김철수',
        phone: '',
        email: '',
        status: 'active',
        note: '',
      },
      {
        personId: 'E-9001',
        kind: 'external',
        name: '이영희',
        phone: '',
        email: '',
        status: 'active',
        note: '',
      },
    ],
    aliases: [
      {
        alias: '길동',
        personId: 'M-9001',
        matchMode: 'context_title',
        note: '약칭(직책 문맥)',
      },
      {
        alias: '이 단장',
        personId: 'E-9001',
        matchMode: 'exact',
        note: '직책 약칭',
      },
    ],
    stripTokens: DEFAULT_STRIP_TOKENS,
    idToName: {
      'M-9001': '홍길동',
      'M-9002': '김철수',
      'E-9001': '이영희',
    },
  };
}

test('exact 및 context_title 별칭을 정식 성명으로 통일하고 직책·존칭을 제거한다', () => {
  const bundle = makeTestBundle();
  assert.equal(normalizePersonMentions('길동 위원장님', null, bundle), '홍길동');
  assert.equal(normalizePersonMentions('이 단장 찬조', null, bundle), '이영희 찬조');
  // context_title 별칭은 직책/존칭 문맥이 없으면 일반 단어를 치환하지 않는다
  assert.equal(normalizePersonMentions('홍길동 길동네 식당', null, bundle), '홍길동 길동네 식당');
});

test('성명 앞뒤 수식어·직책·존칭을 제거하고 정식 성명만 남긴다', () => {
  const bundle = makeTestBundle();
  assert.equal(
    normalizePersonMentions('전 위원장 홍길동 님 찬조', null, bundle),
    '홍길동 찬조',
  );
  assert.equal(
    normalizePersonMentions('김철수-사무국장 출장비', null, bundle),
    '김철수 출장비',
  );
});

test('미등록 일반 한글 성명의 띄어쓰기 존칭과 경조사 존칭을 제거하되 NON_PERSON_WORDS는 보존한다', () => {
  const bundle = makeTestBundle();
  assert.equal(normalizePersonMentions('박민수 님 전달', null, bundle), '박민수 전달');
  assert.equal(normalizePersonMentions('박민수님 모친상 조의금', null, bundle), '박민수 모친상 조의금');
  assert.equal(normalizePersonMentions('부모님 감사 선물', null, bundle), '부모님 감사 선물');
  assert.equal(normalizePersonMentions('선생님 다과비', null, bundle), '선생님 다과비');
});
