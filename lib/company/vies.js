// vies.js — client for the European Commission's official VIES REST API.
//
// Endpoint and schema verified live 2026-09-03/04 against the official
// Swagger spec (https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml)
// and by calling the production endpoint directly. See README "Limits &
// data sources" for the full citation. No API key: VIES is open, unauthenticated.
//
// RESILIENCE NOTE (2026-09-04): the first real run on the Apify platform
// (build 0.1.1) failed a check that passes reliably from a personal IP
// locally. Apify's outbound IPs are shared across many concurrent
// customers' Actor runs, and VIES enforces its concurrency limits per
// member state (MS_MAX_CONCURRENT_REQ) and globally
// (GLOBAL_MAX_CONCURRENT_REQ) — so the quota that matters is consumed by
// third parties we have no visibility into, independent of our own
// request rate. Two changes address this, both in this file:
//   1. Much more patient retry/backoff (see RETRY config below), with
//      randomized jitter — critical on a shared IP, since without jitter
//      many Apify containers hitting the same backoff schedule would
//      retry in lockstep and re-collide.
//   2. VIES limits are PER MEMBER STATE, not global to our own traffic —
//      so two concurrent checks for the same country only add to OUR OWN
//      contribution to that country's queue, for no benefit (VIES answers
//      requests for one country serially under load) and every risk (more
//      of our own requests competing at once makes MS_MAX_CONCURRENT_REQ
//      MORE likely, not less). checkVat() below serializes calls that
//      share a countryCode via a per-country queue, while calls for
//      DIFFERENT countries still run fully in parallel.

import { log } from './log.js';

const VIES_CHECK_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

// Fault codes VIES can return in `errorWrappers[].error`.
//
// Source for the transient/definitive classification below: the European
// Commission's own VIES "Technical information" page
// (https://ec.europa.eu/taxation_customs/vies/#/technical-information,
// consulted 2026-09-04). That page is a client-rendered Angular app that
// this Actor's tooling cannot fetch/render directly (confirmed: the raw
// HTML is an empty shell, and the compiled JS bundle does not contain the
// fault-code strings as static text, so they are loaded from a separate,
// undiscovered content source at runtime) — the wording below was cross-
// checked as consistent, word-for-word in places (e.g. "the maximum number
// of concurrent requests for this Member State has been reached ... Please
// re-submit your request later or contact TAXUD-VIESWEB@ec.europa.eu"),
// across a search engine's index of that official page AND two independent
// third-party VIES integration references quoting the same official
// wording: https://vatvalidate.eu/vies-errors and
// https://viesapi.eu/vies-error-the-maximum-number-of-concurrent-requests-has-been-reached-fr/
// (both consulted 2026-09-04). No single source could be rendered and
// quoted directly by this tooling end-to-end — flagged here rather than
// silently presented as independently verified from the primary source.
//
// Classification (cross-checked across all of the above):
//   - SERVICE_UNAVAILABLE: "an error was encountered either at the network
//     level or the Web application level, try again later" -> transient.
//   - MS_UNAVAILABLE: "the application at the Member State is not replying
//     or not available ... try again later" -> transient.
//   - TIMEOUT: "the application did not receive a reply within the
//     allocated time period" -> transient.
//   - MS_MAX_CONCURRENT_REQ / MS_MAX_CONCURRENT_REQ_TIME: "the maximum
//     number of concurrent requests for this Member State has been
//     reached ... re-submit your request later" -> transient, and the
//     literal cause of the failure this fix addresses. The "_TIME" variant
//     is the same congestion signal measured over a time window rather
//     than an instantaneous counter — same remedy (wait, retry).
//   - GLOBAL_MAX_CONCURRENT_REQ / GLOBAL_MAX_CONCURRENT_REQ_TIME: the same
//     congestion signal at the whole-VIES-gateway level rather than one
//     member state -> transient, same reasoning.
//   - INVALID_INPUT: the countryCode/vatNumber sent was malformed for that
//     member state -> definitive, retrying sends the exact same bad input.
//   - INVALID_REQUESTER_INFO: only relevant when requester identification
//     fields are sent (this Actor never sends them) -> definitive.
//   - VAT_BLOCKED / IP_BLOCKED: an explicit block -> definitive; retrying
//     (especially quickly) would only be counterproductive.
const RETRYABLE_FAULTS = new Set([
    'SERVICE_UNAVAILABLE',
    'MS_UNAVAILABLE',
    'TIMEOUT',
    'GLOBAL_MAX_CONCURRENT_REQ',
    'GLOBAL_MAX_CONCURRENT_REQ_TIME',
    'MS_MAX_CONCURRENT_REQ',
    'MS_MAX_CONCURRENT_REQ_TIME',
]);

