// lib/web.js — safe page fetch (SSRF-guarded, size/time capped, robots.txt
// aware) + readability extraction to clean Markdown, shared by
// endpoints/web-read.js and endpoints/web-extract.js.
//
// Libraries chosen (checked against the npm registry for current, actively
// maintained versions before use — not guessed):
//   @mozilla/readability — the exact extraction engine behind Firefox
//     Reader View; takes a DOM and returns { title, content (HTML), ... }.
//   jsdom — parses the fetched HTML into a DOM for Readability. Used with
//     its SAFE DEFAULTS ONLY (no `runScripts`, no `resources`): the fetched
//     page's own <script> tags never execute and no external resource
//     (image/stylesheet/iframe) is ever loaded — we only parse markup.
//   turndown — converts the extracted article HTML into clean Markdown.
//   robots-parser — a small, spec-compliant robots.txt parser (wildcards
//     supported), used to honor the target site's crawl rules.
//   ipaddr.js — classifies an IP as public ("unicast") vs.
//     private/loopback/link-local/reserved, for the SSRF guard below.
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import robotsParser from "robots-parser";
import ipaddr from "ipaddr.js";
import { lookup as dnsLookup } from "node:dns/promises";
import config from "../config.js";
import { UpstreamError } from "./http.js";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;

// Truthfully identifies this service and links back to it — never spoofs a
// browser. Several sources (see lib/http.js) reject/deprioritize requests
// with no descriptive User-Agent at all.
const USER_AGENT = `x402-web-reader/1.0 (+${config.baseUrl}; automated content reader used by AI agents; honors robots.txt)`;
const ROBOTS_UA_TOKEN = "x402-web-reader";

// --- SSRF guard --------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1", "[::1]"]);

function isPublicIp(ip) {
  try {
    const addr = ipaddr.parse(ip);
    // ipaddr.js buckets every address into a named range; only "unicast"
    // is publicly routable. Everything else (private, loopback, linkLocal,
    // uniqueLocal, reserved, carrierGradeNat, ipv4Mapped, teredo, ...) is
    // refused — deliberately fail-closed on anything we don't recognize.
    return addr.range() === "unicast";
  } catch {
    return false;
  }
}

async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (!bare || BLOCKED_HOSTNAMES.has(bare.toLowerCase()) || bare.toLowerCase().endsWith(".localhost")) {
    throw new UpstreamError(`Refused: "${hostname}" is a local/internal hostname.`, { status: 400 });
  }
  // If it's already a literal IP, ipaddr.parse handles it directly.
  if (ipaddr.isValid(bare)) {
    if (!isPublicIp(bare)) {
      throw new UpstreamError(`Refused: "${hostname}" resolves to a private/internal address.`, { status: 400 });
    }
    return;
  }
  let records;
  try {
    records = await dnsLookup(bare, { all: true, verbatim: true });
  } catch (err) {
    throw new UpstreamError(`Could not resolve host "${hostname}": ${err.message}`, { status: 502 });
  }
  if (records.length === 0 || records.some((r) => !isPublicIp(r.address))) {
    throw new UpstreamError(`Refused: "${hostname}" resolves to a private/internal address.`, { status: 400 });
  }
}

function assertHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamError("Invalid 'url' (must be a well-formed http(s) URL).", { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UpstreamError("Invalid 'url' (only http:// and https:// are allowed).", { status: 400 });
  }
  if (parsed.username || parsed.password) {
    throw new UpstreamError("Invalid 'url' (embedded credentials are not allowed).", { status: 400 });
  }
  return parsed;
}

// --- robots.txt ----------------------------------------------------------

// Fails OPEN (allows the fetch) if robots.txt is missing or unreachable —
// the same convention real crawlers use; a genuinely dead host still fails
// on the main fetch right after this.
async function assertRobotsAllowed(targetUrl) {
  const robotsUrl = `${targetUrl.origin}/robots.txt`;
  let body = "";
  try {
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      redirect: "follow",
    });
    if (res.ok) body = await res.text();
  } catch {
    return; // unreachable robots.txt => treated as "no rules published"
  }
  const robots = robotsParser(robotsUrl, body);
  if (!robots.isAllowed(targetUrl.toString(), ROBOTS_UA_TOKEN)) {
    throw new UpstreamError(`robots.txt at ${robotsUrl} disallows fetching this URL.`, { status: 403 });
  }
}

// --- capped, streamed download -------------------------------------------

async function downloadCapped(targetUrl, signal) {
  const res = await fetch(targetUrl.toString(), {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal,
  });

  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    return { redirectTo: new URL(res.headers.get("location"), targetUrl) };
  }
  if (!res.ok) {
    throw new UpstreamError(`Page fetch failed (HTTP ${res.status}).`, { status: res.status === 404 ? 404 : 502 });
  }

  const declaredLength = Number(res.headers.get("content-length") || 0);
  if (declaredLength > MAX_BYTES) {
    throw new UpstreamError(`Page too large (>${MAX_BYTES / 1024 / 1024} MB declared).`, { status: 413 });
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new UpstreamError(`Page too large (>${MAX_BYTES / 1024 / 1024} MB).`, { status: 413 });
    }
    chunks.push(value);
  }

  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  return { html, finalUrl: targetUrl.toString() };
}

// fetchPageSafely(url) -> { html, finalUrl }
// Validates the URL, refuses private/internal targets, honors robots.txt,
// follows up to MAX_REDIRECTS hops (re-validated at every hop), and caps
// the download at MAX_BYTES within a FETCH_TIMEOUT_MS budget shared across
// the whole chain.
export async function fetchPageSafely(rawUrl) {
  let targetUrl = assertHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new UpstreamError(`Page fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s.`, { status: 504 })),
    FETCH_TIMEOUT_MS
  );

  try {
    await assertPublicHost(targetUrl.hostname);
    await assertRobotsAllowed(targetUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (hop === MAX_REDIRECTS) {
        throw new UpstreamError("Too many redirects (>5).", { status: 502 });
      }
      const result = await downloadCapped(targetUrl, controller.signal);
      if (result.redirectTo) {
        targetUrl = assertHttpUrl(result.redirectTo.toString());
        await assertPublicHost(targetUrl.hostname); // re-validate EVERY hop, not just the first
        continue;
      }
      return result;
    }
    throw new UpstreamError("Too many redirects (>5).", { status: 502 });
  } catch (err) {
    if (err?.name === "AbortError" && controller.signal.reason instanceof UpstreamError) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- extraction to Markdown ------------------------------------------------

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

function cleanMarkdown(md) {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// extractReadable(html, url) -> { title, markdown, wordCount }
// Uses Readability with jsdom's SAFE DEFAULTS (no script execution, no
// external resource loading — only DOM parsing). Falls back to the raw
// <body> when Readability can't identify an article (e.g. a listing page).
export function extractReadable(html, url) {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  const reader = new Readability(document.cloneNode(true));
  const article = reader.parse();

  const title = (article?.title || document.title || "").trim() || null;
  const contentHtml = article?.content || document.body?.innerHTML || "";
  const markdown = cleanMarkdown(turndown.turndown(contentHtml));
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return { title, markdown, wordCount };
}
