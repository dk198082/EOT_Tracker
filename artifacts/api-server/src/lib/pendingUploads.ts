/**
 * In-memory store for pending upload authorizations.
 *
 * When a user requests a presigned PUT URL, we record the (userId, etoRequestId,
 * objectPath) here with a short TTL matching the presigned URL's lifetime.
 * The attachment-creation endpoint must consume this record before it will
 * accept a storageKey — preventing cross-user key reuse and unguessable-path
 * guessing attacks.
 */

const UPLOAD_TTL_MS = 15 * 60 * 1000; // 15 min — matches presigned URL TTL

export interface PendingUpload {
  userId: number;
  etoRequestId: number;
  contentType: string;
  fileSize: number;
  expiresAt: Date;
}

// objectPath → PendingUpload (one entry per presigned URL minted)
const store = new Map<string, PendingUpload>();

export function recordPendingUpload(objectPath: string, data: Omit<PendingUpload, 'expiresAt'>): void {
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  store.set(objectPath, { ...data, expiresAt });
  // Auto-evict after TTL + 1s buffer
  setTimeout(() => store.delete(objectPath), UPLOAD_TTL_MS + 1000);
}

export type ConsumeResult =
  | { ok: true; upload: PendingUpload; }
  | { ok: false; reason: string };

/**
 * Validates and consumes a pending upload token. One-time use: the entry is
 * deleted whether or not validation passes, preventing replay attacks.
 */
export function consumePendingUpload(
  objectPath: string,
  userId: number,
  etoRequestId: number,
): ConsumeResult {
  const entry = store.get(objectPath);
  store.delete(objectPath); // always consume — no replay

  if (!entry) {
    return { ok: false, reason: 'Unknown or expired upload token — re-request a presigned URL' };
  }
  if (entry.expiresAt < new Date()) {
    return { ok: false, reason: 'Upload token has expired — re-request a presigned URL' };
  }
  if (entry.userId !== userId) {
    return { ok: false, reason: 'Upload was minted by a different user' };
  }
  if (entry.etoRequestId !== etoRequestId) {
    return { ok: false, reason: 'Upload was minted for a different ETO request' };
  }
  return { ok: true, upload: entry };
}
