# Mortlake Level Crossing Status

A single static page that guesses whether the road level crossing beside
Mortlake station (Sheen Lane, SW14) is up or down, based on live Realtime
Trains (RTT) data, and shows a countdown to the next change.

**This is a heads-up tool, not a safety system.** Always obey the actual
barriers, lights, and bells at the crossing.

Built against RTT's **next-generation API** at `data.rtt.io` / signup via
`api-portal.rtt.io`. The original `api.rtt.io` portal is deprecated.

## How the estimate works

- Every 30s the page asks RTT for services at Mortlake in the next 45
  minutes (`GET /rtt/location?code=gb-nr:MTL&timeWindow=45`).
- For each service it takes the best available timestamp — actual, then
  live forecast, then estimate, then timetabled — from whichever of
  `pass` / `arrival` / `departure` is most relevant, and assumes the
  barriers are down from **2m30s before** that time to **30s after**.
- Overlapping windows (trains close together) are merged, so the crossing
  is shown as staying down between them rather than flickering open.
- These lead/clear times are a guesstimate — real barrier timing depends
  on signalling this page has no visibility into.

## Why you need a small proxy

RTT's API uses bearer-token auth, and their spec explicitly states tokens
must not ship inside a distributable client app — a GitHub Pages site is
just static files, so anything in `index.html` is visible to anyone who
views source. `rtt-proxy-worker.js` is a small Cloudflare Worker that
holds your token as a server-side secret, calls RTT on the page's behalf,
and returns the JSON with CORS enabled.

## Setup

### 1. Get RTT API credentials

Sign up at [api-portal.rtt.io](https://api-portal.rtt.io/) with an RTT
unified login account and request access. You'll be issued either:

- a long-life **access token**, or
- a long-life **refresh token** (exchanged for short-life access tokens)

The Worker below supports either — you only need to set one of the two
secrets. If unsure which you have, RTT will make it clear at signup, or
you can check via the `/api/info` endpoint once you have a token.

### 2. Deploy the proxy

- Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Worker.
- Replace the default code with the contents of `rtt-proxy-worker.js`.
- Under **Settings → Variables and Secrets**, add **one** of:
  - `RTT_ACCESS_TOKEN` — if you were issued an access token, or
  - `RTT_REFRESH_TOKEN` — if you were issued a refresh token.
- Deploy. You'll get a URL like `https://mortlake-rtt.<you>.workers.dev`.

### 3. Point the page at your proxy

Open `index.html` and set:
```js
const PROXY_BASE = "https://mortlake-rtt.<you>.workers.dev";
```

### 4. Verify the location code

The page queries `gb-nr:MTL` (Network Rail namespace + Mortlake's CRS
code). This should resolve correctly, but if your proxy ever returns a 400
for an invalid query, try Mortlake's TIPLOC instead:
```js
const LOCATION_CODE = "gb-nr:MRTLKE";
```

### 5. Publish to GitHub Pages

Push this repo to GitHub, then in **Settings → Pages** set the source to
your default branch (root). Your page will be live at
`https://<you>.github.io/<repo>/`.

### 6. (Optional) Lock the proxy to your site

In `rtt-proxy-worker.js`, change `ALLOWED_ORIGIN` from `"*"` to your exact
GitHub Pages URL so only your page can call the Worker.

## Tuning

All the knobs are constants at the top of the `<script>` in `index.html`:

| Constant | Default | Meaning |
|---|---|---|
| `LEAD_MS` | 2m30s | assumed barrier-down time before a train |
| `CLEAR_MS` | 30s | assumed barrier-up delay after a train clears |
| `POLL_MS` | 30s | how often the page re-fetches train data |
| `LOOKAHEAD_MS` | 40min | how far ahead it looks for trains |
| `QUERY_WINDOW_MIN` | 45min | window requested from the RTT API |

There's also a line in the fetch logic that currently skips non-passenger
services (freight/empty stock). Those still trigger the crossing in real
life — remove the `inPassengerService === false` filter in `index.html` if
you want them included, though RTT's freight coverage/timing is less
reliable.

## Files

- `index.html` — the page itself, deploy as-is via GitHub Pages.
- `rtt-proxy-worker.js` — deploy separately to Cloudflare Workers; keeps
  your RTT token off the public page.
- `README.md` — this file.
