import { fetchGoogleTrendData } from "./search/google.js";
import {
  fetchNaverTrends,
  getNaverUsage,
  testNaverConnection,
  refreshNaverCandidateScores
} from "./search/naver.js";
import {
  collectCandidateKeywords,
  rankSearchCandidates,
  RRF_K,
  RRF_WEIGHTS
} from "./search/ranking.js";

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

function scoringMetadata() {
  return {
    method: "weighted_rrf",
    k: RRF_K,
    weights: {
      naver: RRF_WEIGHTS.naver,
      google: RRF_WEIGHTS.google,
      namuwiki: RRF_WEIGHTS.namuwiki
    },
    overlap_bonus: 0,
    note: "Google/나무위키가 후보를 발견하고 NAVER는 후보 검증 순위로 참여"
  };
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
        value_label: item.value_label ?? null,
        score: item.score ?? null,
        relative_strength: item.relative_strength ?? null
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

function emptyNamuSource() {
  return {
    source: "namuwiki",
    status: "waiting_for_browser",
    collection_method: "browser_direct_cache",
    items: [],
    error: "browser_cache_empty"
  };
}

async function storeBrowserNamu(env, source) {
  if (!env?.TREND_STATE || source?.status !== "ok") return false;
  await env.TREND_STATE.put(
    "namuwiki:latest",
    JSON.stringify({ ...source, generated_at: new Date().toISOString() })
  );
  return true;
}

async function readCachedNamu(env) {
  if (!env?.TREND_STATE) return null;
  return env.TREND_STATE.get("namuwiki:latest", "json");
}

async function getNamuCacheStatus(env) {
  const cached = await readCachedNamu(env);
  if (!cached) {
    return {
      status: "cache_empty",
      item_count: 0,
      generated_at: null,
      age_seconds: null
    };
  }

  const generatedAt = cached?.generated_at ?? null;
  const generatedMs = generatedAt ? new Date(generatedAt).getTime() : NaN;
  const ageSeconds = Number.isFinite(generatedMs)
    ? Math.max(0, Math.floor((Date.now() - generatedMs) / 1000))
    : null;

  return {
    status: cached?.status ?? "unknown",
    collection_method: cached?.collection_method ?? null,
    item_count: Array.isArray(cached?.items) ? cached.items.length : 0,
    generated_at: generatedAt,
    age_seconds: ageSeconds
  };
}

async function resolveNamuSource(env, browserNamuItems = null) {
  if (browserNamuItems) {
    const source = browserNamuSource(browserNamuItems);
    await storeBrowserNamu(env, source);
    return source;
  }

  const cached = await readCachedNamu(env);
  if (cached?.status === "ok" && Array.isArray(cached?.items) && cached.items.length) return cached;

  return emptyNamuSource();
}

async function buildSearchPayload(env, browserNamuItems = null) {
  const [google, namuwiki, naver] = await Promise.all([
    fetchGoogleTrendData(),
    resolveNamuSource(env, browserNamuItems),
    fetchNaverTrends(env)
  ]);

  const sources = [google, namuwiki, naver];
  const candidates = mergeSearchSources(sources);
  const ranked = rankSearchCandidates(google, namuwiki, naver);
  const naverReady = naver?.status === "ok" && Array.isArray(naver?.items) && naver.items.length > 0;
  const namuReady = namuwiki?.status === "ok" && Array.isArray(namuwiki?.items) && namuwiki.items.length > 0;

  return {
    schema_version: "1.2",
    generated_at: new Date().toISOString(),
    category: "search",
    status: sources.some((s) => s.status === "ok") ? "partial_or_ok" : "error",
    ranking_status: naverReady && namuReady ? "finalized" : "partial",
    scoring: scoringMetadata(),
    sources: Object.fromEntries(sources.map((s) => [s.source, s])),
    candidates,
    ranked,
    top10: ranked.slice(0, 10)
  };
}

async function scheduledRefresh(env) {
  const google = await fetchGoogleTrendData();
  const namuwiki = await resolveNamuSource(env);
  const candidates = collectCandidateKeywords(google, namuwiki);
  const naver = await refreshNaverCandidateScores(env, candidates);
  const ranked = rankSearchCandidates(google, namuwiki, naver);
  const naverReady = naver?.status === "ok" && Array.isArray(naver?.items) && naver.items.length > 0;
  const namuReady = namuwiki?.status === "ok" && Array.isArray(namuwiki?.items) && namuwiki.items.length > 0;

  const snapshot = {
    schema_version: "1.2",
    generated_at: new Date().toISOString(),
    category: "search",
    status: naverReady && namuReady ? "ok" : "partial",
    ranking_status: naverReady && namuReady ? "finalized" : "partial",
    scoring: scoringMetadata(),
    sources: {
      [google.source]: google,
      [namuwiki.source]: namuwiki,
      [naver.source]: naver
    },
    candidates: mergeSearchSources([google, namuwiki, naver]),
    ranked,
    top10: ranked.slice(0, 10)
  };

  if (env?.TREND_STATE) {
    await env.TREND_STATE.put("search:latest", JSON.stringify(snapshot));
  }
  return snapshot;
}

function namuBrowserTestPage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Namu browser fetch test</title><style>body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px}</style></head><body><h1>나무위키 브라우저 직접 호출 테스트</h1><p id="status">테스트 중...</p><pre id="result"></pre><script>const statusEl=document.getElementById('status');const resultEl=document.getElementById('result');fetch('https://search.namu.wiki/api/ranking',{headers:{'Accept':'application/json, text/plain, */*'}}).then(async r=>{statusEl.textContent='HTTP '+r.status+' '+(r.ok?'성공':'실패');resultEl.textContent=(await r.text()).slice(0,5000)}).catch(e=>{statusEl.textContent='브라우저 호출 실패';resultEl.textContent=String(e)});</script></body></html>`;
}

function namuIntegratedTestPage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trend Hub integration test</title><style>body{font-family:system-ui,sans-serif;padding:24px;line-height:1.5}pre{white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px}</style></head><body><h1>검색 트렌드 통합 테스트</h1><p id="status">나무위키 → KV 저장 중...</p><pre id="result"></pre><script>const s=document.getElementById('status');const r=document.getElementById('result');(async()=>{try{const nr=await fetch('https://search.namu.wiki/api/ranking',{headers:{'Accept':'application/json, text/plain, */*'}});if(!nr.ok)throw new Error('Namu HTTP '+nr.status);const namu=await nr.json();const hr=await fetch('/api/search/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({namuwiki:namu})});const merged=await hr.json();const g=merged?.sources?.google_trends?.items?.length??0;const n=merged?.sources?.namuwiki?.items?.length??0;const v=merged?.sources?.naver?.items?.length??0;s.textContent='KV 저장 성공 — Google '+g+'개 / 나무위키 '+n+'개 / NAVER 캐시 '+v+'개 / 현재 TOP10 '+(merged?.top10?.length??0);r.textContent=JSON.stringify(merged,null,2)}catch(e){s.textContent='통합 실패';r.textContent=String(e)}})();</script></body></html>`;
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

    if (url.pathname === "/api/namu/status" && request.method === "GET") {
      return json(await getNamuCacheStatus(env));
    }

    if (url.pathname === "/api/naver/usage" && request.method === "GET") {
      return json(await getNaverUsage(env));
    }

    if (url.pathname === "/api/naver/test" && request.method === "GET") {
      return json(await testNaverConnection(env));
    }

    if (url.pathname === "/api/search/latest" && request.method === "GET") {
      const cached = env?.TREND_STATE ? await env.TREND_STATE.get("search:latest", "json") : null;
      return json(cached ?? { status: "cache_empty" });
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
    ctx.waitUntil(scheduledRefresh(env));
  }
};
