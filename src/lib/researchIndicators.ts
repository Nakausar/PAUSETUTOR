import type { ResearchBundle } from './researchData';
import type { EventLog } from './types';

export interface IndicatorDoc {
  id: string;
  label: string;
  definition: string;
  source: string;
  formula: string;
  unit: string;
  denominator: string;
  missingRule: string;
  limitation: string;
}

/**
 * Indicator documentation. Every metric on the platform renders next to the
 * entry it matches here. Definitions are descriptive only — phase completion
 * is never treated as evidence of metacognitive quality.
 */
export const INDICATORS: IndicatorDoc[] = [
  { id: 'cohort_engagement', label: 'Cohort engagement', definition: 'Recorded interaction events per participant across sessions in scope.', source: 'event_logs', formula: 'count(events) / count(distinct participant_id)', unit: 'events per participant', denominator: 'Distinct participants with >= 1 session in scope', missingRule: 'Sessions with no events are excluded from the numerator but kept in the participant count.', limitation: 'Events reflect interface actions, not cognitive engagement.' },
  { id: 'task_completion_rate', label: 'Task completion rate', definition: 'Share of sessions that reached the completed status.', source: 'sessions.status', formula: 'count(status=completed) / count(sessions)', unit: 'percentage of sessions', denominator: 'All sessions in scope', missingRule: 'In-progress and abandoned sessions count in the denominator.', limitation: 'Completion marks workflow termination, not learning gain.' },
  { id: 'phase_participation', label: 'PAUSE phase participation', definition: 'Share of sessions with at least one recorded event in each PAUSE phase.', source: 'event_logs.pause_phase', formula: 'count(distinct session where events in phase) / count(sessions)', unit: 'percentage of sessions per phase', denominator: 'All sessions in scope', missingRule: 'A phase with zero events is non-participation, not missing data.', limitation: 'Participating in a phase is not evidence of doing so well.' },
  { id: 'phase_transitions', label: 'Phase transitions', definition: 'Most common forward movements between consecutive PAUSE phases.', source: 'PHASE_TRANSITION/PHASE_ENTERED/PHASE_EXITED events (metadata from/to)', formula: 'Frequency of each ordered pair (from, to)', unit: 'transition counts', denominator: 'All transition events in scope', missingRule: 'Transitions with unparseable or missing from/to metadata are excluded.', limitation: 'The app supports flexible navigation; backward transitions do not imply error.' },
  { id: 'phase_durations', label: 'Time between phase entry and exit', definition: 'Elapsed time between the first PHASE_ENTERED and matching PHASE_EXITED event per phase per session.', source: 'PHASE_ENTERED / PHASE_EXITED events', formula: 'median over sessions of (exit.ts - enter.ts)', unit: 'minutes (median)', denominator: 'Sessions with both entry and exit events for the phase', missingRule: 'Sessions missing either event for a phase are excluded from that phase median.', limitation: 'Wall-clock time includes idle periods; no inactivity detection exists.' },
  { id: 'attempt_first_vs_ai_first', label: 'Attempt-first vs AI-first behaviour', definition: 'Whether a session logged independent code activity (CODE_RUN or ATTEMPT events in the attempt phase) before its first AI request.', source: 'event_logs (CODE_RUN, AI_RESPONSE, ai request events), ai_interactions.created_at', formula: 'session classified attempt-first if min(attempt-activity ts) < min(ai request ts); ai-first otherwise; sessions with only one behaviour classified by that behaviour', unit: 'percentage of sessions per class', denominator: 'Sessions with at least one attempt activity OR one AI request', missingRule: 'Sessions with neither independent activity nor AI use are excluded.', limitation: 'Timestamp ordering reflects the workflow, not depth of independence.' },
  { id: 'ai_request_frequency', label: 'AI request frequency', definition: 'AI requests per session and their distribution across assistance categories.', source: 'ai_interactions (category, created_at)', formula: 'count(ai requests) / count(sessions with >= 1 AI request); category share = category count / total requests', unit: 'requests per session; percentage share per category', denominator: 'Sessions with >= 1 AI request for frequency; all AI requests for categories', missingRule: 'Sessions without AI use are excluded from frequency, not counted as zero.', limitation: 'Counts say nothing about request quality or uptake.' },
  { id: 'scrutiny_judgments', label: 'Scrutiny accuracy judgments', definition: 'Distribution of the student accuracy judgment recorded per scrutiny response.', source: 'scrutiny_responses.accuracy_judgment', formula: 'count per judgment value / total non-empty judgments', unit: 'percentage per judgment', denominator: 'Scrutiny responses with a non-empty accuracy_judgment', missingRule: 'Empty judgments are excluded from both numerator and denominator.', limitation: 'Self-reported judgment; correctness of the judgment itself is not verified here.' },
  { id: 'scrutiny_quality', label: 'Coded scrutiny quality (structural rubric)', definition: 'Transparent structural rubric: 1 point each for (a) explicit accuracy judgment recorded, (b) stated intended action, (c) code change made after scrutiny, (d) test result recorded. Range 0-4.', source: 'scrutiny_responses (accuracy_judgment, intended_action, action_taken, test_result)', formula: 'sum of 4 binary checks per response', unit: 'rubric points (0-4)', denominator: 'Scrutiny responses in scope', missingRule: 'Missing fields score 0 for that item; empty critique text does not affect the rubric.', limitation: 'A structural rubric measuring observable actions only; it does not measure reasoning quality and requires researcher qualitative validation.' },
  { id: 'prepost_code', label: 'Pre-AI / post-AI code change', definition: 'Whether code changed between the snapshot before the AI request and after scrutiny revision.', source: 'scrutiny_responses.code_before/code_after; code_snapshots around ai_interactions', formula: 'changed if code_before <> code_after (normalised whitespace); change size = character delta', unit: 'percentage changed; mean character delta', denominator: 'Scrutiny responses with both code fields non-empty', missingRule: 'Responses missing either code field are excluded.', limitation: 'Text comparison cannot distinguish cosmetic edits from conceptual revisions.' },
  { id: 'evaluation_confidence', label: 'Evaluation responses and confidence', definition: 'Distribution of evaluation-phase confidence and perceived independence.', source: 'reflections (confidence, perceived_independence)', formula: 'counts per scale value / total responses with value present', unit: 'percentage per scale value', denominator: 'Reflections with the field filled', missingRule: 'Blank fields are excluded from that field distribution.', limitation: 'Self-report scales; no ground-truth of ability.' },
  { id: 'confidence_change', label: 'Within-participant confidence change', definition: 'Difference between a participant latest and earliest reflection confidence across repeated tasks.', source: 'reflections.confidence ordered by created_at per participant', formula: 'latest.confidence - earliest.confidence', unit: 'scale points (1-5)', denominator: 'Participants with >= 2 reflections with confidence recorded', missingRule: 'Participants with fewer than two confidence values are excluded.', limitation: 'Small n; tasks differ in difficulty, so change is not attributable.' },
  { id: 'programming_outcomes', label: 'Programming outcomes', definition: 'Distribution of researcher-approved programming marks out of 100.', source: 'assessments (approved_mark, status=approved)', unit: 'marks out of 100', formula: 'per-mark values; mean/median/quartiles across cohort', denominator: 'Approved assessments in scope', missingRule: 'Unapproved (pending) assessments are excluded entirely.', limitation: 'Marks are rubric-based judgements approved by one researcher; not standardised tests.' },
  { id: 'within_progression', label: 'Within-participant progression', definition: 'Approved marks of the same participant across their sessions ordered by time.', source: 'assessments (approved_mark) joined to sessions.started_at per participant', formula: 'per-participant ordered mark sequence (slope reported descriptively)', unit: 'mark points per task', denominator: 'Participants with >= 2 approved assessments', missingRule: 'Participants with fewer than two approved assessments are shown individually but excluded from progression statistics.', limitation: 'Descriptive ordering only — no causal or growth-model claims.' },
];

