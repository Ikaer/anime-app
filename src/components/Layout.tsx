import { useCallback, useEffect, useRef, useState } from 'react';
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
      { href: '/boxes', key: 'nav.boxes' },
      { href: '/favorites', key: 'nav.favorites' },
      { href: '/characters', key: 'nav.characters' },
      { href: '/profiles', key: 'nav.profiles' },
      { href: '/catch-up', key: 'nav.catchUp' },
      { href: '/quick-rate', key: 'nav.quickRate' },
    ],
  },
  {
    labelKey: 'nav.group.analyse',
    items: [
      { href: '/stats', key: 'nav.stats' },
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
 * maintained separately and had silently drifted: `/precedence` was in the
 * menu but not in the list, so the parent read as inactive there.
 */
const OTHER_ROUTES: string[] = OTHER_NAV_GROUPS.flatMap(g => g.items).map(item => item.href);

/**
 * A nav entry owns its sub-routes: `/boxes/[id]` and `/profiles/[id]` are the
 * `/boxes` and `/profiles` sections, so an exact `pathname` match left both
 * reading as nowhere in the app. `/` is exact-only — every route starts with it.
 */
function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

/**
 * The floor the measured room is clamped to: a menu squeezed to nothing would be
 * worse than one that overflows. Unreachable in practice — the trigger sits in a
 * header at the top of the viewport.
 */
const MIN_DROPDOWN_HEIGHT = 160;

/** The menu's own `margin-top` (0.75rem), and a little air below it. */
const MENU_GAP = 12;
const MENU_AIR = 16;

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
  /** Undefined until measured — SSR and the first paint must not guess a height. */
  const [maxHeight, setMaxHeight] = useState<number>();

  const isActive = OTHER_ROUTES.some(href => isRouteActive(router.pathname, href));

  /**
   * The menu scrolls INSIDE itself rather than overflowing the viewport, and the
   * room it gets is measured rather than assumed.
   *
   * ⚠️ Not a hardcoded `calc(100vh - <header>)`: the header wraps to two lines at
   * the real target width (4K TV at 300% zoom), i.e. exactly when a constant
   * would be wrong — `GroupBlade` measures the header for the same reason.
   *
   * ⚠️ What it fixes is NOT merely a tall menu. `globals.css` sets
   * `overflow-x: hidden` on html AND body, which makes `body` a scroll container,
   * so `position: sticky` on `.header` is inert while the DOCUMENT scrolls (the
   * header's scrollport is body, and body never moves). On a page whose content
   * fits the viewport the document has no scroll range at all, so the menu's own
   * overflow is what creates one — on BODY, where the sticky header finally does
   * engage and pins itself, menu included. The scrollbar then moves the page
   * under a menu that stays put, and its last entries are unreachable. Capping
   * the height removes the overflow, so that scroll range is never created.
   *
   * ⚠️ Measured off the WRAPPER, not off the trigger button: the menu is
   * `top: 100%` of `.nav-dropdown`, which is a centred flex box as tall as the
   * nav row rather than as tall as its button. Measuring the button left the
   * menu ~10px past the fold — right-looking, and wrong.
   */
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const room = window.innerHeight - el.getBoundingClientRect().bottom - MENU_GAP - MENU_AIR;
    setMaxHeight(Math.max(MIN_DROPDOWN_HEIGHT, room));
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    // Capture phase: the scroller here may be `body` rather than the document.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

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
        onClick={() => {
          if (!open) measure();
          setOpen(o => !o);
        }}
      >
        {t('nav.others')} <span className="nav-dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="nav-dropdown-menu" role="menu" style={{ maxHeight }}>
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
                  className={`nav-dropdown-item ${isRouteActive(router.pathname, item.href) ? 'active' : ''}`}
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
  const headerRef = useRef<HTMLElement>(null);

  /**
   * Publish the header's height as `--app-header-h` on the document root.
   *
   * The header is `position: sticky; top: 0`, so anything else that pins to the
   * top of the viewport lands BEHIND it — `top: 0` is under the nav, not under
   * the page. Every such rule offsets by this variable instead of a constant,
   * for `GroupBlade`'s reason: the bar wraps to two lines at the TV target
   * (4K at 300% zoom, ~1280 CSS px), i.e. exactly when a constant is wrong.
   *
   * ⚠️ One seam: three surfaces used to measure `.header` themselves. Read the
   * variable rather than adding a fourth. The `0px` fallback in each consumer
   * is the pre-measurement frame, not a default worth relying on.
   */
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    apply();
    // The bar re-wraps on a width change, which a window resize does not always
    // describe (a scrollbar appearing is one); observe the element itself.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(el);
    else window.addEventListener('resize', apply);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', apply);
    };
  }, []);

  return (
    <div>
      <NavigationProgress />
      <header className="header" ref={headerRef}>
        <div className="container">
          <div className="header-content">
            <GlobalSearch />
            <div className="header-right">
              <nav className="nav">
                {PRIMARY_NAV.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link ${isRouteActive(router.pathname, item.href) ? 'active' : ''}`}
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
