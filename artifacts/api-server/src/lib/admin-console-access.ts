export interface AdminConsoleAccess {
  allowed: boolean;
  reason: string | null;
  roles: string[];
}

export class AdminConsoleUnavailableError extends Error {
  constructor(readonly kind: "not_configured" | "request_failed" | "invalid_response") {
    super("Admin Console access could not be verified");
    this.name = "AdminConsoleUnavailableError";
  }
}

/**
 * Authorization is a fail-closed gate. The API key stays server-side and is
 * never included in errors, logs, or browser responses.
 */
export async function checkAdminConsoleAccess(entraObjectId: string): Promise<AdminConsoleAccess> {
  const baseUrl = process.env.ADMIN_CONSOLE_URL?.trim();
  const apiKey = process.env.ADMIN_CONSOLE_API_KEY;
  const appName = process.env.ADMIN_CONSOLE_APP_NAME?.trim();
  if (!baseUrl || !apiKey || !appName) {
    throw new AdminConsoleUnavailableError("not_configured");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/api/access-check`);
    if (endpoint.protocol !== "https:") {
      throw new Error("HTTPS is required");
    }
  } catch {
    throw new AdminConsoleUnavailableError("not_configured");
  }

  endpoint.searchParams.set("entraObjectId", entraObjectId);
  endpoint.searchParams.set("app", appName);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new AdminConsoleUnavailableError("request_failed");
  }

  if (!response.ok) {
    throw new AdminConsoleUnavailableError("request_failed");
  }

  let body: unknown;
const rawBody = await response.text();

try {
  body = JSON.parse(rawBody);
} catch (error) {
  console.error("[Admin Console JSON parse failed]", {
    status: response.status,
    contentType: response.headers.get("content-type"),
    responseLength: rawBody.length,
    error: error instanceof Error ? error.message : "Unknown error",
  });

  throw new AdminConsoleUnavailableError("invalid_response");
}
  
  const diagnosticBody =
  typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;

console.log("[Admin Console diagnostic]", {
  status: response.status,
  contentType: response.headers.get("content-type"),
  bodyType: typeof body,
  keys: diagnosticBody ? Object.keys(diagnosticBody) : [],
  allowedType: typeof diagnosticBody?.allowed,
  reasonType: typeof diagnosticBody?.reason,
  rolesIsArray: Array.isArray(diagnosticBody?.roles),
  rolesItemTypes: Array.isArray(diagnosticBody?.roles)
    ? diagnosticBody.roles.map((role) => typeof role)
    : [],
});

  if (typeof body !== "object" || body === null) {
  throw new AdminConsoleUnavailableError("invalid_response");
}

const data = body as Record<string, unknown>;

if (
  typeof data.allowed !== "boolean" ||
  (data.reason !== undefined &&
    data.reason !== null &&
    typeof data.reason !== "string") ||
  !Array.isArray(data.roles) ||
  !data.roles.every((role: unknown) => typeof role === "string")
) {
  throw new AdminConsoleUnavailableError("invalid_response");
}

return {
  allowed: data.allowed as boolean,
  reason: (data.reason as string | null | undefined) ?? null,
  roles: data.roles as string[],
};
}
