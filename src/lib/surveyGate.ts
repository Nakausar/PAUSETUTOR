import { supabase } from './supabase';
import type { Survey } from './surveys';

export interface SurveyStatus {
  /** Active questionnaires this student still has to fill in (post surveys only once all tasks are done). */
  pending: Survey[];
  /** Pending pre-surveys marked "required before tasks": starting a task is blocked until they are submitted. */
  blocking: Survey[];
}

/**
 * Which questionnaires a student should see now.
 * @param allTasksCompleted whether the student has completed all assigned tasks (and has at least one).
 */
export async function loadSurveyStatus(studentId: string, allTasksCompleted: boolean): Promise<SurveyStatus> {
  const [surveys, responses] = await Promise.all([
    supabase.from('surveys').select('*').eq('active', true).order('created_at', { ascending: true }),
    supabase.from('survey_responses').select('survey_id').eq('student_id', studentId),
  ]);
  // If the survey tables do not exist yet (database update not applied), show nothing and block nothing.
  if (surveys.error) return { pending: [], blocking: [] };
  const done = new Set((responses.data ?? []).map((r) => (r as { survey_id: string }).survey_id));
  const open = ((surveys.data ?? []) as Survey[]).filter((s) => !done.has(s.id));
  const pending = open.filter((s) => s.kind !== 'post' || allTasksCompleted);
  return { pending, blocking: pending.filter((s) => s.kind === 'pre' && s.required_before_tasks) };
}
