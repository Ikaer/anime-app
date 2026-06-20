export interface CriterionStep {
  value: number;
  label: string;
}

export interface Criterion {
  id: string;
  name: string;
  steps: CriterionStep[];
}

export interface CriteriaSection {
  id: string;
  name: string;
  criteria: Criterion[];
}

export interface SavedRating {
  id: string;
  animeName: string;
  scores: Record<string, number>; // criterionId -> step value
  totalPoints: number;
  maxPoints: number;
  scoreOutOfTen: number;
  savedAt: string;
}
