"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/server/auth/authorization";

export async function signIn(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  const nextPath = safeInternalPath(formData.get("next"));

  if (typeof email !== "string" || typeof password !== "string") {
    redirect(`/login?error=invalid_credentials&next=${encodeURIComponent(nextPath)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=invalid_credentials&next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

