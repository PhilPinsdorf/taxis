import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useMatch } from 'react-router-dom';
import clsx from 'clsx';
import { Button, Input } from './components/ui';
import { api } from './lib/api';
import { useProject } from './lib/queries';
import { Toaster } from './lib/toast';
import { setThemePref, useTheme, type ThemePref } from './lib/theme';
import { ProjectsPage } from './pages/Projects';
import { MaterialsPage } from './pages/Materials';
import { EditorPage } from './pages/Editor';
import { OverviewPage } from './pages/Overview';

export function App() {
  const qc = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.auth, staleTime: Infinity });

  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener('taxis:unauthorized', onUnauthorized);
    return () => window.removeEventListener('taxis:unauthorized', onUnauthorized);
  }, [qc]);

  if (auth.isLoading) return null;
  if (auth.data?.required && !auth.data.authenticated) return <Login />;

  return (
    <div className="flex h-full flex-col">
      <TopNav authRequired={!!auth.data?.required} />
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/material" element={<MaterialsPage />} />
          <Route path="/p/:projectId/plan" element={<EditorPage />} />
          <Route path="/p/:projectId/uebersicht" element={<OverviewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900',
  );

function TopNav({ authRequired }: { authRequired: boolean }) {
  const qc = useQueryClient();
  const match = useMatch('/p/:projectId/*');
  const projectId = match?.params.projectId;
  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-1 border-b border-zinc-200 bg-surface px-3">
      <Link to="/" className="mr-3 flex items-center gap-2 pl-1">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#18181b" stroke="#3f3f46" strokeWidth="1.5" />
          <path d="M8 22 16 9l8 13z" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Taxis</span>
      </Link>
      <NavLink to="/" end className={navCls}>
        Projekte
      </NavLink>
      <NavLink to="/material" className={navCls}>
        Material
      </NavLink>
      {projectId && <ProjectNav projectId={projectId} />}
      <div className="flex-1" />
      <ThemeToggle />
      {authRequired && (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await api.logout();
            qc.invalidateQueries({ queryKey: ['auth'] });
          }}
        >
          <LogOut size={14} /> Abmelden
        </Button>
      )}
    </header>
  );
}

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: 'Design: System', light: 'Design: Hell', dark: 'Design: Dunkel' };

function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const Icon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={`${THEME_LABEL[pref]} – klicken zum Wechseln`}
      aria-label={THEME_LABEL[pref]}
      onClick={() => setThemePref(THEME_NEXT[pref])}
    >
      <Icon size={16} />
    </Button>
  );
}

function ProjectNav({ projectId }: { projectId: string }) {
  const { data } = useProject(projectId);
  return (
    <>
      <span className="mx-2 h-5 w-px bg-zinc-200" />
      <span className="max-w-56 truncate px-1 text-sm font-medium text-zinc-900">{data?.name ?? '…'}</span>
      <NavLink to={`/p/${projectId}/plan`} className={navCls}>
        Plan
      </NavLink>
      <NavLink to={`/p/${projectId}/uebersicht`} className={navCls}>
        Übersicht
      </NavLink>
    </>
  );
}

function Login() {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.login(pw);
      qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="flex h-full items-center justify-center">
      <form noValidate onSubmit={submit} className="w-80 space-y-3 rounded-xl border border-zinc-200 bg-surface p-6 shadow-sm">
        <div className="text-lg font-semibold">Taxis</div>
        <Input type="password" autoFocus placeholder="Passwort" value={pw} onChange={(e) => setPw(e.target.value)} />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <Button type="submit" variant="primary" className="w-full justify-center">
          Anmelden
        </Button>
      </form>
    </div>
  );
}
