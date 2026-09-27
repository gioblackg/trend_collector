const NAMU_RANKING_URL = "https://search.namu.wiki/api/ranking";

export async function fetchNamuWikiTrends() {
  try {
    const response = await fetch(NAMU_RANKING_URL, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://namu.wiki/"
      }
    });

    if (!response.ok) {
      return {
        source: "namuwiki",
        status: "error",
        items: [],
        error: `HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const items = Array.isArray(data)
      ? data
          .filter((v) => typeof v === "string" && v.trim())
          .slice(0, 10)
          .map((keyword, index) => ({ keyword: keyword.trim(), rank: index + 1 }))
      : [];

    return {
      source: "namuwiki",
      status: items.length ? "ok" : "error",
      items,
      error: items.length ? null : "empty_or_unexpected_response"
    };
  } catch (error) {
    return {
      source: "namuwiki",
      status: "error",
      items: [],
      error: String(error?.message ?? error)
    };
  }
}
