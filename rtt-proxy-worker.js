/**
 * Proxy for the Realtime Trains (RTT) next-generation API (data.rtt.io).
 *
 * Why this exists: RTT's API spec requires that tokens never ship inside a
 * distributable client app (see the "Authentication" section at
 * https://realtimetrains.github.io/api-specification/). A GitHub Pages site
 * is just static files anyone can view-source, so the token has to live
 * somewhere else — this Worker. It holds your token as an encrypted secret,
 * calls RTT server-side, and hands back the JSON with CORS headers so your
 * GitHub Pages page can read it.
 *
 * Supports either kind of credential RTT may issue you:
 *   - a long-life ACCESS token (set RTT_ACCESS_TOKEN) — used directly, or
 *   - a long-life REFRESH token (set RTT_REFRESH_TOKEN) — this Worker
 *     exchanges it for a short-life access token on each request via
 *     /api/get_access_token.
 * Set exactly one of the two.
 *
 * Deploy (free tier is plenty for this):
 *   1. https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 *   2. Paste this file in as the Worker's code
 *   3. Settings -> Variables and Secrets -> add EITHER:
 *        RTT_ACCESS_TOKEN = your access token
 *      OR
 *        RTT_REFRESH_TOKEN = your refresh token
 *      (from your account at https://api-portal.rtt.io)
 *   4. Deploy, then copy the workers.dev URL into PROXY_BASE in index.html
 *
 * Optional hardening: replace "*" below with your exact
 * https://<you>.github.io origin once it's live, so only your site can
 * call this worker.
 */

const ALLOWED_ORIGIN = "*"; // tighten to e.g. "https://yourname.github.io"
const RTT_BASE = "https://data.rtt.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function getAccessToken(env) {
  if (env.RTT_ACCESS_TOKEN) return env.RTT_ACCESS_TOKEN;

  if (env.RTT_REFRESH_TOKEN) {
    const resp = await fetch(`${RTT_BASE}/api/get_access_token`, {
      headers: { Authorization: `Bearer ${env.RTT_REFRESH_TOKEN}` },
    });
    if (!resp.ok) {
      throw new Error(`Could not exchange refresh token (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    if (!data.token) throw new Error("Refresh exchange returned no token");
    return data.token;
  }

  throw new Error("Set RTT_ACCESS_TOKEN or RTT_REFRESH_TOKEN on this Worker");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const incoming = new URL(request.url);

    // Only forward to the location line-up endpoint — keeps this Worker
    // from becoming an open proxy for arbitrary RTT paths.
    if (incoming.pathname !== "/rtt/location") {
      return new Response(JSON.stringify({ error: "Unsupported path" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let token;
    try {
      token = await getAccessToken(env);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const upstream = RTT_BASE + incoming.pathname + incoming.search;
    const upstreamResp = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // RTT returns 204 with no body when a query is valid but finds nothing —
    // pass that straight through rather than trying to read/forward a body.
    if (upstreamResp.status === 204) {
      return new Response(null, { status: 204, headers: cors });
    }

    const body = await upstreamResp.text();
    return new Response(body, {
      status: upstreamResp.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
