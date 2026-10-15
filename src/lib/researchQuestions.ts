import type { ResearchBundle } from './researchData';
import { aiRequestFrequency, attemptVsAiFirst, cohortEngagement, confidenceChange, phaseParticipation, phaseDurations, phaseTransitions, prePostCode, programmingOutcomes, scrutinyJudgments, scrutinyQuality, taskCompletion, evaluationResponses, withinParticipantProgression } from './researchIndicators';

/**
 * The five approved PhD research questions for the PAUSE AI Tutor study.
 * The evidence matrix maps each RQ to the indicators that can inform it.
 * Mappings are descriptive (what data can address the question) — they do
 * not assert findings.
 */
export const RESEARCH_QUESTIONS: { id: string; title: string; question: string; indicators: string[] }[] = [
  {
    id: 'RQ1',
    title: 'Self-regulated learning with AI',
    question: 'How do learners engage in self-regulated learning processes (planning, monitoring, evaluating) when completing programming tasks with AI tutor assistance?',
    indicators: ['phase_participation', 'phase_durations', 'cohort_engagement', 'confidence_change'],
  },
  {
    id: 'RQ2',
    title: 'Critical scrutiny of AI output',
    question: 'To what extent do learners critically scrutinise AI-generated responses before incorporating them into their solutions?',
    indicators: ['scrutiny_judgments', 'scrutiny_quality', 'prepost_code', 'attempt_first_vs_ai_first'],
  },
  {
    id: 'RQ3',
    title: 'AI assistance behaviour',
    question: 'What patterns of AI assistance seeking (frequency, category, timing) do learners exhibit, and how do these relate to their independent problem solving?',
    indicators: ['ai_request_frequency', 'attempt_first_vs_ai_first', 'phase_transitions'],
  },
  {
    id: 'RQ4',
    title: 'Metacognitive evaluation',
    question: 'How do learners evaluate their own learning and AI reliance across repeated programming tasks?',
    indicators: ['evaluation_confidence', 'confidence_change', 'within_progression'],
  },
  {
    id: 'RQ5',
    title: 'Programming outcomes',
    question: 'How do programming outcomes (approved marks) distribute across the cohort and relate to engagement and AI behaviour?',
    indicators: ['programming_outcomes', 'within_progression', 'cohort_engagement', 'phase_participation'],
  },
];