const NON_RETRYABLE_FAULTS = new Set([
    'INVALID_INPUT',
    'INVALID_REQUESTER_INFO',
    'VAT_BLOCKED',
    'IP_BLOCKED',
]);

// Retry policy for transient faults. Deliberately more patient than a
// single-tenant/personal-IP client would need, because on Apify's shared
// outbound IPs the contention causing MS_MAX_CONCURRENT_REQ comes from
// OTHER customers' runs as much as our own — see file header.
//   - up to 6 retries (7 attempts total), comfortably above "at least 5".
//   - exponential backoff: 3s, 6s, 12s, 24s, 30s, 30s (capped), each
//     multiplied by a wide random jitter factor (0.5x-1.6x) so that many
//     Apify containers retrying the same fault at the same instant spread
//     out instead of re-colliding in lockstep — this matters more than the
//     exact backoff curve on a shared IP (see file header point 1).
//   - a hard 90-second total-time budget PER IDENTIFIER: once the
//     cumulative time already spent waiting/retrying for this one
//     identifier would exceed the budget, retrying stops even if attempts
//     remain, so one contested identifier can never make a whole batch run
//     unreasonably long. 90s was chosen as roughly 6 backoff steps at
//     their capped/jittered worst case (up to ~6 x 30s x 1.6 ≈ 288s
//     uncapped by budget; the budget is what actually bounds the wait, not
//     the retry count, by design) while still giving VIES multiple minutes
//     of real wall-clock time to clear a burst of contention, which is the
//     whole point of retrying a shared-IP-only failure mode.
// x402 (10/11/2026) : budget ramene de 90 s a 20 s — ici un agent attend la
// reponse HTTP en direct (pas un run Apify en lot). Si VIES ne repond pas a
// temps, record.js bascule sur la liste DGFiP (France) ou renvoie une erreur
// (503, donc jamais facturee : x402 ne regle qu'une reponse reussie).
const RETRY = {
    maxRetries: 4,
    baseDelayMs: 1500,
    maxDelayMs: 8_000,
    totalTimeBudgetMs: 20_000,
    jitterMin: 0.5,
    jitterMax: 1.6,
};

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function checkVatWithRetry({ countryCode, vatNumber }, options = {}) {
    const maxRetries = options.maxRetries ?? RETRY.maxRetries;
    const baseDelayMs = options.baseDelayMs ?? RETRY.baseDelayMs;
    const maxDelayMs = options.maxDelayMs ?? RETRY.maxDelayMs;
    const totalTimeBudgetMs = options.totalTimeBudgetMs ?? RETRY.totalTimeBudgetMs;

    const startedAt = Date.now();
    let lastFailure = { ok: false, retryable: true, faultCode: 'UNKNOWN', message: 'No attempt made.' };
    let attempt = 0;

    for (attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const rawDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            const jitter = rawDelay * (RETRY.jitterMin + Math.random() * (RETRY.jitterMax - RETRY.jitterMin));
            const elapsed = Date.now() - startedAt;
            const remainingBudget = totalTimeBudgetMs - elapsed;
            if (remainingBudget <= 0) {
                log.warning(`VIES ${countryCode}${vatNumber}: giving up after ${attempt} attempt(s), ${Math.round(elapsed / 1000)}s — total retry time budget (${totalTimeBudgetMs / 1000}s) exhausted (last fault: ${lastFailure.faultCode}).`);
                break;
            }
            const actualDelay = Math.min(jitter, remainingBudget);
            log.debug(`VIES retry ${attempt}/${maxRetries} for ${countryCode}${vatNumber} in ${Math.round(actualDelay)}ms (last fault: ${lastFailure.faultCode})`);
            await sleep(actualDelay);
        }

        let response;
        try {
            response = await fetch(VIES_CHECK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ countryCode, vatNumber }),
                signal: AbortSignal.timeout(20_000),
            });
        } catch (err) {
            lastFailure = { ok: false, retryable: true, faultCode: 'NETWORK_ERROR', message: err?.message || String(err) };
            continue;
        }

        let body;
        try {
            body = await response.json();
        } catch (err) {
            lastFailure = { ok: false, retryable: true, faultCode: 'INVALID_RESPONSE', message: `VIES returned non-JSON (HTTP ${response.status}): ${err?.message || err}` };
            continue;
        }

        if (body.actionSucceed === false) {
            const faultCode = body.errorWrappers?.[0]?.error || 'UNKNOWN_FAULT';
            const message = body.errorWrappers?.[0]?.message || 'VIES reported a failure with no message.';
            const retryable = RETRYABLE_FAULTS.has(faultCode) || (!NON_RETRYABLE_FAULTS.has(faultCode) && !RETRYABLE_FAULTS.has(faultCode));
            lastFailure = { ok: false, retryable, faultCode, message };
            if (!retryable) return lastFailure; // e.g. INVALID_INPUT — retrying would never help
            continue;
        }

        // Success shape, per the Swagger spec: { countryCode, vatNumber,
        // requestDate, valid, name?, address?, ... }. name/address come
        // back as the literal string "---" when unavailable for that
        // member state — normalize that to null.
        const normalize = (s) => (typeof s === 'string' && s.trim() !== '' && s !== '---' ? s : null);
        return {
            ok: true,
            valid: body.valid === true,
            name: normalize(body.name),
            address: normalize(body.address),
            requestDate: body.requestDate || new Date().toISOString(),
        };
    }

    if (lastFailure.retryable) {
        // Distinguish, in the message text alone (no extra field — keeps
        // the existing stable output schema unchanged), a transient
        // failure with retries exhausted from a genuinely invalid/blocked
        // input: a client can tell them apart without reading logs by
        // this exact wording, vs. a definitive VIES fault code appearing
        // directly in the message for the non-retryable case.
        return {
            ...lastFailure,
            message: `VIES temporarily unavailable after ${attempt} attempt(s) (last fault: ${lastFailure.faultCode}): retry later.`,
        };
    }
    return lastFailure;
}

