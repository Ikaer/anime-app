/**
 * **What each provider IS, and what it CAN DO** — the declarative half of
 * provider identity (docs/PROVIDER-PARITY.md §3, gap D2).
 *
 * Client-safe: static data only, no fs, no auth reads. The *runtime* half —
 * "is this provider connected right now?" — lives in
 * [providers.ts](providers.ts), which is server-only because it reads the auth
 * files. Keep that split: a React component may import this module to render a
 * provider; it may never import `providers.ts`.
 *
 * This is deliberately NOT the sync-orchestration registry
 * [PROVIDER-ABSTRACTION.md](../../docs/PROVIDER-ABSTRACTION.md) dropped. It
 * abstracts strictly **identity, capability and status** — the three things that
 * really are uniform across providers — and nothing that executes a sync. MAL's
 * seasonal crawl, SIMKL's `activities` delta and AniList's GraphQL batching stay
 * three explicit, different operations.
 *
 * **Roles are keys, not flags.** A provider holds the `catalog` role, the
 * `personal` role, or both, and each role carries its OWN auth kind — which is
 * the point: AniList's catalog reads are anonymous while its list reads need
 * OAuth, so "AniList requires OAuth" is only half true and filing its metadata
 * sync under an account section is the mistake this shape prevents (E4).
 */
import type { ProvenanceSource } from '@/models/anime';

/** What a provider is used FOR. Both roles are independent. */
export type ProviderRole = 'catalog' | 'personal';

/**
 * How a role is reached.
 * - `none` — no external service at all (the in-app `local` provider).
 * - `anonymous` — a public API, no key, no account (AniList's catalog reads).
 * - `oauth` — public OAuth client, client id only (MAL).
 * - `oauth+secret` — confidential client, needs a secret (SIMKL, AniList).
 */
export type ProviderAuthKind = 'none' | 'anonymous' | 'oauth' | 'oauth+secret';

/** The three personal dimensions the app models. Mirrors `PersonalPatch`. */
export type PersonalDimension = 'status' | 'score' | 'progress';

export interface CatalogCapability {
  auth: ProviderAuthKind;
  /**
   * Does this provider expose crowd recommendation edges (MAL's
   * `/recommendations`, AniList's `Media.recommendations`)? SIMKL's
   * `users_recommendations` carry only a SIMKL id with no crosswalk, which is
   * why they were never adopted — hence `false` rather than a missing role.
   */
  crowdRecommendations: boolean;
}

export interface PersonalCapability {
  auth: ProviderAuthKind;
  /**
   * How much of the user's watching history this provider claims to hold.
   * - `full` — the comprehensive list; a title missing from it is news.
   * - `subset` — a feed of only what the user happened to track there.
   *
   * This is what presence detection is really asking (A2): `PRESENCE_ANCHORS`
   * hardcodes `['mal']` today, which is this field frozen as a constant back
   * when MAL was the only full list.
   */
  listCoverage: 'full' | 'subset';
  /**
   * The dimensions a write can actually carry. `[]` = read-only (sync in, never
   * out). SIMKL is the interesting one: score-only by design, so a status or
   * progress patch is *discarded*, and D1 is that the discard is currently
   * reported as a success.
   *
   * For `local` this describes the slice itself rather than a remote push —
   * there is no remote, and the slice can express all three.
   */
  write: readonly PersonalDimension[];
  /**
   * Can a status be **cleared** (`PersonalPatch.status = null`)? Distinct from
   * writing `status`: MAL and AniList happily set one but model removal as a
   * list DELETE, which would drop the score with it. Only the local slice can
   * express "no status" without losing anything else.
   */
  clearStatus: boolean;
}

export interface ProviderCapabilities {
  id: ProvenanceSource;
  /** Brand name, as displayed. Not translated — these are proper nouns. */
  label: string;
  catalog?: CatalogCapability;
  personal?: PersonalCapability;
}

const ALL_DIMENSIONS: readonly PersonalDimension[] = ['status', 'score', 'progress'];

/**
 * The descriptors. **One row per provider — the same set as `ProvenanceSource`,
 * `personal/`'s one-file-per-provider rule and the writer registry.** The
 * `Record` (not an array) is what makes that exhaustiveness a compile error
 * rather than something to remember.
 */
