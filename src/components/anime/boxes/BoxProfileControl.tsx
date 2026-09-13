import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import type { ProfileSummary } from '@/lib/reco/profileWeights';
import styles from './BoxProfileControl.module.css';

/**
 * Attach a reco profile to the box — edition mode's one ranking control
 * (docs/recoProfiles/, PLAN.md phase 6).
 *
 * In EDITION, not on présentation, for the reason `profileId` rides on the box's
 * PUT rather than its PATCH (phase 3): a profile changes how the box RANKS, the
 * side of the line membership and declared groups are on. Présentation states
 * the attachment read-only.
 *
 * A profile is REFERENCED, not copied: « Régler » opens the profile tested
 * against this very box, and tuning it there moves this box's recos tab — and
 * every other box using it, which the profile page says.
 */
export interface BoxProfileControlProps {
  boxId: string;
  /** The attached profile, resolved — null for none or a dangling (deleted) id. */
  profileId: string | null;
  onAttach: (profileId: string | null) => unknown;
}

const BoxProfileControl: React.FC<BoxProfileControlProps> = ({ boxId, profileId, onAttach }) => {
  const t = useT();
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/anime/profiles')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('profiles'))))
      .then((json: { profiles: ProfileSummary[] }) => { if (!cancelled) setProfiles(json.profiles); })
      .catch(() => { if (!cancelled) setProfiles([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.control}>
      <label className={styles.label} htmlFor={`bx-profile-${boxId}`}>🎚 {t('boxes.profileLabel')}</label>
      <select
        id={`bx-profile-${boxId}`}
        className={styles.select}
        value={profileId ?? ''}
        disabled={profiles === null}
        onChange={e => onAttach(e.target.value || null)}
      >
        <option value="">{t('boxes.profileNone')}</option>
        {profiles?.map(p => (
          <option key={p.id} value={p.id}>{`${p.emoji ?? '🎚'} ${p.name}`}</option>
        ))}
      </select>
      {profileId ? (
        <Link href={`/profiles/${encodeURIComponent(profileId)}?box=${encodeURIComponent(boxId)}`} className={styles.link}>
          {t('boxes.profileTune')} →
        </Link>
      ) : (
        <Link href={`/profiles?box=${encodeURIComponent(boxId)}`} className={styles.link}>
          {profiles?.length ? t('boxes.profileManage') : t('boxes.profileCreate')} →
        </Link>
      )}
      <p className={styles.hint}>{t('boxes.profileHint')}</p>
    </div>
  );
};

export default BoxProfileControl;
