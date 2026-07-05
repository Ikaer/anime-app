import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './ConnectionStatusBadge.module.css';

interface ConnectionStatusBadgeProps {
  iconSrc: string;
  alt: string;
  connected: boolean;
  title: string;
}

const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({ iconSrc, alt, connected, title }) => {
  return (
    <Link href="/connections" className={styles.badge} title={title}>
      <Image
        src={iconSrc}
        alt={alt}
        width={22}
        height={22}
        className={`${styles.icon} ${connected ? styles.connected : ''}`}
      />
      <span className={`${styles.dot} ${connected ? styles.connected : ''}`} />
    </Link>
  );
};

export default ConnectionStatusBadge;
