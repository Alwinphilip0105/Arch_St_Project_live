/**
 * Bayesian identity matching (ported from RUC AI Campus Team 2 notebook, cells 69–77).
 * Complements spatial DBSCAN in `utils/dbscan.js` (family cluster priors).
 */

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

// ─── Year (Cell 73) ──────────────────────────────────────────────────────────

export function parseBurialYear(dateOfDeath) {
  if (!dateOfDeath) return null;
  const s = String(dateOfDeath).trim();
  const m = s.match(/\b(1[6789]\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  if (/^1[6789]\d{2}$/.test(s)) return parseInt(s, 10);
  return null;
}

// ─── Age ranges (Cell 73) ───────────────────────────────────────────────────

const AGE_CATEGORY_MAP = {
  Infant: [0, 2],
  Child: [3, 11],
  Adolescent: [12, 19],
  "Young Adult": [18, 35],
  "Middle Adult": [35, 50],
  "Old Adult": [50, 99],
  Adult: [18, 99],
};

export function parseAgeRange(ageRange, ageCategory) {
  if (ageRange && ageRange.trim()) {
    const m = ageRange.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const m2 = ageRange.match(/(\d+)\+/);
    if (m2) return [parseInt(m2[1], 10), 99];
  }
  if (ageCategory) {
    for (const [cat, bounds] of Object.entries(AGE_CATEGORY_MAP)) {
      if (ageCategory.toLowerCase().includes(cat.toLowerCase())) {
        return bounds;
      }
    }
  }
  return [null, null];
}

// ─── Sex rarity weights (Cell 74) ────────────────────────────────────────────

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
  if (!s || ["unknown", "n/a", ""].includes(s)) return 0;
  const key = s.startsWith("m") ? "Male" : s.startsWith("f") ? "Female" : null;
  if (!key) return 0;
  const count = sexCounts[key] || 1;
  const denom = Math.max(totalNamed || 0, 1);
  return Math.max(1.0, Math.log(denom / count));
}

// ─── score_candidate (Cell 74) ───────────────────────────────────────────────

function scoreCandidate(burial, candidate, sexCounts, totalNamed, familyPrior = null) {
  let score = 0.0;
  const matchedFeatures = [];
  const unmatchedFeatures = [];
  let yearDiff = null;
  let familyPriorBoost = 0;

  const bsex = safeStr(burial.sex).toLowerCase();
  const csex = safeStr(candidate.sex).toLowerCase();
  const sexUnknown = ["unknown", "n/a", ""];

  if (bsex && !sexUnknown.includes(bsex) && csex && !sexUnknown.includes(csex)) {
    if (bsex[0] === csex[0]) {
      const w = sexWeight(burial.sex, sexCounts, totalNamed);
      score += w;
      matchedFeatures.push(`Sex (${w.toFixed(1)})`);
    } else {
      score -= 1.5;
      unmatchedFeatures.push("Sex");
    }
  }

  const burialYear = parseBurialYear(burial.dateOfDeath);
  const candidateYear = candidate.yearOfDeath
    ? safeInt(candidate.yearOfDeath)
    : parseBurialYear(candidate.dateOfDeath);

  if (burialYear !== null && candidateYear !== null) {
    const diff = Math.abs(burialYear - candidateYear);
    yearDiff = diff;
    if (diff === 0) {
      score += 3.5;
      matchedFeatures.push("Year exact (+3.5)");
    } else if (diff <= 3) {
      score += 2.0;
      matchedFeatures.push(`Year ±${diff} (+2.0)`);
    } else if (diff <= 8) {
      score += 0.8;
      matchedFeatures.push(`Year ±${diff} (+0.8)`);
    } else {
      score -= 1.0;
      unmatchedFeatures.push(`Year off by ${diff}`);
    }
  }

  const [ageLo, ageHi] = parseAgeRange(burial.ageRange, burial.ageCat || burial.age);
  const candAge = candidate.ageAtDeath != null ? parseFloat(candidate.ageAtDeath) : null;

  if (ageLo !== null && ageHi !== null && candAge !== null && !Number.isNaN(candAge)) {
    if (ageLo <= candAge && candAge <= ageHi) {
      score += 1.8;
      matchedFeatures.push(`Age fits (${candAge} in ${ageLo}-${ageHi}) (+1.8)`);
    } else if (Math.abs(candAge - ageLo) <= 5 || Math.abs(candAge - ageHi) <= 5) {
      score += 0.5;
      matchedFeatures.push("Age close (+0.5)");
    } else {
      score -= 0.8;
      unmatchedFeatures.push(`Age ${candAge} outside ${ageLo}-${ageHi}`);
    }
  }

  const burialAnc = safeStr(burial.ancestry).toLowerCase();
  const candidateRace = safeStr(candidate.ancestry).toLowerCase();
  if (burialAnc && candidateRace) {
    // Notebook logic: only award positive ancestry consistency (no penalty branch).
    if (burialAnc.includes("european") && !candidateRace.includes("af")) {
      score += 0.5;
      matchedFeatures.push("Ancestry consistent (+0.5)");
    } else if (burialAnc.includes("african") && candidateRace.includes("af")) {
      score += 1.5;
      matchedFeatures.push("Ancestry: African match (+1.5)");
    }
  }

  if (familyPrior && Object.keys(familyPrior).length > 0) {
    const last = safeStr(candidate.nameId).split(" ").slice(-1)[0];
    const fullKey = normalizeName(candidate.nameId);
    const lastKey = normalizeName(last);

    const priorBoost =
      (familyPrior[fullKey] || 0) * 1.2 + (familyPrior[lastKey] || 0) * 0.6;

    if (priorBoost > 0) {
      score += priorBoost;
      familyPriorBoost = priorBoost;
      matchedFeatures.push(`Family cluster prior (+${priorBoost.toFixed(1)})`);
    }
  }

  return { score, matchedFeatures, unmatchedFeatures, yearDiff, familyPriorBoost };
}

// ─── run_matcher (Cell 75) ───────────────────────────────────────────────────

function runMatcher(burial, candidates, topN = 10, familyPrior = null) {
  const sexCounts = buildSexCounts(candidates);
  const totalNamed = candidates.length;

  const scored = candidates.map((candidate, idx) => {
    const { score, matchedFeatures, unmatchedFeatures, yearDiff, familyPriorBoost } = scoreCandidate(
      burial,
      candidate,
      sexCounts,
      totalNamed,
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
  const maxPossible = 12.0;
  const bestRawScore = top[0]?.score ?? 0;

  return top
    .map(({ candidate, score, matchedFeatures, unmatchedFeatures }) => {
      // Notebook-aligned Bayesian confidence scaling (absolute).
      const bayesianScore = Number(Math.min(99, Math.max(0, (score / maxPossible) * 100)).toFixed(1));
      // Display score scaled to full 0-100 within this burial's candidate set.
      const scaledScore =
        bestRawScore > 0 ? Number(Math.max(0, (score / bestRawScore) * 100).toFixed(1)) : 0;
      const familyPriorUsed = matchedFeatures.some((f) =>
        f.toLowerCase().includes("family cluster prior")
      );

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
        score: scaledScore,
        confidenceScore: bayesianScore,
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
 * @param {object} unknown - burial row (may include clusterId from DBSCAN)
 * @param {Array} namedPersons - candidate named persons array
 * @param {Record<number|string, Record<string, number>>|null} clusterPriors - optional family surname priors by cluster id
 */
export function scoreMatch(unknown, namedPersons, clusterPriors = null) {
  if (!unknown || !namedPersons?.length) return [];

  const familyPrior = clusterPriors ? clusterPriors[unknown.clusterId] || null : null;

  return runMatcher(unknown, namedPersons, 10, familyPrior);
}
