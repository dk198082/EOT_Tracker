import { describe, expect, it } from "vitest";
// This focused UI rule lives in the web artifact, outside the API test project's rootDir.
// @ts-ignore -- Vitest transpiles the imported source directly for this cross-artifact regression test.
import { shouldShowArtFinalReturnToEngineering } from "../../../../eto-tracker/src/lib/artFinalActions";

describe("ART Final Review action visibility", () => {
  it.each([
    [false, false, true],
    [false, true, true],
    [false, true, false],
  ])(
    "hides Back to Engineering without a committed completion (Engineering=%s, Production=%s)",
    (includeEngineeringReview, includeProductionReview) => {
      expect(shouldShowArtFinalReturnToEngineering({
        engineeringReviewCompleted: false,
        includeEngineeringReview,
        includeProductionReview,
      })).toBe(false);
    },
  );

  it.each([
    [false, true],
    [false, false],
    [true, true],
  ])(
    "shows Back to Engineering after completion when it is a distinct return path (Engineering=%s, Production=%s)",
    (includeEngineeringReview, includeProductionReview) => {
      expect(shouldShowArtFinalReturnToEngineering({
        engineeringReviewCompleted: true,
        includeEngineeringReview,
        includeProductionReview,
      })).toBe(true);
    },
  );

  it("avoids duplicating the normal adjacent Back to Engineering action", () => {
    expect(shouldShowArtFinalReturnToEngineering({
      engineeringReviewCompleted: true,
      includeEngineeringReview: true,
      includeProductionReview: false,
    })).toBe(false);
  });
});