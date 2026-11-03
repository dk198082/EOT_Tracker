export type ReviewStepSchedule = {
  engineering: string | null;
  production: string | null;
  artFinal: string | null;
  includeEngineering: boolean;
  includeProduction: boolean;
};

type Schedule = {
  artReviewAcceptedDate?: string | null;
  dueDate?: string | null;
  engineeringReviewDurationWeeks?: number | null;
  productionReviewDurationWeeks?: number | null;
  artFinalReviewDurationWeeks?: number | null;
  includeEngineeringReview: boolean;
  includeProductionReview: boolean;
};

type Acceptance = {
  decision: string;
  fromStage: string;
  includeEngineeringReview?: boolean | null;
  includeProductionReview?: boolean | null;
};

/** Planned cumulative deadlines, not new deadlines on entry/return to a stage. */
export function calculateReviewStepDates(
  schedule: Schedule, transitions: readonly Acceptance[] = [],
): ReviewStepSchedule {
  // Transition history is chronological. Rework can change current inclusion
  // flags, but must not rewrite the original accepted schedule.
  const accepted = transitions.find((event) =>
    event.decision === "approve-engineering" && event.fromStage === "art-review");
  const includeEngineering = accepted?.includeEngineeringReview ?? schedule.includeEngineeringReview;
  const includeProduction = accepted?.includeProductionReview ?? schedule.includeProductionReview;
  const result: ReviewStepSchedule = {
    engineering: null, production: null, artFinal: schedule.dueDate ?? null,
    includeEngineering, includeProduction,
  };
  if (!schedule.artReviewAcceptedDate) return result;
  const start = new Date(`${schedule.artReviewAcceptedDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())) return result;
  const durations = [
    includeEngineering ? schedule.engineeringReviewDurationWeeks : 0,
    includeProduction ? schedule.productionReviewDurationWeeks : 0,
    schedule.artFinalReviewDurationWeeks,
  ];
  let cumulativeWeeks = 0;
  for (const [index, key] of (["engineering", "production", "artFinal"] as const).entries()) {
    const weeks = durations[index];
    // Missing historical durations are unknown, not zero/default weeks.
    if (weeks == null || !Number.isFinite(weeks) || weeks < 0 || weeks > 520) break;
    cumulativeWeeks += weeks;
    if ((index === 0 && !includeEngineering) || (index === 1 && !includeProduction)) continue;
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + Math.ceil(cumulativeWeeks * 7 - 1e-9));
    result[key] = key === "artFinal" && schedule.dueDate
      ? schedule.dueDate : date.toISOString().slice(0, 10);
  }
  return result;
}

export function formatStepDueDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
