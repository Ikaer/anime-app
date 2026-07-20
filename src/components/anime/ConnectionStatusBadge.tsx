import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './ConnectionStatusBadge.module.css';

interface ConnectionStatusBadgeProps {
  /** Provider icon. Omit and pass `label` instead when we ship no brand asset. */
  iconSrc?: string;
  /** Short text glyph used in place of an icon (same idiom as AnilistAuthSection's "AL"). */
  label?: string;
  alt: string;
  connected: boolean;
  title: string;
}

const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({ iconSrc, label, alt, connected, title }) => {
  return (
    <Link href="/connections" className={styles.badge} title={title}>
      {iconSrc ? (
        <Image
          src={iconSrc}
          alt={alt}
          width={22}
          height={22}
          className={`${styles.icon} ${connected ? styles.connected : ''}`}
        />
      ) : (
        <span
          role="img"
          aria-label={alt}
          className={`${styles.textIcon} ${connected ? styles.connected : ''}`}
        >
          {label}
        </span>
      )}
      <span className={`${styles.dot} ${connected ? styles.connected : ''}`} />
    </Link>
  );
};

export default ConnectionStatusBadge;
