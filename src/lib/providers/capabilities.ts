/**
 * **What each provider IS, and what it CAN DO** — the declarative half of
 * provider identity.
 *
 * Client-safe: static data only, no fs, no auth reads. The *runtime* half —
 * "is this provider connected right now?" — lives in [registry.ts](registry.ts),
 * which is server-only because it reads the auth files. Keep that split: a React
 * component may import this module to render a provider; it may never import
 * `registry.ts`.
 *
 * Scope is strictly **identity, capability and status** — the things that really
 * are uniform across providers — and nothing that executes a sync. MAL's seasonal
 * crawl, SIMKL's `activities` delta and AniList's GraphQL batching stay three
 * explicit, different operations.
 *
 * **Roles are keys, not flags.** A provider holds the `catalog` role, the
 * `personal` role, or both, and each role carries its OWN auth kind. That
 * granularity is required, not cosmetic: AniList's catalog reads are anonymous
 * while its list reads need OAuth, so a single per-provider auth field would
 * wrongly file its metadata sync as needing an account.
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
   * How much of the user's watching history this provider's read returns.
   * - `full` — the whole account list; a title missing from it is news.
   * - `subset` — a feed of only what the user happened to track there.
   *
   * This is an **API** claim, not a claim that the account is the user's
   * comprehensive record. `presenceAnchors` narrows it to one anchor for exactly
   * that reason — see its own note.
   */
  listCoverage: 'full' | 'subset';
  /**
   * The dimensions a write can actually carry. `[]` = read-only (sync in, never
   * out). SIMKL is score-only, so `writePersonal` narrows a status or progress
   * patch away and reports it as `unsupported`.
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
  /**
   * Brand asset under `public/`, when we ship one. Identity, so it belongs with
   * the label rather than being re-picked by every surface that draws a provider.
   */
  iconSrc?: string;
  /** Text glyph used when there is no `iconSrc`. Two or three characters. */
  shortLabel: string;
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
    iconSrc: '/mal.png',
    shortLabel: 'MAL',
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
    shortLabel: 'AL', // no brand asset shipped

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
    iconSrc: '/simkl.png',
    shortLabel: 'SK',
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
    shortLabel: 'APP', // the in-app provider — no service, so no brand asset
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
 * Providers holding `role`, in display order. **This is the axis the connections
 * page is split on**, so that an anonymous catalog action (AniList's metadata
 * sync) never renders under an account heading. Role presence is key presence: a
 * provider joins a group by declaring the role and nothing else.
 */
export function providersWithRole(role: ProviderRole): ProvenanceSource[] {
  return PROVIDER_IDS.filter(id => PROVIDER_CAPABILITIES[id][role] !== undefined);
}

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
 * Which dimensions of a patch this provider will actually apply. `writePersonal`
 * narrows against this and reports the complement as `unsupported`.
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
 * Providers whose read returns the user's COMPLETE list.
 *
 * Prefer `presenceAnchors` below over calling this directly — the *set* is not
 * the answer presence detection wants.
 */
export function fullListProviders(): ProvenanceSource[] {
  return PROVIDER_IDS.filter(id => PROVIDER_CAPABILITIES[id].personal?.listCoverage === 'full');
}

/**
 * The **reference list** a title's absence is judged against — at most one,
 * the first full-list provider in the resolved personal precedence. A provider
 * that is not enabled is absent from the precedence and so never anchors.
 *
 * **It must be one, not every full-list provider.** Anchoring on the whole set
 * flags 430 of 671 tracked titles on a real store — every entry the smaller,
 * later-connected account happens not to hold. With two mutual anchors, "absent
 * from the reference list" degenerates into "the two lists differ", which is
 * most of the list.
 *
 * `listCoverage: 'full'` only claims that a provider's read returns the whole
 * account, not that the account IS the user's comprehensive record. Presence
 * detection needs the latter, and precedence is where the app already states
 * which provider it believes when they conflict.
 *
 * So: MAL + anything → `['mal']`. No MAL → `['anilist']`. SIMKL-only or
 * local-only → `[]`, because nothing claims completeness and an absence is
 * therefore not news.
 */
export function presenceAnchors(precedence: ProvenanceSource[]): ProvenanceSource[] {
  const anchor = precedence.find(
    id => PROVIDER_CAPABILITIES[id].personal?.listCoverage === 'full'
  );
  return anchor ? [anchor] : [];
}
