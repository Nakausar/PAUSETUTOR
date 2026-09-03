import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Code2, Lightbulb, Loader2, Play, Save, Send, ShieldCheck, Sparkles, Terminal, TestTube2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { logEvent } from '@/lib/eventLogger';
import { runPythonCode } from '@/lib/codeRunner';
import { AI_CATEGORIES, AI_CATEGORY_LABELS, PHASE_LABELS, PLAN_FIELDS, REFLECTION_FIELDS, SCRUTINY_FIELDS } from '@/lib/constants';
import PhaseProgress from '@/components/PhaseProgress';
import type { AICategory, CodeAttempt, Plan, Session, Task, PausePhase, AIInteraction, ScrutinyResponse } from '@/lib/types';

type FormValues = Record<string, string>;
const emptyPlan: FormValues = Object.fromEntries(PLAN_FIELDS.map((field) => [field.key, '']));
const emptyReflection: FormValues = Object.fromEntries(REFLECTION_FIELDS.map((field) => [field.key, '']));
const emptyScrutiny: FormValues = Object.fromEntries(SCRUTINY_FIELDS.map((field) => [field.key, '']));

export default function TaskWorkspace() {
  const { sessionId, taskId } = useParams<{ sessionId?: string; taskId?: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [attempt, setAttempt] = useState<CodeAttempt | null>(null);
  const [aiInteractions, setAiInteractions] = useState<AIInteraction[]>([]);
  const [scrutiny, setScrutiny] = useState<ScrutinyResponse | null>(null);
  const [phase, setPhase] = useState<PausePhase>('plan');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<FormValues>(emptyPlan);
  const [reflectionForm, setReflectionForm] = useState<FormValues>(emptyReflection);
  const [scrutinyForm, setScrutinyForm] = useState<FormValues>(emptyScrutiny);
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
  const [confidence, setConfidence] = useState(3);

  useEffect(() => { void loadWorkspace(); }, [sessionId, taskId, profile?.id]);

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
          await logEvent({ sessionId: activeSession.id, taskId: foundTask.id, participantId: profile.participant_id, phase: 'plan', eventType: 'SESSION_STARTED', description: 'Student started a new PAUSE learning session.', metadata: { assignment_task_id: foundTask.id } });
        }
      }
    }
    if (!activeSession) { setError('This task session could not be found.'); setLoading(false); return; }
    const foundTask = (activeSession as Session & { task?: Task }).task ?? (await supabase.from('tasks').select('*').eq('id', activeSession.task_id).maybeSingle()).data as Task;
    setSession(activeSession); setTask(foundTask); setPhase(activeSession.current_phase);
    const [planResult, attemptResult, aiResult, scrutinyResult] = await Promise.all([
      supabase.from('plans').select('*').eq('session_id', activeSession.id).maybeSingle(),
      supabase.from('code_attempts').select('*').eq('session_id', activeSession.id).maybeSingle(),
      supabase.from('ai_interactions').select('*').eq('session_id', activeSession.id).order('created_at', { ascending: false }),
      supabase.from('scrutiny_responses').select('*').eq('session_id', activeSession.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (planResult.data) { setPlan(planResult.data as Plan); setPlanForm(planResult.data as unknown as FormValues); }
    if (attemptResult.data) { setAttempt(attemptResult.data as CodeAttempt); setCode((attemptResult.data as CodeAttempt).current_code); }
    if (aiResult.data) { setAiInteractions(aiResult.data as AIInteraction[]); setAiResponse((aiResult.data[0] as AIInteraction) ?? null); }
    if (scrutinyResult.data) { setScrutiny(scrutinyResult.data as ScrutinyResponse); setScrutinyForm(scrutinyResult.data as unknown as FormValues); }
    setLoading(false);
  }

  async function transition(next: PausePhase, description: string) {
    if (!session || !profile) return;
    await supabase.from('sessions').update({ current_phase: next, last_active_at: new Date().toISOString() }).eq('id', session.id);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase, eventType: 'PHASE_TRANSITION', description, metadata: { from: phase, to: next } });
    setPhase(next); setSession({ ...session, current_phase: next });
  }

  async function savePlan() {
    if (!session || !profile) return;
    const payload = { session_id: session.id, participant_id: profile.participant_id, ...planForm };
    const result = plan ? await supabase.from('plans').update(payload).eq('id', plan.id).select().maybeSingle() : await supabase.from('plans').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save plan.'); return; }
    setPlan(result.data as Plan);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'plan', eventType: 'PLAN_CREATED', description: 'Student saved their problem analysis and proposed approach.', metadata: { fields_completed: Object.values(planForm).filter(Boolean).length } });
    await transition('attempt', 'Plan completed; independent attempt unlocked.');
  }

  async function saveAttemptToDB(nextCode: string, trigger: string, runCount: number, revisionCount: number, lastOutput: string, lastError: string | null): Promise<CodeAttempt | null> {
    if (!session || !profile) return null;
    const payload = { session_id: session.id, participant_id: profile.participant_id, current_code: nextCode, run_count: runCount, revision_count: revisionCount, last_error: lastError, last_output: lastOutput, last_run_at: trigger === 'run' ? new Date().toISOString() : (attempt?.last_run_at ?? null) };
    const result = attempt?.id
      ? await supabase.from('code_attempts').update(payload).eq('id', attempt.id).select().maybeSingle()
      : await supabase.from('code_attempts').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save attempt.'); return null; }
    return result.data as CodeAttempt;
  }

  async function saveSnapshot(attemptId: string, nextCode: string, trigger: string, runNumber: number, snapOutput: string, snapError: string | null, snapStdin: string) {
    if (!session || !profile) return;
    await supabase.from('code_snapshots').insert({ attempt_id: attemptId, session_id: session.id, participant_id: profile.participant_id, code: nextCode, phase, trigger, output: snapOutput, error: snapError, run_number: runNumber, stdin: snapStdin });
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
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'attempt', eventType, description, metadata: { error: result.error, output_length: result.output.length, stdout: result.stdout, stderr: result.stderr, stdin, exit_code: result.exitCode, system_error: result.systemError, run_number: newRunCount } });
    setRunning(false);
  }

  async function saveAttemptAndContinue() {
    if (!code.trim()) { setError('Please make a meaningful coding attempt before continuing.'); return; }
    const saved = await saveAttempt();
    if (saved) { await transition('use_ai', 'Meaningful independent attempt saved; AI assistance unlocked.'); }
  }

  async function requestAI() {
    if (!session || !task || !profile) return;
    setAiBusy(true); setError(null);
    const prompt = question || `Please provide ${AI_CATEGORY_LABELS[selectedCategory].toLowerCase()} for my current work.`;
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'use_ai', eventType: selectedCategory === 'hint' ? 'HINT_REQUEST' : selectedCategory === 'debug' ? 'DEBUG_REQUEST' : selectedCategory === 'solution_request' ? 'SOLUTION_REQUEST' : 'TARGETED_QUESTION', description: `Student requested ${AI_CATEGORY_LABELS[selectedCategory].toLowerCase()}.`, metadata: {} });
    const settings = await supabase.from('system_settings').select('system_prompt').eq('id', 1).maybeSingle();
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-tutor`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }, body: JSON.stringify({ systemPrompt: settings.data?.system_prompt, category: selectedCategory, userPrompt: prompt, contextCode: code, contextError: runError, contextPlan: plan, taskTitle: task.title, taskDescription: task.problem_description }) });
    const data = await response.json() as { response?: string; error?: string };
    if (!response.ok || !data.response) { setError(data.error ?? 'The AI tutor could not respond.'); setAiBusy(false); return; }
    const inserted = await supabase.from('ai_interactions').insert({ session_id: session.id, participant_id: profile.participant_id, category: selectedCategory, prompt, response: data.response, context_code: code, context_error: runError, context_plan: plan, full_solution_requested: selectedCategory === 'solution_request' }).select().maybeSingle();
    const interaction = inserted.data as AIInteraction;
    setAiResponse(interaction); setAiInteractions((current) => [interaction, ...current]);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'use_ai', eventType: 'AI_RESPONSE', description: 'AI tutor response received.', aiInteractionId: interaction?.id, metadata: { category: selectedCategory } });
    setAiBusy(false);
  }

  async function startScrutiny() {
    if (!session || !profile) return;
    await transition('scrutinise', 'AI assistance received; scrutiny and revision unlocked.');
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'scrutinise', eventType: 'SCRUTINY_STARTED', description: 'Student began evaluating an AI suggestion.', metadata: {} });
  }

  async function saveScrutiny(action: 'accepted' | 'modified' | 'rejected') {
    if (!session || !profile) return;
    const payload = { session_id: session.id, ai_interaction_id: aiResponse?.id ?? null, participant_id: profile.participant_id, ...scrutinyForm, action_taken: action, revised_code: code, code_before: aiResponse?.context_code ?? '', code_after: code, test_result: output, produced_expected_result: !runError };
    const result = scrutiny ? await supabase.from('scrutiny_responses').update(payload).eq('id', scrutiny.id).select().maybeSingle() : await supabase.from('scrutiny_responses').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Could not save scrutiny response.'); return; }
    setScrutiny(result.data as ScrutinyResponse);
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'scrutinise', eventType: action === 'accepted' ? 'AI_SUGGESTION_ACCEPTED' : action === 'modified' ? 'AI_SUGGESTION_MODIFIED' : 'AI_SUGGESTION_REJECTED', description: `Student ${action} the AI suggestion.`, metadata: { test_passed: !runError } });
    await transition('evaluate', 'Scrutiny response saved; reflection unlocked.');
  }

  async function submitReflection() {
    if (!session || !profile) return;
    const result = await supabase.from('reflections').insert({ session_id: session.id, participant_id: profile.participant_id, ...reflectionForm, confidence_without_ai: confidence });
    if (result.error) { setError(result.error.message); return; }
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'evaluate', eventType: 'REFLECTION_COMPLETED', description: 'Student completed structured reflection.', metadata: { confidence_without_ai: confidence } });
    await logEvent({ sessionId: session.id, taskId: session.task_id, participantId: profile.participant_id, phase: 'completed', eventType: 'TASK_COMPLETED', description: 'Student completed the PAUSE task cycle.', metadata: {} });
    await supabase.from('sessions').update({ current_phase: 'completed', status: 'completed', completed_at: new Date().toISOString() }).eq('id', session.id);
    await supabase.from('task_assignments').update({ status: 'completed', completed_at: new Date().toISOString(), current_pause_phase: 'completed' }).eq('task_id', session.task_id).eq('student_id', profile.id);
    setPhase('completed');
  }

  const completedPhases = useMemo(() => { const set = new Set<PausePhase>(); const order: PausePhase[] = ['plan','attempt','use_ai','scrutinise','evaluate']; const index = order.indexOf(phase); order.slice(0, index).forEach((p) => set.add(p)); return set; }, [phase]);
  if (loading) return <div className="max-w-6xl mx-auto px-4 py-10 text-sm text-slate-400">Loading task workspace...</div>;
  if (error && !task) return <div className="max-w-6xl mx-auto px-4 py-10"><div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div></div>;
  if (!task || !session) return null;
  if (phase === 'completed') return <CompletedView task={task} navigate={navigate} />;

  return <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
    <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"><ArrowLeft className="w-4 h-4" /> Back to dashboard</button>
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 mb-1"><span className="font-mono text-xs text-slate-400">{task.language.toUpperCase()}</span><span className="text-xs text-slate-400">{task.difficulty}</span></div><h1 className="text-2xl font-bold text-slate-900">{task.title}</h1></div><div className="text-right text-xs text-slate-500">Session<br /><span className="font-mono">{session.id.slice(0, 8)}</span></div></div><p className="text-sm text-slate-600 mt-4 leading-6">{task.problem_description}</p><div className="grid md:grid-cols-2 gap-3 mt-4 text-xs"><div className="bg-slate-50 rounded-lg p-3"><strong className="text-slate-700">Expected inputs</strong><p className="text-slate-500 mt-1">{task.expected_inputs || 'Not specified'}</p></div><div className="bg-slate-50 rounded-lg p-3"><strong className="text-slate-700">Expected outputs</strong><p className="text-slate-500 mt-1">{task.expected_outputs || 'Not specified'}</p></div></div></div>
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5"><PhaseProgress currentPhase={phase} completedPhases={completedPhases} size="md" /><div className="text-center text-xs text-slate-500 mt-3">Current phase: <span className="font-semibold text-slate-800">{PHASE_LABELS[phase]}</span></div></div>
    {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}
    {phase === 'plan' && <PlanPhase values={planForm} setValues={setPlanForm} onSave={savePlan} />}
    {phase === 'attempt' && <AttemptPhase code={code} setCode={setCode} stdin={stdin} setStdin={setStdin} output={output} runError={runError} systemError={systemError} running={running} onRun={runCode} onSave={() => saveAttempt()} onContinue={saveAttemptAndContinue} />}
    {phase === 'use_ai' && <AIPhase categories={AI_CATEGORIES} selected={selectedCategory} setSelected={setSelectedCategory} question={question} setQuestion={setQuestion} busy={aiBusy} response={aiResponse} onRequest={requestAI} onContinue={startScrutiny} />}
    {phase === 'scrutinise' && <ScrutinyPhase response={aiResponse} values={scrutinyForm} setValues={setScrutinyForm} code={code} setCode={setCode} stdin={stdin} setStdin={setStdin} output={output} runError={runError} systemError={systemError} onRun={runCode} onSave={saveScrutiny} />}
    {phase === 'evaluate' && <ReflectionPhase values={reflectionForm} setValues={setReflectionForm} confidence={confidence} setConfidence={setConfidence} onSubmit={submitReflection} />}
  </div>;
}

function PlanPhase({ values, setValues, onSave }: { values: FormValues; setValues: (v: FormValues) => void; onSave: () => void }) { return <PhaseCard icon={<Code2 />} title="Plan before you build" description="Take time to analyse the problem. Your plan will be available to the AI tutor later, but you remain in control of the solution."><div className="space-y-4">{PLAN_FIELDS.map((field, index) => <label key={field.key} className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">{index + 1}. {field.label}</span><textarea value={values[field.key] ?? ''} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} rows={index === 4 || index === 5 ? 4 : 3} className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-y focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none" /></label>)}<ActionButton icon={<Save />} onClick={onSave}>Save plan and begin independent attempt</ActionButton></div></PhaseCard>; }
function AttemptPhase({ code, setCode, stdin, setStdin, output, runError, systemError, running, onRun, onSave, onContinue }: { code: string; setCode: (v: string) => void; stdin: string; setStdin: (v: string) => void; output: string; runError: string | null; systemError: boolean; running: boolean; onRun: () => void; onSave: () => void; onContinue: () => void }) { return <PhaseCard icon={<Terminal />} title="Make your independent attempt" description="Work on the problem before asking the AI tutor. Correctness is not required yet; meaningful effort is."><div className="grid lg:grid-cols-2 gap-4"><div><div className="flex items-center justify-between mb-1.5"><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Python editor</span><span className="text-xs text-slate-400">Your code is snapshotted</span></div><textarea value={code} onChange={(e) => setCode(e.target.value)} className="w-full h-80 bg-slate-950 text-slate-100 font-mono text-sm p-4 rounded-lg outline-none resize-y" spellCheck={false} /><div className="mt-3"><label className="block"><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Program Input (stdin)</span><textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Enter input for your program here, one value per line..." rows={2} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-900" /></label></div><div className="flex gap-2 mt-3"><ActionButton icon={running ? <Loader2 className="animate-spin" /> : <Play />} onClick={onRun} disabled={running}>Run code</ActionButton><ActionButton icon={<Save />} variant="secondary" onClick={onSave}>Save attempt</ActionButton></div></div><OutputPanel output={output} error={runError} systemError={systemError} /></div><div className="border-t border-slate-100 pt-4"><ActionButton icon={<ChevronRight />} onClick={onContinue}>Save attempt and unlock structured AI help</ActionButton></div></PhaseCard>; }
function AIPhase({ categories, selected, setSelected, question, setQuestion, busy, response, onRequest, onContinue }: { categories: typeof AI_CATEGORIES; selected: AICategory; setSelected: (v: AICategory) => void; question: string; setQuestion: (v: string) => void; busy: boolean; response: AIInteraction | null; onRequest: () => void; onContinue: () => void }) { return <PhaseCard icon={<Sparkles />} title="Use AI strategically" description="Choose the kind of support you need. The tutor sees your plan, code, and errors, and will guide rather than replace your reasoning."><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{categories.map((category) => <button key={category.key} onClick={() => setSelected(category.key)} className={`text-left p-3 rounded-lg border transition-colors ${selected === category.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}><div className="text-sm font-semibold">{category.label}</div><div className={`text-xs mt-1 ${selected === category.key ? 'text-slate-300' : 'text-slate-500'}`}>{category.description}</div></button>)}</div><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Add a targeted question or context (optional)..." rows={3} className="w-full mt-4 border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-slate-900" /><div className="flex gap-2 mt-3"><ActionButton icon={busy ? <Loader2 className="animate-spin" /> : <Send />} onClick={onRequest} disabled={busy}>Request support</ActionButton>{response && <ActionButton icon={<ShieldCheck />} variant="secondary" onClick={onContinue}>Review this response</ActionButton>}</div>{response && <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg p-4"><div className="text-xs font-semibold text-slate-500 mb-2">{AI_CATEGORY_LABELS[response.category]}</div><p className="text-sm text-slate-700 whitespace-pre-wrap leading-6">{response.response}</p></div>}</PhaseCard>; }
function ScrutinyPhase({ response, values, setValues, code, setCode, stdin, setStdin, output, runError, systemError, onRun, onSave }: { response: AIInteraction | null; values: FormValues; setValues: (v: FormValues) => void; code: string; setCode: (v: string) => void; stdin: string; setStdin: (v: string) => void; output: string; runError: string | null; systemError: boolean; onRun: () => void; onSave: (action: 'accepted' | 'modified' | 'rejected') => void }) { return <PhaseCard icon={<ShieldCheck />} title="Scrutinise and revise" description="Do not simply accept the AI response. Evaluate it, test it, and decide what to do with it."><div className="bg-slate-950 text-slate-100 rounded-lg p-4 text-sm whitespace-pre-wrap leading-6 mb-5">{response?.response ?? 'No AI response selected.'}</div><div className="space-y-4 mb-5">{SCRUTINY_FIELDS.map((field) => <label key={field.key} className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">{field.label}</span><textarea value={values[field.key] ?? ''} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-slate-900" /></label>)}</div><div className="grid lg:grid-cols-2 gap-4"><div><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Revised code</span><textarea value={code} onChange={(e) => setCode(e.target.value)} className="w-full h-64 bg-slate-950 text-slate-100 font-mono text-sm p-4 rounded-lg outline-none" spellCheck={false} /><div className="mt-3"><label className="block"><span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Program Input (stdin)</span><textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Enter input for your program here, one value per line..." rows={2} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-900" /></label></div><button onClick={onRun} className="mt-2 flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"><TestTube2 className="w-4 h-4" /> Test revised code</button></div><OutputPanel output={output} error={runError} systemError={systemError} /></div><div className="flex flex-wrap gap-2 mt-5"><ActionButton onClick={() => onSave('accepted')} icon={<Check />}>Accept with justification</ActionButton><ActionButton onClick={() => onSave('modified')} icon={<Code2 />} variant="secondary">Modify and save</ActionButton><ActionButton onClick={() => onSave('rejected')} icon={<AlertCircle />} variant="secondary">Reject suggestion</ActionButton></div></PhaseCard>; }
function ReflectionPhase({ values, setValues, confidence, setConfidence, onSubmit }: { values: FormValues; setValues: (v: FormValues) => void; confidence: number; setConfidence: (v: number) => void; onSubmit: () => void }) { return <PhaseCard icon={<Lightbulb />} title="Evaluate and reflect" description="Reflection makes your learning visible. Explain your solution and how AI influenced your thinking."><div className="space-y-4">{REFLECTION_FIELDS.map((field) => <label key={field.key} className="block"><span className="block text-sm font-medium text-slate-700 mb-1.5">{field.label}</span><textarea value={values[field.key] ?? ''} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} rows={3} className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-slate-900" /></label>)}<div><span className="block text-sm font-medium text-slate-700 mb-2">How confident are you that you could solve a similar problem without AI?</span><div className="flex gap-2">{[1,2,3,4,5].map((value) => <button key={value} onClick={() => setConfidence(value)} className={`w-10 h-10 rounded-lg border text-sm font-semibold ${confidence === value ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'}`}>{value}</button>)}</div><div className="flex justify-between text-xs text-slate-400 mt-1 max-w-52"><span>Not confident</span><span>Very confident</span></div></div><ActionButton icon={<Check />} onClick={onSubmit}>Complete task and save reflection</ActionButton></div></PhaseCard>; }
function PhaseCard({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) { return <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7"><div className="flex gap-3 mb-6"><div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">{icon}</div><div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="text-sm text-slate-500 mt-1 leading-5">{description}</p></div></div>{children}</section>; }
function OutputPanel({ output, error, systemError }: { output: string; error: string | null; systemError?: boolean }) { return <div><div className="flex items-center gap-2 mb-1.5"><Terminal className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Console output</span></div><pre className={`h-80 overflow-auto rounded-lg p-4 text-sm font-mono whitespace-pre-wrap ${systemError ? 'bg-amber-950 text-amber-200' : error ? 'bg-red-950 text-red-200' : 'bg-slate-900 text-emerald-300'}`}>{output || 'Run your code to see output here.'}</pre>{systemError && <p className="text-xs text-amber-600 mt-1.5">Code execution service is temporarily unavailable. This is a system issue, not an error in your code. Please try again.</p>}</div>; }
function ActionButton({ children, onClick, icon, variant = 'primary', disabled = false }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; variant?: 'primary' | 'secondary'; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${variant === 'primary' ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{icon && <span className="w-4 h-4">{icon}</span>}{children}</button>; }
function CompletedView({ task, navigate }: { task: Task; navigate: (path: string) => void }) { return <div className="max-w-3xl mx-auto px-4 py-16 text-center"><div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-5"><Check className="w-8 h-8" /></div><h1 className="text-2xl font-bold text-slate-900">Task completed</h1><p className="text-slate-500 mt-2">Your PAUSE journey for <strong>{task.title}</strong> has been saved, including your reflection and research events.</p><button onClick={() => navigate('/dashboard')} className="mt-6 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium">Return to dashboard</button></div>; }
