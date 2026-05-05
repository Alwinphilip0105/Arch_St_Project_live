/**
 * DBSCAN for Arch Street burials. Plan-view (E/N) clustering matches the
 * team notebook; depth is for visualization only in the 3D view.
 */

let lastClusterEpsilonUsed = null;

export function getLastClusterEpsilon() {
  return lastClusterEpsilonUsed;
}

/**
 * 2D plane distance on East (x) and North (z); same units as field notes (ft).
 * @param {Array<{x:number,z:number}>} coords
 * @param {number} epsilon
 * @param {number} minPts
 * @returns {number[]} label per point: 0..k-1 or -1 noise
 */
function runDBSCAN2D(coords, epsilon, minPts) {
  const n = coords.length;
  if (n === 0) return [];

  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array(n).fill(UNVISITED);
  let clusterId = 0;

  const points = coords.map((c) => ({ x: c.x, y: 0, z: c.z }));

  function dist(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function regionQuery(pointIdx) {
    const neighbors = [];
    for (let i = 0; i < n; i++) {
      if (dist(points[pointIdx], points[i]) <= epsilon) neighbors.push(i);
    }
    return neighbors;
  }

  function expandCluster(pointIdx, neighbors, cId) {
    labels[pointIdx] = cId;
    const seeds = neighbors.slice();
    for (let s = 0; s < seeds.length; s++) {
      const q = seeds[s];
      if (labels[q] === NOISE) {
        labels[q] = cId;
      }
      if (labels[q] !== UNVISITED) continue;
      labels[q] = cId;
      const nbrs = regionQuery(q);
      if (nbrs.length >= minPts) {
        for (const p of nbrs) {
          if (!seeds.includes(p)) seeds.push(p);
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = NOISE;
    } else {
      expandCluster(i, neighbors, clusterId);
      clusterId++;
    }
  }

  return labels;
}

/**
 * Sweeps eps (0.2–20, step 0.2) like the Colab notebook; picks eps whose
 * cluster count is closest to the middle of [targetMin, targetMax].
 */
export function findOptimalEpsilon(burials, targetMin = 50, targetMax = 100) {
  const coords = burials.map((b) => ({ x: b.e, z: b.n }));
  const targetMid = (targetMin + targetMax) / 2;
  const results = [];

  for (let step = 1; step <= 100; step++) {
    const eps = Math.round(step * 0.2 * 10) / 10;
    const labels = runDBSCAN2D(coords, eps, 2);
    const clusterIds = new Set(labels.filter((l) => l !== -1));
    const nClusters = clusterIds.size;
    const nNoise = labels.filter((l) => l === -1).length;

    let score;
    if (nClusters >= targetMin && nClusters <= targetMax) {
      score = Math.abs(nClusters - targetMid);
    } else {
      score = Math.abs(nClusters - targetMid) + 1000;
    }

    results.push({ eps, nClusters, nNoise, score });
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.eps - b.eps;
  });

  const best = results[0];
  // eslint-disable-next-line no-console
  console.info(
    `DBSCAN eps sweep complete. Best eps=${best.eps} → ` +
      `${best.nClusters} clusters, ${best.nNoise} noise points`
  );
  return best.eps;
}

const CLUSTER_COLORS = [
  '#e63946',
  '#2a9d8f',
  '#e9c46a',
  '#6baed6',
  '#f4a261',
  '#a8dadc',
  '#8338ec',
  '#fb5607',
  '#3a86ff',
  '#06d6a0',
  '#ffbe0b',
  '#ff006e',
  '#8ecae6',
  '#219ebc',
  '#023047',
  '#ffb703',
  '#cb4b16',
  '#268bd2',
  '#2aa198',
  '#859900',
  '#dc322f',
  '#6c71c4',
  '#d33682',
  '#b58900',
  '#657b83',
  '#839496',
  '#93a1a1',
  '#fdf6e3',
  '#eee8d5',
  '#e74c3c',
  '#9b59b6',
  '#3498db',
  '#1abc9c',
  '#f39c12',
  '#d35400',
  '#27ae60',
  '#2980b9',
  '#8e44ad',
  '#c0392b',
  '#16a085',
  '#f1c40f',
  '#e67e22',
  '#2c3e50',
  '#7f8c8d',
  '#ff6b6b',
  '#feca57',
  '#48dbfb',
  '#ff9ff3',
  '#54a0ff',
];

/**
 * Cluster burials on the **E/N plane only** (notebook-aligned).
 * Pass `epsilon = null` to auto-select eps targeting ~50–100 clusters.
 *
 * @param {Array<object>} burials
 * @param {number|null} [epsilon=null]
 * @param {number} [minPts=2]
 */
export function clusterBurials(burials, epsilon = null, minPts = 2) {
  if (!burials?.length) {
    lastClusterEpsilonUsed = null;
    return [];
  }

  const eps = epsilon ?? findOptimalEpsilon(burials, 50, 100);
  lastClusterEpsilonUsed = eps;

  const coords = burials.map((b) => ({ x: b.e, z: b.n }));
  const labels = runDBSCAN2D(coords, eps, minPts);

  const clusterCount = new Set(labels.filter((l) => l !== -1)).size;
  // eslint-disable-next-line no-console
  console.info(`Clustered ${burials.length} burials → ${clusterCount} clusters`);

  return burials.map((b, i) => ({
    ...b,
    clusterId: labels[i],
    clusterColor:
      labels[i] === -1 ? '#555555' : CLUSTER_COLORS[labels[i] % CLUSTER_COLORS.length],
    isNoise: labels[i] === -1,
  }));
}

/**
 * Legacy 3D DBSCAN on (E, depth, N). Kept for tests or callers that need depth in distance.
 * @param {Array<{x:number,y:number,z:number,index?:number}>} points
 */
export function dbscan(points, epsilon, minPts) {
  const n = points.length;
  if (n === 0) return { labels: [], clusterCount: 0 };

  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array(n).fill(UNVISITED);
  let clusterId = 0;

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = (a.y - b.y) * 0.5;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function regionQuery(pointIdx) {
    const neighbors = [];
    for (let i = 0; i < n; i++) {
      if (dist(points[pointIdx], points[i]) <= epsilon) neighbors.push(i);
    }
    return neighbors;
  }

  function expandCluster(pointIdx, neighbors, cId) {
    labels[pointIdx] = cId;
    const seeds = neighbors.slice();
    for (let s = 0; s < seeds.length; s++) {
      const q = seeds[s];
      if (labels[q] === NOISE) {
        labels[q] = cId;
      }
      if (labels[q] !== UNVISITED) continue;
      labels[q] = cId;
      const nbrs = regionQuery(q);
      if (nbrs.length >= minPts) {
        for (const p of nbrs) {
          if (!seeds.includes(p)) seeds.push(p);
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = NOISE;
    } else {
      expandCluster(i, neighbors, clusterId);
      clusterId++;
    }
  }

  return { labels, clusterCount: clusterId };
}
