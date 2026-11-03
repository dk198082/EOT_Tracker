/** Shared by workflow completion and output edits so High cannot bypass validation. */
export function validateReviewRisk(score: unknown, notes: unknown): string | null {
  if (score === undefined || score === null || score === "") {
    return "Risk Score is required";
  }
  if (score !== undefined && score !== null &&
      (typeof score !== "string" || !["Low", "Med", "High"].includes(score))) {
    return "Risk Score must be Low, Med, or High";
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return "Risk Notes must be text";
  }
  if (score === "High" && (typeof notes !== "string" || !notes.trim())) {
    return "Risk Notes are required to explain a High Risk Score";
  }
  return null;
}

export function reviewRiskValues(score: unknown, notes: unknown) {
  return {
    riskScore: score === undefined || score === null ? null : String(score),
    riskNotes: score === "High" && typeof notes === "string" ? notes.trim() : null,
  };
}