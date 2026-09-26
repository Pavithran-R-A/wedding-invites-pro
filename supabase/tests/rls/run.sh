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

# 2) Existing schema migrations, in timestamp order.
#
# The Stage 2 and Stage 3 files are excluded on purpose. This suite qualifies the
# *published* (Stage 0/1) schema, and it asserts against `public.projects` — a table
# Stage 2 archives into `legacy`, after which those assertions would be measuring a
# schema that no longer has the shape they describe. The list is a whitelist-by-
# exclusion, so a later stage must be added here when it lands; leaving it out would
# apply a migration whose tables this chain never creates. Stage 2 has its own
# runner, which is also the current schema-head chain: `supabase/tests/stage2/run.sh`.
for m in $(ls supabase/migrations/*.sql | grep -vE '_stage(2|3)_' | sort); do
  apply "$m"
done

# 3) Security assertions
echo "==> Running Stage 0 RLS attack suite"
docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
  psql -U postgres -v ON_ERROR_STOP=1 --single-transaction < supabase/tests/rls/01_rls_attacks.sql

echo "==> RESULT: PASS (psql exited 0 with ON_ERROR_STOP; see the PASS count in the notice above)"
