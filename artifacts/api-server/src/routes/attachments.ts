import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { attachmentsTable, usersTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateAttachmentBody } from "@workspace/api-zod";
import type { User } from "@workspace/db";
import { isAdminLike } from "../lib/roles";
import { parseIntParam } from "../lib/params";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { consumePendingUpload } from "../lib/pendingUploads";
import type { RequestHandler } from "express";
import { archiveStore } from "../lib/shared-merge/database";

const objectStorageService = new ObjectStorageService();
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const router = Router({ mergeParams: true });

const INLINE_PREVIEW_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const PREVIEW_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const PREVIEW_LINK_TTL_MS = 2 * 60 * 1000;

async function getPreviewSignature(id: number, attachmentId: number, expiresAt: number): Promise<string> {
  const epoch = await archiveStore.epoch();
  const identity = epoch ? (await archiveStore.metadata([id])).get(id) : null;
  if (epoch && !identity) throw new Error("Missing preview record identity");
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for attachment previews");
  return createHmac("sha256", secret)
    .update(`${id}:${attachmentId}:${expiresAt}${epoch ? `:${epoch}:${identity!.recordKey}` : ""}`)
    .digest("base64url");
}

async function hasValidPreviewSignature(
  id: number,
  attachmentId: number,
  expiresAtRaw: unknown,
  signatureRaw: unknown,
): Promise<boolean> {
  if (typeof expiresAtRaw !== "string" || typeof signatureRaw !== "string") return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(await getPreviewSignature(id, attachmentId, expiresAt));
  const actual = Buffer.from(signatureRaw);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const requirePreviewAccess: RequestHandler = async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  const attachmentId = parseIntParam(req.params.attachmentId);
  if (
    !isNaN(id)
    && !isNaN(attachmentId)
    && await hasValidPreviewSignature(id, attachmentId, req.query.expires, req.query.signature)
  ) {
    // Signed links remain usable by cookie-less PDF viewers, but an active
    // session must still pass the normal role gate (including the unassigned
    // role block) before it can stream attachment data.
    if (req.isAuthenticated()) {
      requireAuth(req, res, next);
      return;
    }
    next();
    return;
  }
  requireAuth(req, res, next);
};

function getInlinePreviewType(contentType: string | null, filename: string): string | null {
  const normalizedType = contentType?.toLowerCase().split(";", 1)[0].trim() ?? "";
  if (INLINE_PREVIEW_TYPES.has(normalizedType)) return normalizedType;

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEW_TYPE_BY_EXTENSION[extension] ?? null;
}

