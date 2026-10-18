#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Test-only Postgres, no published ports or persistent volumes.
container_name="lam-an-sql-test-${RANDOM}-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container_name" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
ready=0
for attempt in {1..50}; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1;break;fi
  sleep 0.2
done
if [ "$ready" != 1 ]; then docker logs "$container_name";exit 1;fi
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
insert into auth.users values ('11111111-1111-4111-8111-111111111111','admin@example.test'),('22222222-2222-4222-8222-222222222222','staff@example.test');
SQL
for attempt in 1 2; do
  docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202610180001_pos_workspace.sql
done
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/workspace.sql

for attempt in 1 2; do
 docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202610180002_shop_roles.sql
done
docker exec -i "$container_name" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/roles.sql
