const NAVER_API_URL = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";

export const NAVER_CONSOLE_MONTHLY_CAP = 30000;
export const NAVER_INTERNAL_MONTHLY_CAP = 29000;
export const NAVER_MAX_CALLS_PER_REFRESH = 5;
const NAVER_ANCHOR = "네이버";

function monthId(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function usageKey(date = new Date()) {
  return `naver:usage:${monthId(date)}`;
}

function emptySnapshot(status, error = null) {
  return {
    source: "naver",
    status,
    collection_method: "scheduled_cache",
    items: [],
    error
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function latestRatio(result) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  if (!rows.length) return 0;
  const latest = rows[rows.length - 1];
  return Math.max(0, Number(latest?.ratio) || 0);
}

export function getNaverConfigStatus(env) {
  return {
    naver_client_id: Boolean(env?.NAVER_CLIENT_ID),
    naver_client_secret: Boolean(env?.NAVER_CLIENT_SECRET),
    trend_state: Boolean(env?.TREND_STATE),
    ready: Boolean(env?.NAVER_CLIENT_ID && env?.NAVER_CLIENT_SECRET && env?.TREND_STATE)
  };
}

export async function getNaverUsage(env) {
  const kv = env?.TREND_STATE;
  const month = monthId();

  if (!kv) {
    return {
      month,
      used: 0,
      internal_cap: NAVER_INTERNAL_MONTHLY_CAP,
      console_cap: NAVER_CONSOLE_MONTHLY_CAP,
      remaining_internal: NAVER_INTERNAL_MONTHLY_CAP,
      state: "kv_not_configured"
    };
  }

  const raw = await kv.get(usageKey());
  const used = Math.max(0, Number.parseInt(raw ?? "0", 10) || 0);

  return {
    month,
    used,
    internal_cap: NAVER_INTERNAL_MONTHLY_CAP,
    console_cap: NAVER_CONSOLE_MONTHLY_CAP,
    remaining_internal: Math.max(0, NAVER_INTERNAL_MONTHLY_CAP - used),
    state: used >= NAVER_INTERNAL_MONTHLY_CAP ? "blocked" : "ok"
  };
}

export async function readNaverSnapshot(env) {
  const kv = env?.TREND_STATE;
  const clientId = env?.NAVER_CLIENT_ID;
  const clientSecret = env?.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) return emptySnapshot("not_configured");
  if (!kv) return emptySnapshot("state_not_configured", "TREND_STATE KV binding required");

  const cached = await kv.get("naver:latest", "json");
  if (!cached) return emptySnapshot("cache_empty");
  return cached;
}

export async function storeNaverSnapshot(env, snapshot) {
  const kv = env?.TREND_STATE;
  if (!kv) return false;
  await kv.put("naver:latest", JSON.stringify(snapshot));
  return true;
}

export async function callNaverSearchTrend(env, requestBody) {
  const clientId = env?.NAVER_CLIENT_ID;
  const clientSecret = env?.NAVER_CLIENT_SECRET;
  const kv = env?.TREND_STATE;

  if (!clientId || !clientSecret) return { ok: false, status: "not_configured", http_status: null, data: null };
  if (!kv) return { ok: false, status: "state_not_configured", http_status: null, data: null };

  const usage = await getNaverUsage(env);
  if (usage.used >= NAVER_INTERNAL_MONTHLY_CAP) {
    return { ok: false, status: "monthly_cap_blocked", http_status: null, data: null, usage };
  }

  const nextUsed = usage.used + 1;
  await kv.put(usageKey(), String(nextUsed));

  try {
    const response = await fetch(NAVER_API_URL, {
      method: "POST",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text.slice(0, 2000) }; }

    return {
      ok: response.ok,
      status: response.ok ? "ok" : "http_error",
      http_status: response.status,
      data,
      usage: {
        month: usage.month,
        used: nextUsed,
        internal_cap: NAVER_INTERNAL_MONTHLY_CAP,
        console_cap: NAVER_CONSOLE_MONTHLY_CAP,
        remaining_internal: Math.max(0, NAVER_INTERNAL_MONTHLY_CAP - nextUsed)
      }
    };
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      http_status: null,
      data: null,
      error: String(error?.message ?? error),
      usage: {
        month: usage.month,
        used: nextUsed,
        internal_cap: NAVER_INTERNAL_MONTHLY_CAP,
        console_cap: NAVER_CONSOLE_MONTHLY_CAP,
        remaining_internal: Math.max(0, NAVER_INTERNAL_MONTHLY_CAP - nextUsed)
      }
    };
  }
}

