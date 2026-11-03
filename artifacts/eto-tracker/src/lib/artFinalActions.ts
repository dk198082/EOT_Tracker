export function shouldShowArtFinalReturnToEngineering({
  engineeringReviewCompleted,
  includeEngineeringReview,
  includeProductionReview,
}: {
  engineeringReviewCompleted: boolean;
  includeEngineeringReview: boolean;
  includeProductionReview: boolean;
}) {
  return (
    engineeringReviewCompleted &&
    (!includeEngineeringReview || includeProductionReview)
  );
}