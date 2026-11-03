import type { RequestHandler } from "express";
import { assertSharedMutation, SharedMergeGuardError } from "./guards";

export interface ArchiveMetadata {
  recordKey: string;
  migrationEpoch: string;
  archived: boolean;
  source: "production" | "workspace" | "shared";
  sourceId: number;
  archiveReason: string | null;
}
export interface ArchiveStore {
  epoch(): Promise<string | null>;
  metadata(ids: number[]): Promise<Map<number, ArchiveMetadata>>;
}

/** Express routes are case-insensitive and accept a trailing slash by default. */
export function sharedPolicyPath(path: string): string {
  return path.replace(/\/+$/, "").toLowerCase();
}

/** Mounted before every business router, including storage URL issuance.
 * Identity is compared to trusted database values, never to the submitted body.
 * No positive/negative schema cache survives a cutover.
 */
export function sharedArchiveMiddleware(store: ArchiveStore): RequestHandler {
  return async (req, res, next) => {
    const path = sharedPolicyPath(req.path);
    const match = path.match(/^\/eto-requests\/([^/]+)(?:\/|$)/);
    const requestArea = /^\/eto-requests(?:\/|$)/.test(path);
    const upload = path === "/storage/uploads/request-url";
    const remappedArea = /^\/(?:users|admin|dashboard)(?:\/|$)/.test(path);
    if (!requestArea && !upload && !remappedArea) { next(); return; }
    try {
      const epoch = await store.epoch();
      res.locals.sharedEpoch = epoch;
      res.set("x-eto-migration-epoch", epoch ?? "legacy");
      if (!epoch) { next(); return; }
      if (match && !/^[1-9][0-9]*$/.test(match[1])) {
        res.status(400).json({ error: "Invalid ETO id" }); return;
      }
      const writing = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const id = match ? Number(match[1]) : upload ? req.body?.etoRequestId : undefined;
      if (writing && req.get("x-eto-migration-epoch") !== epoch) {
        throw new SharedMergeGuardError(409, "RELOAD_REQUIRED");
      }
      if (id !== undefined) {
        if (!Number.isSafeInteger(id) || id <= 0) {
          res.status(400).json({ error: "Invalid ETO id" }); return;
        }
        const metadata = (await store.metadata([id])).get(id);
        if (!metadata) { res.status(404).json({ error: "ETO request not found" }); return; }
        if (metadata.migrationEpoch !== epoch) throw new Error("Record epoch does not match installed schema");
        if (writing) {
          assertSharedMutation({
            currentEpoch: epoch,
            clientEpoch: req.get("x-eto-migration-epoch"),
            expectedRecordKey: req.get("x-eto-record-key"),
            actualRecordKey: metadata.recordKey,
            archived: metadata.archived,
          });
        } else {
          const expected = req.get("x-eto-record-key") ?? req.query.recordKey;
          if (expected !== undefined && expected !== metadata.recordKey) {
            throw new SharedMergeGuardError(409, "RELOAD_REQUIRED");
          }
        }
      } else if (upload) {
        res.status(400).json({ error: "An ETO id is required" }); return;
      }
      next();
    } catch (error) {
      if (error instanceof SharedMergeGuardError) {
        res.status(error.status).json({
          error: error.code === "ARCHIVED_READ_ONLY"
            ? "This archived ETO and its files are read-only."
            : "Reload this record from the ETO list before continuing.",
          code: error.code,
        });
      } else {
        req.log?.error({ err: error }, "Archive schema is unavailable or incompatible");
        res.status(503).json({ error: "Archive schema is unavailable or incompatible", code: "ARCHIVE_SCHEMA_UNAVAILABLE" });
      }
    }
  };
}
