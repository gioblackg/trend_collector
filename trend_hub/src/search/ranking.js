export const RRF_K = 10;
export const RRF_WEIGHTS = Object.freeze({
  naver: 0.45,
  google: 0.40,
  namuwiki: 0.15
});

export function normalizeKeyword(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function validRank(value) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function weightedRrfContribution(weight, rank, k = RRF_K) {
  const r = validRank(rank);
  if (!r) return 0;
  return weight / (k + r);
}

function maxWeightedRrfScore(k = RRF_K) {
  const totalWeight = Object.values(RRF_WEIGHTS).reduce((sum, value) => sum + value, 0);
  return totalWeight / (k + 1);
}

function normalizedRrfScore(rawScore, k = RRF_K) {
  const maxScore = maxWeightedRrfScore(k);
  if (maxScore <= 0) return 0;
  return Math.max(0, Math.min(100, (rawScore / maxScore) * 100));
}

function sourceRankMap(source) {
  const result = new Map();
  for (const item of Array.isArray(source?.items) ? source.items : []) {
    const key = normalizeKeyword(item?.keyword);
    const rank = validRank(item?.rank);
    if (!key || !rank) continue;
    result.set(key, { rank, item });
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

export function rankSearchCandidates(google, namuwiki, naver) {
  const googleRanks = sourceRankMap(google);
  const namuRanks = sourceRankMap(namuwiki);
  const naverRanks = sourceRankMap(naver);

  const display = new Map();
  for (const source of [google, namuwiki]) {
    for (const item of source?.items ?? []) {
      const keyword = String(item?.keyword ?? "").trim();
      const key = normalizeKeyword(keyword);
      if (key && !display.has(key)) display.set(key, keyword);
    }
  }

  // NAVER는 후보 발견원이 아니다. Google/나무위키에서 발견된 후보만 최종 순위에 참여한다.
  const keys = new Set([...googleRanks.keys(), ...namuRanks.keys()]);
  const rows = [];

  for (const key of keys) {
    const g = googleRanks.get(key) ?? null;
    const n = naverRanks.get(key) ?? null;
    const w = namuRanks.get(key) ?? null;

    const googleContribution = weightedRrfContribution(RRF_WEIGHTS.google, g?.rank);
    const naverContribution = weightedRrfContribution(RRF_WEIGHTS.naver, n?.rank);
    const namuContribution = weightedRrfContribution(RRF_WEIGHTS.namuwiki, w?.rank);
    const rawScore = googleContribution + naverContribution + namuContribution;
    const score = normalizedRrfScore(rawScore);

    rows.push({
      keyword: display.get(key) ?? key,
      score: Number(score.toFixed(2)),
      rrf_score: Number(rawScore.toFixed(8)),
      source_count: [g, n, w].filter(Boolean).length,
      ranks: {
        google: g?.rank ?? null,
        naver: n?.rank ?? null,
        namuwiki: w?.rank ?? null
      },
      contributions: {
        google: Number(googleContribution.toFixed(8)),
        naver: Number(naverContribution.toFixed(8)),
        namuwiki: Number(namuContribution.toFixed(8))
      },
      details: {
        google: g?.item ?? null,
        naver: n?.item ?? null,
        namuwiki: w?.item ?? null
      }
    });
  }

  rows.sort((a, b) =>
    b.rrf_score - a.rrf_score ||
    b.source_count - a.source_count ||
    (a.ranks.naver ?? Number.MAX_SAFE_INTEGER) - (b.ranks.naver ?? Number.MAX_SAFE_INTEGER) ||
    (a.ranks.google ?? Number.MAX_SAFE_INTEGER) - (b.ranks.google ?? Number.MAX_SAFE_INTEGER) ||
    a.keyword.localeCompare(b.keyword, "ko")
  );

  return rows;
}
