import React, { useEffect, useMemo, useState } from "react";
import { scoreMatch } from "../confidenceEngine";
import { namedPersonsData, NAMED_COUNT } from "../namedPersonsData";
import "./ConfidencePanel.css";

const CONFIDENCE_COLORS = {
  Bayesian: "#c9940a",
  Confirmed: "#2a9d8f",
};

/** Row highlight: sex bonus in scorer only, not unrelated "sex" substrings. */
function matchedSexBonus(m) {
  return m.matchedFeatures?.some((f) => (f || "").toLowerCase().startsWith("sex (")) ?? false;
}

/** Row highlight: numeric age band overlap only (not other strings containing "age"). */
function matchedAgeBandBonus(m) {
  return (
    m.matchedFeatures?.some((f) => {
      const s = (f || "").toLowerCase();
      return s.startsWith("age fits") || s.startsWith("age close");
    }) ?? false
  );
}

function scoreBarTone(score) {
  if (score >= 50) return "#c9940a";
  if (score >= 30) return "#a89870";
  return "#5a5040";
}

function toInitials(name) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .join(".");
}

function MatchCard({ burial, match }) {
  const color = CONFIDENCE_COLORS[match.confidence] || "var(--text-dim)";
  const hasDateOfDeath = Boolean((match.person.dateOfDeath || "").trim());

  const handleCopy = async () => {
    const shortName = toInitials(match.person.nameId || "Unknown");
    const contrib = match.matchedFeatures?.slice(0, 4).join("; ") || "—";
    const summary = match.isConfirmedAssignment
      ? `${burial.g} → ${shortName} (100/100 confirmed Name ID, raw ${match.rawScore.toFixed(2)}) — ${contrib}`
      : `${burial.g} → ${shortName} (${match.score}/100 model fit, ${match.confidence}, raw ${match.rawScore.toFixed(2)}) — ${contrib}`;

    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = summary;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const nCompared = match.comparableFields ?? 0;

  return (
    <article className="confidence-card">
      <div className="confidence-card-top">
        <div>
          <h3 className="confidence-person-name person-name">{match.person.nameId || "Unknown"}</h3>
          {hasDateOfDeath && (
            <div className="confidence-dod">Date of Death: {match.person.dateOfDeath}</div>
          )}
        </div>
        <div className="confidence-card-actions">
          <span className="confidence-badge">{match.confidence}</span>
          <button className="confidence-copy-btn" onClick={handleCopy} type="button">
            Copy
          </button>
        </div>
      </div>

      <div className="confidence-progress-wrap">
        <div className="confidence-progress-track">
          <div
            className="confidence-progress-fill"
            style={{ width: `${Math.min(100, match.score)}%`, backgroundColor: color }}
          />
        </div>
        <div className="confidence-score score-fraction">
          {match.score} / 100{" "}
          <span className="score-fit-label">
            {match.isConfirmedAssignment ? "Name ID" : "model fit"}
          </span>
          <span className="raw-score">raw: {match.rawScore.toFixed(2)}</span>
        </div>
      </div>

      {nCompared <= 1 ? (
        <div className="data-quality">
          <span className="dq-warn">⚠ Only 1 criterion compared — score unreliable</span>
        </div>
      ) : (
        <div className="data-quality">
          <span className="dq-label">Compared criteria:</span>
          <span className="dq-dots">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`dq-dot ${i <= nCompared ? "filled" : ""}`} />
            ))}
          </span>
          <span className="dq-count">{nCompared}/5</span>
        </div>
      )}

    </article>
  );
}

