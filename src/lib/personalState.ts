/**
 * Per-provider RAW personal state — the ONE place a provider's own slice shape
 * (`MALAnime.my_list_status`, `SimklPersonalEntry`, `AniListPersonalEntry`,
 * `LocalPersonalEntry`) is mapped onto the app's status/score/progress
 * vocabulary. Client-safe: model types only, no fs.
 *
 * Two consumers, one mapping — keep it that way. A provider added to only one of
 * them is hydrated but invisible to the comparison, or the reverse:
 *  - **Hydration** ([animeUtils.ts](animeUtils.ts) `toAnimeRecord`) narrows each
 *    state to `Partial<AnimePersonal>` via `toAnimePersonal` and runs the
 *    precedence merge over the result.
 *  - **Discrepancy** ([discrepancy.ts](discrepancy.ts) `computeDiscrepancy`)
 *    takes the states whole, because it needs the two fields hydration drops:
 *    `present` (does this provider hold an entry at all?) and `total` (that
 *    provider's OWN episode count, for the fully-watched reconciliation).
 *
 * `ProviderPersonalState` is a strict superset of `AnimePersonal`, which is what
 * lets one extractor feed both.
 *
 * `total` is deliberately not uniform: MAL and SIMKL carry their own episode
 * count, while AniList's personal entry and the local slice carry none and
 * borrow the catalog's. `present` is one question, but MAL answers it more
 * strictly than the rest — see `hasPersonalData`.
 */
import type {
  AnimePersonal,
  AniListPersonalEntry,
  LocalPersonalEntry,
  MALAnime,
  ProvenanceSource,
  ProviderPersonalState,
  SimklPersonalEntry,
  UserAnimeStatus,
} from '@/models/anime';

/** The raw personal-bearing slices for one title, as `store.ts` gathers them. */
export interface RawPersonalSlices {
  mal?: MALAnime;
  simkl?: SimklPersonalEntry;
  anilist?: AniListPersonalEntry;
  local?: LocalPersonalEntry;
}

/**
 * Does this provider actually hold personal data for the title?
 *
 * "The slice has a key for it" is NOT enough. The AniList and local writers
 * reflect a push by upserting an entry keyed on the provider id, so a patch
 * carrying only a cleared score leaves an entry with no personal dimension at
 * all — e.g. `{ "anilist_id": 198409 }`. Counting that as presence raises a
 * phantom "present on AniList, absent from MAL" split.
 *
 * **MAL deliberately does not use this** — it keys presence on `!!status` alone,
 * because its slice exists for every *catalogued* title and its own artifact
 * shape is `{ status: '', score: 8 }`, which this predicate would wrongly admit.
 */
function hasPersonalData(
  status: UserAnimeStatus | undefined,
  score: number | null | undefined,
  progress: number | null | undefined
): boolean {
  return !!status || (score != null && score > 0) || progress != null;
}

/**
 * MAL's `my_list_status`. Note an EMPTY status string is normalized to
 * `undefined`: the write path initializes `my_list_status` with `status: ''`
 * before applying a score-only patch, and an empty status is not a status.
 */
export function providerStateFromMal(mal?: MALAnime): ProviderPersonalState | undefined {
  if (!mal) return undefined;
  const s = mal.my_list_status;
  return {
    status: s?.status ? (s.status as UserAnimeStatus) : undefined,
    score: s?.score ? s.score : null,
    progress: s?.num_episodes_watched ?? null,
    total: mal.num_episodes ?? null,
    present: !!s?.status,
  };
}

/** SIMKL's personal entry. Its existence IS the presence signal. */
export function providerStateFromSimkl(simkl?: SimklPersonalEntry): ProviderPersonalState | undefined {
  if (!simkl) return undefined;
  return {
    status: simkl.status,
    score: simkl.score ?? null,
    progress: simkl.num_episodes_watched ?? null,
    total: simkl.total_episodes ?? null,
    // Always true in practice — `status` is required on the SIMKL entry, which
    // only ever comes from a sync of the user's real library. Asked uniformly
    // anyway so presence has one definition rather than four.
    present: hasPersonalData(simkl.status, simkl.score, simkl.num_episodes_watched),
  };
}

/**
 * AniList's personal entry. Carries no episode total of its own — it is a list
 * entry against a catalogued title, so the catalog's count is its count (same
 * situation as `local` below).
 */
export function providerStateFromAnilist(
  entry?: AniListPersonalEntry,
  catalogEpisodes?: number
): ProviderPersonalState | undefined {
  if (!entry) return undefined;
  return {
    status: entry.status,
    score: entry.score ?? null,
    progress: entry.progress ?? null,
    total: catalogEpisodes ?? null,
    present: hasPersonalData(entry.status, entry.score, entry.progress),
  };
}

/** The in-app local slice (docs/localRating/). Borrows the catalog's total. */
export function providerStateFromLocal(
  entry?: LocalPersonalEntry,
  catalogEpisodes?: number
): ProviderPersonalState | undefined {
  if (!entry) return undefined;
  return {
    status: entry.status,
    score: entry.score ?? null,
    progress: entry.progress ?? null,
    total: catalogEpisodes ?? null,
    present: hasPersonalData(entry.status, entry.score, entry.progress),
  };
}

/**
 * Narrow a raw provider state to the hydration shape: drop `present`/`total`,
 * and collapse the "unrated" encodings (`null`, `0`) to `undefined` so the
 * precedence merge skips them and falls through to the next provider.
 */
export function toAnimePersonal(state?: ProviderPersonalState): Partial<AnimePersonal> {
  if (!state) return {};
  return {
    status: state.status,
    score: state.score != null && state.score > 0 ? state.score : undefined,
    progress: state.progress ?? undefined,
  };
}

/**
 * Every provider's raw personal state for one title, keyed by provider.
 *
 * A provider participates iff it appears in `personalPrecedence` — the same list
 * that decides who can win a hydrated field, so enablement is expressed in one
 * place. This is what keeps a stray slice left behind by a disabled provider
 * (the `local` case) from surfacing as a phantom mismatch.
 *
 * Deliberately RAW per-provider reads, never the effective/merged value — the
 * point of the comparison downstream is to detect mismatches *between* sources.
 */
export function buildProviderStates(
  slices: RawPersonalSlices,
  personalPrecedence: ProvenanceSource[]
): Partial<Record<ProvenanceSource, ProviderPersonalState>> {
  const { mal, simkl, anilist, local } = slices;
  const catalogEpisodes = mal?.num_episodes;

  const all: Partial<Record<ProvenanceSource, ProviderPersonalState | undefined>> = {
    mal: providerStateFromMal(mal),
    simkl: providerStateFromSimkl(simkl),
    anilist: providerStateFromAnilist(anilist, catalogEpisodes),
    local: providerStateFromLocal(local, catalogEpisodes),
  };

  const states: Partial<Record<ProvenanceSource, ProviderPersonalState>> = {};
  for (const source of personalPrecedence) {
    const state = all[source];
    if (state) states[source] = state;
  }
  return states;
}
