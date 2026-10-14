import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, CheckCircle2, ClipboardCheck, Compass, FileCode, Inbox, Lightbulb, Play, ChevronRight, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import PhaseProgress from '@/components/PhaseProgress';
import { PHASE_LABELS, PHASES } from '@/lib/constants';
import { fetchStudentAnalytics, type StudentAnalytics, type WeeklyEngagement, type PhaseEngagement, type ApprovedMark } from '@/lib/analytics';
import { CardHeader, STUDENT_VS_COHORT_LEGEND, CHART_COLORS, GroupedBarChart, LineChart, BarCompare, BoxPlot, EmptyChart } from '@/components/charts';
import type { Assessment, Session, Task, TaskAssignment, MetacognitiveRating, PausePhase } from '@/lib/types';

interface DashboardTask {
  session: Session | null;
  task: Task;
  assignment: TaskAssignment;
}

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
const META_LABELS: { key: 'planning' | 'monitoring' | 'scrutiny' | 'evaluation'; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'monitoring', label: 'Monitoring and Attempt' },
  { key: 'scrutiny', label: 'Critical Scrutiny of AI' },
  { key: 'evaluation', label: 'Evaluation' },
];

function weekLabel(iso: WeeklyEngagement['week_start']): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function phaseShortLabel(phase: string): string {
  const meta = PHASES.find((p) => p.key === phase);
  return meta ? meta.label : phase;
}

export default function StudentDashboard() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [assessments, setAssessments] = useState<Map<string, Assessment>>(new Map());
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadDashboard();
  }, [profile]);

  async function loadDashboard() {
    if (!profile) return;
    const [assignments, sessions, approvedAssessments, analyticsData] = await Promise.all([
      supabase.from('task_assignments').select('*, task:tasks(*)').eq('student_id', profile.id).order('assigned_at', { ascending: false }),
      supabase.from('sessions').select('*, task:tasks(*)').eq('student_id', profile.id).order('started_at', { ascending: false }),
      supabase.from('assessments').select('*').eq('student_id', profile.id).eq('status', 'approved'),
      fetchStudentAnalytics(profile.id),
    ]);

    const sessionMap = new Map<string, Session>();
    (sessions.data ?? []).forEach((s) => sessionMap.set(s.task_id, s as Session));

    const dashboardTasks: DashboardTask[] = (assignments.data ?? []).map((a) => ({
      assignment: a as TaskAssignment,
      task: a.task as Task,
      session: sessionMap.get(a.task_id) ?? null,
    }));

    const assessmentMap = new Map<string, Assessment>();
    (approvedAssessments.data ?? []).forEach((a) => assessmentMap.set(a.session_id, a as Assessment));

    setTasks(dashboardTasks);
    setAssessments(assessmentMap);
    setAnalytics(analyticsData);
    setLoading(false);
  }

  const completed = tasks.filter((t) => t.session?.status === 'completed');
  const inProgress = tasks.filter((t) => t.session && t.session.status !== 'completed');
  const notStarted = tasks.filter((t) => !t.session);

  function getCompletedPhases(session: Session): Set<PausePhase> {
    const phases = new Set<PausePhase>();
    const order: PausePhase[] = ['plan', 'attempt', 'use_ai', 'scrutinise', 'edit', 'evaluate', 'completed'];
    const idx = order.indexOf(session.current_phase);
    for (let i = 0; i < idx; i++) phases.add(order[i] as PausePhase);
    return phases;
  }

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-8"><div className="text-slate-400 text-sm">Loading your dashboard...</div></div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Your learning analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Participant ID: <span className="font-mono font-medium text-slate-700">{profile?.participant_id}</span>
          </p>
        </div>
      </div>

      {/* Three-panel layout: horizontal on desktop, stacked on smaller screens */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <PanelLearningEngagement weekly={analytics?.weekly ?? []} phase={analytics?.phase_engagement ?? []} />
        <PanelProgrammingAssessment marks={analytics?.marks ?? []} cohortStats={analytics?.cohort_mark_stats ?? null} student={analytics?.student} />
        <PanelInterpretationAndGuidance marks={analytics?.marks ?? []} metacog={analytics?.metacog ?? null} student={analytics?.student} />
      </div>

      {/* PAUSE phases legend (kept from previous dashboard) */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="text-xs font-medium text-slate-500 mb-3">The PAUSE Framework</div>
        <PhaseProgress currentPhase="completed" completedPhases={new Set()} size="sm" />
      </div>

      {/* Task lists (existing functionality preserved) */}
      {tasks.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <Inbox className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No tasks assigned yet. Your instructor will assign programming tasks for you to work through.</p>
        </div>
      )}

      {inProgress.length > 0 && <TaskSection title="In Progress" tasks={inProgress} getCompletedPhases={getCompletedPhases} />}
      {notStarted.length > 0 && <TaskSection title="Not Started" tasks={notStarted} getCompletedPhases={getCompletedPhases} showStart />}
      {completed.length > 0 && <TaskSection title="Completed" tasks={completed} getCompletedPhases={getCompletedPhases} showCompleted assessments={assessments} />}
    </div>
  );
}

