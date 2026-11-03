import { describe, expect, it } from "vitest";
import { calculatePrice } from "../../../../eto-tracker/src/lib/price-calculation";

const costs = (a: string | null, b: string | null, c: string | null) => [
  { value: a, currency: "USD" }, { value: b, currency: "USD" }, { value: c, currency: "USD" },
] as const;

describe("Price Calculator arithmetic", () => {
  it("adds contingency to the three costs before calculating additive margin", () => {
    expect(calculatePrice(costs("1000", "500", "500"), "10", "55")).toEqual({
      contingencyCost: "200", marginCost: "1210", salesPrice: "3410",
      currency: "USD", multiCurrency: false,
    });
  });

  it("calculates mixed-currency amounts unchanged and labels all derived values Multi-Currency", () => {
    expect(calculatePrice([
      { value: "1250.00", currency: "USD" },
      { value: "350.00", currency: "EUR" },
      { value: "595.00", currency: "USD" },
    ], "10", "55")).toEqual({
      contingencyCost: "220", marginCost: "1328", salesPrice: "3743",
      currency: "Multi-Currency", multiCurrency: true,
    });
  });

  it("handles fractional percentages and live percentage changes", () => {
    expect(calculatePrice(costs("1250", "350", "595"), "12.5", "60")).toMatchObject({
      contingencyCost: "274", marginCost: "1481", salesPrice: "3950",
    });
  });

  it("rounds each derived amount half-up and totals the displayed costs", () => {
    expect(calculatePrice(costs("5", "0", "0"), "10", "50")).toMatchObject({
      contingencyCost: "1", marginCost: "3", salesPrice: "9",
    });
  });

  it("preserves exact whole amounts beyond JavaScript's safe integer limit", () => {
    expect(calculatePrice(costs("9007199254740992.01", "0.01", "0.01"), "0", "0"))
      .toMatchObject({ contingencyCost: "0", marginCost: "0", salesPrice: "9007199254740992" });
  });

  it("rounds historical source amounts so totals agree with displayed whole costs", () => {
    expect(calculatePrice(costs("0.5", "0.5", "0.5"), "10", "55"))
      .toMatchObject({ contingencyCost: "0", marginCost: "2", salesPrice: "5" });
  });

  it("accepts recorded zero costs and zero or 100% percentages", () => {
    expect(calculatePrice(costs("0", "0", "0"), "100", "100")?.salesPrice).toBe("0");
    expect(calculatePrice(costs("100", "0", "0"), "100", "100")?.salesPrice).toBe("400");
  });

  it.each([null, "", " ", "-1", "not recorded", "$100", "Infinity", "NaN"])(
    "does not invent a total from missing or invalid cost %j", (value) => {
      expect(calculatePrice(costs(value, "100", "100"), "10", "55")).toBeNull();
    },
  );

  it.each(["", " ", "-1", "101", "NaN", "Infinity"])("rejects invalid percentage %j", (value) => {
    expect(calculatePrice(costs("100", "100", "100"), value, "55")).toBeNull();
    expect(calculatePrice(costs("100", "100", "100"), "10", value)).toBeNull();
  });

  it("supports scientific notation in numeric review fields", () => {
    expect(calculatePrice(costs("1e3", "5e2", "500.00"), "1e1", "55")?.salesPrice).toBe("3410");
  });

  it("retains a shared recorded non-USD currency", () => {
    const gbp = costs("100", "100", "100").map((cost) => ({ ...cost, currency: "GBP" })) as
      [{ value: string; currency: string }, { value: string; currency: string }, { value: string; currency: string }];
    expect(calculatePrice(gbp, "10", "55")?.currency).toBe("GBP");
  });
});