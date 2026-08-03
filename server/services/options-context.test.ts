// Security tests for the opaque options-context token service.
// Run: npx vitest run --root . server/services/options-context.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import {
  issueOptionsContext,
  resolveOptionsContext,
  revokeOptionsContext,
  _clearOptionsContexts,
  OPTIONS_CONTEXT_TTL_MS,
} from "./options-context";

beforeEach(() => _clearOptionsContexts());

describe("options context tokens", () => {
  it("issues opaque 256-bit tokens with no embedded claims", () => {
    const { token } = issueOptionsContext("user-1");
    expect(token).toMatch(/^[0-9a-f]{64}$/); // hex randomness only
    expect(token).not.toContain("user-1"); // nothing decodable
    expect(Buffer.from(token, "hex").toString("utf8")).not.toContain("user-1");
  });

  it("resolves to the issuing user within TTL", () => {
    const { token } = issueOptionsContext("user-1");
    expect(resolveOptionsContext(token)).toBe("user-1");
  });

  it("expires after TTL", () => {
    const now = Date.now();
    const { token } = issueOptionsContext("user-1", { now });
    expect(resolveOptionsContext(token, now + OPTIONS_CONTEXT_TTL_MS - 1)).toBe("user-1");
    expect(resolveOptionsContext(token, now + OPTIONS_CONTEXT_TTL_MS + 1)).toBeNull();
    // expired token is deleted — cannot be resurrected by clock rollback
    expect(resolveOptionsContext(token, now)).toBeNull();
  });

  it("caps requested TTL at 15 minutes", () => {
    const now = Date.now();
    const { token, expiresAt } = issueOptionsContext("user-1", { now, ttlMs: 24 * 60 * 60 * 1000 });
    expect(new Date(expiresAt).getTime() - now).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(resolveOptionsContext(token, now + 16 * 60 * 1000)).toBeNull();
  });

  it("rejects unknown, malformed, and non-string tokens", () => {
    issueOptionsContext("user-1");
    expect(resolveOptionsContext("0".repeat(64))).toBeNull();
    expect(resolveOptionsContext("short")).toBeNull();
    expect(resolveOptionsContext("")).toBeNull();
    expect(resolveOptionsContext(undefined)).toBeNull();
    expect(resolveOptionsContext(null)).toBeNull();
    expect(resolveOptionsContext(12345 as any)).toBeNull();
    expect(resolveOptionsContext({ token: "x" } as any)).toBeNull();
  });

  it("revocation is immediate (single-request tokens)", () => {
    const { token } = issueOptionsContext("user-1");
    revokeOptionsContext(token);
    expect(resolveOptionsContext(token)).toBeNull();
  });

  it("tokens are unique and user-scoped", () => {
    const a = issueOptionsContext("user-a").token;
    const b = issueOptionsContext("user-b").token;
    expect(a).not.toBe(b);
    expect(resolveOptionsContext(a)).toBe("user-a");
    expect(resolveOptionsContext(b)).toBe("user-b");
  });

  it("requires a userId at issuance", () => {
    expect(() => issueOptionsContext("")).toThrow();
  });
});
