-- HAYYAK Phase 2: authoritative call queue backend.
-- Adds transactional command functions, queued_at column, and domain error codes.
-- Preserves all Phase 1 invariants. New changes only; Phase 1 migration is not edited.

-- ---------------------------------------------------------------------------
-- Domain error codes (uniquely informative constants, no raw PG internals leak)
-- ---------------------------------------------------------------------------
create type public.call_error_code as enum (
  'BRANCH_NOT_FOUND',
  'BRANCH_DISABLED',
  'TENANT_NOT_ACTIVE',
  'CALL_ALREADY_EXISTS',
  'CALL_NOT_FOUND',
  'CALL_NOT_WAITING',
  'CALL_NOT_ACTIVE',
  'CALL_NOT_HELD',
  'ACTIVE_CALL_EXISTS',
  'HELD_CALL_EXISTS',
  'NO_WAITING_CALL',
  'UNRESOLVED_CALL_EXISTS',
  'UNAUTHORIZED',
  'INVALID_CAR_DESCRIPTION',
  'INVALID_VISITOR',
  'STALE_LOCKED'
);

-- ---------------------------------------------------------------------------
-- queued_at: customer-facing FIFO timestamp, backfilled from created_at.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'call_requests' and column_name = 'queued_at'
  ) then
    alter table public.call_requests
      add column queued_at timestamptz;
  end if;
end $$;

update public.call_requests set queued_at = created_at where queued_at is null;

alter table public.call_requests
  alter column queued_at set default now(),
  alter column queued_at set not null;

-- ---------------------------------------------------------------------------
-- Complete the visitor token interpretation.
-- anonymous_identifier now holds the SHA-256 hex digest of the bearer token
-- that the server mints. The raw token is only ever in the HttpOnly cookie.
-- ---------------------------------------------------------------------------
comment on column public.visitors.anonymous_identifier is
  'SHA-256 hex digest of the anonymous bearer token (server-minted, HttpOnly cookie). The raw token is never stored.';

