import time
import urllib.error
import urllib.request

class HttpClient:
    def __init__(self, timeout=15, retries=2, user_agent="TodayVideoTrendCollector/0.2"):
        self.timeout = timeout
        self.retries = retries
        self.user_agent = user_agent

    def get_bytes(self, url, headers=None):
        merged = {
            "User-Agent": self.user_agent,
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
            "Cache-Control": "no-cache",
        }
        if headers:
            merged.update(headers)

        last = None
        for attempt in range(self.retries + 1):
            try:
                req = urllib.request.Request(url, headers=merged, method="GET")
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    return res.read()
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                last = exc
                if attempt < self.retries:
                    time.sleep(attempt + 1)

        raise RuntimeError(f"GET 실패: {url} / {last}")

    def get_text(self, url, headers=None):
        return self.get_bytes(url, headers).decode("utf-8", errors="replace")
