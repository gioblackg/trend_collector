// 검색 트렌드 순위 정책의 단일 설정 지점.
// 가중치, RRF 파라미터, 후보/검증 역할, 출력 키를 여기서만 바꾼다.
export const RANKING_CONFIG = Object.freeze({
  version: "1.0",
  method: "weighted_rrf",
  params: Object.freeze({
    k: 10,
    normalize_to_100: true
  }),
  sources: Object.freeze({
    naver: Object.freeze({
      weight: 0.45,
      role: "validator",
      output_key: "naver"
    }),
    google_trends: Object.freeze({
      weight: 0.40,
      role: "candidate",
      output_key: "google"
    }),
    namuwiki: Object.freeze({
      weight: 0.15,
      role: "candidate",
      output_key: "namuwiki"
    })
  }),
  tie_break_order: Object.freeze(["naver", "google_trends", "namuwiki"]),
  candidate_limit: 20,
  note: "Google Trends/나무위키가 후보를 발견하고 NAVER는 후보 검증 순위로 참여"
});

export function getRankingMetadata() {
  const weights = {};
  const roles = {};

  for (const [sourceId, sourceConfig] of Object.entries(RANKING_CONFIG.sources)) {
    const outputKey = sourceConfig.output_key ?? sourceId;
    weights[outputKey] = sourceConfig.weight;
    roles[outputKey] = sourceConfig.role;
  }

  return {
    method: RANKING_CONFIG.method,
    version: RANKING_CONFIG.version,
    k: RANKING_CONFIG.params.k,
    weights,
    roles,
    candidate_limit: RANKING_CONFIG.candidate_limit,
    overlap_bonus: 0,
    note: RANKING_CONFIG.note
  };
}
