# DESIGN

우체국물류지원단 물류노동조합 종합 포털의 시각 체계입니다.

## 정체성 ("Hallmark Ledger")
- 장부처럼 굵은 상단 괘선(2px `--rule-bar`)과 1px 헤어라인으로 구역을 나눈다. 카드 중첩 대신 괘선과 여백을 사용한다.
- 브랜드 색: Klein Blue `#002FA7`(accent), 조합 로고 `#516DB2`, 잉크 `#0B051A`. 웹 포털 전체는 라이트/다크 쌍 토큰(`light-dark()`)을 지원한다.
- 의미 색: 수입 `--color-income`(녹색), 지출 `--color-expense`(적색), 교부·지원 `--color-grant`(황토), 잔액 `--color-accent`(청색).
- 차트 팔레트 "Fresh Fintech"(`--chart-*`): cobalt·blue·income·expense·grant·slate·teal·plum.

## 타이포그래피
- Pretendard Variable → SUIT → Apple SD Gothic Neo → Malgun Gothic → system-ui. 한 가족으로 제목·본문·숫자 모두 처리한다.
- 숫자는 `font-variant-numeric: tabular-nums lining-nums`. 고정폭 글꼴은 쓰지 않는다.
- 한국어 줄바꿈: `word-break: keep-all` + `overflow-wrap: anywhere`. 거래번호·운영기간·건수는 줄바꿈 금지.

## 인쇄·배포물 전용 규칙 (`@media print` · 성명서·현장소식지)
- 성명서·현장소식지의 `@media print` 및 PDF 출력 레이아웃은 다크 모드의 영향을 받지 않도록 **라이트 전용(`#FFFFFF` 배경 / `#111111` 본문 / `#002FA7` 강조)**으로 고정한다.
- 성명서는 본문 분량에 따라 `short` / `standard` / `long` 인쇄 밀도 조절과 다단/페이지 분할 기준을 보존하고, 현장소식지는 A3 인쇄 포스터 밀도 규격을 유지한다.

## 구성 요소 및 반경·간격
- KPI 띠: 1px 간격 그리드, 항목별 3px 상단 색 괘선. 휴대폰(< 560px) 2열, < 300px 1열.
- 표: 데스크톱 상단 고정 헤더 + 내부 스크롤, < 620px에서는 라벨—값 카드형 행으로 전환.
- 반경: 2px(sharp) / 4px(control) / 6px(sheet). 3px 이상 색 괘선이 붙는 요소는 반경 0.
- 페이지 폭 1180px, 거터 `clamp(1rem, 3vw, 2rem)`, 터치 타깃 32px 이상(내비·다이어그램·모바일 링크 44px).
