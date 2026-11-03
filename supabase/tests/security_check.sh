#!/bin/bash
# Database security check on plain PostgreSQL (no Supabase project needed).
#
# SETUP=update (default): existing project
#   1. Applies the original (Bolt-era) migrations, i.e. the state of an existing project.
#   2. Applies supabase/manual/apply_2026-11_updates.sql, then apply_2026-11_updates_2.sql,
#      each twice (they must be repeatable).
# SETUP=full: new, empty project
#   1. Applies supabase/manual/full_setup.sql once.
# Then runs queries the way the app sends them (role `authenticated` + JWT claims)
# and checks the row-level security and triggers.
#
# Usage: PGHOST=localhost PGPORT=5432 PGUSER=postgres [SETUP=full] bash supabase/tests/security_check.sh
# The connecting user must be able to create databases. A database named
# `pause_security_check` is created and dropped.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DB=pause_security_check
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PA="psql -v ON_ERROR_STOP=1 -q"
P="$PA -d $DB -tA"
alive() { $PA -d postgres -tAc "select 1" >/dev/null 2>&1 || { echo "ABORT: database server is not reachable"; exit 2; }; }
alive
$PA -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>/dev/null || exit 2
$PA -d $DB -f "$REPO/supabase/tests/supabase_stub.sql" >/dev/null || exit 2
SETUP="${SETUP:-update}"
if [ "$SETUP" = full ]; then
  $PA -d $DB -f "$REPO/supabase/manual/full_setup.sql" >/dev/null 2>"$TMP/full.err" && echo "Full setup on an empty database: OK" || { echo "Full setup: FAILED"; grep -v NOTICE "$TMP/full.err" | head; exit 1; }
