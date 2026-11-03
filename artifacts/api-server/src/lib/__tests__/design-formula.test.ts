import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  designFormulaSettingsTable: {},
}));

import { calculateDesignEstimate, DEFAULT_DESIGN_FORMULA, parseDesignFormula } from "../design-formula";

describe("Engineering design formula", () => {
  it("calculates and rounds the requested default cost and lead time", () => {
    expect(calculateDesignEstimate("40", DEFAULT_DESIGN_FORMULA)).toEqual({
      designCost: "4000",
      designLeadTimeWeeks: "2.86",
      designHourlyRate: "100",
      designHoursPerWeek: "40",
      designCapacityFactor: "0.35",
    });
  });

  it("uses edited admin constants without changing estimated design hours", () => {
    expect(calculateDesignEstimate("20", {
      hourlyRate: "125",
      hoursPerWeek: "32",
      capacityFactor: "0.5",
    })).toMatchObject({ designCost: "2500", designLeadTimeWeeks: "1.25" });
  });

  it.each([
    { hourlyRate: "0", hoursPerWeek: "40", capacityFactor: "0.35" },
    { hourlyRate: "100.5", hoursPerWeek: "40", capacityFactor: "0.35" },
    { hourlyRate: "100", hoursPerWeek: "0", capacityFactor: "0.35" },
    { hourlyRate: "100", hoursPerWeek: "169", capacityFactor: "0.35" },
    { hourlyRate: "100", hoursPerWeek: "40", capacityFactor: "0" },
    { hourlyRate: "100", hoursPerWeek: "40", capacityFactor: "1.5" },
    { hourlyRate: "infinite", hoursPerWeek: "40", capacityFactor: "0.35" },
  ])("rejects invalid formula values: %j", (input) => {
    expect(parseDesignFormula(input)).toBeNull();
  });

  it("rounds exact half-unit calculated costs upward without floating-point loss", () => {
    expect(calculateDesignEstimate("1.005", DEFAULT_DESIGN_FORMULA).designCost).toBe("101");
    expect(calculateDesignEstimate("1.0049", DEFAULT_DESIGN_FORMULA).designCost).toBe("100");
  });
});