// identifier.js — parses a raw input string into a typed identifier
// ('vat' | 'siren' | 'siret'), or reports it as malformed.
//
// No per-country VAT number LENGTH/format validation is attempted here on
// purpose: VIES itself is the authoritative source for whether a given
// countryCode + vatNumber pair is well-formed for that member state (it
// replies with an INVALID_INPUT fault otherwise). Duplicating that logic
// with a guessed, inevitably incomplete set of per-country regexes would
// risk rejecting a valid number we simply modeled wrong. We only do the
// structural check needed to ROUTE the request correctly: is this shaped
// like "<2-letter EU/XI country code><alphanumeric>", like a 9-digit SIREN,
// or like a 14-digit SIRET?

// The 28 country codes VIES recognizes: the 27 EU member states (Greece
// uses "EL", not the ISO "GR") plus "XI" for Northern Ireland (post-Brexit
// protocol). Verified 2026-09-04 against multiple VIES integration guides
// (see README "Limits & data sources" for sources) — VIES has no public
// machine-readable list of accepted codes, so this fixed set is the closest
// to an authoritative source available.
export const VIES_COUNTRY_CODES = new Set([
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
    'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
    'SE', 'SI', 'SK', 'XI',
]);

/**
 * @param {string} raw
 * @returns {
 *   | { type: 'vat', input: string, countryCode: string, vatNumber: string }
 *   | { type: 'siren', input: string, siren: string }
 *   | { type: 'siret', input: string, siret: string, siren: string }
 *   | { type: 'malformed', input: string, reason: string }
 * }
 */
export function classifyIdentifier(raw) {
    const input = typeof raw === 'string' ? raw : String(raw ?? '');
    const trimmed = input.trim();

    if (!trimmed) {
        return { type: 'malformed', input, reason: 'Empty identifier.' };
    }

    // Digits-only after stripping common separators (spaces, dots, dashes)
    // -> candidate SIREN (9 digits) or SIRET (14 digits).
    const digitsOnly = trimmed.replace(/[\s.-]/g, '');
    if (/^\d+$/.test(digitsOnly)) {
        if (digitsOnly.length === 9) {
            return { type: 'siren', input, siren: digitsOnly };
        }
        if (digitsOnly.length === 14) {
            return { type: 'siret', input, siret: digitsOnly, siren: digitsOnly.slice(0, 9) };
        }
        return {
            type: 'malformed',
            input,
            reason: `Numeric identifier with ${digitsOnly.length} digits — expected 9 (SIREN) or 14 (SIRET).`,
        };
    }

    // Otherwise, candidate EU VAT number: 2-letter country prefix + rest.
    const cleaned = trimmed.replace(/[\s.-]/g, '').toUpperCase();
    const countryCode = cleaned.slice(0, 2);
    const vatNumber = cleaned.slice(2);

    if (!/^[A-Z]{2}$/.test(countryCode)) {
        return {
            type: 'malformed',
            input,
            reason: 'Does not start with a 2-letter country code, and is not a 9 or 14-digit French number.',
        };
    }
    if (!VIES_COUNTRY_CODES.has(countryCode)) {
        return {
            type: 'malformed',
            input,
            reason: `"${countryCode}" is not a country code VIES recognizes (expected one of: ${[...VIES_COUNTRY_CODES].join(', ')}).`,
        };
    }
    // VIES VAT numbers range from ~2 to 13 alphanumeric characters
    // depending on the member state; this is a loose sanity bound, not a
    // per-country rule — VIES's own INVALID_INPUT fault is authoritative.
    if (!/^[A-Z0-9]{2,13}$/.test(vatNumber)) {
        return {
            type: 'malformed',
            input,
            reason: `After the "${countryCode}" prefix, "${vatNumber}" is not 2-13 alphanumeric characters.`,
        };
    }

    return { type: 'vat', input, countryCode, vatNumber };
}

// French VAT check-digit algorithm, published by the French tax
// administration (DGFiP): key = (12 + 3 * (SIREN mod 97)) mod 97, VAT
// number = "FR" + 2-digit key + 9-digit SIREN. Verified 2026-09-04 against
// two real, live-fetched examples (La Poste SIREN 356000000 -> key 39;
// SNCF SIREN 552049447 -> key 35) — see README "Limits & data sources".
export function frenchVatFromSiren(siren) {
    if (!/^\d{9}$/.test(siren)) {
        throw new Error(`frenchVatFromSiren: "${siren}" is not a 9-digit SIREN.`);
    }
    const sirenNum = BigInt(siren);
    const key = (12n + 3n * (sirenNum % 97n)) % 97n;
    return `FR${String(key).padStart(2, '0')}${siren}`;
}
