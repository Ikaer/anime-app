import { addHiddenAnimeId, removeHiddenAnimeId } from '@/lib/store';
import { idToggleRoute } from '@/lib/api/idToggleRoute';

export default idToggleRoute({
  on: addHiddenAnimeId,
  off: removeHiddenAnimeId,
  body: (hidden) => ({ message: hidden ? 'Anime hidden successfully' : 'Anime unhidden successfully' }),
  label: 'hidden status',
});
