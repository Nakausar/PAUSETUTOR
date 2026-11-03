import { supabase } from './supabase';
import { TNA_ACTIONS, TNA_CODEBOOK_VERSION, buildLongSequences, buildRelianceSummary, buildWideSequences, type EventRow } from './tnaCodebook';

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
  | 'task_outcomes'
  | 'tna_long'
  | 'tna_wide'
  | 'session_ai_reliance'
  | 'tna_codebook';

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

const PAGE_SIZE = 1000;

/**
 * Reads every row of a table, 1,000 at a time. Supabase returns at most 1,000
 * rows per request, so a single query would silently cut off larger datasets.
 * Ordered by the given column and then id, so paging is stable.
 */
async function fetchAllRows(table: string, columns: string, orderBy: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not export ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchParticipants(): Promise<ExportRow[]> {
  const data = await fetchAllRows('profiles', 'participant_id, role, consent_acknowledged, research_logging_enabled, created_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchSessions(): Promise<ExportRow[]> {
  const data = await fetchAllRows('sessions', 'id, participant_id, task_id, current_phase, status, started_at, completed_at, last_active_at', 'started_at');
  return data.map(flattenRow);
}

async function fetchTasks(): Promise<ExportRow[]> {
  const data = await fetchAllRows('tasks', 'id, title, language, difficulty, learning_objectives, problem_description, expected_inputs, expected_outputs, concept_tags, created_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchPlans(): Promise<ExportRow[]> {
  // Includes legacy plan fields (problem_summary, pseudocode, ...) so historical rows export fully.
  const data = await fetchAllRows('plans', 'id, participant_id, session_id, student_id, plan_text, confidence, version, created_after_ai, problem_summary, expected_inputs, expected_outputs, concepts_needed, approach_description, pseudocode, expected_difficulty, created_at, updated_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchEventLogs(): Promise<ExportRow[]> {
  const data = await fetchAllRows('event_logs', 'id, participant_id, session_id, task_id, timestamp, pause_phase, event_type, event_description, code_snapshot_id, ai_interaction_id, metadata', 'timestamp');
  return data.map(flattenRow);
}

async function fetchAIInteractions(): Promise<ExportRow[]> {
  const data = await fetchAllRows('ai_interactions', 'id, participant_id, session_id, category, prompt, response, context_code, context_error, full_solution_requested, parent_interaction_id, turn_index, solution_reason, model, prompt_hash, prompt_tokens, completion_tokens, is_placeholder, created_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchScrutinyResponses(): Promise<ExportRow[]> {
  // ai_interaction_id links each scrutiny record to the AI response it evaluates.
  const data = await fetchAllRows('scrutiny_responses', 'id, participant_id, session_id, student_id, ai_interaction_id, accuracy_judgment, intended_action, critique_text, action_taken, revised_code, code_before, code_after, test_result, produced_expected_result, ai_summary, is_correct_assessment, testing_plan, changes_description, created_at, updated_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchCodeSnapshots(): Promise<ExportRow[]> {
  const data = await fetchAllRows('code_snapshots', 'id, participant_id, session_id, attempt_id, phase, trigger, code, output, error, run_number, stdin, created_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchReflections(): Promise<ExportRow[]> {
  const data = await fetchAllRows('reflections', 'id, participant_id, session_id, difficulty, perceived_independence, ai_help_reflection, ai_disagreement, ai_disagreement_text, perceived_independent_ability, most_important_learning, next_time_strategy, confidence, created_at', 'created_at');
  return data.map(flattenRow);
}

async function fetchTaskOutcomes(): Promise<ExportRow[]> {
  const data = await fetchAllRows('sessions', `
      id, participant_id, task_id, status, current_phase, started_at, completed_at,
      task:tasks(title, language, difficulty)
    `, 'started_at');
  return data.map(flattenRow);
}

const EVENT_COLUMNS = 'id, participant_id, session_id, task_id, timestamp, pause_phase, event_type, metadata';

async function fetchTnaLong(): Promise<ExportRow[]> {
  const events = await fetchAllRows('event_logs', EVENT_COLUMNS, 'timestamp') as unknown as EventRow[];
  return buildLongSequences(events) as unknown as ExportRow[];
}

async function fetchTnaWide(): Promise<ExportRow[]> {
  const events = await fetchAllRows('event_logs', EVENT_COLUMNS, 'timestamp') as unknown as EventRow[];
  return buildWideSequences(buildLongSequences(events));
}

async function fetchSessionReliance(): Promise<ExportRow[]> {
  const [events, attempts, interactions] = await Promise.all([
    fetchAllRows('event_logs', EVENT_COLUMNS, 'timestamp') as unknown as Promise<EventRow[]>,
    fetchAllRows('code_attempts', 'id, session_id, current_code, updated_at', 'updated_at'),
    fetchAllRows('ai_interactions', 'id, session_id, response, created_at', 'created_at'),
  ]);
  const finalCode = new Map<string, string>();
  for (const a of attempts) finalCode.set(String(a.session_id), String(a.current_code ?? ''));
  const responses = new Map<string, string[]>();
  for (const i of interactions) {
    const key = String(i.session_id);
    responses.set(key, [...(responses.get(key) ?? []), String(i.response ?? '')]);
  }
  return buildRelianceSummary(events, finalCode, responses) as unknown as ExportRow[];
}

async function fetchTnaCodebook(): Promise<ExportRow[]> {
  return Object.entries(TNA_ACTIONS).map(([action, definition]) => ({ action, definition, codebook_version: TNA_CODEBOOK_VERSION }));
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
  tna_long: fetchTnaLong,
  tna_wide: fetchTnaWide,
  session_ai_reliance: fetchSessionReliance,
  tna_codebook: fetchTnaCodebook,
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
    'tna_long', 'tna_wide', 'session_ai_reliance', 'tna_codebook',
  ];
  for (const cat of categories) {
    const rows = await fetchExportData(cat);
    exportAsCSV(rows, `pause_${cat}`);
    exportAsJSON(rows, `pause_${cat}`);
  }
}

export type { ExportCategory };
