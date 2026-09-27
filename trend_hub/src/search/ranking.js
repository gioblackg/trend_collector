export function normalizeKeyword(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function rankScore(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return clamp(110 - r * 10);
}

function googleFreshnessScore(publishedAt, now = new Date()) {
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return 50;
  const ageHours = Math.max(0, (now.getTime() - published.getTime()) / 3600000);
  return clamp(100 - (ageHours / 24) * 100);
}

function googleScores(items, now = new Date()) {
  const rows = Array.isArray(items) ? items : [];
  const maxValue = Math.max(0, ...rows.map((item) => Number(item?.value) || 0));
  const maxLog = maxValue > 0 ? Math.log1p(maxValue) : 0;
  const result = new Map();

  for (const item of rows) {
    const key = normalizeKeyword(item?.keyword);
    if (!key) continue;

    const value = Math.max(0, Number(item?.value) || 0);
    const volume = maxLog > 0 ? (Math.log1p(value) / maxLog) * 100 : 0;
    const freshness = googleFreshnessScore(item?.published_at, now);
    const rank = rankScore(item?.rank);
    const score = clamp(volume * 0.5 + freshness * 0.3 + rank * 0.2);

    result.set(key, {
      score,
      volume_score: clamp(volume),
      freshness_score: clamp(freshness),
      rank_score: clamp(rank),
      rank: item?.rank ?? null,
      value: item?.value ?? null,
      published_at: item?.published_at ?? null
    });
  }

  return result;
}

function namuScores(items) {
  const result = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeKeyword(item?.keyword);
    if (!key) continue;
    result.set(key, {
      score: rankScore(item?.rank),
      rank: item?.rank ?? null
    });
  }
  return result;
}

function naverScores(items) {
  const result = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeKeyword(item?.keyword);
    if (!key) continue;
    result.set(key, {
      score: clamp(item?.score),
      rank: item?.rank ?? null,
      relative_strength: item?.relative_strength ?? null,
      period: item?.period ?? null
    });
  }
  return result;
}

export function collectCandidateKeywords(google, namuwiki) {
  const map = new Map();
  for (const source of [google, namuwiki]) {
    for (const item of source?.items ?? []) {
      const keyword = String(item?.keyword ?? "").trim();
      const key = normalizeKeyword(keyword);
      if (!key || map.has(key)) continue;
      map.set(key, keyword);
    }
  }
  return [...map.values()].slice(0, 20);
}

export function rankSearchCandidates(google, namuwiki, naver, now = new Date()) {
  const g = googleScores(google?.items, now);
  const n = namuScores(namuwiki?.items);
  const v = naverScores(naver?.items);

  const display = new Map();
  for (const source of [google, namuwiki, naver]) {
    for (const item of source?.items ?? []) {
      const keyword = String(item?.keyword ?? "").trim();
      const key = normalizeKeyword(keyword);
      if (key && !display.has(key)) display.set(key, keyword);
    }
  }

  const keys = new Set([...g.keys(), ...n.keys(), ...v.keys()]);
  const rows = [];

  for (const key of keys) {
    const gs = g.get(key);
    const ns = n.get(key);
    const vs = v.get(key);
    const overlapBonus = gs && ns ? 5 : 0;
    const finalScore = clamp((gs?.score ?? 0) * 0.4 + (vs?.score ?? 0) * 0.4 + (ns?.score ?? 0) * 0.2 + overlapBonus);

    rows.push({
      keyword: display.get(key) ?? key,
      score: Number(finalScore.toFixed(2)),
      source_count: [gs, ns, vs].filter(Boolean).length,
      overlap_bonus: overlapBonus,
      scores: {
        google: gs ? Number(gs.score.toFixed(2)) : 0,
        naver: vs ? Number(vs.score.toFixed(2)) : 0,
        namuwiki: ns ? Number(ns.score.toFixed(2)) : 0
      },
      details: {
        google: gs ?? null,
        naver: vs ?? null,
        namuwiki: ns ?? null
      }
    });
  }

  rows.sort((a, b) =>
    b.score - a.score ||
    b.source_count - a.source_count ||
    b.scores.google - a.scores.google ||
    a.keyword.localeCompare(b.keyword, "ko")
  );

  return rows;
}
