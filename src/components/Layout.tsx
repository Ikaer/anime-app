import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { MalConnectionBadge, SimklConnectionBadge } from '@/components/anime';

interface LayoutProps {
  children: React.ReactNode;
}

// Routes grouped under the "Others" dropdown.
const OTHER_ROUTES = ['/rate', '/discrepancies'];

function OthersDropdown() {
  const router = useRouter();
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
        Others <span className="nav-dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="nav-dropdown-menu" role="menu">
          <Link
            href="/rate"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/rate' ? 'active' : ''}`}
          >
            Rating Calculator
          </Link>
          <Link
            href="/discrepancies"
            role="menuitem"
            className={`nav-dropdown-item ${router.pathname === '/discrepancies' ? 'active' : ''}`}
          >
            MAL/SIMKL discrepancies
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();

  return (
    <div>
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link href="/" className="logo">
              Anime Tracker
            </Link>
            <div className="header-right">
              <nav className="nav">
                <Link
                  href="/"
                  className={`nav-link ${router.pathname === '/' ? 'active' : ''}`}
                >
                  Anime
                </Link>
                <Link
                  href="/recommendations"
                  className={`nav-link ${router.pathname === '/recommendations' ? 'active' : ''}`}
                >
                  ✨ Pour toi
                </Link>
                <Link
                  href="/tier"
                  className={`nav-link ${router.pathname === '/tier' ? 'active' : ''}`}
                >
                  🏆 Tier list
                </Link>
                <OthersDropdown />
                <Link
                  href="/connections"
                  className={`nav-link ${router.pathname === '/connections' ? 'active' : ''}`}
                >
                  Connections
                </Link>
              </nav>
              <div className="connection-badges">
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
