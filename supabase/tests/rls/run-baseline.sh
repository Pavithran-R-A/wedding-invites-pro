#!/usr/bin/env bash
# Proves the PRE-hardening baseline (only the two original migrations) contained
# the exploit paths Stage 0 closes. Uses a throwaway Postgres container.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # -> repo root

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-baseline-$$"
cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CTR" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

apply() { docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$1"; }

apply supabase/tests/rls/00_bootstrap.sql
# Deliberately EXCLUDE every Stage 0 migration to show the original schema, and every
# Stage 2 one: Stage 2 archives public.projects, which this baseline depends on
# existing in public.
for m in $(ls supabase/migrations/*.sql | grep -v -e 'stage0_' -e '_stage2_' | sort); do
  apply "$m"
done

echo "==> Reporting pre-hardening baseline behavior (informational)"
docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
  psql -U postgres -v ON_ERROR_STOP=1 --single-transaction < supabase/tests/rls/02_baseline_probe.sql
echo "==> BASELINE snapshot captured (see notices above)"
