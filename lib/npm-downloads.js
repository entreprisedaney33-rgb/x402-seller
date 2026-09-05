// lib/npm-downloads.js — npm download counts (api.npmjs.org, public, no key)
// for the 2 MCP packages this project publishes: x402-seller-mcp and
// @dm2233/agent-data-mcp. Feeds GET /stats' `npm_downloads` field, read by
// the Jarvis "Crypto x402" tile — adoption numbers only, NEVER mixed into
// the payment/revenue figures computed in lib/stats.js.
//
// Deliberately uses ONLY GET /downloads/range/{start}:{end}/{package} — NOT
// the /downloads/point/last-day or /downloads/point/last-week convenience
// aliases. Verified live: those two aliases currently answer with a frozen,
// stale window (days in the past, for every package tested, ours and
// well-known ones alike) while /range returns accurate day-by-day counts up
// to today. So the 24h/7d/since-publish breakdown below is computed here,
// from raw daily counts, using npm's own documented semantics: the CURRENT
// UTC day's count is never complete (npm only finalizes a day's count the
// next day) — so "last_24h" is the last COMPLETE UTC day (yesterday), and
// "last_7d" is the 7 complete UTC days ending yesterday. "since_publish"
// does include today (partial, usually 0) — verified against the real
// "Weekly Downloads" figure npmjs.com's own package page displays for a
// package younger than a week, which matches a since-publish-through-today
// sum, not a stale last-week window.
//
// A package published in roughly the last 1-2 days can be entirely absent
// from npm's download-counting pipeline yet — GET /downloads/range then
// answers 404 "package not found" even though the package itself is live on
// the registry (verified on @dm2233/agent-data-mcp a few hours after
// publish). That is reported as status "not_indexed_yet", never as an
// error — a brand-new package legitimately has no download data yet, that
// is not the same as a request failure.
import { fetchJson, UpstreamError } from "./http.js";
import { cached } from "./cache.js";

// The 2 packages this project publishes, with their REAL publish date
// (checked via `npm view <package> time.created`, never guessed).
const PACKAGES = [
  { name: "x402-seller-mcp", publishDate: "2026-09-02" },
  { name: "@dm2233/agent-data-mcp", publishDate: "2026-09-05" },
];

function toDateStr(date) {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD", UTC
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

function sumRange(dailyMap, startStr, endStr) {
  let sum = 0;
  for (let day = startStr; day <= endStr; day = addDaysUTC(day, 1)) {
    sum += dailyMap[day] || 0;
  }
  return sum;
}

async function fetchOnePackage({ name, publishDate }) {
  const today = toDateStr(new Date());
  const yesterday = addDaysUTC(today, -1);
  const sevenDayStart = addDaysUTC(yesterday, -6); // 7 complete UTC days ending yesterday
  // One wide range call per package (earliest useful bound -> today) instead
  // of 3 separate calls — the 24h/7d/since-publish figures below are all
  // derived from this single response.
  const rangeStart = sevenDayStart < publishDate ? sevenDayStart : publishDate;

  let payload;
  try {
    payload = await fetchJson(`https://api.npmjs.org/downloads/range/${rangeStart}:${today}/${name}`);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) {
      return {
        package: name,
        publish_date: publishDate,
        status: "not_indexed_yet",
        last_24h: null,
        last_7d: null,
        since_publish: null,
      };
    }
    // Any other failure (network, timeout, npm 5xx/rate-limit) must never
    // take down GET /stats as a whole — report this one package as
    // unavailable and let the rest of the response (payment figures, the
    // other package) go out unaffected.
    console.error(`npm-downloads: fetch failed for "${name}":`, err.message);
    return {
      package: name,
      publish_date: publishDate,
      status: "unavailable",
      last_24h: null,
      last_7d: null,
      since_publish: null,
    };
  }

  const dailyMap = {};
  for (const d of payload.downloads || []) dailyMap[d.day] = d.downloads;

  return {
    package: name,
    publish_date: publishDate,
    status: "ok",
    last_24h: dailyMap[yesterday] || 0,
    last_7d: sumRange(dailyMap, sevenDayStart, yesterday),
    since_publish: sumRange(dailyMap, publishDate, today),
  };
}

async function computeNpmDownloadsUncached() {
  const results = await Promise.all(PACKAGES.map(fetchOnePackage));
  const byPackage = {};
  for (const r of results) byPackage[r.package] = r;
  return { fetched_at: new Date().toISOString(), packages: byPackage };
}

// Cached a few hours: these are npm's own daily-granularity counts, so
// polling them on every tile load (or even every minute, like GET /stats
// itself) would gain nothing and just hammer a free public API.
const NPM_DOWNLOADS_TTL_MS = 3 * 60 * 60 * 1000; // 3h

export function computeNpmDownloads() {
  return cached("npm-downloads-tile", NPM_DOWNLOADS_TTL_MS, computeNpmDownloadsUncached);
}