export const PROVIDER_CAPABILITIES: Record<ProvenanceSource, ProviderCapabilities> = {
  mal: {
    id: 'mal',
    label: 'MyAnimeList',
    catalog: { auth: 'oauth', crowdRecommendations: true },
    personal: {
      auth: 'oauth',
      listCoverage: 'full',
      write: ALL_DIMENSIONS,
      clearStatus: false, // list removal only — would drop the score too
    },
  },
  anilist: {
    id: 'anilist',
    label: 'AniList',
    // The keyless default catalog provider: the tags/staff/relations sync and
    // the bulk season crawl need no account and no key. Only the LIST half is
    // OAuth'd — which is why the two must not be filed together in the UI.
    catalog: { auth: 'anonymous', crowdRecommendations: true },
    personal: {
      auth: 'oauth+secret',
      // `MediaListCollection` returns the OAuth'd viewer's whole list, private
      // entries included — a full list by construction, not a subset feed.
      listCoverage: 'full',
      write: ALL_DIMENSIONS, // SaveMediaListEntry is an upsert over all three
      clearStatus: false,
    },
  },
  simkl: {
    id: 'simkl',
    label: 'SIMKL',
    // No catalog role: MAL/AniList are the catalog authorities, and SIMKL's
    // public API has no tags field or tag-filterable endpoint.
    personal: {
      auth: 'oauth+secret',
      listCoverage: 'subset',
      write: ['score'], // the ONE write carve-out — sync is otherwise one-way in
      clearStatus: false,
    },
  },
  local: {
    id: 'local',
    label: 'Local',
    // No catalog role: the local provider holds personal state only; the
    // catalog it annotates comes from MAL/AniList.
    personal: {
      auth: 'none',
      // Only what was rated in-app, so a subset like SIMKL — even on a keyless
      // install where it is the only list there is. "Absent from local" is
      // never news; it is the default state of every catalogued title.
      listCoverage: 'subset',
      write: ALL_DIMENSIONS,
      clearStatus: true, // no remote to diverge from — the slice IS the store
    },
  },
};

/** Stable display/iteration order. Personal precedence is a separate concern. */
export const PROVIDER_IDS = Object.keys(PROVIDER_CAPABILITIES) as ProvenanceSource[];

/**
 * Is this an **external** personal provider — one backed by a real service with
 * an account behind it? `local` is the only provider for which this is false,
 * and `auth: 'none'` is precisely what says so.
 */
export function isExternalPersonalProvider(id: ProvenanceSource): boolean {
  const personal = PROVIDER_CAPABILITIES[id].personal;
  return personal !== undefined && personal.auth !== 'none';
}

/** Can this provider take a write at all (any dimension)? */
export function isWritableProvider(id: ProvenanceSource): boolean {
  return (PROVIDER_CAPABILITIES[id].personal?.write.length ?? 0) > 0;
}

/**
 * Which dimensions of a patch this provider will actually apply. The complement
 * is what it would silently discard — the shape D1 is about.
 */
export function supportedDimensions(id: ProvenanceSource): readonly PersonalDimension[] {
  return PROVIDER_CAPABILITIES[id].personal?.write ?? [];
}

/** Does this provider apply `dimension`, or discard it? */
export function supportsDimension(id: ProvenanceSource, dimension: PersonalDimension): boolean {
  return supportedDimensions(id).includes(dimension);
}

/**
 * Can this provider express the given patch shape end to end? Clearing a status
 * is the one operation that needs more than "writes the `status` dimension".
 */
export function supportsStatusClear(id: ProvenanceSource): boolean {
  return PROVIDER_CAPABILITIES[id].personal?.clearStatus === true;
}

/**
 * Providers claiming to hold the user's COMPLETE list.
 *
 * This is what `PRESENCE_ANCHORS` in [discrepancy.ts](discrepancy.ts) means, and
 * A2 is the swap: that constant is `['mal']` — this field frozen back when MAL
 * was the only full list. Not wired yet, because it is a *behaviour* change
 * (AniList joins the anchors), which A2 owns.
 */
export function fullListProviders(): ProvenanceSource[] {
  return PROVIDER_IDS.filter(id => PROVIDER_CAPABILITIES[id].personal?.listCoverage === 'full');
}
