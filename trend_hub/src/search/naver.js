const NAVER_API_URL = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";

// NAVER 콘솔의 하드 한도는 사용자가 30,000회로 설정.
// 프로그램 내부에서는 여유를 두고 29,000회에서 먼저 차단한다.
export const NAVER_CONSOLE_MONTHLY_CAP = 30000;
export const NAVER_INTERNAL_MONTHLY_CAP = 29000;
export const NAVER_MAX_CALLS_PER_REFRESH = 5;

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

  if (!clientId || !clientSecret) {
    return emptySnapshot("not_configured");
  }

  if (!kv) {
    return emptySnapshot("state_not_configured", "TREND_STATE KV binding required");
  }

  const cached = await kv.get("naver:latest", "json");
  if (!cached) {
    return emptySnapshot("cache_empty");
  }

  return cached;
}

export async function storeNaverSnapshot(env, snapshot) {
  const kv = env?.TREND_STATE;
  if (!kv) return false;
  await kv.put("naver:latest", JSON.stringify(snapshot));
  return true;
}

// 실제 NAVER 호출은 반드시 이 함수를 통해서만 수행한다.
// 호출 전에 내부 월간 카운트를 먼저 1 증가시켜 실패/재시도 상황에서도 보수적으로 계산한다.
export async function callNaverSearchTrend(env, requestBody) {
  const clientId = env?.NAVER_CLIENT_ID;
  const clientSecret = env?.NAVER_CLIENT_SECRET;
  const kv = env?.TREND_STATE;

  if (!clientId || !clientSecret) {
    return { ok: false, status: "not_configured", http_status: null, data: null };
  }

  if (!kv) {
    return { ok: false, status: "state_not_configured", http_status: null, data: null };
  }

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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 2000) };
    }

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

// 이전 코드와의 호환용. 공개 페이지 요청에서는 NAVER를 직접 호출하지 않고 캐시만 읽는다.
export async function fetchNaverTrends(env) {
  return readNaverSnapshot(env);
}
