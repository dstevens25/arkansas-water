// Fetches the newest AGFC weekly report and writes structured JSON.
// Run: node fetch.js fishing   (or)   node fetch.js waterfowl

const fs = require("fs");
const { parseReport } = require("./parse");

const KIND = process.argv[2] || "fishing";
const LIST = "https://www.agfc.com/tag/arkansas-wildlife-" +
             (KIND === "waterfowl" ? "waterfowl" : "fishing") + "-report/";

const UA = "ArkansasWaterCheck/0.1 (personal project; contact: you@example.com)";

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

// The archive page lists reports newest first. Grab the first report link.
function newestReportUrl(html) {
  const re = /https:\/\/www\.agfc\.com\/news\/[a-z0-9\-]*(?:fishing|waterfowl)-report[a-z0-9\-]*\/?/gi;
  const hits = [...new Set(html.match(re) || [])];
  if (!hits.length) throw new Error("No report links found on the archive page");
  return hits[0];
}

(async () => {
  try {
    const archive = await get(LIST);
    const url = newestReportUrl(archive);
    console.log("Newest report:", url);

    const page = await get(url);
    const data = parseReport(page, url);
    data.kind = KIND;

    if (!data.waters.length) throw new Error("Parsed zero water bodies — page format may have changed");

    const stale = data.waters.filter(w => w.stale).length;
    console.log(`Parsed ${data.waters.length} water bodies (${stale} stale)`);

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(`data/${KIND}.json`, JSON.stringify(data, null, 2));
    console.log(`Wrote data/${KIND}.json`);
  } catch (e) {
    // Fail loudly. A silent parser that returns stale data is worse than one that errors.
    console.error("FAILED:", e.message);
    process.exit(1);
  }
})();
