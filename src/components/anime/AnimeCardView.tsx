import React, { useState } from 'react';
import Image from 'next/image';
import { AnimeWithExtensions, ImageSize, StatsColumn, VisibleColumns } from '@/models/anime';
import {  formatUserStatus } from '@/lib/animeUtils';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/providers';
import { Button } from '@/components/shared';
import styles from './AnimeCardView.module.css';

interface MALStatusUpdate {
    status?: string;
    score?: number;
    num_episodes_watched?: number;
}

interface AnimeCardViewProps {
    animes: AnimeWithExtensions[];
    imageSize: ImageSize;
    visibleColumns: VisibleColumns;
    onUpdateMALStatus?: (animeId: number, updates: MALStatusUpdate) => void;
    onHideToggle?: (animeId: number, hide: boolean) => void;
}

export default function AnimeCardView({
    animes,
    imageSize,
    visibleColumns,
    onUpdateMALStatus,
    onHideToggle
}: AnimeCardViewProps) {
    const [pendingUpdates, setPendingUpdates] = useState<Map<number, MALStatusUpdate>>(new Map());

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

    const handleManualSearch = (anime: AnimeWithExtensions) => {
        const searchTitle = anime.alternative_titles?.en || anime.title;
        const googleUrl = generateGoogleORQuery(searchTitle);
        window.open(googleUrl, '_blank');
    };

    const handleJustWatchSearch = (anime: AnimeWithExtensions) => {
        const searchTitle = anime.alternative_titles?.en || anime.title;
        const justWatchUrl = generateJustWatchQuery(searchTitle);
        window.open(justWatchUrl, '_blank');
    };

    const getDisplayStatus = (anime: AnimeWithExtensions) => {
        const updates = pendingUpdates.get(anime.id);
        return updates?.status ?? anime.my_list_status?.status ?? '';
    };

    const getDisplayScore = (anime: AnimeWithExtensions) => {
        const updates = pendingUpdates.get(anime.id);
        return updates?.score ?? anime.my_list_status?.score ?? 0;
    };

    const getDisplayEpisodes = (anime: AnimeWithExtensions) => {
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

    return (
        <div className={styles.cardGrid}>
            {animes.map((anime) => (
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
                                {pendingUpdates.has(anime.id) && (
                                        <Button
                                            variant="primary"
                                            size="xs"
                                            onClick={() => handleUpdateMAL(anime.id)}
                                        >
                                            Update MAL
                                        </Button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className={styles.cardContent}>
                        <div className={styles.title} title={anime.title}>{anime.title}</div>
                        {anime.alternative_titles?.en && anime.alternative_titles.en !== anime.title && (
                            <div className={styles.altTitle}>{anime.alternative_titles.en}</div>
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
                            <Button
                                onClick={() => onHideToggle?.(anime.id, !anime.hidden)}
                                variant={anime.hidden ? 'primary-positive' : 'primary-negative'}
                                size="xs"
                                className={styles.actionButton}
                            >
                                {anime.hidden ? 'Unhide' : 'Hide'}
                            </Button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
