// record.js — turns one classified identifier into a stable-shape output
// record, deciding along the way whether this record represents a
// successfully completed verification (chargeable) or a failure (never
// chargeable). See README "Pricing" for the exact charging rule.
//
// FRENCH DGFIP FALLBACK (2026-09-04): for a French VAT number specifically,
// if VIES fails transiently (even after src/vies.js's own retries and
// main.js's end-of-run second pass), this Actor now falls back to checking
// whether the number appears in recherche-entreprises.api.gouv.fr's `tva`
// field — a DIRECT PASS-THROUGH of DGFiP's own official, daily-refreshed
// published list of active French intra-community VAT numbers (see README
// "Limits & data sources" for the full sourcing citation). This is real
// government data, not a guessed/computed check-digit — but it is NOT the
// same legal instrument as a VIES check: EU law (Directive 2006/112/EC
// Art. 138, as amended by Directive (EU) 2018/1910, in force since
// 2020-01-01) makes the buyer's VAT ID being valid *in VIES specifically*
// a substantive condition for the intra-EU VAT exemption — a national
// DGFiP extract is not a substitute for that, even though it is a good-
// faith, sourced, useful signal for many other purposes (KYB, populating
// an invoice's company fields, general due diligence).
//
// To make sure this distinction can NEVER be silently lost by a caller:
//   - `vatValid` is ONLY ever set from an actual VIES response. It stays
//     `null` whenever VIES did not answer, even if the DGFiP fallback
//     found a match — a client must never be able to mistake a fallback
//     record for a VIES-confirmed one by reading `vatValid` alone.
//   - `dgfipVatMatch` (true/false/null) says whether the DGFiP-sourced
//     list contains this VAT number, independent of whether VIES answered.
//   - `vatValidationSource` ('VIES' | 'DGFIP_FALLBACK' | null) says which
//     source, if any, backs the positive signal being reported — 'VIES'
//     whenever `vatValid` was actually set (regardless of true/false, and
//     regardless of what dgfipVatMatch says), 'DGFIP_FALLBACK' only when
//     VIES never answered but the DGFiP list confirms the number, `null`
//     when neither source could confirm anything.
// A DGFiP-fallback record is still billed (see README "Pricing"): a
// bare "not found" against the DGFiP list, with VIES also unavailable,
// stays an uncharged transient failure — the fallback only ever produces
// a charged record on a genuine POSITIVE match, never a negative one (the
// DGFiP list not containing a number is too weak a signal to report as a
// confirmed rejection).

import { log } from './log.js';

import { frenchVatFromSiren } from './identifier.js';
import { lookupSirenOrSiret } from './sirene.js';
import { checkVat } from './vies.js';

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const SIRENE_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// Every record — success or error — has exactly this shape, so the dataset
// is a stable, spreadsheet/BigQuery-friendly table regardless of outcome.
function emptyRecord(input, type) {
    return {
        input,
        type,
        countryCode: null,
        vatNumber: null,
        vatValid: null,
        vatValidationSource: null,
        dgfipVatMatch: null,
        vatCheckedAt: null,
        legalName: null,
        address: null,
        siren: null,
        siret: null,
        naf: null,
        activeStatus: null,
        sources: [],
        charged: false,
        error: null,
    };
}

function normalizeSireneRecord(sireneResult, { preferSiret } = {}) {
    // If we searched by SIRET, prefer that exact establishment's own
    // address/status when it shows up among matching_etablissements
    // (more precise than always falling back to the head office / siege).
    let establishment = sireneResult.siege || null;
    if (preferSiret && Array.isArray(sireneResult.matching_etablissements)) {
        const exact = sireneResult.matching_etablissements.find((e) => e.siret === preferSiret);
        if (exact) establishment = exact;
    }

    const rawStatus = establishment?.etat_administratif ?? sireneResult.etat_administratif ?? null;
    // Legal-unit level uses A/C (Active/Cessee), establishment level uses
    // A/F (Actif/Ferme) — both normalized to the same two-value enum.
    let activeStatus = null;
    if (rawStatus === 'A') activeStatus = 'active';
    else if (rawStatus) activeStatus = 'closed';

    return {
        legalName: sireneResult.nom_complet || sireneResult.nom_raison_sociale || null,
        address: establishment?.adresse || null,
        siren: sireneResult.siren || null,
        siret: establishment?.siret || preferSiret || null,
        naf: establishment?.activite_principale || sireneResult.activite_principale || null,
        activeStatus,
        // Raw DGFiP-sourced list of active French VAT numbers for this
        // SIREN, e.g. ["FR39356000000"] — see file header. May be absent
        // or empty even for a real, active company (see README "Limits").
        tva: Array.isArray(sireneResult.tva) ? sireneResult.tva : [],
    };
}

