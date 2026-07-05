import Link from 'next/link';
import { useRouter } from 'next/router';
import { MalConnectionBadge, SimklConnectionBadge } from '@/components/anime';

interface LayoutProps {
  children: React.ReactNode;
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
                  href="/rate"
                  className={`nav-link ${router.pathname === '/rate' ? 'active' : ''}`}
                >
                  Rating Calculator
                </Link>
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
