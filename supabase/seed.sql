insert into public.tenants (id, name, status)
values (
  '10000000-0000-4000-8000-000000000001',
  'حياك كوفي',
  'ACTIVE'
)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status;

insert into public.branches (
  id,
  tenant_id,
  name,
  slug,
  service_radius_meters,
  enabled
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'الفرع التجريبي',
  'hayyak-demo',
  200,
  true
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  slug = excluded.slug,
  service_radius_meters = excluded.service_radius_meters,
  enabled = excluded.enabled;

