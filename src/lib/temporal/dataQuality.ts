// Data-quality diagnostics for the Temporal Analysis module.
// All checks are descriptive audits of the retrieved records; nothing is modified.

import type { EventLog, AIInteraction, ScrutinyResponse, Session, Assessment } from '../types';
import { orderEvents, dedupeEvents } from './analysis';

export interface NegativeInterval {
  sessionId: string;
  participantId: string;
  kind: string;
  fromTs: string;
  toTs: string;
  ms: number;
}

export interface DataQualityReport {
  totalEvents: number;
  duplicateCandidates: number;
  missingTimestamps: number;
  negativeIntervals: NegativeInterval[];
  sessionsWithLongGaps: { sessionId: string; participantId: string; gapMs: number; fromTs: string; toTs: string }[];
  incompleteSessions: number;
  missingAiOptionIds: number;
  sessionsMissingApprovedGrades: number;
  totalSessions: number;
  hasIssues: boolean;
}

/** Long inactivity threshold (documented analytical assumption, configurable here). */
export const LONG_GAP_MS = 30 * 60_000;

/**
 * Audit records for quality issues. Duplicate detection mirrors the analysis
 * pipeline's 2-second same-type/same-description suppression, but reports the
 * candidates instead of silently dropping them.
 */
export function auditDataQuality(
  events: EventLog[],
  interactions: AIInteraction[],
  scrutiny: ScrutinyResponse[],
  sessions: Session[],
  assessments: Assessment[],
): DataQualityReport {
  const { duplicateCount } = dedupeEvents(events);

  let missingTimestamps = 0;
  for (const e of events) {
    if (!e.timestamp || Number.isNaN(new Date(e.timestamp).getTime())) missingTimestamps++;
  }

  // Negative intervals: scrutiny recorded before its linked AI request.
  const negativeIntervals: NegativeInterval[] = [];
  const interactionById = new Map(interactions.map((i) => [i.id, i]));
  for (const s of scrutiny) {
    if (!s.ai_interaction_id) continue;
    const i = interactionById.get(s.ai_interaction_id);
    if (!i?.created_at) continue;
    const diff = new Date(s.created_at).getTime() - new Date(i.created_at).getTime();
    if (diff < 0) {
      negativeIntervals.push({
        sessionId: s.session_id, participantId: s.participant_id,
        kind: 'Scrutiny recorded before its linked AI request',
        fromTs: i.created_at, toTs: s.created_at, ms: diff,
      });
    }
  }

  // Long inactivity gaps between consecutive events in a session.
  const sessionsWithLongGaps: DataQualityReport['sessionsWithLongGaps'] = [];
  const bySession = new Map<string, EventLog[]>();
  for (const e of events) {
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id)!.push(e);
  }
  for (const [sessionId, evs] of bySession) {
    const ordered = orderEvents(evs);
    for (let i = 1; i < ordered.length; i++) {
      const gap = new Date(ordered[i].timestamp).getTime() - new Date(ordered[i - 1].timestamp).getTime();
      if (gap > LONG_GAP_MS) {
        sessionsWithLongGaps.push({
          sessionId, participantId: ordered[i - 1].participant_id,
          gapMs: gap, fromTs: ordered[i - 1].timestamp, toTs: ordered[i].timestamp,
        });
      }
    }
  }

  const incompleteSessions = sessions.filter((s) => s.status !== 'completed').length;
  const missingAiOptionIds = interactions.filter((i) => !i.category).length;
  const sessionsMissingApprovedGrades = sessions.filter((s) => {
    const a = assessments.find((x) => x.session_id === s.id);
    return !a || a.status !== 'approved' || a.approved_mark === null;
  }).length;

  return {
    totalEvents: events.length,
    duplicateCandidates: duplicateCount,
    missingTimestamps,
    negativeIntervals,
    sessionsWithLongGaps,
    incompleteSessions,
    missingAiOptionIds,
    sessionsMissingApprovedGrades,
    totalSessions: sessions.length,
    hasIssues: duplicateCount > 0 || missingTimestamps > 0 || negativeIntervals.length > 0 || sessionsWithLongGaps.length > 0 || incompleteSessions > 0 || missingAiOptionIds > 0,
  };
}
