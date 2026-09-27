# 오늘의 영상 - 트렌드 수집기 v0.2

## 변경점
- NAVER DataLab API 연동 제거
- API Key / Client Secret / .env 불필요
- 현재 검색 실시간 수집원: Google Trends + 나무위키
- GitHub Actions 자동 수집 구조 유지
- 향후 커뮤니티/미디어 트렌드 확장 구조 유지

## 운영 구조
```text
오늘의영상_트렌드수집기_v0.2/
├─ collector/
│  ├─ run_collector.py
│  └─ trend_collector/
│     ├─ sources/
│     │  ├─ google_trends.py
│     │  └─ namuwiki.py
│     └─ future_sources/
│        ├─ community/
│        └─ media/
├─ data/
│  └─ trends.json
└─ .github/workflows/
   └─ update-trends.yml
```

최종 운영은 사용자 PC가 아니라 GitHub Actions에서 자동 실행하는 것을 전제로 합니다.
웹사이트는 `data/trends.json`만 읽으면 됩니다.

## 현재 구현
- Google Trends 한국 Trending RSS 수집
- 나무위키 공개 페이지의 실시간 검색어 추출
- 검색어 정규화/중복 제거
- 통합 후보 목록 생성

## 아직 미구현
- 최종 `검색 실시간 TOP 10` 가중치
- 커뮤니티 실시간 TOP 10
- 미디어 실시간 TOP 10
- YouTube 영상 수집

가중치는 아직 확정하지 않았으므로 `search_top10`은 빈 배열로 둡니다.

## 확장 구조
```text
categories
├─ search
├─ community
└─ media
```

현재 실제 구현은 `search`만 합니다. 나중에 커뮤니티/미디어 수집기를 추가해도 JSON 최상위 구조는 그대로 유지됩니다.

## GitHub Actions
기본 10분 간격 실행입니다.
- Google Trends 수집
- 나무위키 수집
- 후보 통합
- `data/trends.json` 갱신
- 변경된 경우만 commit/push

별도 API Secret은 필요 없습니다.

## 로컬 실행
개발 점검용:
```bash
python collector/run_collector.py
```

## PC 환경 변경 없음
브라우저 설정, 확장프로그램, 레지스트리, 환경변수, 방화벽, 프록시/DNS, 시작프로그램 등을 변경하지 않습니다.
