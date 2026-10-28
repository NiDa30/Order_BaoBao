begin;
select public.pos_bootstrap_shop('admin@example.test');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$ declare r jsonb;op jsonb:='[{"day":"2026-10-18","shift":1,"openedAt":"2026-10-18T01:00:00Z","openedBy":"11111111-1111-4111-8111-111111111111","openedByEmail":"admin@example.test","staffId":"22222222-2222-4222-8222-222222222222"}]';begin
 perform public.pos_manage('member.add','{"email":"staff@example.test","role":"staff"}');
 perform public.pos_manage('assignment.set','{"userId":"22222222-2222-4222-8222-222222222222","day":"2026-10-18","shift":1}');
 r:=public.pos_read_workspace();
 r:=public.pos_save_workspace((r->>'revision')::bigint,jsonb_set(r->'data','{openings}',op));
 if r#>>'{access,shiftSessions,0,status}' is distinct from 'open' then raise exception 'Admin open not recorded';end if;
 begin perform public.pos_save_workspace((r->>'revision')::bigint,jsonb_set(r->'data','{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T00:30:00Z","openedAt":"2026-10-18T01:00:00Z","actualCash":0}]'));raise exception 'Closed before opening';exception when check_violation then null;end;
 r:=public.pos_save_workspace((r->>'revision')::bigint,jsonb_set(r->'data','{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T05:00:00Z","openedAt":"2026-10-18T01:00:00Z","actualCash":0}]'));
 if r#>>'{access,shiftSessions,0,status}' is distinct from 'closed' then raise exception 'Admin close not recorded';end if;
 begin perform public.pos_save_workspace((r->>'revision')::bigint,jsonb_set(r->'data','{openings,0,openedAt}','"2026-10-18T06:00:00Z"'));raise exception 'Opening moved after closing';exception when check_violation then null;end;
end $$;
rollback;
\echo 'PASS: admin assigns, opens and closes on behalf of staff; closing before opening rejected'
