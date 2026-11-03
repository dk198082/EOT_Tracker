import crypto from "node:crypto";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import * as oidc from "openid-client";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export interface SessionData {
  user: AuthUser;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: oidc.Configuration | null = null;

function getEntraSettings() {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const tenantId =
    process.env.ENTRA_TENANT_ID ??
    process.env.TENANT_ID ??
    process.env.AZURE_TENANT_ID;

  if (!clientId) throw new Error("CLIENT_ID is required for Microsoft Entra authentication");
  if (!clientSecret) throw new Error("CLIENT_SECRET is required for Microsoft Entra authentication");
  if (!tenantId) {
    throw new Error(
      "ENTRA_TENANT_ID, TENANT_ID, or AZURE_TENANT_ID is required for Microsoft Entra authentication",
    );
  }

  return { clientId, clientSecret, tenantId };
}

export async function getOidcConfig(): Promise<oidc.Configuration> {
  const { clientId, clientSecret, tenantId } = getEntraSettings();
  if (!oidcConfig) {
    oidcConfig = await oidc.discovery(
      new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0`),
      clientId,
      undefined,
      oidc.ClientSecretPost(clientSecret),
    );
  }
  return oidcConfig;
}

export function getEntraClientId() {
  return getEntraSettings().clientId;
}

export function getEntraTenantId() {
  return getEntraSettings().tenantId;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }
  return row.sess as unknown as SessionData;
}

export async function updateSession(sid: string, data: SessionData) {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string) {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string) {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return req.cookies?.[SESSION_COOKIE];
}