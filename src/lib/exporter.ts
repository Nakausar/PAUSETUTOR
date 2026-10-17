import { supabase } from './supabase';

type ExportCategory =
  | 'participants'
  | 'sessions'
  | 'tasks'
  | 'plans'
  | 'event_logs'
  | 'ai_interactions'
  | 'scrutiny_responses'
  | 'code_snapshots'
  | 'reflections'
  | 'task_outcomes';

interface ExportRow {
  [key: string]: unknown;
}

/** Flatten nested objects/arrays for CSV compatibility. */
function flattenRow(row: Record<string, unknown>): ExportRow {
  const out: ExportRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = '';
    } else if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = headers.join(',');
  const dataLines = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

async function fetchParticipants(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('profiles')
    .select('participant_id, role, consent_acknowledged, research_logging_enabled, created_at');
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchSessions(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('sessions')
    .select('id, participant_id, task_id, current_phase, status, started_at, completed_at, last_active_at');
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchTasks(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('tasks')
    .select('id, title, language, difficulty, learning_objectives, problem_description, expected_inputs, expected_outputs, concept_tags, created_at');
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchPlans(): Promise<ExportRow[]> {
  // Includes legacy plan fields (problem_summary, pseudocode, ...) so historical rows export fully.
  const { data } = await supabase
    .from('plans')
    .select('id, participant_id, session_id, student_id, plan_text, confidence, version, created_after_ai, problem_summary, expected_inputs, expected_outputs, concepts_needed, approach_description, pseudocode, expected_difficulty, created_at, updated_at')
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchEventLogs(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('event_logs')
    .select('id, participant_id, session_id, task_id, timestamp, pause_phase, event_type, event_description, code_snapshot_id, ai_interaction_id, metadata')
    .order('timestamp', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchAIInteractions(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('ai_interactions')
    .select('id, participant_id, session_id, category, prompt, response, context_code, context_error, full_solution_requested, created_at')
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchScrutinyResponses(): Promise<ExportRow[]> {
  // ai_interaction_id links each scrutiny record to the AI response it evaluates.
  const { data } = await supabase
    .from('scrutiny_responses')
    .select('id, participant_id, session_id, student_id, ai_interaction_id, accuracy_judgment, intended_action, critique_text, action_taken, revised_code, code_before, code_after, test_result, produced_expected_result, ai_summary, is_correct_assessment, testing_plan, changes_description, created_at, updated_at')
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchCodeSnapshots(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('code_snapshots')
    .select('id, participant_id, session_id, attempt_id, phase, trigger, code, output, error, run_number, created_at')
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchReflections(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('reflections')
    .select('id, participant_id, session_id, difficulty, perceived_independence, ai_help_reflection, ai_disagreement, ai_disagreement_text, perceived_independent_ability, most_important_learning, next_time_strategy, confidence, created_at')
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

async function fetchTaskOutcomes(): Promise<ExportRow[]> {
  const { data } = await supabase
    .from('sessions')
    .select(`
      id, participant_id, task_id, status, current_phase, started_at, completed_at,
      task:tasks(title, language, difficulty)
    `)
    .order('started_at', { ascending: true });
  return (data ?? []).map((r) => flattenRow(r as Record<string, unknown>));
}

const FETCHERS: Record<ExportCategory, () => Promise<ExportRow[]>> = {
  participants: fetchParticipants,
  sessions: fetchSessions,
  tasks: fetchTasks,
  plans: fetchPlans,
  event_logs: fetchEventLogs,
  ai_interactions: fetchAIInteractions,
  scrutiny_responses: fetchScrutinyResponses,
  code_snapshots: fetchCodeSnapshots,
  reflections: fetchReflections,
  task_outcomes: fetchTaskOutcomes,
};

export async function fetchExportData(category: ExportCategory): Promise<ExportRow[]> {
  return FETCHERS[category]();
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsCSV(rows: ExportRow[], filename: string) {
  const csv = toCSV(rows);
  downloadFile(csv, `${filename}.csv`, 'text/csv');
}

export function exportAsJSON(rows: ExportRow[], filename: string) {
  const json = JSON.stringify(rows, null, 2);
  downloadFile(json, `${filename}.json`, 'application/json');
}

export async function exportAllAsZIP() {
  // Simple: download each category as a separate file
  const categories: ExportCategory[] = [
    'participants', 'sessions', 'tasks', 'plans', 'event_logs',
    'ai_interactions', 'scrutiny_responses', 'code_snapshots', 'reflections', 'task_outcomes',
  ];
  for (const cat of categories) {
    const rows = await fetchExportData(cat);
    exportAsCSV(rows, `pause_${cat}`);
    exportAsJSON(rows, `pause_${cat}`);
  }
}

export type { ExportCategory };
