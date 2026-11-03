#!/bin/bash
# Regenerates the copy-paste SQL files from supabase/migrations/ (date order):
#   supabase/manual/full_setup.sql            every migration (new, empty project)
#   supabase/manual/apply_2026-11_updates_2.sql migrations from 2026-11-08 onwards
#                                             (projects already set up before then)
# CI fails if the committed files are out of date.
set -eu
cd "$(dirname "$0")/.."

body() {
  for f in "$@"; do
    echo "-- ================================================================"
    echo "-- $(basename "$f")"
    echo "-- ================================================================"
    cat "$f"
    echo
  done
}

ALL=$(ls supabase/migrations/*.sql | sort)
# Migrations dated 2026-11-08 or later (filenames start with the timestamp).
LATER=$(for f in $ALL; do n=$(basename "$f"); [ "${n:0:8}" \> "20261107" ] && echo "$f"; done)

F=supabase/manual/full_setup.sql
{ sed -n '1,/^BEGIN;$/p' "$F.header"; echo; body $ALL; echo "COMMIT;"; } > "$F"
echo "Wrote $F"

U=supabase/manual/apply_2026-11_updates_2.sql
{
  cat "$U.header"
  for f in $LATER; do echo "    $(basename "$f")"; done
  echo "*/"; echo; echo "BEGIN;"; echo
  body $LATER
  echo "COMMIT;"
} > "$U"
echo "Wrote $U"
