// Pure, deterministic temporal analysis algorithms.
// No Supabase imports: everything here is computable from plain data so the
// same input always produces the same output (reproducibility requirement).

import type { EventLog, AIInteraction, ScrutinyResponse, Assessment, Session } from '../types';

export const ANALYSIS_VERSION = '1.0.0';

/** Historical six-phase framework: 'edit' is preserved as its own node, never silently merged. */
export const TEMPORAL_PHASES = ['plan', 'attempt', 'use_ai', 'scrutinise', 'edit', 'evaluate', 'completed'] as const;
export type TemporalPhase = (typeof TEMPORAL_PHASES)[number];

/** Spec-mandated display colours (Plan blue, Attempt green, Use AI orange, Scrutinise purple, Evaluate red). */
export const PHASE_COLORS: Record<string, string> = {
  plan: '#2563EB',
  attempt: '#16A34A',
  use_ai: '#F59E0B',
  scrutinise: '#8B5CF6',
  edit: '#A78BFA',
  evaluate: '#DC2626',
  completed: '#64748B',
};

export const PHASE_DISPLAY: Record<string, string> = {
  plan: 'Plan',
  attempt: 'Attempt',
  use_ai: 'Use AI',
  scrutinise: 'Scrutinise',
  edit: 'Scrutinise (Edit, archived)',
  evaluate: 'Evaluate',
  completed: 'Completed',
};

/** Segments longer than this are treated as inactivity: counted in observed elapsed time, capped for active-time estimates. */
export const GAP_CAP_MINUTES = 5;
const GAP_CAP_MS = GAP_CAP_MINUTES * 60_000;

export interface PhaseStep {
  phase: TemporalPhase;
  fromTs: string;
  toTs: string | null;
  eventCount: number;
}

export interface TransitionMatrix {
  phases: string[];
  counts: number[][];
  rowTotals: number[];
  probabilities: number[][];
  forward: number;
  backward: number;
}

export interface SessionDurations {
  sessionId: string;
  firstTs: string | null;
  lastTs: string | null;
  observedMs: number | null;
  activeMs: number;
  perPhase: Record<string, { observedMs: number; activeMs: number }>;
}

export interface SessionIntervals {
  sessionId: string;
  planToFirstCodeMs: number | null;
  firstCodeToFirstAiMs: number | null;
  aiRequestGapsMs: number[];
  scrutinyAfterRequestMs: number[];
  codeAfterScrutinyMs: number[];
  aiRequestCount: number;
  scrutinyCycles: number;
}

/** Chronological ordering with stable tie-break on id. Rows with unparseable timestamps are dropped, not fabricated. */
export function orderEvents(events: EventLog[]): EventLog[] {
  return events
    .filter((e) => e.timestamp && !Number.isNaN(new Date(e.timestamp).getTime()))
    .slice()
    .sort((a, b) => {
      const d = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
}

/**
 * Duplicate suppression: identical (session, type, description) within 2 seconds
 * counts once, so retry-induced double logging cannot inflate transition counts.
 */
export function dedupeEvents(events: EventLog[]): { kept: EventLog[]; duplicateCount: number } {
  const sorted = orderEvents(events);
  const kept: EventLog[] = [];
  let duplicateCount = 0;
  for (const e of sorted) {
    const prev = kept[kept.length - 1];
    const dup = prev
      && prev.session_id === e.session_id
      && prev.event_type === e.event_type
      && prev.event_description === e.event_description
      && new Date(e.timestamp).getTime() - new Date(prev.timestamp).getTime() <= 2000;
    if (dup) duplicateCount++;
    else kept.push(e);
  }
  return { kept, duplicateCount };
}

export function toPhase(value: string | null | undefined): TemporalPhase | null {
  if (!value) return null;
  return (TEMPORAL_PHASES as readonly string[]).includes(value) ? (value as TemporalPhase) : null;
}

/** Contiguous phase runs from an ordered event stream (PHASE_* records included). */
export function buildPhaseSequence(events: EventLog[], completedAt: string | null = null): PhaseStep[] {
  const ordered = orderEvents(events).filter((e) => toPhase(e.pause_phase));
  const steps: PhaseStep[] = [];
  for (const e of ordered) {
    const phase = toPhase(e.pause_phase)!;
    const last = steps[steps.length - 1];
    if (last && last.phase === phase) {
      last.eventCount++;
      last.toTs = e.timestamp;
    } else {
      steps.push({ phase, fromTs: e.timestamp, toTs: e.timestamp, eventCount: 1 });
    }
  }
  if (steps.length > 0 && completedAt && !Number.isNaN(new Date(completedAt).getTime())) {
    steps[steps.length - 1].toTs = completedAt;
  }
  return steps;
}

const FORWARD_ORDER: Record<string, number> = { plan: 0, attempt: 1, use_ai: 2, scrutinise: 3, edit: 4, evaluate: 5 };

export function computeTransitionMatrix(sessionsEvents: Map<string, EventLog[]>): TransitionMatrix {
  const phases = [...TEMPORAL_PHASES];
  const idx = new Map(phases.map((p, i) => [p, i]));
  const n = phases.length;
  const counts: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const events of sessionsEvents.values()) {
    const steps = buildPhaseSequence(events);
    for (let i = 0; i + 1 < steps.length; i++) {
      const a = idx.get(steps[i].phase)!;
      const b = idx.get(steps[i + 1].phase)!;
      counts[a][b]++;
    }
  }
  const rowTotals = counts.map((row) => row.reduce((s, v) => s + v, 0));
  const probabilities = counts.map((row, i) => row.map((v) => (rowTotals[i] > 0 ? v / rowTotals[i] : 0)));
  let forward = 0;
  let backward = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const fa = FORWARD_ORDER[phases[a]];
      const fb = FORWARD_ORDER[phases[b]];
      if (fa === undefined || fb === undefined) continue;
      if (fb > fa) forward += counts[a][b];
      else if (fb < fa) backward += counts[a][b];
    }
  }
  return { phases, counts, rowTotals, probabilities, forward, backward };
}

