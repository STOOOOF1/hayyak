import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_VISITOR_COOKIE,
  generateVisitorToken,
  isPlausibleVisitorToken,
  visitorCookieHeader,
  visitorIdentifierFromToken,
} from "@/server/anonymous-visitor";

describe("anonymous visitor token lifecycle", () => {
  it("generates a unique high-entropy token each call", () => {
    const a = generateVisitorToken();
    const b = generateVisitorToken();
    expect(a).not.toBe(b);
    expect(isPlausibleVisitorToken(a)).toBe(true);
  });

  it("hashes the token to the stored 64-char SQL-identifier form", () => {
    const token = generateVisitorToken();
    const identifier = visitorIdentifierFromToken(token);
    expect(identifier).toMatch(/^[0-9a-f]{64}$/);
    // deterministic for the same token
    expect(visitorIdentifierFromToken(token)).toBe(identifier);
  });

  it("rejects implausible tokens", () => {
    expect(isPlausibleVisitorToken("")).toBe(false);
    expect(isPlausibleVisitorToken("short")).toBe(false);
    expect(isPlausibleVisitorToken("not-hex!!".repeat(8))).toBe(false);
  });

  it("serializes an HttpOnly, Secure, SameSite=Lax, long-lived cookie", () => {
    const header = visitorCookieHeader("abc");
    expect(header).toContain(`${ANONYMOUS_VISITOR_COOKIE}=abc`);
    expect(header).toContain("HttpOnly=true");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=lax");
    expect(header).toContain("Max-Age=31536000");
    expect(header).toContain("Path=/");
  });
});
