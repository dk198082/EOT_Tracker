import { describe, expect, it } from "vitest";
import { acceptanceCalendarDate, calculateReviewDueDate } from "../review-schedule";

describe("review due dates", () => {
  it("adds all three default weeks", () => {
    expect(calculateReviewDueDate("2026-10-02", [1, 1, 1])).toBe("2026-10-23");
  });
  it("sums custom durations across year boundaries", () => {
    expect(calculateReviewDueDate("2026-12-20", [2, 3, 4])).toBe("2027-02-21");
  });
  it("adds calendar days across daylight saving changes", () => {
    expect(calculateReviewDueDate("2026-03-07", [1, 1, 1])).toBe("2026-03-28");
  });
  it("rounds only the combined partial day up", () => {
    expect(calculateReviewDueDate("2026-10-02", [0.5, 1, 1])).toBe("2026-10-20");
    expect(calculateReviewDueDate("2026-10-02", [0.2, 0.2, 0.6])).toBe("2026-10-09");
  });
  it("allows zero-week durations", () => {
    expect(calculateReviewDueDate("2026-10-02", [0, 0, 0])).toBe("2026-10-02");
  });
  it("uses the acceptance day in the reviewer's time zone", () => {
    const now = new Date("2026-10-02T01:00:00Z");
    expect(acceptanceCalendarDate("America/New_York", now)).toBe("2026-10-01");
    expect(acceptanceCalendarDate("Europe/London", now)).toBe("2026-10-02");
    expect(() => acceptanceCalendarDate("Not/AZone", now)).toThrow();
  });
});