import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import AuthPage from '@/pages/AuthPage';
import Navbar from '@/components/Navbar';
// Pages load on demand, so students never download the researcher pages
// (charts, network graphs) and the first screen appears sooner.
const StudentDashboard = lazy(() => import('@/pages/StudentDashboard'));
const TaskWorkspace = lazy(() => import('@/pages/TaskWorkspace'));
const TaskResults = lazy(() => import('@/pages/TaskResults'));
const ResearcherDashboard = lazy(() => import('@/pages/ResearcherDashboard'));
const TemporalAnalysis = lazy(() => import('@/pages/TemporalAnalysis'));
const TaskManagement = lazy(() => import('@/pages/TaskManagement'));
const DataExport = lazy(() => import('@/pages/DataExport'));
const SystemSettingsPage = lazy(() => import('@/pages/SystemSettingsPage'));
const SessionTimeline = lazy(() => import('@/pages/SessionTimeline'));
const SessionAssessment = lazy(() => import('@/pages/SessionAssessment'));
const SurveyPage = lazy(() => import('@/pages/SurveyPage'));
const SurveyManagement = lazy(() => import('@/pages/SurveyManagement'));

function PageLoading() {
  return <div className="py-24 flex items-center justify-center text-slate-400 text-sm" role="status">Loading...</div>;
}

function ProtectedRoute({ children, requireRole }: { children: React.ReactNode; requireRole?: 'student' | 'researcher' }) {
  const { profile, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }
  if (!profile) return <Navigate to="/" replace />;
  if (requireRole && profile.role !== requireRole) return <Navigate to={profile.role === 'researcher' ? '/researcher' : '/dashboard'} replace />;
  return <>{children}</>;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main><Suspense fallback={<PageLoading />}>{children}</Suspense></main>
    </div>
  );
}

function AppRoutes() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!profile) return <AuthPage />;

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to={profile.role === 'researcher' ? '/researcher' : '/dashboard'} replace />} />
        <Route path="/dashboard" element={<ProtectedRoute requireRole="student"><AppShell><StudentDashboard /></AppShell></ProtectedRoute>} />
        <Route path="/task/start/:taskId" element={<ProtectedRoute requireRole="student"><AppShell><TaskWorkspace /></AppShell></ProtectedRoute>} />
        <Route path="/task/:sessionId" element={<ProtectedRoute requireRole="student"><AppShell><TaskWorkspace /></AppShell></ProtectedRoute>} />
        <Route path="/task/:sessionId/results" element={<ProtectedRoute requireRole="student"><AppShell><TaskResults /></AppShell></ProtectedRoute>} />
        <Route path="/researcher" element={<ProtectedRoute requireRole="researcher"><AppShell><ResearcherDashboard /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/temporal-analysis" element={<ProtectedRoute requireRole="researcher"><AppShell><TemporalAnalysis /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/session/:sessionId" element={<ProtectedRoute requireRole="researcher"><AppShell><SessionTimeline /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/session/:sessionId/assessment" element={<ProtectedRoute requireRole="researcher"><AppShell><SessionAssessment /></AppShell></ProtectedRoute>} />
        <Route path="/survey/:surveyId" element={<ProtectedRoute requireRole="student"><AppShell><SurveyPage /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/surveys" element={<ProtectedRoute requireRole="researcher"><AppShell><SurveyManagement /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/tasks" element={<ProtectedRoute requireRole="researcher"><AppShell><TaskManagement /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/export" element={<ProtectedRoute requireRole="researcher"><AppShell><DataExport /></AppShell></ProtectedRoute>} />
        <Route path="/researcher/settings" element={<ProtectedRoute requireRole="researcher"><AppShell><SystemSettingsPage /></AppShell></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={profile.role === 'researcher' ? '/researcher' : '/dashboard'} replace />} />
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
