/**
 * Per-source weight config for the "Pour toi" scoring model — the single
 * client-safe home for defaults, URL (de)serialization, and UI metadata.
 *
 * Lives here (not in `@/lib/recommendations`, which is server-only via `fs`)
 * so the sidebar, the URL-state hook, and the API route all share ONE encode
 * / decode and ONE set of defaults. `recommendations.ts` imports the defaults
 * from here too.
 */

import type { RecoSource, SourceWeights } from '@/models/anime';

/**
 * Default weights for `score = Σ weight · normalizedSourceValue`. MAL `crowd`
 * anchors the feed; `anilistCrowd` is the second crowd source (a distinct
 * community — correlated, so weighted below MAL). Metadata sources gently
 * re-rank; `rejection`/`popularity` are negative (they push a candidate down).
 *
 * IMPORTANT — metadata weights are NOT on a common scale. `fieldMatch` divides
 * the matched IDF weight by the candidate's value COUNT, so high-cardinality
 * fields yield structurally smaller values. Measured over the live corpus, a
 * typical match is ~0.40 for BOTH `genre` and `anilistTags`, but only ~0.05 for
 * `anilistStaff` (diluted by ~13 credits). So `anilistStaff` needs a ~1.0 weight
 * just to contribute on par with `genre` at 0.2 — that's why its default and
 * slider range sit an order of magnitude higher, not a typo.
 *
 * `nsfw` ships at 0 — with 2 values (~91% "white") it barely discriminates, so
 * it's available-but-off. `feedback` is dormant until 👍 thumbs accumulate.
 * The three AniList sources need a "Sync AniList" run to be populated (see the
 * Connections page); on an unsynced install they simply score 0 (no penalty).
 */
export const DEFAULT_WEIGHTS: SourceWeights = {
  crowd: 1.0,
  anilistCrowd: 0.7,
  suggestions: 0.35,
  feedback: 0.5,
  genre: 0.2,
  studio: 0.15,
  nsfw: 0.0,
  rating: 0.05,
  anilistTags: 0.3,
  anilistStaff: 1.0,
  rejection: -0.35,
  popularity: -0.15,
};

/**
 * Diversity re-rank (MMR) slider bound. `λ = 0` reproduces the pure affinity
 * ordering (backward-compatible default); higher λ trades affinity for variety
 * across the ranked list. Client-safe so the URL hook and the sidebar slider
 * share the same ceiling. Consumed server-side by `computeFeed`'s MMR pass.
 */
export const DIVERSITY_MAX = 1;
export const DIVERSITY_STEP = 0.05;