function ComparisonTable({ burial, matches }) {
  if (!matches?.length) return null;

  const rows = [
    {
      label: "Confidence",
      key: "confidence",
      burial: "—",
      render: (m) => <span className="ct-badge">{m.confidence}</span>,
    },
    {
      label: "Model fit",
      key: "score",
      burial: "—",
      render: (m) => (
        <div className="ct-score-cell">
          <div className="ct-score-bar">
            <div
              className="ct-score-fill"
              style={{
                width: `${Math.min(100, m.score)}%`,
                background:
                  m.confidence === "Confirmed" ? CONFIDENCE_COLORS.Confirmed : scoreBarTone(m.score),
              }}
            />
          </div>
          <span className="ct-score-num">{m.score}</span>
        </div>
      ),
    },
    {
      label: "Date of Death",
      key: "dateOfDeath",
      burial: burial.dateOfDeath || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>
          {m.person.dateOfDeath || m.person.yearOfDeath || "—"}
        </span>
      ),
      isMatch: (m) => m.matchedFeatures?.some((f) => f.toLowerCase().includes("year")),
    },
    {
      label: "Sex",
      key: "sex",
      burial: burial.sex || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>{m.person.sex || "—"}</span>
      ),
      isMatch: matchedSexBonus,
    },
    {
      label: "Age at Death",
      key: "age",
      burial: burial.ageRange ? `${burial.age} (${burial.ageRange})` : burial.age || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>
          {m.person.ageAtDeath ? `Age ${m.person.ageAtDeath}` : m.person.ageRange || m.person.age || "—"}
        </span>
      ),
      isMatch: matchedAgeBandBonus,
    },
    {
      label: "Ancestry",
      key: "ancestry",
      burial: burial.ancestry || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>{m.person.ancestry || "—"}</span>
      ),
      isMatch: (m) => m.matchedFeatures?.some((f) => f.toLowerCase().includes("ancestry")),
    },
    {
      label: "Coffin Shape",
      key: "coffinShape",
      burial: burial.coffinShape || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>{m.person.coffinShape || "—"}</span>
      ),
      isMatch: (m) => m.matchedFeatures?.some((f) => f.toLowerCase().includes("coffin")),
    },
    {
      label: "Preservation",
      key: "preservation",
      burial: burial.preservation || "—",
      render: (m, matched) => (
        <span className={matched ? "ct-match" : "ct-nomatch"}>{m.person.preservation || "—"}</span>
      ),
      isMatch: (m) => m.matchedFeatures?.some((f) => f.toLowerCase().includes("preservation")),
    },
    {
      label: "Cluster Prior",
      key: "cluster",
      burial: "—",
      render: (m) => (
        <span className={m.familyPriorUsed ? "ct-match" : "ct-dim"}>
          {m.familyPriorUsed ? "✓ Applied" : "—"}
        </span>
      ),
      isMatch: (m) => m.familyPriorUsed,
    },
    {
      label: "Matched Fields",
      key: "matchedFields",
      burial: "—",
      render: (m) => (
        <span className="ct-feats">
          {m.matchedFeatures?.slice(0, 3).map((f, i) => (
            <span key={`${m.person.nameId}-mf-${i}`} className="ct-feat-chip">
              {f.replace(/\s*\([^)]+\)/, "").trim()}
            </span>
          ))}
        </span>
      ),
    },
    {
      label: "Penalties",
      key: "penalties",
      burial: "—",
      render: (m) => (
        <span className="ct-penalties">
          {m.unmatchedFeatures?.length > 0 ? (
            m.unmatchedFeatures.slice(0, 2).map((f, i) => (
              <span key={`${m.person.nameId}-uf-${i}`} className="ct-penalty-chip">
                {f.replace(/\s*\([^)]+\)/, "").trim()}
              </span>
            ))
          ) : (
            <span className="ct-dim">None</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="comparison-table-wrap">
      <div className="ct-burial-header">
        <div className="ct-burial-title">
          Burial {burial.g} - comparing against top {matches.length} candidates
        </div>
        <div className="ct-burial-chips">
          {burial.sex && burial.sex !== "Unknown" && <span className="ct-burial-chip">Sex: {burial.sex}</span>}
          {(burial.ageRange || burial.age) && (
            <span className="ct-burial-chip">Age: {burial.ageRange || burial.age}</span>
          )}
          {burial.ancestry && burial.ancestry !== "Unknown" && (
            <span className="ct-burial-chip">Ancestry: {burial.ancestry}</span>
          )}
          {burial.dateOfDeath && <span className="ct-burial-chip">d. {burial.dateOfDeath}</span>}
        </div>
      </div>

      <div className="ct-scroll-wrap">
        <table className="ct-table">
          <thead>
            <tr>
              <th className="ct-th ct-row-label-header">Criterion</th>
              <th className="ct-th ct-burial-col">
                <div className="ct-col-header burial">
                  <span className="ct-col-g">{burial.g}</span>
                  <span className="ct-col-sub">This Burial</span>
                </div>
              </th>
              {matches.map((m, i) => (
                <th key={`${m.person.nameId}-${i}`} className="ct-th ct-candidate-col">
                  <div className="ct-col-header">
                    <span className="ct-col-name">{m.person.nameId}</span>
                    <span className="ct-col-badge">{m.confidence}</span>
                    <span className="ct-col-score">{m.score}/100 fit</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="ct-tr">
                <td className="ct-td ct-row-label">{row.label}</td>
                <td className="ct-td ct-burial-val">
                  {["confidence", "score", "matchedFields", "penalties", "cluster"].includes(row.key) ? (
                    <span className="ct-dim">—</span>
                  ) : (
                    <span className="ct-burial-data">{row.burial || "—"}</span>
                  )}
                </td>
                {matches.map((m, i) => {
                  const matched = row.isMatch ? row.isMatch(m) : false;
                  return (
                    <td key={`${row.key}-${i}`} className={`ct-td ct-candidate-val ${matched ? "ct-row-matched" : ""}`}>
                      {row.render(m, matched)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ct-legend">
        <span className="ct-legend-item ct-legend-note">
          Score is model fit vs nominal weights (not probability of identity). Register names on
          the small confirmed-named list are excluded when already assigned to another G-number.
        </span>
        <span className="ct-legend-item">
          <span className="ct-match-dot" />
          Match with burial data
        </span>
        <span className="ct-legend-item">
          <span className="ct-nomatch-dot" />
          No match or mismatch
        </span>
      </div>
    </div>
  );
}

export default function ConfidencePanel({
  burial,
  clusterPriors = null,
  onClose,
  topN = null,
  showComparisonTable = false,
}) {
  const [sortMode, setSortMode] = useState("score");
  const [viewMode, setViewMode] = useState("cards");
  const [comparePopupOpen, setComparePopupOpen] = useState(false);

  const closeComparePopup = () => {
    setComparePopupOpen(false);
    setViewMode("cards");
  };

  const handlePanelClose = () => {
    // If user is in compare flow, close compare UI first without clearing selection.
    if (comparePopupOpen || viewMode === "table") {
      closeComparePopup();
      return;
    }
    onClose?.();
  };

  const matches = useMemo(() => {
    if (!burial) return [];
    return scoreMatch(burial, namedPersonsData, clusterPriors);
  }, [burial, clusterPriors]);

  const displayMatches = useMemo(() => {
    return topN ? matches.slice(0, topN) : matches;
  }, [matches, topN]);

  const compareMatches = useMemo(() => {
    return matches.slice(0, 5);
  }, [matches]);

  useEffect(() => {
    if (showComparisonTable) {
      setViewMode("table");
      setComparePopupOpen(true);
    } else {
      setViewMode("cards");
      setComparePopupOpen(false);
    }
  }, [showComparisonTable]);

  const missingFields = useMemo(() => {
    if (!burial) return [];
    const missing = [];
    if (!burial?.sex || burial.sex === "Unknown") missing.push("Sex determination");
    if (!burial?.ageCat || burial.ageCat === "") missing.push("Age subcategory");
    if (!burial?.ancestry || burial.ancestry === "Unknown") missing.push("Ancestry");
    if (!burial?.dateOfDeath) missing.push("Date of death");
    return missing;
  }, [burial]);

  const displayedMatches = useMemo(() => {
    const filtered = [...displayMatches];

    if (sortMode === "name") {
      filtered.sort((a, b) =>
        (a.person.nameId || "").localeCompare(b.person.nameId || "", undefined, { sensitivity: "base" })
      );
    } else {
      filtered.sort((a, b) => b.score - a.score || b.rawScore - a.rawScore);
    }

    return filtered;
  }, [displayMatches, sortMode]);

  if (!burial) {
    return (
      <aside className="confidence-panel confidence-empty">
        <p>Select a burial to view identity matches</p>
      </aside>
    );
  }

  return (
    <aside className="confidence-panel">
      <div className="confidence-header">
        <div>
          <div className="confidence-g">{burial.g} Identity Confidence Matches</div>
        </div>
        <button className="confidence-close" onClick={handlePanelClose} type="button">
          ✕
        </button>
      </div>

      <div className="confidence-compare-bar">
        Compared against {NAMED_COUNT} known individuals
      </div>

      <div className="confidence-controls">
        <button
          className="confidence-sort-toggle"
          onClick={() => setSortMode((prev) => (prev === "score" ? "name" : "score"))}
          type="button"
        >
          {sortMode === "score" ? "Score ↓" : "Name A–Z"}
        </button>
      </div>

      <div className="idm-view-toggle">
        <button
          className={`ivt-btn ${viewMode === "table" ? "active" : ""}`}
          onClick={() => {
            setViewMode("table");
            setComparePopupOpen(true);
          }}
          type="button"
        >
          ▦ Compare
        </button>
        <button
          className={`ivt-btn ${viewMode === "cards" ? "active" : ""}`}
          onClick={() => {
            setViewMode("cards");
            setComparePopupOpen(false);
          }}
          type="button"
        >
          ▤ Cards
        </button>
      </div>

      <div className={`confidence-list ${viewMode === "table" ? "table-mode" : ""}`}>
        {displayMatches.length === 0 ? (
          <div className="confidence-no-results">
            <p>No significant identity matches found for this burial.</p>
            <p>
              This may indicate the individual is not in the historical named persons list, or insufficient
              biological data was recorded to make a comparison.
            </p>
            {missingFields.length > 0 && (
              <p className="confidence-no-results-hint">
                Fields that would improve matching: {missingFields.join(", ")}
              </p>
            )}
          </div>
        ) : viewMode === "table" ? (
          <div className="compare-inline-note">Compare is open in popup view.</div>
        ) : (
          displayedMatches.map((match, i) => (
            <MatchCard
              burial={burial}
              key={`${match.person.nameId}-${i}`}
              match={match}
            />
          ))
        )}
      </div>

      {comparePopupOpen && compareMatches.length > 0 && (
        <div
          className="compare-popup-overlay"
          onClick={closeComparePopup}
          role="presentation"
        >
          <div
            className="compare-popup-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Candidate comparison table"
          >
            <div className="compare-popup-header">
              <h3>Comparison Matrix</h3>
              <button
                type="button"
                className="compare-popup-close"
                onClick={closeComparePopup}
              >
                ✕
              </button>
            </div>
            <ComparisonTable burial={burial} matches={compareMatches} />
          </div>
        </div>
      )}
    </aside>
  );
}
