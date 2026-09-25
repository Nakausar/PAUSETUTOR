import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, CheckCircle2, Clock, ChevronRight, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import PhaseProgress from '@/components/PhaseProgress';
import { PHASES, PHASE_LABELS } from '@/lib/constants';
import type { Session, Task, TaskAssignment, PausePhase } from '@/lib/types';

interface DashboardTask {
  session: Session | null;
  task: Task;
  assignment: TaskAssignment;
}

export default function StudentDashboard() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadDashboard();
  }, [profile]);

  async function loadDashboard() {
    if (!profile) return;

    // Get assigned tasks
    const { data: assignments } = await supabase
      .from('task_assignments')
      .select('*, task:tasks(*)')
      .eq('student_id', profile.id)
      .order('assigned_at', { ascending: false });

    // Get sessions for this student
    const { data: sessions } = await supabase
      .from('sessions')
      .select('*, task:tasks(*)')
      .eq('student_id', profile.id)
      .order('started_at', { ascending: false });

    const sessionMap = new Map<string, Session>();
    (sessions ?? []).forEach((s) => sessionMap.set(s.task_id, s as Session));

    const dashboardTasks: DashboardTask[] = (assignments ?? []).map((a) => ({
      assignment: a as TaskAssignment,
      task: a.task as Task,
      session: sessionMap.get(a.task_id) ?? null,
    }));

    setTasks(dashboardTasks);
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
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-slate-400 text-sm">Loading your tasks...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Your Tasks</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Participant ID: <span className="font-mono font-medium text-slate-700">{profile?.participant_id}</span>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <Inbox className="w-3.5 h-3.5" /> Not Started
          </div>
          <div className="text-2xl font-bold text-slate-900">{notStarted.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <Clock className="w-3.5 h-3.5" /> In Progress
          </div>
          <div className="text-2xl font-bold text-slate-900">{inProgress.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Completed
          </div>
          <div className="text-2xl font-bold text-slate-900">{completed.length}</div>
        </div>
      </div>

      {/* PAUSE phases legend */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6">
        <div className="text-xs font-medium text-slate-500 mb-3">The PAUSE Framework</div>
        <PhaseProgress currentPhase="completed" completedPhases={new Set()} size="sm" />
      </div>

      {/* Task lists */}
      {tasks.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-sm">No tasks assigned yet. Your instructor will assign programming tasks for you to work through.</p>
        </div>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <TaskSection title="In Progress" tasks={inProgress} getCompletedPhases={getCompletedPhases} />
      )}

      {/* Not Started */}
      {notStarted.length > 0 && (
        <TaskSection title="Not Started" tasks={notStarted} getCompletedPhases={getCompletedPhases} showStart />
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <TaskSection title="Completed" tasks={completed} getCompletedPhases={getCompletedPhases} showCompleted />
      )}
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  getCompletedPhases,
  showStart,
  showCompleted,
}: {
  title: string;
  tasks: DashboardTask[];
  getCompletedPhases: (s: Session) => Set<PausePhase>;
  showStart?: boolean;
  showCompleted?: boolean;
}) {
  return (
    <div className="mb-6">
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
                    <PhaseProgress
                      currentPhase={session.current_phase}
                      completedPhases={getCompletedPhases(session)}
                      size="sm"
                    />
                    <div className="text-xs text-slate-400 mt-1.5">
                      Current phase: <span className="font-medium text-slate-600">{PHASE_LABELS[session.current_phase]}</span>
                    </div>
                  </div>
                )}
                {showCompleted && session && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completed
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
