import React, { useEffect, useMemo, useState } from 'react';
import {
  Dumbbell, LayoutDashboard, ListChecks, Upload, TrendingUp, LogOut,
  Play, CheckCircle2, Circle, Video, ChevronLeft, Flame, CalendarDays,
  Trash2, AlertTriangle, Trophy
} from 'lucide-react';
import { WorkoutPlan } from '../../types';
import { subscribeToWorkoutPlans, saveWorkoutPlanDoc, deleteWorkoutPlanDoc } from '../../lib/gymService';
import { SheetUploader } from './SheetUploader';

interface GymAppProps {
  currentUser: string;
  onLogout: () => void;
}

type GymTab = 'dashboard' | 'workouts' | 'upload' | 'progress';

const GYM_TABS: { id: GymTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'workouts', label: 'My Workouts', icon: ListChecks },
  { id: 'upload', label: 'Upload Sheet', icon: Upload },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
];

const weekKey = (weekIdx: number) => `w${weekIdx + 1}`;

function planCompletion(plan: WorkoutPlan): { done: number; total: number; pct: number } {
  const total = (plan.exercises?.length || 0) * Math.max(1, plan.weeks || 1);
  let done = 0;
  const progress = plan.progress || {};
  for (let w = 0; w < Math.max(1, plan.weeks || 1); w++) {
    done += (progress[weekKey(w)] || []).length;
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

export const GymApp: React.FC<GymAppProps> = ({ currentUser, onLogout }) => {
  const [activeTab, setActiveTab] = useState<GymTab>('dashboard');
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeToWorkoutPlans(setPlans);
    return () => unsub();
  }, []);

  const myPlans = useMemo(() => {
    const clean = currentUser.toLowerCase().trim();
    return plans
      .filter((p) => (p.ownerUsername || '').toLowerCase().trim() === clean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [plans, currentUser]);

  const selectedPlan = useMemo(
    () => myPlans.find((p) => p.id === selectedPlanId) || null,
    [myPlans, selectedPlanId]
  );

  const stats = useMemo(() => {
    const totalExercises = myPlans.reduce((sum, p) => sum + (p.exercises?.length || 0), 0);
    const totalWeeks = myPlans.reduce((sum, p) => sum + Math.max(1, p.weeks || 1), 0);
    let done = 0;
    let total = 0;
    myPlans.forEach((p) => {
      const c = planCompletion(p);
      done += c.done;
      total += c.total;
    });
    return {
      plans: myPlans.length,
      totalExercises,
      totalWeeks,
      done,
      total,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [myPlans]);

  const toggleExercise = (plan: WorkoutPlan, weekIdx: number, exerciseId: string) => {
    const key = weekKey(weekIdx);
    const current = plan.progress?.[key] || [];
    const updated = current.includes(exerciseId)
      ? current.filter((id) => id !== exerciseId)
      : [...current, exerciseId];
    const next: WorkoutPlan = { ...plan, progress: { ...(plan.progress || {}), [key]: updated } };
    saveWorkoutPlanDoc(next).catch((err) => console.warn('Failed to save progress to Firestore:', err));
  };

  const deletePlan = (id: string) => {
    if (selectedPlanId === id) setSelectedPlanId(null);
    deleteWorkoutPlanDoc(id).catch((err) => console.warn('Failed to delete plan from Firestore:', err));
  };

  const openPlan = (id: string) => {
    setSelectedPlanId(id);
    setSelectedWeek(1);
  };

  const renderDashboard = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/50 via-neutral-900 to-neutral-900 p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="text-[11px] uppercase tracking-[0.2em] text-red-400 font-bold">Welcome back</span>
          <h1 className="text-2xl sm:text-3xl font-black text-white mt-1 flex items-center gap-2">
            <Flame className="w-7 h-7 text-red-500" /> {currentUser}
          </h1>
          <p className="text-sm text-neutral-400 mt-1">Time to train. No excuses.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Workout Plans', value: stats.plans, icon: Dumbbell },
          { label: 'Exercises', value: stats.totalExercises, icon: ListChecks },
          { label: 'Weeks Programmed', value: stats.totalWeeks, icon: CalendarDays },
          { label: 'Completed', value: `${stats.pct}%`, icon: Trophy },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4">
            <s.icon className="w-5 h-5 text-red-500" />
            <div className="text-2xl font-black text-white mt-2">{s.value}</div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Latest plan</h2>
          <button onClick={() => setActiveTab('workouts')} className="text-[11px] font-semibold text-red-300 hover:text-red-200">View all</button>
        </div>
        {myPlans.length === 0 ? (
          <EmptyPlans onUpload={() => setActiveTab('upload')} />
        ) : (
          <button
            onClick={() => { openPlan(myPlans[0].id); setActiveTab('workouts'); }}
            className="w-full text-left rounded-2xl border border-white/10 bg-neutral-900/70 hover:border-red-500/40 transition-all p-4"
          >
            <PlanRow plan={myPlans[0]} />
          </button>
        )}
      </div>
    </div>
  );

  const renderWorkouts = () => (
    <div className="space-y-4">
      {selectedPlan ? (
        renderPlanDetail(selectedPlan)
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">My Workouts ({myPlans.length})</h2>
            <button
              onClick={() => setActiveTab('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
            >
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
          </div>
          {myPlans.length === 0 ? (
            <EmptyPlans onUpload={() => setActiveTab('upload')} />
          ) : (
            <div className="space-y-3">
              {myPlans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => openPlan(plan.id)}
                  className="w-full text-left rounded-2xl border border-white/10 bg-neutral-900/70 hover:border-red-500/40 transition-all p-4"
                >
                  <PlanRow plan={plan} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderPlanDetail = (plan: WorkoutPlan) => {
    const completion = planCompletion(plan);
    const weeks = Math.max(1, plan.weeks || 1);
    const doneIds = plan.progress?.[weekKey(selectedWeek - 1)] || [];
    const weekDone = doneIds.length;
    const weekPct = plan.exercises.length > 0 ? Math.round((weekDone / plan.exercises.length) * 100) : 0;

    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedPlanId(null)}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-neutral-400 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" /> Back to workouts
        </button>

        <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">{plan.title}</h2>
              {plan.description && <p className="text-[13px] text-neutral-400 mt-1">{plan.description}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1"><Dumbbell className="w-3.5 h-3.5 text-red-500" /> {plan.exercises.length} exercises</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5 text-red-500" /> {weeks} week{weeks === 1 ? '' : 's'}</span>
                {plan.assignedByAdmin && (
                  <span className="text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">Assigned by coach</span>
                )}
              </div>
            </div>
            <button
              onClick={() => deletePlan(plan.id)}
              className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
              title="Delete plan"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Overall progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
              <span>Overall progress</span>
              <span className="text-red-300 font-bold">{completion.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${completion.pct}%` }} />
            </div>
          </div>
        </div>

        {/* Week selector */}
        {weeks > 1 && (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => {
              const wkDone = (plan.progress?.[weekKey(w - 1)] || []).length;
              const complete = plan.exercises.length > 0 && wkDone === plan.exercises.length;
              return (
                <button
                  key={w}
                  onClick={() => setSelectedWeek(w)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all inline-flex items-center gap-1.5 ${
                    selectedWeek === w
                      ? 'bg-red-600 text-white border-red-400'
                      : 'bg-neutral-900 text-neutral-300 border-white/10 hover:border-red-500/40'
                  }`}
                >
                  Week {w}
                  {complete && <CheckCircle2 className="w-3.5 h-3.5" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Week progress bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
            <span>Week {selectedWeek} — {weekDone}/{plan.exercises.length} done</span>
            <span className="text-red-300 font-bold">{weekPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${weekPct}%` }} />
          </div>
        </div>

        {/* Exercises */}
        <div className="space-y-2.5">
          {plan.exercises.map((ex) => {
            const checked = doneIds.includes(ex.id);
            return (
              <div
                key={ex.id}
                className={`rounded-2xl border p-3.5 transition-all ${
                  checked ? 'border-red-500/40 bg-red-950/20' : 'border-white/10 bg-neutral-900/70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleExercise(plan, selectedWeek - 1, ex.id)}
                    className="mt-0.5 shrink-0 text-red-500 hover:scale-110 transition-transform"
                    title={checked ? 'Mark as not done' : 'Mark as done'}
                  >
                    {checked ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6 text-neutral-600" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`font-bold text-[14px] ${checked ? 'text-red-200 line-through decoration-red-500/50' : 'text-white'}`}>
                        {ex.name}
                      </span>
                      <span className="text-[12px] text-neutral-400 font-mono">
                        {[ex.sets && `${ex.sets} sets`, ex.reps && `${ex.reps} reps`].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    {ex.notes && <p className="text-[12px] text-neutral-400 mt-1">{ex.notes}</p>}
                    {ex.videoUrl && (
                      <a
                        href={ex.videoUrl.startsWith('http') ? ex.videoUrl : `https://${ex.videoUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold text-red-300 hover:text-red-200 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1"
                      >
                        <Video className="w-3.5 h-3.5" /> Watch demo
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {plan.exercises.length === 0 && (
            <p className="text-sm text-neutral-500 text-center py-6">This plan has no exercises yet.</p>
          )}
        </div>
      </div>
    );
  };

  const renderProgress = () => (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider">Progress Overview</h2>
      {myPlans.length === 0 ? (
        <EmptyPlans onUpload={() => setActiveTab('upload')} />
      ) : (
        <div className="space-y-3">
          {myPlans.map((plan) => {
            const c = planCompletion(plan);
            const weeks = Math.max(1, plan.weeks || 1);
            return (
              <div key={plan.id} className="rounded-2xl border border-white/10 bg-neutral-900/70 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white text-[14px]">{plan.title}</span>
                  <span className="text-red-300 font-black text-sm">{c.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-800 overflow-hidden mb-3">
                  <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${c.pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => {
                    const wkDone = (plan.progress?.[weekKey(w - 1)] || []).length;
                    const complete = plan.exercises.length > 0 && wkDone === plan.exercises.length;
                    return (
                      <span
                        key={w}
                        className={`text-[10px] font-bold rounded-lg px-2 py-1 border ${
                          complete
                            ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                            : wkDone > 0
                              ? 'border-red-500/40 text-red-300 bg-red-500/10'
                              : 'border-white/10 text-neutral-500'
                        }`}
                      >
                        W{w} {complete ? '✓' : `${wkDone}/${plan.exercises.length}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden selection:bg-red-900 selection:text-red-100 font-sans">
      {/* Header */}
      <header className="border-b border-red-500/20 bg-black/90 backdrop-blur-xl sticky top-0 z-40 shrink-0">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={() => { setActiveTab('dashboard'); setSelectedPlanId(null); }} className="flex items-center gap-2.5 group">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-red-700 to-red-500 text-white shadow-lg shadow-red-950/50 group-hover:scale-105 transition-transform">
              <Dumbbell className="w-5 h-5" />
            </div>
            <div className="flex flex-col leading-tight text-left">
              <span className="font-black text-base tracking-tight text-white">IRON HOUSE</span>
              <span className="text-[9px] uppercase tracking-[0.25em] text-red-500 font-bold">Train Hard</span>
            </div>
          </button>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-neutral-400 font-mono">{currentUser}</span>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 hover:border-red-500/40 text-xs font-semibold text-neutral-200"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </div>

        {/* Desktop tabs */}
        <nav className="hidden sm:block border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 flex gap-1">
            {GYM_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSelectedPlanId(null); }}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-red-500 text-red-400'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-5 pb-24 sm:pb-8">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'workouts' && renderWorkouts()}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-black text-white">Upload your workout sheet</h2>
                <p className="text-[13px] text-neutral-400 mt-0.5">
                  Add a sheet with your exercise name, sets, reps, notes and a video link. You can repeat it for as many weeks as you need.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-neutral-900/40 p-4">
                <SheetUploader mode="user" currentUser={currentUser} onSaved={() => setActiveTab('workouts')} />
              </div>
            </div>
          )}
          {activeTab === 'progress' && renderProgress()}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-black/95 backdrop-blur-xl border-t border-red-500/20">
        <div className="grid grid-cols-4">
          {GYM_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedPlanId(null); setIsMobileMenuOpen(false); }}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide ${
                activeTab === tab.id ? 'text-red-400' : 'text-neutral-500'
              }`}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
};

const PlanRow: React.FC<{ plan: WorkoutPlan }> = ({ plan }) => {
  const c = planCompletion(plan);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold text-white text-[14px] truncate">{plan.title}</span>
        <span className="text-[11px] font-mono text-neutral-500 shrink-0">{plan.exercises.length} ex · {plan.weeks}w</span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden mt-2">
        <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${c.pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-neutral-500">{plan.sourceFileName || 'Custom plan'}</span>
        <span className="text-[10px] text-red-300 font-bold">{c.pct}% complete</span>
      </div>
    </div>
  );
};

const EmptyPlans: React.FC<{ onUpload: () => void }> = ({ onUpload }) => (
  <div className="rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 p-8 text-center">
    <div className="mx-auto w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-3">
      <Play className="w-6 h-6" />
    </div>
    <p className="text-sm font-bold text-white">No workout plans yet</p>
    <p className="text-[12px] text-neutral-500 mt-1 mb-4">Upload a sheet to get started, or wait for your coach to assign one.</p>
    <button
      onClick={onUpload}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white text-sm font-bold shadow-lg shadow-red-950/40"
    >
      <Upload className="w-4 h-4" /> Upload a sheet
    </button>
  </div>
);

export default GymApp;
