import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronRight, Code2, FlaskConical, Lightbulb, Loader2, MessageSquare, Play, Save, Send, ShieldCheck, Sparkles, Terminal, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { logEvent } from '@/lib/eventLogger';
import { runPythonCode, runTestCases, type TestCaseResult } from '@/lib/codeRunner';
import { preloadPython } from '@/lib/python/browserRunner';
import CodeEditor from '@/components/CodeEditor';
import { useActivityTracking } from '@/lib/useActivityTracking';
import { diffStats } from '@/lib/provenance';
import { callEdgeFunction } from '@/lib/edgeFunctions';
import { AI_CATEGORIES, AI_CATEGORY_LABELS, AI_HELP_REFLECTION_OPTIONS, PHASE_COLORS, PHASE_LABELS, REFLECT_CONSTANTS, ACCURACY_JUDGMENT_OPTIONS, INTENDED_ACTION_OPTIONS } from '@/lib/constants';
import PhaseProgress from '@/components/PhaseProgress';
import type { AICategory, CodeAttempt, Plan, Session, Task, PausePhase, AIInteraction, ScrutinyResponse, AccuracyJudgment, IntendedAction, DifficultyChoice, PerceivedIndependence, AiDisagreement, PerceivedIndependentAbility, PlanConfidence } from '@/lib/types';

const AUTOSAVE_INTERVAL_MS = 15000;

type PlanForm = { plan_text: string; confidence: PlanConfidence | null };
type ScrutinyForm = { accuracy_judgment: AccuracyJudgment | ''; intended_action: IntendedAction | ''; critique_text: string };
type ReflectionForm = {
  difficulty: DifficultyChoice | '';
  perceived_independence: PerceivedIndependence | '';
  ai_help_reflection: string[];
  ai_disagreement: AiDisagreement | '';
  ai_disagreement_text: string;
  perceived_independent_ability: PerceivedIndependentAbility | '';
  confidence: PlanConfidence | null;
  most_important_learning: string;
  next_time_strategy: string;
};
const emptyPlanForm: PlanForm = { plan_text: '', confidence: null };
const emptyScrutinyForm: ScrutinyForm = { accuracy_judgment: '', intended_action: '', critique_text: '' };
const emptyReflectionForm: ReflectionForm = { difficulty: '', perceived_independence: '', ai_help_reflection: [], ai_disagreement: '', ai_disagreement_text: '', perceived_independent_ability: '', confidence: null, most_important_learning: '', next_time_strategy: '' };

