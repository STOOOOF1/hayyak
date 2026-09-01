-- HAYYAK Phase 1: compact SaaS schema, relational integrity, and RLS.

create schema if not exists private;

create type public.tenant_status as enum ('ACTIVE', 'DISABLED');
create type public.app_role as enum ('PLATFORM_ADMIN', 'COFFEE_ADMIN', 'STAFF');
create type public.call_status as enum (
  'WAITING',
  'ACTIVE',
  'ON_HOLD',
  'ENDED',
  'CANCELLED'
);
create type public.call_actor_type as enum ('VISITOR', 'STAFF', 'SYSTEM');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  logo_url text,
  status public.tenant_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (
    char_length(slug) between 1 and 80
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  service_radius_meters integer not null default 200 check (
    service_radius_meters between 50 and 500
  ),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_coordinates_are_paired check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  unique (id, tenant_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  constraint membership_branch_belongs_to_tenant
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id)
    on delete cascade,
  constraint membership_scope_matches_role check (
    (role = 'PLATFORM_ADMIN' and tenant_id is null and branch_id is null)
    or (role = 'COFFEE_ADMIN' and tenant_id is not null and branch_id is null)
    or (role = 'STAFF' and tenant_id is not null)
  ),
  unique nulls not distinct (user_id, role, tenant_id, branch_id)
);

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  anonymous_identifier text not null unique check (
    char_length(anonymous_identifier) between 32 and 255
  ),
  last_car_description varchar(100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visitor_car_description_length check (
    last_car_description is null
    or char_length(last_car_description) <= 100
  )
);

create table public.call_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  visitor_id uuid not null references public.visitors(id) on delete restrict,
  car_description varchar(100),
  status public.call_status not null default 'WAITING',
  queue_sequence bigint not null,
  active_staff_user_id uuid references public.profiles(id) on delete set null,
  voice_room_id text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  held_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint call_branch_belongs_to_tenant
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id)
    on delete restrict,
  constraint call_car_description_length check (
    car_description is null or char_length(car_description) <= 100
  ),
  constraint call_voice_room_id_length check (
    voice_room_id is null or char_length(voice_room_id) between 1 and 160
  ),
  unique (branch_id, queue_sequence),
  unique (id, tenant_id, branch_id)
);

create table public.call_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  call_request_id uuid not null,
  event_type text not null check (char_length(btrim(event_type)) between 1 and 80),
  from_status public.call_status,
  to_status public.call_status,
  actor_type public.call_actor_type not null,
  actor_id uuid references public.profiles(id) on delete set null,
  command_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint event_branch_belongs_to_tenant
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id)
    on delete restrict,
  constraint event_call_belongs_to_branch_and_tenant
    foreign key (call_request_id, tenant_id, branch_id)
    references public.call_requests(id, tenant_id, branch_id)
    on delete cascade
);

create unique index one_active_call_per_branch
  on public.call_requests (branch_id)
  where status = 'ACTIVE';

create unique index one_held_call_per_branch
  on public.call_requests (branch_id)
  where status = 'ON_HOLD';

create unique index one_unresolved_call_per_visitor_branch
  on public.call_requests (branch_id, visitor_id)
  where status in ('WAITING', 'ACTIVE', 'ON_HOLD');

create unique index call_voice_room_id_unique
  on public.call_requests (voice_room_id)
  where voice_room_id is not null;

create index branches_by_tenant on public.branches (tenant_id, enabled);
create index memberships_by_user on public.memberships (user_id);
create index memberships_by_tenant_branch
  on public.memberships (tenant_id, branch_id, role);
create index waiting_calls_fifo
  on public.call_requests (branch_id, queue_sequence)
  where status = 'WAITING';
create index stale_waiting_calls
  on public.call_requests (created_at, branch_id)
  where status = 'WAITING';
create index call_events_by_call
  on public.call_events (call_request_id, id);
create unique index one_command_event_per_tenant
  on public.call_events (tenant_id, command_id)
  where command_id is not null;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function private.set_updated_at();

create trigger branches_set_updated_at
before update on public.branches
for each row execute function private.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger visitors_set_updated_at
before update on public.visitors
for each row execute function private.set_updated_at();

create trigger calls_set_updated_at
before update on public.call_requests
for each row execute function private.set_updated_at();

-- Serialize new calls on the branch row, then allocate max + 1 inside that lock.
-- This is branch-scoped, monotonic, and safe under concurrent inserts without an
-- eighth counter table. Rolled-back allocations may be reused, which is harmless.
create function private.assign_branch_queue_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.branches
  where id = new.branch_id and tenant_id = new.tenant_id
  for update;

  if not found then
    raise foreign_key_violation using message = 'call branch does not belong to tenant';
  end if;

  select coalesce(max(call.queue_sequence), 0) + 1
  into new.queue_sequence
  from public.call_requests as call
  where call.branch_id = new.branch_id;

  return new;
end;
$$;

create trigger calls_assign_queue_sequence
before insert on public.call_requests
for each row execute function private.assign_branch_queue_sequence();

-- If a staff user is attached to a call, their stored membership must authorize
-- that tenant/branch. This prevents cross-tenant staff references even for
-- privileged server writes that bypass RLS.
create function private.assert_call_staff_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_staff_user_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.memberships as membership
    where membership.user_id = new.active_staff_user_id
      and (
        (
          membership.role = 'PLATFORM_ADMIN'
          and membership.tenant_id is null
          and membership.branch_id is null
        )
        or (
          membership.tenant_id = new.tenant_id
          and (
            membership.role = 'COFFEE_ADMIN'
            or (
              membership.role = 'STAFF'
              and (membership.branch_id is null or membership.branch_id = new.branch_id)
            )
          )
        )
      )
  ) then
    raise foreign_key_violation using
      message = 'active staff user is not authorized for call branch';
  end if;

  return new;
