/**
 * Ego-graph over the local record — the data behind `/graph`.
 *
 * Pure and client-safe (no `fs`): the catalog rows and the cast slice are passed
 * in, same convention as `stats.ts` / `creditsCatalog.ts`. The API route owns the
 * reads.
 *
 * ## Why an ego graph and not a catalog map
 *
 * Measured on the live store: "two anime share a voice actor" yields **82,196
 * edges over just 674 cast-swept titles**. There is no layout that renders that;
 * it is a grey disc. The same is true of tags (419 nodes each touching hundreds
 * of titles) and of unfiltered staff (298,362 credits).
 *
 * So those edges are never materialized. One focal node, its direct neighbours,
 * and re-centring as the only expansion — which turns the latent density into an
 * asset (a seiyuu ego is ~10 anime, an anime ego ~40 people) instead of noise.
 * Tags are a *filter* on that, which is what they are actually good for.
 *
 * ## Why the node is an anime and not a franchise
 *
 * Asked and measured, because collapsing looks tempting on a prolific seiyuu
 * (Nobuhiko Okamoto: 64 titles → 36 franchises). It loses:
 *
 * - **Coherence.** `FRANCHISE_RELATIONS` chains Gundam SEED, 00, Iron-Blooded
 *   Orphans and Witch from Mercury into ONE 128-member component. Their casts are
 *   disjoint, so the merged node's "cast" means nothing. Median voice-cast
 *   Jaccard between two members of the same franchise is **0.30** over 532 pairs.
 * - **Recasts.** 147 characters are voiced by different seiyuu across parts of
 *   their own franchise (Naruto, Kakashi, Shikamaru…) — exactly what a connection
 *   chart should reveal, and a merge erases it.
 * - **Honesty.** The cast sweep covers the statused list, so a franchise node's
 *   cast is only as complete as the parts you happened to watch (Gundam: 8 of 128
 *   members swept). An anime node is either swept or it isn't.
 *
 * And it does not even solve the problem it was reached for: 36 nodes is no more
 * drawable in one radial ego than 64. Ranking plus a per-group cap does that.
 * Franchise survives as a **clustering hint** (`franchiseKey` on an anime node) —
 * the page groups siblings into one expandable arc segment, keeping every node's
 * identity so a recast still renders as two edges to two characters.
 */

