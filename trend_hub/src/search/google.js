const GOOGLE_JSON_URL = "https://raw.githubusercontent.com/gioblackg/trend_collector/main/data/trends.json";

export async function fetchGoogleTrendData() {
  const response = await fetch(GOOGLE_JSON_URL, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Google trend JSON fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const search = data?.categories?.search ?? {};
  const source = search?.sources?.google_trends ?? {};

  return {
    source: "google_trends",
    status: source.status ?? "unknown",
    items: Array.isArray(source.items) ? source.items : [],
    generated_at: data?.generated_at ?? null
  };
}
