import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import AuthPage from '@/pages/AuthPage';
import Navbar from '@/components/Navbar';
import StudentDashboard from '@/pages/StudentDashboard';
import TaskWorkspace from '@/pages/TaskWorkspace';
import ResearcherDashboard from '@/pages/ResearcherDashboard';
import TemporalAnalysis from '@/pages/TemporalAnalysis';
import TaskManagement from '@/pages/TaskManagement';
import DataExport from '@/pages/DataExport';
import SystemSettingsPage from '@/pages/SystemSettingsPage';
import SessionTimeline from '@/pages/SessionTimeline';
import SessionAssessment from '@/pages/SessionAssessment';
import TaskResults from '@/pages/TaskResults';

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
      <main>{children}</main>
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