// Google + 나무위키가 만든 후보를 NAVER 검색어트렌드로 검증한다.
// 한 요청은 공통 기준어 1개 + 후보 4개로 구성하여 최대 20개 후보를 5회 이내에 처리한다.
export async function refreshNaverCandidateScores(env, candidateKeywords) {
  const candidates = [...new Set((candidateKeywords ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))]
    .filter((v) => v !== NAVER_ANCHOR)
    .slice(0, 20);

  if (!candidates.length) {
    const snapshot = { ...emptySnapshot("no_candidates"), generated_at: new Date().toISOString() };
    await storeNaverSnapshot(env, snapshot);
    return snapshot;
  }

  const end = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const groups = chunks(candidates, 4).slice(0, NAVER_MAX_CALLS_PER_REFRESH);
  const strengths = [];
  let lastUsage = null;

  for (const group of groups) {
    const requestBody = {
      startDate: isoDate(start),
      endDate: isoDate(end),
      timeUnit: "date",
      keywordGroups: [
        { groupName: "__anchor__", keywords: [NAVER_ANCHOR] },
        ...group.map((keyword, index) => ({ groupName: `k${index + 1}`, keywords: [keyword] }))
      ]
    };

    const response = await callNaverSearchTrend(env, requestBody);
    lastUsage = response.usage ?? lastUsage;
    if (!response.ok) {
      const snapshot = {
        ...emptySnapshot(response.status, response.data ?? response.error ?? null),
        generated_at: new Date().toISOString(),
        candidate_count: candidates.length,
        calls_planned: groups.length,
        usage: lastUsage
      };
      await storeNaverSnapshot(env, snapshot);
      return snapshot;
    }

    const results = Array.isArray(response.data?.results) ? response.data.results : [];
    const anchor = results.find((r) => r?.title === "__anchor__");
    const anchorRatio = latestRatio(anchor);

    group.forEach((keyword, index) => {
      const result = results.find((r) => r?.title === `k${index + 1}`);
      const ratio = latestRatio(result);
      const relativeStrength = anchorRatio > 0 ? ratio / anchorRatio : ratio;
      strengths.push({
        keyword,
        relative_strength: relativeStrength,
        raw_ratio: ratio,
        anchor_ratio: anchorRatio,
        period: isoDate(end)
      });
    });
  }

  const maxStrength = Math.max(0, ...strengths.map((item) => item.relative_strength));
  const items = strengths
    .map((item) => ({
      ...item,
      score: maxStrength > 0 ? (item.relative_strength / maxStrength) * 100 : 0
    }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({ ...item, rank: index + 1, score: Number(item.score.toFixed(2)) }));

  const snapshot = {
    source: "naver",
    status: "ok",
    collection_method: "scheduled_cache",
    generated_at: new Date().toISOString(),
    period: { start: isoDate(start), end: isoDate(end), timeUnit: "date" },
    anchor: NAVER_ANCHOR,
    candidate_count: candidates.length,
    calls_used: groups.length,
    usage: lastUsage,
    items,
    error: null
  };

  await storeNaverSnapshot(env, snapshot);
  return snapshot;
}

export async function testNaverConnection(env) {
  const kv = env?.TREND_STATE;
  if (!kv) return { ok: false, status: "state_not_configured", config: getNaverConfigStatus(env) };

  const config = getNaverConfigStatus(env);
  if (!config.ready) {
    await kv.delete("naver:test:connection");
    return { ok: false, status: "not_configured", config };
  }

  const testKey = "naver:test:connection";
  const cached = await kv.get(testKey, "json");
  if (cached?.finished && cached?.ok) return { ...cached, cached: true };

  const now = new Date();
  const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const requestBody = {
    startDate: isoDate(start),
    endDate: isoDate(end),
    timeUnit: "date",
    keywordGroups: [
      { groupName: "네이버", keywords: ["네이버"] },
      { groupName: "유튜브", keywords: ["유튜브"] }
    ]
  };

  const result = await callNaverSearchTrend(env, requestBody);
  const stored = {
    finished: true,
    tested_at: new Date().toISOString(),
    ok: result.ok,
    status: result.status,
    http_status: result.http_status,
    usage: result.usage ?? null,
    config,
    response_summary: result.ok
      ? {
          startDate: result.data?.startDate ?? null,
          endDate: result.data?.endDate ?? null,
          timeUnit: result.data?.timeUnit ?? null,
          result_count: Array.isArray(result.data?.results) ? result.data.results.length : 0
        }
      : result.data ?? result.error ?? null
  };

  if (result.ok) await kv.put(testKey, JSON.stringify(stored));
  else await kv.delete(testKey);
  return stored;
}

export async function fetchNaverTrends(env) {
  return readNaverSnapshot(env);
}
