/**
 * « Anime court » — the bounded-commitment filter.
 *
 * One question, asked on the recommendation feed: *what can I start tonight and
 * finish, without signing up for four more cours*. That is two conditions, and
 * neither one alone answers it — a 12-episode first season of a five-season
 * franchise is not a short watch, and a self-contained 50-episode show is not
 * either.
 *
 * Pure and client-safe (no `fs`): the relation index is derived from the records
 * the caller already holds, `domain/relations.ts`' contract.
 *
 * ⚠️ **An unknown episode count does NOT pass.** `numEpisodes` is `0`/absent on
 * everything MAL has not finished counting — currently-airing shows above all —
 * so a `<= 15` test written as `(numEpisodes || 0) <= 15` admits exactly the
 * population whose length is the open question, and admits it silently: the card
 * renders like any other, and the reader finds out at episode 25. "Known, and
 * short" is the only honest reading of the filter's own label.
 *
 * ⚠️ **"One season" is decided on the relation GRAPH, not on a title regex or a
 * season field.** `DIRECT_RELATIONS` — sequel/prequel, `domain/franchise.ts`'
 * direct line — is the set that means "the story continues elsewhere". Side
 * stories, OVAs, recap films and spin-offs are deliberately NOT disqualifying:
 * they hang off the show rather than extending it, so skipping them still leaves
 * a complete watch. The edge resolution is what makes this work at all — MAL's
 * `catalog.relatedAnime` is populated on 48 of ~25k titles, so a check reading
 * it alone would call nearly every sequel-having show standalone (see
 * `relations.ts`).
 */
import type { AnimeRecord } from '@/models/anime';
import { DIRECT_RELATIONS } from '@/lib/domain/franchise';
import { resolveRelations, type RelationIndex } from '@/lib/domain/relations';

/**
 * The episode cap. 15 rather than a cour's 12-13: a single-cour show routinely
 * runs 13, and the two-episode specials and 14-15-episode runs that follow one
 * are the same evening's commitment.
 */
export const QUICK_MAX_EPISODES = 15;

/** A known, short run. Absent/0 = not known to be short (see the header). */
export function hasShortRun(a: AnimeRecord): boolean {
  const n = a.catalog.numEpisodes;
  return typeof n === 'number' && n > 0 && n <= QUICK_MAX_EPISODES;
}

/**
 * No continuation either way: nothing in the catalog is this title's sequel or
 * its prequel. Prequel counts too — a title that continues someone else's story
 * is a season of something, not a standalone.
 */
export function isSingleSeason(a: AnimeRecord, index: RelationIndex): boolean {
  return !resolveRelations(a, index).some(r => DIRECT_RELATIONS.has(r.relationType));
}

/** Both conditions. */
export function isQuickAnime(a: AnimeRecord, index: RelationIndex): boolean {
  return hasShortRun(a) && isSingleSeason(a, index);
}

/**
 * Generic over the item type so a card's extra fields (`recoMeta`) survive, the
 * same contract `applyNarrowingFilters` keeps. Returns the input array by
 * reference when nothing is dropped, so callers must not sort it in place.
 */
export function filterQuickAnime<T extends AnimeRecord>(items: T[], index: RelationIndex): T[] {
  const out = items.filter(a => isQuickAnime(a, index));
  return out.length === items.length ? items : out;
}
