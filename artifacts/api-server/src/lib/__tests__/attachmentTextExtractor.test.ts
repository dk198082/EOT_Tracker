import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { extractAttachmentText } from "../attachmentTextExtractor";

function fakeStorage(contents: string) {
  return {
    getObjectEntityFile: async () => ({
      getMetadata: async () => [{ size: String(Buffer.byteLength(contents)) }],
      createReadStream: () => Readable.from([Buffer.from(contents, "utf8")]),
    }),
  };
}

describe("extractAttachmentText", () => {
  it("extracts and normalizes searchable text files", async () => {
    const result = await extractAttachmentText(
      {
        filename: "test-notes.txt",
        storageKey: "/objects/uploads/test",
        contentType: "text/plain",
        fileSize: 128,
      },
      fakeStorage("  High-cycle regime  \nSecond line\u0000") as never,
    );

    expect(result).toEqual({
      status: "complete",
      text: "High-cycle regime\nSecond line",
    });
  });

  it("does not unpack ZIP archives", async () => {
    const result = await extractAttachmentText(
      {
        filename: "drawings.zip",
        storageKey: "/objects/uploads/zip",
        contentType: "application/zip",
        fileSize: 1_000,
      },
      fakeStorage("unused") as never,
    );

    expect(result).toEqual({
      status: "unsupported",
      error: "ZIP archive contents are not indexed",
    });
  });

  it("rejects oversized files before downloading them", async () => {
    let downloaded = false;
    const result = await extractAttachmentText(
      {
        filename: "large.pdf",
        storageKey: "/objects/uploads/large",
        contentType: "application/pdf",
        fileSize: 21 * 1024 * 1024,
      },
      {
        getObjectEntityFile: async () => {
          downloaded = true;
          throw new Error("should not run");
        },
      } as never,
    );

    expect(downloaded).toBe(false);
    expect(result.status).toBe("unsupported");
  });

  it("trusts stored object size over untrusted attachment metadata", async () => {
    let streamed = false;
    const result = await extractAttachmentText(
      {
        filename: "spoofed.txt",
        storageKey: "/objects/uploads/spoofed",
        contentType: "text/plain",
        fileSize: null,
      },
      {
        getObjectEntityFile: async () => ({
          getMetadata: async () => [{ size: String(21 * 1024 * 1024) }],
          createReadStream: () => {
            streamed = true;
            return Readable.from([]);
          },
        }),
      } as never,
    );

    expect(streamed).toBe(false);
    expect(result).toEqual({
      status: "unsupported",
      error: "File exceeds the 20 MB text-extraction limit",
    });
  });

  it("retains a failed status when the stored object cannot be read", async () => {
    const result = await extractAttachmentText(
      {
        filename: "missing.txt",
        storageKey: "/objects/uploads/missing",
        contentType: "text/plain",
        fileSize: 10,
      },
      {
        getObjectEntityFile: async () => {
          throw new Error("storage unavailable");
        },
      } as never,
    );

    expect(result).toEqual({
      status: "failed",
      error: "storage unavailable",
    });
  });
});