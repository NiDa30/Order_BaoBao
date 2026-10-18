begin;
select public.pos_bootstrap_shop('admin@example.test');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$ begin
 perform public.pos_manage('member.add','{"email":"staff@example.test","role":"staff"}');
 begin perform public.pos_manage('assignment.set','{}');raise exception 'Manual assignment accepted';exception when insufficient_privilege then null;end;
 begin perform public.pos_manage('shift.open',jsonb_build_object('day',(now() at time zone 'Asia/Ho_Chi_Minh')::date,'shift',1));raise exception 'Admin opened';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare r jsonb;d date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;begin
 r:=public.pos_read_workspace();
 if jsonb_array_length(r#>'{access,assignments}')<>0 then raise exception 'Unexpected initial access';end if;
 r:=public.pos_manage('shift.open',jsonb_build_object('day',d,'shift',1));
 if r#>>'{access,shiftSessions,0,opened_by_email}' is distinct from 'staff@example.test' then raise exception 'Missing opener';end if;
 if jsonb_array_length(r#>'{access,assignments}')<>1 then raise exception 'Participation missing';end if;
 if exists(select 1 from jsonb_array_elements(r#>'{access,assignments}') a where (a->>'shift')::int=2) then raise exception 'Other shift leaked';end if;
 r:=public.pos_save_workspace(0,jsonb_set(r->'data','{closings}',jsonb_build_array(jsonb_build_object('day',d,'shift',1,'at',now(),'actualCash',0))));
 if r#>>'{access,shiftSessions,0,status}' is distinct from 'closed' then raise exception 'Not closed';end if;
 begin perform public.pos_manage('shift.open',jsonb_build_object('day',d,'shift',1));raise exception 'Reopened';exception when check_violation then null;end;
end $$;
rollback;
\echo 'PASS: self-service open without assignment, participant isolation, staff close, admin denied and manual assignment disabled'
