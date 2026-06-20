import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllRatings, saveRating, getRatingCriteria } from '@/lib/ratings';
import { CriteriaSection } from '@/models/rating';

function computeScore(scores: Record<string, number>, criteria: CriteriaSection[]) {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const section of criteria) {
    for (const criterion of section.criteria) {
      const maxStep = Math.max(...criterion.steps.map(s => s.value));
      maxPoints += maxStep;
      const score = scores[criterion.id] ?? 0;
      totalPoints += score;
    }
  }
  const scoreOutOfTen = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) / 10 : 0;
  return { totalPoints, maxPoints, scoreOutOfTen };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getAllRatings());
  }

  if (req.method === 'POST') {
    const { animeName, scores } = req.body;
    if (!animeName || typeof animeName !== 'string' || !scores || typeof scores !== 'object') {
      return res.status(400).json({ error: 'animeName and scores are required' });
    }
    const criteria = getRatingCriteria();
    const { totalPoints, maxPoints, scoreOutOfTen } = computeScore(scores, criteria);
    const rating = saveRating({ animeName: animeName.trim(), scores, totalPoints, maxPoints, scoreOutOfTen });
    return res.status(201).json(rating);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
}
