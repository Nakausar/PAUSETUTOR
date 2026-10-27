// Unit tests for the pure temporal algorithms, using small hand-verified sequences.
// Run: npx tsx src/lib/temporal/analysis.test.ts

import {
  orderEvents, dedupeEvents, buildPhaseSequence, computeTransitionMatrix,
  computeSessionDurations, computeSessionIntervals, buildStepTokens, discoverSequences,
  aiOptionFrequency, repeatedAiPerSession, gradeBandFor, compareByGradeBand,
} from './analysis';
import type { StepToken } from './analysis';
import type { EventLog, AIInteraction, ScrutinyResponse, Assessment, Session } from '../types';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
  else console.log(`ok   ${name}`);
}

let idSeq = 0;
function ev(partial: Partial<EventLog> & { timestamp: string; event_type: EventLog['event_type'] }): EventLog {
  idSeq++;
  return {
    id: partial.id ?? `e${String(idSeq).padStart(3, '0')}`,
    participant_id: 'P1', student_id: 's1', session_id: 'sess1', task_id: 't1',
    pause_phase: 'attempt', event_description: 'desc', code_snapshot_id: null, ai_interaction_id: null,
    metadata: {}, ...partial,
  } as EventLog;
}

function mkInteraction(partial: Partial<AIInteraction>): AIInteraction {
  return {
    id: 'ai', session_id: 'sess1', student_id: 's1', participant_id: 'P1',
    category: 'hint', prompt: '', response: '', context_code: null, context_error: null,
    context_plan: null, full_solution_requested: false, created_at: '2026-01-01T00:00:00Z', ...partial,
  } as AIInteraction;
}

function mkScrutiny(partial: Partial<ScrutinyResponse>): ScrutinyResponse {
  return {
    id: 'sc', session_id: 'sess1', student_id: 's1', participant_id: 'P1', ai_interaction_id: 'ai',
    accuracy_judgment: '', intended_action: '', critique_text: '', action_taken: 'accepted',
    revised_code: '', code_before: '', code_after: '', test_result: '', produced_expected_result: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...partial,
  } as ScrutinyResponse;
}

// --- orderEvents ---
{
  const input = [
    ev({ id: 'b', timestamp: '2026-01-01T00:01:00Z', event_type: 'CODE_RUN' }),
    ev({ id: 'a', timestamp: '2026-01-01T00:00:00Z', event_type: 'PLAN_SUBMITTED' }),
    ev({ id: 'c', timestamp: '2026-01-01T00:01:00Z', event_type: 'CODE_RUN' }),
  ];
  check('orderEvents chronological with stable tie-break', orderEvents(input).map((e) => e.id), ['a', 'b', 'c']);
}
{
  const dropped = orderEvents([
    ev({ id: 'x', timestamp: 'not-a-date', event_type: 'CODE_RUN' }),
    ev({ id: 'y', timestamp: '2026-01-01T00:00:00Z', event_type: 'CODE_RUN' }),
  ]);
  check('orderEvents drops unparseable timestamps', dropped.length, 1);
}

// --- dedupeEvents ---
{
  const a = ev({ timestamp: '2026-01-01T00:00:00Z', event_type: 'PHASE_ENTERED', event_description: 'x' });
  const b = ev({ timestamp: '2026-01-01T00:00:01.500Z', event_type: 'PHASE_ENTERED', event_description: 'x' });
  const { kept, duplicateCount } = dedupeEvents([a, b]);
  check('dedupe collapses near-identical events within 2s', { n: kept.length, duplicates: duplicateCount }, { n: 1, duplicates: 1 });
}
{
  const a = ev({ timestamp: '2026-01-01T00:00:00Z', event_type: 'CODE_RUN', event_description: 'run 1' });
  const b = ev({ timestamp: '2026-01-01T00:00:01Z', event_type: 'CODE_RUN', event_description: 'run 2' });
  check('dedupe keeps genuinely distinct events', dedupeEvents([a, b]).kept.length, 2);
}

