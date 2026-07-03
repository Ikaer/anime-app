import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import { AnimeForDisplay, ImageSize, StatsColumn, VisibleColumns, RecoMeta, RecoSource } from '@/models/anime';
import {  formatUserStatus } from '@/lib/animeUtils';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/searchLinks';
import { SOURCE_META } from '@/lib/recoWeights';
import { Button } from '@/components/shared';
import styles from './AnimeCardView.module.css';

const SOURCE_LABELS: Record<RecoSource, string> = Object.fromEntries(
    SOURCE_META.map(m => [m.source, m.label])
) as Record<RecoSource, string>;

interface MALStatusUpdate {
    status?: string;
    score?: number;
    num_episodes_watched?: number;
}

type RecoCard = AnimeForDisplay & { recoMeta?: RecoMeta };

interface AnimeCardViewProps {
    animes: RecoCard[];
    imageSize: ImageSize;
    visibleColumns: VisibleColumns;
    onUpdateMALStatus?: (animeId: number, updates: MALStatusUpdate) => void;
    onHideToggle?: (animeId: number, hide: boolean) => void;
    onDismiss?: (animeId: number, dismiss: boolean) => void;
    /** 'feed' = show "écarter"; 'dismissed' = show "remettre"; null = neither. */
    dismissMode?: 'feed' | 'dismissed' | null;
    /** When true, every card's "Pourquoi ?" breakdown is expanded (global override). */
    allExplainsOpen?: boolean;
}

function formatRecoHint(meta: RecoMeta): string {
    if (meta.topSeeds.length > 0) {
        const top = meta.topSeeds[0];
        return `Recommandé par les fans de ${top.title} · ${top.backers}`;
    }
    if (meta.fromSuggestions) return 'Suggéré pour toi';
    return '';
}