import type {
  AniListCastEntry,
  AniListCharacterEntry,
  AnimeRecord,
} from '@/models/anime';
import { getEffectiveScore, getEffectiveStatus } from '@/lib/domain/animeUtils';
import { staffRoleTier, type StaffRoleTier } from '@/lib/domain/staffRole';
import { buildRelationIndex, resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import { FRANCHISE_RELATIONS } from '@/lib/domain/franchise';

// ============================================================================
// Shapes
// ============================================================================

/**
 * What can sit at the centre. Deliberately three: `studio` and `character` are
 * reachable as *neighbours* and link out, but neither makes a useful centre —
 * a studio ego is a filtered catalog list (which `/credits/studio/[name]`
 * already is), and a character's neighbourhood is one anime plus one seiyuu.
 */
export type GraphFocalType = 'anime' | 'seiyuu' | 'staff';

export const GRAPH_FOCAL_TYPES: GraphFocalType[] = ['anime', 'seiyuu', 'staff'];

export type GraphNodeKind = 'anime' | 'seiyuu' | 'staff' | 'studio';

/**
 * A lean projection, never an `AnimeRecord`. One neighbourhood crosses the wire;
 * the ~25k rows and the reverse indexes never do.
 */
export interface GraphNode {
  kind: GraphNodeKind;
  /**
   * Identity within the graph: the canonical id for an anime, the AniList staff
   * id as a string for a person, the name for a studio. Also the re-centre key.
   */
  key: string;
  label: string;
  labelNative?: string;
  image?: string;
  // ── anime nodes only ──
  year?: number;
  mediaType?: string;
  mean?: number;
  /** Effective personal status — `null` when unseen. Drives the "déjà vu" mark. */
  status?: string | null;
  score?: number | null;
  /** Franchise component id. Sibling anime share it; see the module doc. */
  franchiseKey?: string;
  /** Display name for that component — earliest member's title. */
  franchiseLabel?: string;
  /** True when this title has no cast entry, so its person edges are unknowable. */
  castMissing?: boolean;
}

export type GraphEdgeKind = 'voice' | 'staff' | 'studio' | 'relation';

/** Always focal → neighbour. The graph is a star; there are no neighbour-to-neighbour edges. */
export interface GraphEdge {
  /** Neighbour's node key. The focal end is implicit. */
  to: string;
  kind: GraphEdgeKind;
  /** Group this edge's neighbour renders in — see `GraphGroup.id`. */
  group: string;
  /** Character name (voice), role string (staff), relation type (relation). */
  label: string;
  // ── voice edges ──
  characterKey?: string;
  characterImage?: string;
  /** `MAIN` | `SUPPORTING` | `BACKGROUND`. */
  characterRole?: string;
  // ── staff edges ──
  tier?: StaffRoleTier;
}

/**
 * One arc of the radial layout. Grouping is by edge kind and then by the
 * dimension that actually orders that kind (character role for voice, tier for
 * staff), because that is what makes an arc readable rather than an alphabet.
 */
export interface GraphGroup {
  /** i18n key suffix: `graph.group.<id>`. */
  id: string;
  kind: GraphEdgeKind;
  /** Node keys, ranked. Capped — see `total`. */
  nodeKeys: string[];
  /** Size before the cap, so the UI can say "+31 de plus". */
  total: number;
}

/** The honesty block. Cast-backed dimensions cover the statused list only. */
export interface GraphCoverage {
  /** Titles in the catalog. */
  catalogTitles: number;
  /** Titles with a non-empty cast entry — the seiyuu universe. */
  castTitles: number;
  /** Titles with AniList staff credits — much larger than `castTitles`. */
  staffTitles: number;
  /**
   * True when the focal node's own data is missing rather than empty, i.e. the
   * neighbourhood is thin because of the sweep, not because of the title.
   */
  focalCastMissing: boolean;
}

export interface GraphEgo {
  focalType: GraphFocalType;
  focal: GraphNode;
  /** Neighbours, excluding the focal node. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** In render order, outermost arc last. */
  groups: GraphGroup[];
  coverage: GraphCoverage;
}

export interface GraphFilters {
  /** Only titles carrying an effective status. */
  inList?: boolean;
  /** Character roles to keep on voice edges. Empty/absent = all. */
  roles?: string[];
  /** Staff tiers to keep. Defaults to T1 only — see `DEFAULT_STAFF_TIERS`. */
  tiers?: StaffRoleTier[];
  /** Media types to keep on anime nodes. Empty/absent = all. */
  mediaTypes?: string[];
  /** AniList tag that a neighbouring anime must carry. */
  tag?: string;
}

/**
 * **T1 only** by default, on every focal type.
 *
 * Unfiltered staff is the second hairball: 298,362 credits over 19,293 titles,
 * and one person holds 498 of them. T1+T2 was the first cut at this and was still
 * too much *for a graph*: on Ghost in the Shell it put 14 department heads into
 * one arc against 8 cast nodes, and the arc was unreadable — the credit list on
 * the detail page is the right surface for that depth, in a table where 14 rows
 * cost nothing.
 *
 * T1 is the same scoping `buildStaffAffinity` already justified: raw prolificacy
 * measures the *role's* throughput rather than the person's importance to the
 * show, and T1 excludes the high-throughput roles by construction. The tier chips
 * add the others back per-view, so nothing is unreachable.
 */
export const DEFAULT_STAFF_TIERS: StaffRoleTier[] = [1];

/**
 * Per-arc cap. At the 4K/300%-zoom target (~1280 CSS px) the binding constraint
 * is label collision, not node count, and an arc holds roughly this many labels
 * before they overlap. Groups report `total` so the overflow is stated, never
 * silently dropped.
 */
export const MAX_NODES_PER_GROUP = 24;

// ============================================================================
// Reverse indexes
// ============================================================================

/**
 * The only thing a person ego needs that the record doesn't already carry:
 * person → their credits. Built by scanning the slices once.
 *
 * **Memoized on slice identity, not cached to disk.** Measured on the live
 * store: 15 ms for the seiyuu index, 72 ms for the staff index, against a 554 ms
 * parse of `catalog/anilist.json` that `getAnimeForDisplay()` has already paid.
 * A `cache/graph.json` would buy 87 ms in exchange for a version constant, a
 * rebuild button, a cron step and a staleness window — so there isn't one. This
 * is the `getStaffAffinity` / `buildRelationIndex` pattern: `readJsonFile`'s
 * parse cache hands back the same object until the file's mtime changes, so the
 * index is rebuilt exactly when the data did.
 */
export interface GraphIndex {
  /** AniList staff id → the characters they voiced, per anime. */
  seiyuu: Map<number, { animeId: string; character: AniListCharacterEntry }[]>;
  /** AniList staff id → their production credits. */
  staff: Map<number, { animeId: string; role: string; tier: StaffRoleTier }[]>;
  /** Person id → their display fields, first non-empty wins (portraits vary per credit). */
  people: Map<number, { name: string; nameNative?: string; image?: string }>;
  byCanonical: Map<string, AnimeRecord>;
  /**
   * Held rather than rebuilt per ego: `buildRelationIndex` memoizes on the
   * records ARRAY's identity, so passing it a freshly spread array would rebuild
   * the ~25k index on every request and silently defeat that cache.
   */
  relations: RelationIndex;
  /** Canonical id → franchise component id. */
  franchise: Map<string, string>;
  /** Component id → display label (earliest member's title). */
  franchiseLabel: Map<string, string>;
  castTitles: number;
  staffTitles: number;
}

function rememberPerson(
  index: GraphIndex,
  id: number,
  fields: { name: string; nameNative?: string; image?: string }
): void {
  const existing = index.people.get(id);
  if (!existing) {
    index.people.set(id, { ...fields });
    return;
  }
  // First non-empty wins: AniList omits a portrait on one credit while carrying
  // it on another, and the same holds for the native name.
  if (!existing.image && fields.image) existing.image = fields.image;
  if (!existing.nameNative && fields.nameNative) existing.nameNative = fields.nameNative;
}

/** Franchise components, plus a display label per component and the relation index. */
function buildFranchiseMaps(
  records: AnimeRecord[]
): Pick<GraphIndex, 'franchise' | 'franchiseLabel' | 'relations'> {
  const relIndex = buildRelationIndex(records);
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const record of records) {
    for (const relation of resolveRelations(record, relIndex)) {
      if (!FRANCHISE_RELATIONS.has(relation.relationType)) continue;
      link(record.id, relation.record.id);
    }
  }

  const franchise = new Map<string, string>();
  const franchiseLabel = new Map<string, string>();
  for (const record of records) {
    if (franchise.has(record.id)) continue;
    // Iterative flood fill, same as `groupIntoFranchises` — a long chain would
    // blow a recursive one, and component 50 really is 128 members deep.
    const members: string[] = [];
    const stack = [record.id];
    franchise.set(record.id, record.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      members.push(id);
      for (const next of adjacency.get(id) || []) {
        if (franchise.has(next)) continue;
        franchise.set(next, record.id);
        stack.push(next);
      }
    }
    // Earliest member names the franchise, ties broken by the shorter title:
    // "Fate/stay night" over "Fate/stay night: Unlimited Blade Works 2nd Season".
    // Display-only, so a wrong pick costs a label and nothing else.
    let best: AnimeRecord | undefined;
    for (const id of members) {
      const member = relIndex.byCanonical.get(id);
      if (!member) continue;
      if (!best) { best = member; continue; }
      const a = animeYear(member) ?? Number.POSITIVE_INFINITY;
      const b = animeYear(best) ?? Number.POSITIVE_INFINITY;
      if (a < b || (a === b && member.catalog.title.length < best.catalog.title.length)) best = member;
    }
    if (best) franchiseLabel.set(record.id, best.catalog.title);
  }
  return { franchise, franchiseLabel, relations: relIndex };
}

