import type { Row } from "./contracts";

/** Staged policy helpers. Not enabled on live routes before schema cutover. */
export class SharedMergeGuardError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export function assertSharedMutation(context: {
  currentEpoch: string;
  clientEpoch?: string;
  expectedRecordKey?: string;
  actualRecordKey: string;
  archived: boolean;
}): void {
  if (!context.currentEpoch || !context.actualRecordKey
      || context.clientEpoch !== context.currentEpoch
      || context.expectedRecordKey !== context.actualRecordKey) {
    throw new SharedMergeGuardError(409, "RELOAD_REQUIRED");
  }
  if (context.archived) throw new SharedMergeGuardError(423, "ARCHIVED_READ_ONLY");
}

/** Includes archives: relaxing active uniqueness must not enable number reuse. */
export function assertNumberAvailable(rows: readonly Row[], candidate: string): void {
  if (rows.some((row) => row.eto_number === candidate)) {
    throw new SharedMergeGuardError(409, "HISTORICAL_NUMBER_ALREADY_USED");
  }
}

export function nextSharedNumber(rows: readonly Row[], year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("Invalid number year");
  const pattern = new RegExp(`^ETO-${year}-([0-9]{4,})$`);
  let max = 0n;
  for (const row of rows) {
    const match = typeof row.eto_number === "string" ? row.eto_number.match(pattern) : null;
    if (match && BigInt(match[1]) > max) max = BigInt(match[1]);
  }
  return `ETO-${year}-${String(max + 1n).padStart(4, "0")}`;
}

/** Call after unlinking the selected metadata row, before deleting file bytes. */
export function canDeleteUnreferencedBlob(storageKey: string, remainingAttachments: readonly Row[]): boolean {
  return Boolean(storageKey) && !remainingAttachments.some((row) => row.storage_key === storageKey);
}

export function shouldCaptureFirstSchedule(context: {
  hasRecordedSchedule: boolean;
  hasPreviousArtAcceptance: boolean;
}): boolean {
  return !context.hasRecordedSchedule && !context.hasPreviousArtAcceptance;
}
