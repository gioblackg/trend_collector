import json
from urllib.parse import quote

from trend_collector.models import SourceItem, SourceResult
from trend_collector.normalize import clean_display_keyword, is_reasonable_keyword


DEFAULT_RANKING_URL = "https://search.namu.wiki/api/ranking"


def collect_namuwiki(
    http,
    url=DEFAULT_RANKING_URL,
    max_items=10,
    minimum_valid_items=5,
):
    """나무위키 실시간 검색어 전용 엔드포인트에서 순위를 수집한다.

    응답은 검색어 문자열 배열로 가정한다. HTML 메인 페이지를 스크래핑하지 않으므로
    namu.wiki 메인 페이지의 403/DOM 변경 영향에서 분리된다.
    """
    try:
        raw = http.get_text(
            url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://namu.wiki/",
                "Origin": "https://namu.wiki",
            },
        )
        data = json.loads(raw)

        if not isinstance(data, list):
            return SourceResult(
                "namuwiki",
                "error",
                error=f"예상하지 못한 응답 형식: {type(data).__name__}",
                meta={"url": url, "collector": "ranking_api_v1"},
            )

        keywords = []
        seen = set()

        for value in data:
            if not isinstance(value, str):
                continue

            keyword = clean_display_keyword(value)
            if not is_reasonable_keyword(keyword):
                continue

            key = keyword.casefold()
            if key in seen:
                continue

            seen.add(key)
            keywords.append(keyword)

            if len(keywords) >= max_items:
                break

        status = "ok" if len(keywords) >= minimum_valid_items else "error"
        error = None if status == "ok" else (
            f"실시간 검색어를 충분히 찾지 못했습니다. "
            f"발견 {len(keywords)}개 / 최소 {minimum_valid_items}개"
        )

        return SourceResult(
            "namuwiki",
            status,
            items=[
                SourceItem(
                    keyword=keyword,
                    rank=index + 1,
                    url=f"https://namu.wiki/w/{quote(keyword, safe='')}",
                    meta={
                        "source_role": "candidate_discovery",
                        "collection_method": "ranking_api",
                    },
                )
                for index, keyword in enumerate(keywords)
            ],
            error=error,
            meta={
                "url": url,
                "collector": "ranking_api_v1",
                "source_role": "candidate_discovery",
                "returned_items": len(data),
            },
        )

    except Exception as exc:
        return SourceResult(
            "namuwiki",
            "error",
            error=str(exc),
            meta={"url": url, "collector": "ranking_api_v1"},
        )
