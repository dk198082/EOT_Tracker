import { describe, expect, it } from "vitest";
import { calculateReviewStepDates } from "../../../../eto-tracker/src/lib/review-step-dates";
import { calculateReviewDueDate } from "../review-schedule";

const schedule = {
  artReviewAcceptedDate: "2026-10-02",
  includeEngineeringReview: true,
  includeProductionReview: true,
  engineeringReviewDurationWeeks: 1,
  productionReviewDurationWeeks: 1,
  artFinalReviewDurationWeeks: 1,
};

describe("Per-step review deadlines supplement the overall deadline", () => {
  it("calculates cumulative Engineering, Production and ART Final dates", () => {
    expect(calculateReviewStepDates(schedule)).toMatchObject({
      engineering: "2026-10-09", production: "2026-10-16", artFinal: "2026-10-23",
    });
  });
  it.each([[true, true], [false, true], [true, false], [false, false]])(
    "includes only scheduled reviews (Engineering %s, Production %s)",
    (engineering, production) => {
      const result = calculateReviewStepDates({
        ...schedule, includeEngineeringReview: engineering, includeProductionReview: production,
      });
      expect(result.engineering).toBe(engineering ? "2026-10-09" : null);
      expect(result.production).toBe(production
        ? calculateReviewDueDate(schedule.artReviewAcceptedDate, [engineering ? 1 : 0, 1]) : null);
      expect(result.artFinal).toBe(calculateReviewDueDate(schedule.artReviewAcceptedDate, [
        engineering ? 1 : 0, production ? 1 : 0, 1,
      ]));
    },
  );
  it("rounds cumulative partial days, not each duration individually", () => {
    expect(calculateReviewStepDates({
      ...schedule, engineeringReviewDurationWeeks: 0.2,
      productionReviewDurationWeeks: 0.2, artFinalReviewDurationWeeks: 0.6,
    })).toMatchObject({
      engineering: "2026-10-04", production: "2026-10-05", artFinal: "2026-10-09",
    });
  });
  it("supports zero-duration reviews", () => {
    expect(calculateReviewStepDates({
      ...schedule, engineeringReviewDurationWeeks: 0,
      productionReviewDurationWeeks: 0, artFinalReviewDurationWeeks: 0,
    })).toMatchObject({
      engineering: "2026-10-02", production: "2026-10-02", artFinal: "2026-10-02",
    });
  });
  it("adds calendar days through DST and year boundaries", () => {
    expect(calculateReviewStepDates({ ...schedule, artReviewAcceptedDate: "2026-03-07" }))
      .toMatchObject({ engineering: "2026-03-14", production: "2026-03-21", artFinal: "2026-03-28" });
    expect(calculateReviewStepDates({ ...schedule, artReviewAcceptedDate: "2026-12-20" }))
      .toMatchObject({ engineering: "2026-12-27", production: "2027-01-03", artFinal: "2027-01-10" });
  });
  it("does not invent dates for historical requests lacking an acceptance date", () => {
    expect(calculateReviewStepDates({ ...schedule, artReviewAcceptedDate: null }))
      .toMatchObject({ engineering: null, production: null, artFinal: null });
  });
  it("does not assume a missing duration is zero or the default", () => {
    expect(calculateReviewStepDates({
      ...schedule, productionReviewDurationWeeks: null, dueDate: "2026-10-23",
    })).toMatchObject({ engineering: "2026-10-09", production: null, artFinal: "2026-10-23" });
  });
  it("does not alter a saved overall deadline", () => {
    const input = { ...schedule, dueDate: "2026-10-25" };
    expect(calculateReviewStepDates(input).artFinal).toBe("2026-10-25");
    expect(input.dueDate).toBe("2026-10-25");
  });
  it("preserves initial review inclusion and dates when returning for rework", () => {
    expect(calculateReviewStepDates({
      ...schedule, includeEngineeringReview: true, dueDate: "2026-10-16",
    }, [
      { decision: "approve-engineering", fromStage: "art-review",
        includeEngineeringReview: false, includeProductionReview: true },
      { decision: "approve-engineering", fromStage: "art-review",
        includeEngineeringReview: true, includeProductionReview: true },
    ])).toMatchObject({
      engineering: null, includeEngineering: false, production: "2026-10-09", artFinal: "2026-10-16",
    });
  });
});
