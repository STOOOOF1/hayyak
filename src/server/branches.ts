import { createClient } from "@/lib/supabase/server";

const BRANCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicBranch = {
  id: string;
  name: string;
  slug: string;
};

export function isValidBranchSlug(slug: string) {
  return slug.length <= 80 && BRANCH_SLUG_PATTERN.test(slug);
}

export async function getPublicBranchBySlug(slug: string) {
  if (!isValidBranchSlug(slug)) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_branch", {
    p_slug: slug,
  });

  if (error) {
    throw new Error("تعذر تحميل بيانات الفرع.");
  }

  const branch = Array.isArray(data) ? data[0] : null;

  if (!branch) {
    return null;
  }

  return branch as PublicBranch;
}

