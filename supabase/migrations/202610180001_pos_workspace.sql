-- Run once in Supabase SQL Editor. All statements are transactional and safe to rerun.
-- One POS workspace per Supabase Auth account, shared across that account's devices.
begin;
create table if not exists public.pos_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"menu":[],"orders":[],"closings":[]}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint pos_workspace_shape check (
    jsonb_typeof(data)='object' and
    jsonb_typeof(data->'menu')='array' and
    jsonb_typeof(data->'orders')='array' and
    jsonb_typeof(data->'closings')='array'
  )
);
alter table public.pos_workspaces enable row level security;
revoke all on public.pos_workspaces from anon, authenticated;
grant select on public.pos_workspaces to authenticated;
drop policy if exists pos_workspace_read_own on public.pos_workspaces;
create policy pos_workspace_read_own on public.pos_workspaces for select to authenticated
  using ((select auth.uid())=owner_id);

create or replace function public.pos_read_workspace()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('data',w.data,'revision',w.revision,'updated_at',w.updated_at)
  from public.pos_workspaces w where w.owner_id=(select auth.uid());
$$;

-- Atomic compare-and-swap protects against concurrent devices and retry duplicates.
-- Only this RPC can write: neither anon nor authenticated clients have direct write grants.
create or replace function public.pos_save_workspace(expected_revision bigint,next_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  user_id uuid := auth.uid();
  current_row public.pos_workspaces%rowtype;
  order_data jsonb; old_order jsonb; item jsonb; closing jsonb; old_closing jsonb;
  seen text[]; identity text; paid_count integer; revenue numeric;
  normalized_closings jsonb := '[]'::jsonb;
  stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if expected_revision is null or expected_revision<0 then
    raise exception 'Invalid revision' using errcode='23514';
  end if;
  if next_data is null or jsonb_typeof(next_data) is distinct from 'object'
    or jsonb_typeof(next_data->'menu') is distinct from 'array'
    or jsonb_typeof(next_data->'orders') is distinct from 'array'
    or jsonb_typeof(next_data->'closings') is distinct from 'array' then
    raise exception 'Invalid workspace shape' using errcode='23514';
  end if;
  insert into public.pos_workspaces(owner_id) values(user_id) on conflict do nothing;
  select * into strict current_row from public.pos_workspaces where owner_id=user_id for update;
  if current_row.revision<>expected_revision then
    raise exception 'Workspace changed; fetch and merge again' using errcode='40001';
  end if;
  seen := array[]::text[];
  for item in select value from jsonb_array_elements(next_data->'menu') loop
    identity:=item->>'id';
    if coalesce(identity,'')='' or identity=any(seen) or length(coalesce(item->>'name','')) not between 1 and 100
      or coalesce(item->>'category','')='' or jsonb_typeof(item->'price') is distinct from 'number'
      or (item->>'price')::numeric not between 1000 and 10000000 then
      raise exception 'Invalid menu item' using errcode='23514';
    end if;
    seen:=array_append(seen,identity);
  end loop;
  seen:=array[]::text[];
  for order_data in select value from jsonb_array_elements(next_data->'orders') loop
    identity:=order_data->>'id';
    if coalesce(identity,'')='' or identity=any(seen)
      or coalesce(order_data->>'status','') not in ('open','paid')
      or coalesce(order_data->>'day','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(order_data->>'shift','') not in ('1','2','3')
      or coalesce(order_data->>'code','')='' or coalesce(order_data->>'created','')=''
      or length(coalesce(order_data->>'label','')) not between 1 and 160
      or jsonb_typeof(order_data->'items') is distinct from 'array' then
      raise exception 'Invalid order' using errcode='23514';
    end if;
    if jsonb_array_length(order_data->'items')=0 then
      raise exception 'An order must have items' using errcode='23514';
    end if;
    if order_data->>'status'='paid' and (
      coalesce(order_data->>'paidAt','')='' or (
        order_data ? 'paymentMethod' and coalesce(order_data->>'paymentMethod','') not in ('cash','transfer')
      )
    ) then raise exception 'Invalid payment' using errcode='23514'; end if;
    for item in select value from jsonb_array_elements(order_data->'items') loop
      if coalesce(item->>'id','')='' or length(coalesce(item->>'name','')) not between 1 and 100
        or jsonb_typeof(item->'price') is distinct from 'number'
        or jsonb_typeof(item->'qty') is distinct from 'number'
        or (item->>'price')::numeric not between 1000 and 10000000
        or (item->>'qty')::numeric not between 1 and 100000
        or trunc((item->>'qty')::numeric)<>(item->>'qty')::numeric then
        raise exception 'Invalid order item' using errcode='23514';
      end if;
    end loop;
    select value into old_order from jsonb_array_elements(current_row.data->'orders') where value->>'id'=identity;
    if old_order is not null then
      if old_order->>'status'='open' and order_data->>'status'='paid' and coalesce(order_data->>'paymentMethod','') not in ('cash','transfer') then
        raise exception 'Select a payment method' using errcode='23514';
      end if;
      if old_order->>'code' is distinct from order_data->>'code'
        or old_order->>'created' is distinct from order_data->>'created'
        or old_order->>'day' is distinct from order_data->>'day'
        or old_order->>'shift' is distinct from order_data->>'shift'
        or (old_order->>'status'='paid' and (
          old_order->>'status' is distinct from order_data->>'status'
          or old_order->>'paidAt' is distinct from order_data->>'paidAt'
          or old_order->>'paymentMethod' is distinct from order_data->>'paymentMethod'
        )) then raise exception 'Order metadata cannot change' using errcode='23514'; end if;
    elsif exists(select 1 from jsonb_array_elements(current_row.data->'closings') c
      where c->>'day'=order_data->>'day' and c->>'shift'=order_data->>'shift') then
      raise exception 'Cannot add order to a closed shift' using errcode='23514';
    end if;
    seen:=array_append(seen,identity);
  end loop;
  if exists(select 1 from jsonb_array_elements(current_row.data->'orders') o where not (o->>'id'=any(seen))) then
    raise exception 'Existing orders cannot be removed' using errcode='23514';
  end if;
  seen:=array[]::text[];
  for closing in select value from jsonb_array_elements(next_data->'closings') loop
    identity:=(closing->>'day')||':'||(closing->>'shift');
    if identity is null or identity=any(seen) or coalesce(closing->>'day','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(closing->>'shift','') not in ('1','2','3') or coalesce(closing->>'at','')='' then
      raise exception 'Invalid closing' using errcode='23514';
    end if;
    if exists(select 1 from jsonb_array_elements(next_data->'orders') o
      where o->>'day'=closing->>'day' and o->>'shift'=closing->>'shift' and o->>'status'<>'paid') then
      raise exception 'Cannot close shift with unpaid orders' using errcode='23514';
    end if;
    select count(*) into paid_count from jsonb_array_elements(next_data->'orders') o
      where o->>'day'=closing->>'day' and o->>'shift'=closing->>'shift' and o->>'status'='paid';
    select coalesce(sum((i->>'price')::numeric*(i->>'qty')::numeric),0) into revenue
      from jsonb_array_elements(next_data->'orders') o cross join lateral jsonb_array_elements(o->'items') i
      where o->>'day'=closing->>'day' and o->>'shift'=closing->>'shift' and o->>'status'='paid';
    select value into old_closing from jsonb_array_elements(current_row.data->'closings') c
      where c->>'day'=closing->>'day' and c->>'shift'=closing->>'shift';
    if old_closing is not null then
      closing:=jsonb_set(closing,'{at}',old_closing->'at');
      if (old_closing->>'revenue')::numeric<>revenue then
        closing:=closing||jsonb_build_object('originalRevenue',coalesce(old_closing->'originalRevenue',old_closing->'revenue'),'updatedAt',stamp);
      end if;
    end if;
    closing:=closing||jsonb_build_object('revenue',revenue,'count',paid_count);
    normalized_closings:=normalized_closings||jsonb_build_array(closing);
    seen:=array_append(seen,identity);
  end loop;
  if exists(select 1 from jsonb_array_elements(current_row.data->'closings') c
    where not ((c->>'day')||':'||(c->>'shift')=any(seen))) then
    raise exception 'Existing closings cannot be removed' using errcode='23514';
  end if;
  next_data:=jsonb_build_object('menu',next_data->'menu','orders',next_data->'orders','closings',normalized_closings);
  update public.pos_workspaces set data=next_data,revision=revision+1,updated_at=now()
    where owner_id=user_id returning * into current_row;
  return jsonb_build_object('data',current_row.data,'revision',current_row.revision,'updated_at',current_row.updated_at);
end;
$$;
revoke all on function public.pos_read_workspace() from public, anon;
revoke all on function public.pos_save_workspace(bigint,jsonb) from public, anon;
grant execute on function public.pos_read_workspace() to authenticated;
grant execute on function public.pos_save_workspace(bigint,jsonb) to authenticated;
commit;
