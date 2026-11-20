# AGENTS.md — `union-portal` 작업 지침

## 핵심 불변식
1. **민감 데이터 Git 격리**: `data/local/`, `_raw/`, `directory/`, `reports/`, `_site/`, `.env`는 절대 Git에 추가하거나 커밋하지 않는다.
2. **실명 노출 금지**: 코드·테스트·커밋 메시지·작업 보고에 실제 조합원/외부인 실명, 생년월일, 전화번호, 이메일을 기록하지 않는다. 테스트는 가상 인명(`홍길동`, `김철수`, `이영희`, `박민수`, `M-9001`, `E-9001`)만 사용한다.
3. **도메인 어휘 준수**: [GLOSSARY-MAP.md](./GLOSSARY-MAP.md) 및 각 컨텍스트의 `GLOSSARY.md` 용어를 따른다.
4. **아키텍처 경계 준수**: 도메인(`src/domain/`)과 서비스(`src/services/`)는 `UnionRepositories`·`BlobStorage` 인터페이스에만 의존하고, SQLite 파일 경로·드라이버에 직접 결합하지 않는다([ADR-0001](./docs/adr/0001-static-local-first-cloud-ready.md), [ADR-0005](./docs/adr/0005-sqlite-source-of-truth-with-sync-adapters.md)).
5. **회계·참조 무결성**: Google Sheets 원장 동기화는 단방향(`tx_id` upsert)이며 `document_ledger_links`나 `refund_tx_id`가 참조하는 `tx_id` 누락 시 실패해야 한다.
