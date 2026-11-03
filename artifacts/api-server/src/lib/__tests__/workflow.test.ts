import { describe, expect, it } from "vitest";
import { validateAndAdvance, type Decision } from "../workflow";

describe("Lost and Declined workflow outcomes", () => {
  it("keeps a quoted request quoted until an explicit outcome", () => {
    expect(() =>
      validateAndAdvance("quoted", "production-approve", "production"),
    ).toThrow('Decision "production-approve" is not allowed from stage "quoted"');
  });

  it("moves mark-lost from quoted to the distinct lost terminal stage", () => {
    expect(validateAndAdvance("quoted", "mark-lost", "sales")).toEqual({
      toStage: "lost",
      isMoreInfoLoop: false,
    });
  });

  it("keeps internal ART rejection as declined", () => {
    expect(validateAndAdvance("art-review", "decline", "art")).toEqual({
      toStage: "declined",
      isMoreInfoLoop: false,
    });
    expect(validateAndAdvance("art-final-review", "decline", "art")).toEqual({
      toStage: "declined",
      isMoreInfoLoop: false,
    });
  });

  it("does not allow the removed Production decline decision", () => {
    expect(() =>
      validateAndAdvance(
        "production-review",
        "production-decline" as Decision,
        "production",
      ),
    ).toThrow(
      'Decision "production-decline" is not allowed from stage "production-review"',
    );
  });
});

describe("configurable workflow sequence", () => {
  it("includes every forward stage by default", () => {
    expect(validateAndAdvance("draft", "submit", "sales").toStage).toBe("art-review");
    expect(validateAndAdvance("art-review", "approve-engineering", "art").toStage).toBe("engineering-review");
    expect(validateAndAdvance("engineering-review", "engineering-quote-ready", "engineering").toStage).toBe("production-review");
    expect(validateAndAdvance("production-review", "production-approve", "production").toStage).toBe("art-final-review");
    expect(validateAndAdvance("art-final-review", "art-final-quote", "art").toStage).toBe("quoted");
    expect(validateAndAdvance("quoted", "mark-won", "sales").toStage).toBe("won");
  });

  it.each([
    [false, true, "production-review"],
    [true, false, "engineering-review"],
    [false, false, "art-final-review"],
  ])(
    "routes ART approval with Engineering=%s and Production=%s to %s",
    (includeEngineeringReview, includeProductionReview, expectedStage) => {
      expect(validateAndAdvance(
        "art-review",
        "approve-engineering",
        "art",
        { includeEngineeringReview, includeProductionReview },
      ).toStage).toBe(expectedStage);
    },
  );

  it("skips Production after Engineering when Production is not included", () => {
    expect(validateAndAdvance(
      "engineering-review",
      "engineering-quote-ready",
      "engineering",
      { includeEngineeringReview: true, includeProductionReview: false },
    ).toStage).toBe("art-final-review");
  });

  it("returns only to included review stages", () => {
    expect(validateAndAdvance(
      "production-review",
      "production-return-engineering",
      "production",
      { includeEngineeringReview: false, includeProductionReview: true },
    ).toStage).toBe("art-review");
    expect(validateAndAdvance(
      "art-final-review",
      "art-final-return-production",
      "art",
      { includeEngineeringReview: true, includeProductionReview: false },
    ).toStage).toBe("engineering-review");
    expect(validateAndAdvance(
      "art-final-review",
      "art-final-return-production",
      "art",
      { includeEngineeringReview: false, includeProductionReview: false },
    ).toStage).toBe("art-review");
  });

  it("moves backward exactly one adjacent stage", () => {
    expect(validateAndAdvance("art-review", "return-draft", "art").toStage).toBe("draft");
    expect(validateAndAdvance("engineering-review", "engineering-return-art", "engineering").toStage).toBe("art-review");
    expect(validateAndAdvance("production-review", "production-return-engineering", "production").toStage).toBe("engineering-review");
    expect(validateAndAdvance("art-final-review", "art-final-return-production", "art").toStage).toBe("production-review");
    expect(validateAndAdvance("quoted", "quoted-return-art-final", "sales").toStage).toBe("art-final-review");
  });

  it("allows ART Final Review to return directly to Engineering", () => {
    expect(validateAndAdvance(
      "art-final-review",
      "art-final-return-engineering",
      "art",
    ).toStage).toBe("engineering-review");
  });

  it("rejects the former skip routes and same-stage loops", () => {
    const removed: Array<[Parameters<typeof validateAndAdvance>[0], Decision, string]> = [
      ["art-review", "approve-production" as Decision, "art"],
      ["art-review", "final-approve" as Decision, "art"],
      ["art-review", "more-info-sales" as Decision, "art"],
      ["engineering-review", "engineering-more-info" as Decision, "engineering"],
      ["production-review", "production-more-info" as Decision, "production"],
      ["art-final-review", "art-final-send-engineering" as Decision, "art"],
    ];

    for (const [stage, decision, role] of removed) {
      expect(() => validateAndAdvance(stage, decision, role)).toThrow(
        `Decision "${decision}" is not allowed from stage "${stage}"`,
      );
    }
  });

  it("keeps backward actions role-protected", () => {
    expect(() =>
      validateAndAdvance("production-review", "production-return-engineering", "art"),
    ).toThrow(
      'Role "art" is not allowed to make decision "production-return-engineering"',
    );
  });
});