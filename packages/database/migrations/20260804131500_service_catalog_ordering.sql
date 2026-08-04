begin;

alter table services
  add column if not exists sort_order integer;

with ranked as (
  select id,
         row_number() over (
           partition by tenant_id
           order by created_at asc, id asc
         ) - 1 as next_sort_order
  from services
)
update services as service
set sort_order = ranked.next_sort_order
from ranked
where service.id = ranked.id
  and service.sort_order is null;

update services
set sort_order = 0
where sort_order is null;

alter table services
  alter column sort_order set default 0,
  alter column sort_order set not null;

create index if not exists services_tenant_active_sort_order_idx
  on services (tenant_id, is_active, sort_order, created_at, id);

commit;
