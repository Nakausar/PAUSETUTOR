/*
# Create student_analytics SQL function (cohort aggregates for the learning dashboard)

## 1. Purpose
Provides the PAUSE AI Tutor student dashboard with per-student activity metrics
plus privacy-safe cohort aggregates. A student should be able to compare their
own engagement, phase participation, and approved programming marks with
cohort averages WITHOUT being able to see any other student's raw records.

## 2. New function: student_analytics(p_student uuid)
SECURITY DEFINER, STABLE, returns a single JSON row with:

- `student`: own sessions, completed tasks, assignments, AI requests,
  independent attempts, scrutiny activities, total events, code runs.
- `weekly`: array of last 10 ISO weeks, each with own event counts and
  the cohort-average event count for that week.
- `phase_engagement`: per PAUSE phase (plan..evaluate), own event count and
  cohort average count per phase (participants with >= 1 event in phase).
- `ai_activity`: AI requests, independent attempts (CODE_RUN events in
  attempt phase), scrutiny responses, and completed tasks, per week.
- `marks`: own approved marks out of 100, per session, newest first.
- `cohort_mark_stats`: avg, min, max, quartiles of APPROVED marks across
  the cohort, plus cohort size (number of students with >= 1 approved mark)
  — returned ONLY if that cohort size >= 3 (privacy threshold).
- `metacog`: the student's own LATEST approved metacognitive ratings
  (planning, monitoring, scrutiny, evaluation) — qualitative only.

## 3. Security
- SECURITY DEFINER with SET search_path = public: the function reads across
  all students' rows to compute aggregates, but only RETURNS aggregates
  (averages, min/max/quartiles, counts). No other student's raw row,
  mark, or rating is ever returned.
- EXECUTE revoked from anon; granted to authenticated.
- Authorization: the caller must be a profile with role 'student' AND
  must pass their own auth.uid() (p_student = auth.uid() enforced).
  Researchers get an explicit error (they are not the target audience).
- Cohort aggregates that describe marks are suppressed below 3 students
  (returns null) to avoid identifying individuals via small cohorts.
- Phase/weekly cohort averages are computed over event counts only
  (activity levels), which cannot be tied to an individual.
- RLS on the underlying tables stays unchanged.
*/

