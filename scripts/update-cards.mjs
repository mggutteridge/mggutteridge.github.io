import fs from "node:fs/promises";

const ESPN_URLS = [
  process.env.ESPN_DISCIPLINE_URL || "https://www.espn.com/soccer/stats/_/league/FIFA.WORLD/view/discipline",
  "https://www.espn.com/soccer/stats/_/league/FIFA.WORLD/view/discipline/season/2026",
  "https://www.espn.com/soccer/stats/_/league/FIFA.WORLD/view/discipline/season/2026/sort/points",
  "https://www.espn.co.uk/football/stats/_/league/FIFA.WORLD/view/discipline/season/2026"
];

const TEAMS = [
  "Mexico","South Africa","Korea Republic","Czechia","Canada","Bosnia and Herzegovina","Qatar","Switzerland",
  "Brazil","Morocco","Haiti","Scotland","USA","Paraguay","Australia","Türkiye","Germany","Curaçao",
  "Côte d'Ivoire","Ecuador","Netherlands","Japan","Sweden","Tunisia","Belgium","Egypt","IR Iran","New Zealand",
  "Spain","Cabo Verde","Saudi Arabia","Uruguay","France","Senegal","Iraq","Norway","Argentina","Algeria",
  "Austria","Jordan","Portugal","Colombia","Uzbekistan","Congo DR","England","Croatia","Ghana","Panama"
];

const ESPN_NAMES = new Map([
  ["Mexico", ["Mexico"]],
  ["South Africa", ["South Africa"]],
  ["Korea Republic", ["South Korea", "Korea Republic", "Republic of Korea"]],
  ["Czechia", ["Czechia", "Czech Republic"]],
  ["Canada", ["Canada"]],
  ["Bosnia and Herzegovina", ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "Bosnia"]],
  ["Qatar", ["Qatar"]],
  ["Switzerland", ["Switzerland"]],
  ["Brazil", ["Brazil"]],
  ["Morocco", ["Morocco"]],
  ["Haiti", ["Haiti"]],
  ["Scotland", ["Scotland"]],
  ["USA", ["United States", "USA"]],
  ["Paraguay", ["Paraguay"]],
  ["Australia", ["Australia"]],
  ["Türkiye", ["Türkiye", "Turkey", "Turkiye"]],
  ["Germany", ["Germany"]],
  ["Curaçao", ["Curaçao", "Curacao"]],
  ["Côte d'Ivoire", ["Ivory Coast", "Côte d'Ivoire", "Cote d'Ivoire"]],
  ["Ecuador", ["Ecuador"]],
  ["Netherlands", ["Netherlands"]],
  ["Japan", ["Japan"]],
  ["Sweden", ["Sweden"]],
  ["Tunisia", ["Tunisia"]],
  ["Belgium", ["Belgium"]],
  ["Egypt", ["Egypt"]],
  ["IR Iran", ["Iran", "IR Iran"]],
  ["New Zealand", ["New Zealand"]],
  ["Spain", ["Spain"]],
  ["Cabo Verde", ["Cape Verde", "Cabo Verde"]],
  ["Saudi Arabia", ["Saudi Arabia"]],
  ["Uruguay", ["Uruguay"]],
  ["France", ["France"]],
  ["Senegal", ["Senegal"]],
  ["Iraq", ["Iraq"]],
  ["Norway", ["Norway"]],
  ["Argentina", ["Argentina"]],
  ["Algeria", ["Algeria"]],
  ["Austria", ["Austria"]],
  ["Jordan", ["Jordan"]],
  ["Portugal", ["Portugal"]],
  ["Colombia", ["Colombia"]],
  ["Uzbekistan", ["Uzbekistan"]],
  ["Congo DR", ["Congo DR", "DR Congo", "Congo"]],
  ["England", ["England"]],
  ["Croatia", ["Croatia"]],
  ["Ghana", ["Ghana"]],
  ["Panama", ["Panama"]]
]);

const CURRENT_ESPN_SEED = {
  "South Africa": { yellow: 2, secondYellow: 0, straightRed: 2 },
  "Mexico": { yellow: 1, secondYellow: 0, straightRed: 1 },
  "Korea Republic": { yellow: 1, secondYellow: 0, straightRed: 0 },
  "Czechia": { yellow: 0, secondYellow: 0, straightRed: 0 }
};

