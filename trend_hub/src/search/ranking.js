import { RANKING_CONFIG, getRankingMetadata } from "./ranking_config.js";
import { weightedRrfStrategy } from "./strategies/weighted_rrf.js";

const STRATEGIES = Object.freeze({
  weighted_rrf: weightedRrfStrategy
});

// 기존 호출부와의 호환용 export. 실제 값은 ranking_config.js에서 관리한다.
export const RRF_K = RANKING_CONFIG.params.k;
export const RRF_WEIGHTS = Object.freeze(
  Object.fromEntries(
    Object.entries(RANKING_CONFIG.sources).map(([sourceId, sourceConfig]) => [
      sourceConfig.output_key ?? sourceId,
      sourceConfig.weight
    ])
  )
);

export { getRankingMetadata };

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

function sourceMap(sources) {
  const map = new Map();
  for (const source of sources) {
    const sourceId = String(source?.source ?? "").trim();
    if (sourceId) map.set(sourceId, source);
  }
  return map;
}

function candidateSources(allSources) {
  return allSources.filter((source) => RANKING_CONFIG.sources?.[source?.source]?.role === "candidate");
}

export function collectCandidateKeywords(...sources) {
  const map = new Map();

  for (const source of candidateSources(sources)) {
    for (const item of source?.items ?? []) {
      const keyword = String(item?.keyword ?? "").trim();
      const key = normalizeKeyword(keyword);
      if (!key || map.has(key)) continue;
      map.set(key, keyword);
    }
  }

  return [...map.values()].slice(0, RANKING_CONFIG.candidate_limit);
}

export function rankSearchCandidates(...sources) {
  const bySource = sourceMap(sources);
  const rankMaps = new Map();

  for (const sourceId of Object.keys(RANKING_CONFIG.sources)) {
    rankMaps.set(sourceId, sourceRankMap(bySource.get(sourceId)));
  }

  const displayKeywords = new Map();
  const candidateKeys = new Set();

  for (const source of candidateSources(sources)) {
    for (const item of source?.items ?? []) {
      const keyword = String(item?.keyword ?? "").trim();
      const key = normalizeKeyword(keyword);
      if (!key) continue;
      candidateKeys.add(key);
      if (!displayKeywords.has(key)) displayKeywords.set(key, keyword);
    }
  }

  const strategy = STRATEGIES[RANKING_CONFIG.method];
  if (!strategy) {
    throw new Error(`Unknown ranking strategy: ${RANKING_CONFIG.method}`);
  }

  return strategy({
    candidateKeys,
    displayKeywords,
    rankMaps,
    config: RANKING_CONFIG
  });
}
