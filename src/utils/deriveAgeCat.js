/**
 * Fills missing ageCat for Adult burials from ageRange when possible.
 * Preserves existing non-empty ageCat from the source record.
 */
export function deriveAgeCat(d) {
  if (d.ageCat && d.ageCat.trim() !== '') return d.ageCat;

  if (d.age !== 'Adult') return d.ageCat || '';

  if (!d.ageRange || d.ageRange.trim() === '') return '';

  const parts = d.ageRange.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!parts) return '';

  const lo = parseInt(parts[1], 10);
  const hi = parseInt(parts[2], 10);
  const mid = (lo + hi) / 2;

  if (mid < 35) return 'Young Adult';
  if (mid < 50) return 'Middle Adult';
  return 'Old Adult';
}
