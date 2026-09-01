// Gauge alerts by email — no server, no push service, no third-party account.
//
// How it works: this runs in your GitHub Action on a schedule. When a gauge crosses
// a threshold you set below, it opens an issue in your own repo. GitHub emails you
// when an issue is opened in a repo you watch. That's the whole mechanism.
//
// One-time setup: go to your repo, click Watch (top right) → All Activity.
// Otherwise GitHub won't email you about your own issues.
//
// Run: node alerts.js

const WATCH = [
  // usgs   : USGS site number
  // name   : what you call it
  // above  : alert when the gauge rises past this (feet)
  // below  : alert when it drops under this (feet)
  // rise24 : alert when it comes up this much in 24 hours (feet)
  { usgs:"07076750", name:"White River — Georgetown",    rise24: 1.0 },
  { usgs:"07077730", name:"Bayou DeView — Brinkley",     rise24: 0.8 },
  { usgs:"07077000", name:"White River — DeValls Bluff", rise24: 1.0 },
];

const REPO  = process.env.GITHUB_REPOSITORY;         // set automatically by Actions
const TOKEN = process.env.GITHUB_TOKEN;              // ditto

async function reading(site){
  const url = "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=" + site +
              "&parameterCd=00065&period=P2D";
  const r = await fetch(url);
  if(!r.ok) throw new Error(`USGS ${r.status}`);
  const ts = (await r.json())?.value?.timeSeries || [];
  if(!ts.length) throw new Error("no data");

  const pts = (ts[0].values[0].value || []).filter(v => v.value !== "-999999");
  if(!pts.length) throw new Error("no readings");

  const last = pts[pts.length - 1];
  const now  = parseFloat(last.value);
  const taken = new Date(last.dateTime);

  const target = new Date(taken.getTime() - 864e5);
  let prior = pts[0];
  for(const p of pts){ if(new Date(p.dateTime) <= target) prior = p; }

  return { now, change: now - parseFloat(prior.value), taken };
}

function triggersFor(spot, r){
  const hits = [];
  if(spot.above  !== undefined && r.now >= spot.above)
    hits.push(`up to ${r.now.toFixed(2)} ft (your mark: ${spot.above})`);
  if(spot.below  !== undefined && r.now <= spot.below)
    hits.push(`down to ${r.now.toFixed(2)} ft (your mark: ${spot.below})`);
  if(spot.rise24 !== undefined && r.change >= spot.rise24)
    hits.push(`up ${r.change.toFixed(2)} ft in 24 hours (your mark: ${spot.rise24})`);
  return hits;
}

async function openIssue(title, body){
  if(!REPO || !TOKEN){ console.log("[no GitHub context — would have opened an issue]"); return; }
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["water-alert"] }),
  });
  if(!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  console.log("Opened issue:", title);
}

// Don't nag. If an open alert already exists for this gauge, stay quiet.
async function alreadyOpen(site){
  if(!REPO || !TOKEN) return false;
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/issues?state=open&labels=water-alert&per_page=50`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" } });
  if(!res.ok) return false;
  const issues = await res.json();
  return issues.some(i => (i.body || "").includes(`site:${site}`));
}

(async () => {
  let fired = 0;
  for(const spot of WATCH){
    try{
      const r = await reading(spot.usgs);
      const hits = triggersFor(spot, r);
      const dir = r.change > 0.05 ? "rising" : r.change < -0.05 ? "falling" : "steady";
      console.log(`${spot.name}: ${r.now.toFixed(2)} ft, ${dir} (${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)} / 24h)` +
                  (hits.length ? "  ← ALERT" : ""));

      if(!hits.length) continue;
      if(await alreadyOpen(spot.usgs)){ console.log("  (alert already open, staying quiet)"); continue; }

      await openIssue(
        `${spot.name} — ${r.now.toFixed(2)} ft`,
        [`**${hits.join("**  \n**")}**`, "",
         `Reading taken ${r.taken.toISOString()}`,
         `24-hour change: ${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)} ft`,
         "",
         `<https://waterdata.usgs.gov/monitoring-location/${spot.usgs}/>`,
         "",
         `site:${spot.usgs}`,
         "",
         "_Close this issue to re-arm the alert for this gauge._"].join("\n"));
      fired++;
    }catch(e){
      console.log(`${spot.name}: could not check — ${e.message}`);
    }
  }
  console.log(fired ? `\n${fired} alert(s) opened.` : "\nNothing crossed a threshold.");
})();