/** Wall-clock time per phase. Observed = raw elapsed span; Active = segments capped at GAP_CAP to limit idle inflation. */
export function computeSessionDurations(sessionId: string, events: EventLog[], completedAt: string | null = null): SessionDurations {
  const ordered = orderEvents(events).filter((e) => toPhase(e.pause_phase));
  const perPhase: Record<string, { observedMs: number; activeMs: number }> = {};
  if (ordered.length === 0) return { sessionId, firstTs: null, lastTs: null, observedMs: null, activeMs: 0, perPhase };
  const first = new Date(ordered[0].timestamp).getTime();
  let end = new Date(ordered[ordered.length - 1].timestamp).getTime();
  if (completedAt && !Number.isNaN(new Date(completedAt).getTime())) end = Math.max(end, new Date(completedAt).getTime());
  let activeMs = 0;
  for (let i = 0; i < ordered.length; i++) {
    const next = i + 1 < ordered.length ? new Date(ordered[i + 1].timestamp).getTime() : end;
    const raw = Math.max(0, next - new Date(ordered[i].timestamp).getTime());
    const capped = Math.min(raw, GAP_CAP_MS);
    const phase = toPhase(ordered[i].pause_phase)!;
    if (!perPhase[phase]) perPhase[phase] = { observedMs: 0, activeMs: 0 };
    perPhase[phase].observedMs += raw;
    perPhase[phase].activeMs += capped;
    activeMs += capped;
  }
  return { sessionId, firstTs: ordered[0].timestamp, lastTs: new Date(end).toISOString(), observedMs: end - first, activeMs, perPhase };
}

function ms(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return tb - ta;
}

const CODE_EVENT_TYPES = new Set(['CODE_RUN', 'CODE_EDIT', 'ATTEMPT_STARTED', 'ATTEMPT_SAVED', 'INDEPENDENT_REVISION']);

export function computeSessionIntervals(
  sessionId: string,
  events: EventLog[],
  interactions: AIInteraction[],
  scrutiny: ScrutinyResponse[],
): SessionIntervals {
  const ordered = orderEvents(events);
  const planEvents = ordered.filter((e) => e.event_type.startsWith('PLAN_'));
  const codeEvents = ordered.filter((e) => CODE_EVENT_TYPES.has(e.event_type));
  const firstPlan = planEvents[0]?.timestamp ?? null;
  const firstCode = codeEvents[0]?.timestamp ?? null;
  const sortedInteractions = interactions.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const firstAi = sortedInteractions[0]?.created_at ?? null;
  const aiRequestGapsMs: number[] = [];
  for (let i = 1; i < sortedInteractions.length; i++) {
    const gap = ms(sortedInteractions[i - 1].created_at, sortedInteractions[i].created_at);
    if (gap !== null) aiRequestGapsMs.push(gap);
  }
  const scrutinyAfterRequestMs: number[] = [];
  const codeAfterScrutinyMs: number[] = [];
  let scrutinyCycles = 0;
  for (const s of scrutiny) {
    if (!s.ai_interaction_id) continue;
    const interaction = sortedInteractions.find((i) => i.id === s.ai_interaction_id);
    const gap = ms(interaction?.created_at, s.created_at);
    if (gap !== null && gap >= 0) {
      scrutinyAfterRequestMs.push(gap);
      scrutinyCycles++;
    }
    if (s.created_at) {
      const after = codeEvents.map((e) => e.timestamp).filter((t) => new Date(t).getTime() >= new Date(s.created_at).getTime()).sort()[0];
      const g2 = ms(s.created_at, after);
      if (g2 !== null && g2 >= 0) codeAfterScrutinyMs.push(g2);
    }
  }
  return {
    sessionId,
    planToFirstCodeMs: firstPlan && firstCode ? ms(firstPlan, firstCode) : null,
    firstCodeToFirstAiMs: firstCode && firstAi ? ms(firstCode, firstAi) : null,
    aiRequestGapsMs,
    scrutinyAfterRequestMs,
    codeAfterScrutinyMs,
    aiRequestCount: sortedInteractions.length,
    scrutinyCycles,
  };
}

