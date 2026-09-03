import { useEffect, useState } from 'react';
import { Check, Plus, Save, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Task } from '@/lib/types';

interface StudentParticipant {
  id: string;
  participant_id: string;
}

const blank = {
  title: '',
  language: 'python',
  difficulty: 'beginner',
  learning_objectives: '',
  problem_description: '',
  expected_inputs: '',
  expected_outputs: '',
  starter_code: '',
  concept_tags: '',
};

export default function TaskManagement() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [assignmentTask, setAssignmentTask] = useState<Task | null>(null);
  const [students, setStudents] = useState<StudentParticipant[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadTasks();
  }, []);

  async function loadTasks() {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    setTasks((data ?? []) as Task[]);
  }

  async function save() {
    if (!profile) return;
    const { error } = await supabase.from('tasks').insert({ ...form, test_cases: [] });
    if (error) {
      setMessage('Could not create the task. Please try again.');
      return;
    }
    setMessage('Task created.');
    setForm(blank);
    setOpen(false);
    void loadTasks();
  }

  async function openAssignment(task: Task) {
    setAssignmentTask(task);
    setSelectedStudents([]);
    setMessage('');
    setLoadingStudents(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, participant_id')
      .eq('role', 'student')
      .order('participant_id');
    if (error) {
      setMessage('Could not load student participants. Please try again.');
      setStudents([]);
    } else {
      setStudents((data ?? []) as StudentParticipant[]);
    }
    setLoadingStudents(false);
  }

  function closeAssignment() {
    if (savingAssignment) return;
    setAssignmentTask(null);
    setSelectedStudents([]);
  }

  function toggleStudent(studentId: string) {
    setSelectedStudents((current) => current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId]);
  }

  async function assignTask() {
    if (!profile || !assignmentTask || selectedStudents.length === 0) return;
    setSavingAssignment(true);
    setMessage('');

    const selected = students.filter((student) => selectedStudents.includes(student.id));
    const assignments = selected.map((student) => ({
      task_id: assignmentTask.id,
      student_id: student.id,
      participant_id: student.participant_id,
      assigned_by: profile.id,
      status: 'not_started',
      current_pause_phase: 'plan',
    }));
    const { data, error } = await supabase
      .from('task_assignments')
      .insert(assignments)
      .select('id, task_id, student_id, participant_id');

    if (error || !data) {
      setMessage('One or more selected participants already have this task, or the assignment could not be saved.');
      setSavingAssignment(false);
      return;
    }

    const events = data.map((assignment) => ({
      participant_id: assignment.participant_id,
      student_id: profile.id,
      session_id: null,
      task_id: assignmentTask.id,
      pause_phase: 'plan',
      event_type: 'TASK_ASSIGNED',
      event_description: 'Researcher assigned a programming task to a participant.',
      metadata: { assignment_id: assignment.id, assigned_student_id: assignment.student_id },
    }));
    const eventResult = await supabase.from('event_logs').insert(events);
    if (eventResult.error) {
      console.error('Assignment saved but event logging failed:', eventResult.error.message);
    }

    setMessage('Task assigned successfully.');
    setSavingAssignment(false);
    closeAssignment();
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Programming tasks</h1>
          <p className="text-sm text-slate-500 mt-1">Create Python-first tasks for PAUSE sessions.</p>
        </div>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> New task
        </button>
      </div>

      {message && !assignmentTask && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg p-3 text-sm mb-4">{message}</div>
      )}

      {open && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <div className="flex justify-between mb-4">
            <h2 className="font-semibold">New programming task</h2>
            <button onClick={() => setOpen(false)} aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {([
              ['title', 'Title'],
              ['learning_objectives', 'Learning objectives'],
              ['problem_description', 'Problem description'],
              ['expected_inputs', 'Expected inputs'],
              ['expected_outputs', 'Expected outputs'],
              ['starter_code', 'Starter code'],
              ['concept_tags', 'Concept tags'],
            ] as const).map(([key, label]) => (
              <label key={key} className={key === 'problem_description' || key === 'starter_code' ? 'md:col-span-2' : ''}>
                <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
                <textarea
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  rows={key === 'problem_description' || key === 'starter_code' ? 5 : 2}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm"
                />
              </label>
            ))}
          </div>
          <button onClick={() => void save()} className="mt-4 flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">
            <Save className="w-4 h-4" /> Save task
          </button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">{task.title}</h2>
                <p className="text-sm text-slate-500 mt-1">{task.problem_description}</p>
              </div>
              <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-between gap-3 shrink-0">
                <span className="text-xs text-slate-500 uppercase">{task.language} · {task.difficulty}</span>
                <button
                  onClick={() => void openAssignment(task)}
                  className="flex items-center gap-2 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
                >
                  <UserPlus className="w-4 h-4" /> Assign Task
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {assignmentTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4" role="presentation">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl p-5" role="dialog" aria-modal="true" aria-labelledby="assign-task-title">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 id="assign-task-title" className="text-lg font-semibold text-slate-900">Assign Task</h2>
                <p className="text-sm text-slate-500 mt-1">Task: <span className="font-medium text-slate-700">{assignmentTask.title}</span></p>
              </div>
              <button onClick={closeAssignment} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
              {loadingStudents && <p className="p-4 text-sm text-slate-500">Loading participants...</p>}
              {!loadingStudents && students.length === 0 && <p className="p-4 text-sm text-slate-500">No student participants are available.</p>}
              {!loadingStudents && students.map((student) => (
                <label key={student.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-slate-100 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selectedStudents.includes(student.id)} onChange={() => toggleStudent(student.id)} className="h-4 w-4 rounded border-slate-300" />
                  <span className="font-mono text-sm text-slate-700">{student.participant_id}</span>
                </label>
              ))}
            </div>

            {message && <div className="mt-3 flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg p-3 text-sm"><Check className="w-4 h-4 shrink-0" />{message}</div>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeAssignment} disabled={savingAssignment} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button onClick={() => void assignTask()} disabled={savingAssignment || selectedStudents.length === 0 || loadingStudents} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                {savingAssignment ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
