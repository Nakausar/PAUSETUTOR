/**
 * TNA / sequence-analysis codebook (version 1).
 *
 * Maps raw event_logs rows to a compact action alphabet for Transition Network
 * Analysis (e.g. the `tna` R package) and sequence analysis (e.g. TraMineR).
 * Events that are system bookkeeping (AI_RESPONSE, PHASE_*, ...) or carry no
 * learner action are dropped. Change the mapping here only, and bump the
 * version so exported files say which codebook produced them.
 */
import { lineSimilarity, extractCodeBlocks } from './provenance';

export const TNA_CODEBOOK_VERSION = 1;

export interface EventRow {
  id: string;
  session_id: string | null;
  participant_id: string;
  task_id: string | null;
  timestamp: string;
  pause_phase: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
}

/** Action alphabet with a one-line definition each (for the methods section). */
export const TNA_ACTIONS: Record<string, string> = {
  Plan: 'Submitted or revised a plan (PLAN_SUBMITTED, PLAN_REVISED)',
  Edit: 'Changed code; one per 15-second autosave with changes (CODE_AUTOSAVED)',
  Run: 'Ran code without an error (CODE_RUN)',
  Error: 'Ran code and got an error in their code (ERROR)',
  Test: 'Ran the visible test cases (TEST)',
  AskHint: 'Requested a hint from the AI (HINT_REQUEST)',
  AskDebug: 'Requested debugging help (DEBUG_REQUEST)',
  AskSolution: 'Requested a complete solution (SOLUTION_REQUEST)',
  AskOther: 'Other AI request: concept, approach review, error explanation or question (TARGETED_QUESTION and other request types)',
  FollowUp: 'Asked a follow-up question within an AI interaction (AI_FOLLOWUP_REQUEST)',
  CopyAI: 'Copied text from an AI response (AI_RESPONSE_COPIED)',
  PasteAI: 'Pasted AI-originated text into the code editor (TEXT_PASTED, field=code, provenance != none)',
  Paste: 'Pasted text from another source into the code editor (TEXT_PASTED, field=code, provenance = none)',
  Scrutinise: 'Submitted a scrutiny judgment of an AI response (SCRUTINISE_SUBMITTED)',
  Accept: 'Accepted an AI suggestion (AI_SUGGESTION_ACCEPTED)',
  Modify: 'Modified an AI suggestion (AI_SUGGESTION_MODIFIED)',
  Reject: 'Rejected an AI suggestion (AI_SUGGESTION_REJECTED)',
  Revise: 'Saved a code revision (CODE_REVISED, INDEPENDENT_REVISION)',
  Evaluate: 'Submitted the final reflection (REFLECTION_SUBMITTED)',
  Away: 'Left the PAUSE tab/window for at least 5 seconds (FOCUS_LOST)',
  Idle: 'No activity for at least 60 seconds (IDLE_STARTED)',
};

const DIRECT: Record<string, string> = {
  PLAN_SUBMITTED: 'Plan', PLAN_REVISED: 'Plan',
  CODE_AUTOSAVED: 'Edit',
  CODE_RUN: 'Run', ERROR: 'Error',
  TEST: 'Test',
  HINT_REQUEST: 'AskHint', DEBUG_REQUEST: 'AskDebug', SOLUTION_REQUEST: 'AskSolution',
  TARGETED_QUESTION: 'AskOther', EXPLANATION_REQUEST: 'AskOther', APPROACH_REVIEW_REQUEST: 'AskOther', ERROR_EXPLANATION_REQUEST: 'AskOther',
  AI_FOLLOWUP_REQUEST: 'FollowUp',
  AI_RESPONSE_COPIED: 'CopyAI',
  SCRUTINISE_SUBMITTED: 'Scrutinise',
  AI_SUGGESTION_ACCEPTED: 'Accept', AI_SUGGESTION_MODIFIED: 'Modify', AI_SUGGESTION_REJECTED: 'Reject',
  CODE_REVISED: 'Revise', INDEPENDENT_REVISION: 'Revise',
  REFLECTION_SUBMITTED: 'Evaluate',
  FOCUS_LOST: 'Away',
  IDLE_STARTED: 'Idle',
};

/** Maps one event to an action, or null when it is not a learner action. */
export function toAction(e: EventRow): string | null {
  if (e.event_type === 'TEXT_PASTED') {
    const meta = e.metadata ?? {};
    if (meta.field !== 'code') return null;
    return meta.provenance && meta.provenance !== 'none' ? 'PasteAI' : 'Paste';
  }
  if (e.event_type === 'TEST' && (e.metadata ?? {}).system_error) return null;
  return DIRECT[e.event_type] ?? null;
}

export interface SequenceStep {
  session_id: string;
  participant_id: string;
  task_id: string;
  order: number;
  timestamp: string;
  action: string;
  phase: string;
  event_type: string;
  codebook_version: number;
}

/** Long format: one row per action, ordered within each session. */
export function buildLongSequences(events: EventRow[]): SequenceStep[] {
  const sorted = [...events]
    .filter((e) => e.session_id)
    .sort((a, b) => (a.session_id! < b.session_id! ? -1 : a.session_id! > b.session_id! ? 1 : a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)));
  const out: SequenceStep[] = [];
  const counters = new Map<string, number>();
  for (const e of sorted) {
    const action = toAction(e);
    if (!action) continue;
    const order = (counters.get(e.session_id!) ?? 0) + 1;
    counters.set(e.session_id!, order);
    out.push({
      session_id: e.session_id!, participant_id: e.participant_id, task_id: e.task_id ?? '', order,
      timestamp: e.timestamp, action, phase: e.pause_phase, event_type: e.event_type, codebook_version: TNA_CODEBOOK_VERSION,
    });
  }
  return out;
}

