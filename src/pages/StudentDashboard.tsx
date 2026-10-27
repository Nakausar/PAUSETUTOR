import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Inbox, Play, ChevronRight, Award, Clock, FileCode } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import PhaseProgress from '@/components/PhaseProgress';
import { PHASE_LABELS } from '@/lib/constants';
import type { Assessment, Session, Task, TaskAssignment, PausePhase } from '@/lib/types';

interface DashboardTask {
  session: Session | null;
  task: Task;
  assignment: TaskAssignment;
}

export default function StudentDashboard() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [assessments, setAssessments] = useState<Map<string, Assessment>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadDashboard();
  }, [profile]);

  async function loadDashboard() {
    if (!profile) return;
    const [assignments, sessions, approvedAssessments] = await Promise.all([
      supabase.from('task_assignments').select('*, task:tasks(*)').eq('student_id', profile.id).order('assigned_at', { ascending: false }),
      supabase.from('sessions').select('*, task:tasks(*)').eq('student_id', profile.id).order('started_at', { ascending: false }),
      supabase.from('assessments').select('*').eq('student_id', profile.id).eq('status', 'approved'),
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
    setLoading(false);
  }

  const completed = tasks.filter((t) => t.session?.status === 'completed');
  const inProgress = tasks.filter((t) => t.session && t.session.status !== 'completed');
  const notStarted = tasks.filter((t) => !t.session);
  const graded = completed.filter((t) => t.session && assessments.has(t.session.id));
  const pendingCount = inProgress.length + notStarted.length;

  function getCompletedPhases(session: Session): Set<PausePhase> {
    const phases = new Set<PausePhase>();
    const order: PausePhase[] = ['plan', 'attempt', 'use_ai', 'scrutinise', 'evaluate', 'completed'];
    const idx = order.indexOf(session.current_phase);
    for (let i = 0; i < idx; i++) phases.add(order[i] as PausePhase);
    return phases;
  }

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 py-8"><div className="text-slate-400 text-sm">Loading your tasks...</div></div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-navy-900">My Tasks</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Participant ID: <span className="font-mono font-medium text-slate-700">{profile?.participant_id}</span>
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile icon={<FileCode className="w-4 h-4 text-blue-600" />} label="My assigned tasks" value={String(tasks.length)} />
        <SummaryTile icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} label="Completed assignments" value={String(completed.length)} />
        <SummaryTile icon={<Clock className="w-4 h-4 text-amber-600" />} label="Pending assignments" value={String(pendingCount)} />
        <SummaryTile icon={<Award className="w-4 h-4 text-blue-600" />} label="Graded assignments" value={String(graded.length)} />
      </div>

      {/* Approved grades + instructor feedback */}
      {graded.length > 0 && (
        <section aria-labelledby="grades-heading" className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 id="grades-heading" className="text-base font-bold text-navy-900 mb-4">Approved grades and instructor feedback</h2>
          <div className="space-y-3">
            {graded.map(({ task, session }) => {
              const a = assessments.get(session!.id)!;
              return (
                <div key={session!.id} className="border border-slate-100 rounded-lg p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-navy-900">{task.title}</h3>
                    <span className="text-lg font-bold text-blue-700">{a.approved_mark ?? '—'}/100</span>
                  </div>
                  {a.programming_feedback && a.programming_feedback.trim().length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <div className="text-xs font-medium text-slate-500 mb-1">Instructor feedback</div>
                      <p className="text-sm text-slate-700 leading-6">{a.programming_feedback}</p>
                    </div>
                  )}
                  <Link to={`/task/${session!.id}/results`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
                    <ClipboardCheck className="w-3.5 h-3.5" /> View full results
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* PAUSE phase indicator (five-phase framework) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-medium text-slate-500 mb-3">The PAUSE Framework: Plan → Attempt → Use AI → Scrutinise → Evaluate</div>
        <PhaseProgress currentPhase="completed" completedPhases={new Set()} size="sm" />
      </div>

      {/* Task lists */}
      {tasks.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <Inbox className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No tasks assigned yet. Your instructor will assign programming tasks for you to work through.</p>
        </div>
      )}

      {inProgress.length > 0 && <TaskSection title="Pending — In Progress" tasks={inProgress} getCompletedPhases={getCompletedPhases} />}
      {notStarted.length > 0 && <TaskSection title="Pending — Not Started" tasks={notStarted} getCompletedPhases={getCompletedPhases} showStart />}
      {completed.length > 0 && <TaskSection title="Completed" tasks={completed} getCompletedPhases={getCompletedPhases} showCompleted assessments={assessments} />}
    </div>
  );
}

function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5 text-slate-500 mb-1.5">{icon}<span className="text-[10px] uppercase tracking-wide font-medium">{label}</span></div>
      <div className="text-xl font-bold text-navy-900">{value}</div>
    </div>
  );
}

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
      <h2 className="text-sm font-semibold text-navy-900 mb-3">{title}</h2>
      <div className="space-y-2">
        {tasks.map(({ task, session }) => (
          <Link
            key={task.id}
            to={session ? `/task/${session.id}` : `/task/start/${task.id}`}
            className="block bg-white rounded-lg border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-navy-900 truncate">{task.title}</h3>
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
                      <Link to={`/task/${session.id}/results`} className="ml-2 flex items-center gap-1.5 text-xs font-medium bg-blue-700 text-white px-2.5 py-1 rounded-md hover:bg-blue-800">
                        <ClipboardCheck className="w-3.5 h-3.5" /> Results: {assessments.get(session.id)!.approved_mark ?? '—'}/100
                      </Link>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {showStart && (
                  <span className="flex items-center gap-1 text-xs text-slate-500 group-hover:text-blue-700">
                    <Play className="w-3.5 h-3.5" /> Start
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