export function buildGraphIndex(
  records: AnimeRecord[],
  castById: Record<string, AniListCastEntry>
): GraphIndex {
  const { franchise, franchiseLabel, relations } = buildFranchiseMaps(records);
  const index: GraphIndex = {
    seiyuu: new Map(),
    staff: new Map(),
    people: new Map(),
    byCanonical: new Map(),
    relations,
    franchise,
    franchiseLabel,
    castTitles: 0,
    staffTitles: 0,
  };

  for (const record of records) {
    index.byCanonical.set(record.id, record);

    const staff = record.sources.anilist?.staff;
    if (staff && staff.length > 0) {
      index.staffTitles++;
      for (const credit of staff) {
        const tier = staffRoleTier(credit.role);
        if (!index.staff.has(credit.id)) index.staff.set(credit.id, []);
        index.staff.get(credit.id)!.push({ animeId: record.id, role: credit.role, tier });
        // No portrait and no native name on `AniListStaffEntry` — the batched
        // meta query selects neither. A staffer who is also a seiyuu picks both
        // up from the cast pass below.
        rememberPerson(index, credit.id, { name: credit.name });
      }
    }

    const cast = castById[record.id];
    if (cast && cast.characters.length > 0) {
      index.castTitles++;
      for (const character of cast.characters) {
        for (const va of character.voiceActors || []) {
          if (!index.seiyuu.has(va.id)) index.seiyuu.set(va.id, []);
          index.seiyuu.get(va.id)!.push({ animeId: record.id, character });
          rememberPerson(index, va.id, {
            name: va.name,
            nameNative: va.nameNative,
            image: va.image,
          });
        }
      }
    }
  }

  return index;
}

