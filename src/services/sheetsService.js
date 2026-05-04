const SHEET_URL = process.env.REACT_APP_SHEET_CSV_URL;
const CACHE_KEY = 'archStreetSheetCache';
const CACHE_TTL = parseInt(
  process.env.REACT_APP_SYNC_INTERVAL || '86400000',
  10
) || 86400000;
const DEBUG = process.env.REACT_APP_DEBUG === 'true';

// ── CSV Parser ───────────────────────────────────
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Handle quoted fields properly
  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/"/g, '').trim());
  
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const values = parseLine(line);
      const record = {};
      headers.forEach((h, i) => {
        record[h] = (values[i] || '').replace(/"/g, '').trim();
      });
      return record;
    });
}

// ── Column name mapping ───────────────────────────
// Maps every possible column name variation from the 
// Google Sheet to the app's internal field names.
// IMPORTANT: adjust these to match your actual sheet headers.

const COLUMN_MAP = {
  // G-Number variants
  'G-Number': 'g', 'G Number': 'g', 'GNumber': 'g',
  'g-number': 'g', 'G-number': 'g',
  
  // Coordinates
  'N': 'n', 'North': 'n', 'Northing': 'n',
  'E': 'e', 'East': 'e', 'Easting': 'e',
  'Z': 'depth', 'Z (top)': 'depth', 'Depth': 'depth',
  
  // Biological profile
  'Age': 'age', 'Age Category': 'ageCat',
  'Age Range': 'ageRange', 'Age range': 'ageRange',
  'Sex': 'sex', 'Sexing Method': 'sexMethod',
  'Ancestry': 'ancestry',
  
  // Preservation
  'Preservation': 'preservation',
  'Soft Tissue': 'softTissue', 'Soft tissue': 'softTissue',
  
  // Coffin
  'Coffin Preservation': 'coffinPreservation',
  'Coffin Shape': 'coffinShape', 'Coffin shape': 'coffinShape',
  'Lid Type': 'lidType', 'Lid type': 'lidType',
  'Coffin Length': 'coffinLength', 'Length': 'coffinLength',
  'Coffin Width': 'coffinWidth', 'Width': 'coffinWidth',
  'Coffin Handles': 'coffinHandles', 'Handles': 'coffinHandles',
  'Handle Style': 'handleStyle', 'Coffin handle style': 'handleStyle',
  'Coffin Plates': 'coffinPlates', 'Plates': 'coffinPlates',
  'Lid Tacks': 'lidTacks',
  
  // Material culture
  'Artifact Type': 'artifactType', 'Artifact type': 'artifactType',
  'Material Type': 'materialType', 'Material type': 'materialType',
  'Description': 'description',
  
  // Historical
  'Name ID': 'nameId', 'Name Id': 'nameId', 'NameID': 'nameId',
  'Date Of Death': 'dateOfDeath', 'Date of Death': 'dateOfDeath',
  'Date of death': 'dateOfDeath',
};

export function normalizeSheetRecord(row) {
  const out = {};
  
  // Map each column using COLUMN_MAP
  Object.entries(row).forEach(([col, val]) => {
    const mapped = COLUMN_MAP[col];
    if (mapped) out[mapped] = val;
  });

  // Ensure numeric fields are parsed
  if (out.n)     out.n     = parseFloat(out.n)     || 0;
  if (out.e)     out.e     = parseFloat(out.e)     || 0;
  if (out.depth) out.depth = parseFloat(out.depth) || 0;
  
  // Ensure g-number is formatted consistently: "G-001"
  if (out.g) {
    const num = out.g.replace(/^G-?/i, '').padStart(3, '0');
    out.g = `G-${num}`;
  }

  return out;
}

// ── Fetch with cache ──────────────────────────────

/**
 * @returns {Promise<{ data: object[], fromCache: boolean } | null>}
 */
export async function fetchSheetData() {
  if (!SHEET_URL) {
    if (DEBUG) console.log('No REACT_APP_SHEET_CSV_URL set — using local data');
    return null;
  }

  // Check cache first
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL && Array.isArray(data)) {
        if (DEBUG) console.log('Using cached sheet data');
        return { data, fromCache: true };
      }
    }
  } catch { /* ignore cache errors */ }

  try {
    const res = await fetch(SHEET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const csv = await res.text();
    const rows = parseCSV(csv);
    const normalized = rows
      .map(normalizeSheetRecord)
      .filter(r => r.g && r.n && r.e);  // must have G-number + coords

    // Cache the result
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: normalized
      }));
    } catch { /* storage full — skip cache */ }

    if (DEBUG) console.log(`Loaded ${normalized.length} records from Google Sheet`);
    return { data: normalized, fromCache: false };

  } catch (err) {
    if (DEBUG) console.log('Sheet fetch failed:', err.message);
    return null;
  }
}

export function clearSheetCache() {
  localStorage.removeItem(CACHE_KEY);
}