export default function AnimeCardView({
    animes,
    imageSize,
    visibleColumns,
    onUpdateMALStatus,
    onHideToggle,
    onDismiss,
    dismissMode,
    allExplainsOpen
}: AnimeCardViewProps) {
    const [pendingUpdates, setPendingUpdates] = useState<Map<number, MALStatusUpdate>>(new Map());
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
                <p>No anime found. Try syncing data or adjusting your filters.</p>
            </div>
        );
    }

    const updateMALStatus = (animeId: number, field: keyof MALStatusUpdate, value: any) => {
        const currentUpdates = pendingUpdates.get(animeId) || {};
        const newUpdates = { ...currentUpdates, [field]: value };
        const newPendingUpdates = new Map(pendingUpdates);
        newPendingUpdates.set(animeId, newUpdates);
        setPendingUpdates(newPendingUpdates);
    };

    const handleUpdateMAL = async (animeId: number) => {
        const updates = pendingUpdates.get(animeId);
        if (!updates || !onUpdateMALStatus) return;

        try {
            await onUpdateMALStatus(animeId, updates);
            const newPendingUpdates = new Map(pendingUpdates);
            newPendingUpdates.delete(animeId);
            setPendingUpdates(newPendingUpdates);
        } catch (error) {
            console.error('Failed to update MAL status:', error);
        }
    };

    const handleManualSearch = (anime: AnimeForDisplay) => {
        const searchTitle = anime.alternative_titles?.en || anime.title;
        const googleUrl = generateGoogleORQuery(searchTitle);
        window.open(googleUrl, '_blank');
    };

    const handleJustWatchSearch = (anime: AnimeForDisplay) => {
        const searchTitle = anime.alternative_titles?.en || anime.title;
        const justWatchUrl = generateJustWatchQuery(searchTitle);
        window.open(justWatchUrl, '_blank');
    };

    const getDisplayStatus = (anime: AnimeForDisplay) => {
        const updates = pendingUpdates.get(anime.id);
        return updates?.status ?? anime.my_list_status?.status ?? '';
    };

    const getDisplayScore = (anime: AnimeForDisplay) => {
        const updates = pendingUpdates.get(anime.id);
        return updates?.score ?? anime.my_list_status?.score ?? 0;
    };

    const getDisplayEpisodes = (anime: AnimeForDisplay) => {
        const updates = pendingUpdates.get(anime.id);
        return updates?.num_episodes_watched ?? anime.my_list_status?.num_episodes_watched ?? 0;
    };

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
        if (!status) return 'Unknown';
        return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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
                                <span className={styles.explainLabel}>{SOURCE_LABELS[r.source] ?? r.source}</span>
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

    return (
        <div className={styles.cardGrid}>
            {animes.map((anime) => {
                const hasPendingChanges = pendingUpdates.has(anime.id);

                return (
                <div key={anime.id} className={styles.card}>
                    <div className={styles.imageContainer}>
                        {anime.main_picture?.large || anime.main_picture?.medium ? (
                            <Image
                                src={anime.main_picture?.large || anime.main_picture?.medium}
                                alt={anime.title}
                                className={styles.animeImage}
                                fill
                                sizes="(max-width: 1200px) 50vw, 280px"
                                unoptimized
                            />
                        ) : (
                            <div className={styles.noImage}>No Image</div>
                        )}
                        <div className={`${styles.airingBadge} ${anime.status === 'currently_airing' ? styles.currentlyAiring : anime.status === 'finished_airing' ? styles.finishedAiring : styles.notYetAired}`}>
                            {anime.status === 'currently_airing' && <div className={styles.pulsingDot} />}
                            {formatStatus(anime.status)}
                        </div>
                        <div className={styles.overlay}>
                            <div className={styles.topActions}>
                                    <Button
                                    onClick={() => handleManualSearch(anime)}
                                        className={styles.searchBtn}
                                        variant="secondary"
                                        size="xs"
                                        square
                                    title="Search on Google"
                                >
                                    🔍
                                    </Button>
                                    <Button
                                    onClick={() => handleJustWatchSearch(anime)}
                                    className={styles.justWatchBtn}
                                        variant="secondary"
                                        size="xs"
                                        square
                                    title="Search on JustWatch"
                                >
                                    <Image
                                        src="/justwatch.png"
                                        alt="JustWatch"
                                        width={20}
                                        height={20}
                                        className={styles.justWatchIcon}
                                    />
                                    </Button>
                            </div>
                            <div className={styles.malActions}>
                                <div className={styles.malRow}>
                                    <select
                                        value={getDisplayStatus(anime)}
                                        onChange={(e) => updateMALStatus(anime.id, 'status', e.target.value)}
                                        className={styles.malSelect}
                                    >
                                        <option value="">Select Status</option>
                                        <option value="watching">Watching</option>
                                        <option value="completed">Completed</option>
                                        <option value="on_hold">On Hold</option>
                                        <option value="dropped">Dropped</option>
                                        <option value="plan_to_watch">Plan to Watch</option>
                                    </select>
                                    <select
                                        value={getDisplayScore(anime)}
                                        onChange={(e) => updateMALStatus(anime.id, 'score', parseInt(e.target.value))}
                                        className={styles.malSelect}
                                    >
                                        <option value={0}>Score</option>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={styles.malRow}>
                                    <div className={styles.episodes}>
                                            <Button
                                                variant="secondary"
                                                size="xs"
                                                square
                                            onClick={() => updateMALStatus(anime.id, 'num_episodes_watched', Math.max(0, getDisplayEpisodes(anime) - 1))}
                                            >
                                                -
                                            </Button>
                                        <span>{getDisplayEpisodes(anime)} / {anime.num_episodes || '?'}</span>
                                            <Button
                                                variant="secondary"
                                                size="xs"
                                                square
                                            onClick={() => updateMALStatus(anime.id, 'num_episodes_watched', getDisplayEpisodes(anime) + 1)}
                                            >
                                                +
                                            </Button>
                                    </div>
                                </div>
                                <Button
                                    variant="primary"
                                    size="xs"
                                    onClick={() => handleUpdateMAL(anime.id)}
                                    disabled={!hasPendingChanges}
                                    title={hasPendingChanges ? 'Apply pending MAL changes' : 'Change status/score/episodes to enable'}
                                >
                                    Update MAL
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className={styles.cardContent}>
                        <div className={styles.titleRow}>
                            <span className={styles.title} title={anime.title}>{anime.title}</span>
                            <button
                                className={`${styles.copyBtn} ${copiedKey === `${anime.id}-title` ? styles.copyBtnCopied : ''}`}
                                onClick={() => copyToClipboard(anime.title, `${anime.id}-title`)}
                                title="Copier le titre"
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
                        {anime.alternative_titles?.en && anime.alternative_titles.en !== anime.title && (
                            <div className={styles.titleRow}>
                                <span className={styles.altTitle}>{anime.alternative_titles.en}</span>
                                <button
                                    className={`${styles.copyBtn} ${copiedKey === `${anime.id}-alt` ? styles.copyBtnCopied : ''}`}
                                    onClick={() => copyToClipboard(anime.alternative_titles!.en!, `${anime.id}-alt`)}
                                    title="Copier le titre alternatif"
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
                                    <span style={{ fontSize: '0.8rem' }}>{getMALStatusIcon(getDisplayStatus(anime))}</span>
                                    {formatUserStatus(getDisplayStatus(anime))}
                                </span>
                            )}
                            {(visibleColumns?.score ?? true) && (
                                <span className={`${styles.score} ${getScoreClass(anime.mean)}`}>
                                    {anime.mean ? anime.mean.toFixed(2) : 'N/A'}
                                </span>
                            )}
                        </div>
                        {anime.recoMeta && formatRecoHint(anime.recoMeta) && (
                            <div className={styles.recoHint}>{formatRecoHint(anime.recoMeta)}</div>
                        )}
                        {anime.recoMeta && anime.recoMeta.breakdown.length > 0 && (
                            <div className={styles.explainWrap}>
                                {!allExplainsOpen && (
                                    <button
                                        className={styles.explainToggle}
                                        onClick={() => toggleExplain(anime.id)}
                                        aria-expanded={explainOpen.has(anime.id)}
                                    >
                                        {explainOpen.has(anime.id) ? '▾ Pourquoi ?' : '▸ Pourquoi ?'}
                                    </button>
                                )}
                                {(allExplainsOpen || explainOpen.has(anime.id)) && renderExplain(anime.recoMeta)}
                            </div>
                        )}
                        <div className={styles.actions}>
                            <Button
                                href={`https://myanimelist.net/anime/${anime.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="secondary"
                                size="xs"
                                className={styles.actionButton}
                            >
                                MAL
                            </Button>
                            {dismissMode === 'dismissed' ? (
                                <Button
                                    onClick={() => onDismiss?.(anime.id, false)}
                                    variant="primary-positive"
                                    size="xs"
                                    className={styles.actionButton}
                                >
                                    ↩ Remettre
                                </Button>
                            ) : dismissMode === 'feed' ? (
                                <Button
                                    onClick={() => onDismiss?.(anime.id, true)}
                                    variant="primary-negative"
                                    size="xs"
                                    className={styles.actionButton}
                                >
                                    ✕ Écarter
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => onHideToggle?.(anime.id, !anime.hidden)}
                                    variant={anime.hidden ? 'primary-positive' : 'primary-negative'}
                                    size="xs"
                                    className={styles.actionButton}
                                >
                                    {anime.hidden ? 'Unhide' : 'Hide'}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
                );
            })}
        </div>
    );
}
