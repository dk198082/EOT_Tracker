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

  // --- AZURE DEPLOYMENT ---------------------------------------------------
  // REPLIT_DEV_DOMAIN/REPLIT_DOMAINS are never set on Azure. CORS_ORIGIN is
  // this app's equivalent for a non-Replit host: a comma-separated allowlist
  // of exact origins (e.g. "https://eto-tracker.azurewebsites.net"). Only
  // needed if the frontend is ever split onto its own origin — the default
  // single-container STATIC_DIR deployment (see ./Dockerfile /
  // AZURE_DEPLOYMENT.md) is same-origin, so the browser never sends a
  // cross-origin request in the first place and this stays empty.
  for (const rawDomain of (env.CORS_ORIGIN ?? "").split(",")) {
    const domain = rawDomain.trim();
    if (!domain) continue;
    origins.add(domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`);
  }

  return origins;
}