begin;
select public.pos_bootstrap_shop('admin@example.test');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$ declare row jsonb;begin
 perform public.pos_manage('member.add','{"email":"staff@example.test","role":"staff"}');
 perform public.pos_manage('assignment.set','{"userId":"22222222-2222-4222-8222-222222222222","day":"2026-10-18","shift":1}');
 begin perform public.pos_manage('shift.open','{"day":"2026-10-18","shift":1}');raise exception 'Admin opened shift';exception when insufficient_privilege then null;end;
 begin perform public.pos_read_workspace_v2();raise exception 'Client bypassed role wrapper';exception when insufficient_privilege then null;end;
 row:=public.pos_read_workspace();
 begin perform public.pos_save_workspace(0,jsonb_set(row->'data','{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T02:00:00Z","actualCash":0}]'));raise exception 'Admin closed shift';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare row jsonb;begin
 begin perform public.pos_manage('shift.open','{"day":"2026-10-18","shift":2}');raise exception 'Staff opened unassigned shift';exception when insufficient_privilege then null;end;
 row:=public.pos_read_workspace();
 begin perform public.pos_save_workspace(0,jsonb_set(row->'data','{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T02:00:00Z","actualCash":0}]'));raise exception 'Staff closed unopened shift';exception when check_violation then null;end;
 row:=public.pos_manage('shift.open','{"day":"2026-10-18","shift":1}');
 if row#>>'{access,shiftSessions,0,opened_by_email}'<>'staff@example.test' then raise exception 'Opening actor missing';end if;
 row:=public.pos_save_workspace(0,jsonb_set(row->'data','{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T02:00:00Z","actualCash":0}]'));
 if row#>>'{access,shiftSessions,0,status}'<>'closed' then raise exception 'Shift not closed';end if;
 begin perform public.pos_manage('shift.open','{"day":"2026-10-18","shift":1}');raise exception 'Staff reopened closed shift';exception when check_violation then null;end;
end $$;
rollback;
\echo 'PASS: only assigned staff can open/close shifts; admin denied, legacy RPC bypass denied, cannot close unopened/reopen closed shifts'
