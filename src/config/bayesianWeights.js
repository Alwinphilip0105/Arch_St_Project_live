/**
 * Bayesian identity feature weights — synced with Team 2 notebook
 * `AICampus_Social_Project (2).ipynb` (Step 4 BAYESIAN FEATURE WEIGHTS, `score_candidate` / `run_matcher`).
 *
 * Cause-of-death uses rarity `log(total/count)` clamped to causeWeightMin–causeWeightMax (see notebook `cause_rarity_weight`).
 */

export const BAYESIAN_WEIGHTS = {
  /** Sex mismatch when both sexes known (notebook: score -= 1.5) */
  sexMismatch: -1.5,

  /** Death year agreement */
  yearExact: 3.5,
  yearWithin3: 2.0,
  yearWithin8: 0.8,
  yearFarPenalty: -1.0,

  /** Candidate numeric age vs burial band (`parseAgeRange` / sheet age range) */
  ageFits: 1.8,
  ageClose: 0.5,
  ageMiss: -0.8,

  /** Ancestry bonuses only (no penalty branch in notebook) */
  ancestryEuropean: 0.5,
  ancestryAfrican: 1.5,

  /** Cause rarity weight = clamp(log(total/count), causeWeightMin, causeWeightMax) */
  causeWeightMin: 1.0,
  causeWeightMax: 5.0,

  /** Family prior multipliers on DBSCAN surname / full-name keys */
  familyPriorFullNameMult: 1.2,
  familyPriorSurnameMult: 0.6,

  /** Notebook `run_matcher`: confidence = score / max_possible * 100, max_possible = 12 */
  scoreScaleMax: 12.0,
};
