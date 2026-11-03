import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { File } from "@google-cloud/storage";
import { OfficeParser, type SupportedFileType } from "officeparser";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const MAX_EXTRACT_BYTES = 20 * 1024 * 1024;
const MAX_SEARCH_CHARS = 500_000;
const EXTRACT_TIMEOUT_MS = 90_000;
const execFileAsync = promisify(execFile);

class UnsupportedExtractionError extends Error {}

export type ExtractionResult =
  | { status: "complete"; text: string }
  | { status: "unsupported"; error: string }
  | { status: "failed"; error: string };

const OFFICE_TYPES = new Map<string, SupportedFileType>([
  [".pdf", "pdf"],
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pptx", "pptx"],
  [".csv", "csv"],
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".svg"]);

function compactText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_SEARCH_CHARS);
}

function getExtension(filename: string, contentType: string | null): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "text/plain") return ".txt";
  if (contentType === "text/csv") return ".csv";
  if (contentType === "image/svg+xml") return ".svg";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  return "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function recognizeImageInSubprocess(buffer: Buffer, extension: string): Promise<string> {
  const workDir = await mkdtemp(path.join(tmpdir(), "eto-ocr-"));
  const imagePath = path.join(workDir, `attachment${extension}`);
  const script = [
    "import Tesseract from 'tesseract.js';",
    "const result = await Tesseract.recognize(process.argv[1], 'eng', { logger: () => undefined, cachePath: process.env.TMPDIR || '/tmp' });",
    "process.stdout.write(result.data.text);",
  ].join("\n");

  try {
    await writeFile(imagePath, buffer);
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script, imagePath],
      {
        cwd: process.cwd(),
        timeout: EXTRACT_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return stdout;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function downloadWithLimit(file: File): Promise<Buffer> {
  const [metadata] = await file.getMetadata();
  const trustedSize = Number(metadata.size);
  if (Number.isFinite(trustedSize) && trustedSize > MAX_EXTRACT_BYTES) {
    throw new UnsupportedExtractionError("File exceeds the 20 MB text-extraction limit");
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = file.createReadStream();
    const timeout = setTimeout(() => {
      stream.destroy(new Error("Storage download timed out"));
    }, 30_000);

    stream.on("data", (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_EXTRACT_BYTES) {
        stream.destroy(new UnsupportedExtractionError("File exceeds the 20 MB text-extraction limit"));
        return;
      }
      chunks.push(buffer);
    });
    stream.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    stream.once("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks, total));
    });
  });
}

export async function extractAttachmentText(
  attachment: {
    filename: string;
    storageKey: string;
    contentType: string | null;
    fileSize: number | null;
  },
  objectStorageService = new ObjectStorageService(),
): Promise<ExtractionResult> {
  if (attachment.fileSize !== null && attachment.fileSize > MAX_EXTRACT_BYTES) {
    return { status: "unsupported", error: "File exceeds the 20 MB text-extraction limit" };
  }

  const extension = getExtension(attachment.filename, attachment.contentType);
  if (extension === ".zip") {
    return { status: "unsupported", error: "ZIP archive contents are not indexed" };
  }
  if ([".doc", ".xls", ".ppt"].includes(extension)) {
    return { status: "unsupported", error: "Legacy Office binary formats are not supported for text extraction" };
  }
  if (!TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension) && !OFFICE_TYPES.has(extension)) {
    return { status: "unsupported", error: "Attachment format is not supported for text extraction" };
  }

  try {
    const file = await objectStorageService.getObjectEntityFile(attachment.storageKey);
    const buffer = await downloadWithLimit(file);

    if (TEXT_EXTENSIONS.has(extension)) {
      return { status: "complete", text: compactText(buffer.toString("utf8")) };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    try {
      if (IMAGE_EXTENSIONS.has(extension)) {
        return { status: "complete", text: compactText(await recognizeImageInSubprocess(buffer, extension)) };
      }

      const ast = await OfficeParser.parseOffice(buffer, {
        fileType: OFFICE_TYPES.get(extension),
        extractAttachments: false,
        ocr: false,
        abortSignal: controller.signal,
      });
      return { status: "complete", text: compactText(ast.toText()) };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof UnsupportedExtractionError) {
      return { status: "unsupported", error: error.message };
    }
    if (error instanceof ObjectNotFoundError) {
      return { status: "failed", error: "Stored object was not found" };
    }
    if (isAbortError(error)) {
      return { status: "failed", error: "Text extraction timed out" };
    }
    return {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown extraction error",
    };
  }
}