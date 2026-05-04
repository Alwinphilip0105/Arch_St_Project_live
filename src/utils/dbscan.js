/**
 * Spatial DBSCAN (burial proximity in E / depth / N feet).
 *
 * Complements identity matching in `confidenceEngine.js`: scoring answers
 * “which named person could this burial be?”; clustering answers
 * “which burials lie near each other in the ground?” (plots, rows, zones).
 *
 * DBSCAN clustering for burial spatial data (3D: East, depth, North).
 * @param {Array<{x:number,y:number,z:number,index?:number}>} points
 * @param {number} epsilon neighborhood radius (real ft, same units as coordinates)
 * @param {number} minPts minimum neighbors (including self) to form a cluster core
 * @returns {{ labels: number[], clusterCount: number }} labels[i] is cluster id (0-based) or -1 for noise
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
];

/**
 * Run DBSCAN on burial rows (uses e, depth, n in feet).
 * @param {Array<object>} burials
 * @param {number} [epsilon=8]
 * @param {number} [minPts=3]
 */
export function clusterBurials(burials, epsilon = 8, minPts = 3) {
  const points = burials.map((b, i) => ({
    x: b.e,
    y: b.depth,
    z: b.n,
    index: i,
  }));

  const { labels, clusterCount } = dbscan(points, epsilon, minPts);

  return burials.map((b, i) => ({
    ...b,
    clusterId: labels[i],
    clusterColor:
      labels[i] === -1 ? '#666666' : CLUSTER_COLORS[labels[i] % CLUSTER_COLORS.length],
    isNoise: labels[i] === -1,
    clusterCount,
  }));
}