// --- buildPhaseSequence ---
{
  const steps = buildPhaseSequence([
    ev({ timestamp: '2026-01-01T00:00:00Z', pause_phase: 'plan', event_type: 'PLAN_SUBMITTED' }),
    ev({ timestamp: '2026-01-01T00:05:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
    ev({ timestamp: '2026-01-01T00:06:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
  ]);
  check('buildPhaseSequence contiguous runs', steps.map((s) => s.phase), ['plan', 'attempt']);
  check('buildPhaseSequence counts events per run', steps[1].eventCount, 2);
}
{
  const steps = buildPhaseSequence([
    ev({ timestamp: '2026-01-01T00:00:00Z', pause_phase: 'scrutinise', event_type: 'AI_SUGGESTION_ACCEPTED' }),
    ev({ timestamp: '2026-01-01T00:03:00Z', pause_phase: 'edit', event_type: 'CODE_REVISED' }),
    ev({ timestamp: '2026-01-01T00:04:00Z', pause_phase: 'evaluate', event_type: 'REFLECTION_SUBMITTED' }),
  ]);
  check('buildPhaseSequence preserves historical edit phase', steps.map((s) => s.phase), ['scrutinise', 'edit', 'evaluate']);
}

// --- computeTransitionMatrix ---
{
  const mk = (ts: string, phase: EventLog['pause_phase'], session: string) =>
    ev({ timestamp: ts, pause_phase: phase, session_id: session, event_type: 'PHASE_ENTERED' });
  const eventsBySession = new Map<string, EventLog[]>([
    ['s1', [
      mk('2026-01-01T00:00:00Z', 'plan', 's1'),
      mk('2026-01-01T00:05:00Z', 'attempt', 's1'),
      mk('2026-01-01T00:10:00Z', 'plan', 's1'),
    ]],
    ['s2', [
      mk('2026-01-01T00:00:00Z', 'plan', 's2'),
      mk('2026-01-01T00:04:00Z', 'attempt', 's2'),
    ]],
  ]);
  const m = computeTransitionMatrix(eventsBySession);
  const pi = new Map(m.phases.map((p, i) => [p, i]));
  check('transition matrix plan→attempt counts both sessions', m.counts[pi.get('plan')!][pi.get('attempt')!], 2);
  check('transition matrix attempt→plan backward counted', m.counts[pi.get('attempt')!][pi.get('plan')!], 1);
  check('transition matrix probability plan row', m.probabilities[pi.get('plan')!][pi.get('attempt')!], 1);
  check('transition matrix forward total', m.forward, 2);
  check('transition matrix backward total', m.backward, 1);
}

// --- computeSessionDurations ---
{
  // plan 10:00→10:10 (10 min), attempt 10:10→10:40 (30 min via completed_at).
  // Observed total 40 min; active capped at 5 min per segment = 10 min.
  const events = [
    ev({ timestamp: '2026-01-01T10:00:00Z', pause_phase: 'plan', event_type: 'PLAN_SUBMITTED' }),
    ev({ timestamp: '2026-01-01T10:10:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
  ];
  const d = computeSessionDurations('sess1', events, '2026-01-01T10:40:00Z');
  check('durations observed 40 min', d.observedMs, 40 * 60000);
  check('durations active capped to 10 min (2 segments x 5 min cap)', d.activeMs, 2 * 5 * 60000);
  check('durations per-phase attempt observed 30 min', Math.round(d.perPhase.attempt.observedMs / 60000), 30);
}
{
  const d = computeSessionDurations('sess1', [], null);
  check('durations empty events -> nulls', { observed: d.observedMs, first: d.firstTs }, { observed: null, first: null });
}

// --- computeSessionIntervals ---
{
  const interactions = [
    mkInteraction({ id: 'ai1', created_at: '2026-01-01T11:00:00Z' }),
    mkInteraction({ id: 'ai2', category: 'debug', created_at: '2026-01-01T11:10:00Z' }),
  ];
  const scrutiny = [mkScrutiny({ id: 'sc1', ai_interaction_id: 'ai1', created_at: '2026-01-01T11:04:00Z' })];
  const events = [
    ev({ timestamp: '2026-01-01T10:30:00Z', pause_phase: 'plan', event_type: 'PLAN_SUBMITTED' }),
    ev({ timestamp: '2026-01-01T10:50:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
    ev({ timestamp: '2026-01-01T11:06:00Z', pause_phase: 'scrutinise', event_type: 'CODE_RUN' }),
  ];
  const iv = computeSessionIntervals('sess1', events, interactions, scrutiny);
  check('intervals plan→first code = 20 min', iv.planToFirstCodeMs, 20 * 60000);
  check('intervals first code→first AI = 10 min', iv.firstCodeToFirstAiMs, 10 * 60000);
  check('intervals AI request gap = 10 min', iv.aiRequestGapsMs, [10 * 60000]);
  check('intervals request→scrutiny = 4 min', iv.scrutinyAfterRequestMs, [4 * 60000]);
  check('intervals scrutiny→code = 2 min', iv.codeAfterScrutinyMs, [2 * 60000]);
  check('intervals aiRequestCount = 2', iv.aiRequestCount, 2);
  check('intervals scrutinyCycles = 1', iv.scrutinyCycles, 1);
}
{
  // Student who never used AI: null intervals, no fabricated durations.
  const iv = computeSessionIntervals('sess1', [ev({ timestamp: '2026-01-01T10:00:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' })], [], []);
  check('intervals no-AI student -> null firstCodeToFirstAi', iv.firstCodeToFirstAiMs, null);
  check('intervals no-AI student -> zero requests', iv.aiRequestCount, 0);
}

// --- buildStepTokens ---
{
  const interactions = [mkInteraction({ created_at: '2026-01-01T11:00:00Z' })];
  const scrutiny = [mkScrutiny({ created_at: '2026-01-01T11:04:00Z' })];
  const events = [
    ev({ timestamp: '2026-01-01T10:30:00Z', pause_phase: 'plan', event_type: 'PLAN_SUBMITTED' }),
    ev({ timestamp: '2026-01-01T10:50:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
    ev({ timestamp: '2026-01-01T11:06:00Z', pause_phase: 'scrutinise', event_type: 'CODE_RUN' }),
  ];
  check('buildStepTokens pathway tokens', buildStepTokens(events, interactions, scrutiny), ['PLAN', 'IND_CODE', 'AI_REQ', 'SCRUTINY', 'TEST']);
}
{
  const collapsed = buildStepTokens([
    ev({ timestamp: '2026-01-01T10:50:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
    ev({ timestamp: '2026-01-01T10:55:00Z', pause_phase: 'attempt', event_type: 'CODE_RUN' }),
  ], [], []);
  check('buildStepTokens collapses consecutive duplicates', collapsed, ['IND_CODE']);
}

// --- discoverSequences ---
{
  const tokens = new Map<string, { tokens: StepToken[]; participantId: string }>([
    ['sessA', { tokens: ['PLAN', 'IND_CODE', 'AI_REQ', 'SCRUTINY'], participantId: 'P1' }],
    ['sessB', { tokens: ['PLAN', 'IND_CODE', 'AI_REQ'], participantId: 'P2' }],
    ['sessC', { tokens: ['AI_REQ'], participantId: 'P3' }],
  ]);
  const patterns = discoverSequences(tokens, 2, 2, 2);
  const top = patterns[0];
  check('discoverSequences finds frequent bigram', top.sequence, 'PLAN → IND_CODE');
  check('discoverSequences bigram count', top.count, 2);
  check('discoverSequences participant count', top.participants, 2);
  check('discoverSequences excludes below-threshold', patterns.some((p) => p.sequence === 'AI_REQ → SCRUTINY'), false);
}

// --- aiOptionFrequency ---
{
  const labels = { hint: 'Hint', debug: 'Debug help' };
  const interactions = [
    mkInteraction({ id: '1', category: 'hint', student_id: 's1' }),
    mkInteraction({ id: '2', category: 'hint', student_id: 's2' }),
    mkInteraction({ id: '3', category: 'debug', student_id: 's1' }),
  ];
  const rows = aiOptionFrequency(interactions, labels);
  check('aiOptionFrequency counts and pct', rows.map((r) => ({ c: r.category, n: r.requests, pct: Math.round(r.pctOfRequests) })), [
    { c: 'hint', n: 2, pct: 67 }, { c: 'debug', n: 1, pct: 33 },
  ]);
  check('aiOptionFrequency distinct students', rows[0].students, 2);
}

// --- repeatedAiPerSession ---
{
  const labels = { hint: 'Hint', debug: 'Debug help' };
  const interactions = [
    mkInteraction({ id: '1', session_id: 'sA', category: 'hint', participant_id: 'P9', created_at: '2026-01-01T00:00:00Z' }),
    mkInteraction({ id: '2', session_id: 'sA', category: 'hint', created_at: '2026-01-01T00:01:00Z' }),
    mkInteraction({ id: '3', session_id: 'sB', category: 'debug', participant_id: 'P8', created_at: '2026-01-01T00:02:00Z' }),
  ];
  const rows = repeatedAiPerSession(interactions, [], labels);
  check('repeated option detected with count', { pid: rows[0].participantId, opt: rows[0].repeatedOption, n: rows[0].repeatedOptionCount, total: rows[0].totalRequests }, { pid: 'P9', opt: 'Hint', n: 2, total: 2 });
  check('single-use options show no repetition', rows[1].repeatedOption, null);
}

// --- gradeBandFor ---
{
  check('gradeBand boundaries', [0, 49, 50, 69, 70, 84, 85, 100].map(gradeBandFor), ['0–49', '0–49', '50–69', '50–69', '70–84', '70–84', '85–100', '85–100']);
}

// --- compareByGradeBand ---
{
  const sessions = [
    { id: 's1', participant_id: 'P1', status: 'completed' } as Session,
    { id: 's2', participant_id: 'P2', status: 'completed' } as Session,
    { id: 's3', participant_id: 'P3', status: 'completed' } as Session,
  ];
  const assessments = [
    { session_id: 's1', status: 'approved', approved_mark: 92 } as Assessment,
    { session_id: 's2', status: 'pending', approved_mark: null } as Assessment,
    { session_id: 's3', status: 'approved', approved_mark: 40 } as Assessment,
  ];
  const emptyMap = new Map();
  const { rows, gradedCount, ungradedCount } = compareByGradeBand(
    sessions, assessments,
    emptyMap as Map<string, ReturnType<typeof computeSessionDurations>>,
    emptyMap as Map<string, ReturnType<typeof computeSessionIntervals>>,
  );
  check('grade bands use only approved marks', { graded: gradedCount, ungraded: ungradedCount }, { graded: 2, ungraded: 1 });
  check('band assignment 92→85–100, 40→0–49', rows.map((r) => r.sessions), [1, 0, 0, 1]);
}

console.log(failures === 0 ? '\nAll temporal tests passed.' : `\n${failures} test(s) FAILED.`);
if (failures > 0) process.exit(1);