/**
 * Memoized on the identity of BOTH inputs. `getAnimeForDisplay()`'s array is
 * stable until a joined slice changes, and the cast slice is a separate parse
 * with its own mtime — so a cast sweep landing new data must invalidate this
 * even though the rows did not change (the cast slice is deliberately not part
 * of the seven-slice join, and `upsertAnilistCast` does not touch the row cache).
 */
const indexCache = new WeakMap<AnimeRecord[], { cast: object; index: GraphIndex }>();

export function getGraphIndex(
  records: AnimeRecord[],
  castById: Record<string, AniListCastEntry>
): GraphIndex {
  const cached = indexCache.get(records);
  if (cached && cached.cast === castById) return cached.index;
  const index = buildGraphIndex(records, castById);
  indexCache.set(records, { cast: castById, index });
  return index;
}

// ============================================================================
// Projection
// ============================================================================

function animeYear(record: AnimeRecord): number | undefined {
  const seasonYear = record.catalog.startSeason?.year;
  if (typeof seasonYear === 'number') return seasonYear;
  const fromDate = Number(record.catalog.startDate?.slice(0, 4));
  return Number.isFinite(fromDate) && fromDate > 0 ? fromDate : undefined;
}

function animeNode(
  record: AnimeRecord,
  index: GraphIndex,
  castById: Record<string, AniListCastEntry>
): GraphNode {
  const franchiseKey = index.franchise.get(record.id);
  return {
    kind: 'anime',
    key: record.id,
    label: record.catalog.title,
    image: record.catalog.mainPicture?.medium || record.catalog.mainPicture?.large,
    year: animeYear(record),
    mediaType: record.catalog.mediaType,
    mean: record.catalog.mean,
    status: getEffectiveStatus(record) ?? null,
    score: getEffectiveScore(record) ?? null,
    franchiseKey,
    franchiseLabel: franchiseKey ? index.franchiseLabel.get(franchiseKey) : undefined,
    castMissing: castById[record.id] === undefined,
  };
}

function personNode(kind: 'seiyuu' | 'staff', id: number, index: GraphIndex): GraphNode {
  const person = index.people.get(id);
  return {
    kind,
    key: String(id),
    label: person?.name || `#${id}`,
    labelNative: person?.nameNative,
    image: person?.image,
  };
}

/**
 * Rank for an anime node on a person ego: your own score first, then the crowd
 * mean, then recency. Score-first because on a person's page the titles you
 * actually rated are the ones you can reason about.
 */
function animeRank(node: GraphNode): number {
  return (node.score || 0) * 1000 + (node.mean || 0) * 10 + (node.year || 0) / 10000;
}

