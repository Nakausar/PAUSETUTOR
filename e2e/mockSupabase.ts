/**
 * In-memory stand-in for Supabase (auth, REST tables and the ai-tutor edge
 * function) so browser tests can run the real app without a live project.
 * Supports the subset of PostgREST the app uses: eq / is.null / gte filters,
 * limit, inserts, updates, single-object responses and the sessions→tasks embed.
 */
import type { Page } from '@playwright/test';

export const SUPABASE_URL = 'http://localhost:54321';

type Row = Record<string, unknown>;
export type MockDb = Record<string, Row[]>;

export interface AiReplyResult {
  interaction?: Row;
  status?: number;
  body?: unknown;
}

export interface MockOptions {
  user: { id: string; email: string };
  aiReply?: (body: Record<string, unknown>, db: MockDb) => AiReplyResult;
}

export interface MockLog {
  functionCalls: Record<string, unknown>[];
}

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns']);

function matches(row: Row, params: [string, string][]): boolean {
  for (const [key, value] of params) {
    if (SKIP.has(key)) continue;
    if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false;
    if (value === 'is.null' && row[key] != null) return false;
    if (value.startsWith('gte.') && !(String(row[key]) >= value.slice(4))) return false;
  }
  return true;
}

export async function installMockSupabase(page: Page, db: MockDb, options: MockOptions): Promise<MockLog> {
  const log: MockLog = { functionCalls: [] };
  const user = { ...options.user, aud: 'authenticated', role: 'authenticated' };
  const session = {
    access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  // supabase-js reads the signed-in session from localStorage (key: sb-<host>-auth-token).
  await page.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), session);

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(url.pathname.endsWith('/user') ? user : session);

    if (url.pathname === '/functions/v1/ai-tutor') {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      log.functionCalls.push(body);
      const result = options.aiReply?.(body, db) ?? { status: 500, body: { error: 'No AI reply configured in test' } };
      if (!result.interaction) return json(result.body, result.status ?? 500);
      (db.ai_interactions ??= []).push(result.interaction);
      return json({ response: result.interaction.response, placeholder: false, interaction: result.interaction });
    }

    const table = url.pathname.replace('/rest/v1/', '');
    const rows = (db[table] ??= []);
    const params = [...url.searchParams.entries()];
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const embedTask = table === 'sessions' && (url.searchParams.get('select') || '').includes('task:tasks');
    const shape = (r: Row) => (embedTask ? { ...r, task: (db.tasks ?? []).find((t) => t.id === r.task_id) } : r);
    const reply = (result: Row[]) => {
      if (!wantsObject) return json(result.map(shape));
      if (result.length === 0) return json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }, 406);
      return json(shape(result[0]));
    };

    if (method === 'GET' || method === 'HEAD') {
      let result = rows.filter((r) => matches(r, params));
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit) result = result.slice(0, limit);
      return reply(result);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as Row | Row[];
      const now = new Date().toISOString();
      const items = (Array.isArray(body) ? body : [body]).map((b) => ({ id: newId(), created_at: now, timestamp: now, started_at: now, ...b }));
      rows.push(...items);
      return reply(items);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}') as Row;
      const result = rows.filter((r) => matches(r, params));
      for (const r of result) Object.assign(r, body);
      return reply(result);
    }
    return json([]);
  });
  return log;
}

/** A student, a task with one visible test, and a session in the given phase. */
export function studentFixture(phase: string, overrides: Partial<{ runCount: number; startedMinutesAgo: number; code: string; aiInteractions: Row[] }> = {}): MockDb {
  return {
    profiles: [{ id: 'student-1', email: 'student@example.org', role: 'student', participant_id: 'P-TEST01', consent_acknowledged: true }],
    tasks: [{
      id: 'task-1', title: 'Even numbers', language: 'python', difficulty: 'beginner', learning_objectives: 'loops',
      problem_description: 'Read n and print the even numbers below n, one per line.', expected_inputs: 'n', expected_outputs: 'even numbers',
      concept_tags: 'loops', starter_code: '', test_cases: [{ input: '5', expected: '0\n2\n4' }],
    }],
    sessions: [{ id: 'sess-1', task_id: 'task-1', student_id: 'student-1', participant_id: 'P-TEST01', current_phase: phase, status: 'in_progress' }],
    plans: [{ id: 'plan-1', session_id: 'sess-1', plan_text: 'Loop up to n and print even numbers', confidence: 3, version: 1, created_at: '2026-11-06T09:00:00Z' }],
    code_attempts: [{
      id: 'att-1', session_id: 'sess-1', current_code: overrides.code ?? 'n = int(input())\n', run_count: overrides.runCount ?? 0, revision_count: 0,
      started_at: new Date(Date.now() - (overrides.startedMinutesAgo ?? 0) * 60000).toISOString(),
    }],
    ai_interactions: overrides.aiInteractions ?? [],
    scrutiny_responses: [], event_logs: [], code_snapshots: [], task_assignments: [],
    system_settings: [{ id: 1, research_logging_enabled: true, solution_min_runs: 1, solution_min_minutes: 3, solution_requires_reason: true, max_followups: 2 }],
  };
}

export const eventTypes = (db: MockDb) => (db.event_logs ?? []).map((e) => e.event_type as string);
