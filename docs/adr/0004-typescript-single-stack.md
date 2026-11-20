---
status: accepted
---

# TypeScript(Node.js 22 LTS) 단일 스택 통합

기존 `accounting`의 Python(`build_reports.py`, `manage_members.py`, `matplotlib`)과 `workplace`의 Node.js 파이프라인을 유지하지 않고, 통합 모노레포 전체를 TypeScript(Node.js 22 LTS) 단일 스택으로 통일한다. 회계와 자료실이 동일한 인명 정규화·개인정보 차단 규칙을 중복 없이 공유하고, 향후 클라우드 서버(API·인증 웹앱)로 이전할 때 도메인·스키마·UI 코드를 단일 언어로 재사용하기 위함이다.

## Considered Options

- **Python(데이터·회계) + Node.js(자료실) 하이브리드 유지**: 초기 이관 비용은 낮지만, 동일한 인명·개인정보 검증 규칙을 두 언어에 중복 구현하거나 런타임 간 프로세스 호출에 의존해야 하며 클라우드 이전 시 두 스택을 모두 유지해야 한다.
- **Python 단일 스택 통합**: 기존 `workplace`의 `content-model`, `ajv` v2 스키마, `parse5` 검증기, 회귀 테스트를 전부 재작성해야 하고 프론트엔드 JS와 언어가 분리된다.

## Consequences

- 내부 회계 보고서(월간 운영위·연간 대의원대회)의 차트는 `matplotlib` PNG 대신 인라인 SVG로 생성해 CI의 Python·한글 폰트 패키지 의존을 제거한다.
- 성명서·현장소식지 PDF 출력은 문서별 복제 스크립트 대신 로컬 Chrome/Edge 헤드리스 호출을 감싼 단일 범용 CLI 명령으로 통합한다.