/** Data-quality panel: missing values, incomplete sessions, duplicates, timestamp inconsistencies. */
export function dataQuality(b: ResearchBundle) {
  const sessionsById = new Map(b.sessions.map((s) => [s.id, s]));

  const eventIssues = b.events.map((e) => {
    const issues: string[] = [];
    if (!e.event_description) issues.push('missing description');
    if (!e.metadata || Object.keys(e.metadata).length === 0) issues.push('empty metadata');
    return { id: e.id, participant: e.participant_id, sessionId: e.session_id, issues };
  }).filter((e) => e.issues.length > 0);

  const incompleteSessions = b.sessions
    .filter((s) => s.status !== 'completed')
    .map((s) => ({ id: s.id, participant: s.participant_id, status: s.status, phase: s.current_phase, task: s.task_title ?? '' }));

  const sessionsWithNoEvents = b.sessions.filter((s) => !b.events.some((e) => e.session_id === s.id)).map((s) => ({ id: s.id, participant: s.participant_id }));

  // Duplicate detection: identical participant+type+metadata within a 2-second window
  const seen = new Map<string, { id: string; count: number }>();
  const sortedEvents = b.events.slice().sort((a, c) => a.timestamp.localeCompare(c.timestamp));
  for (let i = 1; i < sortedEvents.length; i++) {
    const a = sortedEvents[i - 1], c = sortedEvents[i];
    if (a.session_id === c.session_id && a.event_type === c.event_type && a.event_description === c.event_description) {
      const dt = new Date(c.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (dt >= 0 && dt < 2000) {
        const key = `${a.session_id}:${a.event_type}:${a.event_description}:${a.timestamp}`;
        const prev = seen.get(key);
        if (prev) prev.count++;
        else seen.set(key, { id: c.id, count: 1 });
      }
    }
  }
  const duplicateEvents = [...seen.values()];

  // Timestamp inconsistencies
  const tsIssues: { participant: string; sessionId: string; issue: string }[] = [];
  for (const s of b.sessions) {
    if (s.completed_at && s.started_at && new Date(s.completed_at) < new Date(s.started_at)) {
      tsIssues.push({ participant: s.participant_id, sessionId: s.id, issue: 'completed_at precedes started_at' });
    }
    for (const e of b.events) {
      if (e.session_id !== s.id) continue;
      if (new Date(e.timestamp).getTime() < new Date(s.started_at).getTime() - 60000) {
        tsIssues.push({ participant: e.participant_id, sessionId: s.id, issue: 'event precedes session start by > 1 min' });
        break;
      }
    }
  }

  // Per-session event volume vs recorded phase transitions (structural completeness)
  const sessionsWithoutCompletionEvent = b.sessions.filter((s) => s.status === 'completed' && !b.events.some((e) => e.session_id === s.id && e.event_type === 'TASK_COMPLETED')).map((s) => ({ id: s.id, participant: s.participant_id }));

  const scrutinyEmptyFields = b.scrutiny.map((s) => {
    const missing: string[] = [];
    if (!s.accuracy_judgment) missing.push('accuracy_judgment');
    if (!s.intended_action) missing.push('intended_action');
    if (!s.critique_text) missing.push('critique_text');
    if (s.produced_expected_result === null) missing.push('produced_expected_result');
    return { id: s.id, participant: s.participant_id, missing };
  }).filter((r) => r.missing.length > 0);

  const reflectionsMissingConfidence = b.reflections.filter((r) => r.confidence === null).map((r) => ({ id: r.id, participant: r.participant_id }));

  return {
    eventIssues,
    incompleteSessions,
    sessionsWithNoEvents,
    duplicateEvents,
    tsIssues,
    sessionsWithoutCompletionEvent,
    scrutinyEmptyFields,
    reflectionsMissingConfidence,
    totals: {
      sessions: b.sessions.length,
      events: b.events.length,
      scrutiny: b.scrutiny.length,
      reflections: b.reflections.length,
      aiInteractions: b.aiInteractions.length,
      plans: b.plans.length,
      assessmentsApproved: b.assessments.filter((a) => a.status === 'approved').length,
      assessmentsPending: b.assessments.filter((a) => a.status === 'pending').length,
    },
  };
}

/** Session-level derived indicator rows for CSV export and the trace viewer. */
export function sessionIndicatorRows(bundle: ResearchBundle) {
  const completion = taskCompletion(bundle);
  const engagement = cohortEngagement(bundle);
  const aiFreq = aiRequestFrequency(bundle);
  const behaviour = attemptVsAiFirst(bundle);
  const quality = scrutinyQuality(bundle);
  const prepost = prePostCode(bundle);
  return bundle.sessions.map((s) => {
    const sessionEvents = bundle.events.filter((e) => e.session_id === s.id);
    const sessionAi = bundle.aiInteractions.filter((a) => a.session_id === s.id);
    const sessionScrutiny = bundle.scrutiny.filter((x) => x.session_id === s.id);
    const classRow = behaviour.perSession.find((p) => p.sessionId === s.id);
    const qualityScores = sessionScrutiny.map((x) => quality.perResponse.find((q) => q.id === x.id)?.score ?? 0);
    return {
      session_id: s.id,
      participant_id: s.participant_id,
      task: s.task_title ?? '',
      difficulty: s.task_difficulty ?? '',
      status: s.status,
      phase_reached: s.current_phase,
      started_at: s.started_at,
      completed_at: s.completed_at ?? '',
      events: sessionEvents.length,
      ai_requests: sessionAi.length,
      ai_categories: [...new Set(sessionAi.map((a) => a.category))].join(';'),
      scrutiny_responses: sessionScrutiny.length,
      scrutiny_quality_mean: qualityScores.length ? qualityScores.reduce((a, c) => a + c, 0) / qualityScores.length : null,
      behaviour_class: classRow?.class ?? '',
      prepost_code_changed_count: sessionScrutiny.filter((x) => (x.code_before ?? '').trim() !== '' && (x.code_after ?? '').trim() !== '' && (x.code_before ?? '').replace(/\s+/g, ' ').trim() !== (x.code_after ?? '').replace(/\s+/g, ' ').trim()).length,
      completion_share_pct: completion.rate.toFixed(1),
      events_per_participant: engagement.eventsPerParticipant.toFixed(2),
      ai_requests_per_session_with_ai: aiFreq.requestsPerSession.toFixed(2),
      cohort_context: `cohort_events=${engagement.events}, cohort_participants=${engagement.participants}`,
    };
  });
}

export function bundleAllIndicators(bundle: ResearchBundle) {
  return {
    cohort_engagement: cohortEngagement(bundle),
    task_completion: taskCompletion(bundle),
    phase_participation: phaseParticipation(bundle),
    phase_transitions: phaseTransitions(bundle),
    phase_durations: phaseDurations(bundle),
    attempt_first_vs_ai_first: attemptVsAiFirst(bundle),
    ai_request_frequency: aiRequestFrequency(bundle),
    scrutiny_judgments: scrutinyJudgments(bundle),
    scrutiny_quality: scrutinyQuality(bundle),
    prepost_code: prePostCode(bundle),
    evaluation_responses: evaluationResponses(bundle),
    confidence_change: confidenceChange(bundle),
    programming_outcomes: programmingOutcomes(bundle),
    within_progression: withinParticipantProgression(bundle),
  };
}