const ROLE_ORDER: Record<string, number> = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };

function passesAnimeFilters(node: GraphNode, record: AnimeRecord, filters: GraphFilters): boolean {
  if (filters.inList && !node.status) return false;
  if (filters.mediaTypes?.length && !filters.mediaTypes.includes(node.mediaType || '')) return false;
  if (filters.tag) {
    const tags = record.sources.anilist?.tags;
    if (!tags?.some(t => t.name === filters.tag)) return false;
  }
  return true;
}

/** A group before dedupe and capping. */
interface DraftGroup {
  id: string;
  kind: GraphEdgeKind;
  /** Ranked, possibly overlapping another draft group. */
  keys: string[];
}

/**
 * Assign every node to exactly ONE group, then cap.
 *
 * A node genuinely belongs to several: a seiyuu voicing both a main and a
 * supporting character is in `cast.main` AND `cast.supporting`, and a seiyuu who
 * also holds a production credit (theme song performance is the common one) is
 * additionally in `staff.t2`. The layout gives a node one position, so leaving
 * the overlap in placed it twice — two circles, two identical React keys.
 *
 * The FIRST group wins, and the builders emit groups in reading order, so the
 * strongest claim keeps the node: a main role over a supporting one, cast over
 * crew. Nothing is lost from the display — `edgesByNode` still carries every
 * edge to that node, so the surviving label lists both credits.
 *
 * Dedupe runs BEFORE the cap so `total` counts what the group actually holds,
 * rather than reporting an overflow made of nodes that render elsewhere.
 */
function finalizeGroups(drafts: DraftGroup[]): GraphGroup[] {
  const claimed = new Set<string>();
  const out: GraphGroup[] = [];
  for (const draft of drafts) {
    const owned: string[] = [];
    for (const key of draft.keys) {
      if (claimed.has(key)) continue;
      claimed.add(key);
      owned.push(key);
    }
    if (owned.length === 0) continue;
    out.push({
      id: draft.id,
      kind: draft.kind,
      nodeKeys: owned.slice(0, MAX_NODES_PER_GROUP),
      total: owned.length,
    });
  }
  return out;
}