/** Wide format: one row per session, columns T1..Tn (what tna::tna() and TraMineR::seqdef() expect). */
export function buildWideSequences(steps: SequenceStep[]): Record<string, string | number>[] {
  const bySession = new Map<string, SequenceStep[]>();
  for (const s of steps) bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), s]);
  const maxLen = Math.max(0, ...[...bySession.values()].map((v) => v.length));
  return [...bySession.entries()].map(([sessionId, seq]) => {
    const row: Record<string, string | number> = { session_id: sessionId, participant_id: seq[0].participant_id, task_id: seq[0].task_id, length: seq.length };
    for (let i = 0; i < maxLen; i++) row[`T${i + 1}`] = seq[i]?.action ?? '';
    return row;
  });
}

export interface SessionRelianceRow {
  session_id: string;
  participant_id: string;
  task_id: string;
  ai_requests: number;
  solution_requests: number;
  followups: number;
  ai_copies: number;
  code_pastes: number;
  code_pastes_from_ai: number;
  pasted_chars_from_ai: number;
  autosaves: number;
  chars_typed_estimate: number;
  runs: number;
  errors: number;
  test_runs: number;
  last_test_pass_rate: number | '';
  away_count: number;
  away_total_seconds: number;
  idle_count: number;
  idle_total_seconds: number;
  final_code_ai_similarity: number | '';
  codebook_version: number;
}

/**
 * One row per session with AI-reliance indicators for RQ2, including how
 * similar the final code is to code blocks in the session's AI responses
 * (share of identical non-empty lines, 0–1).
 */
export function buildRelianceSummary(
  events: EventRow[],
  finalCodeBySession: Map<string, string>,
  aiResponsesBySession: Map<string, string[]>,
): SessionRelianceRow[] {
  const bySession = new Map<string, EventRow[]>();
  for (const e of events) if (e.session_id) bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), e]);
  const rows: SessionRelianceRow[] = [];
  for (const [sessionId, evs] of bySession) {
    const count = (type: string) => evs.filter((e) => e.event_type === type).length;
    const meta = (e: EventRow) => e.metadata ?? {};
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const codePastes = evs.filter((e) => e.event_type === 'TEXT_PASTED' && meta(e).field === 'code');
    const aiPastes = codePastes.filter((e) => meta(e).provenance && meta(e).provenance !== 'none');
    const autosaves = evs.filter((e) => e.event_type === 'CODE_AUTOSAVED');
    const tests = evs.filter((e) => e.event_type === 'TEST' && !meta(e).system_error).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const lastTest = tests[tests.length - 1];
    const returns = evs.filter((e) => e.event_type === 'FOCUS_RETURNED');
    const idleEnds = evs.filter((e) => e.event_type === 'IDLE_ENDED');
    const finalCode = finalCodeBySession.get(sessionId) ?? '';
    const aiCode = (aiResponsesBySession.get(sessionId) ?? []).map(extractCodeBlocks).filter(Boolean);
    const similarity = finalCode && aiCode.length > 0 ? Math.max(...aiCode.map((c) => lineSimilarity(finalCode, c))) : '';
    const pastedAiChars = aiPastes.reduce((sum, e) => sum + num(meta(e).length), 0);
    rows.push({
      session_id: sessionId,
      participant_id: evs[0].participant_id,
      task_id: evs[0].task_id ?? '',
      ai_requests: evs.filter((e) => ['HINT_REQUEST', 'DEBUG_REQUEST', 'SOLUTION_REQUEST', 'TARGETED_QUESTION', 'EXPLANATION_REQUEST', 'APPROACH_REVIEW_REQUEST', 'ERROR_EXPLANATION_REQUEST'].includes(e.event_type)).length,
      solution_requests: count('SOLUTION_REQUEST'),
      followups: count('AI_FOLLOWUP_REQUEST'),
      ai_copies: count('AI_RESPONSE_COPIED'),
      code_pastes: codePastes.length,
      code_pastes_from_ai: aiPastes.length,
      pasted_chars_from_ai: pastedAiChars,
      autosaves: autosaves.length,
      // Characters added across autosaves minus characters that arrived by paste: a rough typing estimate.
      chars_typed_estimate: Math.max(0, autosaves.reduce((sum, e) => sum + num(meta(e).chars_added), 0) - codePastes.reduce((sum, e) => sum + num(meta(e).length), 0)),
      // A run that fails is logged as ERROR instead of CODE_RUN, so runs = both.
      runs: count('CODE_RUN') + count('ERROR'),
      errors: count('ERROR'),
      test_runs: tests.length,
      last_test_pass_rate: lastTest && num(meta(lastTest).total) > 0 ? Math.round((num(meta(lastTest).passed) / num(meta(lastTest).total)) * 100) / 100 : '',
      away_count: returns.length,
      away_total_seconds: Math.round(returns.reduce((sum, e) => sum + num(meta(e).away_ms), 0) / 1000),
      idle_count: idleEnds.length,
      idle_total_seconds: Math.round(idleEnds.reduce((sum, e) => sum + num(meta(e).idle_ms), 0) / 1000),
      final_code_ai_similarity: similarity,
      codebook_version: TNA_CODEBOOK_VERSION,
    });
  }
  return rows;
}
