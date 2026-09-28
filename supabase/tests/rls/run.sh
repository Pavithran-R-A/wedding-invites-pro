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

# Committed SQL is LF; a Windows checkout can rewrite the working copy to CRLF, and psql
# keeps those CR bytes inside multi-line literals, where an exact literal comparison
# cannot match a value the database joined with E'\n'. Feeding psql through `tr -d '\r'`
# makes it receive the committed bytes on every platform. Input normalisation only — no
# assertion changes. Same repair as supabase/tests/stage2/run.sh, same root cause.
sql_bytes() { tr -d '\r' < "$1"; }

apply() {  # apply <file>
  echo "==> psql < $1"
  sql_bytes "$1" | docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
    psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q
}

# 1) Supabase auth/role shim
apply supabase/tests/rls/00_bootstrap.sql

# 2) Existing schema migrations, in timestamp order.
#
# Every stage from 2 onward is excluded on purpose. This suite qualifies the *published*
# (Stage 0/1) schema, and it asserts against `public.projects` — a table Stage 2 archives
# into `legacy`, after which those assertions would be measuring a schema that no longer has
# the shape they describe. A later-stage migration also depends on tables this chain never
# creates: when `20260927120000_stage4_tradition_pack_releases.sql` was matched by an
# explicit `_stage(2|3)_` exclusion, it was applied anyway and the run aborted with
# `ERROR: relation "public.tradition_packs" does not exist`. The pattern is therefore a
# range, not an alternation, so no future stage can re-open that hole. Stage 2 has its own
# runner, which is also the current schema-head chain: `supabase/tests/stage2/run.sh`.
for m in $(ls supabase/migrations/*.sql | grep -vE '_stage([2-9]|[1-9][0-9]+)_' | sort); do
  apply "$m"
done

# 3) Security assertions
echo "==> Running Stage 0 RLS attack suite"
sql_bytes supabase/tests/rls/01_rls_attacks.sql | docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
  psql -U postgres -v ON_ERROR_STOP=1 --single-transaction

echo "==> RESULT: PASS (psql exited 0 with ON_ERROR_STOP; see the PASS count in the notice above)"
