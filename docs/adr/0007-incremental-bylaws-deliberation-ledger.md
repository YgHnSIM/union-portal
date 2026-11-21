---
status: accepted
---

# 다회차 규약 개정 심의를 위한 Git 정본 JSON 및 브라우저 로컬 편집·내보내기 경계

조합 규약 개정(전문·본문 59조·부칙 3조·별첨 3건 등 66건)을 한 번의 회의에서 일괄 의결하기 어렵기 때문에, 향후 규약개정 특별위원회(TF)와 정기 운영위원회 회의마다 소수 조문씩 의제로 상정·심의·수정한 결과를 누적해 최종 TF·운영위 의결 및 대의원대회(또는 총회) 승인 절차까지 이어가야 한다. 비로그인 정적 포털([ADR-0001](./0001-static-local-first-cloud-ready.md))과 Zero-PII 검증([ADR-0006](./0006-public-projection-and-ci-privacy-gate.md)) 경계를 지키기 위해, 별도 백엔드 API나 로컬 전용 DB에 가두지 않고 Git 추적 정본 JSON(`_source/union/bylaws-revision.json`)에 조문별 5단계 심의 상태(`deliberation.status`), `상정 차수`(`targetWave`), 기준 `초기 검토 시안` 대비 `회의 반영 잠정안`(`workingLines`), 직책·기구 기반 누적 회의 이력(`meetingLogs`)을 통합 관리하고, 미등재(`noindex,follow`) 검토 페이지에서 브라우저 `localStorage` 기반 회의 중 기록 및 정본 JSON/회의자료(`.md`) 내보내기를 제공한다.

## Considered Options

- **백엔드 API·DB 서버 신설(실시간 협업 편집)**: 브라우저에서 곧바로 원격 저장할 수 있으나, 상시 서버 유지·인증·권한·개인정보 관리 부담이 생겨 비로그인 정적 포털 원칙(ADR-0001)에 위배된다.
- **로컬 전용 SQLite/Markdown 메모 보관**: 내부 보관은 가능하나, 운영위원·지부장이 미등재 검토 URL을 통해 누적 회의 경과와 차기 의제를 함께 열람할 수 없다.

## Consequences

- 모든 회의 발언·결정 주체는 실명이 아닌 직책·기구명(`위원장`, `지부장`, `운영위 합의`, `규약개정 TF` 등)으로만 기록하며, `validate-site`의 Zero-PII 게이트가 정적 HTML 내 인명 노출을 자동 차단한다.
- 회의 중 브라우저 `localStorage`에 누적한 심의 변경분은 `정본 JSON 다운로드` 또는 복사를 통해 `_source/union/bylaws-revision.json`에 반영·커밋·푸시함으로써 Git 이력 추적과 운영위원 공유를 동시에 충족한다.
- `초기 검토 시안`(`revisedLines`)은 불변 기준선으로 보존되고, 회의 합의 문구(`workingLines`) 또는 현행유지 확정(`confirmed_current`) 여부만 별도 추적하므로 대의원대회 발표 시 변경 경위를 역추적할 수 있다.
