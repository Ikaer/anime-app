import { useState, useCallback } from 'react';
import { RATING_GRIDS, DEFAULT_GRID_ID, getGrid, RatingGrid } from '@/lib/ratingGrids';
import styles from './AnimeRatingCalculator.module.css';

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

function computeScore(scores: Record<string, number>, grid: RatingGrid) {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const section of grid.sections) {
    for (const criterion of section.criteria) {
      const maxStep = Math.max(...criterion.steps.map(s => s.value));
      maxPoints += maxStep;
      totalPoints += scores[criterion.id] ?? 0;
    }
  }
  // Map to /10 against the grid's reference (own max unless it opts to top out
  // lower, e.g. the "dropped" grid references the 20-pt complete scale).
  const denom = grid.pointsForTen ?? maxPoints;
  const scoreOutOfTen = denom > 0 ? Math.round((totalPoints / denom) * 1000) / 100 : 0;
  return { totalPoints, maxPoints, scoreOutOfTen };
}

export default function AnimeRatingCalculator() {
  const [gridId, setGridId] = useState<string>(DEFAULT_GRID_ID);
  const [scores, setScores] = useState<Record<string, number>>({});

  const grid = getGrid(gridId);
  const { totalPoints, maxPoints, scoreOutOfTen } = computeScore(scores, grid);

  const handleStep = useCallback((criterionId: string, value: number) => {
    setScores(prev => ({ ...prev, [criterionId]: value }));
  }, []);

  const handleReset = () => setScores({});

  const handleGridChange = (id: string) => {
    // Criteria ids differ between grids, so a fresh slate avoids stale scores.
    setGridId(id);
    setScores({});
  };

  return (
    <div className={styles.page}>
      <div className={styles.calculator}>
        <div className={styles.gridRow}>
          <label className={styles.gridLabel} htmlFor="grid-select">Grille</label>
          <select
            id="grid-select"
            className={styles.gridSelect}
            value={gridId}
            onChange={e => handleGridChange(e.target.value)}
          >
            {RATING_GRIDS.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {grid.description && <span className={styles.gridDescription}>{grid.description}</span>}
        </div>

        {grid.sections.map(section => {
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
                          <span className={styles.stepLabel}>{step.label}</span>
                          {step.description && <span className={styles.stepDesc}>{step.description}</span>}
                          {step.examples && step.examples.length > 0 && (
                            <span className={styles.stepExamples}>
                              {step.examples.map((ex, i) => (
                                <span key={i} className={styles.stepExample}>{ex}</span>
                              ))}
                            </span>
                          )}
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
          </div>
        </div>
      </div>
    </div>
  );
}
