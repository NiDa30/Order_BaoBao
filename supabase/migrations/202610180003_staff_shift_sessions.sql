-- Run the ENTIRE file after 002. Existing orders/closings are preserved.
begin;
create table if not exists public.pos_shift_sessions (
 shop_id uuid not null references public.pos_shops(id),day date not null,shift smallint not null check(shift between 1 and 3),
 status text not null check(status in ('open','closed')),opened_by uuid references auth.users(id),opened_by_email text,opened_at timestamptz,
 closed_by uuid references auth.users(id),closed_at timestamptz,primary key(shop_id,day,shift)
);
alter table public.pos_shift_sessions enable row level security;
revoke all on public.pos_shift_sessions from public,anon,authenticated;
-- Old closed shifts remain closed; do not invent an opening time or an opening actor.
insert into public.pos_shift_sessions(shop_id,day,shift,status,closed_at)
 select s.id,(c->>'day')::date,(c->>'shift')::smallint,'closed',(c->>'at')::timestamptz
 from public.pos_shops s cross join lateral jsonb_array_elements(s.data->'closings') c on conflict do nothing;
do $$ begin
 if to_regprocedure('public.pos_read_workspace_v2()') is null then alter function public.pos_read_workspace() rename to pos_read_workspace_v2;end if;
 if to_regprocedure('public.pos_save_workspace_v2(bigint,jsonb)') is null then alter function public.pos_save_workspace(bigint,jsonb) rename to pos_save_workspace_v2;end if;
 if to_regprocedure('public.pos_manage_v2(text,jsonb)') is null then alter function public.pos_manage(text,jsonb) rename to pos_manage_v2;end if;
 execute replace(pg_get_functiondef('public.pos_manage_v2(text,jsonb)'::regprocedure),'pos_manage.payload','pos_manage_v2.payload');
end $$;
revoke all on function public.pos_read_workspace_v2(),public.pos_save_workspace_v2(bigint,jsonb),public.pos_manage_v2(text,jsonb) from public,anon,authenticated;

create or replace function public.pos_read_workspace() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; sessions jsonb;
begin
 result:=public.pos_read_workspace_v2();
 select coalesce(jsonb_agg(to_jsonb(s) order by s.day desc,s.shift),'[]') into sessions from public.pos_shift_sessions s
 where s.shop_id=(result#>>'{access,shopId}')::uuid and public.pos_can_shift(s.shop_id,s.day,s.shift);
 return jsonb_set(result,'{access,shiftSessions}',sessions);
end;$$;

create or replace function public.pos_manage(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype;d date;n integer;existing public.pos_shift_sessions%rowtype;
begin
 if action<>'shift.open' then perform public.pos_manage_v2(action,payload);return public.pos_read_workspace();end if;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null or m.role<>'staff' then raise exception 'Chỉ nhân viên được phân công mới được mở ca' using errcode='42501';end if;
 perform 1 from public.pos_shops where id=m.shop_id for update;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null or m.role<>'staff' then raise exception 'Chỉ nhân viên được mở ca' using errcode='42501';end if;
 d:=(payload->>'day')::date;n:=(payload->>'shift')::integer;
 if d is null or n is null or n not between 1 and 3 or not public.pos_can_shift(m.shop_id,d,n) then raise exception 'Bạn chưa được phân công ca này' using errcode='42501';end if;
 select * into existing from public.pos_shift_sessions where shop_id=m.shop_id and day=d and shift=n;
 if existing.status='closed' or exists(select 1 from public.pos_shops s cross join lateral jsonb_array_elements(s.data->'closings') c where s.id=m.shop_id and c->>'day'=d::text and c->>'shift'=n::text) then
  raise exception 'Ca đã đóng, không thể mở lại' using errcode='23514';
 end if;
 if existing.status='open' then return public.pos_read_workspace();end if;
 insert into public.pos_shift_sessions(shop_id,day,shift,status,opened_by,opened_by_email,opened_at) values(m.shop_id,d,n,'open',m.user_id,m.email,now());
 insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,after_data) values(m.shop_id,m.user_id,m.email,'shift.open',d::text||':'||n::text,jsonb_build_object('day',d,'shift',n));
 return public.pos_read_workspace();
end;$$;

create or replace function public.pos_save_workspace(expected_revision bigint,next_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype;w public.pos_shops%rowtype;c jsonb;o jsonb;
begin
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null then raise exception 'Tài khoản chưa được cấp quyền' using errcode='42501';end if;
 select * into strict w from public.pos_shops where id=m.shop_id for update;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null then raise exception 'Tài khoản đã bị khóa' using errcode='42501';end if;
 for c in select value from jsonb_array_elements(next_data->'closings') loop
  if not exists(select 1 from jsonb_array_elements(w.data->'closings') old where old->>'day'=c->>'day' and old->>'shift'=c->>'shift') then
   if m.role<>'staff' or not public.pos_can_shift(m.shop_id,(c->>'day')::date,(c->>'shift')::int) then raise exception 'Chỉ nhân viên được phân công mới được đóng ca' using errcode='42501';end if;
   if not exists(select 1 from public.pos_shift_sessions s where s.shop_id=m.shop_id and s.day=(c->>'day')::date and s.shift=(c->>'shift')::int and s.status='open') then raise exception 'Ca chưa mở hoặc đã đóng' using errcode='23514';end if;
  end if;
 end loop;
 for o in select value from jsonb_array_elements(next_data->'orders') loop
  if not exists(select 1 from jsonb_array_elements(w.data->'orders') old where old->>'id'=o->>'id')
    and not exists(select 1 from public.pos_shift_sessions s where s.shop_id=m.shop_id and s.day=(o->>'day')::date and s.shift=(o->>'shift')::int and s.status='open') then
   raise exception 'Nhân viên cần mở ca trước khi tạo đơn' using errcode='23514';
  end if;
 end loop;
 perform public.pos_save_workspace_v2(expected_revision,next_data);
 for c in select value from jsonb_array_elements(next_data->'closings') loop
  update public.pos_shift_sessions set status='closed',closed_by=m.user_id,closed_at=now()
  where shop_id=m.shop_id and day=(c->>'day')::date and shift=(c->>'shift')::int and status='open';
 end loop;
 return public.pos_read_workspace();
end;$$;
revoke all on function public.pos_read_workspace(),public.pos_manage(text,jsonb),public.pos_save_workspace(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pos_read_workspace(),public.pos_manage(text,jsonb),public.pos_save_workspace(bigint,jsonb) to authenticated;
commit;
