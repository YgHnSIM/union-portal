---
status: accepted
---

# SQLite 정본 DB + Repository 추상화 및 동기화 어댑터 경계

로컬 JSON과 단방향 SQLite 캐시로 나뉘어 있던 조직·조합원·인명·문서-거래 링크·원장 스냅샷의 정본을 SQLite DB로 승격하되, Drizzle ORM과 명시적 SQL 마이그레이션 기반의 Repository 인터페이스 뒤에 숨긴다. 1단계 회계 입력은 기존 Google Sheets에서 SQLite로의 단방향 동기화(`tx_id` 기준 upsert)를 유지하고, 회의록·성명서 본문은 Git Markdown/HTML을 유지하며, 민감 첨부파일(가입서·은행 PDF)은 논리 키와 `BlobStorage` 인터페이스로 추상화한다.

## Considered Options

- **파일 기반 정본(JSON + Google Sheets + Markdown) 유지**: 수기 편집과 Git diff는 쉬우나, 다중 관계(물리 외래키, 시점별 직책 이력, 문서-거래 링크)의 무결성을 보장하기 어렵고 향후 클라우드 DB 전환 시 데이터 계층을 전면 재설계해야 한다.
- **Google Sheets 즉시 폐기 및 DB 직접 입력**: 원장 입력 도구를 처음부터 새로 만들어야 하므로 1단계 범위가 과도하게 커진다.

## Consequences

- 향후 클라우드 서버 이전 시 도메인 로직과 공개 빌더를 수정하지 않고 저장소 구현체만 SQLite → PostgreSQL, `LocalFileStorage` → 클라우드 오브젝트 스토리지, `FileSystemContentSource` → 원격 콘텐츠 소스로 교체할 수 있다.
- 비민감 마스터 설정(`config/units.json`, `config/coa.json`)은 `sync-config`(및 `sync-ledger` 연계)로 SQLite 마스터 테이블과 동기화한다.
- Google Sheets 동기화 시 기존 `document_ledger_links`나 환급 이력이 참조하는 `tx_id`가 사라지면 즉시 오류로 차단해 참조 무결성을 지킨다.
- 사람 열람·비상 복구용 `directory/*.md` 및 JSON 스냅샷 내보내기는 정본이 아닌 파생 뷰로 유지한다.
