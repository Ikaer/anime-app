/**
 * AniList tags as a FILTER: which tags a title answers to, and the vocabulary
 * the sidebar offers.
 *
 * Tags are not genres. A genre is a yes/no fact a provider asserts; an AniList
 * tag carries a `rank` (0-100) — how strongly voters say it applies — and the
 * long tail is weak: the live store's median tag sits at rank 62, the bottom
 * quartile under 45. A `Tragedy` at rank 20 is a scene, not the show. So a
 * title answers to a tag only at `TAG_FILTER_MIN_RANK` or above, the same 60
 * the box ranker (`BOX_TAG_MIN_RANK`) and the « Recommandé » mark
 * (`AFFINITY_TAG_MIN_RANK`) measured and settled on.
 *
 * ⚠️ The vocabulary's counts and the filter MUST share `filterTagNames`: a
 * count computed over every rank while the filter keeps rank >= 60 would offer
 * « Tragedy 1757 » and return 1266, and a tag present only below the floor
 * would be offered and match nothing at all.
 *
 * Pure and client-safe (no `fs`) — `applyNarrowingFilters` runs client-side
 * on `/tier`, so it must be too.
 */
import type { AnimeRecord } from '@/models/anime';

export const TAG_FILTER_MIN_RANK = 60;

/**
 * The tag names a title answers to as a filter. Titles with no AniList entry
 * answer to none — they cannot match a tag filter, which is the honest result
 * (we do not know), and exactly what a genre filter does on a genre-less row.
 */
export function filterTagNames(anime: AnimeRecord): Set<string> {
  const out = new Set<string>();
  for (const t of anime.sources.anilist?.tags || []) {
    if (t.name && (t.rank ?? 0) >= TAG_FILTER_MIN_RANK) out.add(t.name);
  }
  return out;
}

/**
 * Top-level groups of AniList's category tree (`Theme-Drama`, `Cast-Main Cast`,
 * `Setting-Universe`…). 24 leaf categories collapse to these six; anything a
 * provider adds later falls into `other` rather than disappearing.
 */
export const TAG_GROUPS = ['theme', 'setting', 'cast', 'demographic', 'technical', 'sexual', 'other'] as const;
export type TagGroup = typeof TAG_GROUPS[number];

const GROUP_BY_PREFIX: Record<string, TagGroup> = {
  theme: 'theme',
  setting: 'setting',
  cast: 'cast',
  demographic: 'demographic',
  technical: 'technical',
  'sexual content': 'sexual',
};

export function tagGroup(category: string | undefined): TagGroup {
  const prefix = (category || '').split('-')[0].trim().toLowerCase();
  return GROUP_BY_PREFIX[prefix] ?? 'other';
}

export interface TagFacet {
  name: string;
  count: number;
}

export interface TagVocabulary {
  groups: Record<TagGroup, TagFacet[]>;
  total: number;
}

/** Memoized on the row array's identity — `genreVocabulary.ts`' trick. */
const cache = new WeakMap<AnimeRecord[], TagVocabulary>();

function buildVocabulary(rows: AnimeRecord[]): TagVocabulary {
  const counts = new Map<string, number>();
  const categoryOf = new Map<string, string | undefined>();
  for (const anime of rows) {
    const names = filterTagNames(anime);
    if (names.size === 0) continue;
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
    for (const t of anime.sources.anilist?.tags || []) {
      if (!categoryOf.has(t.name) && t.category) categoryOf.set(t.name, t.category);
    }
  }

  const groups = Object.fromEntries(TAG_GROUPS.map(g => [g, [] as TagFacet[]])) as Record<TagGroup, TagFacet[]>;
  for (const [name, count] of counts) groups[tagGroup(categoryOf.get(name))].push({ name, count });
  for (const g of TAG_GROUPS) {
    groups[g].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return { groups, total: counts.size };
}

/** Counts are catalog-wide: "how common is this tag", not "how many results". */
export function getTagVocabulary(rows: AnimeRecord[]): TagVocabulary {
  let v = cache.get(rows);
  if (!v) {
    v = buildVocabulary(rows);
    cache.set(rows, v);
  }
  return v;
}
