/**
 * Returns a random record ID using the Web Crypto API.
 * Works in browsers and in Node 19+ (and in Node 14.17+ via globalThis.crypto).
 */
export function randomId(): string {
  return crypto.randomUUID();
}

/**
 * Derives a stable record ID from a natural key.
 *
 * Normalisation pipeline:
 *   1. Unicode NFKC — collapses compatibility characters (e.g. ﹙ → ().
 *   2. Lowercase — done before decomposition so that combining marks produced
 *      by the lowercase fold (e.g. Turkish İ → i + combining dot above) are
 *      caught by the next two steps.
 *   3. Unicode NFD — decomposes precomposed characters into base + combining marks.
 *   4. Strip \p{M} (combining marks) — removes accents, tone marks, diacritics.
 *   5. Strip every character that is whitespace or Unicode "punctuation",
 *      "symbol", or "separator" category.  Removes spaces, hyphens,
 *      parentheses, slashes, etc. while keeping letters and digits.
 *   6. Guard against an empty result — throws if nothing survives normalisation.
 *   7. Prefix with "k:".
 *
 * Examples:
 *   "Rice (50 kg)" → "k:rice50kg"
 *   "Ògì"          → "k:ogi"   (tone marks stripped)
 *   "İ"            → "k:i"     (Turkish capital I with dot above)
 */
export function naturalKeyId(raw: string): string {
  const normalised = raw
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks (accents, tone marks, diacritics).
    .replace(/\p{M}/gu, '')
    // Strip whitespace and all punctuation / symbol / separator code-points.
    // \p{P} = punctuation, \p{S} = symbol, \p{Z} = separator, \p{C} = other (control chars).
    .replace(/[\p{P}\p{S}\p{Z}\p{C}\s]/gu, '');

  if (normalised.length === 0) {
    throw new Error(
      `naturalKeyId: input "${raw}" produces an empty key after normalisation`,
    );
  }

  return `k:${normalised}`;
}
