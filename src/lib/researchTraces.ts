import type { ResearchBundle } from './researchData';
import type { AIInteraction, CodeSnapshot, Plan, Reflection, ScrutinyResponse } from './types';

export interface TraceStep {
  kind: 'plan' | 'initial_code' | 'ai_request' | 'scrutiny' | 'revised_code' | 'final_outcome' | 'evaluation';
  label: string;
  ts: string;
  participant: string;
  refId: string | null;
  detail: string;
  aiInteractionId?: string;
}

export interface SessionTrace {
  sessionId: string;
  participant: string;
  taskTitle: string;
  status: string;
  steps: TraceStep[];
}

function codePreview(s: CodeSnapshot | undefined, maxLen = 600): string {
  if (!s) return '(no snapshot)';
  const code = (s.code ?? '').trim();
  return code.length > maxLen ? code.slice(0, maxLen) + '…' : code || '(empty)';
}

/**
 * Builds the AI-to-Code Traceability chain per session:
 * plan -> first attempt code -> each AI request/response -> scrutiny ->
 * post-scrutiny revised code -> final outcome -> evaluation.
 */
export function buildSessionTrace(bundle: ResearchBundle, sessionId: string): SessionTrace | null {
  const session = bundle.sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  const plans: Plan[] = bundle.plans.filter((p) => p.session_id === sessionId).sort((a, c) => a.created_at.localeCompare(c.created_at));
  const ai: AIInteraction[] = bundle.aiInteractions.filter((a) => a.session_id === sessionId).sort((a, c) => a.created_at.localeCompare(c.created_at));
  const scrutiny: ScrutinyResponse[] = bundle.scrutiny.filter((s) => s.session_id === sessionId).sort((a, c) => a.created_at.localeCompare(c.created_at));
  const snapshots: CodeSnapshot[] = bundle.codeSnapshots.filter((s) => s.session_id === sessionId).sort((a, c) => a.created_at.localeCompare(c.created_at));
  const reflection: Reflection | undefined = bundle.reflections.filter((r) => r.session_id === sessionId).sort((a, c) => c.created_at.localeCompare(a.created_at))[0];

  const steps: TraceStep[] = [];

  // 1. Initial plan (latest version preferred for content, first for order)
  const initialPlan = plans[0];
  const finalPlan = plans[plans.length - 1];
  if (initialPlan) {
    steps.push({
      kind: 'plan',
      label: plans.length > 1 ? `Initial plan (${plans.length} versions)` : 'Initial plan',
      ts: initialPlan.created_at,
      participant: session.participant_id,
      refId: initialPlan.id,
      detail: (finalPlan?.plan_text ?? initialPlan.plan_text ?? '').slice(0, 600),
    });
  }

  // 2. Initial independent code (first snapshot in attempt phase)
  const initialCode = snapshots.find((s) => s.phase === 'attempt');
  if (initialCode) {
    steps.push({ kind: 'initial_code', label: 'Initial independent code', ts: initialCode.created_at, participant: session.participant_id, refId: initialCode.id, detail: codePreview(initialCode) });
  }

  // 3. AI requests and responses, interleaved with scrutiny
  const scrutinyByAi = new Map<string | null, ScrutinyResponse[]>();
  for (const s of scrutiny) {
    const key = s.ai_interaction_id ?? null;
    if (!scrutinyByAi.has(key)) scrutinyByAi.set(key, []);
    scrutinyByAi.get(key)!.push(s);
  }
  for (const interaction of ai) {
    steps.push({
      kind: 'ai_request',
      label: `AI request (${interaction.category.replace(/_/g, ' ')})`,
      ts: interaction.created_at,
      participant: session.participant_id,
      refId: interaction.id,
      detail: `Prompt: ${(interaction.prompt ?? '').slice(0, 300)}\n\nResponse: ${(interaction.response ?? '').slice(0, 400)}`,
      aiInteractionId: interaction.id,
    });
    for (const s of scrutinyByAi.get(interaction.id) ?? []) {
      steps.push({
        kind: 'scrutiny',
        label: 'Student scrutiny of that AI response',
        ts: s.created_at,
        participant: session.participant_id,
        refId: s.id,
        detail: `Judged: ${(s.accuracy_judgment || 'not recorded').replace(/_/g, ' ')} · Intended: ${(s.intended_action || 'not recorded').replace(/_/g, ' ')} · Took: ${(s.action_taken || 'not recorded').replace(/_/g, ' ')}`,
        aiInteractionId: interaction.id,
      });
    }
  }

  // 4. Revised code after scrutiny (first snapshot in/after scrutinise phase; 'edit' is the archived pre-merge name)
  const revisedCode = snapshots.find((s) => s.phase === 'scrutinise' || s.phase === 'edit');
  if (revisedCode) {
    steps.push({ kind: 'revised_code', label: `Revised code (${revisedCode.phase === 'edit' ? 'scrutinise (archived edit)' : revisedCode.phase} phase)`, ts: revisedCode.created_at, participant: session.participant_id, refId: revisedCode.id, detail: codePreview(revisedCode) });
  }

  // 5. Final outcome
  const assessment = bundle.assessments.find((a) => a.session_id === sessionId);
  steps.push({
    kind: 'final_outcome',
    label: session.status === 'completed' ? 'Final task outcome — completed' : `Final task outcome — ${session.status}`,
    ts: session.completed_at ?? session.last_active_at ?? session.started_at,
    participant: session.participant_id,
    refId: session.id,
    detail: assessment && assessment.status === 'approved'
      ? `Approved mark: ${assessment.approved_mark ?? 'not set'}/100`
      : 'No approved assessment yet (unapproved marks are never displayed)',
  });

  // 6. Evaluation
  if (reflection) {
    steps.push({
      kind: 'evaluation',
      label: 'Evaluation response',
      ts: reflection.created_at,
      participant: session.participant_id,
      refId: reflection.id,
      detail: `Confidence: ${reflection.confidence ?? 'not recorded'} · Perceived independence: ${(reflection.perceived_independence || 'not recorded').replace(/_/g, ' ')} · Most important learning: ${(reflection.most_important_learning ?? '').slice(0, 300)}`,
    });
  }

  return { sessionId, participant: session.participant_id, taskTitle: session.task_title ?? 'Task', status: session.status, steps };
}

