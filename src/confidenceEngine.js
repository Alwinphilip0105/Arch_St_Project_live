/**
 * Bayesian identity matching — ported from Team 2 notebook
 * `AICampus_Social_Project (2).ipynb`: Step 3 `age_range_to_years` / `parse_master_year`,
 * Step 4 `sex_weight`, `cause_rarity_weight`, `score_candidate`, `run_matcher`.
 *
 * Complements spatial DBSCAN in `utils/dbscan.js` (family cluster priors).
 * Feature constants: `config/bayesianWeights.js`.
 */

import { BAYESIAN_WEIGHTS as W } from "./config/bayesianWeights";
import { namedPersons as confirmedRemainsCatalog } from "./namedPersons";

// ─── Helpers (Cell 69) ───────────────────────────────────────────────────────

export function safeStr(x) {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

export function safeInt(x) {
  if (x === null || x === undefined) return null;
  const n = parseInt(String(x), 10);
  return Number.isNaN(n) ? null : n;
}

export function normalizeName(name) {
  return safeStr(name)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isInitialsOnly(name) {
  return /^([A-Za-z]\.)+[A-Za-z]?\.?$/.test(safeStr(name).trim());
}

export function isAmbiguousLabel(name) {
  const n = safeStr(name).toLowerCase();
  return n.includes(" or ") || n.includes("?") || n.includes("/");
}

function initialsMatch(expectedName, predName) {
  const exp = normalizeName(expectedName).replace(/\s/g, "");
  const predTokens = normalizeName(predName).split(" ");
  const predInitials = predTokens.map((t) => t[0] || "").join("");
  return exp === predInitials;
}

export function nameMatchesExpected(expectedName, predName) {
  const exp = normalizeName(expectedName);
  const pred = normalizeName(predName);
  if (!exp || !pred) return false;
  if (exp === pred || exp.includes(pred) || pred.includes(exp)) return true;
  if (isInitialsOnly(expectedName)) return initialsMatch(expectedName, predName);
  return false;
}

// ─── Year (notebook: parse_master_year) ───────────────────────────────────────

export function parseBurialYear(dateOfDeath) {
  if (!dateOfDeath) return null;
  const s = String(dateOfDeath).trim();
  const m = s.match(/\b(1[6789]\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  if (/^1[6789]\d{2}$/.test(s)) return parseInt(s, 10);
  return null;
}

// ─── Age ranges (notebook Step 3: age_range_to_years + Subadult fix) ─────────

const AGE_CATEGORY_ORDER = [
  ["Young Adult", [18, 35]],
  ["Middle Adult", [35, 50]],
  ["Old Adult", [50, 99]],
  ["Subadult", [3, 19]],
  ["Infant", [0, 2]],
  ["Child", [3, 11]],
  ["Adolescent", [12, 19]],
  ["Adult", [18, 99]],
];

export function parseAgeRange(ageRange, ageCategory) {
  if (ageRange && ageRange.trim()) {
    const m = ageRange.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const m2 = ageRange.match(/(\d+)\+/);
    if (m2) return [parseInt(m2[1], 10), 99];
  }
  if (ageCategory) {
    const ac = ageCategory.toLowerCase();
    for (const [cat, bounds] of AGE_CATEGORY_ORDER) {
      if (ac.includes(cat.toLowerCase())) {
        return bounds;
      }
    }
  }
  return [null, null];
}

function candidateCauseRaw(person) {
  return person.causeClean ?? person.cause ?? person.causeOfDeath ?? person.causeofdeath ?? "";
}

function burialCauseRaw(burial) {
  return burial.cause ?? burial.causeClean ?? burial.causeOfDeath ?? "";
}

// ─── Sex counts / weights (notebook Cell 74) ───────────────────────────────────

function buildSexCounts(candidates) {
  const counts = { Male: 0, Female: 0, Unknown: 0 };
  candidates.forEach((p) => {
    const s = safeStr(p.sex);
    if (s === "Male") counts.Male++;
    else if (s === "Female") counts.Female++;
    else counts.Unknown++;
  });
  return counts;
}

function sexWeight(sexVal, sexCounts, totalNamed) {
  const s = safeStr(sexVal).toLowerCase();
  if (!s || ["unknown", "n/a", "", "nan"].includes(s)) return 0;
  const key = s.startsWith("m") ? "Male" : s.startsWith("f") ? "Female" : null;
  if (!key) return 0;
  const count = sexCounts[key] || 1;
  const denom = Math.max(totalNamed || 0, 1);
  return Math.max(1.0, Math.log(denom / count));
}

// ─── Cause rarity (notebook Cell 74: cause_rarity_weight) ───────────────────

function normalizeCauseLookupKey(causeStr) {
  const c = safeStr(causeStr).toLowerCase().trim();
  if (!c || c === "nan") return "";
  return c;
}

function buildCauseCounts(candidates) {
  const counts = {};
  for (const p of candidates) {
    const key = normalizeCauseLookupKey(candidateCauseRaw(p));
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function causeRarityWeight(causeStr, totalNamed, causeCounts) {
  const c = normalizeCauseLookupKey(causeStr);
  if (!c) return 0;
  const count = causeCounts[c] ?? 1;
  const denom = Math.max(totalNamed || 0, 1);
  const rarity = Math.log(denom / count);
  return Math.min(W.causeWeightMax, Math.max(W.causeWeightMin, rarity));
}

// ─── score_candidate (notebook Cell 74) ──────────────────────────────────────

function scoreCandidate(
  burial,
  candidate,
  sexCounts,
  totalNamed,
  causeCounts,
  familyPrior = null
) {
  let score = 0.0;
  const matchedFeatures = [];
  const unmatchedFeatures = [];
  let yearDiff = null;
  let familyPriorBoost = 0;

  const bsex = safeStr(burial.sex).toLowerCase();
  const csex = safeStr(candidate.sex).toLowerCase();
  const sexUnknown = ["unknown", "n/a", "", "nan"];

  if (bsex && !sexUnknown.includes(bsex) && csex && !sexUnknown.includes(csex)) {
    if (bsex[0] === csex[0]) {
      const w = sexWeight(burial.sex, sexCounts, totalNamed);
      score += w;
      matchedFeatures.push(`Sex (${w.toFixed(1)})`);
    } else {
      score += W.sexMismatch;
      unmatchedFeatures.push("Sex");
    }
  }

  const burialYear = burial.deathYear != null ? safeInt(burial.deathYear) : parseBurialYear(burial.dateOfDeath);
  const candidateYear = candidate.yearOfDeath
    ? safeInt(candidate.yearOfDeath)
    : parseBurialYear(candidate.dateOfDeath);

  if (burialYear !== null && candidateYear !== null) {
    const diff = Math.abs(burialYear - candidateYear);
    yearDiff = diff;
    if (diff === 0) {
      score += W.yearExact;
      matchedFeatures.push(`Year exact (${W.yearExact})`);
    } else if (diff <= 3) {
      score += W.yearWithin3;
      matchedFeatures.push(`Year ±${diff} (${W.yearWithin3})`);
    } else if (diff <= 8) {
      score += W.yearWithin8;
      matchedFeatures.push(`Year ±${diff} (${W.yearWithin8})`);
    } else {
      score += W.yearFarPenalty;
      unmatchedFeatures.push(`Year off by ${diff}`);
    }
  }

  const ageLo = burial.ageLo != null ? Number(burial.ageLo) : null;
  const ageHi = burial.ageHi != null ? Number(burial.ageHi) : null;
  const [parsedLo, parsedHi] =
    ageLo != null && ageHi != null && !Number.isNaN(ageLo) && !Number.isNaN(ageHi)
      ? [ageLo, ageHi]
      : parseAgeRange(burial.ageRange, burial.ageCat || burial.age);
  const candAge = candidate.ageAtDeath != null ? parseFloat(candidate.ageAtDeath) : null;

  if (parsedLo !== null && parsedHi !== null && candAge !== null && !Number.isNaN(candAge)) {
    if (parsedLo <= candAge && candAge <= parsedHi) {
      score += W.ageFits;
      matchedFeatures.push(
        `Age fits (${candAge} in ${parsedLo}-${parsedHi}) (${W.ageFits})`
      );
    } else if (Math.abs(candAge - parsedLo) <= 5 || Math.abs(candAge - parsedHi) <= 5) {
      score += W.ageClose;
      matchedFeatures.push(`Age close (${W.ageClose})`);
    } else {
      score += W.ageMiss;
      unmatchedFeatures.push(`Age ${candAge} outside ${parsedLo}-${parsedHi}`);
    }
  }

  const burialCause = safeStr(burialCauseRaw(burial)).toLowerCase();
  const candidateCause = safeStr(candidateCauseRaw(candidate)).toLowerCase();
  if (burialCause && candidateCause) {
    if (burialCause.includes(candidateCause) || candidateCause.includes(burialCause)) {
      const cw = causeRarityWeight(candidateCause, totalNamed, causeCounts);
      if (cw > 0) {
        score += cw;
        matchedFeatures.push(`Cause: ${candidateCause} (${cw.toFixed(1)})`);
      }
    }
  }

  const burialAnc = safeStr(burial.ancestry).toLowerCase();
  const candidateRace = safeStr(candidate.ancestry).toLowerCase();
  if (burialAnc && candidateRace) {
    if (burialAnc.includes("european") && !candidateRace.includes("af")) {
      score += W.ancestryEuropean;
      matchedFeatures.push(`Ancestry consistent (${W.ancestryEuropean})`);
    } else if (burialAnc.includes("african") && candidateRace.includes("af")) {
      score += W.ancestryAfrican;
      matchedFeatures.push(`Ancestry: African match (${W.ancestryAfrican})`);
    }
  }

  if (familyPrior && Object.keys(familyPrior).length > 0) {
    const last = safeStr(candidate.nameId).split(" ").slice(-1)[0];
    const fullKey = normalizeName(candidate.nameId);
    const lastKey = normalizeName(last);

    const priorBoost =
      (familyPrior[fullKey] || 0) * W.familyPriorFullNameMult +
      (familyPrior[lastKey] || 0) * W.familyPriorSurnameMult;

    if (priorBoost > 0) {
      score += priorBoost;
      familyPriorBoost = priorBoost;
      matchedFeatures.push(`Family cluster boost (${priorBoost.toFixed(1)})`);
    }
  }

  return { score, matchedFeatures, unmatchedFeatures, yearDiff, familyPriorBoost };
}

// ─── run_matcher (notebook Cell 74) ──────────────────────────────────────────

function runMatcher(burial, candidates, topN = 10, familyPrior = null) {
  const sexCounts = buildSexCounts(candidates);
  const causeCounts = buildCauseCounts(candidates);
  const totalNamed = candidates.length;

  const scored = candidates.map((candidate, idx) => {
    const { score, matchedFeatures, unmatchedFeatures, yearDiff, familyPriorBoost } = scoreCandidate(
      burial,
      candidate,
      sexCounts,
      totalNamed,
      causeCounts,
      familyPrior
    );
    return { candidate, score, matchedFeatures, unmatchedFeatures, yearDiff, familyPriorBoost, idx };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aYear = a.yearDiff ?? Number.POSITIVE_INFINITY;
    const bYear = b.yearDiff ?? Number.POSITIVE_INFINITY;
    if (aYear !== bYear) return aYear - bYear;
    if (b.familyPriorBoost !== a.familyPriorBoost) return b.familyPriorBoost - a.familyPriorBoost;
    return a.idx - b.idx;
  });
  const top = scored.slice(0, topN);
  const maxPossible = W.scoreScaleMax > 0 ? W.scoreScaleMax : 12.0;

  return top
    .map(({ candidate, score, matchedFeatures, unmatchedFeatures }) => {
      const modelFitScore = Number(Math.min(99, Math.max(0, (score / maxPossible) * 100)).toFixed(1));
      const familyPriorUsed = matchedFeatures.some((f) => {
        const s = f.toLowerCase();
        return s.includes("family cluster boost") || s.includes("family cluster prior");
      });

      const topMatches = matchedFeatures
        .slice(0, 3)
        .map((f) => f.replace(/\s*\([^)]+\)/, "").trim());

      const explanation =
        topMatches.length === 0
          ? "No significant matching features found"
          : topMatches.length === 1
            ? `Matches on ${topMatches[0]}`
            : `Matches on ${topMatches.slice(0, -1).join(", ")} and ${topMatches.at(-1)}`;

      return {
        person: candidate,
        rawScore: score,
        score: modelFitScore,
        confidenceScore: modelFitScore,
        confidence: "Bayesian",
        explanation,
        matchedFeatures,
        unmatchedFeatures,
        comparableFields: matchedFeatures.length + unmatchedFeatures.length,
        familyPriorUsed,
        method: "bayesian",
      };
    })
    .filter(Boolean);
}

/**
 * Documented 100% confirmed remains: `namedPersons.js` (NamedBurials / team list).
 * Placename-style rows like "Unknown Individual (G-131)" do not reserve a register name.
 */
function isCatalogClaimName(nameId) {
  const n = safeStr(nameId).toLowerCase();
  if (!n) return false;
  return !n.startsWith("unknown individual");
}

/**
 * @returns {Map<string, string>} normalized register name → G-number (confirmed list only)
 */
export function buildConfirmedRemainsClaimMap() {
  const map = new Map();
  for (const row of confirmedRemainsCatalog) {
    if (!isCatalogClaimName(row.nameId)) continue;
    const key = normalizeName(row.nameId);
    if (!key) continue;
    map.set(key, row.gNumber);
  }
  return map;
}

function findConfirmedCatalogRow(burial) {
  const g = safeStr(burial?.g);
  const nid = safeStr(burial?.nameId);
  if (!g || !nid) return null;
  for (const row of confirmedRemainsCatalog) {
    if (row.gNumber !== g) continue;
    if (normalizeName(row.nameId) === normalizeName(nid)) return row;
    if (nameMatchesExpected(row.nameId, nid) || nameMatchesExpected(nid, row.nameId)) return row;
  }
  return null;
}

function filterNamedPersonsForBurial(namedPersons, burialG, claimMap) {
  if (!claimMap || claimMap.size === 0) return namedPersons;
  return namedPersons.filter((p) => {
    const key = normalizeName(p.nameId || "");
    if (!key) return true;
    const ownerG = claimMap.get(key);
    if (!ownerG) return true;
    return ownerG === burialG;
  });
}

function findNamedPersonForNameId(nameId, namedPersonsFull) {
  const target = normalizeName(nameId);
  if (!target) return null;
  for (const p of namedPersonsFull) {
    if (normalizeName(p.nameId || "") === target) return p;
  }
  for (const p of namedPersonsFull) {
    if (nameMatchesExpected(nameId, p.nameId)) return p;
  }
  return null;
}

function stripSamePersonRows(ranked, person) {
  const key = normalizeName(person.nameId || "");
  if (!key) return ranked;
  return ranked.filter((r) => normalizeName(r.person?.nameId || "") !== key);
}

/**
 * When the master sheet already has Name ID set, treat that register individual as confirmed
 * for this burial only: score 100 and remove duplicate rows for the same person.
 * Only applies when this G-number + Name ID match the curated confirmed list (`namedPersons.js`).
 */
function applyConfirmedNameIdRow(burial, ranked, namedPersonsFull) {
  const catalog = findConfirmedCatalogRow(burial);
  if (!catalog) return ranked;
  const person = findNamedPersonForNameId(catalog.nameId, namedPersonsFull);
  if (!person) return ranked;

  const rest = stripSamePersonRows(ranked, person);
  const maxRaw = W.scoreScaleMax > 0 ? W.scoreScaleMax : 12;
  const confirmedRow = {
    person,
    rawScore: maxRaw,
    score: 100,
    confidenceScore: 100,
    confidence: "Confirmed",
    explanation: "Documented confirmed named burial (team confirmed list).",
    matchedFeatures: ["Confirmed assignment (Named Burials list)"],
    unmatchedFeatures: [],
    comparableFields: Math.max(6, ranked[0]?.comparableFields ?? 0),
    familyPriorUsed: false,
    method: "confirmed",
    isConfirmedAssignment: true,
  };
  return [confirmedRow, ...rest];
}

/**
 * @param {object} unknown - burial row (may include clusterId from DBSCAN)
 * @param {Array} namedPersons - candidate named persons array
 * @param {Record<number|string, Record<string, number>>|null} clusterPriors - optional family surname priors by cluster id
 */
export function scoreMatch(unknown, namedPersons, clusterPriors = null) {
  if (!unknown || !namedPersons?.length) return [];

  const familyPrior = clusterPriors ? clusterPriors[unknown.clusterId] || null : null;
  const claimMap = buildConfirmedRemainsClaimMap();
  const candidates = filterNamedPersonsForBurial(namedPersons, unknown.g, claimMap);

  const ranked = runMatcher(unknown, candidates, 10, familyPrior);
  return applyConfirmedNameIdRow(unknown, ranked, namedPersons);
}
