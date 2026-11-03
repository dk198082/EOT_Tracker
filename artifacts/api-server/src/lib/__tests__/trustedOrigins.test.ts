import { describe, expect, it } from "vitest";
import { getTrustedOrigins } from "../trustedOrigins";

describe("getTrustedOrigins", () => {
  it("includes exact development and published app origins", () => {
    const origins = getTrustedOrigins({
      REPLIT_DEV_DOMAIN: "example.replit.dev",
      REPLIT_DOMAINS: "eto.example.com, process-brief-generator.replit.app",
    });

    expect(origins).toContain("https://example.replit.dev");
    expect(origins).toContain("https://eto.example.com");
    expect(origins).toContain("https://process-brief-generator.replit.app");
  });

  it("does not allow lookalike subdomains", () => {
    const origins = getTrustedOrigins({
      REPLIT_DOMAINS: "process-brief-generator.replit.app",
    });

    expect(origins).not.toContain(
      "https://process-brief-generator.replit.app.attacker.example",
    );
  });
});