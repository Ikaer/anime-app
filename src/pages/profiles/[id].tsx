/**
 * /profiles/[id] — one reco profile: its sliders, and what they change
 * (docs/recoProfiles/DESIGN.md §8, PLAN.md phase 6).
 *
 * **Left, the weighting; right, its effect on a chosen anchor set.** The anchor
 * is a box (`?box=`, defaulting to the first box using the profile) or an ad-hoc
 * set (`?a=`, `/mix`'s key and its picker). The pool is one of the three the
 * preview route knows — each the ranker a profile really drives.
 *
 * ⚠️ **The ranking is only ever shown AGAINST `Défaut`.** Every row carries its
 * shift against the same pool unweighted, the header counts what came in, and a
 * weighting that changes nothing on this pool gets a sentence instead of a list
 * (`reco/profileBaseline.ts`). An untouched catalog preview on its own would be a
 * plain metadata rank of the unseen catalog — the fourth recommendation surface
 * DESIGN §7 refuses beside « Recommandé ». This page is a tuning instrument.
 *
 * ⚠️ **The §8 diagnostic sits under every staff slider, and it is not optional.**
 * On a three-show box a craft slider is a RETRIEVAL knob — "more by these eight
 * people" — and without the sentence saying so, that failure is invisible and
 * confident (Yuuki Hayashi's shonen filmography imported into a comedy box).
 *
 * **Saved on every slider release** — `updateProfile` replaces the sparse map,
 * and a profile is one object edited from one page. No Save button: the header
 * says, instead, which boxes a release re-ranks at once, because a profile is
 * REFERENCED and editing it moves every box pointing at it (§6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ProfileSliders from '@/components/anime/profiles/ProfileSliders';
import ProfilePreviewList from '@/components/anime/profiles/ProfilePreviewList';
import { MixAnchorsSection } from '@/components/anime/sidebar';
import { autoGrow } from '@/components/anime/boxes/autoGrow';
import { useProfileUrlState, MAX_ANCHORS } from '@/hooks';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import {
  DEFAULT_PROFILE_EMOJI,
  PREVIEW_POOLS,
  PROFILE_PRESETS,
  type PreviewPool,
  type ProfilePreset,
  type ProfileSummary,
  type ProfileWeights,
} from '@/lib/reco/profileWeights';
import { BOX_WEIGHTS, ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import { shiftsAgainst, tunesNothing } from '@/lib/reco/profileBaseline';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import type { PreviewResponse } from '../api/anime/profiles/preview';
import type { BoxListResponse, BoxSummary } from '../api/anime/boxes';

/** Rows in a preview — both lists, so « N nouveaux sur 30 » compares like with like. */
const PREVIEW_LIMIT = 30;

