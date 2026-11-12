export function shouldShowArtFinalReturnToEngineering({ engineeringReviewCompleted, includeEngineeringReview, includeProductionReview, }) {
    return (engineeringReviewCompleted &&
        (!includeEngineeringReview || includeProductionReview));
}
