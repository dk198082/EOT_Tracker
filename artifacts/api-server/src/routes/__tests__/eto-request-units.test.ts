import { describe, expect, it } from "vitest";
import { CreateEtoRequestBody } from "@workspace/api-zod";

const baseRequest = {
  customerName: "Unit Test Customer",
  quoteNumber: "Q-UNIT-1",
  distributor: "No",
  requestType: "Machine",
  machineType: "ST",
  expectedForceRange: "0-500",
  expectedDisplacement: "0-50",
  materials: "Steel",
  specimenDimensions: "10 x 10",
  resultsRequired: "Report",
  customDetails: "None",
};

describe("ETO request measurement units", () => {
  it.each([
    ["kN", "mm"],
    ["kN", "in"],
    ["N", "mm"],
    ["N", "in"],
    ["lbs", "mm"],
    ["lbs", "in"],
  ] as const)("accepts force unit %s and displacement unit %s", (expectedForceUnit, expectedDisplacementUnit) => {
    const parsed = CreateEtoRequestBody.safeParse({
      ...baseRequest,
      expectedForceUnit,
      expectedDisplacementUnit,
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ["kg", "mm"],
    ["N", "cm"],
  ])("rejects unsupported force unit %s or displacement unit %s", (expectedForceUnit, expectedDisplacementUnit) => {
    const parsed = CreateEtoRequestBody.safeParse({
      ...baseRequest,
      expectedForceUnit,
      expectedDisplacementUnit,
    });

    expect(parsed.success).toBe(false);
  });
});