-- ---------------------------------------------------------------------------
-- Helper: normalize car_description. Empty/whitespace becomes NULL; enforces
-- max 100 char length (raises INVALID_CAR_DESCRIPTION).
-- ---------------------------------------------------------------------------
create or replace function private.car_description_normalized(p_value text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_trimmed text;
begin
  v_trimmed := btrim(coalesce(p_value, ''));
  if v_trimmed = '' then
    return null;
  end if;
  if char_length(v_trimmed) > 100 then
    raise exception using errcode = 'P2DES', message = 'INVALID_CAR_DESCRIPTION';
  end if;
  return v_trimmed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: append a single call event in the current transaction.
-- ---------------------------------------------------------------------------
create or replace function private.append_call_event(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_call_request_id uuid,
  p_event_type text,
  p_from_status public.call_status,
  p_to_status public.call_status,
  p_actor_type public.call_actor_type,
  p_actor_id uuid,
  p_command_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.call_events (
    tenant_id, branch_id, call_request_id, event_type,
    from_status, to_status, actor_type, actor_id,
    command_id, metadata
  ) values (
    p_tenant_id, p_branch_id, p_call_request_id, p_event_type,
    p_from_status, p_to_status, p_actor_type, p_actor_id,
    p_command_id, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: position-of-waiting (count of earlier WAITING for the branch + 1).
-- Defined before enqueue_call so the reference resolves at creation time.
-- ---------------------------------------------------------------------------
create or replace function private.position_of_waiting(p_branch_id uuid, p_call_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*) + 1
  from public.call_requests cr
  where cr.branch_id = p_branch_id
    and cr.status = 'WAITING'
    and cr.queue_sequence < (
      select c.queue_sequence from public.call_requests c where c.id = p_call_id
    );
$$;

-- ---------------------------------------------------------------------------
-- Command: enqueue_call (customer, anonymous).
-- Resolves branch by slug server-side; no client-supplied ids trusted.
-- No proximity proof yet (Phase 3 will add it); runs without geolocation now.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_call(
  p_branch_slug text,
  p_visitor_identifier text,
  p_car_description text default null,
  p_command_id uuid default null
)
returns table (
  call_id uuid,
  tenant_id uuid,
  branch_id uuid,
  queue_sequence bigint,
  status public.call_status,
  queue_position bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_tenant public.tenants%rowtype;
  v_visitor public.visitors%rowtype;
  v_existing_id uuid;
  v_desc text;
  v_position bigint;
  v_new_call_id uuid;
  v_new_tenant_id uuid;
  v_new_branch_id uuid;
  v_new_sequence bigint;
  v_new_status public.call_status;
begin
  if p_visitor_identifier is null or char_length(p_visitor_identifier) < 32 then
    raise exception using errcode = 'P2VIS', message = 'INVALID_VISITOR';
  end if;

  v_desc := private.car_description_normalized(p_car_description);

  -- Resolve branch by slug; branch must be enabled and its tenant active.
  select branch.* into v_branch
  from public.branches branch
  where branch.slug = p_branch_slug
    and branch.enabled
  for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;

  select tenant.* into v_tenant from public.tenants tenant
  where tenant.id = v_branch.tenant_id for update;
  if not found or v_tenant.status <> 'ACTIVE' then
    raise exception using errcode = 'P2TNA', message = 'TENANT_NOT_ACTIVE';
  end if;

  -- Idempotency: if the visitor already has an unresolved call here, return it.
  select existing.id into v_existing_id
  from public.call_requests existing
  join public.visitors vis on vis.id = existing.visitor_id
  where existing.branch_id = v_branch.id
    and vis.anonymous_identifier = p_visitor_identifier
    and existing.status in ('WAITING', 'ACTIVE', 'ON_HOLD')
  limit 1;

  if v_existing_id is not null then
    -- Return the existing unresolved call + its position.
    return query
      select existing.id,
             existing.tenant_id,
             existing.branch_id,
             existing.queue_sequence,
             existing.status,
             private.position_of_waiting(existing.branch_id, existing.id)
      from public.call_requests existing
      where existing.id = v_existing_id;
    return;
  end if;

  -- Find or create the visitor from the hash.
  select vis.* into v_visitor
  from public.visitors vis
  where vis.anonymous_identifier = p_visitor_identifier
  for update;
  if not found then
    insert into public.visitors (anonymous_identifier)
    values (p_visitor_identifier)
    returning * into v_visitor;
  end if;

  -- Create the WAITING request. Queue sequence is allocated by the Phase 1
  -- BEFORE INSERT trigger (branch row lock + max+1).
  insert into public.call_requests (
    tenant_id, branch_id, visitor_id, car_description,
    status, queued_at, version
  ) values (
    v_branch.tenant_id, v_branch.id, v_visitor.id, v_desc,
    'WAITING', now(), 1
  )
  returning public.call_requests.id,
            public.call_requests.tenant_id,
            public.call_requests.branch_id,
            public.call_requests.queue_sequence,
            public.call_requests.status
  into v_new_call_id, v_new_tenant_id, v_new_branch_id, v_new_sequence, v_new_status;

  call_id := v_new_call_id;
  tenant_id := v_new_tenant_id;
  branch_id := v_new_branch_id;
  queue_sequence := v_new_sequence;
  status := v_new_status;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, call_id,
    'CALL_ENQUEUED', null, 'WAITING',
    'VISITOR', null, p_command_id,
    jsonb_build_object('car_description', v_desc)
  );

  -- Queue position = count of earlier WAITING for this branch + 1
  select private.position_of_waiting(branch_id, call_id) into v_position;
  queue_position := v_position;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: authorize a staff/user for branch operations.
-- ---------------------------------------------------------------------------
create or replace function private.user_can_operate_branch(
  p_user_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user_id
      and (
        (m.role = 'PLATFORM_ADMIN' and m.tenant_id is null and m.branch_id is null)
        or (
          m.tenant_id = p_tenant_id
          and (
            m.role = 'COFFEE_ADMIN'
            or (m.role = 'STAFF' and (m.branch_id is null or m.branch_id = p_branch_id))
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Command: answer_call (staff).
-- ---------------------------------------------------------------------------
create or replace function public.answer_call(
  p_branch_id uuid,
  p_call_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns table (call_id uuid, queue_sequence bigint, status public.call_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_call public.call_requests%rowtype;
begin
  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;

  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  if exists (
    select 1 from public.call_requests c where c.branch_id = v_branch.id and c.status = 'ACTIVE'
  ) then
    raise exception using errcode = 'P2ACE', message = 'ACTIVE_CALL_EXISTS';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_call.status <> 'WAITING' then
    raise exception using errcode = 'P2CNW', message = 'CALL_NOT_WAITING';
  end if;

  update public.call_requests c
  set status = 'ACTIVE', answered_at = now(),
      active_staff_user_id = p_actor_user_id, version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_call.id,
    'CALL_ANSWERED', 'WAITING', 'ACTIVE', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  return query select c.id, c.queue_sequence, c.status
  from public.call_requests c where c.id = v_call.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: hold_call (ACTIVE -> ON_HOLD).
-- ---------------------------------------------------------------------------
create or replace function public.hold_call(
  p_branch_id uuid,
  p_call_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns table (call_id uuid, status public.call_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_call public.call_requests%rowtype;
begin
  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;
  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  if exists (
    select 1 from public.call_requests c
    where c.branch_id = v_branch.id and c.status = 'ON_HOLD'
  ) then
    raise exception using errcode = 'P2HDE', message = 'HELD_CALL_EXISTS';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_call.status <> 'ACTIVE' then
    raise exception using errcode = 'P2CNA', message = 'CALL_NOT_ACTIVE';
  end if;

  update public.call_requests c
  set status = 'ON_HOLD', held_at = now(), version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_call.id,
    'CALL_HELD', 'ACTIVE', 'ON_HOLD', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  return query select v_call.id, 'ON_HOLD'::public.call_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: hold_and_answer_next (core compound transition).
-- Atomically: current ACTIVE -> ON_HOLD; oldest WAITING -> ACTIVE.
-- Fails cleanly if an ON_HOLD already exists or no WAITING caller.
-- Never leaves the system half-transitioned.
-- ---------------------------------------------------------------------------
create or replace function public.hold_and_answer_next(
  p_branch_id uuid,
  p_active_call_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns table (
  held_call_id uuid,
  answered_call_id uuid,
  answered_queue_sequence bigint,
  status_held public.call_status,
  status_answered public.call_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_active public.call_requests%rowtype;
  v_next_id uuid;
  v_next_seq bigint;
begin
  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;
  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  if exists (
    select 1 from public.call_requests c
    where c.branch_id = v_branch.id and c.status = 'ON_HOLD'
  ) then
    raise exception using errcode = 'P2HDE', message = 'HELD_CALL_EXISTS';
  end if;

  select c.* into v_active from public.call_requests c
  where c.id = p_active_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_active.status <> 'ACTIVE' then
    raise exception using errcode = 'P2CNA', message = 'CALL_NOT_ACTIVE';
  end if;

  -- Select oldest valid WAITING caller by FIFO.
  select c.id, c.queue_sequence into v_next_id, v_next_seq
  from public.call_requests c
  where c.branch_id = v_branch.id and c.status = 'WAITING'
  order by c.queue_sequence asc
  limit 1
  for update;

  if v_next_id is null then
    -- No waiting caller: do not hold the current call. Clean result.
    return query
      select v_active.id::uuid, null::uuid, null::bigint,
             v_active.status, null::public.call_status;
    return;
  end if;

  update public.call_requests c
  set status = 'ON_HOLD', held_at = now(), version = c.version + 1
  where c.id = v_active.id;
  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_active.id,
    'CALL_HELD', 'ACTIVE', 'ON_HOLD', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  update public.call_requests c
  set status = 'ACTIVE', answered_at = now(),
      active_staff_user_id = p_actor_user_id, version = c.version + 1
  where c.id = v_next_id;
  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_next_id,
    'CALL_ANSWERED', 'WAITING', 'ACTIVE', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  return query
    select v_active.id::uuid, v_next_id, v_next_seq,
           'ON_HOLD'::public.call_status, 'ACTIVE'::public.call_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: resume_call (ON_HOLD -> ACTIVE). Requires empty ACTIVE slot.
-- ---------------------------------------------------------------------------
create or replace function public.resume_call(
  p_branch_id uuid,
  p_call_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns table (call_id uuid, status public.call_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_call public.call_requests%rowtype;
begin
  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;
  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  if exists (
    select 1 from public.call_requests c
    where c.branch_id = v_branch.id and c.status = 'ACTIVE'
  ) then
    raise exception using errcode = 'P2ACE', message = 'ACTIVE_CALL_EXISTS';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_call.status <> 'ON_HOLD' then
    raise exception using errcode = 'P2CNH', message = 'CALL_NOT_HELD';
  end if;

  update public.call_requests c
  set status = 'ACTIVE', answered_at = now(),
      active_staff_user_id = p_actor_user_id, version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_call.id,
    'CALL_RESUMED', 'ON_HOLD', 'ACTIVE', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  return query select v_call.id, 'ACTIVE'::public.call_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: end_call (ACTIVE or ON_HOLD -> ENDED).
-- ---------------------------------------------------------------------------
create or replace function public.end_call(
  p_branch_id uuid,
  p_call_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid default null
)
returns table (call_id uuid, status public.call_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_call public.call_requests%rowtype;
  v_from public.call_status;
begin
  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;

  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_call.status not in ('ACTIVE', 'ON_HOLD') then
    raise exception using errcode = 'P2CNW', message = 'CALL_NOT_WAITING';
  end if;

  v_from := v_call.status;
  update public.call_requests c
  set status = 'ENDED', ended_at = now(),
      active_staff_user_id = null, version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_call.id,
    'CALL_ENDED', v_from, 'ENDED', 'STAFF', p_actor_user_id,
    p_command_id, '{}'::jsonb
  );

  return query select v_call.id, 'ENDED'::public.call_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: cancel_waiting_call (customer, anonymous). Own WAITING only.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_waiting_call(
  p_branch_id uuid,
  p_call_id uuid,
  p_visitor_identifier text,
  p_command_id uuid default null
)
returns table (call_id uuid, status public.call_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_requests%rowtype;
  v_visitor uuid;
begin
  if p_visitor_identifier is null or char_length(p_visitor_identifier) < 32 then
    raise exception using errcode = 'P2VIS', message = 'INVALID_VISITOR';
  end if;

  select id into v_visitor from public.visitors
  where anonymous_identifier = p_visitor_identifier;
  if not found then
    raise exception using errcode = 'P2VIS', message = 'INVALID_VISITOR';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.visitor_id = v_visitor
  for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;
  if v_call.status <> 'WAITING' then
    raise exception using errcode = 'P2CNW', message = 'CALL_NOT_WAITING';
  end if;

  update public.call_requests c
  set status = 'CANCELLED', cancelled_at = now(), version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_call.tenant_id, v_call.branch_id, v_call.id,
    'CALL_CANCELLED', 'WAITING', 'CANCELLED', 'VISITOR', null,
    p_command_id, '{}'::jsonb
  );

  return query select v_call.id, 'CANCELLED'::public.call_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Command: update_car_description. Two actors: customer (own unresolved call,
-- by visitor token) or staff (authorized branch).
-- ---------------------------------------------------------------------------
create or replace function public.update_car_description(
  p_branch_id uuid,
  p_call_id uuid,
  p_car_description text,
  p_actor_user_id uuid default null,
  p_visitor_identifier text default null,
  p_command_id uuid default null
)
returns table (call_id uuid, car_description text, event_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_call public.call_requests%rowtype;
  v_desc text;
  v_event text;
begin
  v_desc := private.car_description_normalized(p_car_description);

  select branch.* into v_branch from public.branches branch
  where branch.id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;

  select c.* into v_call from public.call_requests c
  where c.id = p_call_id and c.branch_id = v_branch.id for update;
  if not found then
    raise exception using errcode = 'P2CNF', message = 'CALL_NOT_FOUND';
  end if;

  if p_actor_user_id is not null then
    -- Staff edit.
    if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
      raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
    end if;
    v_event := 'CAR_DESCRIPTION_UPDATED_BY_STAFF';
  elsif p_visitor_identifier is not null then
    -- Customer edit: only own call, only while unresolved.
    if not exists (
      select 1 from public.visitors v
      where v.anonymous_identifier = p_visitor_identifier and v.id = v_call.visitor_id
    ) then
      raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
    end if;
    if v_call.status not in ('WAITING', 'ACTIVE', 'ON_HOLD') then
      raise exception using errcode = 'P2CNW', message = 'CALL_NOT_WAITING';
    end if;
    v_event := 'CAR_DESCRIPTION_UPDATED_BY_CUSTOMER';
  else
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  update public.call_requests c
  set car_description = v_desc, version = c.version + 1
  where c.id = v_call.id;

  perform private.append_call_event(
    v_branch.tenant_id, v_branch.id, v_call.id,
    v_event, null, null,
    case when p_actor_user_id is not null then 'STAFF'::public.call_actor_type
         else 'VISITOR'::public.call_actor_type end,
    p_actor_user_id, p_command_id,
    jsonb_build_object('car_description', v_desc)
  );

  return query select v_call.id, v_desc, v_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read API: customer's own unresolved call for a branch (by visitor token).
-- ---------------------------------------------------------------------------
create or replace function public.get_customer_current_call(
  p_branch_slug text,
  p_visitor_identifier text
)
returns table (
  call_id uuid,
  status public.call_status,
  queue_sequence bigint,
  queue_position bigint,
  branch_id uuid,
  tenant_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_visitor uuid;
begin
  if p_visitor_identifier is null or char_length(p_visitor_identifier) < 32 then
    raise exception using errcode = 'P2VIS', message = 'INVALID_VISITOR';
  end if;

  select branch.id into v_branch from public.branches branch
  where branch.slug = p_branch_slug and branch.enabled;
  if not found then
    return;
  end if;

  select vis.id into v_visitor from public.visitors vis
  where vis.anonymous_identifier = p_visitor_identifier;
  if not found then
    return;
  end if;

  return query
    select c.id, c.status, c.queue_sequence,
           private.position_of_waiting(c.branch_id, c.id),
           c.branch_id, c.tenant_id
    from public.call_requests c
    where c.branch_id = v_branch and c.visitor_id = v_visitor
      and c.status in ('WAITING', 'ACTIVE', 'ON_HOLD')
    limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read API: staff branch state (ACTIVE, ON_HOLD, WAITING FIFO ordered).
-- ---------------------------------------------------------------------------
create or replace function public.get_branch_queue(
  p_branch_id uuid,
  p_actor_user_id uuid
)
returns table (
  active_call_id uuid,
  on_hold_call_id uuid,
  waiting_calls jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
begin
  select branch.* into v_branch from public.branches branch where branch.id = p_branch_id;
  if not found then
    raise exception using errcode = 'P2BRN', message = 'BRANCH_NOT_FOUND';
  end if;
  if not private.user_can_operate_branch(p_actor_user_id, v_branch.tenant_id, v_branch.id) then
    raise exception using errcode = 'P2UNA', message = 'UNAUTHORIZED';
  end if;

  return query
    select
      (select c.id from public.call_requests c where c.branch_id = v_branch.id and c.status = 'ACTIVE' limit 1),
      (select c.id from public.call_requests c where c.branch_id = v_branch.id and c.status = 'ON_HOLD' limit 1),
      (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'call_id', c.id,
            'queue_sequence', c.queue_sequence,
            'car_description', c.car_description,
            'created_at', c.created_at
          ) order by c.queue_sequence asc
        ), '[]'::jsonb)
        from public.call_requests c
        where c.branch_id = v_branch.id and c.status = 'WAITING'
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- Stale WAITING expiration (internal cleanup, no scheduler deployed yet).
-- Cancels WAITING requests older than the given threshold. Never touches
-- ACTIVE or ON_HOLD. Records STALE_TIMEOUT. Returns count cancelled.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_waiting_calls(
  p_older_than interval default interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_call record;
begin
  for v_call in
    select c.id, c.tenant_id, c.branch_id
    from public.call_requests c
    where c.status = 'WAITING'
      and c.queued_at < (now() - coalesce(p_older_than, interval '10 minutes'))
    for update skip locked
  loop
    update public.call_requests c
    set status = 'CANCELLED', cancelled_at = now(), version = c.version + 1
    where c.id = v_call.id;

    perform private.append_call_event(
      v_call.tenant_id, v_call.branch_id, v_call.id,
      'STALE_TIMEOUT', 'WAITING', 'CANCELLED', 'SYSTEM', null,
      null, jsonb_build_object('reason', 'stale_timeout')
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Narrow command surface; expiry is authenticated-only (server/scheduler).
-- ---------------------------------------------------------------------------
revoke all on function public.enqueue_call(text,text,text,uuid) from public;
revoke all on function public.cancel_waiting_call(uuid,uuid,text,uuid) from public;
revoke all on function public.update_car_description(uuid,uuid,text,uuid,text,uuid) from public;
revoke all on function public.get_customer_current_call(text,text) from public;
revoke all on function public.expire_stale_waiting_calls(interval) from public;

grant execute on function public.enqueue_call(text,text,text,uuid) to anon, authenticated;
grant execute on function public.cancel_waiting_call(uuid,uuid,text,uuid) to anon, authenticated;
grant execute on function public.update_car_description(uuid,uuid,text,uuid,text,uuid) to anon, authenticated;
grant execute on function public.get_customer_current_call(text,text) to anon, authenticated;
grant execute on function public.expire_stale_waiting_calls(interval) to authenticated;

grant execute on function public.answer_call(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.hold_call(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.hold_and_answer_next(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.resume_call(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.end_call(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.get_branch_queue(uuid,uuid) to authenticated;
