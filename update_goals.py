#!/usr/bin/env python3
"""Update goals.json from openfootball using a fastest-minute candidates model.

For each team, goals.json stores every goal in that team's current fastest
recorded minute, not just one goal. This avoids losing information when the same
team scores twice in the same minute.

Manual seconds are preserved per candidate when the same candidate still exists.
If a team records a new faster minute, the candidate list is replaced and seconds
start as null for the new candidates.
"""
from __future__ import annotations

import json
import pathlib
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Any

OPENFOOTBALL_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
OUT = pathlib.Path("goals.json")

TEAMS = [
    "Mexico", "South Africa", "Korea Republic", "Czechia",
    "Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland",
    "Brazil", "Morocco", "Haiti", "Scotland", "USA", "Paraguay", "Australia", "Türkiye",
    "Germany", "Curaçao", "Côte d'Ivoire", "Ecuador", "Netherlands", "Japan", "Sweden", "Tunisia",
    "Belgium", "Egypt", "IR Iran", "New Zealand", "Spain", "Cabo Verde", "Saudi Arabia", "Uruguay",
    "France", "Senegal", "Iraq", "Norway", "Argentina", "Algeria", "Austria", "Jordan",
    "Portugal", "Colombia", "Uzbekistan", "Congo DR", "England", "Croatia", "Ghana", "Panama",
]

TEAM_MAP = {
    "south korea": "Korea Republic",
    "czech republic": "Czechia",
    "ivory coast": "Côte d'Ivoire",
    "cote d'ivoire": "Côte d'Ivoire",
    "côte d’ivoire": "Côte d'Ivoire",
    "dr congo": "Congo DR",
    "dem. rep. congo": "Congo DR",
    "democratic republic of congo": "Congo DR",
    "iran": "IR Iran",
    "cape verde": "Cabo Verde",
    "turkey": "Türkiye",
    "turkiye": "Türkiye",
    "curacao": "Curaçao",
    "united states": "USA",
    "u.s.a.": "USA",
    "bosnia": "Bosnia and Herzegovina",
    "bosnia & herzegovina": "Bosnia and Herzegovina",
}

def norm_tokens(s: str) -> list[str]:
    return "".join(ch.lower() if ch.isalnum() else " " for ch in str(s or "")).split()

def canon(name: str | None) -> str | None:
    if not name:
        return None
    key = str(name).lower().strip()
    if key in TEAM_MAP:
        return TEAM_MAP[key]
    n = norm_tokens(name)
    for team in TEAMS:
        if norm_tokens(team) == n:
            return team
    return None

def parse_minute(value: Any) -> int | None:
    if value is None:
        return None
    txt = str(value).strip()
    if not txt:
        return None
    # openfootball normally has "9". Tolerate stoppage-time strings by taking
    # the base minute, because the dashboard prize is currently minute-based.
    head = txt.split("+")[0]
    try:
        minute = int(head)
    except ValueError:
        return None
    return minute if minute > 0 else None

def seconds_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= 59 else None

def candidate_id(c: dict[str, Any]) -> str:
    parts = [
        c.get("minute", ""),
        c.get("scorer", ""),
        c.get("opponent", ""),
        c.get("matchId", c.get("match_id", "")),
        c.get("sourceIndex", c.get("source_index", "")),
    ]
    return "|".join(str(p or "").strip().lower() for p in parts)

def load_existing() -> dict[str, Any]:
    if not OUT.exists():
        return {"goals": {}}
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"goals": {}}
    except Exception as exc:
        print(f"Could not read existing goals.json: {exc}", file=sys.stderr)
        return {"goals": {}}

