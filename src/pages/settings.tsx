import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import { useT, type TranslationKey } from '@/lib/i18n';

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

interface SettingsResponse {
  fields: Record<FieldName, FieldStatus>;
  bootstrap: Record<BootField, BootFieldStatus>;
  preferences: PreferencesStatus;
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
        }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      applyResponse(await resp.json());
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  }, [values, bootValues, localEnabled, localPrecedence, applyResponse]);

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
        .actions { display: flex; align-items: center; gap: 1rem; }
        .save { background: var(--accent-color, #4a9eff); color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1.4rem; font-size: 0.95rem; cursor: pointer; }
        .save:disabled { opacity: 0.6; cursor: default; }
        .ok { color: #6ed99a; font-size: 0.9rem; }
        .err { color: #ff7a7a; font-size: 0.9rem; }
      `}</style>
    </>
  );
}
