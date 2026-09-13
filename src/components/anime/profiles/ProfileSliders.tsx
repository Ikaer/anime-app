import React, { useEffect, useRef, useState } from 'react';
import type { RecoSource } from '@/models/anime';
import { STAFF_FAMILIES, isStaffFamily } from '@/lib/reco/staffFields';
import {
  profileFieldBounds,
  resolveProfile,
  setProfileField,
  resetProfileField,
  type PreviewPool,
  type ProfileField,
  type ProfileWeights,
} from '@/lib/reco/profileWeights';
import { ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import type { FamilyDiagnostic, FamilyVerdict, ProfileDiagnostic } from '@/lib/reco/profileDiagnostic';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './ProfileSliders.module.css';

/**
 * A reco profile's sliders (docs/recoProfiles/DESIGN.md §8) — staff / content /
 * crowd, with the §8 diagnostic printed under every staff slider.
 *
 * ⚠️ **Not `RecoWeightsSection`, deliberately.** That panel edits a DENSE
 * `SourceWeights` from the URL; a profile is SPARSE BY INTENT (phase 2): a key is
 * present because the owner moved that slider, absent means "each ranker's own
 * base". So every row here has three states — inherited, set, and the reset
 * that deletes the key again — and a panel that initialized every row from the
 * displayed base and saved the lot would make every profile dense. ⚠️ That is
 * silent AND it breaks the other surface: tuned on the catalog pool, it would
 * freeze `BOX_WEIGHTS.genre` (0.25) into the map and the recos tab would rank
 * with it where `ANCHORED_WEIGHTS` says 0.2. The only thing shared with that
 * panel is the `reco.source.*` keys.
 *
 * Commits on release, not per tick — its rule, for its reason (one save and one
 * preview per gesture, not twenty). And only a row that actually MOVED commits:
 * a click on a thumb that did not travel must not turn an inherited field into a
 * stored one.
 *
 * `base` is the pool's raw base (`BOX_WEIGHTS` or `ANCHORED_WEIGHTS`), which is
 * what an inherited row displays — so an untouched `genre` reads 0.25 on the
 * metadata pools and 0.2 on the recos tab, which is the truth on each.
 */

/**
 * The content group — every metadata field the box rankers read (`BOX_WEIGHTS`'
 * keys), `rating` and `nsfw` included although both ship at 0: a profile can
 * store them, and a stored value the page cannot show or reset is the same
 * trap as a hidden crowd row.
 */
const CONTENT_FIELDS: RecoSource[] = ['anilistTags', 'genre', 'studio', 'anilistStaff', 'rating', 'nsfw'];
/** Read by `computeAnchored` alone: live on the `anchored` pool, disabled elsewhere. */
const CROWD_FIELDS: RecoSource[] = ['crowd', 'anilistCrowd', 'rejection', 'popularity'];

const VERDICT_CLASS: Record<FamilyVerdict, string> = {
  empty: styles.diagEmpty,
  retrieval: styles.diagRetrieval,
  axis: styles.diagAxis,
};

export interface ProfileSlidersProps {
  weights: ProfileWeights;
  base: Record<string, number>;
  pool: PreviewPool;
  /** Over the anchor set's declared units; null while no anchor is chosen. */
  diagnostic: ProfileDiagnostic | null;
  onChange: (next: ProfileWeights) => void;
}

const ProfileSliders: React.FC<ProfileSlidersProps> = ({ weights, base, pool, diagnostic, onChange }) => {
  const t = useT();
  const [draft, setDraft] = useState<ProfileWeights>(weights);
  /** Fields moved since the last commit — only these may become stored keys. */
  const moved = useRef(new Set<ProfileField>());
  useEffect(() => { setDraft(weights); moved.current.clear(); }, [weights]);

  const resolved = resolveProfile(base, draft);
  const anyFamily = STAFF_FAMILIES.some(f => resolved.families[f] !== 0);
  const crowdLive = pool === 'anchored';

  const displayed = (field: ProfileField): number => {
    if (isStaffFamily(field)) return resolved.families[field];
    const stored = draft[field];
    if (field in base) return resolved.weights[field];
    // A crowd field on a metadata pool: not read here, so show what the recos
    // tab would rank with — the stored value, or the anchored default.
    return stored ?? (ANCHORED_WEIGHTS as Record<string, number>)[field] ?? 0;
  };

  const commit = (field: ProfileField) => {
    if (!moved.current.has(field)) return;
    moved.current.delete(field);
    const value = draft[field];
    if (typeof value === 'number') onChange(setProfileField(weights, field, value));
  };

  const familyNote = (d: FamilyDiagnostic) => {
    const verdict = t(`profiles.verdict.${d.verdict}` as TranslationKey);
    const sentence =
      d.verdict === 'empty' ? t('profiles.diag.empty')
      : d.verdict === 'retrieval'
        ? (d.people <= 1 ? t('profiles.diag.retrievalOne') : t('profiles.diag.retrieval', { people: d.people }))
        : t('profiles.diag.axis', {
            names: d.shared.map(s => t('profiles.diag.person', { name: s.name, units: s.units })).join(', ')
              + (d.recurring > d.shared.length ? ` +${d.recurring - d.shared.length}` : ''),
            people: d.people,
          });
    return (
      <p className={`${styles.diag} ${VERDICT_CLASS[d.verdict]}`}>
        <span className={styles.verdict}>{verdict}</span> {sentence}
      </p>
    );
  };

  const row = (field: ProfileField, opts: { disabled?: boolean; note?: string; diag?: FamilyDiagnostic } = {}) => {
    const { min, max } = profileFieldBounds(field);
    const set = draft[field] !== undefined;
    const value = displayed(field);
    const label = t(`reco.source.${field}.label` as TranslationKey);
    const hint = t(`reco.source.${field}.hint` as TranslationKey);
    return (
      <div key={field} className={`${styles.row} ${opts.disabled ? styles.rowOff : ''}`}>
        <div className={styles.head}>
          <span className={styles.label} title={hint}>{label}</span>
          <span className={`${styles.value} ${set ? styles.valueSet : ''}`}>{value.toFixed(2)}</span>
          {set ? (
            <button
              type="button"
              className={styles.reset}
              // A disabled row is not this pool's to change — resetting it here
              // would, e.g., delete the explicit `anilistStaff: 0` every preset
              // states by house rule, from a row that says it is switched off.
              disabled={opts.disabled}
              onClick={() => onChange(resetProfileField(weights, field))}
              title={t('profiles.resetField')}
              aria-label={t('profiles.resetFieldOf', { field: label })}
            >
              ↺
            </button>
          ) : (
            <span className={styles.inherited} title={t('profiles.inheritedHint')}>{t('profiles.inherited')}</span>
          )}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={value}
          disabled={opts.disabled}
          onChange={e => {
            moved.current.add(field);
            setDraft(prev => setProfileField(prev, field, parseFloat(e.target.value)));
          }}
          onPointerUp={() => commit(field)}
          onKeyUp={() => commit(field)}
          className={styles.slider}
          aria-label={label}
          title={hint}
        />
        {opts.note ? <p className={styles.note}>{opts.note}</p> : <p className={styles.hint}>{hint}</p>}
        {opts.diag && familyNote(opts.diag)}
      </div>
    );
  };

  const byFamily = new Map(diagnostic?.families.map(d => [d.family, d]) ?? []);
  const agreeing = diagnostic?.families.filter(d => d.verdict === 'axis') ?? [];

  return (
    <div className={styles.panel}>
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{t('profiles.group.staff')}</h3>
        {/* The regime, stated once for the whole group: §2's point that a
            three-show box is a lookup table of a few people, not an axis. */}
        <p className={styles.regime}>
          {!diagnostic ? t('profiles.diag.noAnchor')
            // One unit: "nobody is shared between two of them" has no two to speak of.
            : diagnostic.units <= 1 ? t('profiles.regime.single')
            : agreeing.length === 0
              ? t('profiles.regime.lookup', { units: diagnostic.units })
              : t('profiles.regime.agrees', {
                  units: diagnostic.units,
                  families: agreeing.map(d => t(`reco.source.${d.family}.label` as TranslationKey)).join(', '),
                })}
        </p>
        {STAFF_FAMILIES.map(f => row(f, { diag: byFamily.get(f) }))}
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{t('profiles.group.content')}</h3>
        {CONTENT_FIELDS.map(f => row(f, f === 'anilistStaff' && anyFamily
          // The resolver zeroes it whenever a family is on (§6) — a knob that
          // moved on its own must say so, and dragging it would do nothing.
          ? { disabled: true, note: t('profiles.staffZeroed') }
          : {}))}
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>{t('profiles.group.crowd')}</h3>
        {!crowdLive && <p className={styles.regime}>{t('profiles.crowdOff')}</p>}
        {CROWD_FIELDS.map(f => row(f, { disabled: !crowdLive }))}
      </section>
    </div>
  );
};

export default ProfileSliders;
