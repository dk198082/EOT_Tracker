import { describe, expect, it } from "vitest";
import { isWholeMoney, isWholeBudget, calculateWholeCost } from "../money";
import { formatMoney, moneyInputValue, formatHistoryMoney } from "../../../../eto-tracker/src/lib/money";

describe("Whole-number money", () => {
  it.each(["0", "12", "1000000"])("accepts a whole amount %s", (amount) => {
    expect(isWholeMoney(amount)).toBe(true);
  });
  it.each(["12.5", "12.0", "-1", "1e3", "$12", "NaN", "", null, 12])("rejects non-entry amount %j", (amount) => {
    expect(isWholeMoney(amount)).toBe(false);
  });
  it("allows optional amounts to be cleared without inventing zero", () => {
    expect(isWholeMoney(null, true)).toBe(true);
    expect(formatMoney(null)).toBe("Not recorded");
  });
  it.each(["1000", "1,000 - 2,000", "1000–2000", "", null])("accepts whole budget %j", (budget) => {
    expect(isWholeBudget(budget)).toBe(true);
  });
  it.each(["1000.5", "1000-2000.50", "TBD", "1000-"])("rejects non-whole or unfinished budget %s", (budget) => {
    expect(isWholeBudget(budget)).toBe(false);
  });
  it.each([["USD", "$1,235"], ["GBP", "£1,235"], ["EUR", "€1,235"], ["CNY", "¥1,235"]])(
    "formats %s with a leading symbol and no decimals", (currency, result) => {
      expect(formatMoney("1234.5", currency)).toBe(result);
    });
  it("retains exact large integers and honest mixed-currency labels", () => {
    expect(formatMoney("9007199254740992.5")).toBe("$9,007,199,254,740,993");
    expect(formatMoney("3743", "Multi-Currency")).toBe("Multi-Currency 3,743");
  });
  it("rounds legacy display and edit values without altering the stored value", () => {
    const stored = "1000.49 - 2000.5";
    expect(formatMoney(stored, "EUR")).toBe("€1,000 - 2,001");
    expect(moneyInputValue(stored)).toBe("1000 - 2001");
    expect(stored).toBe("1000.49 - 2000.5");
  });
  it("calculates monetary products exactly before whole-number rounding", () => {
    expect(calculateWholeCost("1.005", "100")).toBe("101");
    expect(calculateWholeCost("1.0049", "100")).toBe("100");
    expect(calculateWholeCost("0.15", "70")).toBe("11");
    expect(calculateWholeCost("1e-2", "100")).toBe("1");
  });
  it("uses the currency at the time of an audit event, not today's currency", () => {
    const older = { id: 1, section: "production", changedAt: "2026-10-01T00:00:00Z",
      changes: [{ field: "Procurement Cost", oldValue: "100.5", newValue: "200.5" }] };
    const newer = { id: 2, section: "production", changedAt: "2026-10-02T00:00:00Z",
      changes: [{ field: "Procurement Cost Currency", oldValue: "EUR", newValue: "USD" }] };
    expect(formatHistoryMoney("100.5", "Procurement Cost", older, [older, newer],
      { "production:Procurement Cost Currency": "USD" }, true)).toBe("€101");
    expect(formatHistoryMoney("200.5", "Procurement Cost", newer, [older, newer],
      { "production:Procurement Cost Currency": "USD" }, false)).toBe("$201");
  });
});