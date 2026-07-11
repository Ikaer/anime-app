import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

/**
 * Lightweight, dependency-free i18n for a single-user app.
 *
 * Design choices (see CLAUDE.md "Internationalization"):
 * - Two flat JSON dictionaries (`fr`/`en`), keyed by dotted string keys.
 *   `fr` is the source of truth for the key set; `en` is typed against it so a
 *   missing English key is a compile error. A contributor adds a language by
 *   copying a JSON file and registering it in `DICTS`.
 * - The active language lives in `localStorage` (no URL param, no SSR routing).
 *   To stay hydration-safe, the very first client render uses `DEFAULT_LANG`
 *   (matching the server), then a mount effect swaps in the stored choice.
 * - `t(key, params?)` looks the key up in the active dict, falls back to `fr`,
 *   then to the raw key, and interpolates `{name}` placeholders.
 */

export type Lang = 'fr' | 'en';

export const LANGS: Lang[] = ['fr', 'en'];
export const DEFAULT_LANG: Lang = 'fr';
const STORAGE_KEY = 'anime-app.lang';

// `fr` defines the canonical key set; `en` must cover the same keys.
// Typing the values as `Record<TranslationKey, string>` (not `string`) makes a
// key present in fr.json but missing from en.json a COMPILE error.
export type TranslationKey = keyof typeof fr;
const DICTS: Record<Lang, Record<TranslationKey, string>> = { fr, en };

export const LANG_LABELS: Record<Lang, string> = {
  fr: 'Français',
  en: 'English',
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * Framework-free lookup, usable on the server (e.g. the reco "Pourquoi ?" detail
 * strings built in `recommendations.ts`). Same fallback chain as the hook:
 * active dict → `fr` → raw key.
 */
export function translate(
  lang: Lang,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LANG];
  const raw = dict[key] ?? fr[key] ?? key;
  return interpolate(raw, params);
}

/** Bind a language into a `TFunction` — for server code that builds localized strings. */
export function makeT(lang: Lang): TFunction {
  return (key, params) => translate(lang, key, params);
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Read the stored preference after mount so SSR and first paint agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'fr' || stored === 'en') setLangState(stored);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const t = useCallback<TFunction>(
    (key, params) => {
      const dict = DICTS[lang];
      const raw = dict[key] ?? fr[key] ?? key;
      return interpolate(raw, params);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience hook returning just the `t` function. */
export function useT(): TFunction {
  return useI18n().t;
}
