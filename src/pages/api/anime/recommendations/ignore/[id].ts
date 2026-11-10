import { addIgnored, removeIgnored } from '@/lib/reco/ignored';
import { idToggleRoute } from '@/lib/api/idToggleRoute';

/**
 * « Ignorer » — stop proposing this title as a recommendation.
 *  POST   — ignore it (drops it from every reco surface)
 *  DELETE — un-ignore it (↩ Remettre, from the « Ignorés » list)
 *
 * No body: there is exactly one verdict to record, which is the whole point of
 * the control that replaced the 👍/👎 pair (see `reco/ignored.ts`). It takes
 * `hide.ts`'s shape for `rating-intent.ts`'s reason — a `user/` annotation with
 * no remote to fan out to.
 */
export default idToggleRoute({
  on: addIgnored,
  off: removeIgnored,
  body: (ignored) => ({ message: ignored ? 'Recommendation ignored' : 'Recommendation restored' }),
  label: 'ignored state',
});
