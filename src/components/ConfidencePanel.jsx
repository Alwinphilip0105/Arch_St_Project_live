import React, { useMemo, useState } from "react";
import { scoreMatch } from "../confidenceEngine";
import { namedPersons } from "../namedPersons";
import { NAMED_COUNT } from "../namedPersonsData";
import "./ConfidencePanel.css";

const CONFIDENCE_COLORS = {
  High: "#c9940a",
  Moderate: "#a89870",
  Low: "#5a5040",
};

const COMPARE_TOOLTIP =
  "Scores use Bayesian feature matching: sex rarity weights, year proximity scoring, age range fitting, ancestry matching, and family cluster surname priors from DBSCAN spatial grouping. Mismatches are penalized. Based on RUC AI Campus Team 2 notebook.";

function toInitials(name) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .join(".");
}

function MatchCard({ burial, match, isOpen, onToggle }) {
  const color = CONFIDENCE_COLORS[match.confidence] || "var(--text-dim)";
  const badgeClass = (match.confidence || "").toLowerCase();
  const hasDateOfDeath = Boolean((match.person.dateOfDeath || "").trim());

  const handleCopy = async () => {
    const shortName = toInitials(match.person.nameId || "Unknown");
    const contrib = match.matchedFeatures?.slice(0, 4).join("; ") || "—";
    const summary = `${burial.g} → ${shortName} (${match.score}/100 ${match.confidence}, raw ${match.rawScore.toFixed(2)}) — ${contrib}`;

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
          <span className={`confidence-badge ${badgeClass}`}>{match.confidence}</span>
          <button className="confidence-copy-btn" onClick={handleCopy} type="button">
            Copy
          </button>
        </div>
      </div>

      <div className="confidence-progress-wrap">
        <div className="confidence-progress-track">
          <div
            className="confidence-progress-fill"
            style={{ width: `${match.score}%`, backgroundColor: color }}
          />
        </div>
        <div className="confidence-score score-fraction">
          {match.score} / 100
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

      <p className="confidence-explanation">{match.explanation}</p>

      <button className="confidence-toggle" onClick={onToggle} type="button">
        {isOpen ? "Hide scoring details" : "Show scoring details"}
      </button>

      {isOpen && (
        <div className="confidence-table-wrap bayesian-detail">
          {(match.matchedFeatures?.length ?? 0) > 0 && (
            <div className="bayesian-section">
              <div className="bayesian-section-title">Contributions</div>
              {match.matchedFeatures.map((line, i) => (
                <div className="bayesian-line matched" key={`mf-${i}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
          {(match.unmatchedFeatures?.length ?? 0) > 0 && (
            <div className="bayesian-section">
              <div className="bayesian-section-title">Penalties / mismatches</div>
              {match.unmatchedFeatures.map((line, i) => (
                <div className="bayesian-line unmatched" key={`uf-${i}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
          {(match.matchedFeatures?.length ?? 0) === 0 &&
            (match.unmatchedFeatures?.length ?? 0) === 0 && (
              <div className="bayesian-section">
                <div className="bayesian-line muted">No comparable features for this pair.</div>
              </div>
            )}
          <div className="field-row total-row bayesian-total">
            <span className="field-name">Totals</span>
            <span className="field-values totals-text">
              Normalized <strong>{match.score}</strong>/100 · Bayesian raw{" "}
              <strong>{match.rawScore.toFixed(2)}</strong>
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

export default function ConfidencePanel({ burial, clusterPriors = null, onClose }) {
  const [openCards, setOpenCards] = useState({});
  const [confidenceFilter, setConfidenceFilter] = useState("All");
  const [sortMode, setSortMode] = useState("score");

  const matches = useMemo(() => {
    if (!burial) return [];
    return scoreMatch(burial, namedPersons, clusterPriors);
  }, [burial, clusterPriors]);

  const missingFields = useMemo(() => {
    if (!burial) return [];
    const missing = [];
    if (!burial?.sex || burial.sex === "Unknown") missing.push("Sex determination");
    if (!burial?.ageCat || burial.ageCat === "") missing.push("Age subcategory");
    if (!burial?.ancestry || burial.ancestry === "Unknown") missing.push("Ancestry");
    if (!burial?.dateOfDeath) missing.push("Date of death");
    return missing;
  }, [burial]);

  const countsByConfidence = useMemo(() => {
    const count = { All: matches.length, High: 0, Moderate: 0, Low: 0 };
    matches.forEach((m) => {
      count[m.confidence] += 1;
    });
    return count;
  }, [matches]);

  const displayedMatches = useMemo(() => {
    const filtered =
      confidenceFilter === "All"
        ? [...matches]
        : matches.filter((m) => m.confidence === confidenceFilter);

    if (sortMode === "name") {
      filtered.sort((a, b) =>
        (a.person.nameId || "").localeCompare(b.person.nameId || "", undefined, { sensitivity: "base" })
      );
    } else {
      filtered.sort((a, b) => b.score - a.score || b.rawScore - a.rawScore);
    }

    return filtered;
  }, [matches, confidenceFilter, sortMode]);

  const bandedItems = useMemo(() => {
    const grouped = {};
    displayedMatches.forEach((m) => {
      const band = Math.round(m.score / 5) * 5;
      if (!grouped[band]) grouped[band] = [];
      grouped[band].push(m);
    });
    const bands = Object.keys(grouped)
      .map(Number)
      .sort((a, b) => b - a);
    const items = [];
    bands.forEach((band) => {
      const arr = grouped[band];
      if (arr.length >= 2) {
        items.push({ kind: "header", band, count: arr.length });
      }
      arr.forEach((match, i) => {
        items.push({
          kind: "card",
          match,
          key: `${match.person.nameId}-${band}-${i}`,
        });
      });
    });
    return items;
  }, [displayedMatches]);

  const toggleCard = (key) => {
    setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
          <div className="confidence-method-badge" title={COMPARE_TOOLTIP}>
            Bayesian + DBSCAN Family Clustering
          </div>
        </div>
        <button className="confidence-close" onClick={onClose} type="button">
          ✕
        </button>
      </div>

      <div className="confidence-compare-bar" title={COMPARE_TOOLTIP}>
        Compared against {NAMED_COUNT} known individuals
      </div>

      <div className="confidence-controls">
        <div className="confidence-filter-row">
          {["All", "High", "Moderate", "Low"].map((level) => (
            <button
              key={level}
              className={`confidence-filter-btn${confidenceFilter === level ? " active" : ""}`}
              onClick={() => setConfidenceFilter(level)}
              type="button"
            >
              {level}
              <span className="confidence-filter-count">{countsByConfidence[level] ?? 0}</span>
            </button>
          ))}
        </div>
        <button
          className="confidence-sort-toggle"
          onClick={() => setSortMode((prev) => (prev === "score" ? "name" : "score"))}
          type="button"
        >
          {sortMode === "score" ? "Score ↓" : "Name A–Z"}
        </button>
      </div>

      <div className="confidence-list">
        {displayedMatches.length === 0 ? (
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
        ) : (
          bandedItems.map((item) =>
            item.kind === "header" ? (
              <div key={`band-h-${item.band}`} className="score-band-header">
                Score ~{item.band}/100 · {item.count} individuals
              </div>
            ) : (
              <MatchCard
                burial={burial}
                key={item.key}
                match={item.match}
                isOpen={Boolean(openCards[item.key])}
                onToggle={() => toggleCard(item.key)}
              />
            )
          )
        )}
      </div>
    </aside>
  );
}
