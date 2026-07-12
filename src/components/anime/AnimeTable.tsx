import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { AnimeForDisplay, SortColumn, SortDirection, ImageSize, VisibleColumns } from '@/models/anime';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/searchLinks';
import { formatSeason, getPrimaryTitle, getSecondaryTitle } from '@/lib/animeUtils';
import { Button } from '@/components/shared';
import SimklDiscrepancyBadge from './SimklDiscrepancyBadge';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './AnimeTable.module.css';

const formatNumber = (num?: number) => {
  if (num === undefined) return 'N/A';
  if (Math.abs(num) >= 10000) {
    return `${Math.round(num / 1000)}k`;
  }
  if (Number.isInteger(num)) {
    return num.toString();
  }
  return num.toFixed(2);
};

const getImageDimensions = (size: ImageSize) => {
  switch (size) {
    case 1:
      return { width: 80, height: 112 };
    case 2:
      return { width: 160, height: 224 };
    case 3:
      return { width: 225, height: 315 };
    case 0:
    default:
      return { width: 225, height: 315 };
  }
};

interface MALStatusUpdate {
  status?: string;
  score?: number;
  num_episodes_watched?: number;
}

interface AnimeTableProps {
  animes: AnimeForDisplay[];
  imageSize: ImageSize;
  visibleColumns: VisibleColumns;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onUpdateMALStatus?: (animeId: number, updates: MALStatusUpdate) => void;
  onHideToggle?: (animeId: number, hide: boolean) => void;
}

