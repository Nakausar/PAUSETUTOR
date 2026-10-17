import type { ResearchBundle, SessionRow } from './researchData';
import type { Assessment } from './types';

export interface WeekPoint {
  week: string;
  student: number;
  cohort: number;
}


function weekStart(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return NaN;
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - d.getUTCDay() * 24 * 60 * 60 * 1000;
}

function weekLabel(startMs: number): string {
  const d = new Date(startMs);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Sparse weekly series: cohort average across all participants, plus a selected participant. */
function weeklyCohortSeries(
  bundle: ResearchBundle,
  perEvent: (e: { participant_id: string; timestamp: string }) => number,
  selectedParticipant: string | null,
): WeekPoint[] {
  // cohort: participant-week counts -> mean per participant per week
  const perParticipantWeek = new Map<string, number>(); // `${weekStart}|${participant}` -> count
  for (const e of bundle.events) {
    const w = weekStart(e.timestamp);
    if (Number.isNaN(w)) continue;
    const key = `${w}|${e.participant_id}`;
    perParticipantWeek.set(key, (perParticipantWeek.get(key) ?? 0) + perEvent(e));
  }
  const byWeek = new Map<number, { total: number; participants: number }>();
  for (const [key, count] of perParticipantWeek) {
    const [wStr, ] = key.split('|');
    const w = Number(wStr);
    const agg = byWeek.get(w) ?? { total: 0, participants: 0 };
    agg.total += count;
    agg.participants += 1;
    byWeek.set(w, agg);
  }

  // student series
  const studentByWeek = new Map<number, number>();
  if (selectedParticipant) {
    for (const e of bundle.events) {
      if (e.participant_id !== selectedParticipant) continue;
      const w = weekStart(e.timestamp);
      if (Number.isNaN(w)) continue;
      studentByWeek.set(w, (studentByWeek.get(w) ?? 0) + perEvent(e));
    }
  }

  const weeks = [...new Set([...byWeek.keys(), ...(selectedParticipant ? [...studentByWeek.keys()] : [])])].sort((a, b) => a - b);
  return weeks.map((w) => {
    const agg = byWeek.get(w);
    return {
      week: weekLabel(w),
      cohort: agg ? agg.total / agg.participants : 0,
      student: studentByWeek.get(w) ?? 0,
    };
  });
}

export function weeklyEngagement(bundle: ResearchBundle, selectedParticipant: string | null): WeekPoint[] {
  return weeklyCohortSeries(bundle, () => 1, selectedParticipant);
}

/** Events that represent accessing a learning resource (PAUSE phase work). */
export function weeklyResources(bundle: ResearchBundle, selectedParticipant: string | null): WeekPoint[] {
  // All events represent interaction with PAUSE learning activities (phase work).
  return weeklyCohortSeries(bundle, () => 1, selectedParticipant);
}

export function weeklyAIInteractions(bundle: ResearchBundle, selectedParticipant: string | null): WeekPoint[] {
  const perParticipantWeek = new Map<string, number>();
  for (const a of bundle.aiInteractions) {
    const w = weekStart(a.created_at);
    if (Number.isNaN(w)) continue;
    const key = `${w}|${a.participant_id}`;
    perParticipantWeek.set(key, (perParticipantWeek.get(key) ?? 0) + 1);
  }
  const byWeek = new Map<number, { total: number; participants: number }>();
  for (const [key, count] of perParticipantWeek) {
    const w = Number(key.split('|')[0]);
    const agg = byWeek.get(w) ?? { total: 0, participants: 0 };
    agg.total += count;
    agg.participants += 1;
    byWeek.set(w, agg);
  }
  const studentByWeek = new Map<number, number>();
  if (selectedParticipant) {
    for (const a of bundle.aiInteractions) {
      if (a.participant_id !== selectedParticipant) continue;
      const w = weekStart(a.created_at);
      if (Number.isNaN(w)) continue;
      studentByWeek.set(w, (studentByWeek.get(w) ?? 0) + 1);
    }
  }
  const weeks = [...new Set([...byWeek.keys(), ...studentByWeek.keys()])].sort((a, b) => a - b);
  return weeks.map((w) => {
    const agg = byWeek.get(w);
    return {
      week: weekLabel(w),
      cohort: agg ? agg.total / agg.participants : 0,
      student: studentByWeek.get(w) ?? 0,
    };
  });
}

export interface MarkPoint {
  label: string;
  student: number | null;
  cohort: number | null;
}

/** Approved marks per assessment, ordered by time; cohort = mean of all approved marks in that week. */
export function approvedMarksSeries(bundle: ResearchBundle, selectedParticipant: string | null): MarkPoint[] {
  const approved = bundle.assessments
    .filter((a) => a.status === 'approved' && a.approved_mark !== null)
    .sort((a, b) => (a.approved_at ?? a.updated_at).localeCompare(b.approved_at ?? b.updated_at));
  const byWeek = new Map<number, number[]>();
  for (const a of approved) {
    const w = weekStart(a.approved_at ?? a.updated_at);
    if (Number.isNaN(w)) continue;
    const arr = byWeek.get(w) ?? [];
    arr.push(a.approved_mark as number);
    byWeek.set(w, arr);
  }
  const out: MarkPoint[] = [];
  for (const a of approved) {
    const w = weekStart(a.approved_at ?? a.updated_at);
    const marks = byWeek.get(w) ?? [];
    out.push({
      label: `${a.participant_id.slice(-4)}${approved.length > 12 ? '' : ''}`,
      student: selectedParticipant ? (a.participant_id === selectedParticipant ? (a.approved_mark as number) : null) : (a.approved_mark as number),
      cohort: marks.reduce((s, v) => s + v, 0) / marks.length,
    });
  }
  return out;
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export function boxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return { min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[s.length - 1] };
}

export interface BoxGroup {
  name: string;
  stats: BoxStats;
  n: number;
}

/** Box plots per assessment dimension (approved sub-scores scaled to 0-100) plus total mark. */
export function assessmentBoxGroups(bundle: ResearchBundle): BoxGroup[] {
  const approved = bundle.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null);
  const dims: { name: string; values: number[] }[] = [
    { name: 'Total', values: approved.map((a) => a.approved_mark as number) },
    { name: 'Correctness', values: approved.map((a) => (a.approved_correctness ?? 0) * 2.5) },
    { name: 'Approach', values: approved.map((a) => (a.approved_approach ?? 0) * 5) },
    { name: 'Quality', values: approved.map((a) => (a.approved_quality ?? 0) * 5) },
    { name: 'Testing', values: approved.map((a) => (a.approved_testing ?? 0) * 5) },
  ];
  return dims
    .map((d) => {
      const stats = boxStats(d.values);
      return stats ? { name: d.name, stats, n: d.values.length } : null;
    })
    .filter((x): x is BoxGroup => x !== null);
}

