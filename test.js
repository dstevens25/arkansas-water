const { parseReport } = require("./parse");

// Real excerpts from the AGFC Weekly Fishing Report, March 19 2026,
// wrapped in the same kind of markup the live page uses.
const sample = `
<h2>Central Arkansas</h2>
<p><strong><em>Greers Ferry Lake</em></strong></p>
<p><strong>(updated 3-19-2026)</strong> Fish 'N Stuff in Sherwood said <strong>white bass</strong>
have been doing well in mainly Salt Creek, Hill Creek and in Middle Fork. <strong>Largemouth bass</strong>
have been up fairly shallow. They're being caught in 2-6 feet of water.</p>

<p><strong><em>Lake Maumelle</em></strong></p>
<p><strong>(updated 3-19-2026)</strong> WestRock Landing in Roland said the water temperature
Thursday was ranging 54-56 degrees. The lake is slightly higher, but 7.15 feet below normal pool.
<strong>Crappie</strong> have been fair. They are anywhere from 4-30 feet.</p>

<p><strong><em>Lake Overcup</em></strong></p>
<p><strong>(updated 3-12-2026)</strong> John Banks at Overcup Landing reported that water level
is up by 1.5 feet and clarity is good. Surface temperature is around 65 degrees.
<strong>Catfish</strong> are doing well on yo-yos and trotlines.</p>

<p><strong><em>Little Red River</em></strong></p>
<p>No reports.</p>

<h2>Northwest Arkansas</h2>
<p><strong><em>Beaver Lake</em></strong></p>
<p><strong>(updated 3-19-2026)</strong> Jon Conklin with FishOn Guide Service said Beaver Lake is
1,116.35 feet msl, which is around 5 feet below normal level. Water temps dropped this week.
<strong>Stripers</strong> have been the best option lately.</p>

<h2>Southwest Arkansas</h2>
<p><strong><em>Millwood Lake</em></strong></p>
<p><strong>(updated 3-19-2026)</strong> Millwood Lake Dam was releasing about 6,400 cfs, and
tailwater was near 233 feet and rising. Surface temperature over the past week continued
fluctuating, ranging 62-67 degrees depending on location. <strong>Crappie</strong> have greatly
improved. <strong>Catfish</strong> continue biting well on trotlines.</p>
`;

const out = parseReport(sample, "https://www.agfc.com/news/arkansas-wildlife-weekly-fishing-report-287/");

console.log(`Parsed ${out.waters.length} water bodies\n`);
for (const w of out.waters) {
  const bits = [];
  if (w.percentFlooded !== undefined) bits.push(`${w.percentFlooded}% flooded`);
  if (w.levelMsl !== undefined) bits.push(`${w.levelMsl} ft msl`);
  if (w.feetBelowNormal !== undefined) bits.push(`${w.feetBelowNormal} ft low`);
  if (w.waterTempF !== undefined) bits.push(`${w.waterTempF}°F`);
  if (w.flowCfs !== undefined) bits.push(`${w.flowCfs} cfs`);
  if (w.noReport) bits.push("no report");
  console.log(
    `${w.water}  [${w.region}]\n` +
    `  updated ${w.updated || "?"}${w.stale ? "  ← STALE" : ""}\n` +
    `  ${bits.join(" · ") || "no numbers found"}\n` +
    `  species: ${w.species.join(", ") || "none"}\n`
  );
}
