/**
 * /profiles — « Profils de recos », the list (docs/recoProfiles/DESIGN.md §8).
 *
 * A profile is a named weighting a box points at: « Absolute cinema » leaning
 * on the director, « Puni pour l'animation » on the animation directors. Each
 * card says what it weights and WHICH BOXES use it, because a profile is
 * referenced rather than copied — editing one moves every box pointing at it
 * (§6), and the list is where that is visible before the page that edits it.
 *
 * Created from a shipped starting point (`PROFILE_PRESETS`, the create route's
 * `preset`), then tuned on `/profiles/[id]`. A `?box=` / `?a=` arriving here —
 * `/mix`'s « Tester un profil » link — is carried onto every profile link, so
 * a hand-picked mix becomes a profile test without retyping it.
 */
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useT, type TranslationKey } from '@/lib/i18n';
import {
  DEFAULT_PROFILE_EMOJI,
  PROFILE_PRESETS,
  type ProfilePreset,
  type ProfileSummary,
  type ProfileField,
} from '@/lib/reco/profileWeights';
import { isStaffFamily } from '@/lib/reco/staffFields';
import { decodeProfileQuery, toProfileQuery } from '@/hooks';
import type { ProfileListResponse } from '../api/anime/profiles';

/** Weights shown per card — the ones that define it, not the whole map. */
const SUMMARY_LIMIT = 5;

