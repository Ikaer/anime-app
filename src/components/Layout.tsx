import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ConnectionBadges } from '@/components/anime';
import GlobalSearch from '@/components/GlobalSearch';
import NavigationProgress from '@/components/NavigationProgress';
import { useI18n, LANG_LABELS, type Lang, type TranslationKey } from '@/lib/i18n';

interface LayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  key: TranslationKey;
}

/**
 * The bar itself — the four surfaces actually used day to day, in the order
 * they are reached for. Everything else lives under "Autres" so this row stays
 * scannable at the real target (4K TV at 300% zoom, ~1280 CSS px), where a
 * seven-item bar plus badges wraps onto a second line.
 */
const PRIMARY_NAV: NavItem[] = [
  { href: '/', key: 'nav.anime' },
  { href: '/recommendations', key: 'nav.forYou' },
  { href: '/tier', key: 'nav.tierList' },
  { href: '/activity', key: 'nav.activity' },
];

interface NavGroup {
  /** Omitted on the trailing group: it gets a separator rule but no heading. */
  labelKey?: TranslationKey;
  items: NavItem[];
}

/**
 * The dropdown, grouped by what you are trying to DO, because at ten entries a
 * flat list stopped being scannable.
 *
 * The first group is the three surfaces that were top-level until the bar was
 * trimmed — still routine work, just not daily. The second is read-only
 * analysis. The third is about the providers and the data itself. Settings sits
 * alone at the foot, unlabelled, which is where every application puts it.
 *
 * ⚠️ **Every entry carries an emoji, including the diagnostic ones.** An earlier
 * pass deliberately left those bare so the split would read at a glance; the
 * group headings now do that job properly, and a menu where two thirds of the
 * rows have an icon and one third does not just looks unfinished. If you add an
 * entry, give it an icon in BOTH locale files.
 */
const OTHER_NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group.explore',
    items: [
      { href: '/mix', key: 'nav.mix' },
      { href: '/catch-up', key: 'nav.catchUp' },
      { href: '/quick-rate', key: 'nav.quickRate' },
    ],
  },
  {
    labelKey: 'nav.group.analyse',
    items: [
      { href: '/stats', key: 'nav.stats' },
      { href: '/graph', key: 'nav.graph' },
      { href: '/rate', key: 'nav.ratingCalculator' },
    ],
  },
  {
    labelKey: 'nav.group.sources',
    items: [
      { href: '/connections', key: 'nav.connections' },
      { href: '/discrepancies', key: 'nav.discrepancies' },
      { href: '/precedence', key: 'nav.precedence' },
    ],
  },
  {
    items: [{ href: '/settings', key: 'nav.settings' }],
  },
];

/**
 * DERIVED, never hand-written — flattened through the groups so regrouping an
 * entry cannot change which routes light the trigger. This list used to be
 * maintained separately and had silently drifted: `/graph` and `/precedence`
 * were in the menu but not in the list, so the parent read as inactive on both.
 */
const OTHER_ROUTES: string[] = OTHER_NAV_GROUPS.flatMap(g => g.items).map(item => item.href);

function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const next: Lang = lang === 'fr' ? 'en' : 'fr';
  return (
    <button
      type="button"
      className="nav-link lang-toggle"
      onClick={() => setLang(next)}
      title={t('lang.switchTo', { lang: LANG_LABELS[next] })}
      aria-label={t('lang.switchTo', { lang: LANG_LABELS[next] })}
    >
      {lang.toUpperCase()}
    </button>
  );
}

function OthersDropdown() {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = OTHER_ROUTES.includes(router.pathname);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close whenever the route changes (a menu item was followed).
  useEffect(() => {
    setOpen(false);
  }, [router.pathname]);

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={`nav-link nav-dropdown-trigger ${isActive ? 'active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {t('nav.others')} <span className="nav-dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="nav-dropdown-menu" role="menu">
          {OTHER_NAV_GROUPS.map((group, i) => (
            <div
              key={group.labelKey ?? `group-${i}`}
              className="nav-dropdown-group"
              role="group"
              aria-label={group.labelKey ? t(group.labelKey) : undefined}
            >
              {group.labelKey && (
                <div className="nav-dropdown-group-label" aria-hidden="true">
                  {t(group.labelKey)}
                </div>
              )}
              {group.items.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={`nav-dropdown-item ${router.pathname === item.href ? 'active' : ''}`}
                >
                  {t(item.key)}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div>
      <NavigationProgress />
      <header className="header">
        <div className="container">
          <div className="header-content">
            <GlobalSearch />
            <div className="header-right">
              <nav className="nav">
                {PRIMARY_NAV.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link ${router.pathname === item.href ? 'active' : ''}`}
                  >
                    {t(item.key)}
                  </Link>
                ))}
                <OthersDropdown />
              </nav>
              <div className="connection-badges">
                <LanguageToggle />
                <ConnectionBadges />
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  );
}