// Per-country-code serialization: VIES's concurrency limits are per member
// state (MS_MAX_CONCURRENT_REQ) — two checks for the same country queued
// back-to-back only add to our own contribution to that country's limit,
// with no upside, while two checks for DIFFERENT countries are unrelated
// queues at VIES and gain nothing from being serialized with each other.
// One promise-chain queue per countryCode, created lazily.
const countryQueues = new Map();

/**
 * Calls VIES for one countryCode + vatNumber pair, with retry + exponential
 * backoff (with jitter) on transient/load-related faults only, and
 * serialized against any other in-flight call for the SAME countryCode
 * (calls for different countries run fully in parallel). Never throws on a
 * VIES business fault (e.g. INVALID_INPUT) — those are returned as a
 * structured failure so the caller can build an honest error record
 * without a charge. See RETRY above and the file header for the policy.
 *
 * @param {{ countryCode: string, vatNumber: string }} params
 * @param {{ maxRetries?: number, baseDelayMs?: number, maxDelayMs?: number, totalTimeBudgetMs?: number }} [options]
 * @returns {Promise<
 *   | { ok: true, valid: boolean, name: string | null, address: string | null, requestDate: string }
 *   | { ok: false, retryable: boolean, faultCode: string, message: string }
 * >}
 */
export function checkVat(params, options = {}) {
    const { countryCode } = params;
    const previous = countryQueues.get(countryCode) ?? Promise.resolve();
    // Chain onto the same country's queue regardless of outcome (a
    // .catch/.finally-free chain here would let one rejection break the
    // chain for everyone after it — checkVatWithRetry never rejects, it
    // always resolves to a { ok, ... } object, so plain .then() is safe).
    const next = previous.then(() => checkVatWithRetry(params, options));
    // Store a non-throwing tail so the NEXT call's `previous` always
    // resolves even if something upstream ever changes; current
    // checkVatWithRetry never throws, so this is a defensive no-op today.
    countryQueues.set(countryCode, next.catch(() => {}));
    return next;
}
