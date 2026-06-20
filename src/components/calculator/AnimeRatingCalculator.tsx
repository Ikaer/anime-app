import { useState, useEffect, useCallback } from 'react';
import { CriteriaSection, SavedRating } from '@/models/rating';
import styles from './AnimeRatingCalculator.module.css';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Map a 0–10 score to the shared --score-N palette (red → green). */
function scoreColor(score: number) {
  const v = Math.min(10, Math.max(1, Math.round(score)));
  return `var(--score-${v})`;
}

/** Directional cue for a step button: low value = red, mid = amber, high = green. */
function stepColor(value: number, max: number) {
  const ratio = max > 0 ? value / max : 0;
  if (ratio <= 0.34) return 'var(--score-3)';
  if (ratio <= 0.67) return 'var(--score-6)';
  return 'var(--score-9)';
}

function computeScore(scores: Record<string, number>, criteria: CriteriaSection[]) {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const section of criteria) {
    for (const criterion of section.criteria) {
      const maxStep = Math.max(...criterion.steps.map(s => s.value));
      maxPoints += maxStep;
      totalPoints += scores[criterion.id] ?? 0;
    }
  }
  const scoreOutOfTen = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 1000) / 100 : 0;
  return { totalPoints, maxPoints, scoreOutOfTen };
}

export default function AnimeRatingCalculator() {
  const [criteria, setCriteria] = useState<CriteriaSection[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [animeName, setAnimeName] = useState('');
  const [savedRatings, setSavedRatings] = useState<SavedRating[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/ratings/criteria').then(r => r.json()),
      fetch('/api/ratings').then(r => r.json()),
    ]).then(([c, r]) => {
      setCriteria(c);
      setSavedRatings(r);
      setLoading(false);
    });
  }, []);

  const { totalPoints, maxPoints, scoreOutOfTen } = computeScore(scores, criteria);

  const handleStep = useCallback((criterionId: string, value: number) => {
    setScores(prev => ({ ...prev, [criterionId]: value }));
    setActiveId(null);
  }, []);

  const handleReset = () => {
    setScores({});
    setAnimeName('');
    setActiveId(null);
  };

  const handleLoad = (rating: SavedRating) => {
    setAnimeName(rating.animeName);
    setActiveId(rating.id);
    // Best-effort: only apply scores for criteria that still exist
    const existingIds = new Set(criteria.flatMap(s => s.criteria.map(c => c.id)));
    const safeScores: Record<string, number> = {};
    for (const [id, val] of Object.entries(rating.scores)) {
      if (existingIds.has(id)) safeScores[id] = val;
    }
    setScores(safeScores);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await fetch(`/api/ratings/${id}`, { method: 'DELETE' });
    setSavedRatings(prev => prev.filter(r => r.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const handleSave = async () => {
    if (!animeName.trim()) return;
    setSaving(true);
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ animeName, scores }),
    });
    const saved: SavedRating = await res.json();
    setSavedRatings(prev => [saved, ...prev]);
    setActiveId(saved.id);
    setSaving(false);
  };

  if (loading) return <div className={styles.loadingState}>Loading…</div>;

  return (
    <div className={styles.page}>
      {/* Left: calculator */}
      <div className={styles.calculator}>
        <div className={styles.animeNameRow}>
          <input
            className={styles.animeNameInput}
            placeholder="Anime name…"
            value={animeName}
            onChange={e => { setAnimeName(e.target.value); setActiveId(null); }}
          />
        </div>

        {criteria.map(section => {
          const ratedCount = section.criteria.filter(c => scores[c.id] !== undefined).length;
          const complete = ratedCount === section.criteria.length;
          return (
          <div key={section.id} className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{section.name}</h2>
              <span className={`${styles.sectionCount} ${complete ? styles.sectionCountComplete : ''}`}>
                {ratedCount}/{section.criteria.length}
              </span>
            </div>
            <div className={styles.sectionBody}>
              {section.criteria.map(criterion => {
                const maxStep = Math.max(...criterion.steps.map(s => s.value));
                return (
                <div key={criterion.id} className={styles.criterionRow}>
                  <div className={styles.criterionName}>{criterion.name}</div>
                  <div className={styles.stepButtons}>
                    {criterion.steps.map(step => {
                      const selected = (scores[criterion.id] ?? null) === step.value;
                      return (
                        <button
                          key={step.value}
                          className={`${styles.stepBtn} ${selected ? styles.stepBtnSelected : ''}`}
                          style={{ '--step-accent': stepColor(step.value, maxStep) } as React.CSSProperties}
                          onClick={() => handleStep(criterion.id, step.value)}
                        >
                          {step.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
          );
        })}

        <div className={styles.scoreBar}>
          <div className={styles.scoreDisplay}>
            <span className={styles.scoreMain} style={{ color: scoreColor(scoreOutOfTen) }}>{scoreOutOfTen.toFixed(1)}</span>
            <span className={styles.scoreSuffix}>/10</span>
            <span className={styles.scoreRaw}>{totalPoints}/{maxPoints} pts</span>
          </div>
          <div className={styles.scoreActions}>
            <button className={styles.resetBtn} onClick={handleReset}>Reset</button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={saving || !animeName.trim()}
            >
              {saving ? 'Saving…' : 'Save rating'}
            </button>
          </div>
        </div>
      </div>

      {/* Right: saved ratings */}
      <div className={styles.savedPanel}>
        <div className={styles.savedPanelHeader}>Saved ratings ({savedRatings.length})</div>
        {savedRatings.length === 0 ? (
          <div className={styles.emptyState}>No saved ratings yet.</div>
        ) : (
          <div className={styles.savedList}>
            {savedRatings.map(r => (
              <div
                key={r.id}
                className={`${styles.savedItem} ${activeId === r.id ? styles.savedItemActive : ''}`}
                onClick={() => handleLoad(r)}
              >
                <div className={styles.savedItemTop}>
                  <span className={styles.savedItemName}>{r.animeName}</span>
                  <span className={styles.savedItemScore} style={{ color: scoreColor(r.scoreOutOfTen) }}>{r.scoreOutOfTen.toFixed(1)}/10</span>
                  <button
                    className={styles.savedItemDeleteBtn}
                    onClick={e => handleDelete(e, r.id)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
                <div className={styles.savedItemMeta}>
                  <span className={styles.savedItemDate}>{formatDate(r.savedAt)}</span>
                  <span className={styles.savedItemRaw}>{r.totalPoints}/{r.maxPoints} pts</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