export default function TaskWorkspace() {
  const { sessionId, taskId } = useParams<{ sessionId?: string; taskId?: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [attempt, setAttempt] = useState<CodeAttempt | null>(null);
  const [aiInteractions, setAiInteractions] = useState<AIInteraction[]>([]);
  const [scrutinies, setScrutinies] = useState<ScrutinyResponse[]>([]);
  const [phase, setPhase] = useState<PausePhase>('plan');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm);
  const [reflectionForm, setReflectionForm] = useState<ReflectionForm>(emptyReflectionForm);
  const [scrutinyForms, setScrutinyForms] = useState<Record<string, ScrutinyForm>>({});
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [output, setOutput] = useState('');
  const [runError, setRunError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AICategory>('hint');
  const [question, setQuestion] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResponse, setAiResponse] = useState<AIInteraction | null>(null);
  const [visitCounts, setVisitCounts] = useState<Partial<Record<PausePhase, number>>>({});
  const [testResults, setTestResults] = useState<TestCaseResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const usedAI = aiInteractions.length > 0;
  const originalPlan = plans.length > 0 ? plans[plans.length - 1] : null;
  const latestPlan = plans.length > 0 ? plans[0] : null;
  const planVersion = (latestPlan?.version ?? plans.length) || 1;
  const hasUnscrutinisedAI = aiInteractions.some((i) => !scrutinies.some((s) => s.ai_interaction_id === i.id));

  useEffect(() => { void loadWorkspace(); }, [sessionId, taskId, profile?.id]);
  // Start downloading Python in the background so the first run is fast.
  useEffect(() => { preloadPython(); }, []);

  // ---- Fine-grained research logging (logging schema v2) --------------------
  // Refs give the timers below the latest values without restarting them.
  const lastSnapshotCode = useRef<string | null>(null);
  const live = useRef({ code, attempt, phase, session, profile, aiInteractions });
  live.current = { code, attempt, phase, session, profile, aiInteractions };

  useActivityTracking({
    enabled: Boolean(session && profile && phase !== 'completed'),
    getResponses: () => live.current.aiInteractions.map((i) => ({ id: i.id, response: i.response })),
    log: (eventType, description, metadata) => {
      const { session: s, profile: p, phase: ph } = live.current;
      if (!s || !p) return;
      void logEvent({ sessionId: s.id, taskId: s.task_id, participantId: p.participant_id, phase: ph, eventType, description, metadata });
    },
  });

  // Autosave: every 15 s, if the code changed, store a snapshot (trigger 'auto')
  // and log CODE_AUTOSAVED with the size of the change. Also keeps the
  // student's latest code in code_attempts so a page refresh loses nothing.
  useEffect(() => {
    const timer = setInterval(() => { void autosave(); }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  async function findAttemptId(sessionIdToFind: string): Promise<string | null> {
    const { data } = await supabase.from('code_attempts').select('id').eq('session_id', sessionIdToFind).order('started_at', { ascending: true }).limit(1).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  const autosaving = useRef(false);
  async function autosave() {
    const { code: current, attempt: att, phase: ph, session: s, profile: p } = live.current;
    if (!s || !p || autosaving.current) return;
    if (ph !== 'attempt' && ph !== 'scrutinise') return;
    const previous = lastSnapshotCode.current;
    if (previous === null || current === previous) return;
    autosaving.current = true;
    try {
      const payload = { session_id: s.id, participant_id: p.participant_id, current_code: current };
      const existingId = att?.id ?? await findAttemptId(s.id);
      const saved = existingId
        ? await supabase.from('code_attempts').update(payload).eq('id', existingId).select().maybeSingle()
        : await supabase.from('code_attempts').insert({ ...payload, run_count: 0, revision_count: 0 }).select().maybeSingle();
      if (saved.error || !saved.data) return;
      const savedAttempt = saved.data as CodeAttempt;
      if (!att?.id) setAttempt((current) => current ?? savedAttempt);
      const snap = await supabase.from('code_snapshots')
        .insert({ attempt_id: savedAttempt.id, session_id: s.id, participant_id: p.participant_id, code: current, phase: ph, trigger: 'auto' })
        .select('id').maybeSingle();
      if (snap.error) return;
      lastSnapshotCode.current = current;
      await logEvent({
        sessionId: s.id, taskId: s.task_id, participantId: p.participant_id, phase: ph, eventType: 'CODE_AUTOSAVED',
        description: 'Code changed since the last snapshot (autosave).', codeSnapshotId: snap.data?.id ?? null,
        metadata: { ...diffStats(previous, current), code_length: current.length },
      });
    } finally {
      autosaving.current = false;
    }
  }

  const planStartLogged = useRef(false);
  const planEditedLogged = useRef(false);
  const reflectionStartLogged = useRef(false);

  useEffect(() => {
    if (!session || !profile) return;
    if (phase === 'plan' && !planStartLogged.current) {
      planStartLogged.current = true;
      void logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'plan', eventType: 'PLAN_STARTED', description: 'Student began planning their approach.', metadata: {}, idempotencyKey: `${session.id}:plan_started` });
    }
    if (phase === 'evaluate' && !reflectionStartLogged.current) {
      reflectionStartLogged.current = true;
      void logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'evaluate', eventType: 'REFLECTION_STARTED', description: 'Student began the final reflection.', metadata: {}, idempotencyKey: `${session.id}:reflection_started` });
    }
  }, [phase, session, profile]);

  function handlePlanTextChange(text: string) {
    setPlanForm({ ...planForm, plan_text: text });
    if (text.trim() && session && profile && !planEditedLogged.current) {
      planEditedLogged.current = true;
      void logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'plan', eventType: 'PLAN_EDITED', description: 'Student started writing their plan.', metadata: {} });
    }
  }

  async function loadWorkspace() {
    if (!profile) return;
    setLoading(true);
    let activeSession: Session | null = null;
    if (sessionId) {
      const result = await supabase.from('sessions').select('*, task:tasks(*)').eq('id', sessionId).maybeSingle();
      activeSession = result.data as Session | null;
    } else if (taskId) {
      const result = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
      const foundTask = result.data as Task | null;
      if (foundTask) {
        const created = await supabase.from('sessions').insert({ task_id: foundTask.id, participant_id: profile.participant_id }).select('*, task:tasks(*)').maybeSingle();
        activeSession = created.data as Session | null;
        if (activeSession) {
          await supabase.from('task_assignments')
            .update({ status: 'in_progress', started_at: new Date().toISOString(), current_pause_phase: 'plan', session_id: activeSession.id })
            .eq('task_id', foundTask.id)
            .eq('student_id', profile.id);
          await logEvent({ sessionId: activeSession.id, taskId: foundTask.id, participantId: profile.participant_id, phase: 'plan', eventType: 'SESSION_STARTED', description: 'Student started a new PAUSE learning session.', metadata: { assignment_task_id: foundTask.id }, idempotencyKey: `${activeSession.id}:session_started` });
        }
      }
    }
    if (!activeSession) { setError('This task session could not be found.'); setLoading(false); return; }
    const foundTask = (activeSession as Session & { task?: Task }).task ?? (await supabase.from('tasks').select('*').eq('id', activeSession.task_id).maybeSingle()).data as Task;
    setSession(activeSession); setTask(foundTask);
    const restored = activeSession.current_phase !== 'completed' ? activeSession.current_phase : 'completed';
    const [plansResult, attemptResult, aiResult, scrutinyResult] = await Promise.all([
      supabase.from('plans').select('*').eq('session_id', activeSession.id).order('created_at', { ascending: false }),
      supabase.from('code_attempts').select('*').eq('session_id', activeSession.id).maybeSingle(),
      supabase.from('ai_interactions').select('*').eq('session_id', activeSession.id).order('created_at', { ascending: false }),
      supabase.from('scrutiny_responses').select('*').eq('session_id', activeSession.id).order('created_at', { ascending: false }),
    ]);
    const planRows = (plansResult.data ?? []) as Plan[];
    setPlans(planRows);
    const latest = planRows[0];
    if (latest) setPlanForm({ plan_text: latest.plan_text ?? '', confidence: latest.confidence ?? null });
    if (attemptResult.data) {
      const loadedCode = (attemptResult.data as CodeAttempt).current_code;
      setAttempt(attemptResult.data as CodeAttempt); setCode(loadedCode); lastSnapshotCode.current = loadedCode;
    } else {
      // No attempt yet: start from the task's starter code (previously never shown).
      const starter = foundTask?.starter_code ?? '';
      setCode(starter); lastSnapshotCode.current = starter;
    }
    const aiRows = (aiResult.data ?? []) as AIInteraction[];
    setAiInteractions(aiRows);
    if (aiRows.length > 0) setAiResponse(aiRows[0]);
    const scrutinyRows = (scrutinyResult.data ?? []) as ScrutinyResponse[];
    setScrutinies(scrutinyRows);
    const forms: Record<string, ScrutinyForm> = {};
    for (const s of scrutinyRows) forms[s.ai_interaction_id ?? ''] = { accuracy_judgment: s.accuracy_judgment ?? '', intended_action: s.intended_action ?? '', critique_text: s.critique_text ?? '' };
    setScrutinyForms(forms);
    setPhase(restored);
    setLoading(false);
  }

  // Controlled flexible navigation: Plan → meaningful Attempt gate the workflow; Evaluate needs plan + attempt.
  // Scrutinise is available once an AI response exists — but is never mandatory: a student who does not use AI
  // goes straight from Attempt to Evaluate. All conditions are monotonic (once true they stay true), so unlocked
  // phases never re-lock before completion.
  function enabledPhases(): Set<PausePhase> {
    const planSubmitted = originalPlan !== null || latestPlan !== null;
    const meaningfulAttempt = Boolean(attempt && attempt.current_code.trim().length > 0);
    const hasAiResponse = aiInteractions.length > 0;
    const unlocked = new Set<PausePhase>(['plan']);
    if (planSubmitted) unlocked.add('attempt');
    if (planSubmitted && meaningfulAttempt) unlocked.add('use_ai');
    if (planSubmitted && meaningfulAttempt) unlocked.add('scrutinise');
    if (hasAiResponse) unlocked.add('scrutinise');
    if (planSubmitted && meaningfulAttempt) unlocked.add('evaluate');
    return unlocked;
  }

  async function transition(next: PausePhase, description: string, source: 'auto' | 'manual' = 'auto') {
    if (!session || !profile) return;
    const from = phase;
    if (next === from) return;
    await supabase.from('sessions').update({ current_phase: next, last_active_at: new Date().toISOString() }).eq('id', session.id);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: next, eventType: 'PHASE_EXITED', description: `Left ${PHASE_LABELS[from]} phase.`, metadata: { from_stage: from, to_stage: next, source } });
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: next, eventType: 'PHASE_ENTERED', description: `Entered ${PHASE_LABELS[next]} phase.`, metadata: { from_stage: from, to_stage: next, source } });
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: next, eventType: 'PHASE_TRANSITION', description, metadata: { from: from, to: next, source } });
    setVisitCounts((c) => ({ ...c, [next]: (c[next] ?? 0) + 1 }));
    setPhase(next);
    setSession((s) => (s ? { ...s, current_phase: next } : s));
    setNotice(source === 'manual' ? `Moved to ${PHASE_LABELS[next]}.` : description);
    setError(null);
  }

  function goToPhase(next: PausePhase) {
    if (!enabledPhases().has(next)) return;
    void transition(next, `Student moved to ${PHASE_LABELS[next]} phase.`, 'manual');
  }

  // Plans are append-only: the original pre-AI plan (v1) is never overwritten.
  async function savePlan() {
    if (!session || !profile) return;
    if (!planForm.plan_text.trim()) { setError('Please describe how you plan to solve this problem before continuing.'); return; }
    if (planForm.confidence === null) { setError('Please select how confident you are in your plan.'); return; }
    const isRevision = plans.length > 0;
    const payload = { session_id: session.id, participant_id: profile.participant_id, plan_text: planForm.plan_text, confidence: planForm.confidence, version: plans.length + 1, created_after_ai: usedAI };
    const result = await supabase.from('plans').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save plan.'); return; }
    const saved = result.data as Plan;
    setPlans((current) => [saved, ...current]);
    if (isRevision) {
      await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'plan', eventType: 'PLAN_REVISED', description: `Student saved plan version ${saved.version}.`, metadata: { version: saved.version, created_after_ai: usedAI, plan_length: planForm.plan_text.length } });
    }
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'plan', eventType: 'PLAN_SUBMITTED', description: 'Student submitted their plan and confidence rating.', metadata: { version: saved.version, confidence: planForm.confidence, plan_length: planForm.plan_text.length, created_after_ai: usedAI } });
    if (isRevision) { await transition('attempt', 'Revised plan saved; returning to your code.'); } else { await transition('attempt', 'Plan completed; independent attempt unlocked.'); }
  }

  async function saveAttemptToDB(nextCode: string, trigger: string, runCount: number, revisionCount: number, lastOutput: string, lastError: string | null): Promise<CodeAttempt | null> {
    if (!session || !profile) return null;
    const payload = { session_id: session.id, participant_id: profile.participant_id, current_code: nextCode, run_count: runCount, revision_count: revisionCount, last_error: lastError, last_output: lastOutput, last_run_at: trigger === 'run' ? new Date().toISOString() : (attempt?.last_run_at ?? null) };
    // An autosave may have created the attempt moments ago; reuse it rather than inserting a second row.
    const attemptId = attempt?.id ?? await findAttemptId(session.id);
    const result = attemptId
      ? await supabase.from('code_attempts').update(payload).eq('id', attemptId).select().maybeSingle()
      : await supabase.from('code_attempts').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save attempt.'); return null; }
    return result.data as CodeAttempt;
  }

  async function saveSnapshot(attemptId: string, nextCode: string, trigger: string, runNumber: number, snapOutput: string, snapError: string | null, snapStdin: string) {
    if (!session || !profile) return;
    await supabase.from('code_snapshots').insert({ attempt_id: attemptId, session_id: session.id, participant_id: profile.participant_id, code: nextCode, phase, trigger, output: snapOutput, error: snapError, run_number: runNumber, stdin: snapStdin });
    lastSnapshotCode.current = nextCode;
  }

  async function saveAttempt(nextCode = code, trigger = 'manual') {
    if (!session || !profile) return false;
    if (!nextCode.trim()) { setError('Please make a meaningful coding attempt before continuing.'); return false; }
    const newRunCount = attempt?.run_count ?? 0;
    const newRevisionCount = (attempt?.revision_count ?? 0) + 1;
    const saved = await saveAttemptToDB(nextCode, trigger, newRunCount, newRevisionCount, output, runError);
    if (!saved) return false;
    setAttempt(saved); setCode(nextCode);
    await saveSnapshot(saved.id, nextCode, trigger, newRunCount, output, runError, stdin);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase, eventType: 'ATTEMPT_SAVED', description: 'Student saved their independent attempt.', metadata: { code_length: nextCode.length, run_count: newRunCount, revision_count: newRevisionCount, stdin, stdout: output, stderr: runError } });
    return true;
  }

  async function runCode() {
    if (!session || !profile || running) return;
    setRunning(true); setRunError(null); setSystemError(false);
    const result = await runPythonCode(code, stdin);
    setOutput(result.output); setRunError(result.error); setSystemError(result.systemError);
    const newRunCount = (attempt?.run_count ?? 0) + 1;
    const newRevisionCount = attempt?.revision_count ?? 0;
    const saved = await saveAttemptToDB(code, 'run', newRunCount, newRevisionCount, result.output, result.error);
    if (saved) {
      setAttempt(saved);
      await saveSnapshot(saved.id, code, 'run', newRunCount, result.stdout, result.stderr, stdin);
    }
    const eventType = result.systemError ? 'EXECUTION_ERROR' : result.error ? 'ERROR' : 'CODE_RUN';
    const description = result.systemError
      ? 'Code execution service failure (infrastructure error, not a student code error).'
      : result.error
        ? 'Code execution returned a student code error.'
        : 'Code executed without a reported error.';
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase, eventType, description, metadata: { error: result.error, output_length: result.output.length, stdout: result.stdout, stderr: result.stderr, stdin, exit_code: result.exitCode, system_error: result.systemError, run_number: newRunCount, runner: result.runner, timed_out: result.timedOut, duration_ms: result.durationMs } });
    setRunning(false);
  }

  /** Runs the task's visible test cases against the current code and logs a TEST event. */
  async function runTests() {
    if (!session || !task || !profile || running || testing) return;
    const cases = task.test_cases ?? [];
    if (cases.length === 0) return;
    setTesting(true);
    const results = await runTestCases(code, cases);
    setTestResults(results);
    const passed = results.filter((r) => r.passed).length;
    const systemFailure = results.some((r) => r.systemError);
    await logEvent({
      sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase, eventType: 'TEST',
      description: systemFailure ? 'Test run failed because code execution was unavailable.' : `Student ran the visible tests: ${passed} of ${results.length} passed.`,
      metadata: {
        source: 'visible_tests', passed, total: results.length, all_passed: passed === results.length, system_error: systemFailure,
        code_length: code.length, code,
        results: results.map((r, i) => ({ index: i, passed: r.passed, timed_out: r.timedOut, error: r.error ? r.error.slice(-300) : null })),
      },
    });
    setTesting(false);
  }

  async function requestAI() {
    if (!session || !task || !profile) return;
    setAiBusy(true); setError(null);
    const prompt = question || `Please provide ${AI_CATEGORY_LABELS[selectedCategory].toLowerCase()} for my current work.`;
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'use_ai', eventType: selectedCategory === 'hint' ? 'HINT_REQUEST' : selectedCategory === 'debug' ? 'DEBUG_REQUEST' : selectedCategory === 'solution_request' ? 'SOLUTION_REQUEST' : 'TARGETED_QUESTION', description: `Student requested ${AI_CATEGORY_LABELS[selectedCategory].toLowerCase()}.`, metadata: { interaction_number: aiInteractions.length + 1 } });
    let data: { response?: string; error?: string; interaction?: AIInteraction } = {};
    let ok = false;
    try {
      const response = await callEdgeFunction('ai-tutor', { sessionId: session.id, category: selectedCategory, userPrompt: prompt, contextCode: code, contextError: runError });
      ok = response.ok;
      data = await response.json().catch(() => ({}));
    } catch (err) {
      data = { error: err instanceof Error ? err.message : 'The AI tutor could not respond.' };
    }
    if (!ok || !data.response || !data.interaction) { setError(data.error ?? 'The AI tutor could not respond.'); setAiBusy(false); return; }
    const interaction = data.interaction;
    setAiResponse(interaction); setAiInteractions((current) => [interaction, ...current]);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'use_ai', eventType: 'AI_RESPONSE', description: 'AI tutor response received.', aiInteractionId: interaction?.id, metadata: { category: selectedCategory, interaction_number: aiInteractions.length + 1 } });
    setAiBusy(false);
  }

  function setScrutinyFor(interactionId: string, form: ScrutinyForm) {
    setScrutinyForms((current) => ({ ...current, [interactionId]: form }));
  }

  async function saveScrutiny(action: 'accepted' | 'modified' | 'rejected') {
    if (!session || !profile || !aiResponse) return;
    const form = scrutinyForms[aiResponse.id] ?? emptyScrutinyForm;
    if (!form.accuracy_judgment || !form.intended_action) { setError('Please rate the AI response and choose what you will do next.'); return; }
    if (form.accuracy_judgment === 'incorrect' && !form.critique_text.trim()) { setError('Please briefly describe what you think is wrong with the AI response.'); return; }
    const critique = form.accuracy_judgment === 'incorrect' ? form.critique_text : '';
    const interactionNumber = aiInteractions.length - aiInteractions.findIndex((i) => i.id === aiResponse.id);
    const payload = { session_id: session.id, ai_interaction_id: aiResponse.id, participant_id: profile.participant_id, accuracy_judgment: form.accuracy_judgment, intended_action: form.intended_action, critique_text: critique, action_taken: action, revised_code: code, code_before: aiResponse.context_code ?? '', code_after: code, test_result: output, produced_expected_result: !runError };
    const existing = scrutinies.find((s) => s.ai_interaction_id === aiResponse.id);
    const result = existing
      ? await supabase.from('scrutiny_responses').update(payload).eq('id', existing.id).select().maybeSingle()
      : await supabase.from('scrutiny_responses').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save scrutiny response.'); return; }
    const savedScrutiny = result.data as ScrutinyResponse;
    setScrutinies((current) => [savedScrutiny, ...current.filter((s) => s.id !== savedScrutiny.id)]);
    const base = { sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'scrutinise' as PausePhase, aiInteractionId: aiResponse.id };
    await logEvent({ ...base, eventType: 'AI_ACCURACY_RATING', description: 'Student judged the accuracy of the AI response.', metadata: { accuracy_judgment: form.accuracy_judgment, interaction_number: interactionNumber } });
    await logEvent({ ...base, eventType: 'INTENDED_AI_UPTAKE', description: 'Student chose their intended next action with the AI response.', metadata: { intended_action: form.intended_action, interaction_number: interactionNumber } });
    if (form.accuracy_judgment === 'incorrect') {
      await logEvent({ ...base, eventType: 'AI_CRITIQUE_TEXT', description: 'Student described what they thought was wrong in the AI response.', metadata: { critique_length: critique.length, interaction_number: interactionNumber } });
    }
    await logEvent({ ...base, eventType: 'SCRUTINISE_SUBMITTED', description: 'Student submitted their scrutiny of the AI response.', metadata: { accuracy_judgment: form.accuracy_judgment, intended_action: form.intended_action, action_taken: action, interaction_number: interactionNumber } });
    await logEvent({ ...base, eventType: action === 'accepted' ? 'AI_SUGGESTION_ACCEPTED' : action === 'modified' ? 'AI_SUGGESTION_MODIFIED' : 'AI_SUGGESTION_REJECTED', description: `Student ${action} the AI suggestion.`, metadata: { test_passed: !runError, interaction_number: interactionNumber } });
    await transition('evaluate', 'Scrutiny response saved; continue to your final reflection.');
  }

  // Save the current code as a revision (snapshot + attempt update) without a scrutiny decision —
  // used inside Scrutinise after modifying code, keeping history without ending the phase.
  async function saveRevision() {
    if (!session || !profile) return;
    if (!code.trim()) { setError('Your code is empty — there is nothing to save as a revision.'); return; }
    const saved = await saveAttempt(code, 'revision');
    if (saved) setNotice('Revision saved. Previous versions stay in your code history.');
  }

  async function submitReflection() {
    if (!session || !profile) return;
    if (!reflectionForm.difficulty || !reflectionForm.perceived_independence || !reflectionForm.perceived_independent_ability || reflectionForm.confidence === null) { setError('Please answer all required reflection questions.'); return; }
    if (!reflectionForm.most_important_learning.trim() || !reflectionForm.next_time_strategy.trim()) { setError('Please answer the two short reflection questions before finishing.'); return; }
    if (usedAI && !reflectionForm.ai_disagreement) { setError('Please tell us whether you disagreed with any AI suggestion.'); return; }
    const payload = {
      session_id: session.id,
      participant_id: profile.participant_id,
      difficulty: reflectionForm.difficulty,
      perceived_independence: reflectionForm.perceived_independence,
      ai_help_reflection: usedAI ? reflectionForm.ai_help_reflection.join(',') : '',
      ai_disagreement: usedAI ? reflectionForm.ai_disagreement : '',
      ai_disagreement_text: usedAI && (reflectionForm.ai_disagreement === 'yes' || reflectionForm.ai_disagreement === 'partly') ? reflectionForm.ai_disagreement_text : '',
      perceived_independent_ability: reflectionForm.perceived_independent_ability,
      confidence: reflectionForm.confidence,
      most_important_learning: reflectionForm.most_important_learning,
      next_time_strategy: reflectionForm.next_time_strategy,
    };
    const result = await supabase.from('reflections').insert(payload);
    if (result.error) { setError(result.error.message); return; }
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'evaluate', eventType: 'REFLECTION_SUBMITTED', description: 'Student submitted their final reflection.', metadata: { difficulty: reflectionForm.difficulty, perceived_independence: reflectionForm.perceived_independence, perceived_independent_ability: reflectionForm.perceived_independent_ability, confidence: reflectionForm.confidence, used_ai: usedAI } });
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'evaluate', eventType: 'REFLECTION_COMPLETED', description: 'Student completed structured reflection.', metadata: { confidence: reflectionForm.confidence } });
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'completed', eventType: 'TASK_COMPLETED', description: 'Student completed the PAUSE task cycle.', metadata: {} });
    await supabase.from('sessions').update({ current_phase: 'completed', status: 'completed', completed_at: new Date().toISOString() }).eq('id', session.id);
    await supabase.from('task_assignments').update({ status: 'completed', completed_at: new Date().toISOString(), current_pause_phase: 'completed' }).eq('task_id', session.task_id).eq('student_id', profile.id);
    setPhase('completed');
  }

  async function saveAttemptAndContinue() {
    if (!code.trim()) { setError('Please make a meaningful coding attempt before continuing.'); return; }
    const saved = await saveAttempt();
    if (saved) { await transition('use_ai', 'Meaningful independent attempt saved; AI assistance unlocked.'); }
  }

  const enabled = enabledPhases();
  const completedPhases = new Set<PausePhase>();
  if (originalPlan) completedPhases.add('plan');
  if (attempt?.current_code?.trim()) completedPhases.add('attempt');
  if (aiInteractions.length > 0) completedPhases.add('use_ai');
  if (scrutinies.length > 0) completedPhases.add('scrutinise');

  if (loading) return <div className="max-w-6xl mx-auto px-4 py-10 text-sm text-slate-400">Loading task workspace...</div>;
  if (error && !task) return <div className="max-w-6xl mx-auto px-4 py-10"><div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div></div>;
  if (!task || !session) return null;
  if (phase === 'completed') return <CompletedView task={task} navigate={navigate} />;

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
    <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"><ArrowLeft className="w-4 h-4" /> Back to dashboard</button>
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 mb-1"><span className="font-mono text-xs text-slate-400">{task.language.toUpperCase()}</span><span className="text-xs text-slate-400">{task.difficulty}</span></div><h1 className="text-2xl font-bold text-slate-900">{task.title}</h1></div><div className="text-right text-xs text-slate-500">Session<br /><span className="font-mono">{session.id.slice(0, 8)}</span></div></div><p className="text-sm text-slate-600 mt-4 leading-6">{task.problem_description}</p><div className="grid md:grid-cols-2 gap-3 mt-4 text-xs"><div className="bg-slate-50 rounded-lg p-3"><strong className="text-slate-700">Expected inputs</strong><p className="text-slate-500 mt-1">{task.expected_inputs || 'Not specified'}</p></div><div className="bg-slate-50 rounded-lg p-3"><strong className="text-slate-700">Expected outputs</strong><p className="text-slate-500 mt-1">{task.expected_outputs || 'Not specified'}</p></div></div></div>
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5"><PhaseProgress currentPhase={phase} completedPhases={completedPhases} enabledPhases={enabled} visitCounts={visitCounts} onPhaseSelect={goToPhase} size="md" /><div className="text-center text-xs text-slate-500 mt-3">Current phase: <span className="font-semibold" style={{ color: PHASE_COLORS[phase].accent }}>{PHASE_LABELS[phase]}</span></div></div>
    {notice && <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">{notice}</div>}
    {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}
    {phase === 'plan' && <PlanPhase values={planForm} setValues={setPlanForm} onTextChange={handlePlanTextChange} onSave={savePlan} isRevision={plans.length > 0} originalPlanText={originalPlan?.plan_text ?? null} planVersion={planVersion} />}
    {phase === 'attempt' && <AttemptPhase code={code} setCode={setCode} stdin={stdin} setStdin={setStdin} output={output} runError={runError} systemError={systemError} running={running} onRun={runCode} onSave={() => saveAttempt()} onContinue={saveAttemptAndContinue} tests={{ count: task?.test_cases?.length ?? 0, running: testing, results: testResults, onRun: runTests }} />}
    {phase === 'use_ai' && <AIPhase categories={AI_CATEGORIES} selected={selectedCategory} setSelected={setSelectedCategory} question={question} setQuestion={setQuestion} busy={aiBusy} interactions={aiInteractions} selectedResponse={aiResponse} onSelectResponse={setAiResponse} onRequest={requestAI} onContinue={hasUnscrutinisedAI ? () => goToPhase('scrutinise') : () => goToPhase('scrutinise')} />}
    {phase === 'scrutinise' && <ScrutinyPhase interactions={aiInteractions} selectedResponse={aiResponse} onSelectResponse={setAiResponse} forms={scrutinyForms} setForm={setScrutinyFor} scrutinies={scrutinies} code={code} setCode={setCode} stdin={stdin} setStdin={setStdin} output={output} runError={runError} systemError={systemError} running={running} onRun={runCode} onSave={saveScrutiny} onSkip={() => goToPhase('evaluate')} onRevise={saveRevision} tests={{ count: task?.test_cases?.length ?? 0, running: testing, results: testResults, onRun: runTests }} />}
    {phase === 'evaluate' && <ReflectionPhase values={reflectionForm} setValues={setReflectionForm} usedAI={usedAI} onSubmit={submitReflection} onBack={() => goToPhase('scrutinise')} canGoBack={enabled.has('scrutinise')} />}
  </div>;
}

