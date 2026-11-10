/**
 * Credit / un-credit the recommendation engine for a title — « Vu grâce à la
 * reco ».
 *
 * `hide.ts`'s shape, for `rating-intent.ts`'s reason: a `user/` annotation, not
 * provider state. It never reaches a `PersonalWriter`, never enters personal
 * precedence and has no remote to fan out to.
 *
 * ⚠️ It sits under `animes/[id]/` rather than beside `recommendations/ignore/`
 * on purpose. « Ignorer » is an act performed ON a feed card and is meaningless
 * anywhere else; this one is a statement ABOUT a title, fired as readily from
 * the detail page two weeks later as from the card — one route for one meaning,
 * whatever surface the click came from.
 */
import { addRecoCredit, removeRecoCredit } from '@/lib/reco/recoCreditStore';
import { idToggleRoute } from '@/lib/api/idToggleRoute';

export default idToggleRoute({
  on: addRecoCredit,
  off: removeRecoCredit,
  body: (credited) => ({ ok: true, credited }),
  label: 'reco credit',
});
