#!/usr/bin/env bash
# Brings a Supabase database's migration history in line with this repo and
# applies new migrations. Used by .github/workflows/supabase-deploy.yml.
#   DB_ARGS=--linked tools/deploy-db.sh                          # live project (after `supabase link`; password from SUPABASE_DB_PASSWORD)
#   DB_ARGS="--db-url postgresql://…" tools/deploy-db.sh          # any database, e.g. for testing
#   DRY_RUN=true …                                                 # only show what would happen
set -euo pipefail
cd "$(dirname "$0")/.."
SUPABASE="${SUPABASE:-supabase}"
read -r -a args <<< "${DB_ARGS:?set DB_ARGS}"

versions() { grep -Ev '^\s*(#|$)' "$1" | tr -d ' ' ; }
remote="$($SUPABASE migration list "${args[@]}" --output-format json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const line = s.split("\n").find((l) => l.includes("\"migrations\""));
    if (!line) { console.error("Could not read the migration history"); process.exit(1); }
    JSON.parse(line).migrations.filter((m) => m.remote).forEach((m) => console.log(m.remote));
  });')"
echo "Recorded on the database: $(printf '%s ' $remote)"

# Migrations applied by hand before (SQL Editor) are recorded as applied; old
# file names whose content now lives under a new version are marked reverted.
to_revert=""; to_apply=""
for v in $(versions supabase/renamed-migrations.txt); do printf '%s\n' "$remote" | grep -qx "$v" && to_revert="$to_revert $v"; done
for v in $(versions supabase/applied-before-ci.txt); do printf '%s\n' "$remote" | grep -qx "$v" || to_apply="$to_apply $v"; done
echo "Mark as reverted:${to_revert:- none}"
echo "Mark as applied:${to_apply:- none}"

if [ "${DRY_RUN:-false}" = "true" ]; then
  pending=""
  for f in supabase/migrations/*.sql; do
    v="$(basename "$f" | cut -d_ -f1)"
    printf '%s\n' "$remote" $to_apply | grep -qx "$v" || pending="$pending $(basename "$f")"
  done
  echo "Would apply:${pending:- nothing}"
  exit 0
fi
if [ -n "$to_revert" ]; then $SUPABASE migration repair --status reverted $to_revert "${args[@]}"; fi
if [ -n "$to_apply" ]; then $SUPABASE migration repair --status applied $to_apply "${args[@]}"; fi
$SUPABASE db push "${args[@]}"