else
n=0; for f in $(ls $REPO/supabase/migrations/*.sql | sort); do case $(basename $f) in 2026110*) continue;; esac
  if $PA -d $DB -f "$f" >/dev/null 2>"$TMP/mig.err"; then n=$((n+1)); else echo "FAILED original migration $f"; grep -v NOTICE "$TMP/mig.err" | head -3; exit 1; fi; done
echo "Original Bolt migrations applied: $n"
for upd in apply_2026-11_updates.sql apply_2026-11_updates_2.sql; do
  for run in 1 2; do $PA -d $DB -f "$REPO/supabase/manual/$upd" >/dev/null 2>"$TMP/c.err" && echo "$upd, run $run: OK" || { echo "$upd, run $run: FAILED"; grep -v NOTICE "$TMP/c.err" | head; exit 1; }; done
done
fi

STU=11111111-1111-4111-8111-111111111111; RES=22222222-2222-4222-8222-222222222222
$P -c "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('$STU','student@test.fi','{\"role\":\"researcher\",\"consent_acknowledged\":true}'), ('$RES','researcher@test.fi','{}')" >/dev/null
as() { alive; $P -c "BEGIN; SET LOCAL ROLE $2; SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"$2\"}', true); $3; COMMIT;" 2>&1; }
q() { alive; $P -c "$1"; }
result() { case "$1" in *ERROR*) echo error;; *) echo ok;; esac; }
lastval() { echo "$1" | grep -v '^{' | grep -v '^$' | tail -1; }
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  (expected: $3 | got: $2)"; fail=$((fail+1)); fi; }

check "sign-up asking for 'researcher' still creates a student" "$(q "SELECT role FROM profiles WHERE id='$STU'")" "student"
check "consent checkbox is stored"                             "$(q "SELECT consent_acknowledged FROM profiles WHERE id='$STU'")" "t"
check "email auto-confirm trigger removed"                       "$(q "SELECT email_confirmed_at IS NULL FROM auth.users WHERE id='$STU'")" "t"
q "UPDATE profiles SET role='researcher' WHERE id='$RES'" >/dev/null
check "SQL editor can promote a researcher"                     "$(q "SELECT role FROM profiles WHERE id='$RES'")" "researcher"
check "student cannot make themselves researcher"               "$(result "$(as $STU authenticated "UPDATE profiles SET role='researcher' WHERE id='$STU'")")" "error"
check "...and their role is unchanged"                          "$(q "SELECT role FROM profiles WHERE id='$STU'")" "student"
check "student cannot change participant_id"                    "$(result "$(as $STU authenticated "UPDATE profiles SET participant_id='P-FAKE' WHERE id='$STU'")")" "error"
check "student can still update other profile fields"           "$(result "$(as $STU authenticated "UPDATE profiles SET research_logging_enabled=true WHERE id='$STU'")")" "ok"
check "student cannot insert a profile directly"                "$(result "$(as $STU authenticated "INSERT INTO profiles (id,email,role) VALUES (gen_random_uuid(),'x@y.z','researcher')")")" "error"
as $RES authenticated "UPDATE profiles SET role='researcher' WHERE id='$STU'" >/dev/null
check "researcher cannot change another user's role from the app" "$(q "SELECT role FROM profiles WHERE id='$STU'")" "student"

TASK=$(q "SELECT id FROM tasks LIMIT 1"); PID=$(q "SELECT participant_id FROM profiles WHERE id='$STU'")
SESS=$(q "INSERT INTO sessions (task_id, student_id, participant_id) VALUES ('$TASK','$STU','$PID') RETURNING id" | head -1)
check "student cannot write fake AI interactions"               "$(result "$(as $STU authenticated "INSERT INTO ai_interactions (session_id, student_id, participant_id, category, prompt, response) VALUES ('$SESS','$STU','$PID','hint','q','fake')")")" "error"
AI=$(q "INSERT INTO ai_interactions (session_id, student_id, participant_id, category, prompt, response, model) VALUES ('$SESS','$STU','$PID','hint','q','real answer','gpt') RETURNING id" | head -1)
as $STU authenticated "UPDATE ai_interactions SET response='edited' WHERE id='$AI'" >/dev/null
check "student cannot edit a stored AI answer"                  "$(q "SELECT response FROM ai_interactions WHERE id='$AI'")" "real answer"
check "student can read their own AI interactions"              "$(lastval "$(as $STU authenticated "SELECT count(*) FROM ai_interactions WHERE id='$AI'")")" "1"
check "follow-up rows (parent_interaction_id) accepted"         "$(result "$(q "INSERT INTO ai_interactions (session_id, student_id, participant_id, category, prompt, response, parent_interaction_id, turn_index) VALUES ('$SESS','$STU','$PID','hint','f','a','$AI',1)" 2>&1)")" "ok"

q "INSERT INTO task_hidden_tests (task_id, test_cases) VALUES ('$TASK','[{\"input\":\"1\",\"expected\":\"secret\"}]')" >/dev/null
check "student cannot see hidden tests"                         "$(lastval "$(as $STU authenticated "SELECT count(*) FROM task_hidden_tests")")" "0"
check "researcher can see hidden tests"                         "$(lastval "$(as $RES authenticated "SELECT count(*) FROM task_hidden_tests")")" "1"
check "student cannot write hidden tests"                       "$(result "$(as $STU authenticated "INSERT INTO task_hidden_tests (task_id) VALUES (gen_random_uuid())")")" "error"
check "researcher can save hidden tests"                        "$(result "$(as $RES authenticated "UPDATE task_hidden_tests SET test_cases='[]' WHERE task_id='$TASK'")")" "ok"

bad=0; for t in CODE_AUTOSAVED TEXT_PASTED AI_RESPONSE_COPIED FOCUS_LOST FOCUS_RETURNED IDLE_STARTED IDLE_ENDED AI_FOLLOWUP_REQUEST CODE_REVISED EXPLANATION_REQUEST APPROACH_REVIEW_REQUEST ERROR_EXPLANATION_REQUEST TEST; do
  [ "$(result "$(as $STU authenticated "INSERT INTO event_logs (participant_id, student_id, session_id, task_id, pause_phase, event_type, metadata) VALUES ('$PID','$STU','$SESS','$TASK','attempt','$t','{\"log_schema\":2}')")")" = ok ] || { echo "      event type $t rejected"; bad=1; }; done
check "all 13 new or newly used event types accepted"           "$bad" "0"
check "unknown event types are still rejected"                  "$(result "$(as $STU authenticated "INSERT INTO event_logs (participant_id, student_id, session_id, task_id, pause_phase, event_type) VALUES ('$PID','$STU','$SESS','$TASK','attempt','MADE_UP')")")" "error"
ATT=$(q "INSERT INTO code_attempts (session_id, student_id, participant_id, current_code) VALUES ('$SESS','$STU','$PID','x=1') RETURNING id" | head -1)
check "revision snapshots accepted"                             "$(result "$(as $STU authenticated "INSERT INTO code_snapshots (attempt_id, session_id, student_id, participant_id, code, phase, trigger) VALUES ('$ATT','$SESS','$STU','$PID','x=2','scrutinise','revision')")")" "ok"
check "autosave snapshots accepted"                             "$(result "$(as $STU authenticated "INSERT INTO code_snapshots (attempt_id, session_id, student_id, participant_id, code, phase, trigger) VALUES ('$ATT','$SESS','$STU','$PID','x=3','attempt','auto')")")" "ok"
check "settings have the gate defaults"                         "$(q "SELECT solution_min_runs||','||solution_min_minutes||','||solution_requires_reason||','||max_followups FROM system_settings WHERE id=1")" "1,3,true,5"
check "researcher can change gate settings"                     "$(result "$(as $RES authenticated "UPDATE system_settings SET solution_min_minutes=5 WHERE id=1")")" "ok"
as $STU authenticated "UPDATE system_settings SET solution_min_minutes=0 WHERE id=1" >/dev/null
check "student cannot change settings"                          "$(q "SELECT solution_min_minutes FROM system_settings WHERE id=1")" "5"
check "tasks default to AI available"                           "$(q "SELECT ai_allowed FROM tasks WHERE id='$TASK'")" "t"
check "researcher can turn AI off for a task"                   "$(result "$(as $RES authenticated "UPDATE tasks SET ai_allowed=false WHERE id='$TASK'")")" "ok"
as $STU authenticated "UPDATE tasks SET ai_allowed=true WHERE id='$TASK'" >/dev/null
check "student cannot turn AI back on"                          "$(q "SELECT ai_allowed FROM tasks WHERE id='$TASK'")" "f"
# ---- Questionnaires ----
STU2=33333333-3333-4333-8333-333333333333
q "INSERT INTO auth.users (id, email) VALUES ('$STU2','student2@test.fi')" >/dev/null
SV=$(lastval "$(as $RES authenticated "INSERT INTO surveys (title, kind, items, active) VALUES ('Pre', 'pre', '[{\"id\":\"q1\",\"text\":\"x\",\"type\":\"likert5\"}]', true) RETURNING id")")
check "researcher can create a questionnaire"                   "$(q "SELECT count(*) FROM surveys WHERE id='$SV'")" "1"
check "student cannot create a questionnaire"                   "$(result "$(as $STU authenticated "INSERT INTO surveys (title) VALUES ('Fake')")")" "error"
DRAFT=$(q "INSERT INTO surveys (title, active) VALUES ('Draft', false) RETURNING id" | head -1)
check "student sees active questionnaires only"                 "$(lastval "$(as $STU authenticated "SELECT count(*) FROM surveys")")" "1"
check "student can submit a response"                           "$(result "$(as $STU authenticated "INSERT INTO survey_responses (survey_id, student_id, participant_id, answers) VALUES ('$SV','$STU','P-FORGED','{\"q1\":4}')")")" "ok"
check "participant_id is taken from the profile, not the browser" "$(q "SELECT participant_id = (SELECT participant_id FROM profiles WHERE id='$STU') FROM survey_responses WHERE student_id='$STU'")" "t"
check "student cannot submit twice"                             "$(result "$(as $STU authenticated "INSERT INTO survey_responses (survey_id, student_id, answers) VALUES ('$SV','$STU','{}')")")" "error"
check "student cannot answer an inactive questionnaire"         "$(result "$(as $STU authenticated "INSERT INTO survey_responses (survey_id, student_id, answers) VALUES ('$DRAFT','$STU','{}')")")" "error"
check "student cannot submit for someone else"                  "$(result "$(as $STU authenticated "INSERT INTO survey_responses (survey_id, student_id, answers) VALUES ('$SV','$STU2','{}')")")" "error"
as $STU authenticated "UPDATE survey_responses SET answers='{\"q1\":1}' WHERE student_id='$STU'" >/dev/null
check "student cannot change a submitted response"              "$(q "SELECT answers->>'q1' FROM survey_responses WHERE student_id='$STU'")" "4"
check "other students cannot see the response"                  "$(lastval "$(as $STU2 authenticated "SELECT count(*) FROM survey_responses")")" "0"
check "researcher can read all responses"                       "$(lastval "$(as $RES authenticated "SELECT count(*) FROM survey_responses")")" "1"

echo; echo "$pass passed, $fail failed"
$PA -d postgres -c "DROP DATABASE IF EXISTS $DB" 2>/dev/null
[ $fail = 0 ]
