function validRank(value) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function contribution(weight, rank, k) {
  const r = validRank(rank);
  if (!r) return 0;
  return weight / (k + r);
}

function maximumScore(config) {
  const k = Number(config?.params?.k) || 10;
  const totalWeight = Object.values(config?.sources ?? {}).reduce(
    (sum, source) => sum + (Number(source?.weight) || 0),
    0
  );
  return totalWeight / (k + 1);
}

function normalizeScore(rawScore, config) {
  if (!config?.params?.normalize_to_100) return rawScore;
  const maxScore = maximumScore(config);
  if (maxScore <= 0) return 0;
  return Math.max(0, Math.min(100, (rawScore / maxScore) * 100));
}

export function weightedRrfStrategy({ candidateKeys, displayKeywords, rankMaps, config }) {
  const k = Number(config?.params?.k) || 10;
  const rows = [];

  for (const key of candidateKeys) {
    const ranks = {};
    const contributions = {};
    const details = {};
    let rawScore = 0;
    let sourceCount = 0;

    for (const [sourceId, sourceConfig] of Object.entries(config?.sources ?? {})) {
      const outputKey = sourceConfig?.output_key ?? sourceId;
      const sourceRow = rankMaps.get(sourceId)?.get(key) ?? null;
      const rank = sourceRow?.rank ?? null;
      const part = contribution(sourceConfig?.weight, rank, k);

      ranks[outputKey] = rank;
      contributions[outputKey] = Number(part.toFixed(8));
      details[outputKey] = sourceRow?.item ?? null;

      if (rank) sourceCount += 1;
      rawScore += part;
    }

    rows.push({
      keyword: displayKeywords.get(key) ?? key,
      score: Number(normalizeScore(rawScore, config).toFixed(2)),
      rrf_score: Number(rawScore.toFixed(8)),
      source_count: sourceCount,
      ranks,
      contributions,
      details
    });
  }

  const tieBreakOrder = Array.isArray(config?.tie_break_order) ? config.tie_break_order : [];

  rows.sort((a, b) => {
    if (b.rrf_score !== a.rrf_score) return b.rrf_score - a.rrf_score;
    if (b.source_count !== a.source_count) return b.source_count - a.source_count;

    for (const sourceId of tieBreakOrder) {
      const outputKey = config?.sources?.[sourceId]?.output_key ?? sourceId;
      const aRank = a.ranks?.[outputKey] ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.ranks?.[outputKey] ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
    }

    return a.keyword.localeCompare(b.keyword, "ko");
  });

  return rows;
}
