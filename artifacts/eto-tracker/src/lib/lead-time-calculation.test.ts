import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateLeadTime, type ReviewLeadTimes } from "./lead-time-calculation";

const times = (design?: string | null, procurement?: string | null, assembly?: string | null): ReviewLeadTimes => ({
  design: { value: design }, procurement: { value: procurement }, assembly: { value: assembly },
});

test("sums weeks and rounds the total, not each component", () => {
  assert.deepEqual(calculateLeadTime(times("1.2", "2.3", "0.7")), { totalWeeks: "4.2", roundedWeeks: "5" });
});

test("keeps an exact whole-week sum despite floating-point boundaries", () => {
  assert.deepEqual(calculateLeadTime(times("0.1", "0.2", "0.7")), { totalWeeks: "1", roundedWeeks: "1" });
});

test("accepts zero durations and decimal/scientific notation", () => {
  assert.deepEqual(calculateLeadTime(times("0", "0", "0")), { totalWeeks: "0", roundedWeeks: "0" });
  assert.deepEqual(calculateLeadTime(times(".5", " 1.25 ", "1e-2")), { totalWeeks: "1.76", roundedWeeks: "2" });
});

test("does not treat missing or invalid estimates as zero", () => {
  for (const value of [null, undefined, "", " ", "TBC", "-1", "NaN", "Infinity", "0x10"]) {
    assert.equal(calculateLeadTime(times(value, "1", "2")), null);
  }
});

test("withholds suggestions during loading or errors", () => {
  assert.equal(calculateLeadTime({ ...times("1", "2", "3"), design: { value: "1", loading: true } }), null);
  assert.equal(calculateLeadTime({ ...times("1", "2", "3"), assembly: { value: "3", error: true } }), null);
});

test("uses current saved snapshots after an output refresh", () => {
  assert.equal(calculateLeadTime(times("1", "2", "3"))?.roundedWeeks, "6");
  assert.equal(calculateLeadTime(times("1", "2.1", "3"))?.roundedWeeks, "7");
});
