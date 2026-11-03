export type SplitFamilyRequest = {
  id: number;
  etoNumber: string | null;
  parentEtoRequestId: number | null;
  splitSequence: number | null;
  hasSplitChildren: boolean;
};

export function getSplitFamilyMetadata(
  request: SplitFamilyRequest,
  parentEtoNumber: string | null,
) {
  const splitFamilyId = request.parentEtoRequestId ?? (
    request.hasSplitChildren ? request.id : null
  );

  return {
    splitFamilyId,
    splitFamilyNumber: splitFamilyId === null
      ? null
      : parentEtoNumber ?? request.etoNumber,
    splitFamilyPosition: splitFamilyId === null
      ? null
      : request.parentEtoRequestId === null
        ? 0
        : request.splitSequence,
  };
}