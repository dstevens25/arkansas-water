// Turns an AGFC weekly report page into structured data.
// Works on both the fishing report (Thursdays, year round) and the
// waterfowl report (weekly during season) — same page structure.

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/[ \t]+/g, " ");
}

// AGFC stamps most entries with (updated 3-19-2026). That date is per-entry,
// not per-page — they republish stale entries when a reporter doesn't check in.
function findUpdated(text) {
  // AGFC writes "(updated 8-27-2026)" but typos it as "(update 8-27-2026)" often enough
  // to matter — Little Maumelle River did exactly that this week.
  const m = text.match(/updat(?:ed|e)\s+(\d{1,2})-(\d{1,2})-(\d{4})/i);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysOld(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso + "T12:00:00Z")) / 864e5);
}

// Numbers worth pulling out of the prose.
function extractFacts(text) {
  const facts = {};

  const pct = text.match(/(\d{1,3})\s*(?:percent|%)\s*(?:flooded|coverage)/i);
  if (pct) facts.percentFlooded = +pct[1];

  const msl = text.match(/([\d,]+\.?\d*)\s*(?:feet|ft)\.?\s*msl/i);
  if (msl) facts.levelMsl = +msl[1].replace(/,/g, "");

  const below = text.match(/([\d.]+)\s*(?:feet|ft)\.?\s*below\s*(?:normal|full)/i);
  if (below) facts.feetBelowNormal = +below[1];

  // AGFC writes temps a dozen ways: "water temperature Thursday was ranging 54-56 degrees",
  // "Surface temperature is around 65 degrees", "temps dropped to 49-51". Stay loose.
  const temp = text.match(/(?:water|surface)\s+temp\w*[^.]{0,40}?(\d{2})\s*(?:-|to)\s*(\d{2})\s*degrees/i)
            || text.match(/(?:water|surface)\s+temp\w*[^.]{0,40}?(\d{2})\s*degrees/i);
  if (temp) facts.waterTempF = temp[2] ? (+temp[1] + +temp[2]) / 2 : +temp[1];

  const cfs = text.match(/([\d,]+)\s*cfs/i);
  if (cfs) facts.flowCfs = +cfs[1].replace(/,/g, "");

  if (/no reports?\./i.test(text)) facts.noReport = true;

  return facts;
}

const SPECIES = ["largemouth bass","smallmouth bass","spotted bass","striped bass",
  "white bass","black bass","crappie","bream","catfish","walleye","trout","stripers",
  "bass","mallard","ducks","geese"];

function findSpecies(text) {
  const low = text.toLowerCase();
  const found = SPECIES.filter(s => low.includes(s));
  // drop the generic when a specific one already matched
  return found.filter(s => s !== "bass" || !found.some(f => f !== "bass" && f.includes("bass")));
}

function parseReport(html, sourceUrl) {
  let text = stripTags(html);

  // Chop the site footer. Without this, "Civil Rights" and "Wild Science Webinars"
  // get filed as bodies of water in whatever region came last.
  const footer = text.search(/Subscribe to Our Weekly Newsletter|2 Natural Resources Drive/i);
  if (footer > 0) text = text.slice(0, footer);

  // Regions are h2s; water bodies are h3/h4 or bold-italic headings.
  const regionRe = /^\s*((?:North|South|East|West|Central|Northwest|Northeast|Southeast|Southwest|South-Central|West-Central)[a-z\- ]*Arkansas)\s*$/gim;

  const regions = [];
  let m, marks = [];
  while ((m = regionRe.exec(text)) !== null) marks.push({ name: m[1].trim(), at: m.index });

  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].at, marks[i + 1] ? marks[i + 1].at : text.length);
    regions.push({ name: marks[i].name, body });
  }

  const entries = [];
  for (const region of regions) {
    // Split on lines that look like a water body name: title case, no sentence punctuation.
    const lines = region.body.split("\n");
    let current = null;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const isHeading =
        t.length > 3 && t.length < 70 &&
        !/[.!?;:]$/.test(t) &&
        /^[A-Z]/.test(t) &&
        !/^(updated|for the|note|no reports)/i.test(t) &&
        (t.match(/[A-Z]/g) || []).length >= 2 &&
        t !== region.name;

      if (isHeading) {
        if (current) entries.push(current);
        current = { region: region.name, water: t, text: "" };
      } else if (current) {
        current.text += t + " ";
      }
    }
    if (current) entries.push(current);
  }

  return {
    source: sourceUrl,
    fetched: new Date().toISOString(),
    waters: entries
      .filter(e => e.text.trim().length > 20 || /no reports?\./i.test(e.text))
      .map(e => {
        const updated = findUpdated(e.text);
        const body = e.text.trim();
        // Some entries are nothing but a pointer to a Corps gauge page — useful as a
        // link, but not an actual condition report. Mark them so the app can tell.
        const referenceOnly =
          !updated &&
          /visit the Corps|click here|real-time/i.test(body) &&
          body.length < 300;
        return {
          region: e.region,
          water: e.water,
          updated,
          daysOld: daysOld(updated),
          stale: daysOld(updated) !== null && daysOld(updated) > 10,
          referenceOnly,
          species: findSpecies(body),
          ...extractFacts(body),
          summary: body.slice(0, 400),
        };
      }),
  };
}

module.exports = { parseReport, stripTags, findUpdated, extractFacts };
