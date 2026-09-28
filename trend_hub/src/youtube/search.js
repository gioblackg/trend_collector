const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

function cleanQuery(value) {
  return String(value ?? "").trim().slice(0, 100);
}

export async function searchYouTubeVideos(env, query, options = {}) {
  const q = cleanQuery(query);
  if (!q) {
    return {
      status: "error",
      error: "missing_query",
      query: "",
      items: []
    };
  }

  if (!env?.YOUTUBE_API_KEY) {
    return {
      status: "error",
      error: "youtube_api_key_missing",
      query: q,
      items: []
    };
  }

  const maxResults = Math.min(Math.max(Number(options.maxResults) || 12, 1), 25);
  const params = new URLSearchParams({
    part: "snippet",
    q,
    type: "video",
    maxResults: String(maxResults),
    regionCode: options.regionCode || "KR",
    relevanceLanguage: options.relevanceLanguage || "ko",
    safeSearch: options.safeSearch || "moderate",
    videoEmbeddable: "true",
    key: env.YOUTUBE_API_KEY
  });

  const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      status: "error",
      error: "youtube_api_error",
      http_status: response.status,
      query: q,
      detail: data?.error?.message ?? null,
      items: []
    };
  }

  const items = (data?.items ?? [])
    .filter((item) => item?.id?.videoId)
    .map((item) => {
      const videoId = item.id.videoId;
      const snippet = item.snippet ?? {};
      const thumbnail =
        snippet?.thumbnails?.high?.url ??
        snippet?.thumbnails?.medium?.url ??
        snippet?.thumbnails?.default?.url ??
        null;

      return {
        video_id: videoId,
        title: snippet.title ?? "",
        description: snippet.description ?? "",
        channel_id: snippet.channelId ?? null,
        channel_title: snippet.channelTitle ?? "",
        published_at: snippet.publishedAt ?? null,
        thumbnail,
        watch_url: `https://www.youtube.com/watch?v=${videoId}`,
        embed_url: `https://www.youtube.com/embed/${videoId}`
      };
    });

  return {
    schema_version: "1.0",
    source: "youtube_data_api",
    status: "ok",
    query: q,
    region_code: data?.regionCode ?? options.regionCode ?? "KR",
    result_count: items.length,
    next_page_token: data?.nextPageToken ?? null,
    items
  };
}