export default function ProfilePage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { profileId, state, update, isReady } = useProfileUrlState();

  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  /** The sparse map the sliders edit — the profile's own, saved on release. */
  const [weights, setWeights] = useState<ProfileWeights>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);

  /**
   * Ad-hoc mode is local, not a URL value: an empty `a=` and "no anchor at all"
   * read the same in the URL, and the latter falls back to the profile's first
   * box. Seeded from the URL once, so a `?a=` carried over from `/mix` lands in it.
   */
  const [adHoc, setAdHoc] = useState(false);
  const seededMode = useRef(false);
  useEffect(() => {
    if (!isReady || seededMode.current) return;
    seededMode.current = true;
    setAdHoc(state.anchors.length > 0);
  }, [isReady, state.anchors.length]);

  const [presetKey, setPresetKey] = useState<ProfilePreset['key']>(PROFILE_PRESETS[0].key);
  /** What a preset replaced — one step of undo, because applying one overwrites every slider. */
  const [presetUndo, setPresetUndo] = useState<ProfileWeights | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);

  // ── Loading the profile and the boxes it can be tested on ──────────────────
  const loadProfile = useCallback(async () => {
    if (!profileId) return;
    try {
      const res = await fetch(`/api/anime/profiles/${encodeURIComponent(profileId)}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error('profile');
      const json = (await res.json()) as { profile: ProfileSummary };
      setProfile(json.profile);
      return json.profile;
    } catch {
      setError(t('profiles.loadError'));
    }
  }, [profileId, t]);

  const loadBoxes = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/boxes');
      if (!res.ok) throw new Error('boxes');
      setBoxes(((await res.json()) as BoxListResponse).boxes);
    } catch {
      setError(t('boxes.loadError'));
    }
  }, [t]);

  useEffect(() => {
    if (!isReady) return;
    loadProfile().then(p => { if (p) setWeights(p.weights); });
    loadBoxes();
  }, [isReady, loadProfile, loadBoxes]);

  // ── Saving ─────────────────────────────────────────────────────────────────
  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/anime/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('patch');
    setProfile(((await res.json()) as { profile: ProfileSummary }).profile);
  }, [profileId]);

  /**
   * One PATCH per release, CHAINED: two quick releases must land in the order
   * they were made, or the older map would overwrite the newer one on disk
   * while the sliders show the newer.
   */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveWeights = useCallback((next: ProfileWeights) => {
    setWeights(next);
    setSaveState('saving');
    saveChain.current = saveChain.current
      .then(() => patch({ weights: next }))
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('error'));
  }, [patch]);

  const saveMeta = useCallback(async (body: Record<string, unknown>) => {
    try { await patch(body); setError(''); } catch { setError(t('profiles.saveError')); }
  }, [patch, t]);

  const applyPreset = () => {
    const preset = PROFILE_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    setPresetUndo(weights);
    saveWeights({ ...preset.weights });
  };

  // ── The preview's context ──────────────────────────────────────────────────
  const effectiveBox = adHoc ? null : (state.box ?? profile?.usedBy[0]?.id ?? null);
  const hasAnchor = effectiveBox !== null || (adHoc && state.anchors.length > 0);
  const base: Record<string, number> = state.pool === 'anchored' ? ANCHORED_WEIGHTS : BOX_WEIGHTS;
  const nothing = tunesNothing(base, weights);
  const contextKey = `${effectiveBox ?? ''}|${adHoc ? state.anchors.join(',') : ''}|${state.pool}|${lang}`;

  const previewBody = useCallback((w: ProfileWeights) => ({
    weights: w,
    ...(effectiveBox ? { box: effectiveBox } : { anchors: state.anchors }),
    pool: state.pool,
    limit: PREVIEW_LIMIT,
    lang,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [contextKey]);

  const post = async (body: unknown): Promise<PreviewResponse> => {
    const res = await fetch('/api/anime/profiles/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'preview');
    return json as PreviewResponse;
  };

  const profileLoaded = profile !== null;
  const weightsKey = `${contextKey}|${JSON.stringify(weights)}`;

  /**
   * `Défaut` on this context — fetched once per anchor set and pool, never per
   * slider release, since it does not depend on the weights. It also carries
   * the diagnostic, which does not either. Kept WITH the context it answers.
   */
  const [baselineHit, setBaselineHit] = useState<{ key: string; data: PreviewResponse } | null>(null);
  const [baselineError, setBaselineError] = useState('');
  const baselineGen = useRef(0);
  useEffect(() => {
    const gen = ++baselineGen.current;
    setBaselineError('');
    if (!isReady || !profileLoaded || !hasAnchor) return;
    post(previewBody({}))
      .then(data => { if (gen === baselineGen.current) setBaselineHit({ key: contextKey, data }); })
      .catch(e => { if (gen === baselineGen.current) setBaselineError(e instanceof Error ? e.message : 'preview'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, profileLoaded, hasAnchor, contextKey]);

  /**
   * The weighting on the same context. ⚠️ Generation-guarded AND keyed: the
   * `anchored` pool reaches MAL and AniList, so an older answer can land after
   * a newer one — and a stale ranking under fresh slider positions is exactly
   * the lie an instrument must not tell. The previous list stays up, dimmed,
   * while its successor is on the way; one from another CONTEXT never shows.
   */
  const [previewHit, setPreviewHit] = useState<{ context: string; key: string; data: PreviewResponse } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const previewGen = useRef(0);
  useEffect(() => {
    const gen = ++previewGen.current;
    setPreviewError('');
    if (!isReady || !profileLoaded || !hasAnchor || nothing) return;
    const key = weightsKey;
    post(previewBody(weights))
      .then(data => { if (gen === previewGen.current) setPreviewHit({ context: contextKey, key, data }); })
      .catch(e => { if (gen === previewGen.current) setPreviewError(e instanceof Error ? e.message : 'preview'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, profileLoaded, hasAnchor, nothing, weightsKey]);

  const baseline = baselineHit?.key === contextKey ? baselineHit.data : null;
  const preview = previewHit?.context === contextKey && !nothing ? previewHit.data : null;
  const stale = !!preview && previewHit?.key !== weightsKey;

  /** Names for the ad-hoc chips, kept across fetches so they do not blink. */
  const [anchorRows, setAnchorRows] = useState<Map<string, LeanAnimeRow>>(new Map());
  useEffect(() => {
    const rows = baselineHit?.data.anchors.rows;
    if (rows?.length) setAnchorRows(prev => new Map([...prev, ...rows.map(r => [r.id, r] as const)]));
  }, [baselineHit]);

  // Both halves must answer the current context before a single shift is drawn.
  const current = preview && baseline ? preview : null;
  const shifts = useMemo(
    () => (current && baseline ? shiftsAgainst(current.items, baseline.items) : []),
    [current, baseline]
  );
  const changed = shifts.filter(s => s.kind === 'new').length;
  const diagnostic = baseline?.diagnostic ?? null;

  // ── Attach, delete ─────────────────────────────────────────────────────────
  const testedBox = effectiveBox ? boxes.find(b => b.id === effectiveBox) : undefined;
  const attachedHere = !!testedBox && testedBox.profileId === profileId;

  const attach = async (profileIdOrNull: string | null) => {
    if (!testedBox) return;
    setAttachBusy(true);
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(testedBox.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profileIdOrNull }),
      });
      if (!res.ok) throw new Error('attach');
      await Promise.all([loadProfile(), loadBoxes()]);
    } catch {
      setError(t('profiles.attachError'));
    } finally {
      setAttachBusy(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      // The in-page confirmation below IS the confirmation the route asks for
      // with its 409 — it names the same boxes.
      const res = await fetch(`/api/anime/profiles/${encodeURIComponent(profileId)}?confirm=1`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      await router.push('/profiles');
    } catch {
      setError(t('profiles.deleteError'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  /**
   * The sticky slider column sits under the app header, which is itself sticky
   * and wraps on a narrow viewport — measured, the group blade's reason.
   */
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const measure = () => setHeaderH((document.querySelector('.header') as HTMLElement | null)?.offsetHeight ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (notFound) {
    return (
      <div className="pf">
        <p className="pf-note">{t('profiles.notFound')}</p>
        <Link href="/profiles" className="pf-back">← {t('profiles.back')}</Link>
        <style jsx global>{`
          .pf { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }
          .pf .pf-note { color: var(--text-muted); }
          .pf .pf-back { color: var(--text-secondary); font-size: 0.85rem; }
        `}</style>
      </div>
    );
  }

  const usedBy = profile?.usedBy ?? [];
  const selectValue = adHoc ? '(adhoc)' : (effectiveBox ?? '');
  const poolHint = t(`profiles.poolHint.${state.pool}` as TranslationKey);
  const selectedPreset = PROFILE_PRESETS.find(p => p.key === presetKey);

  const status = (() => {
    const r = current ?? baseline;
    if (!r) return null;
    const parts: string[] = [];
    // The UI language's grouping, not the browser's: « 15 271 », not « 15,271 ».
    const n = (v: number) => v.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
    if (r.coverage) parts.push(t('profiles.coverage', { eligible: n(r.coverage.eligible), unseen: n(r.coverage.unseen) }));
    if (r.sources) {
      for (const [name, outcome] of [['MAL', r.sources.mal], ['AniList', r.sources.anilist]] as const) {
        if (!outcome.ok) parts.push(t('mix.sourceDown', { source: name, error: outcome.error || '' }));
      }
    }
    if (r.anchors.asked) {
      const count = r.anchors.asked.length;
      // `<= 1`: French takes the singular at zero too.
      parts.push(count <= 1 ? t('profiles.askedOne', { count }) : t('profiles.asked', { count }));
    }
    parts.push(`${r.ms} ms`);
    return parts.join(' · ');
  })();

  return (
    <>
      {/* One string: React warns on (and drops) a <title> with several children. */}
      <Head><title>{`${profile ? `${profile.emoji ?? DEFAULT_PROFILE_EMOJI} ${profile.name}` : t('profiles.title')} — Anime Tracker`}</title></Head>

      <div className="pf" style={{ ['--pf-top' as string]: `${headerH + 12}px` }}>
        <Link href="/profiles" className="pf-back">← {t('profiles.back')}</Link>

        {profile && (
          <header className="pf-head">
            <input
              className="pf-emoji pf-field"
              defaultValue={profile.emoji ?? ''}
              key={`e-${profile.emoji ?? ''}`}
              placeholder={DEFAULT_PROFILE_EMOJI}
              maxLength={4}
              aria-label="emoji"
              onBlur={e => { const v = e.target.value.trim(); if (v !== (profile.emoji ?? '')) saveMeta({ emoji: v || null }); }}
            />
            <div className="pf-identity">
              <input
                className="pf-name pf-field"
                defaultValue={profile.name}
                key={`n-${profile.name}`}
                aria-label={t('profiles.namePlaceholder')}
                placeholder={t('profiles.namePlaceholder')}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== profile.name) saveMeta({ name: v }); }}
              />
              <textarea
                className="pf-desc pf-field"
                defaultValue={profile.description ?? ''}
                key={`d-${profile.description ?? ''}`}
                rows={1}
                ref={autoGrow}
                onInput={e => autoGrow(e.currentTarget)}
                placeholder={t('profiles.descPlaceholder')}
                aria-label={t('profiles.descPlaceholder')}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (profile.description ?? '')) saveMeta({ description: v || null }); }}
              />
              <p className="pf-meta">
                {usedBy.length === 0 ? (
                  <span>{t('profiles.usedByNone')}</span>
                ) : (
                  <>
                    <span>{t('profiles.usedBy')}</span>
                    {usedBy.map(b => (
                      <Link key={b.id} href={`/boxes/${encodeURIComponent(b.id)}?t=recos`} className="pf-chip">
                        {b.emoji} {b.name}
                      </Link>
                    ))}
                  </>
                )}
                <span className={`pf-save pf-save-${saveState}`}>
                  {saveState === 'saving' ? t('profiles.saving')
                    : saveState === 'saved' ? t('profiles.saved')
                    : saveState === 'error' ? t('profiles.saveError')
                    : ''}
                </span>
              </p>
              {usedBy.length > 0 && (
                <p className="pf-live">
                  {usedBy.length === 1
                    ? t('profiles.liveOne', { name: usedBy[0].name })
                    : t('profiles.live', { count: usedBy.length })}
                </p>
              )}
            </div>
            <div className="pf-actions">
              <button
                type="button"
                className={`pf-btn pf-btnDanger ${confirmDelete ? 'pf-btnOn' : ''}`}
                onClick={() => setConfirmDelete(v => !v)}
                disabled={deleting}
              >
                🗑 {t('profiles.delete')}
              </button>
            </div>
          </header>
        )}

        {profile && confirmDelete && (
          <div className="pf-confirm" role="alertdialog" aria-label={t('profiles.delete')}>
            <span className="pf-confirmText">
              {usedBy.length === 0
                ? t('profiles.deleteConfirmUnused', { name: profile.name })
                : t(usedBy.length === 1 ? 'profiles.deleteConfirmOne' : 'profiles.deleteConfirm', {
                    name: profile.name,
                    boxes: usedBy.map(b => `${b.emoji} ${b.name}`).join(', '),
                  })}
            </span>
            <button type="button" className="pf-btn pf-btnDangerSolid" onClick={remove} disabled={deleting}>
              {deleting ? t('profiles.deleting') : t('profiles.deleteYes')}
            </button>
            <button type="button" className="pf-btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t('boxes.deleteNo')}
            </button>
          </div>
        )}

        {error && <p className="pf-error">{error}</p>}
        {!profile && !error && <p className="pf-note">{t('common.loading')}</p>}

        {profile && (
          <div className="pf-grid">
            <aside className="pf-side">
              <div className="pf-presets">
                <label className="pf-label" htmlFor="pf-preset">{t('profiles.startFrom')}</label>
                <div className="pf-presetRow">
                  <select
                    id="pf-preset"
                    className="pf-select"
                    value={presetKey}
                    onChange={e => setPresetKey(e.target.value as ProfilePreset['key'])}
                  >
                    {PROFILE_PRESETS.map(p => (
                      <option key={p.key} value={p.key}>{t(`profiles.preset.${p.key}` as TranslationKey)}</option>
                    ))}
                  </select>
                  <button type="button" className="pf-btn" onClick={applyPreset}>{t('profiles.applyPreset')}</button>
                  {presetUndo && (
                    <button
                      type="button"
                      className="pf-btn"
                      onClick={() => { saveWeights(presetUndo); setPresetUndo(null); }}
                    >
                      ↩ {t('profiles.undoPreset')}
                    </button>
                  )}
                </div>
                {selectedPreset && (
                  <p className="pf-hint">{t(`profiles.presetHint.${selectedPreset.key}` as TranslationKey)}</p>
                )}
              </div>

              <ProfileSliders
                weights={weights}
                base={base}
                pool={state.pool}
                diagnostic={diagnostic}
                onChange={next => { setPresetUndo(null); saveWeights(next); }}
              />
            </aside>

            <main className="pf-main">
              <div className="pf-context">
                <label className="pf-label" htmlFor="pf-anchor">{t('profiles.testOn')}</label>
                <div className="pf-contextRow">
                  <select
                    id="pf-anchor"
                    className="pf-select pf-selectWide"
                    value={selectValue}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '(adhoc)') { setAdHoc(true); update({ anchors: state.anchors, box: null }); }
                      else if (v) { setAdHoc(false); update({ box: v }); }
                    }}
                  >
                    {!effectiveBox && !adHoc && <option value="">{t('profiles.pickAnchorOption')}</option>}
                    {boxes.filter(b => b.count > 0).map(b => (
                      <option key={b.id} value={b.id}>
                        {b.unitCount <= 1
                          ? t('profiles.boxOptionOne', { emoji: b.emoji, name: b.name, units: b.unitCount })
                          : t('profiles.boxOption', { emoji: b.emoji, name: b.name, units: b.unitCount })}
                      </option>
                    ))}
                    <option value="(adhoc)">{t('profiles.adHoc')}</option>
                  </select>

                  {/* Tune against a box, then attach — the workflow in one place.
                      It attaches the profile AS SAVED, which on this page is
                      always what the sliders show. */}
                  {testedBox && (attachedHere ? (
                    <>
                      <span className="pf-attached">✓ {t('profiles.attachedHere')}</span>
                      <button type="button" className="pf-btn" onClick={() => attach(null)} disabled={attachBusy}>
                        {t('profiles.detach')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="pf-btn pf-btnPrimary" onClick={() => attach(profileId)} disabled={attachBusy}>
                      📎 {testedBox.profileId ? t('profiles.attachReplace') : t('profiles.attach')}
                    </button>
                  ))}
                </div>

                {adHoc && (
                  <MixAnchorsSection
                    anchors={state.anchors.map(id => {
                      const row = anchorRows.get(id);
                      return { id, title: row?.title ?? id, poster: row?.picture };
                    })}
                    onAdd={id => update({ anchors: [...state.anchors, id] })}
                    onRemove={id => update({ anchors: state.anchors.filter(a => a !== id) })}
                    max={MAX_ANCHORS}
                  />
                )}
              </div>

              <nav className="pf-pools" aria-label={t('profiles.poolLabel')}>
                {PREVIEW_POOLS.map((pool: PreviewPool) => (
                  <button
                    key={pool}
                    type="button"
                    className={`pf-pool ${state.pool === pool ? 'pf-poolOn' : ''}`}
                    onClick={() => update({ pool })}
                  >
                    {t(`profiles.pool.${pool}` as TranslationKey)}
                  </button>
                ))}
              </nav>
              <p className="pf-hint">{poolHint}</p>

              {!hasAnchor ? (
                <p className="pf-empty">{adHoc ? t('profiles.pickTitles') : t('profiles.pickAnchor')}</p>
              ) : baselineError || previewError ? (
                <p className="pf-error">{t('profiles.previewError', { error: baselineError || previewError })}</p>
              ) : baseline && baseline.anchors.present === 0 ? (
                <p className="pf-empty">{t('profiles.emptyAnchor')}</p>
              ) : nothing ? (
                // A weighting that ranks exactly like Défaut here gets a
                // sentence, never a list — see the module comment.
                <p className="pf-empty">
                  {t('profiles.tunesNothing')}
                  {state.pool !== 'anchored' && (['crowd', 'anilistCrowd', 'rejection', 'popularity'] as const).some(k => weights[k] !== undefined)
                    ? ` ${t('profiles.tunesNothingCrowd')}` : ''}
                </p>
              ) : !current ? (
                <p className="pf-note">{t('common.loading')}</p>
              ) : (
                <div className={stale ? 'pf-stale' : undefined} aria-busy={stale}>
                  <p className="pf-changed">
                    {changed <= 1
                      ? t('profiles.changedOne', { changed, total: current.items.length })
                      : t('profiles.changed', { changed, total: current.items.length })}
                    {stale && <span className="pf-updating"> · {t('profiles.updating')}</span>}
                  </p>
                  <ProfilePreviewList items={current.items} shifts={shifts} />
                </div>
              )}
              {status && hasAnchor && <p className="pf-status">{status}</p>}
            </main>
          </div>
        )}
      </div>

      {/* Scoped block for this component's own markup. */}
      <style jsx>{`
        .pf { max-width: clamp(1100px, 100vw - 400px, 1600px); margin: 0 auto; padding: 16px 20px 48px; }

        .pf-head { display: flex; align-items: flex-start; gap: 18px; margin: 14px 0 18px; }
        .pf-identity { flex: 1; min-width: 0; }
        .pf-actions { flex-shrink: 0; padding-top: 4px; }

        .pf-field {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 8px;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .pf-field:hover { border-color: var(--border-color); }
        .pf-field:focus { border-color: var(--accent-primary); outline: none; background: var(--bg-secondary); }
        .pf-field::placeholder { color: var(--text-muted); font-style: italic; }
        .pf-emoji {
          flex-shrink: 0;
          width: 64px;
          height: 64px;
          padding: 0;
          font-size: 2.1rem;
          text-align: center;
          background: var(--bg-secondary);
          border-color: var(--border-color);
          border-radius: 14px;
        }
        .pf-name { display: block; width: 100%; max-width: 40ch; padding: 2px 8px; font-size: 1.6rem; font-weight: 700; line-height: 1.25; }
        .pf-desc {
          display: block;
          width: 100%;
          max-width: 72ch;
          margin-top: 4px;
          padding: 4px 8px;
          font-size: 0.92rem;
          line-height: 1.5;
          color: var(--text-secondary);
          resize: none;
          overflow: hidden;
        }
        .pf-live { margin: 6px 8px 0; font-size: 0.78rem; color: #f59e0b; }

        .pf-confirm {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin: -6px 0 16px;
          padding: 10px 14px;
          border: 1px solid var(--accent-danger);
          border-radius: 10px;
          background: rgba(248, 113, 113, 0.06);
        }
        .pf-confirmText { flex: 1; min-width: 240px; font-size: 0.85rem; color: var(--text-primary); }

        /*
         * Two columns: the weighting, and what it changes. The slider column is
         * sticky so the list can scroll under a slider being dragged — the list
         * is the long one (30 rows), and a slider out of view while its effect
         * is on screen is the one arrangement that defeats the page.
         */
        .pf-grid {
          display: grid;
          grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
          gap: 28px;
          align-items: start;
        }
        .pf-side {
          position: sticky;
          top: var(--pf-top, 12px);
          max-height: calc(100vh - var(--pf-top, 12px) - 12px);
          overflow-y: auto;
          padding-right: 8px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .pf-main { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
        @media (max-width: 900px) {
          .pf-grid { grid-template-columns: minmax(0, 1fr); }
          .pf-side { position: static; max-height: none; overflow: visible; }
        }

        .pf-presets, .pf-context { display: flex; flex-direction: column; gap: 6px; }
        .pf-presetRow, .pf-contextRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pf-label { font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); }
        .pf-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 0.82rem;
          padding: 5px 8px;
        }
        .pf-selectWide { min-width: 260px; max-width: 100%; }
        .pf-attached { font-size: 0.8rem; color: #10b981; }

        .pf-pools { display: flex; gap: 4px; border-bottom: 1px solid var(--border-color); margin-top: 6px; }

        .pf-hint { margin: 0; font-size: 0.76rem; line-height: 1.45; color: var(--text-muted); }
        .pf-changed { margin: 4px 0 0; font-size: 0.85rem; color: var(--text-secondary); }
        .pf-stale { opacity: 0.55; transition: opacity 0.15s ease; }
        .pf-updating { color: var(--text-muted); font-style: italic; }
        .pf-status { margin: 8px 0 0; font-size: 0.72rem; color: var(--text-muted); }
        .pf-empty {
          margin: 8px 0;
          padding: 28px 16px;
          border: 1px dashed var(--border-hover);
          border-radius: 12px;
          text-align: center;
          font-size: 0.88rem;
          color: var(--text-muted);
        }
        .pf-note { color: var(--text-muted); font-size: 0.85rem; margin: 8px 0; }
        .pf-error { color: var(--accent-danger); font-size: 0.85rem; }
      `}</style>

      {/* ⚠️ Global block, every selector prefixed with .pf — it reaches what the
          scoped one cannot: classNames handed to next/link (the back link, the
          box chips) and the pool tabs and buttons, which are produced inside
          a map in a helper position. The /boxes/[id] note has the full story. */}
      <style jsx global>{`
        .pf .pf-back { color: var(--text-muted); font-size: 0.82rem; text-decoration: none; }
        .pf .pf-back:hover { color: var(--text-primary); }
        .pf .pf-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 8px 0; font-size: 0.78rem; color: var(--text-muted); }
        .pf .pf-chip {
          padding: 1px 9px;
          border: 1px solid var(--border-color);
          border-radius: 999px;
          color: var(--text-secondary);
          text-decoration: none;
        }
        .pf .pf-chip:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .pf .pf-save { margin-left: auto; }
        .pf .pf-save-saved { color: #10b981; }
        .pf .pf-save-error { color: var(--accent-danger); }

        .pf .pf-pool {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          color: var(--text-muted);
          font-size: 0.88rem;
          font-weight: 500;
          padding: 7px 12px;
          cursor: pointer;
        }
        .pf .pf-pool:hover { color: var(--text-primary); }
        .pf .pf-poolOn { color: var(--text-primary); font-weight: 600; border-bottom-color: var(--accent-primary); }

        .pf .pf-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 0.78rem;
          line-height: 1.4;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .pf .pf-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .pf .pf-btn:disabled { opacity: 0.6; cursor: default; }
        .pf .pf-btnPrimary { background: var(--accent-primary); border-color: var(--accent-primary); color: #fff; font-weight: 600; }
        .pf .pf-btnPrimary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
        .pf .pf-btnDanger { background: none; border-color: transparent; color: var(--text-muted); padding: 5px 8px; }
        .pf .pf-btnDanger:hover, .pf .pf-btnDanger.pf-btnOn { border-color: var(--accent-danger); color: var(--accent-danger); }
        .pf .pf-btnDangerSolid { background: var(--accent-danger-strong); border-color: var(--accent-danger-strong); color: #fff; font-weight: 600; }
      `}</style>
    </>
  );
}
