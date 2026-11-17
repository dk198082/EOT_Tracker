import { describe, expect, it } from "vitest";
import { departmentRoles, hasRole, isAdminLike, isSimulatableRole, matchesRole } from "../roles";
import { validateAndAdvance } from "../workflow";

describe("Eng/Prod role", () => {
  it.each(["engineering", "production"])("includes %s action permissions and assignment membership", (department) => {
    expect(hasRole({ role: "eng-prod" }, department)).toBe(true);
    expect(matchesRole("eng-prod", department)).toBe(true);
    expect(departmentRoles(department)).toEqual([department, "eng-prod"]);
    // An administrator's override is not departmental assignment eligibility.
    expect(matchesRole("superuser", department)).toBe(false);
    expect(matchesRole("admin", department)).toBe(false);
  });

  it.each(["art", "sales", "admin", "superuser"])("does not inherit %s privileges", (role) => {
    expect(hasRole({ role: "eng-prod" }, role)).toBe(false);
  });

  it("remains non-administrative and can be simulated by SuperUser", () => {
    expect(isAdminLike("eng-prod")).toBe(false);
    expect(isSimulatableRole("eng-prod")).toBe(true);
  });

  it("does not broaden the existing specialist roles", () => {
    expect(hasRole({ role: "engineering" }, "production")).toBe(false);
    expect(hasRole({ role: "production" }, "engineering")).toBe(false);
    expect(hasRole({ role: "none" }, "engineering", "production")).toBe(false);
  });

  it("can complete and return both department reviews", () => {
    expect(validateAndAdvance("engineering-review", "engineering-quote-ready", "eng-prod").toStage).toBe("production-review");
    expect(validateAndAdvance("engineering-review", "engineering-return-art", "eng-prod").toStage).toBe("art-review");
    expect(validateAndAdvance("production-review", "production-approve", "eng-prod").toStage).toBe("art-final-review");
    expect(validateAndAdvance("production-review", "production-return-engineering", "eng-prod").toStage).toBe("engineering-review");
  });

  it("cannot approve ART, generate quotes, or submit Sales requests", () => {
    expect(() => validateAndAdvance("art-review", "approve-engineering", "eng-prod")).toThrow("not allowed");
    expect(() => validateAndAdvance("art-final-review", "art-final-quote", "eng-prod")).toThrow("not allowed");
    expect(() => validateAndAdvance("draft", "submit", "eng-prod")).toThrow("not allowed");
  });
});
