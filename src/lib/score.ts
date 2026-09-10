import type { Check, MissionOutcome, Review, ScoreBreakdown } from "./types";

export function gradeFor(total: number): string {
  if (total >= 85) return "단골 예약";
  if (total >= 70) return "다시 올게요";
  if (total >= 55) return "한 번은 더";
  if (total >= 40) return "글쎄요";
  return "다신 안 와요";
}

export function computeScore(reviews: Review[], checks: Check[], mission: MissionOutcome): ScoreBreakdown {
  const ratings = reviews.map((review) => Math.min(5, Math.max(1, Math.round(review.rating))));
  const reviewAvg = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 1;
  const reviewPoints = ((reviewAvg - 1) / 4) * 60;
  const weight = { pass: 1, warn: 0.5, fail: 0 } as const;
  const checkPassRatio = checks.length ? checks.reduce((sum, check) => sum + weight[check.status], 0) / checks.length : 0;
  const checkPoints = checkPassRatio * 25;
  const missionPoints = mission === "success" ? 15 : mission === "partial" ? 8 : 0;
  const total = Math.round(Math.min(100, Math.max(0, reviewPoints + checkPoints + missionPoints)));
  return {
    total,
    reviewAvg: Math.round(reviewAvg * 10) / 10,
    reviewPoints: Math.round(reviewPoints),
    checkPassRatio: Math.round(checkPassRatio * 100) / 100,
    checkPoints: Math.round(checkPoints),
    missionPoints,
    grade: gradeFor(total),
  };
}
