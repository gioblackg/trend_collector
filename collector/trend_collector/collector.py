import json
from datetime import datetime, timezone
from pathlib import Path

from trend_collector.http import HttpClient
from trend_collector.normalize import normalize_keyword
from trend_collector.models import SourceResult
from trend_collector.sources.google_trends import collect_google_trends
from trend_collector.sources.namuwiki import collect_namuwiki

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config.json"
OUTPUT = ROOT / "data" / "trends.json"

def load_config():
    with CONFIG.open("r", encoding="utf-8") as f:
        return json.load(f)

def build_candidates(results):
    by_key = {}
    order = 0

    for result in results:
        for item in result.items:
            normalized = normalize_keyword(item.keyword)
            if not normalized:
                continue

            if normalized not in by_key:
                order += 1
                by_key[normalized] = {
                    "keyword": item.keyword,
                    "normalized_keyword": normalized,
                    "first_seen_order": order,
                    "source_count": 0,
                    "sources": {}
                }

            row = by_key[normalized]
            row["sources"][result.source] = {
                "rank": item.rank,
                "value": item.value,
                "value_label": item.value_label
            }
            row["source_count"] = len(row["sources"])

            if len(item.keyword) < len(row["keyword"]):
                row["keyword"] = item.keyword

    rows = list(by_key.values())
    rows.sort(key=lambda x: (-x["source_count"], x["first_seen_order"]))
    return rows

def health(results):
    statuses = [r.status for r in results]
    if all(s == "ok" for s in statuses):
        return "ok"
    if any(s == "ok" for s in statuses):
        return "partial"
    return "error"

def main():
    cfg = load_config()
    http_cfg = cfg.get("http", {})
    http = HttpClient(
        timeout=int(http_cfg.get("timeout_seconds", 15)),
        retries=int(http_cfg.get("retries", 2)),
        user_agent=str(http_cfg.get("user_agent", "TodayVideoTrendCollector/0.2"))
    )

    search_cfg = cfg.get("search", {})

    gcfg = search_cfg.get("google_trends", {})
    google = (
        collect_google_trends(
            http,
            geo=gcfg.get("geo","KR"),
            max_items=int(gcfg.get("max_items",30))
        )
        if gcfg.get("enabled", True)
        else SourceResult("google_trends","skipped",error="disabled")
    )

    ncfg = search_cfg.get("namuwiki", {})
    namu = (
        collect_namuwiki(
            http,
            url=ncfg.get("url","https://namu.wiki/"),
            max_items=int(ncfg.get("max_items",10)),
            minimum_valid_items=int(ncfg.get("minimum_valid_items",5))
        )
        if ncfg.get("enabled", True)
        else SourceResult("namuwiki","skipped",error="disabled")
    )

    candidates = build_candidates([google, namu])

    output = {
        "schema_version": cfg.get("schema_version","1.0"),
        "collector_version": "0.2.0",
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "categories": {
            "search": {
                "status": health([google, namu]),
                "ranking_status": "not_finalized",
                "ranking_note": "Google Trends + 나무위키 기반. 최종 가중치는 아직 미확정.",
                "sources": {
                    "google_trends": google.to_dict(),
                    "namuwiki": namu.to_dict()
                },
                "candidates": candidates,
                "search_top10": []
            },
            "community": {
                "status": "not_implemented",
                "sources": {},
                "top10": [],
                "note": "향후 커뮤니티 트렌드 수집기 추가 예약 영역"
            },
            "media": {
                "status": "not_implemented",
                "sources": {},
                "top10": [],
                "note": "향후 미디어 트렌드 수집기 추가 예약 영역"
            }
        }
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(OUTPUT)

    print("="*58)
    print("오늘의 영상 - 트렌드 수집기 v0.2")
    print("="*58)
    print(f"Google Trends : {google.status:>7} / {len(google.items)}개")
    print(f"나무위키      : {namu.status:>7} / {len(namu.items)}개")
    print(f"통합 후보      : {len(candidates)}개")
    print(f"출력           : {OUTPUT}")
    print("※ 최종 검색 TOP 10 가중치는 아직 적용하지 않았습니다.")

    return 0 if any(r.status == "ok" for r in (google, namu)) else 2
