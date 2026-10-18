-- Run the entire file AFTER 202610180001_pos_workspace.sql. Preserves all legacy data.
begin;
create table if not exists public.pos_shops (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text not null default 'Lam An',
 data jsonb not null default '{"menu":[],"orders":[],"closings":[]}',revision bigint not null default 0,updated_at timestamptz not null default now()
);
create table if not exists public.pos_members (
 user_id uuid primary key references auth.users(id),shop_id uuid not null references public.pos_shops(id),email text not null,
 display_name text not null default '',role text not null check(role in ('admin','staff')),active boolean not null default true
);
create table if not exists public.pos_assignments (
 shop_id uuid not null references public.pos_shops(id),user_id uuid not null references public.pos_members(user_id),day date not null,
 shift smallint not null check(shift between 1 and 3),primary key(shop_id,user_id,day,shift)
);
create table if not exists public.pos_audit (
 id uuid primary key default gen_random_uuid(),shop_id uuid not null references public.pos_shops(id),actor_id uuid references auth.users(id),actor_email text,
 action text not null,target_id text,reason text not null default '',before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
create index if not exists pos_audit_shop_time on public.pos_audit(shop_id,created_at desc);
create table if not exists public.pos_proposals (
 id uuid primary key default gen_random_uuid(),shop_id uuid not null references public.pos_shops(id),submitted_by uuid not null references auth.users(id),
 email text not null,payload jsonb not null,reason text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),reviewed_by uuid references auth.users(id),reviewed_at timestamptz
);
alter table public.pos_shops enable row level security;
alter table public.pos_members enable row level security;
alter table public.pos_assignments enable row level security;
alter table public.pos_audit enable row level security;
alter table public.pos_proposals enable row level security;
revoke all on public.pos_shops,public.pos_members,public.pos_assignments,public.pos_audit,public.pos_proposals from anon,authenticated;
-- Snapshot tables must not be directly readable: staff read filtered views through the RPC only.
revoke all on public.pos_workspaces from authenticated,anon;

create or replace function public.pos_is_admin(shop uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.pos_members m where m.shop_id=shop and m.user_id=auth.uid() and m.active and m.role='admin');
$$;
create or replace function public.pos_can_shift(shop uuid,d date,s integer) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.pos_members m where m.shop_id=shop and m.user_id=auth.uid() and m.active and
 (m.role='admin' or exists(select 1 from public.pos_assignments a where a.shop_id=shop and a.user_id=m.user_id and a.day=d and a.shift=s)));
$$;
create or replace function public.pos_order_total(o jsonb) returns numeric language sql immutable set search_path=public,pg_temp as $$
 select coalesce(sum((i->>'price')::numeric*(i->>'qty')::numeric),0) from jsonb_array_elements(o->'items') i;
$$;
create or replace function public.pos_order_business(o jsonb) returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select o-array['revisions','updatedAt','updatedBy','updatedByEmail','createdBy','createdByEmail','paidBy','paidByEmail','cancelledBy','cancelledByEmail','cancelledAt','refundAmount','paymentTotals'];
$$;
-- Provisioning only, deliberately NOT executable by authenticated clients. Run in SQL Editor.
create or replace function public.pos_bootstrap_shop(admin_email text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; shop uuid; legacy jsonb;
begin
 select id into u from auth.users where lower(email)=lower(btrim(admin_email));
 if u is null then raise exception 'Create the admin in Authentication > Users first';end if;
 select shop_id into shop from public.pos_members where user_id=u;
 if shop is not null then return shop;end if;
 if exists(select 1 from public.pos_shops) then raise exception 'A shop exists; add members through its admin';end if;
 select data into legacy from public.pos_workspaces where owner_id=u;
 insert into public.pos_shops(owner_id,data) values(u,coalesce(legacy,'{"menu":[],"orders":[],"closings":[]}')) returning id into shop;
 insert into public.pos_members(user_id,shop_id,email,role) values(u,shop,lower(btrim(admin_email)),'admin');
 insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id) values(shop,u,admin_email,'shop.bootstrap',shop::text);
 return shop;
end;$$;
revoke all on function public.pos_bootstrap_shop(text) from public,anon,authenticated;

