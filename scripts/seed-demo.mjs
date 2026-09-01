import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEMO_PLATFORM_ADMIN_EMAIL",
  "DEMO_PLATFORM_ADMIN_PASSWORD",
  "DEMO_COFFEE_ADMIN_EMAIL",
  "DEMO_COFFEE_ADMIN_PASSWORD",
  "DEMO_STAFF_EMAIL",
  "DEMO_STAFF_PASSWORD",
];

const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(`Missing required variables: ${missing.join(", ")}`);
}

for (const name of required.filter((value) => value.endsWith("_PASSWORD"))) {
  const value = process.env[name];
  if (!value || value.length < 12 || value.startsWith("replace_")) {
    throw new Error(`${name} must be a non-placeholder value of at least 12 characters.`);
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

async function ensureUser(email, password, displayName) {
  const { data: usersPage, error: listError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (listError) throw listError;

  let user = usersPage.users.find(
    (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (error) throw error;
    user = data.user;
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
    display_name: displayName,
  });

  if (profileError) throw profileError;

  return user;
}

const { error: tenantError } = await supabase.from("tenants").upsert({
  id: TENANT_ID,
  name: "حياك كوفي",
  status: "ACTIVE",
});
if (tenantError) throw tenantError;

const { error: branchError } = await supabase.from("branches").upsert({
  id: BRANCH_ID,
  tenant_id: TENANT_ID,
  name: "الفرع التجريبي",
  slug: "hayyak-demo",
  service_radius_meters: 200,
  enabled: true,
});
if (branchError) throw branchError;

const platformAdmin = await ensureUser(
  process.env.DEMO_PLATFORM_ADMIN_EMAIL,
  process.env.DEMO_PLATFORM_ADMIN_PASSWORD,
  "مدير منصة حياك",
);
const coffeeAdmin = await ensureUser(
  process.env.DEMO_COFFEE_ADMIN_EMAIL,
  process.env.DEMO_COFFEE_ADMIN_PASSWORD,
  "مدير حياك كوفي",
);
const staff = await ensureUser(
  process.env.DEMO_STAFF_EMAIL,
  process.env.DEMO_STAFF_PASSWORD,
  "موظف الفرع التجريبي",
);

const { error: membershipError } = await supabase.from("memberships").upsert(
  [
    {
      user_id: platformAdmin.id,
      tenant_id: null,
      branch_id: null,
      role: "PLATFORM_ADMIN",
    },
    {
      user_id: coffeeAdmin.id,
      tenant_id: TENANT_ID,
      branch_id: null,
      role: "COFFEE_ADMIN",
    },
    {
      user_id: staff.id,
      tenant_id: TENANT_ID,
      branch_id: BRANCH_ID,
      role: "STAFF",
    },
  ],
  { onConflict: "user_id,role,tenant_id,branch_id" },
);

if (membershipError) throw membershipError;

console.log("Demo tenant, branch, and three role-scoped users are ready.");