function htmlDecode(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u002F/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003C/g, "<")
    .replace(/\\u003E/g, ">")
    .replace(/\\u2019/g, "'")
    .replace(/\\u00e9/g, "é")
    .replace(/\\u00e7/g, "ç")
    .replace(/\\u00f4/g, "ô")
    .replace(/\\u00fc/g, "ü")
    .replace(/\\u0131/g, "ı");
}

function stripHtml(html) {
  return htmlDecode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function toNumberToken(tok) {
  if (tok === undefined || tok === null) return 0;
  const s = String(tok).trim();
  if (!s || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function emptyCards() {
  return Object.fromEntries(TEAMS.map(t => [t, { yellow: 0, secondYellow: 0, straightRed: 0 }]));
}

function parseVisibleRows(text, diagnostics) {
  const cards = emptyCards();

  for (const team of TEAMS) {
    const aliases = ESPN_NAMES.get(team) || [team];
    let matched = false;

    for (const alias of aliases) {
      const aliasRegex = escRegex(alias).replace(/\\ /g, "\\s+");
      const patterns = [
        // RK Team P YC RC PTS
        new RegExp(`(?:^|\\s)(?:\\d+\\s+)?${aliasRegex}\\s+(-|\\d+)\\s+(-|\\d+)\\s+(-|\\d+)\\s+(-|\\d+)(?=\\s|$)`, "i"),
        // Sometimes there is no space between rank and team name in SSR text
        new RegExp(`(?:^|\\s)\\d+${aliasRegex}\\s+(-|\\d+)\\s+(-|\\d+)\\s+(-|\\d+)\\s+(-|\\d+)(?=\\s|$)`, "i")
      ];

      for (const re of patterns) {
        const m = text.match(re);
        if (m) {
          cards[team] = {
            yellow: toNumberToken(m[2]),
            secondYellow: 0,
            straightRed: toNumberToken(m[3])
          };
          diagnostics.matchedRows.push({ team, alias, played: m[1], yellow: m[2], red: m[3], espnPoints: m[4] });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) diagnostics.unmatchedTeams.push(team);
  }

  return cards;
}

function parseJsonLikeText(raw, diagnostics) {
  const text = htmlDecode(raw);
  const cards = emptyCards();

  for (const team of TEAMS) {
    const aliases = ESPN_NAMES.get(team) || [team];
    let matched = false;

    for (const alias of aliases) {
      // Looks for a row-like sequence in embedded JSON:
      // "South Africa"...value/displayValue...1...2...2...8
      const aliasRegex = escRegex(alias);
      const re = new RegExp(`${aliasRegex}[\\s\\S]{0,500}?["']?(?:displayValue|value)["']?\\s*:?\\s*["']?(-|\\d+)["']?[\\s\\S]{0,120}?["']?(?:displayValue|value)["']?\\s*:?\\s*["']?(-|\\d+)["']?[\\s\\S]{0,120}?["']?(?:displayValue|value)["']?\\s*:?\\s*["']?(-|\\d+)["']?[\\s\\S]{0,120}?["']?(?:displayValue|value)["']?\\s*:?\\s*["']?(-|\\d+)["']?`, "i");
      const m = text.match(re);
      if (m) {
        cards[team] = {
          yellow: toNumberToken(m[2]),
          secondYellow: 0,
          straightRed: toNumberToken(m[3])
        };
        diagnostics.jsonLikeMatches.push({ team, alias, played: m[1], yellow: m[2], red: m[3], espnPoints: m[4] });
        matched = true;
        break;
      }
    }

    if (matched) continue;
  }

  return cards;
}

function mergeCards(...sets) {
  const out = emptyCards();
  for (const team of TEAMS) {
    for (const set of sets) {
      const row = set?.[team];
      if (!row) continue;
      const y = Number(row.yellow || 0);
      const r = Number(row.straightRed || row.red || 0);
      if (y || r) {
        out[team] = { yellow: y, secondYellow: 0, straightRed: r };
        break;
      }
    }
  }
  return out;
}

function countNonZeroRows(cards) {
  return Object.values(cards).filter(v => Number(v.yellow || 0) || Number(v.straightRed || v.red || 0)).length;
}

async function readExistingCards() {
  try {
    const data = JSON.parse(await fs.readFile("cards.json", "utf8"));
    return data.cards || emptyCards();
  } catch {
    return emptyCards();
  }
}

let best = null;
let lastError = null;

for (const url of ESPN_URLS) {
  try {
    console.log(`Fetching ESPN discipline stats from ${url}`);
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9,en-US;q=0.8"
      }
    });

    const html = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}. First 300 chars: ${html.slice(0, 300)}`);

    const visibleText = stripHtml(html);
    const startIdx = visibleText.search(/FIFA World Cup Discipline Stats|Discipline RK Team|RK Team P/i);
    const endIdx = visibleText.search(/Glossary RK|Glossary/i);
    const parseText = (startIdx >= 0 && endIdx > startIdx) ? visibleText.slice(startIdx, endIdx) : visibleText;

    const diagnostics = {
      updatedAt: new Date().toISOString(),
      sourceUrl: url,
      finalUrl: res.url,
      httpStatus: res.status,
      htmlLength: html.length,
      textLength: visibleText.length,
      parseTextLength: parseText.length,
      parseZoneFound: startIdx >= 0,
      matchedRows: [],
      jsonLikeMatches: [],
      unmatchedTeams: [],
      sampleText: parseText.slice(0, 1000)
    };

    const visibleCards = parseVisibleRows(parseText, diagnostics);
    const jsonCards = parseJsonLikeText(html, diagnostics);
    const cards = mergeCards(visibleCards, jsonCards);

    const rowsMapped = new Set([
      ...diagnostics.matchedRows.map(r => r.team),
      ...diagnostics.jsonLikeMatches.map(r => r.team)
    ]).size;

    diagnostics.rowsMapped = rowsMapped;
    diagnostics.nonZeroRows = countNonZeroRows(cards);

    if (!best || rowsMapped > best.diagnostics.rowsMapped || diagnostics.nonZeroRows > best.diagnostics.nonZeroRows) {
      best = { url, cards, diagnostics };
    }

    if (rowsMapped > 0 || diagnostics.nonZeroRows > 0) break;
  } catch (e) {
    lastError = e;
    console.warn(`Failed ESPN URL: ${url}`);
    console.warn(e.message);
  }
}

let source = "ESPN FIFA World Cup discipline stats";
let cards;
let diagnostics;
let caveat = "ESPN exposes YC and RC totals. Yellow cards are worth 1 point and red cards are worth 3 points.";

if (best && (best.diagnostics.rowsMapped > 0 || best.diagnostics.nonZeroRows > 0)) {
  cards = best.cards;
  diagnostics = best.diagnostics;
} else {
  const existing = await readExistingCards();
  const existingNonZero = countNonZeroRows(existing);

  if (existingNonZero > 0) {
    cards = existing;
    diagnostics = {
      updatedAt: new Date().toISOString(),
      rowsMapped: 0,
      nonZeroRows: existingNonZero,
      sourceUrlsTried: ESPN_URLS,
      lastError: lastError ? lastError.message : null,
      warning: "No ESPN discipline rows were parsed. Previous cards.json values were preserved."
    };
    caveat += " Warning: no ESPN rows were parsed on the latest run, so previous card totals were preserved.";
  } else {
    cards = emptyCards();
    for (const [team, vals] of Object.entries(CURRENT_ESPN_SEED)) cards[team] = vals;
    diagnostics = {
      updatedAt: new Date().toISOString(),
      rowsMapped: Object.keys(CURRENT_ESPN_SEED).length,
      nonZeroRows: countNonZeroRows(cards),
      sourceUrlsTried: ESPN_URLS,
      lastError: lastError ? lastError.message : null,
      warning: "No ESPN rows were parsed in GitHub Actions, so an initial ESPN snapshot seed was used. Replace this once live parsing succeeds.",
      seedTeams: CURRENT_ESPN_SEED
    };
    caveat += " Warning: live ESPN parsing failed in GitHub Actions, so this run used an initial ESPN snapshot seed.";
  }
}

const output = {
  source,
  updatedAt: new Date().toISOString(),
  scoring: { yellow: 1, red: 3 },
  caveat,
  diagnostics,
  cards
};

await fs.writeFile("cards.json", JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`Wrote cards.json. Rows mapped: ${diagnostics.rowsMapped || 0}; non-zero rows: ${diagnostics.nonZeroRows || 0}.`);