const phaseAccent = (key: keyof typeof PHASE_COLORS) => PHASE_COLORS[key];

function PlanPhase({ values, setValues, onTextChange, onSave, isRevision, originalPlanText, planVersion }: { values: PlanForm; setValues: (v: PlanForm) => void; onTextChange: (text: string) => void; onSave: () => void; isRevision: boolean; originalPlanText: string | null; planVersion: number }) {
  const c = phaseAccent('plan');
  return <PhaseCard accent={c} icon={<Code2 />} title={isRevision ? `Revising your plan (v${planVersion})` : 'Plan before you build'} description={isRevision ? 'Your earlier plan is kept safely. This saves a new version alongside it.' : 'Take time to think through the problem. Your plan will be available to the AI tutor later, but you remain in control of the solution.'}>
    {isRevision && originalPlanText && <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50/60 p-3.5"><div className="text-xs font-semibold text-blue-800 mb-1">Your original plan (kept as v1)</div><p className="text-sm text-blue-900/80 leading-6 whitespace-pre-wrap">{originalPlanText}</p></div>}
    <div className="space-y-6">
      <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">{isRevision ? 'What would you like to change or add to your plan?' : 'Briefly describe how you plan to solve this problem.'}</span><textarea value={values.plan_text} onChange={(e) => onTextChange(e.target.value)} placeholder="Describe your approach in 1–3 sentences." data-track="plan" rows={4} className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" /></label>
      <div><span className="block text-sm font-medium text-slate-700 mb-2">How confident are you in your plan?</span><div className="flex gap-2">{([1, 2, 3, 4, 5] as PlanConfidence[]).map((value) => <button key={value} type="button" onClick={() => setValues({ ...values, confidence: value })} aria-pressed={values.confidence === value} className={`w-11 h-11 rounded-lg border text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 ${values.confidence === value ? 'text-white border-transparent' : 'border-slate-300 text-slate-600 hover:border-blue-400'}`} style={values.confidence === value ? { backgroundColor: c.accent } : undefined}>{value}</button>)}</div><div className="flex justify-between text-xs text-slate-400 mt-1.5 max-w-58"><span>1 = Very unsure</span><span>5 = Very confident</span></div></div>
      <ActionButton accent={c} icon={<Save />} onClick={onSave}>{isRevision ? 'Save revised plan and return to your code' : 'Save plan and begin independent attempt'}</ActionButton>
    </div>
  </PhaseCard>;
}

function AttemptPhase({ code, setCode, stdin, setStdin, output, runError, systemError, running, onRun, onSave, onContinue, tests }: { tests: TestsProps; code: string; setCode: (v: string) => void; stdin: string; setStdin: (v: string) => void; output: string; runError: string | null; systemError: boolean; running: boolean; onRun: () => void; onSave: () => void; onContinue: () => void }) {
  const c = phaseAccent('attempt');
  return <PhaseCard accent={c} icon={<Terminal />} title="Make your independent attempt" description="Work on the problem before asking the AI tutor. Correctness is not required yet; meaningful effort is.">
    <div className="grid lg:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Python editor</span><span className="text-xs text-slate-400">Your code is snapshotted</span></div>
        <CodeEditor value={code} onChange={setCode} height="20rem" onRun={running ? undefined : onRun} />
        <div className="mt-3"><label className="block"><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Program Input (stdin)</span><textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Enter input for your program here, one value per line..." data-track="stdin" rows={2} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500" /></label></div>
        <div className="flex gap-2 mt-3"><ActionButton accent={c} icon={running ? <Loader2 className="animate-spin" /> : <Play />} onClick={onRun} disabled={running || tests.running}>Run code</ActionButton>{tests.count > 0 && <ActionButton accent={c} icon={tests.running ? <Loader2 className="animate-spin" /> : <FlaskConical />} variant="secondary" onClick={tests.onRun} disabled={running || tests.running}>Run tests ({tests.count})</ActionButton>}<ActionButton accent={c} icon={<Save />} variant="secondary" onClick={onSave}>Save attempt</ActionButton></div>
        <TestResultsPanel results={tests.results} />
      </div>
      <OutputPanel output={output} error={runError} systemError={systemError} />
    </div>
    <div className="border-t border-slate-100 pt-4 mt-4"><ActionButton accent={c} icon={<ChevronRight />} onClick={onContinue}>Save attempt and unlock structured AI help</ActionButton></div>
  </PhaseCard>;
}

function AIPhase({ categories, selected, setSelected, question, setQuestion, busy, interactions, selectedResponse, onSelectResponse, onRequest, onContinue }: { categories: typeof AI_CATEGORIES; selected: AICategory; setSelected: (v: AICategory) => void; question: string; setQuestion: (v: string) => void; busy: boolean; interactions: AIInteraction[]; selectedResponse: AIInteraction | null; onSelectResponse: (v: AIInteraction) => void; onRequest: () => void; onContinue: () => void }) {
  const c = phaseAccent('use_ai');
  return <PhaseCard accent={c} icon={<Sparkles />} title="Use AI strategically" description="Choose the kind of support you need. The tutor sees your plan, code, and errors, and will guide rather than replace your reasoning.">
    {interactions.length > 0 && <div className="mb-5"><div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">AI responses so far</div><div className="flex flex-wrap gap-2">{interactions.map((i, idx) => { const num = interactions.length - idx; const active = selectedResponse?.id === i.id; return <button key={i.id} type="button" onClick={() => onSelectResponse(i)} aria-pressed={active} className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 ${active ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 hover:border-amber-400'}`} style={active ? { backgroundColor: c.accent } : undefined}>Response #{num}</button>; })}</div></div>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{categories.map((category) => <button key={category.key} onClick={() => setSelected(category.key)} aria-pressed={selected === category.key} className={`text-left p-3 rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 ${selected === category.key ? 'border-transparent text-white' : 'border-slate-200 hover:border-amber-400'}`} style={selected === category.key ? { backgroundColor: c.accent } : undefined}><div className="text-sm font-semibold">{category.label}</div><div className={`text-xs mt-1 ${selected === category.key ? 'text-amber-50' : 'text-slate-500'}`}>{category.description}</div></button>)}</div>
    <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Add a targeted question or context (optional)..." data-track="ai_question" rows={3} className="w-full mt-4 border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-amber-400" />
    <div className="flex gap-2 mt-3"><ActionButton accent={c} icon={busy ? <Loader2 className="animate-spin" /> : <Send />} onClick={onRequest} disabled={busy}>Request support</ActionButton>{selectedResponse && <ActionButton accent={c} icon={<ShieldCheck />} variant="secondary" onClick={onContinue}>Review this response in Scrutinise</ActionButton>}</div>
    {selectedResponse && <div className="mt-5 bg-amber-50/70 border border-amber-200 rounded-lg p-4"><div className="flex items-center gap-2 text-xs font-semibold text-amber-700 mb-2"><MessageSquare className="w-3.5 h-3.5" />AI response</div><p className="text-sm text-slate-700 whitespace-pre-wrap leading-6" data-track="ai_response" data-interaction-id={selectedResponse.id}>{selectedResponse.response}</p></div>}
  </PhaseCard>;
}

function ScrutinyPhase({ interactions, selectedResponse, onSelectResponse, forms, setForm, scrutinies, code, setCode, stdin, setStdin, output, runError, systemError, running, onRun, onSave, onSkip, onRevise, tests }: { tests: TestsProps; interactions: AIInteraction[]; selectedResponse: AIInteraction | null; onSelectResponse: (v: AIInteraction) => void; forms: Record<string, ScrutinyForm>; setForm: (interactionId: string, form: ScrutinyForm) => void; scrutinies: ScrutinyResponse[]; code: string; setCode: (v: string) => void; stdin: string; setStdin: (v: string) => void; output: string; runError: string | null; systemError: boolean; running: boolean; onRun: () => void; onSave: (action: 'accepted' | 'modified' | 'rejected') => void; onSkip: () => void; onRevise: () => void }) {
  const c = phaseAccent('scrutinise');
  const form: ScrutinyForm = selectedResponse ? (forms[selectedResponse.id] ?? emptyScrutinyForm) : emptyScrutinyForm;
  const showCritique = form.accuracy_judgment === 'incorrect';
  const responseNum = selectedResponse ? interactions.length - interactions.findIndex((i) => i.id === selectedResponse.id) : 0;
  const alreadyScrutinised = selectedResponse ? scrutinies.some((s) => s.ai_interaction_id === selectedResponse.id) : false;
  function setAccuracy(next: AccuracyJudgment | '') { if (!selectedResponse) return; setForm(selectedResponse.id, { ...form, accuracy_judgment: next, critique_text: next === 'incorrect' ? form.critique_text : '' }); }
  return <PhaseCard accent={c} icon={<ShieldCheck />} title="Scrutinise, revise and test" description="Do not simply accept the AI response. Evaluate it, modify your code, test your changes, and record your reasoning. You can also continue here without AI if you have not requested any.">
    {interactions.length > 1 && <div className="mb-4 flex flex-wrap gap-2">{interactions.map((i, idx) => { const num = interactions.length - idx; const active = selectedResponse?.id === i.id; return <button key={i.id} type="button" onClick={() => onSelectResponse(i)} aria-pressed={active} className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${active ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 hover:border-teal-500'}`} style={active ? { backgroundColor: c.accent } : undefined}>{scrutinies.some((s) => s.ai_interaction_id === i.id) ? '✓ ' : ''}Response #{num}</button>; })}</div>}
    {selectedResponse && <>
    <div className="bg-slate-950 text-slate-100 rounded-lg p-4 text-sm whitespace-pre-wrap leading-6 mb-5" data-track="ai_response" data-interaction-id={selectedResponse.id}><div className="flex items-center gap-2 text-xs font-semibold text-teal-300 mb-2"><MessageSquare className="w-3.5 h-3.5" />AI response #{responseNum} — {selectedResponse ? AI_CATEGORY_LABELS[selectedResponse.category] : ''}</div>{selectedResponse.response}</div>
    <div className="space-y-6 mb-5">
      <div><span className="block text-sm font-medium text-slate-700 mb-2">How accurate do you think the AI response is?</span><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">{ACCURACY_JUDGMENT_OPTIONS.map((option) => <button key={option.key} type="button" onClick={() => setAccuracy(option.key)} aria-pressed={form.accuracy_judgment === option.key} className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-teal-400 ${form.accuracy_judgment === option.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-teal-500'}`} style={form.accuracy_judgment === option.key ? { backgroundColor: c.accent } : undefined}>{option.label}</button>)}</div></div>
      <div><span className="block text-sm font-medium text-slate-700 mb-2">What will you do?</span><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{INTENDED_ACTION_OPTIONS.map((option) => <button key={option.key} type="button" onClick={() => selectedResponse && setForm(selectedResponse.id, { ...form, intended_action: option.key })} aria-pressed={form.intended_action === option.key} className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-teal-400 ${form.intended_action === option.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-teal-500'}`} style={form.intended_action === option.key ? { backgroundColor: c.accent } : undefined}>{option.label}</button>)}</div></div>
      {showCritique && <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">What do you think is wrong?</span><textarea value={form.critique_text} onChange={(e) => selectedResponse && setForm(selectedResponse.id, { ...form, critique_text: e.target.value })} placeholder="Describe what you think the AI got wrong..." data-track="critique" rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-teal-500" /></label>}
    </div>
    </>}
    <div className="grid lg:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-1.5"><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Your code</span><span className="text-xs text-slate-400">Every save is snapshotted — previous versions are kept</span></div>
        <CodeEditor value={code} onChange={setCode} height="16rem" onRun={running ? undefined : onRun} />
        <div className="mt-3"><label className="block"><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Program Input (stdin)</span><textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Enter input for your program here, one value per line..." data-track="stdin" rows={2} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-teal-500" /></label></div>
        <div className="flex flex-wrap gap-2 mt-3"><ActionButton accent={c} icon={running ? <Loader2 className="animate-spin" /> : <Play />} onClick={onRun} disabled={running || tests.running}>Run code</ActionButton>{tests.count > 0 && <ActionButton accent={c} icon={tests.running ? <Loader2 className="animate-spin" /> : <FlaskConical />} variant="secondary" onClick={tests.onRun} disabled={running || tests.running}>Run tests ({tests.count})</ActionButton>}<ActionButton accent={c} icon={<Save />} variant="secondary" onClick={onRevise}>Save revision</ActionButton>{selectedResponse && <ActionButton accent={c} onClick={() => onSave('accepted')} icon={<Check />}>Accept response</ActionButton>}<ActionButton accent={c} onClick={() => onSave('modified')} icon={<Code2 />} variant="secondary">Modify and save</ActionButton>{selectedResponse && <ActionButton accent={c} onClick={() => onSave('rejected')} icon={<AlertCircle />} variant="secondary">Reject suggestion</ActionButton>}</div>
        {selectedResponse && alreadyScrutinised && <p className="text-xs text-slate-400 mt-3">You already scrutinised this response — saving again updates that record.</p>}
        <TestResultsPanel results={tests.results} />
      </div>
      <OutputPanel output={output} error={runError} systemError={systemError} />
    </div>
    {scrutinies.length > 0 && <div className="border-t border-slate-100 mt-5 pt-4"><div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your scrutiny decisions so far (before → after)</div><div className="space-y-2 max-h-56 overflow-y-auto">{scrutinies.map((s) => { const changed = (s.code_before ?? '').replace(/\s+/g, ' ').trim() !== (s.code_after ?? '').replace(/\s+/g, ' ').trim(); return <div key={s.id} className="border border-slate-100 rounded-lg px-3 py-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-700">Judged {s.accuracy_judgment?.replace(/_/g, ' ') ?? '—'} · chose to {s.intended_action?.replace(/_/g, ' ') ?? '—'}</span><span className={changed ? 'text-teal-700 font-medium' : 'text-slate-400'}>{changed ? 'code changed' : 'no code change'}</span></div>{changed && <div className="mt-1.5 grid sm:grid-cols-2 gap-2 font-mono text-[11px]"><div className="bg-red-50 rounded p-2 whitespace-pre-wrap line-clamp-4">- {(s.code_before ?? '').slice(0, 200)}</div><div className="bg-emerald-50 rounded p-2 whitespace-pre-wrap line-clamp-4">+ {(s.code_after ?? '').slice(0, 200)}</div></div>}</div>; })}</div></div>}
    <div className="border-t border-slate-100 mt-5 pt-4"><ActionButton accent={phaseAccent('evaluate')} icon={<ChevronRight />} onClick={onSkip}>Save revisions and continue to Evaluate</ActionButton><p className="text-xs text-slate-400 mt-2">{selectedResponse ? 'You can continue without accepting or rejecting — your evaluation is saved when you press one of the decision buttons.' : 'No AI response in this session — that is fine. Finalise your code here, then continue to Evaluate.'}</p></div>
  </PhaseCard>;
}

function ReflectionPhase({ values, setValues, usedAI, onSubmit, onBack, canGoBack }: { values: ReflectionForm; setValues: (v: ReflectionForm) => void; usedAI: boolean; onSubmit: () => void; onBack: () => void; canGoBack: boolean }) {
  const c = phaseAccent('evaluate');
  const showDisagreementText = usedAI && (values.ai_disagreement === 'yes' || values.ai_disagreement === 'partly');
  const toggleHelp = (key: string) => setValues({ ...values, ai_help_reflection: values.ai_help_reflection.includes(key) ? values.ai_help_reflection.filter((k) => k !== key) : [...values.ai_help_reflection, key] });
  const choice = (selected: boolean) => ({ borderColor: selected ? 'transparent' : undefined, backgroundColor: selected ? c.accent : undefined, color: selected ? '#FFFFFF' : undefined } as React.CSSProperties);
  return <PhaseCard accent={c} icon={<Lightbulb />} title="Evaluate your solution" description="Assess your final solution and reflect on how this task went for you. Your answers help you learn from the experience.">
    <div className="space-y-6">
      <div><span className="block text-sm font-medium text-slate-700 mb-2">What was the most difficult part?</span><div className="grid sm:grid-cols-2 gap-2">{REFLECT_CONSTANTS.difficulty.map((o) => <button key={o.key} type="button" onClick={() => setValues({ ...values, difficulty: values.difficulty === o.key ? '' : o.key })} aria-pressed={values.difficulty === o.key} className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 ${values.difficulty === o.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.difficulty === o.key)}>{o.label}</button>)}</div></div>
      <div><span className="block text-sm font-medium text-slate-700 mb-2">How much of the problem did you solve independently?</span><div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">{REFLECT_CONSTANTS.perceived_independence.map((o) => <button key={o.key} type="button" onClick={() => setValues({ ...values, perceived_independence: values.perceived_independence === o.key ? '' : o.key })} aria-pressed={values.perceived_independence === o.key} className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${values.perceived_independence === o.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.perceived_independence === o.key)}>{o.label}</button>)}</div></div>
      {usedAI && <div><span className="block text-sm font-medium text-slate-700 mb-2">How did AI help you?</span><div className="grid sm:grid-cols-2 gap-2">{AI_HELP_REFLECTION_OPTIONS.map((o) => <button key={o.key} type="button" onClick={() => toggleHelp(o.key)} aria-pressed={values.ai_help_reflection.includes(o.key)} className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${values.ai_help_reflection.includes(o.key) ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.ai_help_reflection.includes(o.key))}>{o.label}</button>)}</div><p className="text-xs text-slate-400 mt-1.5">Select all that apply.</p></div>}
      {usedAI && <div><span className="block text-sm font-medium text-slate-700 mb-2">Did you disagree with or question any AI suggestion?</span><div className="flex flex-wrap gap-2">{REFLECT_CONSTANTS.ai_disagreement.map((o) => <button key={o.key} type="button" onClick={() => setValues({ ...values, ai_disagreement: values.ai_disagreement === o.key ? '' : o.key })} aria-pressed={values.ai_disagreement === o.key} className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${values.ai_disagreement === o.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.ai_disagreement === o.key)}>{o.label}</button>)}</div></div>}
      {showDisagreementText && <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">What did you disagree with?</span><textarea value={values.ai_disagreement_text} onChange={(e) => setValues({ ...values, ai_disagreement_text: e.target.value })} placeholder="Optional: describe what you questioned or disagreed with..." data-track="reflection" rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></label>}
      <div><span className="block text-sm font-medium text-slate-700 mb-2">Could you solve a similar problem without AI?</span><div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">{REFLECT_CONSTANTS.perceived_independent_ability.map((o) => <button key={o.key} type="button" onClick={() => setValues({ ...values, perceived_independent_ability: values.perceived_independent_ability === o.key ? '' : o.key })} aria-pressed={values.perceived_independent_ability === o.key} className={`px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${values.perceived_independent_ability === o.key ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.perceived_independent_ability === o.key)}>{o.label}</button>)}</div></div>
      <div><span className="block text-sm font-medium text-slate-700 mb-2">How confident are you that you could solve a similar problem independently?</span><div className="flex gap-2">{([1, 2, 3, 4, 5] as PlanConfidence[]).map((value) => <button key={value} type="button" onClick={() => setValues({ ...values, confidence: value })} aria-pressed={values.confidence === value} className={`w-11 h-11 rounded-lg border text-sm font-semibold transition-colors ${values.confidence === value ? 'border-transparent text-white' : 'border-slate-300 text-slate-600 hover:border-indigo-400'}`} style={choice(values.confidence === value)}>{value}</button>)}</div><div className="flex justify-between text-xs text-slate-400 mt-1.5 max-w-58"><span>1 = Not confident</span><span>5 = Very confident</span></div></div>
      <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">What is the most important thing you learned from this problem?</span><textarea value={values.most_important_learning} onChange={(e) => setValues({ ...values, most_important_learning: e.target.value })} placeholder="1–3 sentences" data-track="reflection" rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></label>
      <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">What would you do differently next time?</span><textarea value={values.next_time_strategy} onChange={(e) => setValues({ ...values, next_time_strategy: e.target.value })} placeholder="1–3 sentences" data-track="reflection" rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" /></label>
      <div className="flex flex-wrap gap-2">{canGoBack && <ActionButton accent={c} variant="secondary" icon={<ArrowLeft />} onClick={onBack}>Back to my code</ActionButton>}<ActionButton accent={c} icon={<Check />} onClick={onSubmit}>Complete task and save reflection</ActionButton></div>
    </div>
  </PhaseCard>;
}

function PhaseCard({ icon, title, description, accent, children }: { icon: React.ReactNode; title: string; description: string; accent: { accent: string; accentSoft: string }; children: React.ReactNode }) {
  return <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7 shadow-sm"><div className="flex gap-3 mb-6"><div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: accent.accent }}>{icon}</div><div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="text-sm text-slate-500 mt-1 leading-5">{description}</p></div></div>{children}</section>;
}

interface TestsProps { count: number; running: boolean; results: TestCaseResult[] | null; onRun: () => void }

function TestResultsPanel({ results }: { results: TestCaseResult[] | null }) {
  if (!results) return null;
  const passed = results.filter((r) => r.passed).length;
  const all = passed === results.length;
  return <div className={`mt-3 rounded-lg border p-3 ${all ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`} aria-live="polite">
    <div className={`text-sm font-semibold ${all ? 'text-emerald-800' : 'text-amber-900'}`}>{passed} of {results.length} tests passed</div>
    <ul className="mt-2 space-y-2">{results.map((r, i) => <li key={i} className="text-xs">
      <div className="flex items-center gap-1.5 font-medium text-slate-700">{r.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}Test {i + 1}{r.input ? <span className="font-normal text-slate-500">· input: <code>{r.input.length > 40 ? `${r.input.slice(0, 40)}…` : r.input.replace(/\n/g, ' ⏎ ')}</code></span> : null}</div>
      {!r.passed && <div className="grid sm:grid-cols-2 gap-2 mt-1">
        <div><div className="text-slate-500 mb-0.5">Expected</div><pre className="bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{r.expected || '(nothing)'}</pre></div>
        <div><div className="text-slate-500 mb-0.5">{r.error ? 'Error' : 'Your program printed'}</div><pre className="bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{r.error || r.actual || '(nothing)'}</pre></div>
      </div>}
    </li>)}</ul>
  </div>;
}

function OutputPanel({ output, error, systemError }: { output: string; error: string | null; systemError?: boolean }) {
  return <div><div className="flex items-center gap-2 mb-1.5"><Terminal className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Console output</span></div><pre className={`h-80 overflow-auto rounded-lg p-4 text-sm font-mono whitespace-pre-wrap ${systemError ? 'bg-amber-950 text-amber-200' : error ? 'bg-red-950 text-red-200' : 'bg-slate-900 text-emerald-300'}`}>{output || 'Run your code to see output here.'}</pre>{systemError && <p className="text-xs text-amber-600 mt-1.5">Code execution service is temporarily unavailable. This is a system issue, not an error in your code. Please try again.</p>}</div>;
}

function ActionButton({ children, onClick, icon, accent, variant = 'primary', disabled = false }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; accent: { accent: string }; variant?: 'primary' | 'secondary'; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-slate-400 ${variant === 'primary' ? 'text-white hover:opacity-90' : 'border text-slate-700 hover:bg-slate-50'}`} style={variant === 'primary' ? { backgroundColor: accent.accent } : { borderColor: accent.accent }}>{icon && <span className="w-4 h-4 flex items-center justify-center">{icon}</span>}{children}</button>;
}

function CompletedView({ task, navigate }: { task: Task; navigate: (path: string) => void }) {
  return <div className="max-w-3xl mx-auto px-4 py-16 text-center"><div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-5"><Check className="w-8 h-8" /></div><h1 className="text-2xl font-bold text-slate-900">Task completed</h1><p className="text-slate-500 mt-2">Your PAUSE journey for <strong>{task.title}</strong> has been saved, including your reflection and research events.</p><button onClick={() => navigate('/dashboard')} className="mt-6 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium">Return to dashboard</button></div>;
}