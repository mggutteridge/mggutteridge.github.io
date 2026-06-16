# World Cup 2026 Sweepstake Dashboard

This repository powers a static dashboard for running a World Cup 2026 sweepstake, including:

Participants and team assignments
Fixtures, standings, and knockout bracket
Live score updates
Card (discipline) tracking and leaderboard
Prize probability modelling

The system is deliberately simple: a static HTML page backed by a JSON file that is updated by a script.

## File overview

### index.html

This is the main application — a self-contained front-end dashboard.

It:

Defines all participants, teams, groups, and fixtures directly in JavaScript
Renders multiple views:

Prize probability dashboard
Groups / standings
Fixtures and live results
Participants
Card leaderboard
Knockout tree


Fetches live scores from an external API (worldcup26.ir)
Reads discipline data from cards.json and merges it into the UI
Stores state locally in localStorage for resilience

Key behaviours:

Automatically refreshes scores every 60 seconds
Falls back gracefully if APIs fail
Calculates standings and prize probabilities in-browser
Supports filtering via search

The page works fully offline except for live data refreshes.

### cards.json

This is the data source for card (discipline) statistics.
It contains:

Card counts per team (yellow, secondYellow, straightRed)
Scoring rules (e.g. yellow = 1, red = 3)
Metadata such as:

When it was last updated
Source of the data
Diagnostics (API calls, parsing results, warnings)

The frontend reads this file during refresh and updates the Cards leaderboard and Dirty Play Award probabilities.

### update-cards.mjs

This is a Node.js script (misnamed as .txt) used to generatecards.json.
It:

Calls ESPN’s public APIs:

Scoreboard endpoint (for match IDs)
Match summary endpoint (for event data)


Extracts card incidents (yellow/red cards) from match data
Maps events to teams (including alias handling like “USA” vs “United States”)
Deduplicates events to avoid double counting
Skips invalid cases (e.g. VAR-overturned cards)
Produces:

Updated card totals per team
A diagnostics block (API success rates, unmatched events, warnings)


Writes the result back to cards.json

Important logic:

Only processes matches that are in-progress or finished
Uses text parsing and metadata to classify card types
Falls back to existing cards.json if no new data is available

## How it all fits together

update-cards.mjs runs periodically

Fetches match data from ESPN
Produces an updated cards.json


index.html loads in the browser

Fetches:

Live match scores from API
cards.json for discipline data


UI updates automatically

Leaderboards and standings update live
Card totals feed into “Dirty Play Award” and Team discipline leaderboard
