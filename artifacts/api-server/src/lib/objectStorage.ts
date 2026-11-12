
import { randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclFile,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl";

const credential = new DefaultAzureCredential();

function getStorageConfig() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  if (!accountName || !containerName) {
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_CONTAINER_NAME must be configured.",
    );
  }

  return { accountName, containerName };
}

export const objectStorageClient = {
  get serviceClient() {
    const { accountName } = getStorageConfig();

    return new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential,
    );
  },
};

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Compatibility adapter for the storage methods previously supplied
 * by Google Cloud Storage's File class.
 */
export class AzureObjectFile implements ObjectAclFile {
  constructor(
    public readonly blobClient: ReturnType<
      ReturnType<typeof objectStorageClient["serviceClient"]["getContainerClient"]>["getBlobClient"]
    >,
  ) {}

  get name(): string {
    return this.blobClient.name;
  }

  get url(): string {
    return this.blobClient.url;
  }

  async exists(): Promise<[boolean]> {
    return [await this.blobClient.exists()];
  }

  async getMetadata(): Promise<
    [
      {
        size?: number;
        contentType?: string;
        metadata?: Record<string, string>;
      },
    ]
  > {
    const properties = await this.blobClient.getProperties();

    return [
      {
        size: properties.contentLength,
        contentType: properties.contentType,
        metadata: properties.metadata ?? {},
      },
    ];
  }

  async setMetadata(options: {
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.blobClient.setMetadata(options.metadata);
  }

  createReadStream(): Readable {
    const output = new PassThrough();

    void (async () => {
      try {
        const response = await this.blobClient.download();

        if (!response.readableStreamBody) {
          throw new Error("Azure Blob download returned no readable stream.");
        }

        await pipeline(response.readableStreamBody, output);
      } catch (error) {
        output.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    })();

    return output;
  }

  async copy(target: AzureObjectFile): Promise<void> {
    const exists = await this.blobClient.exists();

    if (!exists) {
      throw new ObjectNotFoundError();
    }

    await target.blobClient.getBlockBlobClient().uploadStream(
      this.createReadStream(),
      4 * 1024 * 1024,
      5,
    );
    const [metadata] = await this.getMetadata();

    if (metadata.contentType) {
      await target.blobClient.setHTTPHeaders({
        blobContentType: metadata.contentType,
      });
    }

    if (metadata.metadata) {
      await target.blobClient.setMetadata(metadata.metadata);
    }
  }

  async delete(): Promise<void> {
    const result = await this.blobClient.deleteIfExists();

    if (!result.succeeded) {
      throw new ObjectNotFoundError();
    }
  }
}

export class ObjectStorageService {
  private getContainerClient() {
    const { containerName } = getStorageConfig();

    return objectStorageClient.serviceClient.getContainerClient(containerName);
  }

  private getBlobFile(blobName: string): AzureObjectFile {
    return new AzureObjectFile(
      this.getContainerClient().getBlobClient(blobName),
    );
  }

  private getBlobName(objectPath: string): string {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const blobName = objectPath.slice("/objects/".length);

    if (!blobName || blobName.includes("..")) {
      throw new ObjectNotFoundError();
    }

    return blobName;
  }

  private async getUserDelegationKey(expiresOn: Date) {
    const serviceClient = objectStorageClient.serviceClient;
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);

    return serviceClient.getUserDelegationKey(startsOn, expiresOn);
  }

  private async signBlobURL(
    blobName: string,
    permission: "read" | "upload",
    ttlSec: number,
  ): Promise<string> {
    const { accountName, containerName } = getStorageConfig();

    const now = Date.now();
    const startsOn = new Date(now - 5 * 60 * 1000);
    const expiresOn = new Date(now + ttlSec * 1000);

    const serviceClient = objectStorageClient.serviceClient;
    const delegationKey = await this.getUserDelegationKey(expiresOn);

    const permissions =
      permission === "read"
        ? BlobSASPermissions.parse("r")
        : BlobSASPermissions.parse("cw");

    const sas = generateBlobSASQueryParameters(
      {
        containerName,
        blobName,
        permissions,
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      delegationKey,
      accountName,
    ).toString();

    return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName).replace(/%2F/g, "/")}?${sas}`;
  }

  getPublicObjectSearchPaths(): string[] {
    return (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
      .split(",")
      .map((path) => path.trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  }

  getPrivateObjectDir(): string {
    return process.env.AZURE_STORAGE_CONTAINER_NAME || "";
  }

  async searchPublicObject(filePath: string): Promise<AzureObjectFile | null> {
    const candidates = [
      ...this.getPublicObjectSearchPaths().map(
        (prefix) => `${prefix}/${filePath}`,
      ),
      filePath.replace(/^\/+/, ""),
    ];

    for (const blobName of [...new Set(candidates)]) {
      const file = this.getBlobFile(blobName);
      const [exists] = await file.exists();

      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: AzureObjectFile,
    cacheTtlSec = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };

    if (metadata.size !== undefined) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityDownloadURL(
    objectPath: string,
    ttlSec = 900,
  ): Promise<string> {
    const blobName = this.getBlobName(objectPath);

    return this.signBlobURL(blobName, "read", ttlSec);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const blobName = `uploads/${randomUUID()}`;

    return this.signBlobURL(blobName, "upload", 900);
  }

  async getObjectEntityFile(
    objectPath: string,
  ): Promise<AzureObjectFile> {
    const blobName = this.getBlobName(objectPath);
    const objectFile = this.getBlobFile(blobName);
    const [exists] = await objectFile.exists();

    if (!exists) {
      throw new ObjectNotFoundError();
    }

    return objectFile;
  }

  async copyObjectEntity(objectPath: string): Promise<string> {
    const sourceFile = await this.getObjectEntityFile(objectPath);
    const targetBlobName = `splits/${randomUUID()}`;
    const targetFile = this.getBlobFile(targetBlobName);

    await sourceFile.copy(targetFile);

    return `/objects/${targetBlobName}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://")) {
      return rawPath;
    }

    try {
      const url = new URL(rawPath);
      const { containerName, accountName } = getStorageConfig();

      if (url.hostname !== `${accountName}.blob.core.windows.net`) {
        return rawPath;
      }

      const pathParts = url.pathname
        .split("/")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part));

      if (pathParts[0] !== containerName || pathParts.length < 2) {
        return rawPath;
      }

      const blobName = pathParts.slice(1).join("/");

      return `/objects/${blobName}`;
    } catch {
      return rawPath;
    }
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);

    if (!normalizedPath.startsWith("/objects/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);

    await setObjectAclPolicy(objectFile, aclPolicy);

    return normalizedPath;
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    const objectFile = await this.getObjectEntityFile(objectPath);

    await objectFile.delete();
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: AzureObjectFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