export function findIndicator(id: string): IndicatorDoc | undefined {
  return INDICATORS.find((i) => i.id === id);
}

const PAUSE_PHASES = ['plan', 'attempt', 'use_ai', 'scrutinise', 'edit', 'evaluate'] as const;
export type PausePhaseKey = (typeof PAUSE_PHASES)[number];

export function cohortEngagement(b: ResearchBundle) {
  const participants = new Set(b.events.map((e) => e.participant_id)).size || b.sessions.length;
  return { events: b.events.length, participants, eventsPerParticipant: participants ? b.events.length / participants : 0 };
}

export function taskCompletion(b: ResearchBundle) {
  const completed = b.sessions.filter((s) => s.status === 'completed').length;
  return { completed, total: b.sessions.length, rate: b.sessions.length ? (completed / b.sessions.length) * 100 : 0 };
}

export function phaseParticipation(b: ResearchBundle) {
  const perSession = new Map<string, Set<PausePhaseKey>>();
  for (const e of b.events) {
    if (!perSession.has(e.session_id)) perSession.set(e.session_id, new Set());
    const key = PAUSE_PHASES.find((p) => p === e.pause_phase);
    if (key) perSession.get(e.session_id)!.add(key);
  }
  return PAUSE_PHASES.map((phase) => {
    const sessionsWith = [...perSession.entries()].filter(([, set]) => set.has(phase)).length;
    return { phase, sessionsWith, share: b.sessions.length ? (sessionsWith / b.sessions.length) * 100 : 0 };
  });
}