/** Best rank per key, highest first, ties broken by key so output is deterministic. */
function dedupeRanked(entries: { key: string; rank: number }[]): string[] {
  const best = new Map<string, number>();
  for (const entry of entries) {
    best.set(entry.key, Math.max(best.get(entry.key) ?? -Infinity, entry.rank));
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

// ============================================================================
// Ego builders
// ============================================================================

function animeEgo(
  record: AnimeRecord,
  index: GraphIndex,
  castById: Record<string, AniListCastEntry>,
  filters: GraphFilters
): Omit<GraphEgo, 'focalType' | 'coverage'> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const tiers = filters.tiers?.length ? filters.tiers : DEFAULT_STAFF_TIERS;

  // ── Cast: one arc per character role, which is also AniList's own sort ──
  const byRole = new Map<string, { key: string; rank: number }[]>();
  const cast = castById[record.id];
  for (const character of cast?.characters || []) {
    if (filters.roles?.length && !filters.roles.includes(character.role)) continue;
    for (const va of character.voiceActors || []) {
      const key = String(va.id);
      if (!nodes.has(key)) nodes.set(key, personNode('seiyuu', va.id, index));
      const group = `cast.${(character.role || 'other').toLowerCase()}`;
      edges.push({
        to: key,
        kind: 'voice',
        group,
        label: character.name,
        characterKey: String(character.id),
        characterImage: character.image,
        characterRole: character.role,
      });
      if (!byRole.has(group)) byRole.set(group, []);
      // A seiyuu with two characters in one show appears once, at their best rank.
      byRole.get(group)!.push({ key, rank: -(index.seiyuu.get(va.id)?.length || 0) });
    }
  }

  // ── Staff, T1+T2 by default ──
  const byTier = new Map<StaffRoleTier, { key: string; rank: number }[]>();
  for (const credit of record.sources.anilist?.staff || []) {
    const tier = staffRoleTier(credit.role);
    if (!tiers.includes(tier)) continue;
    const key = String(credit.id);
    if (!nodes.has(key)) nodes.set(key, personNode('staff', credit.id, index));
    const group = `staff.t${tier}`;
    edges.push({ to: key, kind: 'staff', group, label: credit.role, tier });
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push({ key, rank: -(index.staff.get(credit.id)?.length || 0) });
  }

  // ── Studios: catalog-complete (MAL), unlike the cast-slice producers ──
  const studioKeys: string[] = [];
  for (const studio of record.catalog.studios || []) {
    const key = studio.name;
    if (nodes.has(key)) continue;
    nodes.set(key, { kind: 'studio', key, label: studio.name });
    edges.push({ to: key, kind: 'studio', group: 'studio', label: studio.name });
    studioKeys.push(key);
  }

  // ── Relations, through the one seam that unions both providers ──
  const relationKeys: { key: string; rank: number }[] = [];
  for (const relation of resolveRelations(record, index.relations)) {
    const node = animeNode(relation.record, index, castById);
    if (!passesAnimeFilters(node, relation.record, filters)) continue;
    if (nodes.has(node.key)) continue;
    nodes.set(node.key, node);
    edges.push({ to: node.key, kind: 'relation', group: 'relation', label: relation.formatted });
    relationKeys.push({ key: node.key, rank: animeRank(node) });
  }

  // Reading order, which is also claim priority in `finalizeGroups`: a main role
  // outranks a supporting one, and cast outranks a crew credit for the same
  // person.
  const drafts: DraftGroup[] = [];
  for (const role of ['MAIN', 'SUPPORTING', 'BACKGROUND', 'OTHER']) {
    const id = `cast.${role.toLowerCase()}`;
    const entries = byRole.get(id);
    if (entries?.length) drafts.push({ id, kind: 'voice', keys: dedupeRanked(entries) });
  }
  for (const tier of [1, 2, 3, 4] as StaffRoleTier[]) {
    const entries = byTier.get(tier);
    if (entries?.length) drafts.push({ id: `staff.t${tier}`, kind: 'staff', keys: dedupeRanked(entries) });
  }
  if (studioKeys.length) drafts.push({ id: 'studio', kind: 'studio', keys: studioKeys });
  if (relationKeys.length) drafts.push({ id: 'relation', kind: 'relation', keys: dedupeRanked(relationKeys) });
  const groups = finalizeGroups(drafts);

  return {
    focal: animeNode(record, index, castById),
    nodes: keepReferenced(nodes, groups),
    edges: keepEdges(edges, groups),
    groups,
  };
}

function seiyuuEgo(
  id: number,
  index: GraphIndex,
  castById: Record<string, AniListCastEntry>,
  filters: GraphFilters
): Omit<GraphEgo, 'focalType' | 'coverage'> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const byRole = new Map<string, { key: string; rank: number }[]>();

  for (const credit of index.seiyuu.get(id) || []) {
    const record = index.byCanonical.get(credit.animeId);
    if (!record) continue;
    const character = credit.character;
    if (filters.roles?.length && !filters.roles.includes(character.role)) continue;
    const node = nodes.get(credit.animeId) ?? animeNode(record, index, castById);
    if (!passesAnimeFilters(node, record, filters)) continue;
    nodes.set(node.key, node);
    const group = `roles.${(character.role || 'other').toLowerCase()}`;
    // One edge per CHARACTER, not per anime: a seiyuu with two roles in a show
    // gets two edges, which is also what keeps a franchise recast visible once
    // the page clusters those anime together.
    edges.push({
      to: node.key,
      kind: 'voice',
      group,
      label: character.name,
      characterKey: String(character.id),
      characterImage: character.image,
      characterRole: character.role,
    });
    if (!byRole.has(group)) byRole.set(group, []);
    byRole.get(group)!.push({ key: node.key, rank: animeRank(node) });
  }

  // A seiyuu holding two roles in one show lands in two groups; the main role
  // wins the node and both characters still show on its label.
  const drafts: DraftGroup[] = [];
  for (const role of ['MAIN', 'SUPPORTING', 'BACKGROUND', 'OTHER']) {
    const groupId = `roles.${role.toLowerCase()}`;
    const entries = byRole.get(groupId);
    if (entries?.length) drafts.push({ id: groupId, kind: 'voice', keys: dedupeRanked(entries) });
  }
  const groups = finalizeGroups(drafts);

  return {
    focal: personNode('seiyuu', id, index),
    nodes: keepReferenced(nodes, groups),
    edges: keepEdges(edges, groups),
    groups,
  };
}