/* ------------------------------- PANEL 1 ------------------------------- */

function PanelLearningEngagement({ weekly, phase }: { weekly: WeeklyEngagement[]; phase: PhaseEngagement[] }) {
  const weeksWithActivity = weekly.filter((w) => w.student_events > 0 || (w.cohort_avg_events ?? 0) > 0);
  const firstActive = weeksWithActivity.length > 0;
  const chartWeeks = firstActive ? weeksWithActivity : [];
  return (
    <section aria-labelledby="panel1-title" className="space-y-5">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-600" />
        <h2 id="panel1-title" className="text-base font-bold text-slate-900">Learning Engagement</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader
          title="Weekly learning engagement"
          subtitle="Recorded activity events per week, you versus cohort average"
          legend={STUDENT_VS_COHORT_LEGEND}
        />
        <LineChart
          data={chartWeeks.map((w) => ({ label: weekLabel(w.week_start), values: { student: w.student_events, cohort: w.cohort_avg_events } }))}
          series={[{ key: 'student', label: 'You', color: CHART_COLORS.student }, { key: 'cohort', label: 'Cohort average', color: CHART_COLORS.cohort, dashed: true }]}
        />
        {!firstActive && <EmptyChart message="Your activity will appear here once you start working on a task." />}
        <p className="text-[11px] text-slate-400 mt-3">Engagement indicator: number of recorded interaction events (plans, code runs, tests, AI requests, reflections) per week.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader
          title="PAUSE phase engagement"
          subtitle="Your participation in each phase versus cohort average"
          legend={STUDENT_VS_COHORT_LEGEND}
        />
        {phase.length === 0 ? <EmptyChart message="Phase engagement will appear once you begin a task." /> : (
          <div className="space-y-3" role="img" aria-label="Phase engagement chart">
            {phase.map((p) => (
              <BarCompare key={p.phase} label={phaseShortLabel(p.phase)} value={p.student_events} reference={p.cohort_avg_events} referenceLabel="cohort avg" />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="AI assistance and learning activity" subtitle="Your recorded AI requests, independent attempts, scrutiny and completions per week" />
        <GroupedBarChart
          data={chartWeeks.map((w) => ({ label: weekLabel(w.week_start), values: { ai: w.student_ai_requests, attempts: w.student_attempts, scrutiny: w.student_scrutiny, completions: w.student_completions } }))}
          series={[
            { key: 'ai', label: 'AI requests', color: CHART_COLORS.student },
            { key: 'attempts', label: 'Independent attempts', color: '#7C3AED' },
            { key: 'scrutiny', label: 'Scrutiny activities', color: '#0D9488' },
            { key: 'completions', label: 'Task completions', color: '#F59E0B' },
          ]}
        />
        {chartWeeks.length === 0 && <EmptyChart message="Activity will appear once you start a task." />}
      </div>
    </section>
  );
}

/* ------------------------------- PANEL 2 ------------------------------- */

function PanelProgrammingAssessment({ marks, cohortStats, student }: { marks: ApprovedMark[]; cohortStats: StudentAnalytics['cohort_mark_stats']; student: StudentAnalytics['student'] | undefined }) {
  if (marks.length === 0) {
    return (
      <section aria-labelledby="panel2-title" className="space-y-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-purple-600" />
          <h2 id="panel2-title" className="text-base font-bold text-slate-900">Programming Assessment</h2>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <FileCode className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No approved marks yet. Your programming marks appear here after your instructor approves your assessments.</p>
        </div>
      </section>
    );
  }
  const avgMark = marks.reduce((s, m) => s + (m.mark ?? 0), 0) / marks.length;
  const latest = marks[0];
  const completionRate = student && student.assigned_tasks > 0 ? Math.round((student.completed_tasks / student.assigned_tasks) * 100) : null;
  const trendDelta = marks.length >= 2 && marks[marks.length - 1].completed_at && marks[0].completed_at ? (marks[0].mark ?? 0) - (marks[marks.length - 1].mark ?? 0) : null;

  return (
    <section aria-labelledby="panel2-title" className="space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-purple-600" />
        <h2 id="panel2-title" className="text-base font-bold text-slate-900">Programming Assessment</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader
          title="Assignment marks"
          subtitle="Researcher-approved marks out of 100 across your assignments"
          legend={STUDENT_VS_COHORT_LEGEND}
        />
        <LineChart
          data={marks.slice().reverse().map((m) => ({ label: m.task_title.slice(0, 12), values: { mark: m.mark } }))}
          series={[{ key: 'mark', label: 'Your mark', color: CHART_COLORS.student }]}
          yMax={100}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Assignment marks distribution" subtitle="Where your average sits within the cohort" />
        {cohortStats ? (
          <BoxPlot min={cohortStats.min} q1={cohortStats.q1} median={cohortStats.median} q3={cohortStats.q3} max={cohortStats.max} student={avgMark} />
        ) : (
          <EmptyChart message="Cohort comparison appears once at least three students have approved marks." />
        )}
        {cohortStats && (
          <p className="text-[11px] text-slate-400 mt-2">Shown as cohort summary only (n={cohortStats.cohort_size}). Individual marks of other students are never displayed.</p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Assessment summary" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          <SummaryTile icon={<TrendingUp className="w-4 h-4 text-slate-400" />} label="Average mark" value={`${marks.length > 0 ? Math.round(avgMark) : '—'}/100`} />
          <SummaryTile icon={<FileCode className="w-4 h-4 text-slate-400" />} label="Latest mark" value={latest ? `${latest.mark}/100` : '—'} />
          <SummaryTile icon={<CheckCircle2 className="w-4 h-4 text-slate-400" />} label="Task completion" value={completionRate !== null ? `${completionRate}%` : '—'} />
          <SummaryTile icon={<Activity className="w-4 h-4 text-slate-400" />} label="Mark trend" value={trendDelta !== null ? (trendDelta > 0 ? `+${trendDelta}` : String(trendDelta)) : '—'} />
        </div>
        {latest?.feedback && (
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500 mb-1.5">Latest researcher-approved feedback</div>
            <p className="text-sm text-slate-700 leading-6">{latest.feedback}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------- PANEL 3 ------------------------------- */

function PanelInterpretationAndGuidance({ marks, metacog, student }: { marks: ApprovedMark[]; metacog: StudentAnalytics['metacog']; student: StudentAnalytics['student'] | undefined }) {
  const latestFeedback = marks.find((m) => m.feedback && m.feedback.trim().length > 0)?.feedback ?? null;
  const avgMark = marks.length > 0 ? Math.round(marks.reduce((s, m) => s + (m.mark ?? 0), 0) / marks.length) : null;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (student) {
    if (student.independent_attempts >= 3) strengths.push('regular independent code runs during the Attempt phase');
    if (student.scrutiny_activities >= 1) strengths.push('evaluating AI responses before using them');
    if (student.scrutiny_activities === 0 && student.ai_requests > 0) weaknesses.push('recording observations about AI responses was not observed — try completing the Scrutinise step after each AI interaction');
    if (student.independent_attempts === 0) weaknesses.push('few recorded independent test runs during the Attempt phase');
  }
  if (avgMark !== null && avgMark >= 80) strengths.push('high approved marks across assignments');
  if (avgMark !== null && avgMark < 50) weaknesses.push('approved marks suggest focusing on core task requirements first');

  return (
    <section aria-labelledby="panel3-title" className="space-y-5">
      <div className="flex items-center gap-2">
        <Compass className="w-4 h-4 text-teal-600" />
        <h2 id="panel3-title" className="text-base font-bold text-slate-900">Learning Interpretation and Guidance</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Learning progress summary" subtitle="Based on your recorded activity and approved assessments" />
        <div className="grid grid-cols-3 gap-3 mb-4">
          <SummaryTile icon={<CheckCircle2 className="w-4 h-4 text-slate-400" />} label="Tasks completed" value={String(student?.completed_tasks ?? 0)} />
          <SummaryTile icon={<Activity className="w-4 h-4 text-slate-400" />} label="Events recorded" value={String(student?.total_events ?? 0)} />
          <SummaryTile icon={<FileCode className="w-4 h-4 text-slate-400" />} label="Avg mark" value={avgMark !== null ? `${avgMark}/100` : '—'} />
        </div>
        {strengths.length > 0 && (
          <div className="text-sm text-slate-700 leading-6 mb-2">
            <span className="font-medium">Observed patterns:</span> your activity shows {strengths.join(', and ')}.
          </div>
        )}
        {(student?.completed_tasks ?? 0) === 0 && <p className="text-sm text-slate-500">Complete your first task to see engagement patterns here.</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Metacognitive process ratings" subtitle="Qualitative ratings from your approved assessments — no marks or comments are attached" />
        {metacog ? (
          <div className="space-y-2.5">
            {META_LABELS.map(({ key, label }) => {
              const value = metacog[key];
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className={`px-2.5 py-1 rounded-md border text-xs font-medium shrink-0 ${value ? RATING_STYLES[value] : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                    {value ? RATING_LABELS[value] : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyChart height={80} message="Ratings appear once your instructor approves an assessment." />
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Programming performance interpretation" subtitle="What your approved marks and recorded activity show" />
        {avgMark === null && latestFeedback === null ? (
          <p className="text-sm text-slate-500">Interpretation appears once your instructor approves a programming assessment.</p>
        ) : (
          <ul className="text-sm text-slate-700 leading-6 space-y-2">
            {avgMark !== null && (
              <li className="flex gap-2"><span className="text-slate-400 shrink-0">•</span><span>Your approved programming marks average <strong>{avgMark}/100</strong> across {marks.length} assessed task{marks.length === 1 ? '' : 's'}.</span></li>
            )}
            {strengths.length > 0 && <li className="flex gap-2"><span className="text-slate-400 shrink-0">•</span><span>Observed strength: {strengths.join('; ')}.</span></li>}
            {weaknesses.length > 0 && <li className="flex gap-2"><span className="text-[10px] mt-2 text-amber-500 shrink-0">▲</span><span>Observed area to develop: {weaknesses.join('; ')}.</span></li>}
            {latestFeedback && <li className="flex gap-2"><span className="text-slate-400 shrink-0">•</span><span>From your latest approved feedback: {latestFeedback.slice(0, 240)}{latestFeedback.length > 240 ? '…' : ''}</span></li>}
          </ul>
        )}
        <p className="text-[11px] text-slate-400 mt-3">Interpretations describe observed evidence only and do not predict future performance.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Recommended next programming action" subtitle="Derived from your researcher-approved programming feedback" />
        {latestFeedback ? (
          <ul className="text-sm text-slate-700 leading-6 space-y-2">
            <li className="flex gap-2"><Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-1" /><span>Re-read your approved feedback and list the two most concrete code changes it suggests for your next task.</span></li>
            <li className="flex gap-2"><Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-1" /><span>Before your next submission, run your code against the task's test cases and fix any mismatch the feedback highlighted.</span></li>
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Recommendations appear once your instructor approves programming feedback on one of your tasks.</p>
        )}
        <p className="text-[11px] text-slate-400 mt-3">Only approved programming feedback is used. Metacognitive ratings contribute to research analysis but not to these recommendations.</p>
      </div>
    </section>
  );
}

function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">{icon}<span className="text-[10px] uppercase tracking-wide font-medium">{label}</span></div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

/* Existing task sections preserved below */

function TaskSection({
  title,
  tasks,
  getCompletedPhases,
  showStart,
  showCompleted,
  assessments,
}: {
  title: string;
  tasks: DashboardTask[];
  getCompletedPhases: (s: Session) => Set<PausePhase>;
  showStart?: boolean;
  showCompleted?: boolean;
  assessments?: Map<string, Assessment>;
}) {
  return (
    <div className="mb-2">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
      <div className="space-y-2">
        {tasks.map(({ task, session }) => (
          <Link
            key={task.id}
            to={session ? `/task/${session.id}` : `/task/start/${task.id}`}
            className="block bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900 truncate">{task.title}</h3>
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-medium rounded uppercase tracking-wide">
                    {task.language}
                  </span>
                  <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">
                    {task.difficulty}
                  </span>
                </div>
                <p className="text-sm text-slate-500 line-clamp-2">{task.problem_description}</p>
                {session && !showCompleted && (
                  <div className="mt-3">
                    <PhaseProgress currentPhase={session.current_phase} completedPhases={getCompletedPhases(session)} size="sm" />
                    <div className="text-xs text-slate-400 mt-1.5">
                      Current phase: <span className="font-medium text-slate-600">{PHASE_LABELS[session.current_phase]}</span>
                    </div>
                  </div>
                )}
                {showCompleted && session && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                    {assessments?.get(session.id) && (
                      <Link to={`/task/${session.id}/results`} className="ml-2 flex items-center gap-1.5 text-xs font-medium bg-slate-900 text-white px-2.5 py-1 rounded-md hover:bg-slate-800">
                        <ClipboardCheck className="w-3.5 h-3.5" /> Results: {assessments.get(session.id)!.approved_mark ?? '—'}/100
                      </Link>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {showStart && (
                  <span className="flex items-center gap-1 text-xs text-slate-500 group-hover:text-slate-900">
                    <Play className="w-3.5 h-3.5" /> Start
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}