/** Step tokens for pathway discovery, derived only from actual records. */
export type StepToken = 'PLAN' | 'IND_CODE' | 'AI_REQ' | 'SCRUTINY' | 'REVISION' | 'TEST' | 'EVAL';

export function buildStepTokens(events: EventLog[], interactions: AIInteraction[], scrutiny: ScrutinyResponse[]): StepToken[] {
  interface Stamp { ts: number; token: StepToken }
  const stamps: Stamp[] = [];
  for (const e of orderEvents(events)) {
    const t = new Date(e.timestamp).getTime();
    if (e.event_type.startsWith('PLAN_')) stamps.push({ ts: t, token: 'PLAN' });
    else if (e.event_type === 'CODE_REVISED' || e.event_type === 'INDEPENDENT_REVISION') stamps.push({ ts: t, token: 'REVISION' });
    else if (e.event_type === 'CODE_RUN' && e.pause_phase === 'scrutinise') stamps.push({ ts: t, token: 'TEST' });
    else if (CODE_EVENT_TYPES.has(e.event_type) && (e.pause_phase === 'attempt' || e.pause_phase === 'edit')) stamps.push({ ts: t, token: 'IND_CODE' });
    else if (e.event_type === 'REFLECTION_SUBMITTED' || e.event_type === 'REFLECTION_COMPLETED') stamps.push({ ts: t, token: 'EVAL' });
  }
  for (const i of interactions) stamps.push({ ts: new Date(i.created_at).getTime(), token: 'AI_REQ' });
  for (const s of scrutiny) stamps.push({ ts: new Date(s.created_at).getTime(), token: 'SCRUTINY' });
  stamps.sort((a, b) => a.ts - b.ts);
  const out: StepToken[] = [];
  for (const s of stamps) {
    if (out[out.length - 1] !== s.token) out.push(s.token);
  }
  return out;
}

export interface SequencePattern {
  sequence: string;
  length: number;
  count: number;
  participants: number;
  sessions: number;
}

/** Overlapping n-gram frequency across session token streams. Descriptive only — no significance testing. */
export function discoverSequences(
  sessionTokens: Map<string, { tokens: StepToken[]; participantId: string }>,
  minLength: number,
  maxLength: number,
  minFrequency: number,
): SequencePattern[] {
  const acc = new Map<string, { count: number; participants: Set<string>; sessions: Set<string> }>();
  for (const [sessionId, { tokens, participantId }] of sessionTokens) {
    for (let len = minLength; len <= maxLength; len++) {
      for (let i = 0; i + len <= tokens.length; i++) {
        const gram = tokens.slice(i, i + len).join(' → ');
        let entry = acc.get(gram);
        if (!entry) { entry = { count: 0, participants: new Set(), sessions: new Set() }; acc.set(gram, entry); }
        entry.count++;
        entry.participants.add(participantId);
        entry.sessions.add(sessionId);
      }
    }
  }
  return Array.from(acc.entries())
    .filter(([, v]) => v.count >= minFrequency)
    .map(([sequence, v]) => ({ sequence, length: sequence.split(' → ').length, count: v.count, participants: v.participants.size, sessions: v.sessions.size }))
    .sort((a, b) => b.count - a.count || a.sequence.localeCompare(b.count === b.count ? a.sequence : b.sequence));
}

export interface AiOptionRow {
  category: string;
  label: string;
  requests: number;
  students: number;
  pctOfRequests: number;
}

export function aiOptionFrequency(interactions: AIInteraction[], labels: Record<string, string>): AiOptionRow[] {
  const byCat = new Map<string, { requests: number; students: Set<string> }>();
  for (const i of interactions) {
    let entry = byCat.get(i.category);
    if (!entry) { entry = { requests: 0, students: new Set() }; byCat.set(i.category, entry); }
    entry.requests++;
    entry.students.add(i.student_id);
  }
  const total = interactions.length || 1;
  return Array.from(byCat.entries())
    .map(([category, v]) => ({ category, label: labels[category] ?? category, requests: v.requests, students: v.students.size, pctOfRequests: (v.requests / total) * 100 }))
    .sort((a, b) => b.requests - a.requests);
}