export default function ProfilesPage() {
  const t = useT();
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [preset, setPreset] = useState<ProfilePreset['key']>(PROFILE_PRESETS[0].key);
  const [creating, setCreating] = useState(false);

  const carried = router.isReady ? toProfileQuery(decodeProfileQuery(router.query)) : '';
  const hrefFor = (id: string) => `/profiles/${encodeURIComponent(id)}${carried ? `?${carried}` : ''}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/profiles');
      if (!res.ok) throw new Error('profiles');
      setProfiles(((await res.json()) as ProfileListResponse).profiles);
      setError('');
    } catch {
      setError(t('profiles.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/anime/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ name: trimmed, preset, ...(emoji.trim() ? { emoji: emoji.trim() } : {}) }),
      });
      if (!res.ok) throw new Error('create');
      const { profile } = (await res.json()) as { profile: ProfileSummary };
      // Straight to the sliders: a profile is made to be tuned.
      await router.push(hrefFor(profile.id));
    } catch {
      setError(t('profiles.saveError'));
      setCreating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, emoji, preset, creating, router, t, carried]);

  const summary = (p: ProfileSummary) => {
    const all = Object.entries(p.weights) as [ProfileField, number][];
    // Every family preset states `anilistStaff: 0` by house rule and the resolver
    // forces it anyway, so on a card it read as a choice (« Staff AniList 0.00 »)
    // beside the two that define the profile. Only that implied zero is dropped:
    // a hand-set `genre: 0` still says something.
    const familyOn = all.some(([f, v]) => isStaffFamily(f) && v !== 0);
    const entries = all
      .filter(([f, v]) => !(familyOn && f === 'anilistStaff' && v === 0))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length === 0) return <span className="pf2-muted">{t('profiles.summaryDefault')}</span>;
    return (
      <>
        {entries.slice(0, SUMMARY_LIMIT).map(([field, value]) => (
          <span key={field} className="pf2-weight">
            {t(`reco.source.${field}.label` as TranslationKey)} <b>{value.toFixed(2)}</b>
          </span>
        ))}
        {entries.length > SUMMARY_LIMIT && <span className="pf2-muted">+{entries.length - SUMMARY_LIMIT}</span>}
      </>
    );
  };

  const selected = PROFILE_PRESETS.find(p => p.key === preset);

  return (
    <>
      <Head><title>{`${t('profiles.title')} — Anime Tracker`}</title></Head>

      <div className="pf2">
        <header className="pf2-head">
          <h1>{DEFAULT_PROFILE_EMOJI} {t('profiles.title')}</h1>
          <p className="pf2-sub">{t('profiles.subtitle')}</p>
        </header>

        <section className="pf2-create">
          <input
            className="pf2-emoji"
            value={emoji}
            onChange={e => setEmoji(e.target.value)}
            placeholder={DEFAULT_PROFILE_EMOJI}
            aria-label="emoji"
            maxLength={4}
          />
          <input
            className="pf2-name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder={t('profiles.namePlaceholder')}
            aria-label={t('profiles.namePlaceholder')}
          />
          <label className="pf2-from">
            {t('profiles.startFrom')}
            <select value={preset} onChange={e => setPreset(e.target.value as ProfilePreset['key'])}>
              {PROFILE_PRESETS.map(p => (
                <option key={p.key} value={p.key}>{t(`profiles.preset.${p.key}` as TranslationKey)}</option>
              ))}
            </select>
          </label>
          <button type="button" className="pf2-btn" onClick={create} disabled={!name.trim() || creating}>
            + {t('profiles.create')}
          </button>
          {selected && <p className="pf2-presetHint">{t(`profiles.presetHint.${selected.key}` as TranslationKey)}</p>}
        </section>

        {error && <p className="pf2-error">{error}</p>}

        {loading ? (
          <p className="pf2-note">{t('common.loading')}</p>
        ) : profiles.length === 0 ? (
          <p className="pf2-note">{t('profiles.none')}</p>
        ) : (
          <div className="pf2-list">
            {profiles.map(p => (
              <article key={p.id} className="pf2-card">
                <Link href={hrefFor(p.id)} className="pf2-cardHead">
                  <span className="pf2-cardEmoji" aria-hidden="true">{p.emoji ?? DEFAULT_PROFILE_EMOJI}</span>
                  <span className="pf2-cardName">{p.name}</span>
                </Link>
                {p.description && <p className="pf2-desc">{p.description}</p>}
                <p className="pf2-weights">{summary(p)}</p>
                <p className="pf2-used">
                  {p.usedBy.length === 0 ? (
                    <span className="pf2-muted">{t('profiles.usedByNone')}</span>
                  ) : (
                    <>
                      <span className="pf2-muted">{t('profiles.usedBy')}</span>
                      {p.usedBy.map(b => (
                        <Link key={b.id} href={`/boxes/${encodeURIComponent(b.id)}?t=recos`} className="pf2-chip">
                          {b.emoji} {b.name}
                        </Link>
                      ))}
                    </>
                  )}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .pf2 { max-width: 1100px; margin: 0 auto; padding: 16px 20px 48px; }
        .pf2-head { margin: 8px 0 18px; }
        .pf2-head h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 4px; }
        .pf2-sub { color: var(--text-muted); font-size: 0.85rem; margin: 0; max-width: 80ch; line-height: 1.5; }

        /* The boxes landing's create row, in the same dashed "slot for one that
           does not exist yet" language. */
        .pf2-create {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          border: 1px dashed var(--border-hover);
          border-radius: 12px;
          padding: 12px 14px;
          margin-bottom: 20px;
        }
        .pf2-create:focus-within { border-color: var(--accent-primary); border-style: solid; }
        .pf2-create input, .pf2-create select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px 10px;
          color: var(--text-primary);
          font-size: 0.85rem;
        }
        .pf2-create input:focus, .pf2-create select:focus { border-color: var(--accent-primary); outline: none; }
        .pf2-emoji { width: 38px; height: 34px; padding: 0 !important; text-align: center; font-size: 1.1rem !important; }
        .pf2-name { width: 240px; font-weight: 600; }
        .pf2-from { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
        .pf2-presetHint { flex-basis: 100%; margin: 0; font-size: 0.76rem; color: var(--text-muted); }
        .pf2-btn {
          background: var(--accent-primary);
          border: 1px solid var(--accent-primary);
          border-radius: 6px;
          color: #fff;
          font-size: 0.78rem;
          font-weight: 600;
          line-height: 1.4;
          padding: 7px 16px;
          cursor: pointer;
        }
        .pf2-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pf2-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }

        .pf2-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
        .pf2-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 14px 16px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
        }
        .pf2-desc { margin: 0; font-size: 0.82rem; line-height: 1.45; color: var(--text-secondary); }
        .pf2-weights, .pf2-used { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font-size: 0.76rem; }
        .pf2-weight { padding: 1px 8px; border-radius: 999px; background: var(--bg-tertiary); color: var(--text-secondary); }
        .pf2-weight b { color: var(--accent-primary); font-variant-numeric: tabular-nums; }
        .pf2-muted { color: var(--text-muted); }

        .pf2-note { color: var(--text-muted); font-size: 0.85rem; padding: 20px 0; }
        .pf2-error { color: var(--accent-danger); font-size: 0.85rem; }
      `}</style>
      {/* The two classNames riding on next/link are out of styled-jsx's reach —
          prefixed global rules, the /boxes/[id] arrangement. */}
      <style jsx global>{`
        .pf2 .pf2-cardHead { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text-primary); }
        .pf2 .pf2-cardHead:hover .pf2-cardName { color: var(--accent-primary); }
        .pf2 .pf2-cardEmoji {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          font-size: 1.4rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 10px;
        }
        .pf2 .pf2-cardName { font-size: 1.05rem; font-weight: 700; }
        .pf2 .pf2-chip {
          padding: 1px 9px;
          border: 1px solid var(--border-color);
          border-radius: 999px;
          color: var(--text-secondary);
          text-decoration: none;
        }
        .pf2 .pf2-chip:hover { border-color: var(--border-hover); color: var(--text-primary); }
      `}</style>
    </>
  );
}
