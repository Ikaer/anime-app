/**
 * Mute / unmute a title as a recommendation SEED — « ne plus partir de ce titre ».
 *
 * `hide.ts`'s shape, for `rating-intent.ts`'s reason: this is a `user/`
 * annotation, not provider state. It never reaches a `PersonalWriter`, never
 * enters personal precedence, and has no remote to fan out to — so it is its own
 * route rather than a dimension on `PUT …/personal`.
 *
 * Note the `[id]` here is the SEED's canonical id, not a candidate's: the feed
 * card's control passes `recoMeta.topSeeds[n].id`.
 */
import { addSeedMute, removeSeedMute } from '@/lib/reco/seedMutes';
import { idToggleRoute } from '@/lib/api/idToggleRoute';

export default idToggleRoute({
  on: addSeedMute,
  off: removeSeedMute,
  body: (muted) => ({ ok: true, muted }),
  label: 'seed mute',
});