/** Normalises both metadata shapes seen in production logs ({from,to} and {from_stage,to_stage}). */
function transitionMeta(e: EventLike): { from?: string; to?: string } | null {
  const m = e.metadata as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return null;
  const from = (m.from ?? m.from_stage) as string | undefined;
  const to = (m.to ?? m.to_stage) as string | undefined;
  if (!from || !to) return null;
  return { from, to };
}

interface EventLike { metadata: Record<string, unknown> | null; timestamp: string; event_type: string; session_id: string; pause_phase?: string; }

export function phaseTransitions(b: ResearchBundle) {
  const counts = new Map<string, number>();
  let unparsed = 0;
  for (const e of b.events as unknown as (EventLog & EventLike)[]) {
    if (e.event_type !== 'PHASE_TRANSITION' && e.event_type !== 'PHASE_ENTERED' && e.event_type !== 'PHASE_EXITED') continue;
    const t = transitionMeta(e);
    if (!t) { unparsed++; continue; }
    const key = `${t.from} -> ${t.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { pairs: [...counts.entries()].sort((a, c) => c[1] - a[1]), unparsed };
}

export function phaseDurations(b: ResearchBundle) {
  // PHASE_ENTERED/EXITED pairs per session+phase, first entry to matching exit.
  const enters = new Map<string, string>();
  const durations: { phase: string; minutes: number }[] = [];
  const events = (b.events as unknown as EventLike[]).slice().sort((a, c) => a.timestamp.localeCompare(c.timestamp));
  const phaseOf = (e: EventLike) => {
    const t = transitionMeta(e);
    return t ? t.to : null;
  };
  for (const e of events) {
    if (e.event_type !== 'PHASE_ENTERED' && e.event_type !== 'PHASE_EXITED') continue;
    const phase = phaseOf(e);
    if (!phase) continue;
    const key = `${e.session_id}:${phase}`;
    if (e.event_type === 'PHASE_ENTERED') {
      if (!enters.has(key)) enters.set(key, e.timestamp);
    } else {
      const start = enters.get(key);
      if (start) {
        const mins = (new Date(e.timestamp).getTime() - new Date(start).getTime()) / 60000;
        if (mins >= 0 && mins < 24 * 60) durations.push({ phase, minutes: mins });
        enters.delete(key);
      }
    }
  }
  const byPhase = new Map<string, number[]>();
  for (const d of durations) {
    if (!byPhase.has(d.phase)) byPhase.set(d.phase, []);
    byPhase.get(d.phase)!.push(d.minutes);
  }
  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const s = arr.slice().sort((a, c) => a - c);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid - 2 + 1]) / 2;
  };
  return {
    perPhase: [...byPhase.entries()].map(([phase, arr]) => ({ phase, n: arr.length, medianMinutes: median(arr), meanMinutes: arr.reduce((s, v) => s + v, 0) / arr.length })),
    openPairs: enters.size,
  };
}

export function attemptVsAiFirst(b: ResearchBundle) {
  const attemptTs = new Map<string, number>();
  const aiTs = new Map<string, number>();
  for (const e of b.events as unknown as EventLike[]) {
    const ts = new Date(e.timestamp).getTime();
    if (e.pause_phase === 'attempt' && (e.event_type === 'CODE_RUN' || e.event_type === 'ATTEMPT_SAVED')) {
      if (!attemptTs.has(e.session_id)) attemptTs.set(e.session_id, ts);
    }
    if (['HINT_REQUEST', 'EXPLANATION_REQUEST', 'DEBUG_REQUEST', 'APPROACH_REVIEW_REQUEST', 'ERROR_EXPLANATION_REQUEST', 'TARGETED_QUESTION', 'SOLUTION_REQUEST', 'AI_RESPONSE'].includes(e.event_type)) {
      if (!aiTs.has(e.session_id)) aiTs.set(e.session_id, ts);
    }
  }
  let attemptFirst = 0, aiFirst = 0, excluded = 0;
  const perSession: { sessionId: string; class: 'attempt-first' | 'ai-first' }[] = [];
  for (const s of b.sessions) {
    const a = attemptTs.get(s.id), ai = aiTs.get(s.id);
    if (a === undefined && ai === undefined) { excluded++; continue; }
    const cls = a !== undefined && (ai === undefined || a < ai) ? 'attempt-first' : 'ai-first';
    if (cls === 'attempt-first') attemptFirst++; else aiFirst++;
    perSession.push({ sessionId: s.id, class: cls });
  }
  const denom = attemptFirst + aiFirst;
  return { attemptFirst, aiFirst, excluded, denom, perSession };
}

export function aiRequestFrequency(b: ResearchBundle) {
  const sessionCounts = new Map<string, number>();
  for (const ai of b.aiInteractions) sessionCounts.set(ai.session_id, (sessionCounts.get(ai.session_id) ?? 0) + 1);
  const counts = [...sessionCounts.values()];
  const withAi = counts.length;
  const categoryCounts = new Map<string, number>();
  for (const ai of b.aiInteractions) categoryCounts.set(ai.category, (categoryCounts.get(ai.category) ?? 0) + 1);
  return {
    sessionsWithAi: withAi,
    requestsPerSession: withAi ? b.aiInteractions.length / withAi : 0,
    categories: [...categoryCounts.entries()].sort((a, c) => c[1] - a[1]).map(([category, n]) => ({ category, n, share: b.aiInteractions.length ? (n / b.aiInteractions.length) * 100 : 0 })),
  };
}

export function scrutinyJudgments(b: ResearchBundle) {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const s of b.scrutiny) {
    const v = (s.accuracy_judgment || '').trim();
    if (!v) { empty++; continue; }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s2, v) => s2 + v, 0);
  return { distribution: [...counts.entries()].map(([judgment, n]) => ({ judgment, n, share: total ? (n / total) * 100 : 0 })), empty, total };
}

/**
 * Structural scrutiny-quality rubric (0-4). Codes observable actions only.
 * NOT a measure of reasoning quality — requires researcher qualitative
 * validation (see INDICATORS entry 'scrutiny_quality').
 */
export function scrutinyQuality(b: ResearchBundle) {
  const perResponse = b.scrutiny.map((s) => {
    const items = {
      judgment: (s.accuracy_judgment || '').trim() !== '',
      intendedAction: (s.intended_action || '').trim() !== '',
      codeChange: (s.action_taken || '') !== '',
      testRecorded: (s.test_result || '').trim() !== '',
    };
    return { id: s.id, participant: s.participant_id, sessionId: s.session_id, score: Object.values(items).filter(Boolean).length, items };
  });
  const mean = perResponse.length ? perResponse.reduce((sum, r) => sum + r.score, 0) / perResponse.length : 0;
  const dist = [0, 1, 2, 3, 4].map((score) => ({ score, n: perResponse.filter((r) => r.score === score).length }));
  return { perResponse, mean, dist };
}

const normaliseCode = (code: string | null | undefined) => (code ?? '').replace(/\s+/g, ' ').trim();

export function prePostCode(b: ResearchBundle) {
  const comparable = b.scrutiny.filter((s) => (s.code_before ?? '').trim() !== '' || (s.code_after ?? '').trim() !== '');
  const evaluated = comparable.filter((s) => (s.code_before ?? '').trim() !== '' && (s.code_after ?? '').trim() !== '');
  const changed = evaluated.filter((s) => normaliseCode(s.code_before) !== normaliseCode(s.code_after));
  const deltas = changed.map((s) => (s.code_after ?? '').length - (s.code_before ?? '').length);
  return {
    comparable: comparable.length,
    evaluated: evaluated.length,
    changed: changed.length,
    changedShare: evaluated.length ? (changed.length / evaluated.length) * 100 : 0,
    meanAbsDelta: changed.length ? deltas.reduce((s, d) => s + Math.abs(d), 0) / changed.length : 0,
  };
}

export function evaluationResponses(b: ResearchBundle) {
  const tally = (field: 'confidence' | 'perceived_independence' | 'difficulty') => {
    const counts = new Map<string, number>();
    let empty = 0;
    for (const r of b.reflections) {
      const v = String(r[field] ?? '').trim();
      if (!v) { empty++; continue; }
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    return { distribution: [...counts.entries()].map(([value, n]) => ({ value, n, share: total ? (n / total) * 100 : 0 })), empty, total };
  };
  return { confidence: tally('confidence'), independence: tally('perceived_independence'), difficulty: tally('difficulty') };
}

export function confidenceChange(b: ResearchBundle) {
  const perParticipant = new Map<string, { ts: string; confidence: number }[]>();
  for (const r of b.reflections) {
    if (r.confidence === null || r.confidence === undefined) continue;
    const pid = r.participant_id;
    if (!perParticipant.has(pid)) perParticipant.set(pid, []);
    perParticipant.get(pid)!.push({ ts: r.created_at, confidence: r.confidence });
  }
  return [...perParticipant.entries()]
    .map(([pid, arr]) => {
      const sorted = arr.slice().sort((a, c) => a.ts.localeCompare(c.ts));
      return { participant: pid, first: sorted[0].confidence, latest: sorted[sorted.length - 1].confidence, n: sorted.length, delta: sorted[sorted.length - 1].confidence - sorted[0].confidence };
    })
    .filter((r) => r.n >= 2)
    .sort((a, c) => c.delta - a.delta);
}

export function programmingOutcomes(b: ResearchBundle) {
  const approved = b.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null).map((a) => ({ ...a, mark: a.approved_mark as number }));
  if (approved.length === 0) return { marks: [] as number[], n: 0, mean: null as number | null, median: null as number | null, q1: null as number | null, q3: null as number | null, min: null as number | null, max: null as number | null };
  const marks = approved.map((a) => a.mark).sort((a, c) => a - c);
  const mean = marks.reduce((s, v) => s + v, 0) / marks.length;
  const median = (arr: number[]) => { const mid = Math.floor(arr.length / 2); return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2; };
  const quart = (p: number) => { const idx = p * (marks.length - 1); const lo = Math.floor(idx); const hi = Math.ceil(idx); return marks[lo] + (marks[hi] - marks[lo]) * (idx - lo); };
  return { marks, n: marks.length, mean, median: median(marks), q1: quart(0.25), q3: quart(0.75), min: marks[0], max: marks[marks.length - 1] };
}

export function withinParticipantProgression(b: ResearchBundle) {
  const sessionStart = new Map(b.sessions.map((s) => [s.id, new Date(s.started_at).getTime()]));
  const perParticipant = new Map<string, { participant: string; sessionId: string; taskTitle?: string; mark: number; startedAt: number }[]>();
  for (const a of b.assessments) {
    if (a.status !== 'approved' || a.approved_mark === null) continue;
    const session = b.sessions.find((s) => s.id === a.session_id);
    if (!session) continue;
    if (!perParticipant.has(a.participant_id)) perParticipant.set(a.participant_id, []);
    perParticipant.get(a.participant_id)!.push({ participant: a.participant_id, sessionId: a.session_id, taskTitle: session.task_title, mark: a.approved_mark, startedAt: sessionStart.get(a.session_id) ?? 0 });
  }
  return [...perParticipant.entries()].map(([pid, arr]) => {
    const sorted = arr.sort((a, c) => a.startedAt - c.startedAt);
    let slope: number | null = null;
    if (sorted.length >= 2) {
      const xs = sorted.map((_, i) => i);
      const ys = sorted.map((r) => r.mark);
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const my = ys.reduce((s, v) => s + v, 0) / ys.length;
      const num = xs.reduce((s2, v, i) => s2 + (v - mx) * (ys[i] - my), 0);
      const den = xs.reduce((s2, v) => s2 + (v - mx) ** 2, 0);
      slope = den !== 0 ? num / den : 0;
    }
    return { participant: pid, sequence: sorted, slope };
  }).filter((p) => p.sequence.length >= 1);
}