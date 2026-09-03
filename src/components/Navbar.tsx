import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GraduationCap, LogOut, Menu, X, LayoutDashboard, FolderOpen, Download, Settings, ClipboardList } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function Navbar() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isResearcher = profile?.role === 'researcher';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const studentLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  const researcherLinks = [
    { to: '/researcher', label: 'Overview', icon: LayoutDashboard },
    { to: '/researcher/tasks', label: 'Tasks', icon: FolderOpen },
    { to: '/researcher/export', label: 'Export', icon: Download },
    { to: '/researcher/settings', label: 'Settings', icon: Settings },
  ];

  const links = isResearcher ? researcherLinks : studentLinks;

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to={isResearcher ? '/researcher' : '/dashboard'} className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-slate-900 hidden sm:block">PAUSE AI Tutor</span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active = location.pathname === link.to ||
                (link.to !== '/dashboard' && link.to !== '/researcher' && location.pathname.startsWith(link.to));
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="font-mono">{profile?.participant_id}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                isResearcher ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {isResearcher ? 'Researcher' : 'Student'}
              </span>
            </div>
            <button
              onClick={signOut}
              className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-1.5 text-slate-600 rounded-lg hover:bg-slate-100"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden pb-3 space-y-1">
            {links.map((link) => {
              const Icon = link.icon;
              const active = location.pathname === link.to ||
                (link.to !== '/dashboard' && link.to !== '/researcher' && location.pathname.startsWith(link.to));
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                    active ? 'bg-slate-100 text-slate-900' : 'text-slate-600'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}
            <div className="px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="font-mono">{profile?.participant_id}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                isResearcher ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {isResearcher ? 'Researcher' : 'Student'}
              </span>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
