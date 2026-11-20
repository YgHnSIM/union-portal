# Glossary Map

우체국물류지원단 물류노동조합 종합 관리·공개 포털의 도메인 어휘 지도입니다.

## Contexts

- [Organization](./src/organization/GLOSSARY.md): 조합 조직단위, 인물(조합원·외부 인사), 직책 및 공적 노출·인명 표기 기준을 관리합니다.
- [Accounting](./src/accounting/GLOSSARY.md): 조합 회계단위, 재원, 거래 구분, 기간 속성 및 3단계 계정 체계(관·항·목)를 관리합니다.
- [Archive](./src/archive/GLOSSARY.md): 조합 회의록, 성명서, 소식지, 지식·알림 문서와 공개 투영·가시성 및 회계 연계를 관리합니다.

## Relationships

- **Organization → Accounting**: `조직단위`가 `회계단위` 역할을 부여하고, `인물`이 회계 거래의 대상·찬조 주체로 참조됩니다.
- **Organization → Archive**: `인물`과 `공적 노출 등급`이 공적 문서 내 실명·직책 병기 및 비식별 검증 기준을 제공합니다.
- **Archive ↔ Accounting**: `문서-거래 연결`로 활동 문서와 관련 거래를 양방향 참조하며, 회의록은 `기준월 (재정 연동)`으로 회계·조직 현황과 대조됩니다.
