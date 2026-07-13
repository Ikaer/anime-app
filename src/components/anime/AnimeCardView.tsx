import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import { AnimeForDisplay, ImageSize, StatsColumn, VisibleColumns, RecoMeta, RecoVerdict } from '@/models/anime';
import { getPrimaryTitle, getSecondaryTitle } from '@/lib/animeUtils';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/searchLinks';
import { useT, TFunction, TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/shared';
import SimklDiscrepancyBadge from './SimklDiscrepancyBadge';
import styles from './AnimeCardView.module.css';

type RecoCard = AnimeForDisplay & { recoMeta?: RecoMeta };

interface AnimeCardViewProps {
    animes: RecoCard[];
    imageSize: ImageSize;
    visibleColumns: VisibleColumns;
    /** Forced number of cards per row; null/undefined = adaptive (auto-fill). */
    cardsPerRow?: number | null;
    onHideToggle?: (animeId: number, hide: boolean) => void;
    onFeedback?: (animeId: number, verdict: RecoVerdict) => void;
    onRemoveFeedback?: (animeId: number) => void;
    /** 'feed' = show 👍/👎; 'up'/'down' = review list (show ↩ Remettre); null = hide toggle. */
    feedbackMode?: 'feed' | RecoVerdict | null;
    /** When true, every card's "Pourquoi ?" breakdown is expanded (global override). */
    allExplainsOpen?: boolean;
}

function formatRecoHint(meta: RecoMeta, t: TFunction): string {
    if (meta.topSeeds.length > 0) {
        const top = meta.topSeeds[0];
        const others = meta.totalSeeds - 1;
        const suffix = others > 0 ? t(others > 1 ? 'recoHint.andOthers' : 'recoHint.andOther', { count: others }) : '';
        return t('recoHint.recommendedBy', { title: top.title }) + suffix;
    }
    if (meta.fromSuggestions) return t('recoHint.suggested');
    return '';
}

export default function AnimeCardView({
    animes,
    imageSize,
    visibleColumns,
    cardsPerRow,
    onHideToggle,
    onFeedback,
    onRemoveFeedback,
    feedbackMode,
    allExplainsOpen
}: AnimeCardViewProps) {
    const t = useT();
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [explainOpen, setExplainOpen] = useState<Set<number>>(new Set());

    const toggleExplain = useCallback((animeId: number) => {
        setExplainOpen(prev => {
            const next = new Set(prev);
            if (next.has(animeId)) next.delete(animeId); else next.add(animeId);
            return next;
        });
    }, []);

    const copyToClipboard = useCallback((text: string, key: string) => {
        const done = () => {
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1500);
        };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(done);
        } else {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            done();
        }
    }, []);

    if (animes.length === 0) {
        return (
            <div className={styles.emptyState}>
                <p>{t('table.emptyState')}</p>
            </div>
        );
    }

    const handleManualSearch = (anime: AnimeForDisplay) => {
        const searchTitle = anime.catalog.alternativeTitles?.en || anime.catalog.title;
        const googleUrl = generateGoogleORQuery(searchTitle);
        window.open(googleUrl, '_blank');
    };

    const handleJustWatchSearch = (anime: AnimeForDisplay) => {
        const searchTitle = anime.catalog.alternativeTitles?.en || anime.catalog.title;
        const justWatchUrl = generateJustWatchQuery(searchTitle);
        window.open(justWatchUrl, '_blank');
    };

    const getDisplayStatus = (anime: AnimeForDisplay) => anime.sources.mal?.my_list_status?.status ?? '';

    const getScoreClass = (score?: number) => {
        if (score === undefined || score === 0) return styles.scoreNa;
        const s = Math.floor(score);
        if (s >= 10) return styles.score10;
        if (s >= 9) return styles.score9;
        if (s >= 8) return styles.score8;
        if (s >= 7) return styles.score7;
        if (s >= 6) return styles.score6;
        if (s >= 5) return styles.score5;
        if (s >= 4) return styles.score4;
        if (s >= 3) return styles.score3;
        if (s >= 2) return styles.score2;
        return styles.score1;
    };

    const formatStatus = (status?: string) => {
        return status ? t(`airing.${status}` as TranslationKey) : t('common.unknown');
    };

    const getMALStatusClass = (status: string) => {
        switch (status) {
            case 'watching': return styles.watching;
            case 'completed': return styles.completed;
            case 'on_hold': return styles.onHold;
            case 'dropped': return styles.dropped;
            case 'plan_to_watch': return styles.planToWatch;
            default: return '';
        }
    };

    const getMALStatusIcon = (status: string) => {
        switch (status) {
            case 'watching': return '📺';
            case 'completed': return '✅';
            case 'on_hold': return '⏸️';
            case 'dropped': return '🗑️';
            case 'plan_to_watch': return '📅';
            default: return '';
        }
    };

    const renderExplain = (meta: RecoMeta) => {
        const rows = meta.breakdown;
        if (rows.length === 0) return null;
        const maxAbs = Math.max(...rows.map(r => Math.abs(r.contribution)), 0.0001);
        return (
            <div className={styles.explainPanel}>
                {rows.map(r => {
                    const pct = (Math.abs(r.contribution) / maxAbs) * 100;
                    const positive = r.contribution >= 0;
                    return (
                        <div key={r.source} className={styles.explainRow}>
                            <div className={styles.explainHead}>
                                <span className={styles.explainLabel}>{t(`reco.source.${r.source}.label` as TranslationKey)}</span>
                                <span className={`${styles.explainValue} ${positive ? styles.explainPos : styles.explainNeg}`}>
                                    {positive ? '+' : ''}{r.contribution.toFixed(2)}
                                </span>
                            </div>
                            <div className={styles.explainBarTrack}>
                                <div
                                    className={`${styles.explainBar} ${positive ? styles.explainBarPos : styles.explainBarNeg}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            {r.detail && <span className={styles.explainDetail}>{r.detail}</span>}
                        </div>
                    );
                })}
            </div>
        );
    };

    const gridStyle = cardsPerRow && cardsPerRow > 0
        ? { gridTemplateColumns: `repeat(${cardsPerRow}, minmax(0, 1fr))` }
        : undefined;

    return (
        <div className={styles.cardGrid} style={gridStyle}>
            {animes.map((anime) => {
                return (
                <div key={anime.id} className={styles.card}>
                    <div className={styles.imageContainer}>
                        {anime.catalog.mainPicture?.large || anime.catalog.mainPicture?.medium ? (
                            <Image
                                src={anime.catalog.mainPicture?.large || anime.catalog.mainPicture?.medium}
                                alt={getPrimaryTitle(anime)}
                                className={styles.animeImage}
                                fill
                                sizes="(max-width: 1200px) 50vw, 280px"
                                unoptimized
                            />
                        ) : (
                            <div className={styles.noImage}>{t('common.noImage')}</div>
                        )}
                        <div className={`${styles.airingBadge} ${anime.catalog.airingStatus === 'currently_airing' ? styles.currentlyAiring : anime.catalog.airingStatus === 'finished_airing' ? styles.finishedAiring : styles.notYetAired}`}>
                            {anime.catalog.airingStatus === 'currently_airing' && <div className={styles.pulsingDot} />}
                            {formatStatus(anime.catalog.airingStatus)}
                        </div>
                        {onHideToggle && (
                            <button
                                className={styles.closeBtn}
                                onClick={() => onHideToggle(anime.id, !anime.hidden)}
                                title={anime.hidden ? t('table.unhide') : t('table.hide')}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        )}
                        <div className={styles.overlay}>
                            <div className={styles.imageActions}>
                                <Button
                                    href={`/anime/${anime.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.imageActionBtn}
                                    variant="secondary"
                                    size="xs"
                                    square
                                    title={t('table.localInfo')}
                                >
                                    ↗
                                </Button>
                                <Button
                                    onClick={() => handleManualSearch(anime)}
                                    className={styles.imageActionBtn}
                                    variant="secondary"
                                    size="xs"
                                    square
                                    title={t('card.searchGoogle')}
                                >
                                    🔍
                                </Button>
                                <Button
                                    onClick={() => handleJustWatchSearch(anime)}
                                    className={styles.imageActionBtn}
                                    variant="secondary"
                                    size="xs"
                                    square
                                    title={t('table.searchJustwatch')}
                                >
                                    <Image src="/justwatch.png" alt="JustWatch" width={20} height={20} className={styles.imageActionIcon} />
                                </Button>
                                <Button
                                    href={`https://myanimelist.net/anime/${anime.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.imageActionBtn}
                                    variant="secondary"
                                    size="xs"
                                    square
                                    title={t('card.openMal')}
                                >
                                    <Image src="/mal.png" alt="MAL" width={20} height={20} className={styles.imageActionIcon} />
                                </Button>
                                {anime.simkl?.simkl_id && (
                                    <Button
                                        href={`https://simkl.com/anime/${anime.simkl.simkl_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.imageActionBtn}
                                        variant="secondary"
                                        size="xs"
                                        square
                                        title={t('card.openSimkl')}
                                    >
                                        <Image src="/simkl.png" alt="SIMKL" width={20} height={20} className={styles.imageActionIcon} />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className={styles.cardContent}>
                        <div className={styles.titleRow}>
                            <span className={styles.title} title={getPrimaryTitle(anime)}>{getPrimaryTitle(anime)}</span>
                            <button
                                className={`${styles.copyBtn} ${copiedKey === `${anime.id}-title` ? styles.copyBtnCopied : ''}`}
                                onClick={() => copyToClipboard(getPrimaryTitle(anime), `${anime.id}-title`)}
                                title={t('card.copyTitle')}
                            >
                                {copiedKey === `${anime.id}-title` ? (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        {getSecondaryTitle(anime) && (
                            <div className={styles.titleRow}>
                                <span className={styles.altTitle}>{getSecondaryTitle(anime)}</span>
                                <button
                                    className={`${styles.copyBtn} ${copiedKey === `${anime.id}-alt` ? styles.copyBtnCopied : ''}`}
                                    onClick={() => copyToClipboard(getSecondaryTitle(anime)!, `${anime.id}-alt`)}
                                    title={t('card.copyAltTitle')}
                                >
                                    {copiedKey === `${anime.id}-alt` ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        )}
                        <div className={styles.infoRow}>
                            {getDisplayStatus(anime) && (
                                <span className={`${styles.malStatusLabel} ${getMALStatusClass(getDisplayStatus(anime))}`}>
                                    <span className={styles.malStatusIcon}>{getMALStatusIcon(getDisplayStatus(anime))}</span>
                                    <span className={styles.malStatusText}>{t(`statusShort.${getDisplayStatus(anime)}` as TranslationKey)}</span>
                                </span>
                            )}
                            {(visibleColumns?.score ?? true) && (
                                <span className={`${styles.score} ${getScoreClass(anime.catalog.mean)}`}>
                                    {anime.catalog.mean ? anime.catalog.mean.toFixed(2) : 'N/A'}
                                </span>
                            )}
                        </div>
                        {anime.recoMeta && formatRecoHint(anime.recoMeta, t) && (
                            <div className={styles.recoHint}>{formatRecoHint(anime.recoMeta, t)}</div>
                        )}
                        {anime.recoMeta && anime.recoMeta.breakdown.length > 0 && (
                            <div className={styles.explainWrap}>
                                {!allExplainsOpen && (
                                    <button
                                        className={styles.explainToggle}
                                        onClick={() => toggleExplain(anime.id)}
                                        aria-expanded={explainOpen.has(anime.id)}
                                    >
                                        {(explainOpen.has(anime.id) ? '▾ ' : '▸ ') + t('card.why')}
                                    </button>
                                )}
                                {(allExplainsOpen || explainOpen.has(anime.id)) && renderExplain(anime.recoMeta)}
                            </div>
                        )}
                        {(feedbackMode || anime.discrepancy || anime.simkl) && (
                        <div className={styles.actions}>
                            <SimklDiscrepancyBadge anime={anime} />
                            {feedbackMode === 'up' || feedbackMode === 'down' ? (
                                <Button
                                    onClick={() => onRemoveFeedback?.(anime.id)}
                                    variant="secondary"
                                    size="xs"
                                    className={styles.actionButton}
                                >
                                    {t('card.putBack')}
                                </Button>
                            ) : feedbackMode === 'feed' ? (
                                <>
                                    <Button
                                        onClick={() => onFeedback?.(anime.id, 'up')}
                                        variant="primary-positive"
                                        size="xs"
                                        className={styles.actionButton}
                                        title={t('card.goodPickTitle')}
                                    >
                                        {t('card.goodPick')}
                                    </Button>
                                    <Button
                                        onClick={() => onFeedback?.(anime.id, 'down')}
                                        variant="primary-negative"
                                        size="xs"
                                        className={styles.actionButton}
                                        title={t('card.notForMeTitle')}
                                    >
                                        {t('card.notForMe')}
                                    </Button>
                                </>
                            ) : null}
                        </div>
                        )}
                    </div>
                </div>
                );
            })}
        </div>
    );
}