create or replace function public.pos_read_workspace() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype; w public.pos_shops%rowtype; result jsonb; assigned jsonb; members jsonb; proposals jsonb;
begin
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null then raise exception 'Tài khoản chưa được phân quyền hoặc đã bị khóa' using errcode='42501';end if;
 select * into strict w from public.pos_shops where id=m.shop_id;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.day desc,a.shift),'[]') into assigned from public.pos_assignments a where a.shop_id=m.shop_id and (m.role='admin' or a.user_id=m.user_id);
 result:=w.data;
 if m.role<>'admin' then
  result:=jsonb_build_object('menu',w.data->'menu',
   'orders',coalesce((select jsonb_agg(o) from jsonb_array_elements(w.data->'orders') o where public.pos_can_shift(w.id,(o->>'day')::date,(o->>'shift')::int)),'[]'),
   'closings',coalesce((select jsonb_agg(c) from jsonb_array_elements(w.data->'closings') c where public.pos_can_shift(w.id,(c->>'day')::date,(c->>'shift')::int)),'[]'));
 end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into proposals from public.pos_proposals p where p.shop_id=m.shop_id and (m.role='admin' or p.submitted_by=m.user_id);
 if m.role='admin' then select coalesce(jsonb_agg(to_jsonb(n) order by n.email),'[]') into members from public.pos_members n where n.shop_id=m.shop_id;else members:='[]';end if;
 return jsonb_build_object('data',result,'revision',w.revision,'updated_at',w.updated_at,'access',jsonb_build_object('shopId',w.id,'shopName',w.name,'userId',m.user_id,'email',m.email,'role',m.role,'assignments',assigned,'members',members,'proposals',proposals));
