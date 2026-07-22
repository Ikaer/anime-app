/**
 * The assembled-row cache, in its own module purely to keep `slices.ts` and
 * `record.ts` acyclic.
 *
 * `record.ts` fills it; every slice writer in `slices.ts` invalidates it. If the
 * cache lived in `record.ts` (where it is used) the writers would have to import
 * back from it, and `record.ts` already imports every slice reader — so the two
 * files would be mutually recursive. Holding two module-level variables here
 * costs nothing and makes the dependency arrows point one way.
 *
 * The invalidation is belt-and-braces, not the primary mechanism: rows are keyed
 * on the IDENTITY of the parsed slices (jsonStore's parse cache returns the same
 * object until the file's mtime/size changes), so a write from ANOTHER bundle
 * still rebuilds these rows. The explicit clear only covers the same-bundle case
 * one tick sooner.
 *
 * Server-only (the values it holds come from `fs` reads).
 */

import { AnimeRecord } from '@/models/anime';

let cachedAnime: AnimeRecord[] | null = null;
let cachedAnimeInputs: readonly unknown[] | null = null;

/** Cached rows if every cache input is reference-identical to last time, else null. */
export function getCachedRows(inputs: readonly unknown[]): AnimeRecord[] | null {
  if (!cachedAnime || !cachedAnimeInputs) return null;
  if (inputs.length !== cachedAnimeInputs.length) return null;
  return inputs.every((v, i) => v === cachedAnimeInputs![i]) ? cachedAnime : null;
}

export function setCachedRows(rows: AnimeRecord[], inputs: readonly unknown[]): void {
  cachedAnime = rows;
  cachedAnimeInputs = inputs;
}

/** Called by every slice write in `slices.ts` (except the cast one — see there). */
export function invalidateRecordCache(): void {
  cachedAnime = null;
  cachedAnimeInputs = null;
}
