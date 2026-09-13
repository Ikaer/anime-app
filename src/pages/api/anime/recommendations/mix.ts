import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { computeAnchored } from '@/lib/reco/anchored';
import { getBox } from '@/lib/reco/boxes';
import { getGroups } from '@/lib/reco/groups';
import { boxAnchorIds, boxAnsweredIds, loadMixEdges, MAX_MIX_ANCHORS } from '@/lib/reco/mixFetch';
import { applyNarrowingFilters, getPrimaryTitle } from '@/lib/domain/animeUtils';
import { parseSourceWeights, ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import { getBoxProfile } from '@/lib/reco/profiles';
import { resolveProfile, resolveProfileOver } from '@/lib/reco/profileWeights';
import { getTitleLanguage } from '@/lib/config/settings';
import type { AnimeRecord, RecoMeta } from '@/models/anime';

/**
 * "Mon mix" — crowd recommendations anchored on a HAND-PICKED SET of anime,
 * ranked with the same weighted-source model as the "Pour toi" feed. The middle
 * ground between the detail page's single-target drill-down and the global feed:
 * the user chooses the seeds instead of their whole list deciding them. Also a
 * box's recos tab, through `box=`.
 *
 * The ranking is `computeAnchored` (shared with "Plus comme ça"); the FETCH half
 * — which anchors are asked about, the per-anchor edge caches, the ingest
 * boundary (E9) — is `reco/mixFetch.ts`, lifted out so
 * `scripts/probe-profile.js` can measure this exact pool. This route owns the
 * request: parsing, the weights' precedence, the card projection.
 *
 * Stateless: nothing is persisted, and the stored `RecommendationsData` is
 * neither read nor written.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Two ways in: `ids=` is /mix's hand-picked set, `box=` is a saved one. The
  // ranking is identical — a box IS an anchor set, which is the whole reason its
  // members are stored as a flat id array — so only the cap and the ordering
  // rule differ.
  const boxParam = typeof req.query.box === 'string' ? req.query.box.trim() : '';
  const box = boxParam ? getBox(boxParam) : undefined;
  if (boxParam && !box) return res.status(404).json({ error: 'Box not found' });

  const requested = box
    ? box.members
    : (typeof req.query.ids === 'string' ? req.query.ids : '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
  if (requested.some(id => !isCanonicalId(id))) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  const titleLang = getTitleLanguage();
  const records = getAnimeForDisplay();
  const byId = new Map(records.map(a => [a.id, a]));
  // Unknown ids are dropped rather than 400'd: a bookmarked mix must survive an
  // anchor disappearing from the store, and the response says which were kept.
  const present = Array.from(new Set(requested)).filter(id => byId.has(id));
  // A box asks about ONE representative per unit, best-loved first — see
  // `boxAnchorIds` for why a representative here and fractions in the fill loop.
  const anchorIds = box
    ? boxAnchorIds(box, present, byId, getGroups())
    : present.slice(0, MAX_MIX_ANCHORS);
  const anchors = anchorIds.map(id => {
    const a = byId.get(id)!;
    return { id, title: getPrimaryTitle(a, titleLang), poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large };
  });

  if (anchorIds.length === 0) {
    return res.json({ animes: [], total: 0, anchors: [], sources: { mal: { ok: true }, anilist: { ok: true } } });
  }

  const lang = req.query.lang === 'en' ? 'en' : 'fr';
  // Overrides land on the ANCHORED base, not the feed's — the URL only carries
  // what the sliders moved off it.
  //
  // A box with a reco profile (docs/recoProfiles/) puts the profile BETWEEN the
  // two: base < profile < URL. The URL still wins — a client encodes against the
  // profile-resolved weights returned below as `profile.base`, so a slider
  // dragged back to the anchored default stays in the URL instead of letting the
  // profile snap it back — and the `anilistStaff` zeroing still holds after the
  // URL (see `resolveProfileOver`). `/mix?ids=` has no profile, and resolves to
  // exactly `ANCHORED_WEIGHTS` + overrides as before.
  const profile = box ? getBoxProfile(box) : undefined;
  const resolved = resolveProfileOver(
    ANCHORED_WEIGHTS,
    profile?.weights,
    parseSourceWeights(typeof req.query.w === 'string' ? req.query.w : undefined)
  );
  // The same resolution WITHOUT the URL — the base a weights control encodes against.
  const profileBase = profile ? resolveProfile(ANCHORED_WEIGHTS, profile.weights) : undefined;
  // Seen titles are excluded by default here (unlike the drill-down): the pool
  // is N anchors wide and the question is what to watch NEXT.
  //
  // ⚠️ The BOX recos tab flips that default on its own side and sends
  // `includeSeen=true` — with seen titles in, each card becomes a question about
  // the box (« Oui, c'est ça » / « Non ») rather than a watch suggestion, and
  // that is the only fill mechanism that works for a FORM axis, because the
  // crowd graph encodes tone where no catalog field does (§6.3). The default
  // here stays off: `/mix` is a different question.
  const includeSeen = req.query.includeSeen === 'true';

  const { mediaType, search, minScore, maxScore, minYear, maxYear, genres } = req.query;
  const narrowing = {
    mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
      ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
      : undefined,
    search: typeof search === 'string' ? search : undefined,
    minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
    maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
    minYear: typeof minYear === 'string' ? parseInt(minYear, 10) : null,
    maxYear: typeof maxYear === 'string' ? parseInt(maxYear, 10) : null,
    genres: typeof genres === 'string' && genres.trim() !== ''
      ? genres.split(',').map(g => g.trim()).filter(Boolean)
      : undefined,
  };

  try {
    const { sources, malEdges, anilistEdges } = await loadMixEdges(anchorIds);
    if (!sources.mal.ok && !sources.anilist.ok) {
      return res.status(502).json({ error: 'Both recommendation sources failed', sources });
    }

    const ranked = computeAnchored(anchorIds, malEdges, anilistEdges, {
      weights: resolved.weights,
      families: resolved.families,
      excludeSeen: !includeSeen,
      // ⚠️ A box's « Oui » and « Non » stay answered across a reload — see
      // `boxAnsweredIds`.
      excludeIds: box ? boxAnsweredIds(box) : undefined,
      lang,
      titleLang,
    });

    // Projected into the feed's card shape, so `/mix` renders through the same
    // `AnimeCardView` + "Pourquoi ?" explain as "Pour toi". `topSeeds` names the
    // anchors that backed the card — with several anchors that IS meaningful,
    // which is exactly why the drill-down's lean shape doesn't fit here.
    const animes: (AnimeRecord & { recoMeta: RecoMeta })[] = ranked.map(item => ({
      ...item.anime,
      recoMeta: {
        affinityScore: item.score,
        topSeeds: item.perAnchor.slice(0, 3),
        totalSeeds: item.perAnchor.length,
        fromSuggestions: false,
        breakdown: item.breakdown,
      },
    }));

    const filtered = applyNarrowingFilters(animes, narrowing);
    res.json({
      animes: filtered,
      total: filtered.length,
      anchors,
      sources,
      // Present only when a profile applied. `base` is what a weights control on
      // this surface must encode `w` against (URL overrides NOT folded in);
      // `staffZeroed` says the resolver switched `anilistStaff` off, which a
      // page must announce rather than leave as a knob that moved by itself.
      ...(profile && profileBase ? {
        profile: {
          id: profile.id,
          name: profile.name,
          ...(profile.emoji ? { emoji: profile.emoji } : {}),
          base: profileBase.weights,
          families: profileBase.families,
          staffZeroed: profileBase.staffZeroed,
        },
      } : {}),
    });
  } catch (error) {
    console.error('Mix recommendations error:', error);
    res.status(500).json({
      error: 'Failed to compute the mix',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
