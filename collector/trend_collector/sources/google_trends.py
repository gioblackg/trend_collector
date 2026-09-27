import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from trend_collector.models import SourceItem, SourceResult
from trend_collector.normalize import clean_display_keyword, is_reasonable_keyword

RSS_NS = {"ht": "https://trends.google.com/trending/rss"}

def _traffic_to_number(text):
    if not text:
        return None
    s = text.strip().replace(",", "").replace("+", "").upper()
    m = re.match(r"([0-9.]+)\s*([KMB]?)", s)
    if not m:
        return None
    n = float(m.group(1))
    factor = {"":1, "K":1000, "M":1000000, "B":1000000000}.get(m.group(2), 1)
    return n * factor

def collect_google_trends(http, geo="KR", max_items=30):
    url = f"https://trends.google.com/trending/rss?geo={geo}"
    try:
        raw = http.get_bytes(url, headers={
            "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5"
        })
        root = ET.fromstring(raw)
        items = []

        for idx, node in enumerate(root.findall(".//item"), start=1):
            if len(items) >= max_items:
                break

            title = clean_display_keyword(node.findtext("title") or "")
            if not is_reasonable_keyword(title):
                continue

            traffic_label = node.findtext("ht:approx_traffic", namespaces=RSS_NS)
            pub_raw = node.findtext("pubDate")
            pub_iso = None
            if pub_raw:
                try:
                    pub_iso = parsedate_to_datetime(pub_raw).isoformat()
                except Exception:
                    pub_iso = pub_raw

            items.append(SourceItem(
                keyword=title,
                rank=idx,
                value=_traffic_to_number(traffic_label),
                value_label=traffic_label,
                published_at=pub_iso,
                url=node.findtext("link"),
                meta={"source_role":"candidate_discovery"}
            ))

        if not items:
            return SourceResult("google_trends", "error", error="RSS item을 찾지 못했습니다.", meta={"url":url})

        return SourceResult(
            "google_trends",
            "ok",
            items=items,
            meta={"url":url, "geo":geo, "source_role":"candidate_discovery"}
        )
    except Exception as exc:
        return SourceResult("google_trends", "error", error=str(exc), meta={"url":url})