export interface RepeatedAiRow {
  participantId: string;
  sessionId: string;
  totalRequests: number;
  optionsUsed: number;
  repeatedOption: string | null;
  repeatedOptionCount: number;
  scrutinyCycles: number;
}

export function repeatedAiPerSession(
  interactions: AIInteraction[],
  scrutiny: ScrutinyResponse[],
  labels: Record<string, string>,
): RepeatedAiRow[] {
  const bySession = new Map<string, AIInteraction[]>();
  for (const i of interactions) {
    if (!bySession.has(i.session_id)) bySession.set(i.session_id, []);
    bySession.get(i.session_id)!.push(i);
  }
  const rows: RepeatedAiRow[] = [];
  for (const [sessionId, list] of bySession) {
    if (list.length === 0) continue;
    const byCat = new Map<string, number>();
    for (const i of list) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
    let repeatedOption: string | null = null;
    let repeatedOptionCount = 0;
    for (const [cat, n] of byCat) {
      if (n > repeatedOptionCount) { repeatedOption = cat; repeatedOptionCount = n; }
    }
    rows.push({
      participantId: list[0].participant_id,
      sessionId,
      totalRequests: list.length,
      optionsUsed: byCat.size,
      repeatedOption: repeatedOption && repeatedOptionCount > 1 ? (labels[repeatedOption] ?? repeatedOption) : null,
      repeatedOptionCount: repeatedOptionCount > 1 ? repeatedOptionCount : 0,
      scrutinyCycles: scrutiny.filter((s) => s.session_id === sessionId).length,
    });
  }
  return rows.sort((a, b) => b.totalRequests - a.totalRequests);
}

export type GradeBand = '0–49' | '50–69' | '70–84' | '85–100';

export function gradeBandFor(mark: number): GradeBand {
  if (mark < 50) return '0–49';
  if (mark < 70) return '50–69';
  if (mark < 85) return '70–84';
  return '85–100';
}

export interface BandComparisonRow {
  band: GradeBand;
  sessions: number;
  participants: number;
  avgAiRequests: number | null;
  avgScrutinyCycles: number | null;
  avgActiveMinutes: number | null;
  medianMinutesToFirstAi: number | null;
}

/**
 * Descriptive comparison of temporal metrics across approved-grade bands.
 * AI-generated draft grades are never used; missing grades are excluded, not zero.
 */
export function compareByGradeBand(
  sessions: Session[],
  assessments: Assessment[],
  durations: Map<string, SessionDurations>,
  intervals: Map<string, SessionIntervals>,
): { rows: BandComparisonRow[]; gradedCount: number; ungradedCount: number } {
  const approved = new Map(assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null).map((a) => [a.session_id, a.approved_mark!]));
  const buckets = new Map<GradeBand, { sessions: Set<string>; participants: Set<string>; ai: number[]; scrutiny: number[]; active: number[]; firstAi: number[] }>();
  let gradedCount = 0;
  let ungradedCount = 0;
  for (const s of sessions) {
    const mark = approved.get(s.id);
    if (mark === undefined) { ungradedCount++; continue; }
    gradedCount++;
    const band = gradeBandFor(mark);
    if (!buckets.has(band)) buckets.set(band, { sessions: new Set(), participants: new Set(), ai: [], scrutiny: [], active: [], firstAi: [] });
    const b = buckets.get(band)!;
    b.sessions.add(s.id);
    b.participants.add(s.participant_id);
    const iv = intervals.get(s.id);
    if (iv) {
      b.ai.push(iv.aiRequestCount);
      b.scrutiny.push(iv.scrutinyCycles);
      if (iv.firstCodeToFirstAiMs !== null && iv.firstCodeToFirstAiMs >= 0) b.firstAi.push(iv.firstCodeToFirstAiMs / 60000);
    }
    const d = durations.get(s.id);
    if (d) b.active.push(d.activeMs / 60000);
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const rows: BandComparisonRow[] = (['0–49', '50–69', '70–84', '85–100'] as GradeBand[]).map((band) => {
    const b = buckets.get(band);
    return {
      band,
      sessions: b?.sessions.size ?? 0,
      participants: b?.participants.size ?? 0,
      avgAiRequests: b ? avg(b.ai) : null,
      avgScrutinyCycles: b ? avg(b.scrutiny) : null,
      avgActiveMinutes: b ? avg(b.active) : null,
      medianMinutesToFirstAi: b ? median(b.firstAi) : null,
    };
  });
  return { rows, gradedCount, ungradedCount };
}

export function fmtDuration(msValue: number | null | undefined): string {
  if (msValue === null || msValue === undefined) return '—';
  const mins = msValue / 60000;
  if (mins < 1) return `${Math.round(msValue / 1000)}s`;
  if (mins < 60) return `${mins.toFixed(1)} min`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}
