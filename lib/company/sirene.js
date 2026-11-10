// sirene.js — client for the official French "recherche-entreprises" API
// (recherche-entreprises.api.gouv.fr), maintained by DINUM, backed by
// INSEE/SIRENE + INPI data. Open access, no API key.
//
// Endpoint, field names and rate limit verified live 2026-09-03/04 against
// the live OpenAPI spec (https://recherche-entreprises.api.gouv.fr/openapi.json)
// and by calling the production endpoint directly. See README "Limits &
// data sources" for the full citation.

import { log } from './log.js';

const SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// Documented rate limit: 7 requests/second per IP, 30/second per ASN
// (source cited in README). The API replies HTTP 429 with a Retry-After
// header when exceeded; we honor it.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Looks up a French company by its SIREN (9 digits) or SIRET (14 digits).
 * The API treats a `q` value of exactly 9 or 14 digits as a direct lookup
 * (all other filters ignored) — see the OpenAPI spec's /search description.
 *
 * @param {string} sirenOrSiret
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<
 *   | { ok: true, found: true, record: object }
 *   | { ok: true, found: false }
 *   | { ok: false, retryable: boolean, message: string }
 * >}
 */
// x402 (10/11/2026) : resultat positif mis en cache 10 min, pour que
// l'endpoint puisse relire la fiche brute (dirigeants, finances...) sans
// second appel a l'API publique juste apres record.js.
const memo = new Map();
const MEMO_MS = 10 * 60 * 1000;
export async function lookupSirenOrSiret(sirenOrSiret, options = {}) {
    const hit = memo.get(sirenOrSiret);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await lookupSirenOrSiretUncached(sirenOrSiret, options);
    if (value.ok && value.found) {
        if (memo.size > 500) memo.clear();
        memo.set(sirenOrSiret, { value, expiresAt: Date.now() + MEMO_MS });
    }
    return value;
}

async function lookupSirenOrSiretUncached(sirenOrSiret, options = {}) {
    const maxRetries = options.maxRetries ?? 4;
    const baseDelayMs = options.baseDelayMs ?? 1500;

    let lastFailure = { ok: false, retryable: true, message: 'No attempt made.' };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delay = baseDelayMs * 2 ** (attempt - 1);
            const jitter = delay * (0.8 + Math.random() * 0.4);
            log.debug(`recherche-entreprises retry ${attempt}/${maxRetries} for ${sirenOrSiret} in ${Math.round(jitter)}ms`);
            await sleep(jitter);
        }

        const url = new URL(SEARCH_URL);
        url.searchParams.set('q', sirenOrSiret);
        url.searchParams.set('per_page', '1');

        let response;
        try {
            response = await fetch(url, {
                headers: {
                    // The API's own docs recommend an explicit, descriptive
                    // User-Agent on every request.
                    'User-Agent': 'apify-actor-eu-vat-siren-check/0.1 (invoice-ready company records)',
                },
                signal: AbortSignal.timeout(15_000),
            });
        } catch (err) {
            lastFailure = { ok: false, retryable: true, message: err?.message || String(err) };
            continue;
        }

        if (response.status === 429) {
            const retryAfterHeader = response.headers.get('Retry-After');
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
            lastFailure = { ok: false, retryable: true, message: `HTTP 429 (rate limited), Retry-After: ${retryAfterHeader ?? 'not set'}` };
            if (retryAfterMs && Number.isFinite(retryAfterMs)) {
                log.debug(`recherche-entreprises rate-limited, honoring Retry-After: ${retryAfterMs}ms`);
                await sleep(retryAfterMs);
            }
            continue;
        }

        if (!response.ok) {
            const retryable = RETRYABLE_STATUS.has(response.status);
            lastFailure = { ok: false, retryable, message: `HTTP ${response.status} from recherche-entreprises.` };
            if (!retryable) return lastFailure;
            continue;
        }

        let body;
        try {
            body = await response.json();
        } catch (err) {
            lastFailure = { ok: false, retryable: true, message: `Non-JSON response: ${err?.message || err}` };
            continue;
        }

        const results = Array.isArray(body.results) ? body.results : [];
        if (results.length === 0) {
            return { ok: true, found: false };
        }
        return { ok: true, found: true, record: results[0] };
    }

    return lastFailure;
}
