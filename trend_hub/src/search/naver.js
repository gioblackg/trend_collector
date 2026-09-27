export async function fetchNaverTrends(env) {
  const clientId = env?.NAVER_CLIENT_ID;
  const clientSecret = env?.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      source: "naver",
      status: "not_configured",
      items: [],
      error: null
    };
  }

  return {
    source: "naver",
    status: "pending_implementation",
    items: [],
    error: null
  };
}
