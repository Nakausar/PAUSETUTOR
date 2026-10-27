import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Clock, FileCode, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Assessment, Session, Task, TaskAssignment } from '@/lib/types';

type RowStatus = 'not_submitted' | 'submitted' | 'ai_draft' | 'under_review' | 'approved';

const STATUS_META: Record<RowStatus, { label: string; className: string }> = {
  not_submitted: { label: 'Not submitted', className: 'bg-slate-100 text-slate-500' },
  submitted: { label: 'Submitted', className: 'bg-blue-50 text-blue-700' },
  ai_draft: { label: 'AI draft available', className: 'bg-violet-50 text-violet-700' },
  under_review: { label: 'Under review', className: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700' },
};

const STATUS_ORDER: Record<RowStatus, number> = { under_review: 0, ai_draft: 1, submitted: 2, approved: 3, not_submitted: 4 };

interface GradeRow {
  key: string;
  studentId: string;
  participantId: string;
  taskId: string;
  assignment: string;
  submittedAt: string | null;
  sessionId: string | null;
  status: RowStatus;
  correctness: number | null;
  approach: number | null;
  quality: number | null;
  testing: number | null;
  total: number | null;
}

type SortKey = 'participantId' | 'assignment' | 'submittedAt' | 'status' | 'total';

export default function ResearcherDashboard() {
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTask, setFilterTask] = useState('all');
  const [filterStudent, setFilterStudent] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => { void reload(); }, []);
  async function reload() {
    setLoading(true);
    const [assignments, students, sessions, assessments] = await Promise.all([
      supabase.from('task_assignments').select('*, task:tasks(id, title)').order('assigned_at', { ascending: false }),
      supabase.from('profiles').select('id, participant_id').eq('role', 'student'),
      supabase.from('sessions').select('*').order('started_at', { ascending: false }),
      supabase.from('assessments').select('*'),
    ]);

    const studentMap = new Map<string, string>();
    (students.data ?? []).forEach((s) => studentMap.set(s.id, s.participant_id));
    const sessionMap = new Map<string, Session>();
    (sessions.data ?? []).forEach((s) => {
      const key = `${(s as Session).student_id}:${(s as Session).task_id}`;
      if (!sessionMap.has(key)) sessionMap.set(key, s as Session);
    });
    const assessmentMap = new Map<string, Assessment>();
    (assessments.data ?? []).forEach((a) => assessmentMap.set((a as Assessment).session_id, a as Assessment));

    const built: GradeRow[] = ((assignments.data ?? []) as (TaskAssignment & { task?: Pick<Task, 'id' | 'title'> })[]).map((a) => {
      const session = sessionMap.get(`${a.student_id}:${a.task_id}`) ?? null;
      const assessment = session ? assessmentMap.get(session.id) ?? null : null;
      let status: RowStatus = 'not_submitted';
      if (session && assessment) {
        if (assessment.status === 'approved') status = 'approved';
        else if (assessment.approved_mark !== null || assessment.approved_correctness !== null || assessment.approved_approach !== null || assessment.approved_quality !== null || assessment.approved_testing !== null) status = 'under_review';
        else if (assessment.ai_suggested_at) status = 'ai_draft';
        else status = 'submitted';
      } else if (session) {
        status = 'submitted';
      }
      const parts = assessment ? [assessment.approved_correctness, assessment.approved_approach, assessment.approved_quality, assessment.approved_testing] : [null, null, null, null];
      const total = parts.every((p) => p !== null) ? (parts as number[]).reduce((s, v) => s + v, 0) : null;
      return {
        key: `${a.student_id}:${a.task_id}`,
        studentId: a.student_id,
        participantId: studentMap.get(a.student_id) ?? a.student_id,
        taskId: a.task_id,
        assignment: a.task?.title ?? 'Task',
        submittedAt: session?.started_at ?? null,
        sessionId: session?.id ?? null,
        status,
        correctness: assessment?.approved_correctness ?? null,
        approach: assessment?.approved_approach ?? null,
        quality: assessment?.approved_quality ?? null,
        testing: assessment?.approved_testing ?? null,
        total: assessment?.status === 'approved' ? assessment.approved_mark ?? total : total,
      };
    });
    setRows(built);
    setLoading(false);
  }

  const tasks = useMemo(() => Array.from(new Map(rows.map((r) => [r.taskId, r.assignment])).entries()), [rows]);
  const students = useMemo(() => Array.from(new Map(rows.map((r) => [r.studentId, r.participantId])).entries()), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterTask !== 'all' && r.taskId !== filterTask) return false;
    if (filterStudent !== 'all' && r.studentId !== filterStudent) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterFrom && (!r.submittedAt || r.submittedAt.slice(0, 10) < filterFrom)) return false;
    if (filterTo && (!r.submittedAt || r.submittedAt.slice(0, 10) > filterTo)) return false;
    const q = search.trim().toLowerCase();
    if (q && !r.participantId.toLowerCase().includes(q) && !r.assignment.toLowerCase().includes(q)) return false;
    return true;
  }), [rows, search, filterTask, filterStudent, filterStatus, filterFrom, filterTo]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      else if (sortKey === 'submittedAt') cmp = (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '');
      else if (sortKey === 'total') cmp = (a.total ?? -1) - (b.total ?? -1);
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const totalSubmissions = rows.filter((r) => r.sessionId).length;
  const pendingGrading = rows.filter((r) => r.status === 'submitted' || r.status === 'ai_draft' || r.status === 'under_review').length;
  const graded = rows.filter((r) => r.status === 'approved').length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }
  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy-900">Assignment Grading</h1>
        <button onClick={() => void reload()} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500"><FileCode className="w-4 h-4 text-blue-600" /> Total submissions</div>
          <div className="text-3xl font-bold text-navy-900 mt-1">{totalSubmissions}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500"><Clock className="w-4 h-4 text-amber-600" /> Pending grading</div>
          <div className="text-3xl font-bold text-navy-900 mt-1">{pendingGrading}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Graded submissions</div>
          <div className="text-3xl font-bold text-navy-900 mt-1">{graded}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <label className="text-xs text-slate-500 md:col-span-2">Search
            <div className="relative mt-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student or assignment..." className="w-full border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 text-sm" />
            </div>
          </label>
          <label className="text-xs text-slate-500">Assignment
            <select value={filterTask} onChange={(e) => setFilterTask(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {tasks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Student
            <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {students.map(([id, pid]) => <option key={id} value={id}>{pid}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Grading status
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {(Object.keys(STATUS_META) as RowStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Submitted between
            <div className="flex gap-1.5 mt-1">
              <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="w-full border border-slate-300 rounded-lg px-1.5 py-1.5 text-xs" />
              <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="w-full border border-slate-300 rounded-lg px-1.5 py-1.5 text-xs" />
            </div>
          </label>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        {loading ? <div className="text-slate-400 text-sm">Loading submissions...</div> : sorted.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-8">No submissions match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500"><tr className="text-left">
                <th className="py-2 px-2 border-b border-slate-100 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('participantId')}>Student ID{sortIndicator('participantId')}</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('assignment')}>Assignment{sortIndicator('assignment')}</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('submittedAt')}>Submitted{sortIndicator('submittedAt')}</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium cursor-pointer whitespace-nowrap" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium text-right">Correctness /40</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium text-right">Approach /20</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium text-right">Quality /20</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium text-right">Testing /20</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium cursor-pointer text-right whitespace-nowrap" onClick={() => toggleSort('total')}>Total /100{sortIndicator('total')}</th>
                <th className="py-2 px-2 border-b border-slate-100 font-medium">Action</th>
              </tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.key} className="text-slate-700 hover:bg-slate-50/60">
                    <td className="py-2 px-2 font-mono">{r.participantId}</td>
                    <td className="py-2 px-2 max-w-44 truncate" title={r.assignment}>{r.assignment}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—'}</td>
                    <td className="py-2 px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${STATUS_META[r.status].className}`}>{STATUS_META[r.status].label}</span></td>
                    <td className="py-2 px-2 text-right font-mono">{r.correctness ?? '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.approach ?? '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.quality ?? '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.testing ?? '—'}</td>
                    <td className="py-2 px-2 text-right font-bold">{r.total ?? '—'}</td>
                    <td className="py-2 px-2">
                      {r.sessionId ? (
                        <Link to={`/researcher/session/${r.sessionId}/assessment`} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline whitespace-nowrap"><ClipboardCheck className="w-3.5 h-3.5" /> Grade</Link>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-3">Rubric: correctness 40, problem-solving approach 20, code quality 20, testing and debugging 20. Missing grades show as — and are never treated as zero. AI drafts are never published without your approval; only approved grades are visible to students.</p>
      </div>
    </div>
  );
}
