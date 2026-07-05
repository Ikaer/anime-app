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
 * Default weights for `score = Σ weight · normalizedSourceValue`. `crowd`
 * anchors the feed; metadata sources gently re-rank; `rejection`/`popularity`
 * are negative (they push a candidate down). nsfw ships at 0 — with 2 values
 * (91% "white") it barely discriminates, so it's available-but-off.
 * anilistTags also ships at 0 until a "Sync AniList Tags" run has populated
 * coverage (see Connections page); it's meaningless before that.
 */
export const DEFAULT_WEIGHTS: SourceWeights = {
  crowd: 1.0,
  suggestions: 0.35,
  feedback: 0.5,
  genre: 0.25,
  studio: 0.15,
  nsfw: 0.0,
  rating: 0.05,
  anilistTags: 0.0,
  rejection: -0.35,
  popularity: -0.15,
};

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
  { source: 'suggestions', label: 'Suggestions MAL', hint: 'Le flux de suggestions perso de MAL', min: 0, max: 1, step: 0.05 },
  { source: 'feedback', label: 'Tes retours 👍', hint: 'Similaire à tes « bonnes pioches »', min: 0, max: 2, step: 0.05 },
  { source: 'genre', label: 'Genres', hint: 'Affinité de genres (pondérée par rareté)', min: 0, max: 1, step: 0.05 },
  { source: 'studio', label: 'Studios', hint: 'Affinité de studios (pondérée par rareté)', min: 0, max: 1, step: 0.05 },
  { source: 'rating', label: 'Classification', hint: 'Âge conseillé (PG, R…), pondéré par rareté', min: 0, max: 1, step: 0.05 },
  { source: 'nsfw', label: 'NSFW', hint: 'Signal faible (2 valeurs) — off par défaut', min: 0, max: 1, step: 0.05 },
  { source: 'anilistTags', label: 'Tags AniList', hint: 'Affinité de tags fins (pondérée par rareté) — nécessite une sync', min: 0, max: 1, step: 0.05 },
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
    hint: 'Colle à ce que les fans de tes séries préférées regardent aussi',
    weights: { crowd: 1.4, suggestions: 0.5 },
  },
  {
    key: 'decouverte',
    label: 'Découverte',
    hint: 'Priorise les genres/studios qui te correspondent, quitte à s’éloigner du consensus',
    weights: { crowd: 0.5, genre: 0.6, studio: 0.45, popularity: -0.4 },
  },
  {
    key: 'defaut',
    label: 'Défaut',
    hint: 'Revient à la pondération de base',
    weights: {},
  },
];