def existing_candidates_for_team(existing_goals: dict[str, Any], team: str) -> dict[str, dict[str, Any]]:
    """Return old candidates keyed by stable candidate id.

    Also supports the earlier single-goal format, so existing manual seconds are
    not lost when migrating.
    """
    value = existing_goals.get(team) or {}
    if not isinstance(value, dict):
        return {}
    raw_candidates = value.get("candidates") if isinstance(value.get("candidates"), list) else [value]
    out: dict[str, dict[str, Any]] = {}
    inherited_minute = value.get("minute")
    for c in raw_candidates:
        if not isinstance(c, dict):
            continue
        cc = dict(c)
        if "minute" not in cc and inherited_minute is not None:
            cc["minute"] = inherited_minute
        out[candidate_id(cc)] = cc
    return out

def fetch_openfootball() -> dict[str, Any]:
    req = urllib.request.Request(OPENFOOTBALL_URL, headers={"User-Agent": "wc-sweepstake-goals-updater"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main() -> int:
    existing_doc = load_existing()
    existing_goals = existing_doc.get("goals", existing_doc if isinstance(existing_doc, dict) else {}) or {}

    raw = fetch_openfootball()
    matches = raw.get("matches", []) if isinstance(raw, dict) else []

    all_goals_by_team: dict[str, list[dict[str, Any]]] = {}
    for match_pos, m in enumerate(matches):
        if not isinstance(m, dict):
            continue
        t1 = canon(m.get("team1"))
        t2 = canon(m.get("team2"))
        match_id = m.get("num") or m.get("id") or m.get("match_id") or str(match_pos + 1)
        date = m.get("date") or ""
        for side, team, opponent, goals in (("home", t1, t2, m.get("goals1")), ("away", t2, t1, m.get("goals2"))):
            if not team or not isinstance(goals, list):
                continue
            for goal_pos, goal in enumerate(goals):
                if not isinstance(goal, dict):
                    continue
                minute = parse_minute(goal.get("minute"))
                if minute is None:
                    continue
                candidate = {
                    "minute": minute,
                    "seconds": None,
                    "scorer": goal.get("name") or "",
                    "opponent": opponent or "",
                    "matchId": match_id,
                    "date": date,
                    # sourceIndex disambiguates two same-minute, same-scorer records
                    # if the feed ever contains such duplicates.
                    "sourceIndex": f"{match_id}:{side}:{goal_pos}",
                }
                all_goals_by_team.setdefault(team, []).append(candidate)

    goals_out: dict[str, Any] = {}
    for team, team_goals in all_goals_by_team.items():
        if not team_goals:
            continue
        fastest_minute = min(g["minute"] for g in team_goals)
        candidates = [g for g in team_goals if g["minute"] == fastest_minute]
        old_by_id = existing_candidates_for_team(existing_goals, team)
        enriched = []
        for c in candidates:
            old = old_by_id.get(candidate_id(c))
            if old:
                c["seconds"] = seconds_or_none(old.get("seconds"))
            enriched.append(c)

        old_record = existing_goals.get(team) if isinstance(existing_goals, dict) else {}
        selected = None
        if isinstance(old_record, dict):
            previous_selected = old_record.get("selectedCandidateId") or old_record.get("selectedCandidate") or old_record.get("winnerId")
            if previous_selected and any(candidate_id(c) == str(previous_selected).lower().strip() for c in enriched):
                selected = str(previous_selected).lower().strip()

        goals_out[team] = {
            "minute": fastest_minute,
            "selectedCandidateId": selected,
            "candidates": enriched,
        }

    output = {
        "source": "openfootball/worldcup.json 2026/worldcup.json",
        "sourceUrl": OPENFOOTBALL_URL,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "For each team, candidates contains every goal in that team's current fastest minute. Edit candidate seconds manually (0-59) to break same-minute ties. selectedCandidateId is optional; if omitted, dashboard chooses the lowest minute+seconds candidate.",
        "goals": dict(sorted(goals_out.items())),
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_candidates = sum(len(v.get("candidates", [])) for v in goals_out.values())
    print(f"Wrote {OUT} with {len(goals_out)} team record(s) and {total_candidates} candidate goal(s).")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
