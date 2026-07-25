import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { catalogOrderingWithWinner, catalogWinnerOf } from '@/lib/domain/animeUtils';
import type { CatalogSource } from '@/models/anime';

/**
 * Runtime settings page. Enters the data/log folders (Tier 0, → config.json) and
 * the provider app credentials (Tier 1, → settings.json), each of which also
 * has an env fallback. Secrets are write-only: the GET never hands their value
 * back, and leaving
 * a secret field blank keeps the stored one untouched.
 */

type FieldName =
  | 'malClientId'
  | 'simklClientId'
  | 'simklClientSecret'
  | 'simklAppName'
  | 'anilistClientId'
  | 'anilistClientSecret'
  | 'cronSecret';

type BootField = 'dataPath' | 'logsPath';

interface FieldStatus {
  secret: boolean;
  set: boolean;
  fromEnv: boolean;
  stored?: string;
}

interface BootFieldStatus {
  stored: string;
  resolved: string;
  fromEnv: boolean;
}

type LocalEnabled = 'auto' | 'on' | 'off';
type LocalPrecedence = 'auto' | 'localTop' | 'localBottom';

interface PreferencesStatus {
  localProviderEnabled: LocalEnabled;
  localPrecedenceMode: LocalPrecedence;
  resolved: {
    enabled: boolean;
    hasWritableExternal: boolean;
    precedenceOrder: string[];
  };
}

/**
 * Catalog precedence (E5). The server hands over both what the user stored and
 * what the merge resolves to, plus the field/contributor lists — so this form's
 * options come from the same constants the POST validates against and the two
 * cannot drift.
 */
interface CatalogPrecedenceStatus {
  stored: Record<string, CatalogSource[]>;
  resolved: Record<string, CatalogSource[]>;
  shipped: Record<string, CatalogSource[]>;
  fields: string[];
  contributors: CatalogSource[];
  defaultOrder: CatalogSource[];
}

interface SettingsResponse {
  fields: Record<FieldName, FieldStatus>;
  bootstrap: Record<BootField, BootFieldStatus>;
  preferences: PreferencesStatus;
  catalogPrecedence: CatalogPrecedenceStatus;
  derivedRedirectUris: { mal: string; simkl: string; anilist: string };
}

const LOCAL_ENABLED_OPTIONS: LocalEnabled[] = ['auto', 'on', 'off'];
const LOCAL_PRECEDENCE_OPTIONS: LocalPrecedence[] = ['auto', 'localTop', 'localBottom'];

const BOOT_FIELDS: BootField[] = ['dataPath', 'logsPath'];

const GROUPS: { titleKey: TranslationKey; fields: FieldName[] }[] = [
  { titleKey: 'settings.group.mal', fields: ['malClientId'] },
  {
    titleKey: 'settings.group.simkl',
    fields: ['simklClientId', 'simklClientSecret', 'simklAppName'],
  },
  {
    titleKey: 'settings.group.anilist',
    fields: ['anilistClientId', 'anilistClientSecret'],
  },
  { titleKey: 'settings.group.cron', fields: ['cronSecret'] },
];

const SECRET_FIELDS: FieldName[] = ['simklClientSecret', 'anilistClientSecret', 'cronSecret'];
const ALL_FIELDS = GROUPS.flatMap(g => g.fields);

