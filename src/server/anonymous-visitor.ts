import { createHash, randomBytes } from "node:crypto";

export const ANONYMOUS_VISITOR_COOKIE = "hayyak_visitor";

export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateVisitorToken(): string {
  return randomBytes(32).toString("hex");
}

export function visitorIdentifierFromToken(token: string): string {
  return sha256Hex(token);
}

export type VisitorCookieAttributes = {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
};

export function visitorCookieHeader(
  token: string,
  attributes: VisitorCookieAttributes = {},
): string {
  const parts = [
    `${ANONYMOUS_VISITOR_COOKIE}=${token}`,
    `Max-Age=${attributes.maxAgeSeconds ?? VISITOR_COOKIE_MAX_AGE_SECONDS}`,
    `Path=${attributes.path ?? "/"}`,
    `HttpOnly=${attributes.httpOnly ?? true}`,
    attributes.secure ?? true ? "Secure" : "",
    `SameSite=${attributes.sameSite ?? "lax"}`,
  ].filter(Boolean);

  return parts.join("; ");
}

export function isPlausibleVisitorToken(token: string): boolean {
  return typeof token === "string" && /^[0-9a-f]{64}$/i.test(token);
}
