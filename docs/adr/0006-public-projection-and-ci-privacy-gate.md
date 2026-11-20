---
status: accepted
---

# 비식별 공개 투영 JSON 커밋 및 CI 비밀 솔트 해시 검증 게이트

로컬 정본 DB(`union.db`)는 개인정보 보호를 위해 `.gitignore`로 격리되므로, GitHub Actions CI가 정적 사이트를 재현 빌드하고 실명 유출을 차단하려면 로컬에서 추출한 비식별 공개 투영 JSON(`data/public/`)과 원본 문서(`_source/`)만 Git에 커밋하고 `_site/` 생성 HTML은 추적하지 않는다. 로컬 `pre-push` 훅에서는 정본 DB 전체로 100% 실명·별칭·연락처를 검증하며, CI에서는 원문 실명을 저장소에 1바이트도 남기지 않은 채 GitHub Secret의 솔트와 단방향 HMAC-SHA256 해시 인덱스로 실명 유출을 이중 차단한다.

## Considered Options

- **생성된 HTML까지 Git 커밋 (`workplace` 기존 방식)**: 저장소에서 결과 HTML을 바로 볼 수 있으나, 공통 레이아웃·해시 변경마다 수십 개 생성 파일이 커밋되어 PR diff가 오염되고 병합 충돌이 잦다.
- **CI에서 실명 검증 생략(로컬 검증·`pre-push` 훅만 의존)**: GitHub에 해시 파생물조차 올리지 않지만, 로컬 훅을 우회하거나 GitHub 웹에서 문서를 수정할 때 실명 유출을 배포 전에 막지 못한다.

## Consequences

- 조합원 명부나 별칭이 변경되면 로컬에서 공개 투영 및 해시 인덱스를 재생성해 함께 커밋해야 한다.
- `PRIVACY_HMAC_SALT`는 로컬 `.env`(Git 제외)와 GitHub Actions Repository Secret에 동일하게 보관해야 하며, 솔트 없이 해시 파일만으로는 실명을 역산할 수 없다.
- CI는 매 푸시·PR마다 `_source/`와 `data/public/`만으로 `_site/`를 결정적으로 재빌드하고 회계 산술·HTML·링크·해시 기반 개인정보 검사를 통과해야만 GitHub Pages에 배포한다.
