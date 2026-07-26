import React from 'react';
import styles from './ProvenanceChip.module.css';
import type { CatalogFieldOrigin } from '@/lib/domain/animeUtils';
import { useT, type TranslationKey } from '@/lib/i18n';

/**
 * Inline "where did this value come from" chip, sat beside a displayed catalog
 * field on the detail page. The in-line counterpart of `/precedence`, which
 * answers the same question densely, for every field at once, with the losing
 * values — this one answers it where the value is actually being read.
 *
 * Three states, following the inspector's own visual convention so the two read
 * the same way:
 *
 * - **settled** — one provider had the field, so it supplied it. Dimmed: true,
 *   but it decided nothing (the inspector greys these rows out for the same
 *   reason). Still rendered rather than dropped, because "only MAL carries this"
 *   is itself the answer to the question the chip is here to answer.
 * - **contested** — several providers offered a value and precedence picked one.
 *   Amber, matching the inspector's contested marker; this is the informative case.
 * - **union** — `genres`, merged element-wise by `unionGenres` after the merge.
 *   Named "∪" and never a provider, because its `provenance` entry names whoever
 *   the precedence merge happened to pick and means nothing.
 *
 * The chip text is a provider id, deliberately untranslated for the same reason
 * `/precedence` is: `mal`/`anilist`/`simkl` are identifiers. The tooltip is not.
 */

interface Props {
  /** Catalog field name — shown in the tooltip, as the inspector shows it. */
  field: string;
  /** From `catalogFieldOrigins()`. Absent = no provider produced the field. */
  origin?: CatalogFieldOrigin;
}

const ProvenanceChip: React.FC<Props> = ({ field, origin }) => {
  const t = useT();
  if (!origin || (!origin.union && !origin.source)) return null;

  if (origin.union) {
    return (
      <span className={`${styles.chip} ${styles.union}`} title={t('prov.union', { field })}>∪</span>
    );
  }

  const provider = t(`disc.provider.${origin.source}` as TranslationKey);
  return (
    <span
      className={`${styles.chip} ${origin.contested ? styles.contested : styles.settled}`}
      title={t(origin.contested ? 'prov.contested' : 'prov.settled', { field, provider })}
    >
      {provider}
    </span>
  );
};

export default ProvenanceChip;
