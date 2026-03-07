import React from 'react';
import styles from './AnimePageLayout.module.css';

interface AnimePageLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

const AnimePageLayout: React.FC<AnimePageLayoutProps> = ({ sidebar, children }) => {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.mainContent}>{children}</main>
    </div>
  );
};

export default AnimePageLayout;
