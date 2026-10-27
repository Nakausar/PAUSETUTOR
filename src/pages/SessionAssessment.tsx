import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, Check, ClipboardCheck, FileCode, Lightbulb, Loader2, Save, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { logEvent } from '@/lib/eventLogger';
import { AI_CATEGORY_LABELS } from '@/lib/constants';
import type { Assessment, MetacognitiveRating, AIInteraction, CodeAttempt, CodeSnapshot, Plan, Reflection, ScrutinyResponse, Session, Task } from '@/lib/types';

const RATING_CATEGORIES: { key: string; label: string; helper: string }[] = [
  { key: 'planning', label: 'Planning', helper: 'Specificity and quality of plans, including revisions after AI assistance.' },
  { key: 'monitoring', label: 'Monitoring and Attempt', helper: 'Running code, checking outputs, self-initiated revisions, persistence.' },
  { key: 'scrutiny', label: 'Critical Scrutiny of AI', helper: 'Accuracy judgments, critiques, testing AI suggestions before adopting them.' },
  { key: 'evaluation', label: 'Evaluation', helper: 'Quality and honesty of the final self-evaluation.' },
];

const RATING_ORDER: MetacognitiveRating[] = ['excellent', 'good', 'needs_improvement', 'not_observed', 'not_applicable'];
const RATING_LABELS: Record<MetacognitiveRating, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs Improvement',
  not_observed: 'Not Observed',
  not_applicable: 'Not Applicable',
};
const RATING_STYLES: Record<MetacognitiveRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good: 'bg-sky-100 text-sky-800 border-sky-200',
  needs_improvement: 'bg-amber-100 text-amber-800 border-amber-200',
  not_observed: 'bg-slate-100 text-slate-600 border-slate-200',
  not_applicable: 'bg-slate-50 text-slate-400 border-slate-200',
};