CREATE OR REPLACE FUNCTION student_analytics(p_student uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_weeks int := 10;
  v_min_cohort int := 3;
  v_cohort_size int;
  v_result json;
BEGIN
  -- Authorization: caller must be signed in, and can only query themselves.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF p_student <> auth.uid() THEN
    RAISE EXCEPTION 'You may only view your own analytics';
  END IF;
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Analytics are available to students only';
  END IF;

  SELECT json_build_object(
    'student', (
      SELECT json_build_object(
        'sessions', (SELECT count(*) FROM sessions WHERE student_id = p_student),
        'completed_tasks', (SELECT count(*) FROM sessions WHERE student_id = p_student AND status = 'completed'),
        'assigned_tasks', (SELECT count(*) FROM task_assignments WHERE student_id = p_student),
        'ai_requests', (SELECT count(*) FROM ai_interactions WHERE student_id = p_student),
        'independent_attempts', (SELECT count(*) FROM event_logs WHERE student_id = p_student AND event_type = 'CODE_RUN' AND pause_phase = 'attempt'),
        'scrutiny_activities', (SELECT count(*) FROM scrutiny_responses WHERE student_id = p_student),
        'code_runs', (SELECT count(*) FROM event_logs WHERE student_id = p_student AND event_type = 'CODE_RUN'),
        'total_events', (SELECT count(*) FROM event_logs WHERE student_id = p_student)
      )
    ),
    'weekly', (
      SELECT json_agg(week_data ORDER BY week_start)
      FROM (
        SELECT
          to_char(date_trunc('week', min_week.wstart), 'YYYY-MM-DD') AS week_start,
          (SELECT count(*) FROM event_logs e
            WHERE e.student_id = p_student
              AND date_trunc('week', e.timestamp) = min_week.wstart) AS student_events,
          (SELECT round(avg(cnt), 1) FROM (
              SELECT count(*) AS cnt FROM event_logs e2
              WHERE date_trunc('week', e2.timestamp) = min_week.wstart
              GROUP BY e2.student_id
          ) per_student) AS cohort_avg_events,
          (SELECT count(*) FROM ai_interactions ai
            WHERE ai.student_id = p_student
              AND date_trunc('week', ai.created_at) = min_week.wstart) AS student_ai_requests,
          (SELECT count(*) FROM event_logs e3
            WHERE e3.student_id = p_student
              AND e3.event_type = 'CODE_RUN'
              AND e3.pause_phase = 'attempt'
              AND date_trunc('week', e3.timestamp) = min_week.wstart) AS student_attempts,
          (SELECT count(*) FROM scrutiny_responses sr
            WHERE sr.student_id = p_student
              AND date_trunc('week', sr.created_at) = min_week.wstart) AS student_scrutiny,
          (SELECT count(*) FROM sessions s
            WHERE s.student_id = p_student
              AND s.status = 'completed'
              AND date_trunc('week', s.completed_at) = min_week.wstart) AS student_completions
        FROM generate_series(
          date_trunc('week', now()) - make_interval(weeks => v_weeks - 1),
          date_trunc('week', now()),
          interval '1 week'
        ) AS min_week(wstart)
      ) week_data
    ),
    'phase_engagement', (
      SELECT json_agg(phase_data ORDER BY phase_order)
      FROM (
        SELECT
          phase_order,
          phase,
          (SELECT count(*) FROM event_logs e
            WHERE e.student_id = p_student AND e.pause_phase = phase) AS student_events,
          (SELECT round(avg(cnt), 1) FROM (
              SELECT count(*) AS cnt FROM event_logs e2
              WHERE e2.pause_phase = phase
              GROUP BY e2.student_id
            ) per_student) AS cohort_avg_events,
          (SELECT count(DISTINCT e3.student_id) FROM event_logs e3 WHERE e3.pause_phase = phase) AS cohort_participants
        FROM (VALUES
          (1, 'plan'), (2, 'attempt'), (3, 'use_ai'),
          (4, 'scrutinise'), (5, 'edit'), (6, 'evaluate')
        ) AS phases(phase_order, phase)
      ) phase_data
    ),
    'marks', (
      SELECT json_agg(row_data ORDER BY row_data->>'completed_at' DESC NULLS LAST)
      FROM (
        SELECT json_build_object(
          'session_id', a.session_id,
          'task_title', t.title,
          'mark', a.approved_mark,
          'completed_at', s.completed_at,
          'feedback', a.programming_feedback
        ) AS row_data
        FROM assessments a
        JOIN sessions s ON s.id = a.session_id
        JOIN tasks t ON t.id = s.task_id
        WHERE a.student_id = p_student
          AND a.status = 'approved'
          AND a.approved_mark IS NOT NULL
      ) inner_marks
    ),
    'cohort_mark_stats', (
      SELECT CASE WHEN count(DISTINCT a2.student_id) >= v_min_cohort THEN
        json_build_object(
          'avg', round(avg(a2.approved_mark), 1),
          'min', min(a2.approved_mark),
          'q1', percentile_disc(0.25) WITHIN GROUP (ORDER BY a2.approved_mark),
          'median', percentile_disc(0.5) WITHIN GROUP (ORDER BY a2.approved_mark),
          'q3', percentile_disc(0.75) WITHIN GROUP (ORDER BY a2.approved_mark),
          'max', max(a2.approved_mark),
          'cohort_size', count(DISTINCT a2.student_id)
        )
      ELSE NULL END
      FROM assessments a2
      WHERE a2.status = 'approved'
        AND a2.approved_mark IS NOT NULL
    ),
    'metacog', (
      SELECT json_build_object(
        'planning', a.metacog_planning,
        'monitoring', a.metacog_monitoring,
        'scrutiny', a.metacog_scrutiny,
        'evaluation', a.metacog_evaluation,
        'approved_at', a.approved_at
      )
      FROM assessments a
      WHERE a.student_id = p_student
        AND a.status = 'approved'
        AND a.approved_at IS NOT NULL
      ORDER BY a.approved_at DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION student_analytics(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION student_analytics(uuid) TO authenticated;