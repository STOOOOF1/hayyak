import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/server/auth/authorization";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = safeInternalPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(nextPath, url.origin));
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=invalid_callback", url.origin),
  );
}