export default function SettingsPage() {
  const t = useT();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [values, setValues] = useState<Record<FieldName, string>>(() =>
    Object.fromEntries(ALL_FIELDS.map(f => [f, ''])) as Record<FieldName, string>
  );
  const [bootValues, setBootValues] = useState<Record<BootField, string>>(() =>
    Object.fromEntries(BOOT_FIELDS.map(f => [f, ''])) as Record<BootField, string>
  );
  const [localEnabled, setLocalEnabled] = useState<LocalEnabled>('auto');
  const [localPrecedence, setLocalPrecedence] = useState<LocalPrecedence>('auto');
  // Keyed by catalog field, holding the WINNER only. The full ordering is
  // rebuilt on save via `catalogOrderingWithWinner` — the store keeps arrays
  // (the shape the merge consumes) while the control asks the one question that
  // actually has more than one answer.
  const [catalogWinners, setCatalogWinners] = useState<Record<string, CatalogSource>>({});
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const applyResponse = useCallback((resp: SettingsResponse) => {
    setData(resp);
    // Non-secret inputs prefill from the stored value; secret inputs stay blank
    // (their value is never returned) — blank on save means "leave unchanged".
    setValues(
      Object.fromEntries(
        ALL_FIELDS.map(f => [f, SECRET_FIELDS.includes(f) ? '' : resp.fields[f]?.stored ?? ''])
      ) as Record<FieldName, string>
    );
    setBootValues(
      Object.fromEntries(BOOT_FIELDS.map(f => [f, resp.bootstrap[f]?.stored ?? ''])) as Record<
        BootField,
        string
      >
    );
    setLocalEnabled(resp.preferences?.localProviderEnabled ?? 'auto');
    setLocalPrecedence(resp.preferences?.localPrecedenceMode ?? 'auto');
    // Prefill from RESOLVED, not stored: a field the user never touched still
    // has a winner (its shipped pin, or the global default), and showing that
    // is the point — the form states who wins today, not who was overridden.
    const cp = resp.catalogPrecedence;
    setCatalogWinners(
      Object.fromEntries(
        (cp?.fields ?? []).map(f => [
          f,
          catalogWinnerOf(cp.resolved[f] ?? cp.defaultOrder) ?? cp.defaultOrder[0],
        ])
      )
    );
  }, []);

  useEffect(() => {
    fetch('/api/anime/settings')
      .then(r => r.json())
      .then((resp: SettingsResponse) => {
        applyResponse(resp);
        setStatus('idle');
      })
      .catch(() => setStatus('error'));
  }, [applyResponse]);

  const onSave = useCallback(async () => {
    setStatus('saving');
    try {
      const resp = await fetch('/api/anime/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          ...bootValues,
          localProviderEnabled: localEnabled,
          localPrecedenceMode: localPrecedence,
          // Every configurable field, always — the server sanitizes the no-ops
          // away, so "back to default" needs no separate clear action.
          catalogPrecedence: Object.fromEntries(
            Object.entries(catalogWinners).map(([field, winner]) => [
              field,
              catalogOrderingWithWinner(winner, data?.catalogPrecedence.defaultOrder),
            ])
          ),
        }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      applyResponse(await resp.json());
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  }, [values, bootValues, localEnabled, localPrecedence, catalogWinners, data, applyResponse]);

  const copy = useCallback((text: string, key: string) => {
    const done = () => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    };
    // HTTP (NAS) has no navigator.clipboard — fall back to execCommand.
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done, () => {});
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      done();
    }
  }, []);

  // The redirect URI is derived from the request host, not stored: it is shown
  // next to each client-id field as the value to register with the provider.
  const redirectKeyFor = (f: FieldName): 'mal' | 'simkl' | 'anilist' | null =>
    f === 'malClientId' ? 'mal' : f === 'simklClientId' ? 'simkl' : f === 'anilistClientId' ? 'anilist' : null;

  return (
    <>
      <Head>
        <title>{t('settings.pageTitle')}</title>
        <meta name="description" content={t('settings.metaDescription')} />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <div className="settings-page">
        <h1>{t('settings.heading')}</h1>
        <p className="intro">{t('settings.intro')}</p>

        {status === 'loading' && <p className="muted">{t('common.loading')}</p>}

        {data && (
          <form
            onSubmit={e => {
              e.preventDefault();
              onSave();
            }}
          >
            <section className="group">
              <h2>{t('settings.group.paths')}</h2>
              <p className="group-note">{t('settings.paths.restartNote')}</p>
              {BOOT_FIELDS.map(f => {
                const boot = data.bootstrap[f];
                return (
                  <div key={f} className="field">
                    <label htmlFor={f}>{t(`settings.field.${f}` as TranslationKey)}</label>
                    <div className="input-row">
                      <input
                        id={f}
                        type="text"
                        value={bootValues[f]}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={boot.resolved}
                        onChange={e => setBootValues(v => ({ ...v, [f]: e.target.value }))}
                      />
                    </div>
                    <div className="hints">
                      <span className="resolved">
                        {t('settings.paths.resolved')} <code>{boot.resolved}</code>
                      </span>
                      {boot.fromEnv && <span className="badge env">{t('settings.paths.envWins')}</span>}
                    </div>
                  </div>
                );
              })}
            </section>

            {GROUPS.map(group => (
              <section key={group.titleKey} className="group">
                <h2>{t(group.titleKey)}</h2>
                {group.fields.map(f => {
                  const field = data.fields[f];
                  const isSecret = field.secret;
                  const redirectKey = redirectKeyFor(f);
                  const derived = redirectKey ? data.derivedRedirectUris[redirectKey] : null;
                  return (
                    <div key={f} className="field">
                      <label htmlFor={f}>{t(`settings.field.${f}` as TranslationKey)}</label>
                      <div className="input-row">
                        <input
                          id={f}
                          type={isSecret ? 'password' : 'text'}
                          value={values[f]}
                          autoComplete="off"
                          placeholder={
                            isSecret && field.set
                              ? t('settings.secretPlaceholder')
                              : field.fromEnv
                                ? t('settings.envPlaceholder')
                                : ''
                          }
                          onChange={e => setValues(v => ({ ...v, [f]: e.target.value }))}
                        />
                      </div>
                      <div className="hints">
                        {field.fromEnv && <span className="badge env">{t('settings.envManaged')}</span>}
                        {isSecret && field.set && !field.fromEnv && (
                          <span className="badge set">{t('settings.secretSet')}</span>
                        )}
                        {derived && (
                          <span className="derived">
                            {t('settings.redirectHint')}{' '}
                            <code>{derived}</code>
                            <button
                              type="button"
                              className="copy"
                              onClick={() => copy(derived, f)}
                            >
                              {copiedKey === f ? t('settings.copied') : t('settings.copy')}
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}

            <section className="group">
              <h2>{t('settings.group.local')}</h2>
              <p className="group-note">{t('settings.local.note')}</p>

              <div className="field">
                <label htmlFor="localProviderEnabled">{t('settings.field.localProviderEnabled')}</label>
                <div className="input-row">
                  <select
                    id="localProviderEnabled"
                    value={localEnabled}
                    onChange={e => setLocalEnabled(e.target.value as LocalEnabled)}
                  >
                    {LOCAL_ENABLED_OPTIONS.map(o => (
                      <option key={o} value={o}>{t(`settings.local.enabled.${o}` as TranslationKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="hints">
                  <span className="resolved">
                    {data.preferences.resolved.enabled
                      ? t('settings.local.resolvedEnabledOn')
                      : t('settings.local.resolvedEnabledOff')}
                    {' — '}
                    {data.preferences.resolved.hasWritableExternal
                      ? t('settings.local.hasExternal')
                      : t('settings.local.noExternal')}
                  </span>
                </div>
              </div>

              <div className="field">
                <label htmlFor="localPrecedenceMode">{t('settings.field.localPrecedenceMode')}</label>
                <div className="input-row">
                  <select
                    id="localPrecedenceMode"
                    value={localPrecedence}
                    onChange={e => setLocalPrecedence(e.target.value as LocalPrecedence)}
                  >
                    {LOCAL_PRECEDENCE_OPTIONS.map(o => (
                      <option key={o} value={o}>{t(`settings.local.precedence.${o}` as TranslationKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="hints">
                  <span className="resolved">
                    {t('settings.local.resolvedOrder', {
                      order: data.preferences.resolved.precedenceOrder.join(' > '),
                    })}
                  </span>
                </div>
              </div>
            </section>

            {/* Field names stay raw identifiers in <code>, untranslated — the
                same standing exception `/precedence` takes, and for the same
                reason: `numEpisodes` and `airingStatus` ARE the field names,
                and a translated label would not match what the inspector and
                the record show. */}
            <section className="group">
              <h2>{t('settings.group.catalogPrecedence')}</h2>
              <p className="group-note">{t('settings.catalogPrecedence.note')}</p>
              <div className="prec-grid">
                {data.catalogPrecedence.fields.map(f => {
                  const cp = data.catalogPrecedence;
                  const shippedWinner =
                    catalogWinnerOf(cp.shipped[f] ?? cp.defaultOrder) ?? cp.defaultOrder[0];
                  return (
                    <div key={f} className="prec-row">
                      <label htmlFor={`prec-${f}`}>
                        <code>{f}</code>
                        {cp.stored[f] && (
                          <span className="badge set">{t('settings.catalogPrecedence.changed')}</span>
                        )}
                      </label>
                      <select
                        id={`prec-${f}`}
                        value={catalogWinners[f] ?? shippedWinner}
                        onChange={e =>
                          setCatalogWinners(w => ({ ...w, [f]: e.target.value as CatalogSource }))
                        }
                      >
                        {cp.contributors.map(s => (
                          <option key={s} value={s}>
                            {s === shippedWinner ? t('settings.catalogPrecedence.default', { winner: s }) : s}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="group-note prec-foot">
                <Link href="/precedence">{t('settings.catalogPrecedence.inspect')}</Link>
              </p>
            </section>

            <div className="actions">
              <button type="submit" className="save" disabled={status === 'saving'}>
                {status === 'saving' ? t('settings.saving') : t('settings.save')}
              </button>
              {status === 'saved' && <span className="ok">{t('settings.saved')}</span>}
              {status === 'error' && <span className="err">{t('settings.saveError')}</span>}
            </div>
          </form>
        )}
      </div>
      <style jsx>{`
        .settings-page { max-width: 720px; margin: 0 auto; padding-bottom: 3rem; }
        h1 { font-size: 1.5rem; margin: 0 0 0.5rem; color: var(--text-primary); }
        .intro { color: var(--text-secondary); margin: 0 0 1.5rem; line-height: 1.5; }
        .muted { color: var(--text-secondary); }
        .group { background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
        .group h2 { font-size: 1.1rem; margin: 0 0 1rem; color: var(--text-primary); }
        .group-note { margin: -0.5rem 0 1rem; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4; }
        .resolved { color: var(--text-secondary); display: inline-flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
        .resolved code { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.1rem 0.35rem; color: var(--text-primary); word-break: break-all; }
        .field { margin-bottom: 1.1rem; }
        .field:last-child { margin-bottom: 0; }
        label { display: block; font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.35rem; }
        .input-row { display: flex; }
        input, select { flex: 1; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-primary); padding: 0.55rem 0.7rem; font-size: 0.95rem; font-family: inherit; }
        input:focus, select:focus { outline: none; border-color: var(--accent-color, #4a9eff); }
        select { cursor: pointer; }
        .hints { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.4rem; font-size: 0.8rem; }
        .badge { padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.72rem; }
        .badge.env { background: rgba(74, 158, 255, 0.15); color: #7db9ff; }
        .badge.set { background: rgba(80, 200, 120, 0.15); color: #6ed99a; }
        .derived { color: var(--text-secondary); display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
        .derived code { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.1rem 0.35rem; color: var(--text-primary); }
        .copy { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: 4px; padding: 0.1rem 0.45rem; cursor: pointer; font-size: 0.72rem; }
        .copy:hover { color: var(--text-primary); border-color: var(--text-secondary); }
        /* Two columns of (field, select) pairs: thirteen full-width rows read as
           a wall, and each control is a single narrow <select>. Collapses to one
           column when the viewport can't hold two — the TV target is 4K at 300%
           zoom, i.e. ~1280 CSS px, which fits two. */
        .prec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: .5rem 1.25rem; }
        .prec-row { display: flex; align-items: center; gap: .6rem; }
        .prec-row label { margin-bottom: 0; flex: 1; display: flex; align-items: center; gap: .4rem; min-width: 0; }
        .prec-row code { color: var(--text-primary); font-size: .85rem; word-break: break-all; }
        .prec-row select { flex: 0 0 9rem; padding: .3rem .45rem; font-size: .85rem; }
        .prec-foot { margin: 1rem 0 0; }
        .prec-foot :global(a) { color: var(--accent-color, #4a9eff); }
        .actions { display: flex; align-items: center; gap: 1rem; }
        .save { background: var(--accent-color, #4a9eff); color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1.4rem; font-size: 0.95rem; cursor: pointer; }
        .save:disabled { opacity: 0.6; cursor: default; }
        .ok { color: #6ed99a; font-size: 0.9rem; }
        .err { color: #ff7a7a; font-size: 0.9rem; }
      `}</style>
    </>
  );
}
