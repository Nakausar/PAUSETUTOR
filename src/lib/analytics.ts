import { supabase } from './supabase';
import type { MetacognitiveRating } from './types';

export type PhaseEngagement = {
  phase_order: number;
  phase: string;
  student_events: number;
  cohort_avg_events: number | null;
  cohort_participants: number;
};

export type WeeklyEngagement = {
  week_start: string;
  student_events: number;
  cohort_avg_events: number | null;
  student_ai_requests: number;
  student_attempts: number;
  student_scrutiny: number;
  student_completions: number;
};

export type ApprovedMark = {
  session_id: string;
  task_title: string;
  mark: number;
  completed_at: string | null;
  feedback: string | null;
};

export type CohortMarkStats = {
  avg: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  cohort_size: number;
} | null;

export type StudentAnalytics = {
  student: {
    sessions: number;
    completed_tasks: number;
    assigned_tasks: number;
    ai_requests: number;
    independent_attempts: number;
    scrutiny_activities: number;
    code_runs: number;
    total_events: number;
  };
  weekly: WeeklyEngagement[];
  phase_engagement: PhaseEngagement[];
  marks: ApprovedMark[];
  cohort_mark_stats: CohortMarkStats;
  metacog: {
    planning: MetacognitiveRating | null;
    monitoring: MetacognitiveRating | null;
    scrutiny: MetacognitiveRating | null;
    evaluation: MetacognitiveRating | null;
    approved_at: string | null;
  } | null;
};

/**
 * Fetches the signed-in student's own analytics plus privacy-safe cohort
 * aggregates from the `student_analytics` SQL function (SECURITY DEFINER,
 * aggregates only, cohort mark stats suppressed below 3 students).
 * The function rejects any id other than the caller's own auth.uid().
 */
export async function fetchStudentAnalytics(studentId: string): Promise<StudentAnalytics | null> {
  const { data } = await supabase.rpc('student_analytics', { p_student: studentId });
  if (!data) return null;
  return data as StudentAnalytics;
}