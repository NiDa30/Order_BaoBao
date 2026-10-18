-- Run after migration 003. Staff self-register when opening today’s shift.
begin;
create or replace function public.pos_manage(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.pos_members%rowtype;d date;n integer;existing public.pos_shift_sessions%rowtype;
begin
 if action='assignment.set' then raise exception 'Phân ca thủ công đang tạm tắt' using errcode='42501';end if;
 if action<>'shift.open' then perform public.pos_manage_v2(action,payload);return public.pos_read_workspace();end if;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null or m.role<>'staff' then raise exception 'Chỉ nhân viên mới được mở ca' using errcode='42501';end if;
 perform 1 from public.pos_shops where id=m.shop_id for update;
 select * into m from public.pos_members where user_id=auth.uid() and active;
 if m.user_id is null or m.role<>'staff' then raise exception 'Chỉ nhân viên được mở ca' using errcode='42501';end if;
 d:=(payload->>'day')::date;n:=(payload->>'shift')::integer;
 if d is null or n is null or n not between 1 and 3 or d<>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Chỉ được mở ca 1–3 trong ngày hiện tại' using errcode='42501';end if;
 insert into public.pos_assignments(shop_id,user_id,day,shift) values(m.shop_id,m.user_id,d,n) on conflict do nothing;
 select * into existing from public.pos_shift_sessions where shop_id=m.shop_id and day=d and shift=n;
 if existing.status='closed' or exists(select 1 from public.pos_shops s cross join lateral jsonb_array_elements(s.data->'closings') c where s.id=m.shop_id and c->>'day'=d::text and c->>'shift'=n::text) then
  raise exception 'Ca đã đóng, không thể mở lại' using errcode='23514';
 end if;
 if existing.status='open' then return public.pos_read_workspace();end if;
 insert into public.pos_shift_sessions(shop_id,day,shift,status,opened_by,opened_by_email,opened_at) values(m.shop_id,d,n,'open',m.user_id,m.email,now());
 insert into public.pos_audit(shop_id,actor_id,actor_email,action,target_id,after_data) values(m.shop_id,m.user_id,m.email,'shift.open',d::text||':'||n::text,jsonb_build_object('day',d,'shift',n));
 return public.pos_read_workspace();
end;$$;

revoke all on function public.pos_manage(text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_manage(text,jsonb) to authenticated;
commit;
