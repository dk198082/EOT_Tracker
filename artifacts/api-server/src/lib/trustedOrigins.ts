export function getTrustedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const origins = new Set<string>([
    "http://localhost:5173",
    "http://localhost:3000",
  ]);

  if (env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${env.REPLIT_DEV_DOMAIN}`);
  }

  for (const rawDomain of (env.REPLIT_DOMAINS ?? "").split(",")) {
    const domain = rawDomain.trim();
    if (!domain) continue;
    origins.add(domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`);
  }

  // AZURE: only needed if the frontend is deployed on a separate origin from
  // this API (not the default single-container deployment described in
  // AZURE_DEPLOYMENT.md, where same-origin requests never hit CORS at all).
  for (const rawOrigin of (env.CORS_ORIGIN ?? "").split(",")) {
    const origin = rawOrigin.trim();
    if (!origin) continue;
    origins.add(new URL(origin).origin);
  }

  return origins;
}