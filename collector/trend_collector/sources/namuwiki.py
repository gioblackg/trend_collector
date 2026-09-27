import html
import re
from html.parser import HTMLParser

from trend_collector.models import SourceItem, SourceResult
from trend_collector.normalize import clean_display_keyword, is_reasonable_keyword

_HINTS = ("realtime", "trending", "popular", "ranking", "rank")
_REALTIME = "실시간 검색어"

class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.anchor = None
        self.candidates = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        cls = (d.get("class") or "").lower()
        ident = (d.get("id") or "").lower()
        hinted = any(x in cls or x in ident for x in _HINTS)
        inherited = self.stack[-1]["hinted"] if self.stack else False
        ctx = {"tag":tag, "hinted": hinted or inherited}
        self.stack.append(ctx)

        if tag == "a":
            self.anchor = {
                "href": d.get("href") or "",
                "parts": [],
                "hinted": ctx["hinted"],
            }

    def handle_data(self, data):
        if self.anchor is not None and data.strip():
            self.anchor["parts"].append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            text = clean_display_keyword(" ".join(self.anchor["parts"]))
            self.candidates.append((text, self.anchor["href"], self.anchor["hinted"]))
            self.anchor = None

        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                break

def _wiki_href(href):
    return href.startswith("/w/") or "namu.wiki/w/" in href

def _extract_hint(page):
    p = _Parser()
    p.feed(page)
    out, seen = [], set()

    for text, href, hinted in p.candidates:
        if not hinted or not _wiki_href(href) or not is_reasonable_keyword(text):
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)

    return out

def _extract_window(page):
    positions = [m.start() for m in re.finditer(_REALTIME, page)]
    if not positions:
        return []

    anchor_re = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
    tag_re = re.compile(r"<[^>]+>")
    best = []

    for pos in positions:
        segment = page[max(0,pos-10000):pos+70000]
        found, seen = [], set()

        for href, body in anchor_re.findall(segment):
            if not _wiki_href(href):
                continue
            text = clean_display_keyword(html.unescape(tag_re.sub(" ", body)))
            if not is_reasonable_keyword(text) or text == _REALTIME:
                continue

            key = text.casefold()
            if key in seen:
                continue
            seen.add(key)
            found.append(text)

            if len(found) >= 15:
                break

        if len(found) > len(best):
            best = found

    return best

def collect_namuwiki(http, url="https://namu.wiki/", max_items=10, minimum_valid_items=5):
    try:
        page = http.get_text(url, headers={
            "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer":"https://namu.wiki/"
        })

        keywords = _extract_hint(page)

        if len(keywords) < minimum_valid_items:
            merged, seen = [], set()
            for k in keywords + _extract_window(page):
                key = k.casefold()
                if key not in seen:
                    seen.add(key)
                    merged.append(k)
            keywords = merged

        keywords = keywords[:max_items]
        status = "ok" if len(keywords) >= minimum_valid_items else "error"
        error = None if status == "ok" else (
            f"실시간 검색어를 충분히 찾지 못했습니다. 발견 {len(keywords)}개 / 최소 {minimum_valid_items}개"
        )

        return SourceResult(
            "namuwiki",
            status,
            items=[
                SourceItem(
                    keyword=k,
                    rank=i+1,
                    url=f"https://namu.wiki/w/{k}",
                    meta={"source_role":"candidate_discovery"}
                )
                for i,k in enumerate(keywords)
            ],
            error=error,
            meta={
                "url":url,
                "parser":"heuristic_dom_parser_v2",
                "source_role":"candidate_discovery"
            }
        )

    except Exception as exc:
        return SourceResult("namuwiki", "error", error=str(exc), meta={"url":url})
