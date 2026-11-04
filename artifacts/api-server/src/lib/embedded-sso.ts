
import { db, sessionsTable } from "@workspace/db";
import { and, like, lt } from "drizzle-orm";
import crypto from "node:crypto";

export interface EmbeddedSsoPayload {
  iss: "workspace";
  aud: string;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
  nonce: string;
}

const TOKEN_TTL_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 30;

function getSecret(): string {
  const secret = process.env.EMBEDDED_SSO_SECRET?.trim();

  if (!secret) {
    throw new Error("EMBEDDED_SSO_SECRET is not configured");
  }

  return secret;
}

function sign(encodedPayload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function verifyEmbeddedSsoToken(
  token: string,
  expectedAudience: string,
): EmbeddedSsoPayload | null {
  try {
    if (!token || token.length > 4096) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [encodedPayload, suppliedSignature] = parts;

    if (
      !/^[A-Za-z0-9_-]+$/.test(encodedPayload) ||
      !/^[A-Za-z0-9_-]+$/.test(suppliedSignature)
    ) {
      return null;
    }

    const expectedSignature = sign(encodedPayload);

    const suppliedBuffer = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as EmbeddedSsoPayload;

    if (
      !payload ||
      typeof payload !== "object" ||
      payload.iss !== "workspace" ||
      payload.aud !== expectedAudience ||
      typeof payload.sub !== "string" ||
      !payload.sub.trim() ||
      typeof payload.email !== "string" ||
      !payload.email.trim() ||
      typeof payload.name !== "string" ||
      !payload.name.trim() ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      typeof payload.nonce !== "string" ||
      !/^[a-f0-9]{32}$/i.test(payload.nonce)
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.iat > now + CLOCK_SKEW_SECONDS) return null;
    if (payload.exp <= now) return null;
    if (payload.exp <= payload.iat) return null;
    if (payload.exp - payload.iat > TOKEN_TTL_SECONDS) return null;

    return payload;
  } catch {
    return null;
  } 

}


export async function verifyAndConsumeEmbeddedSsoToken(
  token: string,
  expectedAudience: string,
): Promise<EmbeddedSsoPayload | null> {
  const payload = verifyEmbeddedSsoToken(token, expectedAudience);

  if (!payload) return null;

  const nonceSid = `sso-once:${payload.nonce}`;

  try {
    // Clean expired SSO nonce records only.
    // Clean expired SSO nonce records only.
    await db
    .delete(sessionsTable)
    .where(
        and(
        like(sessionsTable.sid, "sso-once:%"),
        lt(sessionsTable.expire, new Date()),
        ),
    );
    // Atomic insert: PostgreSQL rejects a previously consumed nonce.
    const [inserted] = await db
      .insert(sessionsTable)
      .values({
        sid: nonceSid,
        sess: {
          type: "embedded-sso-nonce",
          issuer: payload.iss,
        },
        expire: new Date(payload.exp * 1000),
      })
      .onConflictDoNothing()
      .returning({ sid: sessionsTable.sid });

    return inserted ? payload : null;
  } catch {
    // Fail closed if replay protection cannot be verified.
    return null;
  }
}
