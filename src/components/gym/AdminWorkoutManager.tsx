import React, { useEffect, useMemo, useState } from 'react';
import { Dumbbell, Trash2, Users, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { UserAccount, WorkoutPlan } from '../../types';
import { subscribeToWorkoutPlans, deleteWorkoutPlanDoc } from '../../lib/gymService';
import { SheetUploader } from './SheetUploader';

interface AdminWorkoutManagerProps {
  userAccounts: UserAccount[];
  currentAdmin?: string;
}

export const AdminWorkoutManager: React.FC<AdminWorkoutManagerProps> = ({ userAccounts, currentAdmin = 'admin' }) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToWorkoutPlans(setPlans);
    return () => unsub();
  }, []);

  const owners = useMemo(() => {
    const set = new Set<string>();
    plans.forEach((p) => p.ownerUsername && set.add(p.ownerUsername));
    userAccounts.forEach((u) => u.username && set.add(u.username));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [plans, userAccounts]);

  const visiblePlans = useMemo(() => {
    const list = filterUser === 'all'
      ? plans
      : plans.filter((p) => (p.ownerUsername || '').toLowerCase() === filterUser.toLowerCase());
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [plans, filterUser]);

  const deletePlan = async (id: string) => {
    if (!window.confirm('Delete this workout plan? This cannot be undone.')) return;
    setPlans((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteWorkoutPlanDoc(id);
    } catch {
      // Firestore rejected the delete; the realtime subscription will restore the plan.
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-300">
          <Users className="w-4 h-4 text-red-500" />
          <span className="font-semibold">{plans.length}</span> total plans
          <span className="text-neutral-600">•</span>
          <span className="font-semibold">{owners.length}</span> members
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-neutral-400">
          Filter by member:
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
          >
            <option value="all">All members</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>

        <button
          onClick={() => setIsUploadOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold shadow-lg shadow-red-950/40"
        >
          {isUploadOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {isUploadOpen ? 'Close uploader' : 'Upload & assign sheet'}
        </button>
      </div>

      {/* Uploader */}
      {isUploadOpen && (
        <div className="rounded-2xl border border-red-500/20 bg-neutral-950/60 p-4">
          <p className="text-[12px] text-neutral-400 mb-3">
            Upload an Excel / CSV / PDF sheet and assign it to a specific member. Columns detected: exercise name, sets, reps, notes, video.
          </p>
          <SheetUploader
            mode="admin"
            currentUser={currentAdmin}
            userAccounts={userAccounts}
            onSaved={() => setIsUploadOpen(false)}
            onCancel={() => setIsUploadOpen(false)}
          />
        </div>
      )}

      {/* Plans list */}
      {visiblePlans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 p-8 text-center">
          <Dumbbell className="w-8 h-8 text-red-500/60 mx-auto mb-2" />
          <p className="text-sm font-bold text-white">No workout plans yet</p>
          <p className="text-[12px] text-neutral-500 mt-1">Upload a sheet to assign a plan to a member.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visiblePlans.map((plan) => {
            const isExpanded = expandedId === plan.id;
            return (
              <div key={plan.id} className="rounded-2xl border border-white/10 bg-neutral-900/70 overflow-hidden">
                <div className="flex items-center gap-3 p-3.5">
                  <button onClick={() => setExpandedId(isExpanded ? null : plan.id)} className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-[14px] truncate">{plan.title}</span>
                      {plan.assignedByAdmin && (
                        <span className="text-[9px] uppercase tracking-wider text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 shrink-0">Coach</span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      Owner: <span className="text-neutral-300 font-semibold">{plan.ownerUsername}</span> · {plan.exercises.length} exercises · {plan.weeks}w
                      {plan.sourceFileName ? ` · ${plan.sourceFileName}` : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => deletePlan(plan.id)}
                    className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                    title="Delete plan"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : plan.id)} className="p-2 text-neutral-500 hover:text-white shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/10 overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[640px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-950/50">
                          <th className="px-3 py-2 font-semibold">Exercise</th>
                          <th className="px-3 py-2 font-semibold w-20">Sets</th>
                          <th className="px-3 py-2 font-semibold w-20">Reps</th>
                          <th className="px-3 py-2 font-semibold">Notes</th>
                          <th className="px-3 py-2 font-semibold">Video</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.exercises.map((ex) => (
                          <tr key={ex.id} className="border-t border-white/5 text-[12px]">
                            <td className="px-3 py-2 text-white font-semibold">{ex.name}</td>
                            <td className="px-3 py-2 text-neutral-300">{ex.sets || '—'}</td>
                            <td className="px-3 py-2 text-neutral-300">{ex.reps || '—'}</td>
                            <td className="px-3 py-2 text-neutral-400">{ex.notes || '—'}</td>
                            <td className="px-3 py-2">
                              {ex.videoUrl ? (
                                <a
                                  href={ex.videoUrl.startsWith('http') ? ex.videoUrl : `https://${ex.videoUrl}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-red-300 hover:text-red-200 underline break-all"
                                >
                                  link
                                </a>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminWorkoutManager;
