import { fetchGoogleTrendData } from "./search/google.js";
import { fetchNamuWikiTrends } from "./search/namuwiki.js";
import { fetchNaverTrends, getNaverUsage, testNaverConnection } from "./search/naver.js";

function commonHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...commonHeaders(),
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...commonHeaders(),
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function normalizeKeyword(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function browserNamuSource(input) {
  const raw = Array.isArray(input) ? input : [];
  const items = [];
  const seen = new Set();

  for (const value of raw) {
    const keyword = typeof value === "string" ? value.trim() : String(value?.keyword ?? "").trim();
    if (!keyword) continue;

    const key = normalizeKeyword(keyword);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    items.push({ keyword, rank: items.length + 1 });
    if (items.length >= 10) break;
  }

  return {
    source: "namuwiki",
    status: items.length ? "ok" : "error",
    collection_method: "browser_direct",
    items,
    error: items.length ? null : "browser_payload_empty"
  };
}

async function buildSearchPayload(env, browserNamuItems = null) {
  const [google, namuwiki, naver] = await Promise.all([
    fetchGoogleTrendData(),
    browserNamuItems ? Promise.resolve(browserNamuSource(browserNamuItems)) : fetchNamuWikiTrends(),
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
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Namu browser fetch test</title><style>body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px}</style></head><body><h1>나무위키 브라우저 직접 호출 테스트</h1><p id="status">테스트 중...</p><pre id="result"></pre><script>const statusEl=document.getElementById('status');const resultEl=document.getElementById('result');fetch('https://search.namu.wiki/api/ranking',{headers:{'Accept':'application/json, text/plain, */*'}}).then(async r=>{statusEl.textContent='HTTP '+r.status+' '+(r.ok?'성공':'실패');resultEl.textContent=(await r.text()).slice(0,5000)}).catch(e=>{statusEl.textContent='브라우저 호출 실패';resultEl.textContent=String(e)});</script></body></html>`;
}

function namuIntegratedTestPage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trend Hub integration test</title><style>body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px}</style></head><body><h1>검색 트렌드 통합 테스트</h1><p id="status">나무위키 → Trend Hub 통합 중...</p><pre id="result"></pre><script>const s=document.getElementById('status');const r=document.getElementById('result');(async()=>{try{const nr=await fetch('https://search.namu.wiki/api/ranking',{headers:{'Accept':'application/json, text/plain, */*'}});if(!nr.ok)throw new Error('Namu HTTP '+nr.status);const namu=await nr.json();const hr=await fetch('/api/search/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({namuwiki:namu})});const merged=await hr.json();const g=merged?.sources?.google_trends?.items?.length??0;const n=merged?.sources?.namuwiki?.items?.length??0;const v=merged?.sources?.naver?.items?.length??0;s.textContent='통합 성공 — Google '+g+'개 / 나무위키 '+n+'개 / 네이버 '+v+'개 / 통합 후보 '+(merged?.candidates?.length??0)+'개';r.textContent=JSON.stringify(merged,null,2)}catch(e){s.textContent='통합 실패';r.textContent=String(e)}})();</script></body></html>`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: commonHeaders() });
    }

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

    if (url.pathname === "/api/search" && request.method === "GET") {
      return json(await buildSearchPayload(env));
    }

    if (url.pathname === "/api/search/merge" && request.method === "POST") {
      try {
        const body = await request.json();
        return json(await buildSearchPayload(env, body?.namuwiki ?? []));
      } catch (error) {
        return json({ error: "invalid_json", detail: String(error?.message ?? error) }, 400);
      }
    }

    if (url.pathname === "/api/naver/usage" && request.method === "GET") {
      return json(await getNaverUsage(env));
    }

    if (url.pathname === "/api/naver/test" && request.method === "GET") {
      return json(await testNaverConnection(env));
    }

    if (url.pathname === "/test/namu-browser") {
      return html(namuBrowserTestPage());
    }

    if (url.pathname === "/test/namu-integrated") {
      return html(namuIntegratedTestPage());
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(buildSearchPayload(env));
  }
};