/** RQ-specific flat datasets for export: one row per relevant unit per RQ. */
export function rqDataset(bundle: ResearchBundle, rqId: string): Record<string, unknown>[] {
  switch (rqId) {
    case 'RQ1': {
      // SRL processes: per session per phase — participation + durations
      const durations = new Map<string, string[]>();
      const events = bundle.events.slice().sort((a, c) => a.timestamp.localeCompare(c.timestamp));
      // simple entry/exit pairing per phase
      const open = new Map<string, string>();
      for (const e of events) {
        if (e.event_type === 'PHASE_ENTERED') {
          const m = e.metadata as Record<string, unknown> | null;
          const phase = (m?.to ?? m?.to_stage) as string | undefined;
          if (phase) open.set(`${e.session_id}:${phase}`, e.timestamp);
        } else if (e.event_type === 'PHASE_EXITED') {
          const m = e.metadata as Record<string, unknown> | null;
          const phase = (m?.to ?? m?.to_stage) as string | undefined;
          const start = phase ? open.get(`${e.session_id}:${phase}`) : undefined;
          if (start && phase) {
            const key = `${e.session_id}:${phase}`;
            if (!durations.has(key)) durations.set(key, []);
            durations.get(key)!.push(e.timestamp);
          }
        }
      }
      const phases = new Set(bundle.events.map((e) => e.pause_phase));
      const rows: Record<string, unknown>[] = [];
      for (const s of bundle.sessions) {
        for (const phase of phases) {
          const key = `${s.id}:${phase}`;
          if (!durations.has(key)) continue;
          const [startTs, endTs] = [open.get(key), durations.get(key)![0]];
          rows.push({
            participant_id: s.participant_id,
            session_id: s.id,
            task: s.task_title ?? '',
            phase,
            events_in_phase: bundle.events.filter((e) => e.session_id === s.id && e.pause_phase === phase).length,
            phase_start: startTs ?? '',
            phase_end: endTs ?? '',
            session_status: s.status,
          });
        }
      }
      return rows;
    }
    case 'RQ2': {
      // Critical scrutiny: per scrutiny response with structural rubric
      return bundle.scrutiny.map((s) => {
        const rubric = {
          judgment: (s.accuracy_judgment || '').trim() !== '',
          intended: (s.intended_action || '').trim() !== '',
          code_change: (s.action_taken || '') !== '',
          test_recorded: (s.test_result || '').trim() !== '',
        };
        const linkedAi = bundle.aiInteractions.find((a) => a.id === s.ai_interaction_id);
        return {
          participant_id: s.participant_id,
          session_id: s.session_id,
          task: bundle.sessions.find((x) => x.id === s.session_id)?.task_title ?? '',
          ai_category: linkedAi?.category ?? '',
          accuracy_judgment: s.accuracy_judgment,
          intended_action: s.intended_action,
          action_taken: s.action_taken,
          produced_expected_result: s.produced_expected_result,
          code_changed: (s.code_before ?? '').replace(/\s+/g, ' ').trim() !== (s.code_after ?? '').replace(/\s+/g, ' ').trim(),
          rubric_score: Object.values(rubric).filter(Boolean).length,
          rubric_items: Object.entries(rubric).filter(([, v]) => v).map(([k]) => k).join(';'),
        };
      });
    }
    case 'RQ3': {
      // AI assistance behaviour: per session — AI use vs independent activity
      return bundle.sessions.map((s) => {
        const aiCount = bundle.aiInteractions.filter((a) => a.session_id === s.id).length;
        const aiTypes = bundle.aiInteractions.filter((a) => a.session_id === s.id).map((a) => a.category);
        const firstAi = bundle.aiInteractions.filter((a) => a.session_id === s.id).sort((a, c) => a.created_at.localeCompare(c.created_at))[0];
        const attemptEvents = bundle.events.filter((e) => e.session_id === s.id && e.pause_phase === 'attempt' && ['CODE_RUN', 'ATTEMPT_SAVED'].includes(e.event_type));
        return {
          participant_id: s.participant_id,
          session_id: s.id,
          task: s.task_title ?? '',
          ai_requests: aiCount,
          ai_category_mix: [...new Set(aiTypes)].join(';'),
          full_solution_requested: bundle.aiInteractions.some((a) => a.session_id === s.id && a.category === 'solution_request'),
          first_ai_at: firstAi?.created_at ?? '',
          independent_code_activity_before_ai: firstAi ? attemptEvents.filter((e) => e.timestamp < firstAi.created_at).length : attemptEvents.length,
          behaviour_class: aiCount === 0 && attemptEvents.length === 0 ? 'excluded' : !firstAi || (attemptEvents[0] !== undefined && attemptEvents[0].timestamp < firstAi.created_at) ? 'attempt-first' : 'ai-first',
        };
      });
    }
    case 'RQ4': {
      // Metacognitive evaluation: per reflection
      return bundle.reflections.map((r) => {
        const session = bundle.sessions.find((s) => s.id === r.session_id);
        const earlier = bundle.reflections.filter((x) => x.participant_id === r.participant_id && x.created_at < r.created_at && x.confidence !== null);
        return {
          participant_id: r.participant_id,
          session_id: r.session_id,
          task: session?.task_title ?? '',
          difficulty: r.difficulty,
          perceived_independence: r.perceived_independence,
          confidence: r.confidence,
          prior_confidence: earlier.length ? earlier[earlier.length - 1].confidence : null,
          confidence_delta: earlier.length && r.confidence !== null && earlier[earlier.length - 1].confidence !== null ? r.confidence - (earlier[earlier.length - 1].confidence as number) : null,
          ai_disagreement: r.ai_disagreement,
          most_important_learning: (r.most_important_learning ?? '').slice(0, 200),
          next_time_strategy: (r.next_time_strategy ?? '').slice(0, 200),
        };
      });
    }
    case 'RQ5': default: {
      // Programming outcomes: approved assessments joined to session behaviour
      return bundle.assessments
        .filter((a) => a.status === 'approved')
        .map((a) => {
          const session = bundle.sessions.find((s) => s.id === a.session_id);
          return {
            participant_id: a.participant_id,
            session_id: a.session_id,
            task: session?.task_title ?? '',
            approved_mark: a.approved_mark,
            feedback_present: (a.programming_feedback ?? '').trim() !== '',
            session_events: bundle.events.filter((e) => e.session_id === a.session_id).length,
            ai_requests: bundle.aiInteractions.filter((x) => x.session_id === a.session_id).length,
            scrutiny_responses: bundle.scrutiny.filter((x) => x.session_id === a.session_id).length,
            phases_engaged: new Set(bundle.events.filter((e) => e.session_id === a.session_id).map((e) => e.pause_phase)).size,
          };
        });
    }
  }
}