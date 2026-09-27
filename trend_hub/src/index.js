import { fetchGoogleTrendData } from "./search/google.js";
import { fetchNamuWikiTrends } from "./search/namuwiki.js";
import { fetchNaverTrends } from "./search/naver.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function normalizeKeyword(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeSearchSources(sources) {
  const map = new Map();
  let order = 0;

  for (const source of sources) {
    for (const item of source.items ?? []) {
      const key = normalizeKeyword(item.keyword);
      if (!key) continue;

      if (!map.has(key)) {
        order += 1;
        map.set(key, {
          keyword: item.keyword,
          first_seen_order: order,
          source_count: 0,
          sources: {}
        });
      }

      const row = map.get(key);
      row.sources[source.source] = {
        rank: item.rank ?? null,
        value: item.value ?? null,
        value_label: item.value_label ?? null
      };
      row.source_count = Object.keys(row.sources).length;
    }
  }

  return [...map.values()].sort(
    (a, b) => b.source_count - a.source_count || a.first_seen_order - b.first_seen_order
  );
}

async function buildSearchPayload(env) {
  const [google, namuwiki, naver] = await Promise.all([
    fetchGoogleTrendData(),
    fetchNamuWikiTrends(),
    fetchNaverTrends(env)
  ]);

  const sources = [google, namuwiki, naver];
  const candidates = mergeSearchSources(sources);

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    category: "search",
    status: sources.some((s) => s.status === "ok") ? "partial_or_ok" : "error",
    ranking_status: "not_finalized",
    sources: Object.fromEntries(sources.map((s) => [s.source, s])),
    candidates,
    top10: []
  };
}

function namuBrowserTestPage() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Namu browser fetch test</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5}
    pre{white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px}
  </style>
</head>
<body>
  <h1>나무위키 브라우저 직접 호출 테스트</h1>
  <p id="status">테스트 중...</p>
  <pre id="result"></pre>
  <script>
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    fetch('https://search.namu.wiki/api/ranking', {
      headers: { 'Accept': 'application/json, text/plain, */*' }
    })
      .then(async (r) => {
        statusEl.textContent = 'HTTP ' + r.status + ' ' + (r.ok ? '성공' : '실패');
        const text = await r.text();
        resultEl.textContent = text.slice(0, 5000);
      })
      .catch((e) => {
        statusEl.textContent = '브라우저 호출 실패';
        resultEl.textContent = String(e);
      });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        service: "today-video-trend-hub",
        status: "ok",
        categories: {
          search: "active",
          community: "reserved",
          media: "reserved"
        }
      });
    }

    if (url.pathname === "/api/search") {
      return json(await buildSearchPayload(env));
    }

    if (url.pathname === "/test/namu-browser") {
      return html(namuBrowserTestPage());
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(buildSearchPayload(env));
  }
};
