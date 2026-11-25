# 우체국물류지원단 물류노동조합 종합 포털 (`union-portal`)

회계·재정(`accounting`), 조직·조합원·인명(`organization`), 회의록·성명서·소식지·자료실(`archive`)을 통합하는 TypeScript(Node.js 22 LTS) 기반 종합 노조 관리 및 공개 포털 시스템입니다.

## 아키텍처 개요
- **용어 지도**: [GLOSSARY-MAP.md](./GLOSSARY-MAP.md) (`src/organization/GLOSSARY.md`, `src/accounting/GLOSSARY.md`, `src/archive/GLOSSARY.md`)
- **아키텍처 결정 기록**: [docs/adr/](./docs/adr/) (`0001`~`0007`)
- **아키텍처·인수인계 해설서**: [docs/ARCHITECTURE-HANDOVER.md](./docs/ARCHITECTURE-HANDOVER.md) · [브라우저용 HTML](./docs/ARCHITECTURE-HANDOVER.html)
- **디자인·제품 기준**: [DESIGN.md](./DESIGN.md), [PRODUCT.md](./PRODUCT.md)

## 폴더 구조
| 경로 | 역할 | Git 추적 |
| :--- | :--- | :---: |
| `src/domain/` | 순수 도메인 규칙(인명 정규화, 차등 공개/비식별, 회계 검증·결산, 콘텐츠 그래프 모델, 공개 투영 스키마) | 포함 |
| `src/storage/` | `UnionRepositories`, `BlobStorage`, `ContentSource`, 솔트 관리 및 Drizzle SQLite 구현체 | 포함 |
| `src/services/` | 마스터 설정 동기화, 레거시 이관, 원장 단방향 동기화, 조합원 관리, 공개 투영 생성, 개인정보 감사 | 포함 |
| `src/site/` | 정적 포털 오케스트레이터(`build-site.ts`), 4축 IA 빌더(`pages/`), AST 검증(`validate-site.ts`), SVG 차트·규약 | 포함 |
| `src/cli/` | `union` CLI 엔트리포인트 및 인자 파서 | 포함 |
| `drizzle/` | 명시적 SQLite SQL 마이그레이션 | 포함 |
| `config/` | `units.json`, `coa.json` 등 비민감 공개 마스터 설정 | 포함 |
| `_source/` | 회의록, 성명서, 소식지, 지식, 알림 원본 및 v3 JSON 스키마 | 포함 |
| `data/public/` | 비식별 공개 투영 JSON 및 솔트 기반 HMAC-SHA256 해시 인덱스 | 포함 |
| `data/local/` | 로컬 정본 SQLite DB(`union.db`) | **제외** |
| `_raw/` | 가입서·탈퇴서 이미지, 은행 PDF, 회의록 원본 백업 | **제외** |
| `directory/` | 사람 열람용 로컬 Markdown 파생 뷰 | **제외** |
| `reports/`, `_site/` | 내부용 실명 보고서 및 빌드된 정적 사이트 산출물 | **제외** |

## 주요 명령
```powershell
npm run db:migrate
npm run db:sync-config
npm run union -- export-md
npm run export:public
npm run check:local
npm run check:ci
```
