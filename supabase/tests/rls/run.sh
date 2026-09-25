#!/usr/bin/env bash
# Runs the Stage 0 RLS regression suite against a throwaway Postgres in Docker.
# Nothing is persisted and no remote/Supabase project is touched.
set -euo pipefail

cd "$(dirname "$0")/../../.."   # -> repo root
ROOT="$PWD"

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-rls-$$"

cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Starting $IMAGE as $CTR"
docker run -d --name "$CTR" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null

echo "==> Waiting for Postgres"
for _ in $(seq 1 60); do
  if docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

apply() {  # apply <file>
  echo "==> psql < $1"
  docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
    psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$1"
}

# 1) Supabase auth/role shim
apply supabase/tests/rls/00_bootstrap.sql

# 2) Existing schema migrations, in timestamp order
for m in $(ls supabase/migrations/*.sql | sort); do
  apply "$m"
done

# 3) Security assertions
echo "==> Running Stage 0 RLS attack suite"
docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
  psql -U postgres -v ON_ERROR_STOP=1 --single-transaction < supabase/tests/rls/01_rls_attacks.sql

echo "==> RESULT: PASS (psql exited 0 with ON_ERROR_STOP; see the PASS count in the notice above)"