/**
 * @param {ReturnType<typeof import('./identifier.js').classifyIdentifier>} classified
 * @param {boolean} includeFrenchEnrichment
 * @returns {Promise<object>} a full stable-shape record (see emptyRecord)
 */
export async function buildRecord(classified, includeFrenchEnrichment) {
    if (classified.type === 'malformed') {
        const record = emptyRecord(classified.input, 'malformed');
        record.error = classified.reason;
        return record;
    }

    if (classified.type === 'vat') {
        return buildFromVat(classified, includeFrenchEnrichment);
    }

    // 'siren' or 'siret'
    return buildFromFrenchNumber(classified, includeFrenchEnrichment);
}

async function buildFromVat({ input, countryCode, vatNumber }, includeFrenchEnrichment) {
    const record = emptyRecord(input, 'vat');
    record.countryCode = countryCode;
    record.vatNumber = vatNumber;

    const viesResult = await checkVat({ countryCode, vatNumber });

    if (!viesResult.ok) {
        const viesErrorMessage = `VIES check failed (${viesResult.faultCode ?? 'ERROR'}): ${viesResult.message}`;
        log.warning(`VAT ${countryCode}${vatNumber}: ${viesErrorMessage}`);

        // French DGFiP fallback — see file header. Only attempted for a
        // GENUINELY TRANSIENT VIES failure (viesResult.retryable === true —
        // VIES was unreachable/overloaded, not "this input is invalid"): a
        // definitive fault like INVALID_INPUT means VIES itself judged the
        // number malformed, and the DGFiP list is not a substitute for
        // that judgment call, so no fallback is attempted in that case —
        // it falls straight through as the ordinary uncharged failure
        // below, unchanged. Only attempted for a French VAT number in the
        // standard 11-digit shape, and only ever used for a POSITIVE match
        // (a non-match or a failed SIRENE lookup falls straight through to
        // the ordinary uncharged failure below too).
        if (viesResult.retryable && countryCode === 'FR' && /^\d{11}$/.test(vatNumber)) {
            const siren = vatNumber.slice(2);
            const sireneResult = await lookupSirenOrSiret(siren);
            if (sireneResult.ok && sireneResult.found) {
                const enriched = normalizeSireneRecord(sireneResult.record);
                const expectedVat = `FR${vatNumber}`;
                if (enriched.tva.includes(expectedVat)) {
                    record.legalName = enriched.legalName;
                    record.address = enriched.address;
                    record.siren = enriched.siren;
                    record.siret = enriched.siret;
                    record.naf = enriched.naf;
                    record.activeStatus = enriched.activeStatus;
                    record.dgfipVatMatch = true;
                    record.vatValidationSource = 'DGFIP_FALLBACK';
                    // vatValid stays null on purpose — see file header.
                    record.sources.push(SIRENE_URL);
                    record.charged = true;
                    log.info(`VAT ${countryCode}${vatNumber}: VIES unavailable, recovered via DGFiP fallback (recherche-entreprises).`);
                    return record;
                }
                record.dgfipVatMatch = false;
            } else if (!sireneResult.ok) {
                log.warning(`VAT ${countryCode}${vatNumber}: DGFiP fallback lookup also failed: ${sireneResult.message}`);
            }
        }

        // No usable answer from either source -> genuine transient failure,
        // never charged. main.js's end-of-run retry pass will try this
        // identifier (VIES, then this same fallback) again once more.
        record.error = viesErrorMessage;
        return record;
    }

    // A definitive answer (valid=true OR valid=false) is a completed,
    // usable verification -> chargeable, regardless of the boolean result.
    record.vatValid = viesResult.valid;
    record.vatValidationSource = 'VIES';
    record.vatCheckedAt = viesResult.requestDate;
    record.legalName = viesResult.name;
    record.address = viesResult.address;
    record.sources.push(VIES_URL);
    record.charged = true;

    if (countryCode === 'FR' && includeFrenchEnrichment && /^\d{11}$/.test(vatNumber)) {
        const siren = vatNumber.slice(2);
        const sireneResult = await lookupSirenOrSiret(siren);
        if (sireneResult.ok && sireneResult.found) {
            const enriched = normalizeSireneRecord(sireneResult.record);
            record.legalName = enriched.legalName || record.legalName;
            record.address = enriched.address || record.address;
            record.siren = enriched.siren;
            record.siret = enriched.siret;
            record.naf = enriched.naf;
            record.activeStatus = enriched.activeStatus;
            record.dgfipVatMatch = enriched.tva.includes(`FR${vatNumber}`);
            record.sources.push(SIRENE_URL);
        } else if (!sireneResult.ok) {
            log.warning(`VAT ${countryCode}${vatNumber}: French enrichment lookup failed (non-blocking): ${sireneResult.message}`);
        }
        // sireneResult.ok && !found is left as-is: VIES already confirmed
        // this VAT number, so a missing SIRENE match (e.g. a very recent
        // registration not yet indexed) doesn't invalidate the record.
    }

    return record;
}

