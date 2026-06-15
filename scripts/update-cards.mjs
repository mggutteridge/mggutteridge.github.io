import fs from "node:fs/promises";

const LEAGUE = "fifa.world";
const SCOREBOARD_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/scoreboard`;
const SUMMARY_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/summary`;

const FALLBACK_TEAMS = [
  "Mexico", "South Africa", "Korea Republic", "Czechia", "Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland",
  "Brazil", "Morocco", "Haiti", "Scotland", "USA", "Paraguay", "Australia", "Türkiye", "Germany", "Curaçao",
  "Côte d'Ivoire", "Ecuador", "Netherlands", "Japan", "Sweden", "Tunisia", "Belgium", "Egypt", "IR Iran", "New Zealand",
  "Spain", "Cabo Verde", "Saudi Arabia", "Uruguay", "France", "Senegal", "Iraq", "Norway", "Argentina", "Algeria",
  "Austria", "Jordan", "Portugal", "Colombia", "Uzbekistan", "Congo DR", "England", "Croatia", "Ghana", "Panama"
];

const ALIASES = new Map([
  ["United States", "USA"], ["USA", "USA"],
  ["South Korea", "Korea Republic"], ["Republic of Korea", "Korea Republic"],
  ["Iran", "IR Iran"], ["IR Iran", "IR Iran"],
  ["Turkey", "Türkiye"], ["Turkiye", "Türkiye"], ["Türkiye", "Türkiye"],
  ["Ivory Coast", "Côte d'Ivoire"], ["Cote d'Ivoire", "Côte d'Ivoire"],
  ["Cape Verde", "Cabo Verde"],
  ["DR Congo", "Congo DR"], ["Congo", "Congo DR"],
  ["Czech Republic", "Czechia"],
  ["Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  ["Bosnia & Herzegovina", "Bosnia and Herzegovina"],
  ["Curacao", "Curaçao"]
]);

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function readExistingJson() {
  try {
    return JSON.parse(await fs.readFile("cards.json", "utf8"));
  } catch {
    return {};
  }
}

function makeLookup(teams) {
  const lookup = new Map();
  for (const team of teams) lookup.set(norm(team), team);
  for (const [alias, team] of ALIASES) {
    if (teams.includes(team)) lookup.set(norm(alias), team);
  }
  return lookup;
}

function canonicalTeam(raw, lookup) {
  if (!raw) return null;
  const n = norm(raw);
  if (lookup.has(n)) return lookup.get(n);

  for (const [aliasNorm, team] of lookup.entries()) {
    if (aliasNorm && (n.includes(aliasNorm) || aliasNorm.includes(n))) return team;
  }

  return null;
}

function emptyCards(teams) {
  return Object.fromEntries(
    teams.map(team => [team, { yellow: 0, secondYellow: 0, straightRed: 0 }])
  );
}

function countNonZeroRows(cards) {
  return Object.values(cards || {}).filter(v =>
    Number(v.yellow || 0) || Number(v.straightRed || v.red || 0)
  ).length;
}

function isVarOverturnedCard(obj) {
  const text = [
    obj?.text,
    obj?.shortText,
    obj?.type?.text,
    obj?.type?.description
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("var decision: card changed");
}


async function fetchJson(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 (compatible; sweepstake-card-updater/5.0)"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${url}: ${text.slice(0, 300)}`);
  }
}

function dateToYmd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function tournamentDates() {
  const explicit = process.env.ESPN_SCOREBOARD_DATES;
  if (explicit) return explicit.split(",").map(s => s.trim()).filter(Boolean);

  const out = [];
  const d = new Date("2026-06-11T00:00:00Z");
  const end = new Date("2026-07-19T00:00:00Z");

  while (d <= end) {
    out.push(dateToYmd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return out;
}

function eventShouldBeChecked(event) {
  const type = event?.status?.type || {};
  const state = String(type.state || "").toLowerCase();
  const name = String(type.name || type.description || type.detail || "").toLowerCase();

  return Boolean(
    type.completed ||
    ["in", "post"].includes(state) ||
    name.includes("final") ||
    name.includes("full") ||
    name.includes("progress") ||
    name.includes("half")
  );
}

function extractEvents(scoreboard, sourceUrl) {
  const events = [];

  for (const e of scoreboard?.events || []) {
    const id = e?.id || String(e?.uid || "").split("~").pop();
    if (!id) continue;

    const competitors = e?.competitions?.[0]?.competitors || [];
    const teams = competitors
      .map(c => c?.team?.displayName || c?.team?.location || c?.team?.name || c?.team?.abbreviation)
      .filter(Boolean);

    events.push({
      id: String(id),
      sourceUrl,
      name: e?.name || e?.shortName || teams.join(" v "),
      status: e?.status?.type?.description || e?.status?.type?.name || e?.status?.type?.state || "",
      shouldFetch: eventShouldBeChecked(e),
      teams
    });
  }

  return events;
}

function cardTypeFromObject(obj) {
  const typeText = [
    obj?.type?.type,
    obj?.type?.text,
    obj?.type?.name,
    obj?.type?.description,
    obj?.text,
    obj?.shortText,
    obj?.displayName
  ].filter(Boolean).join(" ").toLowerCase();

  if (obj?.yellowCard === true || typeText.includes("yellow card") || typeText.includes("yellow-card")) {
    return "yellow";
  }

  if (obj?.redCard === true || typeText.includes("red card") || typeText.includes("red-card")) {
    return "red";
  }

  return null;
}

function objectTeamName(obj) {
  return obj?.team?.displayName ||
    obj?.team?.location ||
    obj?.team?.name ||
    obj?.team?.abbreviation ||
    obj?.competitor?.team?.displayName ||
    obj?.competitor?.team?.location ||
    obj?.competitor?.team?.name ||
    obj?.competitor?.team?.abbreviation ||
    null;
}

function participantText(obj) {
  const participants = Array.isArray(obj?.participants) ? obj.participants : [];

  return participants.map(p => [
    p?.athlete?.displayName,
    p?.athlete?.shortName,
    p?.athlete?.name,
    p?.team?.displayName,
    p?.team?.location,
    p?.team?.name
  ].filter(Boolean).join(" ")).join(" ");
}

function inferTeamFromEvent(obj, summary, lookup) {
  const direct = canonicalTeam(objectTeamName(obj), lookup);
  if (direct) return direct;

  const text = [
    obj?.text,
    obj?.shortText,
    obj?.displayName,
    participantText(obj)
  ].filter(Boolean).join(" ");

  const competitors = summary?.boxscore?.teams || summary?.header?.competitions?.[0]?.competitors || [];

  for (const c of competitors || []) {
    const names = [
      c?.team?.displayName,
      c?.team?.location,
      c?.team?.name,
      c?.team?.abbreviation
    ].filter(Boolean);

    for (const name of names) {
      if (norm(text).includes(norm(name))) {
        const team = canonicalTeam(name, lookup);
        if (team) return team;
      }
    }
  }

  return null;
}

function cardKey(eventId, obj, type, team) {
  return [
    eventId,
    obj?.id || obj?.sequenceNumber || obj?.sequence || "",
    type,
    team,
    obj?.clock?.displayValue || obj?.clock?.value || "",
    participantText(obj),
    obj?.text || obj?.shortText || ""
  ].join("::");
}

function collectCardsFromArray(arr, eventId, summary, cards, seen, diagnostics, sourceName, lookup) {
  if (!Array.isArray(arr)) return;

  for (const obj of arr) {
    if (!obj || typeof obj !== "object") continue;

    const type = cardTypeFromObject(obj);
    if (!type) continue;

    
    // ✅ NEW: skip VAR-overturned cards
    if (isVarOverturnedCard(obj)) {
      diagnostics.warnings.push(
        `Skipped VAR-overturned card in ${eventId} (${sourceName}): ${
          obj?.text || obj?.shortText || ""
        }`
      );
      continue;
    }


    const team = inferTeamFromEvent(obj, summary, lookup);

    if (!team) {
      diagnostics.unmatchedCardEvents.push({
        eventId,
        sourceName,
        rawTeam: objectTeamName(obj),
        text: obj?.text || obj?.shortText || obj?.type?.text || "",
        type
      });
      continue;
    }

    const key = cardKey(eventId, obj, type, team);
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === "yellow") cards[team].yellow += 1;
    if (type === "red") cards[team].straightRed += 1;

    diagnostics.cardEvents.push({
      eventId,
      sourceName,
      team,
      type,
      minute: obj?.clock?.displayValue || "",
      text: obj?.text || obj?.shortText || obj?.type?.text || ""
    });
  }
}

function collectCardsFromSummary(summary, eventId, cards, diagnostics, lookup) {
  const seen = new Set();

  collectCardsFromArray(summary?.keyEvents, eventId, summary, cards, seen, diagnostics, "keyEvents", lookup);


  return seen.size;
}

const existing = await readExistingJson();
const teams = Object.keys(existing.cards || {}).length ? Object.keys(existing.cards) : FALLBACK_TEAMS;
const lookup = makeLookup(teams);

const diagnostics = {
  updatedAt: new Date().toISOString(),
  source: "ESPN site API scoreboard + match summaries",
  scoreboardUrlsTried: [],
  scoreboardCallsSucceeded: 0,
  scoreboardCallsFailed: 0,
  eventsFound: 0,
  eventsChecked: 0,
  summaryCallsSucceeded: 0,
  summaryCallsFailed: 0,
  cardEvents: [],
  unmatchedCardEvents: [],
  warnings: []
};

const eventMap = new Map();

const scoreboardUrls = [
  `${SCOREBOARD_BASE}?limit=300`,
  ...tournamentDates().map(d => `${SCOREBOARD_BASE}?dates=${d}&limit=300`)
];

for (const url of scoreboardUrls) {
  diagnostics.scoreboardUrlsTried.push(url);

  try {
    const data = await fetchJson(url);
    diagnostics.scoreboardCallsSucceeded += 1;

    for (const event of extractEvents(data, url)) {
      const existingEvent = eventMap.get(event.id);

      if (!existingEvent) {
        eventMap.set(event.id, event);
      } else {
        existingEvent.shouldFetch = existingEvent.shouldFetch || event.shouldFetch;
      }
    }
  } catch (e) {
    diagnostics.scoreboardCallsFailed += 1;
    diagnostics.warnings.push(`Scoreboard fetch failed: ${url} :: ${e.message}`);
  }
}

diagnostics.eventsFound = eventMap.size;

let cards = emptyCards(teams);

for (const event of eventMap.values()) {
  if (!event.shouldFetch) continue;

  diagnostics.eventsChecked += 1;

  try {
    const summary = await fetchJson(`${SUMMARY_BASE}?event=${encodeURIComponent(event.id)}`);
    diagnostics.summaryCallsSucceeded += 1;
    collectCardsFromSummary(summary, event.id, cards, diagnostics, lookup);
  } catch (e) {
    diagnostics.summaryCallsFailed += 1;
    diagnostics.warnings.push(`Summary fetch failed for ${event.id} ${event.name}: ${e.message}`);
  }
}

diagnostics.rowsMapped = Object.values(cards).filter(v => v.yellow || v.straightRed).length;
diagnostics.nonZeroRows = countNonZeroRows(cards);

let caveat = "Cards are parsed from ESPN match-summary event data. Yellow cards are worth 1 point and red cards are worth 3 points.";

if (diagnostics.eventsFound === 0 || diagnostics.summaryCallsSucceeded === 0 || diagnostics.cardEvents.length === 0) {
  const existingCards = existing.cards || emptyCards(teams);
  const existingNonZero = countNonZeroRows(existingCards);

  if (existingNonZero > 0) {
    cards = existingCards;
    diagnostics.nonZeroRows = existingNonZero;
    diagnostics.rowsMapped = 0;
    diagnostics.warnings.push("No new ESPN card events were parsed, so previous cards.json values were preserved.");
    caveat += " Warning: no new ESPN card events were parsed on this run, so previous card totals were preserved.";
  } else {
    diagnostics.warnings.push("No ESPN card events were parsed and there were no previous non-zero card totals to preserve.");
    caveat += " Warning: no ESPN card events were parsed and all card totals remain zero.";
  }
}

const output = {
  source: "ESPN match summaries",
  updatedAt: new Date().toISOString(),
  scoring: { yellow: 1, red: 3 },
  caveat,
  diagnostics,
  cards
};

await fs.writeFile("cards.json", JSON.stringify(output, null, 2) + "\n", "utf8");

console.log(
  `Wrote cards.json. Events found: ${diagnostics.eventsFound}; ` +
  `events checked: ${diagnostics.eventsChecked}; summaries: ${diagnostics.summaryCallsSucceeded}; ` +
  `card events: ${diagnostics.cardEvents.length}; non-zero teams: ${diagnostics.nonZeroRows}.`
);
