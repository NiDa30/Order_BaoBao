-- Local PostgreSQL test fixture uses only synthetic users/data, rolled back afterwards.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$
declare
  snapshot jsonb := '{"menu":[{"id":"m1","name":"Cà phê sữa","category":"Cà phê","price":22000}],"orders":[{"id":"order-a","code":"20261018-001-A","day":"2026-10-18","shift":1,"created":"2026-10-18T00:00:00Z","label":"Bàn 1","status":"open","items":[{"id":"m1","name":"Cà phê sữa","price":22000,"qty":1}]}],"closings":[]}';
  response jsonb; bad jsonb;
begin
  if public.pos_read_workspace() is not null then raise exception 'Test user must start empty'; end if;
  response:=public.pos_save_workspace(0,snapshot);
  if (response->>'revision')::int<>1 then raise exception 'Save did not increment version'; end if;
  if public.pos_read_workspace()->'data'<>snapshot then raise exception 'Read did not restore saved data'; end if;
  begin
    perform public.pos_save_workspace(0,snapshot);
    raise exception 'Stale write was accepted';
  exception when serialization_failure then null; end;
  begin
    update public.pos_workspaces set revision=999;
    raise exception 'Direct client update was allowed';
  exception when insufficient_privilege then null; end;
  bad:=jsonb_set(snapshot,'{orders,0,items,0,price}','0');
  begin
    perform public.pos_save_workspace(1,bad);
    raise exception 'Invalid price was accepted';
  exception when check_violation then null; end;
  bad:=jsonb_set(snapshot,'{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T02:00:00Z","revenue":999,"count":999}]');
  begin
    perform public.pos_save_workspace(1,bad);
    raise exception 'Unpaid shift was closed';
  exception when check_violation then null; end;
  snapshot:=jsonb_set(snapshot,'{orders,0}',snapshot#>'{orders,0}'||'{"status":"paid","paymentMethod":"transfer","paidAt":"2026-10-18T01:00:00Z"}'::jsonb);
  response:=public.pos_save_workspace(1,snapshot);
  snapshot:=jsonb_set(snapshot,'{closings}','[{"day":"2026-10-18","shift":1,"at":"2026-10-18T02:00:00Z","revenue":999,"count":999}]');
  response:=public.pos_save_workspace(2,snapshot);
  if response#>>'{data,closings,0,revenue}'<>'22000' or response#>>'{data,closings,0,count}'<>'1' then
    raise exception 'Closing was not calculated by database';
  end if;
  snapshot:=jsonb_set(response->'data','{orders,0,items,0,qty}','2');
  response:=public.pos_save_workspace(3,snapshot);
  if response#>>'{data,closings,0,revenue}'<>'44000' or response#>>'{data,closings,0,originalRevenue}'<>'22000' then
    raise exception 'Closed shift edit did not reconcile';
  end if;
  snapshot:=response->'data';
  bad:=jsonb_set(snapshot,'{orders}',(snapshot->'orders')||jsonb_build_array((snapshot#>'{orders,0}')||'{"id":"order-b","code":"order-b"}'));
  begin
    perform public.pos_save_workspace(4,bad);
    raise exception 'New order in closed shift was accepted';
  exception when check_violation then null; end;
  bad:=jsonb_set(snapshot,'{orders,0,paymentMethod}','"cash"');
  begin
    perform public.pos_save_workspace(4,bad);
    raise exception 'Existing payment metadata changed';
  exception when check_violation then null; end;
  bad:=jsonb_set(snapshot,'{orders}','[]');
  begin
    perform public.pos_save_workspace(4,bad);
    raise exception 'Existing orders removed';
  exception when check_violation then null; end;
  if (public.pos_read_workspace()->>'revision')::int<>4 then raise exception 'Failed transaction changed revision'; end if;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
  if public.pos_read_workspace() is not null then raise exception 'Leaked another user workspace'; end if;
  if (select count(*) from public.pos_workspaces)<>0 then raise exception 'RLS leaked another owner'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.pos_read_workspace();
    raise exception 'Anon could read workspace';
  exception when insufficient_privilege then null; end;
  begin
    perform public.pos_save_workspace(0,'{"menu":[],"orders":[],"closings":[]}');
    raise exception 'Anon could save workspace';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: round trip, CAS, validation, payment, closing reconciliation, owner isolation, and anon denial'
