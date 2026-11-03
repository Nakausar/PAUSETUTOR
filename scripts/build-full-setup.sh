#!/bin/bash
# Regenerates supabase/manual/full_setup.sql from supabase/migrations/ (date order).
# CI fails if the committed file is out of date.
set -eu
cd "$(dirname "$0")/.."
F=supabase/manual/full_setup.sql
{
  sed -n '1,/^BEGIN;$/p' "$F.header"
  echo
  for f in $(ls supabase/migrations/*.sql | sort); do
    echo "-- ================================================================"
    echo "-- $(basename "$f")"
    echo "-- ================================================================"
    cat "$f"
    echo
  done
  echo "COMMIT;"
} > "$F"
echo "Wrote $F"