async function buildFromFrenchNumber(classified, includeFrenchEnrichment) {
    const isSiret = classified.type === 'siret';
    const queryValue = isSiret ? classified.siret : classified.siren;
    const record = emptyRecord(classified.input, classified.type);
    record.countryCode = 'FR';

    const sireneResult = await lookupSirenOrSiret(queryValue);

    if (!sireneResult.ok) {
        record.error = `recherche-entreprises lookup failed: ${sireneResult.message}`;
        log.warning(`${classified.type.toUpperCase()} ${queryValue}: ${record.error}`);
        return record; // charged stays false
    }

    record.sources.push(SIRENE_URL);

    if (!sireneResult.found) {
        // A definitive "does not exist in the French business register" is
        // itself a completed, usable verification -> chargeable.
        record.activeStatus = 'not_found';
        record.siren = isSiret ? classified.siren : classified.siren;
        record.siret = isSiret ? classified.siret : null;
        record.charged = true;
        return record;
    }

    const enriched = normalizeSireneRecord(sireneResult.record, { preferSiret: isSiret ? classified.siret : null });
    record.legalName = enriched.legalName;
    record.address = enriched.address;
    record.siren = enriched.siren;
    record.siret = enriched.siret;
    record.naf = enriched.naf;
    record.activeStatus = enriched.activeStatus;
    record.charged = true;

    if (includeFrenchEnrichment && enriched.siren) {
        const derivedVat = frenchVatFromSiren(enriched.siren);
        const derivedVatNumberNoPrefix = derivedVat.slice(2);
        // The DGFiP-sourced tva list came for free with the SAME lookup
        // above — no extra call needed to know this before even asking
        // VIES.
        record.dgfipVatMatch = enriched.tva.includes(derivedVat);

        const viesResult = await checkVat({ countryCode: 'FR', vatNumber: derivedVatNumberNoPrefix });
        if (viesResult.ok) {
            record.vatNumber = derivedVatNumberNoPrefix;
            record.vatValid = viesResult.valid;
            record.vatValidationSource = 'VIES';
            record.vatCheckedAt = viesResult.requestDate;
            record.sources.push(VIES_URL);
        } else {
            log.warning(`${classified.type.toUpperCase()} ${queryValue}: VIES cross-check failed (non-blocking): ${viesResult.message}`);
            // Same gate as buildFromVat: only label this DGFIP_FALLBACK if
            // VIES was genuinely unreachable (retryable), not if it gave a
            // definitive verdict some other way — see file header.
            if (viesResult.retryable && record.dgfipVatMatch) {
                // VIES cross-check failed, but we already know (for free)
                // that the DGFiP list confirms this VAT number -> still
                // worth surfacing as a fallback signal, clearly labeled.
                // vatValid stays null. The record was already charged
                // above (the primary SIREN/SIRET check succeeded), so this
                // does not change the billing outcome, only the labeling.
                record.vatNumber = derivedVatNumberNoPrefix;
                record.vatValidationSource = 'DGFIP_FALLBACK';
            }
        }
    }

    return record;
}
