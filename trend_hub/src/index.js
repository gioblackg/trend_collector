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

    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(buildSearchPayload(env));
  }
};
