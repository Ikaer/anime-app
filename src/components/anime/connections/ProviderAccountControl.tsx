import React from 'react';
import styles from './ProviderAccountControl.module.css';
import type { ProviderStatus } from '@/lib/providers/status';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

interface ProviderAccountControlProps {
  status: ProviderStatus;
  isLoading: boolean;
  error: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * The connect / disconnect control, once for every OAuth'd provider. The label's
 * provider name comes from the descriptor, so a new provider needs no new copy
 * of this component.
 *
 * `configured: false` (no client id in settings) disables connecting and says
 * so — a stated blocker rather than a button that fails on click.
 */
const ProviderAccountControl: React.FC<ProviderAccountControlProps> = ({
  status, isLoading, error, onConnect, onDisconnect,
}) => {
  const t = useT();

  if (isLoading) {
    return <Button variant="secondary" disabled>{t('common.loading')}</Button>;
  }

  return (
    <>
      {status.connected ? (
        <Button variant="primary-negative" onClick={onDisconnect}>
          {t('account.disconnect')}
        </Button>
      ) : (
        <Button onClick={onConnect} disabled={!status.configured}>
          {t('account.connectProvider', { provider: status.label })}
        </Button>
      )}
      {!status.configured && (
        <div className={styles.hint}>{t('account.notConfigured', { provider: status.label })}</div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
};

export default ProviderAccountControl;