export default function SessionAssessment() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { profile } = useAuth();
  const [session, setSession] = useState<(Session & { task?: Task; attempts?: { current_code: string; run_count: number; revision_count: number; last_error: string | null; last_output: string | null }[] }) | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [evidence, setEvidence] = useState<EvidenceBundle | null>(null);
  const [finalCode, setFinalCode] = useState<string | null>(null);
  const [initialCode, setInitialCode] = useState<string | null>(null);
  const [mark, setMark] = useState<string>('');
  const [rubric, setRubric] = useState({ correctness: '', approach: '', quality: '', testing: '' });
  const [feedback, setFeedback] = useState('');
  const [ratings, setRatings] = useState<Record<string, MetacognitiveRating | null>>({ planning: null, monitoring: null, scrutiny: null, evaluation: null });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function load() {
    if (!sessionId) return;
    setLoading(true);
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*, task:tasks(*), attempts:code_attempts(current_code, run_count, revision_count, last_error, last_output, updated_at)')
      .eq('id', sessionId)
      .maybeSingle();
    if (!sessionData) { setError('Session not found.'); setLoading(false); return; }
    setSession(sessionData as Session & { task?: Task; attempts?: { current_code: string; run_count: number; revision_count: number; last_error: string | null; last_output: string | null }[] });
    const snap = (sessionData as { attempts?: { current_code: string }[] }).attempts;
    setFinalCode(snap && snap.length > 0 ? snap[snap.length - 1].current_code : null);
    void loadInitialCode();

    const { data: assessmentData } = await supabase
      .from('assessments')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (assessmentData) {
      const a = assessmentData as Assessment;
      setAssessment(a);
      setMark(a.approved_mark !== null ? String(a.approved_mark) : a.ai_suggested_mark !== null ? String(a.ai_suggested_mark) : '');
      setRubric({
        correctness: String(a.approved_correctness ?? a.ai_suggested_correctness ?? ''),
        approach: String(a.approved_approach ?? a.ai_suggested_approach ?? ''),
        quality: String(a.approved_quality ?? a.ai_suggested_quality ?? ''),
        testing: String(a.approved_testing ?? a.ai_suggested_testing ?? ''),
      });
      setFeedback(a.programming_feedback ?? a.ai_programming_feedback ?? '');
      setRatings({
        planning: a.metacog_planning ?? a.ai_suggested_planning ?? null,
        monitoring: a.metacog_monitoring ?? a.ai_suggested_monitoring ?? null,
        scrutiny: a.metacog_scrutiny ?? a.ai_suggested_scrutiny ?? null,
        evaluation: a.metacog_evaluation ?? a.ai_suggested_evaluation ?? null,
      });
    }
    setLoading(false);
  }

  async function gatherEvidence(): Promise<EvidenceBundle> {
    const [plans, attempts, snapshots, interactions, scrutiny, reflection] = await Promise.all([
      supabase.from('plans').select('id, plan_text, confidence, version, created_after_ai, created_at').eq('session_id', sessionId!).order('created_at', { ascending: true }),
      supabase.from('code_attempts').select('id, current_code, run_count, revision_count, last_error, last_output, updated_at').eq('session_id', sessionId!),
      supabase.from('code_snapshots').select('id, phase, trigger, output, error, run_number, created_at').eq('session_id', sessionId!).order('created_at', { ascending: true }),
      supabase.from('ai_interactions').select('id, category, prompt').eq('session_id', sessionId!).order('created_at', { ascending: true }),
      supabase.from('scrutiny_responses').select('id, ai_interaction_id, accuracy_judgment, intended_action, critique_text, action_taken, produced_expected_result').eq('session_id', sessionId!).order('created_at', { ascending: true }),
      supabase.from('reflections').select('id, difficulty, perceived_independence, ai_help_reflection, perceived_independent_ability, most_important_learning, next_time_strategy, confidence').eq('session_id', sessionId!).maybeSingle(),
    ]);
    return {
      plans: (plans.data ?? []) as Plan[],
      attempts: (attempts.data ?? []) as CodeAttempt[],
      snapshots: (snapshots.data ?? []) as CodeSnapshot[],
      aiInteractions: (interactions.data ?? []) as AIInteraction[],
      scrutiny: (scrutiny.data ?? []) as ScrutinyResponse[],
      reflection: (reflection.data ?? null) as Reflection | null,
    };
  }

  async function generateSuggestion() {
    if (!session?.task || !sessionId) return;
    setGenerating(true); setError(''); setNotice('');
    try {
      const ev = await gatherEvidence();
      setEvidence(ev);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assessor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          taskTitle: session.task.title,
          taskDescription: session.task.problem_description,
          learningObjectives: session.task.learning_objectives,
          expectedInputs: session.task.expected_inputs,
          expectedOutputs: session.task.expected_outputs,
          testCases: session.task.test_cases ?? [],
          evidence: {
            plans: ev.plans.map((p) => ({ id: p.id, plan_text: p.plan_text, confidence: p.confidence, version: p.version, created_after_ai: p.created_after_ai })),
            attempts: ev.attempts.map((a) => ({ current_code: a.current_code, run_count: a.run_count, revision_count: a.revision_count, last_error: a.last_error, last_output: a.last_output })),
            snapshots: ev.snapshots.map((s) => ({ id: s.id, code: s.code ?? '', trigger: s.trigger, output: s.output, error: s.error, run_number: s.run_number })),
            aiInteractions: ev.aiInteractions.map((ai) => ({ id: ai.id, category: ai.category, prompt: ai.prompt })),
            scrutiny: ev.scrutiny.map((s) => ({ id: s.id, accuracy_judgment: s.accuracy_judgment, intended_action: s.intended_action, critique_text: s.critique_text, action_taken: s.action_taken, produced_expected_result: s.produced_expected_result, ai_interaction_id: s.ai_interaction_id })),
            reflection: ev.reflection ? { difficulty: ev.reflection.difficulty, perceived_independence: ev.reflection.perceived_independence, ai_help_reflection: ev.reflection.ai_help_reflection, perceived_independent_ability: ev.reflection.perceived_independent_ability, most_important_learning: ev.reflection.most_important_learning, next_time_strategy: ev.reflection.next_time_strategy, confidence: ev.reflection.confidence } : null,
          },
        }),
      });
      const data = await response.json().catch(() => null) as AISuggestion | null;
      if (!response.ok || !data || data.error) {
        throw new Error(data?.error ?? `Assessment service unavailable (HTTP ${response.status})`);
      }
      if (data.metacognitive) {
        setRatings({
          planning: data.metacognitive.planning,
          monitoring: data.metacognitive.monitoring_and_attempt,
          scrutiny: data.metacognitive.critical_scrutiny_of_ai,
          evaluation: data.metacognitive.evaluation,
        });
      }
      if (data.programming?.mark !== null && data.programming?.mark !== undefined) setMark(String(data.programming.mark));
      if (data.programming) {
        setRubric({
          correctness: data.programming.correctness !== null && data.programming.correctness !== undefined ? String(data.programming.correctness) : '',
          approach: data.programming.approach !== null && data.programming.approach !== undefined ? String(data.programming.approach) : '',
          quality: data.programming.quality !== null && data.programming.quality !== undefined ? String(data.programming.quality) : '',
          testing: data.programming.testing !== null && data.programming.testing !== undefined ? String(data.programming.testing) : '',
        });
      }
      if (data.programming?.feedback) setFeedback(data.programming.feedback);
      if (sessionId && session) {
        await supabase.from('assessments').upsert({
          session_id: sessionId,
          task_id: session.task_id,
          student_id: session.student_id,
          participant_id: session.participant_id,
          status: 'pending',
          ai_suggested_at: new Date().toISOString(),
          ai_suggested_mark: data.programming?.mark ?? null,
          ai_suggested_correctness: data.programming?.correctness ?? null,
          ai_suggested_approach: data.programming?.approach ?? null,
          ai_suggested_quality: data.programming?.quality ?? null,
          ai_suggested_testing: data.programming?.testing ?? null,
          ai_programming_feedback: data.programming?.feedback ?? null,
          ai_suggested_planning: data.metacognitive?.planning ?? null,
          ai_suggested_monitoring: data.metacognitive?.monitoring_and_attempt ?? null,
          ai_suggested_scrutiny: data.metacognitive?.critical_scrutiny_of_ai ?? null,
          ai_suggested_evaluation: data.metacognitive?.evaluation ?? null,
          evidence_refs: data.evidence_refs ?? {},
        }, { onConflict: 'session_id' });
        void logEvent({ sessionId, taskId: session.task_id, participantId: session.participant_id, phase: 'completed', eventType: 'PHASE_ENTERED', description: 'AI generated an assessment suggestion for researcher review.', metadata: { placeholder: data.placeholder ?? false } });
      }
      setNotice(data.placeholder ? 'No AI key configured — enter the mark and ratings manually below.' : 'Suggestion generated. Review each value, then approve to publish to the student.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate assessment.');
    } finally {
      setGenerating(false);
    }
  }

  function parseRubricInput(): { error: string | null; markNum: number | null; rubricNums: { correctness: number | null; approach: number | null; quality: number | null; testing: number | null } } {
    const markNum = mark.trim() === '' ? null : Number(mark);
    if (markNum !== null && (!Number.isInteger(markNum) || markNum < 0 || markNum > 100)) return { error: 'Mark must be a whole number between 0 and 100.', markNum: null, rubricNums: { correctness: null, approach: null, quality: null, testing: null } };
    const rubricNums = {
      correctness: rubric.correctness.trim() === '' ? null : Number(rubric.correctness),
      approach: rubric.approach.trim() === '' ? null : Number(rubric.approach),
      quality: rubric.quality.trim() === '' ? null : Number(rubric.quality),
      testing: rubric.testing.trim() === '' ? null : Number(rubric.testing),
    };
    if (rubricNums.correctness !== null && (!Number.isInteger(rubricNums.correctness) || rubricNums.correctness < 0 || rubricNums.correctness > 40)) return { error: 'Code correctness must be a whole number between 0 and 40.', markNum, rubricNums };
    if ([rubricNums.approach, rubricNums.quality, rubricNums.testing].some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 20))) return { error: 'Approach, quality and testing sub-scores must be whole numbers between 0 and 20.', markNum, rubricNums };
    const rubricTotal = rubricNums.correctness !== null && rubricNums.approach !== null && rubricNums.quality !== null && rubricNums.testing !== null
      ? rubricNums.correctness + rubricNums.approach + rubricNums.quality + rubricNums.testing
      : null;
    if (rubricTotal !== null && markNum !== null && rubricTotal !== markNum) return { error: `Rubric sub-scores total ${rubricTotal} but the mark is ${markNum}. They must match.`, markNum, rubricNums };
    return { error: null, markNum, rubricNums };
  }

  function loadInitialCode() {
    if (!sessionId) return;
    void (async () => {
      const { data } = await supabase.from('code_snapshots').select('code').eq('session_id', sessionId).order('created_at', { ascending: true }).limit(1);
      setInitialCode(data && data.length > 0 ? (data[0] as { code: string }).code : null);
    })();
  }

  async function saveDraft() {
    if (!sessionId || !session) return;
    const parsed = parseRubricInput();
    if (parsed.error) { setError(parsed.error); return; }
    setSaving(true); setError('');
    const payload = {
      session_id: sessionId,
      task_id: session.task_id,
      student_id: session.student_id,
      participant_id: session.participant_id,
      status: 'pending' as const,
      approved_mark: parsed.markNum,
      approved_correctness: parsed.rubricNums.correctness,
      approved_approach: parsed.rubricNums.approach,
      approved_quality: parsed.rubricNums.quality,
      approved_testing: parsed.rubricNums.testing,
      programming_feedback: feedback.trim() || null,
      metacog_planning: ratings.planning,
      metacog_monitoring: ratings.monitoring,
      metacog_scrutiny: ratings.scrutiny,
      metacog_evaluation: ratings.evaluation,
    };
    const { error: upsertError } = await supabase.from('assessments').upsert(payload, { onConflict: 'session_id' });
    if (upsertError) { setError('Failed to save the draft. Please try again.'); setSaving(false); return; }
    void logEvent({ sessionId, taskId: session.task_id, participantId: session.participant_id, phase: 'completed', eventType: 'PHASE_ENTERED', description: 'Researcher saved a private assessment draft (not visible to student).', metadata: {} });
    setSaving(false);
    setNotice('Draft saved privately. The student sees nothing until you approve and publish.');
    await load();
  }

  async function approve() {
    if (!sessionId || !session) return;
    const parsed = parseRubricInput();
    if (parsed.error) { setError(parsed.error); return; }
    const { markNum, rubricNums } = parsed;
    if (markNum === null) { setError('Enter a mark out of 100 before approving.'); return; }
    if (Object.values(ratings).some((r) => r === null)) { setError('Set all four metacognitive ratings before approving.'); return; }
    setSaving(true); setError('');
    const wasApproved = assessment?.status === 'approved';
    const payload = {
      session_id: sessionId,
      task_id: session.task_id,
      student_id: session.student_id,
      participant_id: session.participant_id,
      status: 'approved' as const,
      approved_mark: markNum,
      approved_correctness: rubricNums.correctness,
      approved_approach: rubricNums.approach,
      approved_quality: rubricNums.quality,
      approved_testing: rubricNums.testing,
      programming_feedback: feedback.trim() || null,
      metacog_planning: ratings.planning,
      metacog_monitoring: ratings.monitoring,
      metacog_scrutiny: ratings.scrutiny,
      metacog_evaluation: ratings.evaluation,
      approved_at: new Date().toISOString(),
      approved_by: profile?.id ?? null,
    };
    const { error: upsertError } = await supabase.from('assessments').upsert(payload, { onConflict: 'session_id' });
    if (upsertError) { setError('Failed to save the assessment. Please try again.'); setSaving(false); return; }
    if (wasApproved) {
      const { error: auditError } = await supabase.from('assessment_audit').insert({
        assessment_id: assessment!.id,
        changed_by: profile?.id ?? null,
        change_kind: 'correction',
        previous_mark: assessment!.approved_mark,
        previous_status: assessment!.status,
        new_mark: markNum,
        new_status: 'approved',
        previous_feedback: assessment!.programming_feedback,
        new_feedback: feedback.trim() || null,
        previous_rubric: { correctness: assessment!.approved_correctness, approach: assessment!.approved_approach, quality: assessment!.approved_quality, testing: assessment!.approved_testing },
        new_rubric: rubricNums,
      });
      if (auditError) { setError('Grade published, but recording the audit entry failed. Please check the assessment record.'); setSaving(false); return; }
    }
    void logEvent({ sessionId, taskId: session.task_id, participantId: session.participant_id, phase: 'completed', eventType: 'PHASE_EXITED', description: wasApproved ? 'Researcher corrected an approved assessment; audit entry recorded.' : 'Researcher approved the assessment and published it to the student.', metadata: {} });
    await load();
    setSaving(false);
    setNotice(wasApproved ? 'Correction published. The audit trail has been updated.' : 'Approved. The student can now see their mark, feedback and ratings.');
  }

  if (loading) return <div className="max-w-4xl mx-auto px-4 py-8 text-slate-400 text-sm">Loading session...</div>;
  if (!session) return <div className="max-w-4xl mx-auto px-4 py-8 text-red-600 text-sm">{error || 'Session not found.'}</div>;

  const approved = assessment?.status === 'approved';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <Link to="/researcher" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"><ArrowLeft className="w-4 h-4" /> Back to Assignment Grading</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest">Assignment Grading</p>
          <h1 className="text-2xl font-bold text-navy-900 mt-1">{session.task?.title ?? 'Task'}</h1>
          <p className="text-sm text-slate-500 mt-1">Participant <span className="font-mono">{session.participant_id}</span> · nothing is published until you approve.</p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${approved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{approved ? 'Approved — visible to student' : 'Draft — not yet approved'}</span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 p-3">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 p-3">{notice}</div>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">AI-suggested assessment</h2>
            <p className="text-xs text-slate-500 mt-1">Generates a rubric-based programming mark, feedback and metacognitive ratings from the session evidence.</p>
          </div>
          <button onClick={() => void generateSuggestion()} disabled={generating} className="flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-slate-800 disabled:opacity-50 shrink-0">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? 'Generating...' : assessment?.ai_suggested_at ? 'Regenerate suggestion' : 'Generate suggestion'}
          </button>
        </div>
        {assessment?.ai_suggested_at && (
          <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">AI-suggested mark</div>
              <div className="font-semibold text-slate-900">{assessment.ai_suggested_mark !== null ? `${assessment.ai_suggested_mark} / 100` : '—'}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Suggested at</div>
              <div className="font-semibold text-slate-900">{new Date(assessment.ai_suggested_at).toLocaleString()}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-500 mb-1.5">AI-suggested metacognitive ratings</div>
              <div className="flex flex-wrap gap-2">
                {RATING_CATEGORIES.map(({ key, label }) => {
                  const aiValue = key === 'planning' ? assessment.ai_suggested_planning : key === 'monitoring' ? assessment.ai_suggested_monitoring : key === 'scrutiny' ? assessment.ai_suggested_scrutiny : assessment.ai_suggested_evaluation;
                  return <span key={key} className="px-2 py-1 rounded-md text-xs border bg-slate-50 text-slate-600">{label}: {aiValue ? RATING_LABELS[aiValue] : '—'}</span>;
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="font-semibold text-navy-900 mb-4 flex items-center gap-2"><FileCode className="w-4 h-4 text-slate-400" /> Submitted work</h2>
        <div className="grid sm:grid-cols-3 gap-3 text-sm mb-4">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Programming language</div><div className="font-semibold text-navy-900 mt-0.5">{session.task?.language ?? '—'}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Code runs</div><div className="font-semibold text-navy-900 mt-0.5">{session.attempts?.[0]?.run_count ?? '—'}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Revisions saved</div><div className="font-semibold text-navy-900 mt-0.5">{session.attempts?.[0]?.revision_count ?? '—'}</div></div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">Original attempt (first saved code)</div>
            <pre className="h-56 overflow-auto bg-slate-950 text-slate-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">{initialCode || 'No initial code recorded.'}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">Final submitted code</div>
            <pre className="h-56 overflow-auto bg-slate-950 text-slate-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">{finalCode || 'No code recorded.'}</pre>
          </div>
        </div>
        {(session.attempts?.[0]?.last_output || session.attempts?.[0]?.last_error) && (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500 mb-1.5">Latest execution result</div>
            <pre className={`max-h-40 overflow-auto rounded-lg p-3 text-xs font-mono whitespace-pre-wrap ${session.attempts[0].last_error ? 'bg-red-950 text-red-200' : 'bg-slate-900 text-emerald-300'}`}>{session.attempts[0].last_error || session.attempts[0].last_output}</pre>
          </div>
        )}
        <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Task requirements: <span className="text-slate-700">{session.task?.problem_description?.slice(0, 300)}{(session.task?.problem_description?.length ?? 0) > 300 ? '…' : ''}</span></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="font-semibold text-navy-900 mb-4 flex items-center gap-2"><FileCode className="w-4 h-4 text-slate-400" /> Programming assessment</h2>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Mark out of 100</label>
        <input type="number" min={0} max={100} value={mark} onChange={(e) => setMark(e.target.value)} className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="0–100" />
        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">100-mark rubric breakdown</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([['correctness', 'Code correctness', 40], ['approach', 'Problem-solving approach', 20], ['quality', 'Code quality', 20], ['testing', 'Testing and debugging', 20]] as const).map(([key, label, max]) => (
              <div key={key}>
                <div className="text-xs text-slate-500 mb-1">{label} <span className="text-slate-400">/ {max}</span></div>
                <input type="number" min={0} max={max} value={rubric[key]} onChange={(e) => setRubric((prev) => ({ ...prev, [key]: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" placeholder={`0–${max}`} />
              </div>
            ))}
          </div>
        </div>
        <label className="block text-sm font-medium text-slate-700 mt-4 mb-1.5">Programming feedback <span className="text-slate-400 font-normal">(shown to the student once approved)</span></label>
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={6} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="What works well in the solution and what could be improved..." />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2"><Brain className="w-4 h-4 text-slate-400" /> Metacognitive assessment</h2>
        <p className="text-xs text-slate-500 mb-4">Qualitative ratings only. No written comments are shown to the student.</p>
        <div className="space-y-4">
          {RATING_CATEGORIES.map(({ key, label, helper }) => (
            <div key={key}>
              <div className="text-sm font-medium text-slate-800">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5 mb-2">{helper}</div>
              <div className="flex flex-wrap gap-2">
                {RATING_ORDER.map((r) => (
                  <button key={r} type="button" aria-pressed={ratings[key] === r}
                    onClick={() => setRatings((prev) => ({ ...prev, [key]: r }))}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${ratings[key] === r ? RATING_STYLES[r] : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {RATING_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {evidence && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-slate-400" /> Evidence references</h2>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Plans</div><div className="font-semibold">{evidence.plans.length}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">AI interactions</div><div className="font-semibold">{evidence.aiInteractions.length} {evidence.aiInteractions.length > 0 ? <span className="text-slate-400 font-normal text-xs">({evidence.aiInteractions.map((ai) => AI_CATEGORY_LABELS[ai.category]).join(', ')})</span> : null}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Scrutiny responses</div><div className="font-semibold">{evidence.scrutiny.length}</div></div>
            {evidence.attempts.length > 0 && <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Final run output</div><div className={evidence.attempts[evidence.attempts.length - 1].last_error ? 'text-red-600 font-medium break-all text-xs mt-1' : 'text-slate-900 font-medium break-all text-xs mt-1'}>{(evidence.attempts[evidence.attempts.length - 1].last_error || evidence.attempts[evidence.attempts.length - 1].last_output || '—').slice(0, 300)}</div></div>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!approved && (
          <button onClick={() => void saveDraft()} disabled={saving} className="flex items-center gap-2 border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Draft
          </button>
        )}
        <button onClick={() => void approve()} disabled={saving} className="flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {approved ? 'Update published assessment' : 'Approve & Publish'}
        </button>
        <button onClick={() => void load()} disabled={saving || generating} className="flex items-center gap-2 border border-slate-300 text-slate-600 text-sm px-4 py-2.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"><X className="w-4 h-4" /> Discard changes</button>
        {!approved && <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lightbulb className="w-3.5 h-3.5" /> The student sees nothing until you approve.</span>}
        {approved && assessment?.approved_at && (
          <span className="text-xs text-slate-400">Approved {new Date(assessment.approved_at).toLocaleString()}{assessment.approved_by ? ' · by ' + assessment.approved_by.slice(0, 8) : ''}</span>
        )}
      </div>
    </div>
  );
}

interface EvidenceBundle { plans: Plan[]; attempts: CodeAttempt[]; snapshots: CodeSnapshot[]; aiInteractions: AIInteraction[]; scrutiny: ScrutinyResponse[]; reflection: Reflection | null; }
interface AISuggestion { placeholder?: boolean; error?: string; programming?: { mark: number | null; correctness: number | null; approach: number | null; quality: number | null; testing: number | null; feedback: string | null }; metacognitive?: { planning: MetacognitiveRating | null; monitoring_and_attempt: MetacognitiveRating | null; critical_scrutiny_of_ai: MetacognitiveRating | null; evaluation: MetacognitiveRating | null }; evidence_refs?: Record<string, unknown>; }