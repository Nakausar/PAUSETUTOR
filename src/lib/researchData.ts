import { supabase } from './supabase';
import type { AIInteraction, Assessment, CodeSnapshot, EventLog, Plan, Reflection, ScrutinyResponse, Session } from './types';

export interface SessionRow extends Session {
  task_title?: string;
  task_difficulty?: string;
  task_language?: string;
}

export interface ParticipantRow {
  id: string;
  participant_id: string;
}

export interface TaskRow {
  id: string;
  title: string;
  difficulty: string;
  language: string;
}

export interface ResearchBundle {
  participants: ParticipantRow[];
  tasks: TaskRow[];
  sessions: SessionRow[];
  events: EventLog[];
  aiInteractions: AIInteraction[];
  scrutiny: ScrutinyResponse[];
  reflections: Reflection[];
  plans: Plan[];
  assessments: Assessment[];
  codeSnapshots: CodeSnapshot[];
}

export interface ResearchFilters {
  participantId: string;
  taskId: string;
  sessionId: string;
  from: string;
  to: string;
  status: string;
}

export const EMPTY_FILTERS: ResearchFilters = { participantId: 'all', taskId: 'all', sessionId: 'all', from: '', to: '', status: 'all' };

/**
 * Loads all research tables once for the researcher analytics platform.
 * RLS on every table already restricts reads to the researcher role, and
 * only pseudonymous fields are requested here (no emails, no user ids
 * are rendered in the UI).
 */
export async function loadResearchData(): Promise<ResearchBundle | null> {
  const [profiles, tasks, sessions, events, ai, scrutiny, reflections, plans, assessments, snapshots] = await Promise.all([
    supabase.from('profiles').select('id, participant_id').eq('role', 'student'),
    supabase.from('tasks').select('id, title, difficulty, language'),
    supabase.from('sessions').select('*, task:tasks(title, difficulty, language)'),
    supabase.from('event_logs').select('*').order('timestamp', { ascending: true }),
    supabase.from('ai_interactions').select('id, session_id, participant_id, category, prompt, response, created_at'),
    supabase.from('scrutiny_responses').select('*'),
    supabase.from('reflections').select('*'),
    supabase.from('plans').select('*'),
    supabase.from('assessments').select('*'),
    supabase.from('code_snapshots').select('id, session_id, phase, trigger, code, output, error, run_number, created_at'),
  ]);

  if (profiles.error || sessions.error || events.error) return null;

  return {
    participants: (profiles.data ?? []) as ParticipantRow[],
    tasks: (tasks.data ?? []) as TaskRow[],
    sessions: ((sessions.data ?? []) as (Session & { task?: { title: string; difficulty: string; language: string } })[]).map((s) => ({
      ...s,
      task_title: s.task?.title,
      task_difficulty: s.task?.difficulty,
      task_language: s.task?.language,
    })),
    events: (events.data ?? []) as EventLog[],
    aiInteractions: (ai.data ?? []) as AIInteraction[],
    scrutiny: ((scrutiny.data ?? []) as ScrutinyResponse[]),
    reflections: (reflections.data ?? []) as Reflection[],
    plans: (plans.data ?? []) as Plan[],
    assessments: (assessments.data ?? []) as Assessment[],
    codeSnapshots: (snapshots.data ?? []) as CodeSnapshot[],
  };
}

/** Applies the researcher's participant/task/date/status filters to all child rows via session membership. */
export function filterBundle(bundle: ResearchBundle, f: ResearchFilters): ResearchBundle {
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return true;
    if (f.from && t < new Date(f.from).getTime()) return false;
    if (f.to && t > new Date(f.to + 'T23:59:59').getTime()) return false;
    return true;
  };

  const partId = f.participantId === 'all' ? null : bundle.participants.find((p) => p.id === f.participantId)?.participant_id ?? null;

  const sessions = bundle.sessions.filter((s) => {
    if (partId && s.participant_id !== partId) return false;
    if (f.taskId !== 'all' && s.task_id !== f.taskId) return false;
    if (f.sessionId !== 'all' && s.id !== f.sessionId) return false;
    if (f.status === 'approved' && !bundle.assessments.some((a) => a.session_id === s.id && a.status === 'approved')) return false;
    if (f.status === 'pending' && !bundle.assessments.some((a) => a.session_id === s.id && a.status === 'pending')) return false;
    if (f.status === 'none' && bundle.assessments.some((a) => a.session_id === s.id)) return false;
    if (f.status !== 'all' && f.status !== 'approved' && f.status !== 'pending' && f.status !== 'none' && s.status !== f.status) return false;
    return inRange(s.started_at);
  });
  const sessionIds = new Set(sessions.map((s) => s.id));

  const bySession = <T extends { session_id: string }>(rows: T[]): T[] => rows.filter((r) => sessionIds.has(r.session_id));

  return {
    ...bundle,
    sessions,
    events: bySession(bundle.events),
    aiInteractions: bySession(bundle.aiInteractions),
    scrutiny: bySession(bundle.scrutiny),
    reflections: bySession(bundle.reflections),
    plans: bySession(bundle.plans),
    assessments: bundle.assessments.filter((a) => sessionIds.has(a.session_id)),
    codeSnapshots: bySession(bundle.codeSnapshots),
  };
}

export function hasActiveFilters(f: ResearchFilters): boolean {
  return f.participantId !== 'all' || f.taskId !== 'all' || f.sessionId !== 'all' || f.status !== 'all' || f.from !== '' || f.to !== '';
}