/**
 * The three axes hiding inside `catalog.genres`, as a **pure function of the
 * genre name** (docs/DECISIONS.md, E3).
 *
 * MAL's `genres` conflates genre proper (Action, Romance), theme/setting
 * (School, Isekai, Vampire) and demographic (Shounen, Seinen). Option D as
 * originally written split those into three catalog FIELDS — two new model
 * fields, two new filter dimensions at ~6 spots each, precedence entries, and a
 * store migration.
 *
 * None of that is necessary, because the partition is derivable from the name,
 * and names are already the identity key (that is exactly why `unionGenres`
 * dedupes cleanly across providers). So the axis lives here as a lookup instead
 * of in the data: **no new catalog fields, no migration, no re-sweep**, and a
 * misclassification is fixed by editing an array rather than re-running a sync.
 *
 * ## Why whitelists rather than a ~60-entry partition table
 *
 * Genre and demographic are CLOSED sets; theme is open-ended. Enumerating all
 * three means curating every value forever. Enumerating the two finite ones and
 * letting the open one be the fall-through means a genre MAL adds next year
 * lands in `theme` — imprecise, but never unclassified, and never a crash.
 */

/** Which axis a genre name belongs to. `theme` is the fall-through. */
export type GenreAxis = 'genre' | 'demographic' | 'theme';

export const GENRE_AXES: GenreAxis[] = ['genre', 'demographic', 'theme'];

/**
 * AniList's `GenreCollection` — a provider-maintained closed list, transcribed
 * rather than curated by us (verified 2026-07-24 against the live API; refresh
 * with `{ GenreCollection }` if AniList ever extends it).
 *
 * This being externally maintained is the whole reason the genre axis costs
 * almost no judgement: the "which of these are REAL genres" argument was
 * already settled by AniList's taxonomy, which is what made it attractive in
 * the first place.
 */
const ANILIST_GENRE_COLLECTION = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Hentai',
  'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
  'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

/**
 * MAL genre-proper values AniList's collection has no equivalent for. Without
 * these they would fall through to `theme`, which is wrong in a way a reader
 * would notice — Boys Love and Gourmet are genres by any reading.
 *
 * This is the ONLY hand-curated genre judgement in the file, and it is
 * deliberately short. When in doubt a value belongs in `theme`: an over-broad
 * `theme` is the designed failure mode, an over-broad `genre` is not.
 */
const MAL_ONLY_GENRES = [
  'Avant Garde', 'Boys Love', 'Erotica', 'Gag Humor', 'Girls Love', 'Gourmet',
];

/**
 * The closed demographic set — five values, no judgement calls. These are the
 * least ambiguous axis and the reason a demographic filter is worth having at
 * all: `Shounen` (2,246 titles) and `Seinen` (1,192) are high-volume on this
 * store and answer a question no other filter does.
 */
const DEMOGRAPHICS = ['Josei', 'Kids', 'Seinen', 'Shoujo', 'Shounen'];

/**
 * AniList names that denote a MAL genre under a different label — the SAME map
 * `unionGenres` applies when merging, and applying it here is load-bearing
 * rather than tidy: the union stores MAL's `Suspense`, while AniList's
 * collection says `Thriller`. Whitelisting the raw collection would leave
 * `Suspense` falling through to `theme` — a genre silently misfiled by the one
 * table meant to prevent that.
 *
 * Kept as its own copy rather than imported from `animeUtils` because that
 * module's map is private to the union and the two answer different questions;
 * if a second alias ever appears, both need it.
 */
const ALIASES: Record<string, string> = { thriller: 'Suspense' };

/** Case/spacing-insensitive lookup key, so `Sci-Fi` and `sci-fi` agree. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

function buildSet(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    const aliased = ALIASES[key(name)] ?? name;
    out.add(key(aliased));
  }
  return out;
}

const GENRE_SET = buildSet([...ANILIST_GENRE_COLLECTION, ...MAL_ONLY_GENRES]);
const DEMOGRAPHIC_SET = buildSet(DEMOGRAPHICS);

/**
 * The axis a genre name belongs to. Unknown names are `theme` by design — see
 * the module comment. Pure and client-safe.
 */
export function genreAxis(name: string): GenreAxis {
  const k = key(name);
  if (DEMOGRAPHIC_SET.has(k)) return 'demographic';
  if (GENRE_SET.has(k)) return 'genre';
  return 'theme';
}

/** Group a flat list of genre names by axis, preserving input order within each. */
export function groupByAxis(names: string[]): Record<GenreAxis, string[]> {
  const out: Record<GenreAxis, string[]> = { genre: [], demographic: [], theme: [] };
  for (const name of names) out[genreAxis(name)].push(name);
  return out;
}