export default function AnimeTable({ animes, imageSize, visibleColumns, sortColumn, sortDirection, onUpdateMALStatus, onHideToggle }: AnimeTableProps) {
  const t = useT();
  const [pendingUpdates, setPendingUpdates] = useState<Map<number, MALStatusUpdate>>(new Map());
  const imageDimensions = getImageDimensions(imageSize);

  const sortedAnimes = useMemo(() => {
    const sorted = [...animes].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case 'title':
          aValue = getPrimaryTitle(a).toLowerCase();
          bValue = getPrimaryTitle(b).toLowerCase();
          break;
        case 'mean':
          aValue = a.catalog.mean || 0;
          bValue = b.catalog.mean || 0;
          break;
        case 'start_date':
          aValue = a.catalog.startDate ? new Date(a.catalog.startDate).getTime() : 0;
          bValue = b.catalog.startDate ? new Date(b.catalog.startDate).getTime() : 0;
          break;
        case 'status':
          aValue = a.catalog.airingStatus || '';
          bValue = b.catalog.airingStatus || '';
          break;
        case 'num_episodes':
          aValue = a.catalog.numEpisodes || 0;
          bValue = b.catalog.numEpisodes || 0;
          break;
        case 'rank':
          aValue = a.catalog.rank || Infinity;
          bValue = b.catalog.rank || Infinity;
          break;
        case 'popularity':
          aValue = a.catalog.popularity || Infinity;
          bValue = b.catalog.popularity || Infinity;
          break;
        case 'num_list_users':
          aValue = a.catalog.numListUsers || 0;
          bValue = b.catalog.numListUsers || 0;
          break;
        case 'num_scoring_users':
          aValue = a.catalog.numScoringUsers || 0;
          bValue = b.catalog.numScoringUsers || 0;
          break;
        default:
          aValue = a.catalog.mean || 0;
          bValue = b.catalog.mean || 0;
      }

      if (aValue < bValue) {
        return sortDirection === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortDirection === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }, [animes, sortColumn, sortDirection]);

  // Sorting is controlled by parent via props; no header click sorting here.

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

  const updateMALStatus = (animeId: number, field: keyof MALStatusUpdate, value: any) => {
    const currentUpdates = pendingUpdates.get(animeId) || {};
    const newUpdates = { ...currentUpdates, [field]: value };

    const newPendingUpdates = new Map(pendingUpdates);
    newPendingUpdates.set(animeId, newUpdates);
    setPendingUpdates(newPendingUpdates);
  };

  const handleStatusChange = (animeId: number, status: string) => {
    updateMALStatus(animeId, 'status', status);
  };

  const handleScoreChange = (animeId: number, score: number) => {
    updateMALStatus(animeId, 'score', score);
  };

  const handleEpisodeChange = (animeId: number, episodes: number) => {
    updateMALStatus(animeId, 'num_episodes_watched', Math.max(0, episodes));
  };

  const handleUpdateMAL = async (animeId: number) => {
    const updates = pendingUpdates.get(animeId);
    if (!updates || !onUpdateMALStatus) return;

    try {
      await onUpdateMALStatus(animeId, updates);
      // Remove from pending updates after successful update
      const newPendingUpdates = new Map(pendingUpdates);
      newPendingUpdates.delete(animeId);
      setPendingUpdates(newPendingUpdates);
    } catch (error) {
      console.error('Failed to update MAL status:', error);
    }
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

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'watching':
        return styles.watching;
      case 'completed':
        return styles.completed;
      case 'on_hold':
        return styles.onHold;
      case 'dropped':
        return styles.dropped;
      case 'plan_to_watch':
        return styles.planToWatch;
      default:
        return '';
    }
  };

  const hasPendingUpdates = (animeId: number) => {
    return pendingUpdates.has(animeId);
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? '↑' : '↓';
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

  const formatScore = (score?: number) => {
    return score ? score.toFixed(2) : 'N/A';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    // Fixed locale: the server (Node) and browser default locales can
    // disagree, and a locale-less toLocaleDateString() then renders
    // differently on each side, tripping a hydration mismatch.
    return new Date(dateString).toLocaleDateString('fr-FR');
  };

  const formatStatus = (status?: string) => {
    return status ? t(`airing.${status}` as TranslationKey) : t('common.unknown');
  };

  const formatGenres = (genres: Array<{ name: string }> = []) => {
    if (!genres || genres.length === 0) return t('common.noGenres');
    // Show full genre list without suffix abbreviation
    return genres.map(g => g.name).join(', ');
  };

  const renderMetric = (
    anime: AnimeForDisplay,
    metric: 'rank' | 'popularity' | 'num_list_users' | 'num_scoring_users' | 'mean'
  ) => {
    let latestValue: number | undefined;
    switch (metric) {
      case 'rank': latestValue = anime.catalog.rank; break;
      case 'popularity': latestValue = anime.catalog.popularity; break;
      case 'num_list_users': latestValue = anime.catalog.numListUsers; break;
      case 'num_scoring_users': latestValue = anime.catalog.numScoringUsers; break;
      case 'mean': latestValue = anime.catalog.mean; break;
    }

    let formattedValue;
    if (latestValue === undefined) {
      formattedValue = 'N/A';
    } else if (metric === 'mean') {
      formattedValue = formatScore(latestValue);
    } else if (metric === 'rank' || metric === 'popularity') {
      formattedValue = `#${formatNumber(latestValue)}`;
    } else {
      formattedValue = formatNumber(latestValue);
    }

    if (metric === 'mean') {
      return (
        <span className={`${styles.score} ${getScoreClass(latestValue)}`}>
          {formattedValue}
        </span>
      );
    }

    return <span>{formattedValue}</span>;
  }



  if (animes.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t('table.emptyState')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.tableWrapper}>
        <table className={styles.animeTable}>
          <thead>
            <tr>
              <th>{t('table.image')}</th>
              <th>{t('field.title')} {getSortIcon('title')}</th>
              <th>{t('field.status')} {getSortIcon('status')}</th>
              <th>{t('field.episodes')} {getSortIcon('num_episodes')}</th>
              <th>{t('table.startingSeason')}</th>
              <th>{t('table.me')}</th>
              <th>{t('table.links')}</th>
              {(visibleColumns?.score ?? true) && (
                <th title={t('field.score')}>S {getSortIcon('mean')}</th>
              )}
              {(visibleColumns?.rank ?? true) && (
                <th title={t('field.rank')}>R {getSortIcon('rank')}</th>
              )}
              {(visibleColumns?.popularity ?? true) && (
                <th title={t('field.popularity')}>P {getSortIcon('popularity')}</th>
              )}
              {(visibleColumns?.users ?? true) && (
                <th title={t('field.users')}>U {getSortIcon('num_list_users')}</th>
              )}
              {(visibleColumns?.scorers ?? true) && (
                <th title={t('field.scorers')}>X {getSortIcon('num_scoring_users')}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedAnimes.map((anime) => (
              <tr key={anime.id}>
                <td className={`${styles.imageCell} ${imageSize === 0 ? styles.imageCellOriginal : ''}`}>
                  {anime.catalog.mainPicture?.large || anime.catalog.mainPicture?.medium ? (
                    <Image
                      src={anime.catalog.mainPicture?.large || anime.catalog.mainPicture?.medium}
                      alt={getPrimaryTitle(anime)}
                      className={`${styles.animeImage} ${styles[`imageSize${imageSize}`]}`}
                      width={imageDimensions.width}
                      height={imageDimensions.height}
                      sizes={`${imageDimensions.width}px`}
                      unoptimized
                    />
                  ) : (
                    <div className={`${styles.noImage} ${styles[`imageSize${imageSize}`]}`}>{t('common.noImage')}</div>
                  )}
                </td>
                <td className={styles.titleCell}>
                  <div className="title-content">
                    <div className={styles.primaryTitle}>{getPrimaryTitle(anime)}</div>
                    {getSecondaryTitle(anime) && (
                      <div className={styles.altTitle}>{getSecondaryTitle(anime)}</div>
                    )}
                  </div>
                  <div className={styles.genresInTitle}>{formatGenres(anime.catalog.genres || [])}</div>
                </td>
                <td className={styles.statusCell}>
                  <span className={`${styles.status} ${anime.catalog.airingStatus === 'currently_airing' ? styles.currentlyAiring : anime.catalog.airingStatus === 'finished_airing' ? styles.finishedAiring : anime.catalog.airingStatus === 'not_yet_aired' ? styles.notYetAired : ''}`}>
                    {formatStatus(anime.catalog.airingStatus)}
                  </span>
                </td>
                <td className={styles.episodesCell}>
                  {anime.catalog.numEpisodes || t('common.tba')}
                </td>
                <td className={styles.seasonCell}>
                  {anime.catalog.startSeason ? (
                    <span
                      style={{
                        color: formatSeason(anime.catalog.startSeason.year, anime.catalog.startSeason.season).color,
                        fontWeight: 'bold'
                      }}
                    >
                      {formatSeason(anime.catalog.startSeason.year, anime.catalog.startSeason.season, t).label}
                    </span>
                  ) : (
                    <span style={{ color: '#6B7280' }}>{t('common.unknown')}</span>
                  )}
                </td>
                <td className={styles.meCell}>
                  <div>
                    <select
                      value={getDisplayStatus(anime)}
                      onChange={(e) => handleStatusChange(anime.id, e.target.value)}
                      className={`${styles.malStatus} ${getStatusClass(getDisplayStatus(anime))}`}
                    >
                      <option value="">{t('table.selectStatus')}</option>
                      <option value="watching">{t('statusShort.watching')}</option>
                      <option value="completed">{t('statusShort.completed')}</option>
                      <option value="on_hold">{t('statusShort.on_hold')}</option>
                      <option value="dropped">{t('statusShort.dropped')}</option>
                      <option value="plan_to_watch">{t('statusShort.plan_to_watch')}</option>
                    </select>
                    <SimklDiscrepancyBadge anime={anime} />
                  </div>
                  <div>
                    <select
                      value={getDisplayScore(anime)}
                      onChange={(e) => handleScoreChange(anime.id, parseInt(e.target.value))}
                      className={`${styles.malScore} ${styles.editable}`}
                    >
                      <option value={0}>{t('table.noScore')}</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                        <option key={score} value={score}>{score}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.malEpisodes}>

                    <Button
                      variant="secondary"
                      size="xs"
                      square
                      onClick={() => handleEpisodeChange(anime.id, getDisplayEpisodes(anime) - 1)}
                      title={t('table.decreaseEp')}
                    >
                      -
                    </Button>
                    <div className={styles.episodeCounter}>
                      {getDisplayEpisodes(anime)}/{anime.catalog.numEpisodes || '?'}
                    </div>

                    <Button
                      variant="secondary"
                      size="xs"
                      square
                      onClick={() => handleEpisodeChange(anime.id, getDisplayEpisodes(anime) + 1)}
                      title={t('table.watchNext')}
                    >
                      +
                    </Button>
                  </div>
                </td>
                <td className={styles.linksCell}>
                  <div className={styles.actionsButtonGroup}>
                    <Button
                      href={`/anime/${anime.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="secondary"
                      size="xs"
                      square
                      title={t('table.localInfo')}
                    >
                      ↗
                    </Button>
                    <Button
                      href={`https://myanimelist.net/anime/${anime.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="secondary"
                      size="xs"
                    >
                      MAL
                    </Button>
                    <Button
                      onClick={() => handleManualSearch(anime)}
                      variant="primary-positive"
                      size="xs"
                      square
                      title={t('table.searchGoogle')}
                    >
                      🔍
                    </Button>
                    <Button
                      onClick={() => handleJustWatchSearch(anime)}
                      variant="secondary"
                      size="xs"
                      square
                      title={t('table.searchJustwatch')}
                    >
                      <Image
                        src="/justwatch.png"
                        alt="JustWatch"
                        width={16}
                        height={16}
                        className={styles.justWatchIcon}
                      />
                    </Button>
                    <Button
                      onClick={() => onHideToggle?.(anime.id, !anime.hidden)}
                      variant={anime.hidden ? 'primary-positive' : 'primary-negative'}
                      size="sm"
                      title={anime.hidden ? t('table.showAnime') : t('table.hideAnime')}
                    >
                      {anime.hidden ? t('table.unhide') : t('table.hide')}
                    </Button>
                    {hasPendingUpdates(anime.id) && (
                      <Button
                        onClick={() => handleUpdateMAL(anime.id)}
                        variant="primary"
                        size="sm"
                        title={t('table.updateMalStatus')}
                      >
                        {t('table.update')}
                      </Button>
                    )}
                  </div>
                </td>
                {(visibleColumns?.score ?? true) && (
                  <td className={styles.scoreCell}>
                    {renderMetric(anime, 'mean')}
                  </td>
                )}
                {(visibleColumns?.rank ?? true) && (
                  <td className={styles.scoreCell}>
                    {renderMetric(anime, 'rank')}
                  </td>
                )}
                {(visibleColumns?.popularity ?? true) && (
                  <td className={styles.scoreCell}>
                    {renderMetric(anime, 'popularity')}
                  </td>
                )}
                {(visibleColumns?.users ?? true) && (
                  <td className={styles.scoreCell}>
                    {renderMetric(anime, 'num_list_users')}
                  </td>
                )}
                {(visibleColumns?.scorers ?? true) && (
                  <td className={styles.scoreCell}>
                    {renderMetric(anime, 'num_scoring_users')}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
