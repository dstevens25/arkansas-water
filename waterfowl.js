// Turns AGFC's two published waterfowl sheets into one normalized list of units.
//
// The sheets have different column names for the same ideas:
//   GTR sheet:        WMA | GTR  | Gauge Link | Current Status | ...
//   Moist-soil sheet: WMA | Unit | Vegetation | Status | Water Source | Comments
//
// Both bury the percentage and the update date inside a status string like
// "75% flooded (Updated 1/13/26)".

const fs = require("fs");

const WATERFOWL_PAGE = "https://www.agfc.com/hunting/waterfowl/";
const UA = "ArkansasWaterCheck/0.1 (personal project; contact: you@example.com)";

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

function findSheets(html) {
  const out = [];
  const re = /<a[^>]+href="(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^"]+?)\/pubhtml[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ base: m[1], label: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "75% flooded (Updated 1/13/26)" -> { percent: 75, updated: "2026-01-13" }
function readStatus(s) {
  const out = { statusText: (s || "").trim() };
  if (!out.statusText) return out;

  const pct = out.statusText.match(/(\d{1,3})\s*%/);
  if (pct) out.percent = +pct[1];
  else if (/^dry\b/i.test(out.statusText)) out.percent = 0;
  else if (/^full\b|fully flooded/i.test(out.statusText)) out.percent = 100;

  const d = out.statusText.match(/updated\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (d) {
    const yr = d[3].length === 2 ? 2000 + +d[3] : +d[3];
    out.updated = `${yr}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
    out.daysOld = Math.round((Date.now() - new Date(out.updated + "T12:00:00Z")) / 864e5);
    out.stale = out.daysOld > 10;
  }
  return out;
}

// Header row is the first row with 3+ filled cells.
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (rows[i].filter(c => c.trim()).length >= 3) return i;
  }
  return 0;
}

function normalize(rows, sheetKind) {
  const h = findHeader(rows);
  const headers = rows[h].map((c, i) => c.trim() || `col${i}`);
  const idx = name => headers.findIndex(x => x.toLowerCase() === name.toLowerCase());

  const iWma    = idx("WMA");
  const iUnit   = idx("GTR") !== -1 ? idx("GTR") : idx("Unit");
  const iStatus = idx("Current Status") !== -1 ? idx("Current Status") : idx("Status");
  const iGauge  = idx("Gauge Link");
  const iVeg    = idx("Vegetation");
  const iSource = idx("Water Source");
  const iPlan   = idx("Planned Operation Dates") !== -1
                    ? idx("Planned Operation Dates")
                    : idx("Infrastructure Operation Planned Date");
  const iCmt    = idx("Comments");

  const units = [];
  let lastWma = "";        // WMA is blank on continuation rows — carry it down
  let section = "";        // "Moist-Soil Units (Hunting Open)" etc.
  let huntingOpen = null;

  for (const r of rows.slice(h + 1)) {
    const cell = i => (i >= 0 && r[i] ? r[i].trim() : "");
    const filled = r.filter(c => c.trim()).length;
    const first = cell(0);

    // A row with only the first cell filled is a section heading, not a unit.
    if (filled === 1 && first) {
      section = first;
      if (/hunting open/i.test(first)) huntingOpen = true;
      else if (/closed|no hunting/i.test(first)) huntingOpen = false;
      continue;
    }

    if (cell(iWma)) lastWma = cell(iWma);
    const unit = cell(iUnit);
    if (!unit && !cell(iStatus)) continue;

    const status = readStatus(cell(iStatus));

    units.push({
      wma: lastWma,
      unit: unit || lastWma,
      type: sheetKind,
      section: section || undefined,
      huntingOpen: huntingOpen === null ? undefined : huntingOpen,
      ...status,
      vegetation: cell(iVeg) || undefined,
      waterSource: cell(iSource) || undefined,
      plannedOperation: cell(iPlan) || undefined,
      gaugeLink: cell(iGauge) || undefined,
      comments: cell(iCmt) || undefined,
    });
  }
  return units.filter(u => u.wma || u.unit);
}

(async () => {
  try {
    const page = await get(WATERFOWL_PAGE);
    const sheets = findSheets(page);
    if (!sheets.length) throw new Error("No published sheets linked on the waterfowl page");

    const result = { fetched: new Date().toISOString(), source: WATERFOWL_PAGE, units: [] };

    for (const s of sheets) {
      const kind = /gtr|greentree/i.test(s.label) ? "gtr"
                 : /moist/i.test(s.label) ? "moist-soil" : "other";
      console.log(`\n${s.label}  [${kind}]`);
      const rows = parseCsv(await get(s.base + "/pub?output=csv"));
      const units = normalize(rows, kind);
      console.log(`  ${units.length} units, ${units.filter(u => u.percent !== undefined).length} with a water level`);
      const fresh = units.filter(u => u.updated && !u.stale).length;
      console.log(`  ${fresh} updated in the last 10 days`);
      if (units[0]) console.log("  sample:", JSON.stringify(units[0]));
      result.units.push(...units);
    }

    if (!result.units.length) throw new Error("Read the sheets but found no units");

    // Handy rollup: wettest WMAs first.
    const byWma = {};
    for (const u of result.units) {
      if (u.percent === undefined) continue;
      (byWma[u.wma] ||= []).push(u.percent);
    }
    result.wmaSummary = Object.entries(byWma).map(([wma, pcts]) => ({
      wma,
      units: pcts.length,
      avgPercent: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
      maxPercent: Math.max(...pcts),
    })).sort((a, b) => b.avgPercent - a.avgPercent);

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/waterfowl.json", JSON.stringify(result, null, 2));
    console.log(`\nWrote data/waterfowl.json — ${result.units.length} units across ${result.wmaSummary.length} WMAs`);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  }
})();
