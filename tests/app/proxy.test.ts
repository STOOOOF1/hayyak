import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

describe("Supabase session proxy scope", () => {
  const matcher = config.matcher;
  const declaredRoots = matcher.map((pattern) => pattern.split("/:path*")[0]);

  it.each(["/staff", "/admin", "/platform", "/login", "/auth/callback"])(
    "declares the auth-aware route family %s",
    (url) => {
      const rootSegment = `/${url.split("/")[1]}`;
      expect(matcher.some((pattern) => pattern.startsWith(rootSegment))).toBe(true);
    },
  );

  it.each(["/", "/c/hayyak-demo", "/favicon.ico"])(
    "does not declare the public route %s",
    (url) => {
      const rootSegment = url === "/" ? "/" : `/${url.split("/")[1]}`;
      expect(declaredRoots).not.toContain(rootSegment);
    },
  );
});
