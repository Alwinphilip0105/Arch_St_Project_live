import React, { useMemo, useState } from 'react';
import { scoreMatch } from '../confidenceEngine';
import { namedPersonsData } from '../namedPersonsData';

function countBy(arr, key) {
  return arr.reduce((acc, d) => {
    const v = d[key] || 'Unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

export default function ClusterAnalysis({
  clusterId,
  clusteredData,
  allData,
  onSelectBurial,
  onView3D,
  onOpenInMain,
  clusterPriors,
}) {
  const [view, setView] = useState('overview');
  const [activeBurial, setActiveBurial] = useState(null);
  const [coffinTab, setCoffinTab] = useState('record');

  const clusterBurials = useMemo(() => {
    if (clusterId === null) return [];
    if (clusterId === -1) {
      return clusteredData
        .filter((d) => d.isNoise)
        .map((d) => allData.find((b) => b.g === d.g))
        .filter(Boolean)
        .sort((a, b) => a.depth - b.depth);
    }
    return clusteredData
      .filter((d) => d.clusterId === clusterId)
      .map((d) => allData.find((b) => b.g === d.g))
      .filter(Boolean)
      .sort((a, b) => a.depth - b.depth);
  }, [clusterId, clusteredData, allData]);

  const currentCoffinIndex = clusterBurials.findIndex((b) => b.g === activeBurial?.g);

  function navigateCoffin(direction) {
    const nextIndex = currentCoffinIndex + direction;
    if (nextIndex < 0 || nextIndex >= clusterBurials.length) return;
    const nextBurial = clusterBurials[nextIndex];
    setActiveBurial(nextBurial);
    setCoffinTab('record');
    onSelectBurial?.(nextBurial);
  }

  const clusterColor =
    clusteredData.find((d) => d.clusterId === clusterId)?.clusterColor || '#c9940a';
  const panelColor = clusterId === -1 ? '#666666' : clusterColor;

  const n = clusterBurials.length;
  const stats = {
    total: n,
    avgDepth: n ? (clusterBurials.reduce((a, b) => a + b.depth, 0) / n).toFixed(1) : '—',
    sex: countBy(clusterBurials, 'sex'),
    age: countBy(clusterBurials, 'age'),
    withArtifacts: clusterBurials.filter((b) => b.artifactType).length,
    namedPersons: clusterBurials.filter((b) => b.nameId).length,
    preservation: countBy(clusterBurials, 'preservation'),
    nMin: n ? Math.min(...clusterBurials.map((b) => b.n)).toFixed(1) : '—',
    nMax: n ? Math.max(...clusterBurials.map((b) => b.n)).toFixed(1) : '—',
    eMin: n ? Math.min(...clusterBurials.map((b) => b.e)).toFixed(1) : '—',
    eMax: n ? Math.max(...clusterBurials.map((b) => b.e)).toFixed(1) : '—',
    depthMin: n ? Math.min(...clusterBurials.map((b) => b.depth)).toFixed(1) : '—',
    depthMax: n ? Math.max(...clusterBurials.map((b) => b.depth)).toFixed(1) : '—',
  };

  const titleLabel = clusterId === -1 ? 'Outliers' : `Cluster ${clusterId + 1}`;

  if (clusterId === null) {
    return (
      <div className="cluster-empty">
        <div className="cluster-empty-msg">
          <span className="detail-icon">⬡</span>
          <p>
            Choose a cluster in the list on the left to see its analysis.
            <br />
            Use <strong>View in 3D</strong> on an open cluster to highlight it in the scatter plot.
          </p>
        </div>
      </div>
    );
  }

  if (view === 'coffin' && activeBurial) {
    return (
      <div className="cluster-analysis cluster-coffin-view">
        <div className="ccv-cluster-chip">
          <span className="ccv-cluster-chip-dot" style={{ background: panelColor }} />
          {clusterId === -1 ? 'Outlier cluster context' : `Cluster ${clusterId + 1} context`}
        </div>
        <div className="ccv-breadcrumb">
          <button
            type="button"
            className="ccv-back"
            onClick={() => {
              setView('overview');
              setActiveBurial(null);
            }}
          >
            ← {clusterId === -1 ? 'Outliers' : `Cluster ${clusterId + 1}`}
          </button>
          <span className="ccv-sep">›</span>
          <span className="ccv-current">{activeBurial.g}</span>

          <div className="ccv-nav">
            <button
              type="button"
              className="ccv-nav-btn"
              onClick={() => navigateCoffin(-1)}
              disabled={currentCoffinIndex === 0}
            >
              ‹ Prev
            </button>
            <span className="ccv-nav-pos">
              {currentCoffinIndex + 1} / {clusterBurials.length}
            </span>
            <button
              type="button"
              className="ccv-nav-btn"
              onClick={() => navigateCoffin(1)}
              disabled={currentCoffinIndex === clusterBurials.length - 1}
            >
              Next ›
            </button>
          </div>
        </div>

        <div className="ccv-tabs">
          <button
            type="button"
            className={`ccv-tab ${coffinTab === 'record' ? 'active' : ''}`}
            onClick={() => setCoffinTab('record')}
          >
            Record
          </button>
          <button
            type="button"
            className={`ccv-tab ${coffinTab === 'idmatches' ? 'active' : ''}`}
            onClick={() => setCoffinTab('idmatches')}
          >
            ID Matches
          </button>
          <button
            type="button"
            className="ccv-tab ccv-open-main"
            onClick={() => onOpenInMain?.(activeBurial)}
            title="Open in main view"
          >
            ↗ Main View
          </button>
        </div>

        <div className="ccv-content">
          {coffinTab === 'record' && <CoffinRecord burial={activeBurial} />}
          {coffinTab === 'idmatches' && (
            <CoffinIDMatches
              burial={activeBurial}
              clusteredData={clusteredData}
              clusterPriors={clusterPriors}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cluster-analysis">
      <div
        className="cluster-header cluster-header-with-actions"
        style={{ borderLeft: `4px solid ${panelColor}` }}
      >
        <div className="cluster-header-main">
          <div className="cluster-title">
            {titleLabel}
            <span className="cluster-size">{stats.total} burials</span>
          </div>
          <div className="cluster-coords">
            N: {stats.nMin}–{stats.nMax} ft · E: {stats.eMin}–{stats.eMax} ft · Depth:{' '}
            {stats.depthMin}–{stats.depthMax} ft
          </div>
        </div>
        <div className="cluster-header-actions">
          <button
            type="button"
            className="view-cluster-3d-btn"
            onClick={() => onView3D?.(clusterId)}
          >
            ◉ View in 3D
          </button>
        </div>
      </div>

      <div className="cluster-stats-grid">
        <div className="cluster-stat-card">
          <div className="cstat-val">{stats.total}</div>
          <div className="cstat-lbl">Burials</div>
        </div>
        <div className="cluster-stat-card">
          <div className="cstat-val">{stats.avgDepth} ft</div>
          <div className="cstat-lbl">Avg Depth</div>
        </div>
        <div className="cluster-stat-card">
          <div className="cstat-val">{stats.namedPersons}</div>
          <div className="cstat-lbl">Named</div>
        </div>
        <div className="cluster-stat-card">
          <div className="cstat-val">{stats.withArtifacts}</div>
          <div className="cstat-lbl">Artifacts</div>
        </div>
      </div>

      <div className="cluster-section">
        <h4 className="cluster-section-title">Sex</h4>
        {Object.entries(stats.sex).map(([k, v]) => (
          <div key={k} className="cluster-bar-row">
            <span className="cbar-label">{k}</span>
            <div className="cbar-track">
              <div
                className="cbar-fill"
                style={{
                  width: `${stats.total ? (v / stats.total) * 100 : 0}%`,
                  background: clusterColor,
                }}
              />
            </div>
            <span className="cbar-count">{v}</span>
          </div>
        ))}
      </div>

      <div className="cluster-section">
        <h4 className="cluster-section-title">Age</h4>
        {Object.entries(stats.age).map(([k, v]) => (
          <div key={k} className="cluster-bar-row">
            <span className="cbar-label">{k}</span>
            <div className="cbar-track">
              <div
                className="cbar-fill"
                style={{
                  width: `${stats.total ? (v / stats.total) * 100 : 0}%`,
                  background: clusterColor,
                }}
              />
            </div>
            <span className="cbar-count">{v}</span>
          </div>
        ))}
      </div>

      <div className="cluster-section">
        <h4 className="cluster-section-title">Preservation</h4>
        {Object.entries(stats.preservation).map(([k, v]) => (
          <div key={k} className="cluster-bar-row">
            <span className="cbar-label">{k}</span>
            <div className="cbar-track">
              <div
                className="cbar-fill"
                style={{
                  width: `${stats.total ? (v / stats.total) * 100 : 0}%`,
                  background: clusterColor,
                }}
              />
            </div>
            <span className="cbar-count">{v}</span>
          </div>
        ))}
      </div>

      <div className="cluster-section">
        <h4 className="cluster-section-title">All Burials in Cluster</h4>
        <div className="cluster-burial-list">
          {clusterBurials
            .map((burial) => (
              <div
                key={burial.g}
                className={`cluster-burial-row ${
                  activeBurial?.g === burial.g && view === 'coffin' ? 'active' : ''
                }`}
                style={{ borderLeft: `3px solid ${panelColor}` }}
                onClick={() => {
                  setActiveBurial(burial);
                  setView('coffin');
                  setCoffinTab('record');
                  onSelectBurial?.(burial);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveBurial(burial);
                    setView('coffin');
                    setCoffinTab('record');
                    onSelectBurial?.(burial);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="cbrow-dot" style={{ background: panelColor }} />
                <span className="cbrow-g">{burial.g}</span>
                <span className="cbrow-info">
                  {burial.sex} · {burial.age}
                  {burial.ageCat ? ` (${burial.ageCat})` : ''}
                </span>
                <span className="cbrow-depth">{burial.depth} ft</span>
                {burial.nameId && (
                  <span className="cbrow-name">{burial.nameId}</span>
                )}
                <span className="cbrow-arrow">→</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function CoffinRecord({ burial }) {
  const sections = [
    {
      title: 'Location',
      rows: [
        ['G-Number', burial.g],
        ['North', `${burial.n} ft`],
        ['East', `${burial.e} ft`],
        ['Depth', `${burial.depth} ft`],
      ],
    },
    {
      title: 'Biological Profile',
      rows: [
        ['Age', burial.age],
        ['Age Category', burial.ageCat || '—'],
        ['Age Range', burial.ageRange || '—'],
        ['Sex', burial.sex],
        ['Sexing Method', burial.sexMethod || '—'],
        ['Ancestry', burial.ancestry],
      ],
    },
    {
      title: 'Preservation',
      rows: [
        ['Preservation', burial.preservation],
        ['Soft Tissue', burial.softTissue || '—'],
      ],
    },
    {
      title: 'Coffin',
      rows: [
        ['Coffin Preservation', burial.coffinPreservation || '—'],
        ['Shape', burial.coffinShape || '—'],
        ['Lid Type', burial.lidType || '—'],
        ['Length (cm)', burial.coffinLength || '—'],
        ['Width (cm)', burial.coffinWidth || '—'],
        ['Handles', burial.coffinHandles || '—'],
        ['Handle Style', burial.handleStyle || '—'],
        ['Plates', burial.coffinPlates || '—'],
        ['Lid Tacks', burial.lidTacks || '—'],
      ],
    },
    {
      title: 'Material Culture',
      rows: [
        ['Artifact Type', burial.artifactType || '—'],
        ['Material', burial.materialType || '—'],
        ['Description', burial.description || '—'],
      ],
    },
    {
      title: 'Historical',
      rows: [
        ['Name ID', burial.nameId || '—'],
        ['Date of Death', burial.dateOfDeath || '—'],
      ],
    },
  ];

  return (
    <div className="ccv-record">
      {sections.map((section) => (
        <div key={section.title} className="ccv-section">
          <div className="ccv-section-title">{section.title}</div>
          {section.rows.map(([label, value]) => (
            <div key={label} className="ccv-row">
              <span className="ccv-label">{label}</span>
              <span className={`ccv-value ${!value || value === '—' ? 'dim' : ''}`}>
                {value || '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CoffinIDMatches({ burial, clusteredData, clusterPriors }) {
  const matches = useMemo(() => {
    if (!burial) return [];
    const clusterId = clusteredData?.find((c) => c.g === burial.g)?.clusterId;
    const prior = clusterPriors?.[clusterId] || null;
    return scoreMatch(burial, namedPersonsData, prior);
  }, [burial, clusteredData, clusterPriors]);

  const clusterInfo = clusteredData?.find((c) => c.g === burial?.g);

  if (!matches.length) {
    return (
      <div className="ccv-no-matches">
        <p>No significant identity matches found</p>
        <p className="ccv-no-matches-sub">
          Limited biological data available for {burial?.g}
        </p>
      </div>
    );
  }

  return (
    <div className="ccv-idmatches">
      {clusterInfo && !clusterInfo.isNoise && (
        <div className="ccv-cluster-context">
          <span className="ccc-dot" style={{ background: clusterInfo.clusterColor }} />
          Cluster {clusterInfo.clusterId + 1} family prior applied
        </div>
      )}

      <div className="ccv-match-summary">
        <span className="cms-total">{matches.length} candidates</span>
        <span className="cms-high">
          {matches.filter((m) => m.confidence === 'High').length} High
        </span>
        <span className="cms-mod">
          {matches.filter((m) => m.confidence === 'Moderate').length} Moderate
        </span>
      </div>

      {matches.map((match, i) => (
        <div key={i} className={`ccv-match-card ${match.confidence.toLowerCase()}`}>
          <div className="ccv-match-header">
            <span className="ccv-match-name">{match.person.nameId}</span>
            <span className={`ccv-match-badge ${match.confidence.toLowerCase()}`}>
              {match.confidence}
            </span>
          </div>

          {match.person.dateOfDeath && (
            <div className="ccv-match-date">
              d. {match.person.dateOfDeath}
              {match.person.sex && match.person.sex !== 'Unknown'
                ? ` · ${match.person.sex}` : ''}
              {match.person.ageAtDeath ? ` · Age ${match.person.ageAtDeath}` : ''}
            </div>
          )}

          <div className="ccv-score-row">
            <div className="ccv-score-track">
              <div
                className="ccv-score-fill"
                style={{
                  width: `${match.score}%`,
                  background: match.score >= 80 ? '#c9940a'
                    : match.score >= 55 ? '#a89870' : '#5a5040',
                }}
              />
            </div>
            <span className="ccv-score-num">{match.score}</span>
          </div>

          <div className="ccv-feats">
            {match.matchedFeatures?.map((f, j) => (
              <span key={`${match.person.nameId}-m-${j}`} className="ccv-feat matched">
                ✓ {f.replace(/\s*\([^)]+\)/, '').trim()}
              </span>
            ))}
            {match.unmatchedFeatures?.map((f, j) => (
              <span key={`${match.person.nameId}-u-${j}`} className="ccv-feat unmatched">
                ✗ {f.replace(/\s*\([^)]+\)/, '').trim()}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
