import React from 'react';
import Image from 'next/image';
import styles from './ProviderCard.module.css';
import type { ProviderStatus } from '@/lib/providers/status';
import type { ProviderRole, ProviderAuthKind, PersonalDimension } from '@/lib/providers/capabilities';
import { useT, type TranslationKey } from '@/lib/i18n';

interface ProviderCardProps {
  status: ProviderStatus | undefined;
  /** Which of the provider's roles this card is about. Drives the whole render. */
  role: ProviderRole;
  /**
   * Account control (connect / disconnect) for this role's auth slot. Omitted
   * when the role needs no account — the slot then states *why*, rather than
   * being silently absent, which is the difference between a declared
   * capability gap and an unimplemented feature.
   */
  authControl?: React.ReactNode;
  /** Extra line under the status, e.g. "this account is managed below". */
  note?: string;
  /** This role's actions — genuinely provider-specific, deliberately not abstracted. */
  children?: React.ReactNode;
}

const AUTH_KEYS: Record<ProviderAuthKind, TranslationKey> = {
  none: 'provider.auth.none',
  anonymous: 'provider.auth.anonymous',
  oauth: 'provider.auth.oauth',
  'oauth+secret': 'provider.auth.oauthSecret',
};

/**
 * **One card shape for every provider** (docs/PROVIDER-PARITY.md E1), rendered
 * from `PROVIDER_CAPABILITIES` + live status. It replaces `AccountSection` /
 * `SimklSection` / `AnilistAuthSection` — three components, three prop shapes,
 * three layouts for one concept — and gives `local` a presence it never had (E3).
 *
 * A card is a **(provider, role)** pair, not a provider (E4): MAL and AniList
 * each render twice, once under catalog and once under personal, because that is
 * what they are. The auth kind is read per role, which is the whole point —
 * AniList's catalog card says "no account required" while its list card asks for
 * OAuth, and filing the two together is exactly how the metadata sync ended up
 * looking like it needed a login.
 *
 * What is uniform: identity, the auth slot, capability chips, status. What is
 * not, and is passed in as `children`: the actions. MAL's seasonal crawl,
 * SIMKL's delta and AniList's GraphQL batch are different operations, and
 * PROVIDER-ABSTRACTION.md is right that hiding them behind one interface buys
 * nothing.
 */
const ProviderCard: React.FC<ProviderCardProps> = ({ status, role, authControl, note, children }) => {
  const t = useT();
  if (!status) return null;

  const capability = role === 'catalog' ? status.catalog : status.personal;
  if (!capability) return null;

  const auth = capability.auth;
  const needsAccount = auth === 'oauth' || auth === 'oauth+secret';
  const stale = status.connected && !status.tokenValid;

  const statusLine: { text: string; tone: 'ok' | 'warn' | 'off' } = (() => {
    if (!needsAccount) {
      // No account for this role. For `local` that means "is it switched on?";
      // for an anonymous catalog read there is nothing to be connected to.
      if (auth === 'none') {
        return {
          text: status.enabled ? t('provider.active') : t('provider.inactive'),
          tone: status.enabled ? 'ok' : 'off',
        };
      }
      return { text: t('provider.noAccountNeeded'), tone: 'ok' };
    }
    if (stale) return { text: t('provider.expired'), tone: 'warn' };
    if (status.connected) {
      return {
        text: status.userName
          ? t('provider.connectedAs', { name: status.userName })
          : t('provider.connected'),
        tone: 'ok',
      };
    }
    if (!status.configured) return { text: t('provider.notConfigured'), tone: 'off' };
    return { text: t('provider.notConnected'), tone: 'off' };
  })();

  // The auth chip is dropped for `anonymous`, where the status line already says
  // "no account required" — a chip repeating it verbatim reads as a bug.
  const authChip = auth === 'anonymous' ? null : t(AUTH_KEYS[auth]);

  const chips: string[] = [];
  if (role === 'catalog' && status.catalog) {
    if (authChip) chips.push(authChip);
    if (status.catalog.crowdRecommendations) chips.push(t('provider.crowdRecos'));
  }
  if (role === 'personal' && status.personal) {
    const personal = status.personal;
    if (authChip) chips.push(authChip);
    chips.push(t(personal.listCoverage === 'full' ? 'provider.coverage.full' : 'provider.coverage.subset'));
    chips.push(
      personal.write.length === 0
        ? t('provider.readOnly')
        : t('provider.writes', {
            dimensions: personal.write
              .map(d => t(`provider.dimension.${d}` as TranslationKey))
              .join(', '),
          })
    );
    if (personal.clearStatus) chips.push(t('provider.clearStatus'));
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        {status.iconSrc ? (
          <Image src={status.iconSrc} alt={status.label} width={24} height={24} className={styles.icon} />
        ) : (
          <span className={styles.textIcon} aria-hidden="true">{status.shortLabel}</span>
        )}
        <h3 className={styles.title}>{status.label}</h3>
        <span className={`${styles.status} ${styles[statusLine.tone]}`}>{statusLine.text}</span>
      </header>

      <div className={styles.chips}>
        {chips.map(chip => (
          <span key={chip} className={styles.chip}>{chip}</span>
        ))}
        {/* Facts that only exist once there is data. Rendered as chips too, so a
            provider holding nothing is visibly holding nothing. */}
        {role === 'personal' && (
          <span className={styles.chip}>{t('provider.entries', { count: status.entryCount })}</span>
        )}
        {role === 'personal' && status.precedenceRank >= 0 && (
          <span className={styles.chip}>{t('provider.precedence', { rank: status.precedenceRank + 1 })}</span>
        )}
      </div>

      {note && <p className={styles.note}>{note}</p>}
      {authControl && <div className={styles.authSlot}>{authControl}</div>}
      {children && <div className={styles.actions}>{children}</div>}
    </article>
  );
};

export default ProviderCard;
