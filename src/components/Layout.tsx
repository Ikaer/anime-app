import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { MalConnectionBadge, SimklConnectionBadge } from '@/components/anime';
import GlobalSearch from '@/components/GlobalSearch';
import { useI18n, LANG_LABELS, type Lang } from '@/lib/i18n';

interface LayoutProps {
  children: React.ReactNode;
}

// Routes grouped under the "Others" dropdown.
const OTHER_ROUTES = ['/stats', '/rate', '/discrepancies', '/settings'];

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
          <Link
            href="/stats"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/stats' ? 'active' : ''}`}
          >
            {t('nav.stats')}
          </Link>
          <Link
            href="/rate"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/rate' ? 'active' : ''}`}
          >
            {t('nav.ratingCalculator')}
          </Link>
          <Link
            href="/discrepancies"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/discrepancies' ? 'active' : ''}`}
          >
            {t('nav.discrepancies')}
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/settings' ? 'active' : ''}`}
          >
            {t('nav.settings')}
          </Link>
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
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link href="/" className="logo">
              {t('brand')}
            </Link>
            <GlobalSearch />
            <div className="header-right">
              <nav className="nav">
                <Link
                  href="/"
                  className={`nav-link ${router.pathname === '/' ? 'active' : ''}`}
                >
                  {t('nav.anime')}
                </Link>
                <Link
                  href="/recommendations"
                  className={`nav-link ${router.pathname === '/recommendations' ? 'active' : ''}`}
                >
                  {t('nav.forYou')}
                </Link>
                <Link
                  href="/tier"
                  className={`nav-link ${router.pathname === '/tier' ? 'active' : ''}`}
                >
                  {t('nav.tierList')}
                </Link>
                <Link
                  href="/quick-rate"
                  className={`nav-link ${router.pathname === '/quick-rate' ? 'active' : ''}`}
                >
                  {t('nav.quickRate')}
                </Link>
                <OthersDropdown />
                <Link
                  href="/connections"
                  className={`nav-link ${router.pathname === '/connections' ? 'active' : ''}`}
                >
                  {t('nav.connections')}
                </Link>
              </nav>
              <div className="connection-badges">
                <LanguageToggle />
                <MalConnectionBadge />
                <SimklConnectionBadge />
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
