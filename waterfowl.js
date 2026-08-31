// Pulls AGFC's greentree reservoir and moist-soil unit conditions.
//
// These are NOT in the weekly waterfowl report — that's a narrative news article.
// AGFC publishes the actual water data as Google Sheets linked off
// https://www.agfc.com/hunting/waterfowl/
//
// The sheet URLs change every season (they're stamped 2025-26, 2026-27...), so this
// scrapes the waterfowl page for whatever links are current instead of hardcoding them.
//
// Run: node waterfowl.js

const fs = require("fs");

const WATERFOWL_PAGE = "https://www.agfc.com/hunting/waterfowl/";
const UA = "ArkansasWaterCheck/0.1 (personal project; contact: you@example.com)";

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

// Find every published-sheet link on the page, with the text of the link so we know
// which is the GTR sheet and which is moist-soil.
function findSheets(html) {
  const out = [];
  const re = /<a[^>]+href="(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^"]+?)\/pubhtml[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    out.push({ base: m[1], label });
  }
  return out;
}

// Minimal CSV parser that respects quoted fields containing commas and newlines.
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
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

// The header isn't always row 1 — these sheets often open with a title row.
// Pick the first row that has several non-empty cells and looks like labels.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const filled = rows[i].filter(c => c.trim()).length;
    if (filled >= 3) return i;
  }
  return 0;
}

function toObjects(rows) {
  const h = findHeaderRow(rows);
  const headers = rows[h].map((c, i) => c.trim() || `col${i}`);
  return rows.slice(h + 1).map(r => {
    const o = {};
    headers.forEach((key, i) => { if ((r[i] || "").trim()) o[key] = r[i].trim(); });
    return o;
  }).filter(o => Object.keys(o).length > 1);
}

// Pull a percentage out of whatever column happens to hold it.
function percentFrom(obj) {
  for (const [k, v] of Object.entries(obj)) {
    const m = String(v).match(/(\d{1,3})\s*%/);
    if (m) return { percent: +m[1], percentField: k };
    if (/level|flood|percent/i.test(k)) {
      const n = String(v).match(/^(\d{1,3})$/);
      if (n && +n[1] <= 100) return { percent: +n[1], percentField: k };
    }
  }
  return {};
}

(async () => {
  try {
    console.log("Reading", WATERFOWL_PAGE);
    const page = await get(WATERFOWL_PAGE);
    const sheets = findSheets(page);

    if (!sheets.length) throw new Error("No published Google Sheets linked on the waterfowl page");
    console.log(`Found ${sheets.length} sheet link(s):`);
    sheets.forEach(s => console.log("  -", s.label));

    const result = { fetched: new Date().toISOString(), source: WATERFOWL_PAGE, sheets: [] };

    for (const s of sheets) {
      const csvUrl = s.base + "/pub?output=csv";
      console.log("\nFetching:", s.label);
      let rows;
      try {
        rows = parseCsv(await get(csvUrl));
      } catch (e) {
        console.log("  could not read as CSV:", e.message);
        continue;
      }

      // Print the real shape so we can write a proper parser next round.
      console.log("  rows:", rows.length);
      console.log("  first 3 rows:");
      rows.slice(0, 3).forEach(r => console.log("   ", JSON.stringify(r.slice(0, 8))));

      const records = toObjects(rows).map(o => ({ ...o, ...percentFrom(o) }));
      console.log("  parsed records:", records.length);
      if (records[0]) console.log("  sample record:", JSON.stringify(records[0]));

      result.sheets.push({
        label: s.label,
        url: s.base + "/pubhtml",
        kind: /gtr|greentree/i.test(s.label) ? "gtr"
            : /moist/i.test(s.label) ? "moist-soil" : "other",
        records,
      });
    }

    if (!result.sheets.length) throw new Error("Found links but could not read any sheet");

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/waterfowl.json", JSON.stringify(result, null, 2));
    console.log("\nWrote data/waterfowl.json");
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  }
})();