/** UI metadata for each weightable source: label, hint, and slider bounds. */
export interface SourceMeta {
  source: RecoSource;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

/** Display order + bounds for the weights sidebar. */
export const SOURCE_META: SourceMeta[] = [
  { source: 'crowd', label: 'Recommandations MAL', hint: 'Fans de tes séries les mieux notées', min: 0, max: 2, step: 0.05 },
  { source: 'anilistCrowd', label: 'Recommandations AniList', hint: 'La communauté AniList des fans de tes séries les mieux notées — nécessite une sync', min: 0, max: 2, step: 0.05 },
  { source: 'suggestions', label: 'Suggestions MAL', hint: 'Le flux de suggestions perso de MAL', min: 0, max: 1, step: 0.05 },
  { source: 'feedback', label: 'Tes retours 👍', hint: 'Similaire à tes « bonnes pioches »', min: 0, max: 2, step: 0.05 },
  { source: 'genre', label: 'Genres', hint: 'Affinité de genres (pondérée par rareté)', min: 0, max: 1, step: 0.05 },
  { source: 'studio', label: 'Studios', hint: 'Affinité de studios (pondérée par rareté)', min: 0, max: 1, step: 0.05 },
  { source: 'rating', label: 'Classification', hint: 'Âge conseillé (PG, R…), pondéré par rareté', min: 0, max: 1, step: 0.05 },
  { source: 'nsfw', label: 'NSFW', hint: 'Signal faible (2 valeurs) — off par défaut', min: 0, max: 1, step: 0.05 },
  { source: 'anilistTags', label: 'Tags AniList', hint: 'Affinité de tags fins (pondérée par rareté) — nécessite une sync', min: 0, max: 1, step: 0.05 },
  { source: 'anilistStaff', label: 'Staff AniList', hint: 'Affinité de créateurs : réalisateur, chara-design, musique… — échelle plus large (dilué par ~15 crédits ; nécessite une sync)', min: 0, max: 3, step: 0.1 },
  { source: 'rejection', label: 'Rejet', hint: 'Pénalise ce qui ressemble à tes abandons / notes basses', min: -1, max: 0, step: 0.05 },
  { source: 'popularity', label: 'Popularité', hint: 'Négatif = feed plus niche', min: -1, max: 1, step: 0.05 },
];

const ALL_SOURCES = SOURCE_META.map(m => m.source);

/**
 * Decode the packed `w` param (`crowd:1,genre:.3,popularity:-.2`) into a sparse
 * override map. Only well-formed, known, finite entries are kept.
 */
export function parseSourceWeights(packed: string | null | undefined): Partial<SourceWeights> {
  const out: Partial<SourceWeights> = {};
  if (!packed) return out;
  for (const part of packed.split(',')) {
    const [rawKey, rawVal] = part.split(':');
    const key = rawKey?.trim() as RecoSource;
    if (!ALL_SOURCES.includes(key)) continue;
    const val = parseFloat(rawVal);
    if (Number.isFinite(val)) out[key] = val;
  }
  return out;
}

/** Encode weights back to the packed `w` param, emitting only non-default values. */
export function encodeSourceWeights(weights: SourceWeights): string {
  return ALL_SOURCES
    .filter(src => weights[src] !== DEFAULT_WEIGHTS[src])
    .map(src => `${src}:${weights[src]}`)
    .join(',');
}

/** Merge sparse overrides onto the defaults into a full weight set. */
export function resolveWeights(overrides: Partial<SourceWeights>): SourceWeights {
  return { ...DEFAULT_WEIGHTS, ...overrides };
}

/** A named, one-click starting point for the weights sliders — not a replacement for manual tuning. */
export interface WeightPreset {
  key: string;
  label: string;
  hint: string;
  weights: Partial<SourceWeights>;
}

/**
 * `weights` are sparse — `resolveWeights` merges them onto `DEFAULT_WEIGHTS`,
 * so a preset only needs to state the sources it moves off the default.
 */
export const RECO_WEIGHT_PRESETS: WeightPreset[] = [
  {
    key: 'sur',
    label: 'Sûr',
    hint: 'Consensus des deux communautés (MAL + AniList) ; ignore les profils de goût fins',
    // Explicit zeros are required: the metadata sources now default non-zero, so
    // a "pure crowd" preset must override them or it silently inherits them.
    weights: {
      crowd: 1.4, anilistCrowd: 1.0, suggestions: 0.5,
      genre: 0, studio: 0, anilistTags: 0, anilistStaff: 0, rating: 0,
      popularity: 0,
    },
  },
  {
    key: 'decouverte',
    label: 'Découverte',
    hint: 'Priorise tes goûts fins (tags, staff, genres) et le niche, quitte à t’éloigner du consensus',
    weights: {
      crowd: 0.5, anilistCrowd: 0.4,
      genre: 0.4, studio: 0.4, anilistTags: 0.6, anilistStaff: 1.3,
      popularity: -0.5,
    },
  },
  {
    key: 'createurs',
    label: 'Créateurs',
    hint: 'Plus des réalisateurs, compositeurs et studios que tu aimes (signal staff AniList)',
    weights: {
      crowd: 0.6, anilistCrowd: 0.5,
      anilistStaff: 2.0, studio: 0.4, anilistTags: 0.5, genre: 0.15,
      popularity: -0.2,
    },
  },
  {
    key: 'defaut',
    label: 'Défaut',
    hint: 'Revient à la pondération de base',
    weights: {},
  },
];