/** GET /api/eto-requests/:id/attachments */
router.get("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rows = await db
      .select({
        a: attachmentsTable,
        uploaderName: usersTable.name,
      })
      .from(attachmentsTable)
      .innerJoin(usersTable, eq(attachmentsTable.uploaderId, usersTable.id))
      .where(eq(attachmentsTable.etoRequestId, id))
      .orderBy(asc(attachmentsTable.createdAt));

    res.json(rows.map(({ a, uploaderName }) => ({
      id: a.id,
      etoRequestId: a.etoRequestId,
      uploaderId: a.uploaderId,
      uploaderName,
      filename: a.filename,
      storageKey: a.storageKey,
      contentType: a.contentType,
      fileSize: a.fileSize,
      createdAt: a.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

/** POST /api/eto-requests/:id/attachments */
router.post("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const parsed = CreateAttachmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  // Verify the storageKey was minted by this user for this ETO
  const consume = consumePendingUpload(parsed.data.storageKey, user.id, id);
    if (!consume.ok) {
      res.status(422).json({ error: consume.reason });
      return;
    }

    if (
      parsed.data.fileSize !== consume.upload.fileSize ||
      (parsed.data.contentType ?? "application/octet-stream") !== consume.upload.contentType
    ) {
      res.status(422).json({ error: "Uploaded file metadata does not match the authorized upload." });
      return;
  }

  try {

      // Verify the actual uploaded Azure Blob
      const objectFile = await objectStorageService.getObjectEntityFile(
        parsed.data.storageKey,
      );

      const [blobMetadata] = await objectFile.getMetadata();

      const actualSize = blobMetadata.size;
      const actualContentType = blobMetadata.contentType;

      if (
        actualSize === undefined ||
        actualSize <= 0 ||
        actualSize > MAX_FILE_SIZE ||
        actualSize !== consume.upload.fileSize
      ) {
        await objectFile.delete();
        res.status(422).json({
          error: "Uploaded file size is invalid or exceeds the 50 MB limit.",
        });
        return;
      }

      if (actualContentType !== consume.upload.contentType) {
        await objectFile.delete();
        res.status(422).json({
          error: "Uploaded file content type does not match the authorized upload.",
        });
        return;
      }

      // 2. Database insertion comes AFTER verification
      const [attachment] = await db
        .insert(attachmentsTable)
        .values({
          etoRequestId: id,
          uploaderId: user.id,
          filename: parsed.data.filename,
          storageKey: parsed.data.storageKey,
          contentType: parsed.data.contentType ?? null,
          fileSize: parsed.data.fileSize ?? null,
        })
        .returning();

      // Keep your existing response code here

    res.status(201).json({
      id: attachment.id,
      etoRequestId: attachment.etoRequestId,
      uploaderId: attachment.uploaderId,
      uploaderName: user.name,
      filename: attachment.filename,
      storageKey: attachment.storageKey,
      contentType: attachment.contentType,
      fileSize: attachment.fileSize,
      createdAt: attachment.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eto-requests/:id/attachments/:attachmentId/download */
router.get("/:attachmentId/download", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  const attachmentId = parseIntParam(req.params.attachmentId);
  if (isNaN(id) || isNaN(attachmentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [attachment] = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
      .limit(1);

    if (!attachment || attachment.etoRequestId !== id) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    let url: string;
    try {
      url = await objectStorageService.getObjectEntityDownloadURL(attachment.storageKey);
    } catch {
      res.status(500).json({ error: "Failed to generate download URL" });
      return;
    }

    res.json({ url });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eto-requests/:id/attachments/:attachmentId/preview */
router.get("/:attachmentId/preview-link", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  const attachmentId = parseIntParam(req.params.attachmentId);
  if (isNaN(id) || isNaN(attachmentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [attachment] = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
      .limit(1);

    if (!attachment || attachment.etoRequestId !== id) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    if (!getInlinePreviewType(attachment.contentType, attachment.filename)) {
      res.status(415).json({ error: "This attachment type cannot be previewed safely" });
      return;
    }

    const expiresAt = Date.now() + PREVIEW_LINK_TTL_MS;
    const signature = await getPreviewSignature(id, attachmentId, expiresAt);
    const epoch = await archiveStore.epoch();
    const identity = epoch ? (await archiveStore.metadata([id])).get(id) : null;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      url: `/api/eto-requests/${id}/attachments/${attachmentId}/preview?expires=${expiresAt}&signature=${encodeURIComponent(signature)}${identity ? `&recordKey=${encodeURIComponent(identity.recordKey)}&migrationEpoch=${encodeURIComponent(epoch!)}` : ""}`,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eto-requests/:id/attachments/:attachmentId/preview */
router.get("/:attachmentId/preview", requirePreviewAccess, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  const attachmentId = parseIntParam(req.params.attachmentId);
  if (isNaN(id) || isNaN(attachmentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [attachment] = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
      .limit(1);

    if (!attachment || attachment.etoRequestId !== id) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const previewType = getInlinePreviewType(attachment.contentType, attachment.filename);
    if (!previewType) {
      res.status(415).json({ error: "This attachment type cannot be previewed safely" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(attachment.storageKey);
    const safeFilename = attachment.filename.replace(/["\r\n]/g, "_");
    const encodedFilename = encodeURIComponent(attachment.filename);

    res.setHeader("Content-Type", previewType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (attachment.fileSize) {
      res.setHeader("Content-Length", String(attachment.fileSize));
    }

    const stream = objectFile.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error, attachmentId }, "Failed to stream attachment preview");
      if (!res.headersSent) {
        next(error);
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/eto-requests/:id/attachments/:attachmentId */
router.delete("/:attachmentId", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  const attachmentId = parseIntParam(req.params.attachmentId);
  if (isNaN(id) || isNaN(attachmentId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const user = res.locals.dbUser as User;

  try {
    const [attachment] = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
      .limit(1);

    if (!attachment || attachment.etoRequestId !== id) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    // Only the uploader or an admin may delete
    if (attachment.uploaderId !== user.id && !isAdminLike(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // The archive guard runs before this handler. Unlink metadata first, so a
    // database archive restriction can never reject after file bytes are gone.
    await db.delete(attachmentsTable).where(eq(attachmentsTable.id, attachmentId));
    const remaining = await db.select({ id: attachmentsTable.id }).from(attachmentsTable)
      .where(eq(attachmentsTable.storageKey, attachment.storageKey)).limit(1);
    if (remaining.length) { res.status(204).end(); return; }
    // A merged archive may share the same blob with an active version.
    try {
      await objectStorageService.deleteObjectEntity(attachment.storageKey);
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) {
        return next(err);
      }
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
