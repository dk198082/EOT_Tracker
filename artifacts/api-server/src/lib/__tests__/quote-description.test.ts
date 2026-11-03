import { describe, expect, it } from "vitest";
import { normalizeRequiredQuoteDescription } from "../quote-description";

describe("required quote description", () => {
  it.each([undefined, null, "", "   ", "\t\n"])("rejects a missing or blank description (%s)", (value) => {
    expect(normalizeRequiredQuoteDescription(value)).toBeNull();
  });

  it("trims a provided part description", () => {
    expect(normalizeRequiredQuoteDescription("  Machine adapter  ")).toBe("Machine adapter");
  });

  it("rejects values that are not text", () => {
    expect(normalizeRequiredQuoteDescription(123)).toBeNull();
  });
});