/** Compact summary boxes: selected participant vs cohort from approved assessments. */
export function assessmentSummaries(bundle: ResearchBundle, selectedParticipant: string | null) {
  const approved = bundle.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null);
  const cohortMarks = approved.map((a) => a.approved_mark as number);
  const cohortMean = cohortMarks.length ? cohortMarks.reduce((s, v) => s + v, 0) / cohortMarks.length : null;
  const own = selectedParticipant ? approved.filter((a) => a.participant_id === selectedParticipant) : [];
  const ownLatest = own.length ? own[own.length - 1] : null;
  const ownMean = own.length ? own.reduce((s, v) => s + (v.approved_mark as number), 0) / own.length : null;
  return {
    latestMark: ownLatest ? (ownLatest.approved_mark as number) : null,
    latestTask: ownLatest ? (bundle.sessions.find((s) => s.id === ownLatest.session_id)?.task_title ?? 'Task') : null,
    ownMean,
    cohortMean,
    assessmentsCount: own.length,
    cohortCount: cohortMarks.length,
    participantsAssessed: new Set(approved.map((a) => a.participant_id)).size,
  };
}

export function sessionsForParticipant(bundle: ResearchBundle, participantId: string | null): SessionRow[] {
  if (!participantId) return bundle.sessions;
  return bundle.sessions.filter((s) => s.participant_id === participantId);
}

export function latestApprovedFor(bundle: ResearchBundle, participantId: string): Assessment | null {
  const own = bundle.assessments
    .filter((a) => a.status === 'approved' && a.participant_id === participantId && a.approved_mark !== null)
    .sort((a, b) => (a.approved_at ?? a.updated_at).localeCompare(b.approved_at ?? b.updated_at));
  return own.length ? own[own.length - 1] : null;
}
