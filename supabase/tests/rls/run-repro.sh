#!/usr/bin/env bash
# Reproduces (and later re-checks) the paid-state INSERT bypass on the PROJECTS
# table, against a throwaway Postgres container. No remote project is touched.
#
#   bash supabase/tests/rls/run-repro.sh          # published schema: shows the bypass
#   REPAIRED=1 bash supabase/tests/rls/run-repro.sh  # includes the repair migration
#
# The probe is informational and never fails the script; read the notices.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # -> repo root

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
CTR="vivaahvarnam-repro-$$"
REPAIR="stage0_protect_project_paid_state"

cleanup() { docker rm -f "$CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CTR" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CTR" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

apply() { docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -q < "$1"; }

apply supabase/tests/rls/00_bootstrap.sql

MIGRATIONS=$(ls supabase/migrations/*.sql | sort)
if [ "${REPAIRED:-0}" != "1" ]; then
  # Default: exclude the repair migration so the schema matches what is published.
  MIGRATIONS=$(echo "$MIGRATIONS" | grep -v "$REPAIR")
  echo "==> Schema: PUBLISHED Stage 0 (repair migration excluded)"
else
  echo "==> Schema: REPAIRED (all migrations applied)"
fi
for m in $MIGRATIONS; do apply "$m"; done

echo "==> Probing authenticated/service_role project INSERT"
docker exec -i -e PGCLIENTENCODING=UTF8 "$CTR" \
  psql -U postgres -v ON_ERROR_STOP=1 --single-transaction < supabase/tests/rls/03_paid_state_insert_probe.sql
echo "==> PROBE COMPLETE (interpretation is in the CASE notices above)"