end;
$$;

create trigger calls_assert_staff_scope
before insert or update of active_staff_user_id, tenant_id, branch_id
on public.call_requests
for each row execute function private.assert_call_staff_scope();

-- Auth metadata supplies a display label only. It can never grant an app role.
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'مستخدم حياك'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create function private.current_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'PLATFORM_ADMIN'
      and membership.tenant_id is null
      and membership.branch_id is null
  );
$$;

create function private.current_user_is_coffee_admin(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_platform_admin() or exists (
    select 1
    from public.memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'COFFEE_ADMIN'
      and membership.tenant_id = target_tenant_id
      and membership.branch_id is null
  );
$$;

create function private.current_user_can_access_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_platform_admin() or exists (
    select 1
    from public.memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id = target_tenant_id
  );
$$;

create function private.current_user_can_access_branch(
  target_tenant_id uuid,
  target_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_platform_admin() or exists (
    select 1
    from public.memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.tenant_id = target_tenant_id
      and (
        membership.role = 'COFFEE_ADMIN'
        or (
          membership.role = 'STAFF'
          and (membership.branch_id is null or membership.branch_id = target_branch_id)
        )
      )
  );
$$;

create function private.current_user_can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or private.current_user_is_platform_admin()
    or exists (
      select 1
      from public.memberships as target_membership
      join public.memberships as own_membership
        on own_membership.tenant_id = target_membership.tenant_id
      where target_membership.user_id = target_user_id
        and own_membership.user_id = (select auth.uid())
        and own_membership.role = 'COFFEE_ADMIN'
    );
$$;

-- The only anonymous database surface in Phase 1: a narrow enabled-branch lookup.
create function public.get_public_branch(p_slug text)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select branch.id, branch.name, branch.slug
  from public.branches as branch
  join public.tenants as tenant on tenant.id = branch.tenant_id
  where branch.slug = p_slug
    and branch.enabled
    and tenant.status = 'ACTIVE'
  limit 1;
$$;

alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.visitors enable row level security;
alter table public.call_requests enable row level security;
alter table public.call_events enable row level security;

create policy tenants_select_authorized
on public.tenants for select to authenticated
using (private.current_user_can_access_tenant(id));

create policy tenants_platform_insert
on public.tenants for insert to authenticated
with check (private.current_user_is_platform_admin());

create policy tenants_platform_update
on public.tenants for update to authenticated
using (private.current_user_is_platform_admin())
with check (private.current_user_is_platform_admin());

create policy tenants_platform_delete
on public.tenants for delete to authenticated
using (private.current_user_is_platform_admin());

create policy branches_select_authorized
on public.branches for select to authenticated
using (private.current_user_can_access_branch(tenant_id, id));

create policy branches_admin_insert
on public.branches for insert to authenticated
with check (private.current_user_is_coffee_admin(tenant_id));

create policy branches_admin_update
on public.branches for update to authenticated
using (private.current_user_is_coffee_admin(tenant_id))
with check (private.current_user_is_coffee_admin(tenant_id));

create policy branches_admin_delete
on public.branches for delete to authenticated
using (private.current_user_is_coffee_admin(tenant_id));

create policy profiles_select_authorized
on public.profiles for select to authenticated
using (private.current_user_can_view_profile(id));

create policy profiles_update_self_or_platform
on public.profiles for update to authenticated
using (id = (select auth.uid()) or private.current_user_is_platform_admin())
with check (id = (select auth.uid()) or private.current_user_is_platform_admin());

create policy memberships_select_authorized
on public.memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or private.current_user_is_platform_admin()
  or (
    tenant_id is not null
    and private.current_user_is_coffee_admin(tenant_id)
  )
);

create policy memberships_platform_insert
on public.memberships for insert to authenticated
with check (private.current_user_is_platform_admin());

create policy memberships_platform_update
on public.memberships for update to authenticated
using (private.current_user_is_platform_admin())
with check (private.current_user_is_platform_admin());

create policy memberships_platform_delete
on public.memberships for delete to authenticated
using (private.current_user_is_platform_admin());

create policy visitors_platform_select
on public.visitors for select to authenticated
using (private.current_user_is_platform_admin());

create policy calls_select_authorized
on public.call_requests for select to authenticated
using (private.current_user_can_access_branch(tenant_id, branch_id));

create policy events_select_authorized
on public.call_events for select to authenticated
using (private.current_user_can_access_branch(tenant_id, branch_id));

revoke all on table public.tenants from anon, authenticated;
revoke all on table public.branches from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.memberships from anon, authenticated;
revoke all on table public.visitors from anon, authenticated;
revoke all on table public.call_requests from anon, authenticated;
revoke all on table public.call_events from anon, authenticated;

grant select, insert, update, delete on table public.tenants to authenticated;
grant select, insert, update, delete on table public.branches to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.memberships to authenticated;
grant select on table public.visitors to authenticated;
grant select on table public.call_requests to authenticated;
grant select on table public.call_events to authenticated;

revoke all on function public.get_public_branch(text) from public;
grant execute on function public.get_public_branch(text) to anon, authenticated;

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.current_user_is_platform_admin() to authenticated;
grant execute on function private.current_user_is_coffee_admin(uuid) to authenticated;
grant execute on function private.current_user_can_access_tenant(uuid) to authenticated;
grant execute on function private.current_user_can_access_branch(uuid, uuid) to authenticated;
grant execute on function private.current_user_can_view_profile(uuid) to authenticated;