function staffEgo(
  id: number,
  index: GraphIndex,
  castById: Record<string, AniListCastEntry>,
  filters: GraphFilters
): Omit<GraphEgo, 'focalType' | 'coverage'> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const tiers = filters.tiers?.length ? filters.tiers : DEFAULT_STAFF_TIERS;
  const byTier = new Map<StaffRoleTier, { key: string; rank: number }[]>();

  for (const credit of index.staff.get(id) || []) {
    if (!tiers.includes(credit.tier)) continue;
    const record = index.byCanonical.get(credit.animeId);
    if (!record) continue;
    const node = nodes.get(credit.animeId) ?? animeNode(record, index, castById);
    if (!passesAnimeFilters(node, record, filters)) continue;
    nodes.set(node.key, node);
    edges.push({
      to: node.key,
      kind: 'staff',
      group: `credit.t${credit.tier}`,
      label: credit.role,
      tier: credit.tier,
    });
    if (!byTier.has(credit.tier)) byTier.set(credit.tier, []);
    byTier.get(credit.tier)!.push({ key: node.key, rank: animeRank(node) });
  }

  // One person can hold a T1 and a T2 credit on the same title (Director plus
  // Storyboard is routine); the T1 claim keeps the node.
  const drafts: DraftGroup[] = [];
  for (const tier of [1, 2, 3, 4] as StaffRoleTier[]) {
    const entries = byTier.get(tier);
    if (entries?.length) drafts.push({ id: `credit.t${tier}`, kind: 'staff', keys: dedupeRanked(entries) });
  }
  const groups = finalizeGroups(drafts);

  return {
    focal: personNode('staff', id, index),
    nodes: keepReferenced(nodes, groups),
    edges: keepEdges(edges, groups),
    groups,
  };
}

/** Drop nodes the capped groups no longer reference, so the payload matches what renders. */
function keepReferenced(nodes: Map<string, GraphNode>, groups: GraphGroup[]): GraphNode[] {
  const kept = new Set(groups.flatMap(g => g.nodeKeys));
  return [...nodes.values()].filter(n => kept.has(n.key));
}

function keepEdges(edges: GraphEdge[], groups: GraphGroup[]): GraphEdge[] {
  const kept = new Set(groups.flatMap(g => g.nodeKeys));
  return edges.filter(e => kept.has(e.to));
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Build one ego graph. Returns `null` when the focal node doesn't exist, which
 * the route turns into a 404 — a person id with no credits is indistinguishable
 * from a typo, and inventing an empty graph for it would be a worse answer.
 */
export function computeEgo(
  focalType: GraphFocalType,
  focalKey: string,
  records: AnimeRecord[],
  castById: Record<string, AniListCastEntry>,
  filters: GraphFilters = {}
): GraphEgo | null {
  const index = getGraphIndex(records, castById);

  let built: Omit<GraphEgo, 'focalType' | 'coverage'> | null = null;
  let focalCastMissing = false;

  if (focalType === 'anime') {
    const record = index.byCanonical.get(focalKey);
    if (!record) return null;
    focalCastMissing = castById[focalKey] === undefined;
    built = animeEgo(record, index, castById, filters);
  } else {
    const id = Number(focalKey);
    if (!Number.isFinite(id)) return null;
    const credits = focalType === 'seiyuu' ? index.seiyuu.get(id) : index.staff.get(id);
    if (!credits?.length) return null;
    built = focalType === 'seiyuu'
      ? seiyuuEgo(id, index, castById, filters)
      : staffEgo(id, index, castById, filters);
  }

  return {
    focalType,
    ...built,
    coverage: {
      catalogTitles: records.length,
      castTitles: index.castTitles,
      staffTitles: index.staffTitles,
      focalCastMissing,
    },
  };
}
