import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminConsoleUnavailableError, checkAdminConsoleAccess } from "../admin-console-access";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function configure() {
  vi.stubEnv("ADMIN_CONSOLE_URL", "https://console.example.test/");
  vi.stubEnv("ADMIN_CONSOLE_API_KEY", "synthetic-test-api-key");
  vi.stubEnv("ADMIN_CONSOLE_APP_NAME", "ETO");
  vi.stubGlobal("fetch", fetchMock);
}

describe("Admin Console access check", () => {
  it("sends the Entra object ID, registered app name, and server-side API key", async () => {
    configure();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ allowed: true, reason: null, roles: ["ETO - Read / Write"] }),
    });

    await expect(checkAdminConsoleAccess("entra-object-id")).resolves.toEqual({
      allowed: true,
      reason: null,
      roles: ["ETO - Read / Write"],
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe(
      "https://console.example.test/api/access-check?entraObjectId=entra-object-id&app=ETO",
    );
    expect(options.headers["X-API-Key"]).toBe("synthetic-test-api-key");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("omit");
  });

  it("preserves an Admin Console base path when building its endpoint", async () => {
    configure();
    vi.stubEnv("ADMIN_CONSOLE_URL", "https://console.example.test/control/");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ allowed: false, reason: "No access", roles: [] }),
    });
    await expect(checkAdminConsoleAccess("id")).resolves.toMatchObject({ allowed: false });
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      "https://console.example.test/control/api/access-check?",
    );
  });

  it("fails closed if required configuration is missing or not secure HTTPS", async () => {
    configure();
    vi.stubEnv("ADMIN_CONSOLE_APP_NAME", "");
    await expect(checkAdminConsoleAccess("id")).rejects.toMatchObject({
      kind: "not_configured",
    });
    vi.stubEnv("ADMIN_CONSOLE_APP_NAME", "ETO");
    vi.stubEnv("ADMIN_CONSOLE_URL", "http://console.example.test");
    await expect(checkAdminConsoleAccess("id")).rejects.toMatchObject({
      kind: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the console is unavailable or returns an invalid response", async () => {
    configure();
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    await expect(checkAdminConsoleAccess("id")).rejects.toBeInstanceOf(AdminConsoleUnavailableError);
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(checkAdminConsoleAccess("id")).rejects.toMatchObject({
      kind: "request_failed",
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("not JSON"); } });
    await expect(checkAdminConsoleAccess("id")).rejects.toMatchObject({
      kind: "invalid_response",
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ allowed: "true", reason: null, roles: [] }),
    });
    await expect(checkAdminConsoleAccess("id")).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