end;$$;
create or replace function public.pos_save_workspace(expected_revision bigint,next_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  user_id uuid := auth.uid();
  current_row public.pos_shops%rowtype;
  member public.pos_members%rowtype; merged_orders jsonb; normalized_orders jsonb := '[]'; actor_email text; previous_total numeric; next_total numeric; event_action text;
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
  select * into member from public.pos_members pm where pm.user_id=auth.uid() and pm.active;
  if member.user_id is null then raise exception 'Tài khoản chưa được phân quyền hoặc đã bị khóa' using errcode='42501'; end if;
  actor_email:=member.email;
  select * into strict current_row from public.pos_shops where id=member.shop_id for update;
  select * into member from public.pos_members pm where pm.user_id=auth.uid() and pm.active;
  if member.user_id is null then raise exception 'Tài khoản đã bị khóa' using errcode='42501';end if;
  if member.role<>'admin' then
    if next_data->'menu'<>current_row.data->'menu' then raise exception 'Chỉ admin được sửa menu' using errcode='42501'; end if;
    if exists(select 1 from jsonb_array_elements(next_data->'orders') o where not public.pos_can_shift(member.shop_id,(o->>'day')::date,(o->>'shift')::int))
      or exists(select 1 from jsonb_array_elements(next_data->'closings') c where not public.pos_can_shift(member.shop_id,(c->>'day')::date,(c->>'shift')::int)) then
      raise exception 'Không có quyền trên ca này' using errcode='42501';
    end if;
    select coalesce(jsonb_agg(o),'[]') into merged_orders from jsonb_array_elements(current_row.data->'orders') o where not public.pos_can_shift(member.shop_id,(o->>'day')::date,(o->>'shift')::int);
    next_data:=jsonb_set(next_data,'{orders}',merged_orders||(next_data->'orders'));
    select coalesce(jsonb_agg(c),'[]') into merged_orders from jsonb_array_elements(current_row.data->'closings') c where not public.pos_can_shift(member.shop_id,(c->>'day')::date,(c->>'shift')::int);
    next_data:=jsonb_set(next_data,'{closings}',merged_orders||(next_data->'closings'));
  end if;
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
      or coalesce(order_data->>'status','') not in ('open','paid','cancelled')
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
          (order_data->>'status' not in ('paid','cancelled'))
          or old_order->>'paidAt' is distinct from order_data->>'paidAt'
          or old_order->>'paymentMethod' is distinct from order_data->>'paymentMethod'
        )) then raise exception 'Order metadata cannot change' using errcode='23514'; end if;
    elsif exists(select 1 from jsonb_array_elements(current_row.data->'closings') c
      where c->>'day'=order_data->>'day' and c->>'shift'=order_data->>'shift') then
      raise exception 'Cannot add order to a closed shift' using errcode='23514';
    end if;
    if old_order is not null and old_order->>'status'='cancelled' and public.pos_order_business(old_order)<>public.pos_order_business(order_data) then
      raise exception 'Đơn đã hủy không được sửa' using errcode='23514';
    end if;
    if old_order is null or public.pos_order_business(old_order)<>public.pos_order_business(order_data) then
      event_action:=case when old_order is null then 'order.create' when order_data->>'status'='cancelled' then 'order.cancel' when old_order->>'status'='open' and order_data->>'status'='paid' then 'order.pay' else 'order.edit' end;
      if old_order is null and order_data->>'status'='cancelled' then raise exception 'Không tạo mới đơn hủy' using errcode='23514'; end if;
      if event_action='order.cancel' then
        if order_data->'items' is distinct from old_order->'items' then raise exception 'Không đổi món khi hủy đơn' using errcode='23514';end if;
        if length(btrim(coalesce(order_data->>'cancelReason','')))<3 then raise exception 'Cần lý do hủy đơn' using errcode='23514'; end if;
        if old_order->>'status'='paid' then
          if member.role<>'admin' then raise exception 'Nhân viên không được hủy đơn đã thanh toán' using errcode='42501'; end if;
          if order_data->>'refundConfirmed' is distinct from 'true' then raise exception 'Cần xác nhận hoàn tiền' using errcode='23514'; end if;
          order_data:=order_data||jsonb_build_object('refundAmount',public.pos_order_total(old_order));
        end if;
        order_data:=order_data||jsonb_build_object('cancelledAt',stamp,'cancelledBy',user_id,'cancelledByEmail',actor_email);
      elsif old_order->>'status'='paid' then
        if length(btrim(coalesce(order_data->>'editReason','')))<3 then raise exception 'Cần lý do sửa đơn đã thanh toán' using errcode='23514'; end if;
        previous_total:=public.pos_order_total(old_order); next_total:=public.pos_order_total(order_data);
        if previous_total<>next_total and (
          order_data#>>'{settlement,confirmed}' is distinct from 'true'
          or coalesce(order_data#>>'{settlement,amount}','0')::numeric<>abs(next_total-previous_total)
          or coalesce(order_data#>>'{settlement,method}','') not in ('cash','transfer')
          or coalesce(order_data#>>'{settlement,kind}','')<>case when next_total>previous_total then 'collect' else 'refund' end
        ) then raise exception 'Cần ghi nhận thu thêm hoặc hoàn tiền chênh lệch' using errcode='23514'; end if;
      end if;
      if order_data->>'status'='paid' then
        if old_order is null or old_order->>'status'='open' then
          order_data:=order_data||jsonb_build_object('paymentTotals',jsonb_build_object('cash',case when order_data->>'paymentMethod'='cash' then public.pos_order_total(order_data) else 0 end,'transfer',case when order_data->>'paymentMethod'='transfer' then public.pos_order_total(order_data) else 0 end,'unknown',case when coalesce(order_data->>'paymentMethod','') not in ('cash','transfer') then public.pos_order_total(order_data) else 0 end));
        else
          item:=coalesce(old_order->'paymentTotals',jsonb_build_object('cash',case when old_order->>'paymentMethod'='cash' then public.pos_order_total(old_order) else 0 end,'transfer',case when old_order->>'paymentMethod'='transfer' then public.pos_order_total(old_order) else 0 end,'unknown',case when coalesce(old_order->>'paymentMethod','') not in ('cash','transfer') then public.pos_order_total(old_order) else 0 end));
          if next_total<>previous_total then item:=jsonb_set(item,array[order_data#>>'{settlement,method}'],to_jsonb(coalesce((item->>(order_data#>>'{settlement,method}'))::numeric,0)+next_total-previous_total));end if;
          order_data:=order_data||jsonb_build_object('paymentTotals',item);
        end if;
      end if;
      if old_order is null then
        order_data:=(order_data-array['revisions','createdBy','createdByEmail','updatedBy','updatedByEmail','paidBy','paidByEmail'])||jsonb_build_object('createdBy',user_id,'createdByEmail',actor_email);
      else
        order_data:=order_data||jsonb_build_object('createdBy',old_order->'createdBy','createdByEmail',old_order->'createdByEmail','updatedBy',user_id,'updatedByEmail',actor_email,'updatedAt',stamp,
          'revisions',coalesce(old_order->'revisions','[]')||jsonb_build_array(jsonb_build_object('at',stamp,'actorId',user_id,'actorEmail',actor_email,'reason',coalesce(order_data->>'editReason',order_data->>'cancelReason',''),'before',old_order-'revisions')));
      end if;
      if order_data->>'status'='paid' and (old_order is null or old_order->>'status'='open') then
        order_data:=order_data||jsonb_build_object('paidBy',user_id,'paidByEmail',actor_email);
      elsif old_order is not null then
        order_data:=order_data||jsonb_build_object('paidBy',old_order->'paidBy','paidByEmail',old_order->'paidByEmail');
      end if;
      insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,reason,before_data,after_data)
        values(member.shop_id,user_id,actor_email,event_action,identity,coalesce(order_data->>'cancelReason',order_data->>'editReason',''),old_order,order_data);
    else order_data:=old_order;
    end if;
    normalized_orders:=normalized_orders||jsonb_build_array(order_data);
    seen:=array_append(seen,identity);
  end loop;
  next_data:=jsonb_set(next_data,'{orders}',normalized_orders);
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
      where o->>'day'=closing->>'day' and o->>'shift'=closing->>'shift' and o->>'status'='open') then
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
      if (closing-array['revenue','count','updatedAt','originalRevenue','expectedCash','discrepancy']) is distinct from (old_closing-array['revenue','count','updatedAt','originalRevenue','expectedCash','discrepancy']) then
        raise exception 'Dùng chức năng điều chỉnh ca đã kết' using errcode='42501';
      end if;
      closing:=old_closing;
      revenue:=revenue+coalesce((select sum((a->>'amount')::numeric) from jsonb_array_elements(coalesce(closing->'adjustments','[]')) a),0);
    else
      if jsonb_typeof(closing->'actualCash') is distinct from 'number' or (closing->>'actualCash')::numeric<0 then raise exception 'Cần số tiền mặt thực đếm' using errcode='23514'; end if;
      closing:=(closing-array['adjustments','closedBy','closedByEmail','originalRevenue','updatedAt','expectedCash','discrepancy'])||jsonb_build_object('closedBy',user_id,'closedByEmail',actor_email,'adjustments','[]'::jsonb);
    end if;
    select coalesce(sum(coalesce((o#>>'{paymentTotals,cash}')::numeric,case when o->>'paymentMethod'='cash' then public.pos_order_total(o) else 0 end)),0) into next_total from jsonb_array_elements(next_data->'orders') o where o->>'day'=closing->>'day' and o->>'shift'=closing->>'shift' and o->>'status'='paid';
    next_total:=next_total+coalesce((select sum((a->>'amount')::numeric) from jsonb_array_elements(coalesce(closing->'adjustments','[]')) a where a->>'method'='cash'),0);
    closing:=closing||jsonb_build_object('expectedCash',next_total,'discrepancy',(closing->>'actualCash')::numeric-next_total);
    if old_closing is null then
      if (closing->>'actualCash')::numeric<>next_total and length(btrim(coalesce(closing->>'note','')))<3 then raise exception 'Cần ghi chú chênh lệch tiền mặt' using errcode='23514'; end if;
      insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,reason,after_data) values(member.shop_id,user_id,actor_email,'shift.close',identity,coalesce(closing->>'note',''),closing||jsonb_build_object('revenue',revenue,'count',paid_count));
    end if;
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
  if current_row.data->'menu'<>next_data->'menu' then
    insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,before_data,after_data) values(member.shop_id,user_id,actor_email,'menu.update','menu',current_row.data->'menu',next_data->'menu');
  end if;
  update public.pos_shops set data=next_data,revision=revision+1,updated_at=now()
    where id=member.shop_id returning * into current_row;
  return public.pos_read_workspace();
end;
$$;

create or replace function public.pos_manage(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype; target public.pos_members%rowtype; u uuid; proposal public.pos_proposals%rowtype; w public.pos_shops%rowtype; c jsonb; new_c jsonb; updated jsonb; amount numeric;
begin
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null then raise exception 'Tài khoản chưa được phân quyền hoặc đã bị khóa' using errcode='42501';end if;
 select * into strict w from public.pos_shops where id=m.shop_id for update;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null then raise exception 'Tài khoản đã bị khóa' using errcode='42501';end if;
 if action='proposal.submit' then
  if length(btrim(coalesce(pos_manage.payload->>'reason','')))<3 or length(btrim(coalesce(pos_manage.payload#>>'{item,name}','')))<1 or coalesce(pos_manage.payload#>>'{item,category}','')='' or coalesce(pos_manage.payload#>>'{item,price}','0')::numeric not between 1000 and 10000000 then raise exception 'Kiểm tra nội dung đề xuất' using errcode='23514';end if;
  insert into public.pos_proposals(shop_id,submitted_by,email,payload,reason) values(m.shop_id,m.user_id,m.email,pos_manage.payload->'item',pos_manage.payload->>'reason');
 else
  if m.role<>'admin' then raise exception 'Chỉ admin được thực hiện' using errcode='42501';end if;
  case action
  when 'member.add' then
   select id into u from auth.users where lower(email)=lower(btrim(pos_manage.payload->>'email'));
   if u is null then raise exception 'Email chưa có tài khoản. Dùng Tạo tài khoản mới hoặc tạo trong Supabase Authentication trước.' using errcode='23514';end if;
   if exists(select 1 from public.pos_members where user_id=u and shop_id<>m.shop_id) then raise exception 'Tài khoản đã thuộc quán khác' using errcode='42501';end if;
   if coalesce(pos_manage.payload->>'role','staff') not in ('admin','staff') then raise exception 'Vai trò không hợp lệ' using errcode='23514';end if;
   if u=w.owner_id and coalesce(pos_manage.payload->>'role','staff')<>'admin' then raise exception 'Không hạ quyền chủ quán' using errcode='42501';end if;
   insert into public.pos_members(user_id,shop_id,email,display_name,role) values(u,m.shop_id,lower(btrim(pos_manage.payload->>'email')),coalesce(pos_manage.payload->>'name',''),coalesce(pos_manage.payload->>'role','staff')) on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role;
  when 'member.update' then
   u:=(pos_manage.payload->>'userId')::uuid;
   select * into target from public.pos_members where user_id=u and shop_id=m.shop_id;
   if target.user_id is null then raise exception 'Không tìm thấy nhân viên' using errcode='23514';end if;
   if target.user_id=w.owner_id and (pos_manage.payload->>'role'<>'admin' or coalesce((pos_manage.payload->>'active')::boolean,true)=false) then raise exception 'Không khóa hoặc hạ quyền chủ quán' using errcode='42501';end if;
   if coalesce(pos_manage.payload->>'role',target.role) not in ('admin','staff') then raise exception 'Vai trò không hợp lệ' using errcode='23514';end if;
   update public.pos_members set role=coalesce(pos_manage.payload->>'role',role),active=coalesce((pos_manage.payload->>'active')::boolean,active),display_name=coalesce(pos_manage.payload->>'name',display_name) where user_id=u;
  when 'assignment.set' then
   u:=(pos_manage.payload->>'userId')::uuid;
   if not exists(select 1 from public.pos_members where user_id=u and shop_id=m.shop_id and active) then raise exception 'Nhân viên không hoạt động' using errcode='23514';end if;
   if coalesce((pos_manage.payload->>'enabled')::boolean,true) then
    insert into public.pos_assignments(shop_id,user_id,day,shift) values(m.shop_id,u,(pos_manage.payload->>'day')::date,(pos_manage.payload->>'shift')::smallint) on conflict do nothing;
   else delete from public.pos_assignments where shop_id=m.shop_id and user_id=u and day=(pos_manage.payload->>'day')::date and shift=(pos_manage.payload->>'shift')::smallint;end if;
  when 'proposal.review' then
   select * into proposal from public.pos_proposals where id=(pos_manage.payload->>'id')::uuid and shop_id=m.shop_id and status='pending' for update;
   if proposal.id is null then raise exception 'Đề xuất đã được xử lý hoặc không tồn tại' using errcode='23514';end if;
   if pos_manage.payload->>'decision' not in ('approved','rejected') then raise exception 'Quyết định không hợp lệ' using errcode='23514';end if;
   if pos_manage.payload->>'decision'='approved' then
    updated:=proposal.payload;
    if coalesce(updated->>'id','')='' then updated:=updated||jsonb_build_object('id',gen_random_uuid());end if;
    select coalesce(jsonb_agg(i),'[]') into new_c from jsonb_array_elements(w.data->'menu') i where i->>'id'<>updated->>'id';
    update public.pos_shops set data=jsonb_set(data,'{menu}',new_c||jsonb_build_array(updated)),revision=revision+1,updated_at=now() where id=m.shop_id;
   end if;
   update public.pos_proposals set status=pos_manage.payload->>'decision',reviewed_by=m.user_id,reviewed_at=now() where id=proposal.id;
  when 'shift.adjust' then
   if length(btrim(coalesce(pos_manage.payload->>'reason','')))<3 or coalesce(pos_manage.payload->>'method','') not in ('cash','transfer') then raise exception 'Cần phương thức và lý do điều chỉnh' using errcode='23514';end if;
   amount:=(pos_manage.payload->>'amount')::numeric;
   if amount is null or amount=0 or abs(amount)>1000000000 then raise exception 'Số điều chỉnh không hợp lệ' using errcode='23514';end if;
   select value into c from jsonb_array_elements(w.data->'closings') where value->>'day'=pos_manage.payload->>'day' and value->>'shift'=pos_manage.payload->>'shift';
   if c is null then raise exception 'Ca chưa được kết' using errcode='23514';end if;
   new_c:=c||jsonb_build_object('originalRevenue',coalesce(c->'originalRevenue',c->'revenue'),'revenue',(c->>'revenue')::numeric+amount,'updatedAt',now(),
    'adjustments',coalesce(c->'adjustments','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'amount',amount,'method',pos_manage.payload->>'method','reason',pos_manage.payload->>'reason','actorId',m.user_id,'actorEmail',m.email,'at',now())));
   if pos_manage.payload->>'method'='cash' then new_c:=new_c||jsonb_build_object('expectedCash',coalesce((c->>'expectedCash')::numeric,0)+amount,'discrepancy',coalesce((c->>'discrepancy')::numeric,0)-amount);end if;
   select jsonb_agg(case when value->>'day'=pos_manage.payload->>'day' and value->>'shift'=pos_manage.payload->>'shift' then new_c else value end) into updated from jsonb_array_elements(w.data->'closings');
   update public.pos_shops set data=jsonb_set(data,'{closings}',updated),revision=revision+1,updated_at=now() where id=m.shop_id;
  else raise exception 'Thao tác không hỗ trợ' using errcode='23514';
  end case;
 end if;
 insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,reason,before_data,after_data)
 values(m.shop_id,m.user_id,m.email,action,coalesce(pos_manage.payload->>'userId',pos_manage.payload->>'email',pos_manage.payload->>'id',pos_manage.payload->>'day'),coalesce(pos_manage.payload->>'reason',''),case when action='shift.adjust' then c else null end,payload);
 return public.pos_read_workspace();
end;$$;
create or replace function public.pos_list_audit() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype; result jsonb;
begin
 select * into m from public.pos_members where user_id=auth.uid() and active and role='admin';
 if m.user_id is null then raise exception 'Chỉ admin được xem nhật ký' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') into result from (select * from public.pos_audit where shop_id=m.shop_id order by created_at desc limit 500) a;
 return result;
end;$$;
revoke all on function public.pos_is_admin(uuid),public.pos_can_shift(uuid,date,integer),public.pos_order_total(jsonb),public.pos_order_business(jsonb),public.pos_read_workspace(),public.pos_save_workspace(bigint,jsonb),public.pos_manage(text,jsonb),public.pos_list_audit() from public,anon,authenticated;
grant execute on function public.pos_read_workspace(),public.pos_save_workspace(bigint,jsonb),public.pos_manage(text,jsonb),public.pos_list_audit() to authenticated;
commit;
-- Next, run in SQL Editor: select public.pos_bootstrap_shop('YOUR_ADMIN_EMAIL');
