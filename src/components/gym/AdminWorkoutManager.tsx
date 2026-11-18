import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dumbbell, Trash2, Users, ChevronDown, ChevronUp, Plus, X,
  FileSpreadsheet, Upload, Check, CheckCircle2, ShieldAlert,
  ShieldCheck, Zap, CalendarDays, Download, Loader2, History, Clock
} from 'lucide-react';
import { ExerciseLogEntry, UserAccount, WeightUnit, WorkoutExercise, WorkoutPlan } from '../../types';
import {
  subscribeToWorkoutPlans,
  deleteWorkoutPlanDoc,
  saveWorkoutPlanDoc,
  mergeUpdatedWorksheetIntoPlan,
} from '../../lib/gymService';
import {
  parseSheetFileAllSheets,
  ParsedWeekData,
  splitSetsAndReps,
} from '../../lib/sheetParser';
import { exportWorkoutPlanToPdf } from '../../lib/workoutPdfExport';
import { SheetUploader } from './SheetUploader';

interface AdminWorkoutManagerProps {
  userAccounts: UserAccount[];
  currentAdmin?: string;
}

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

function getExerciseTargetDisplay(ex: WorkoutExercise): { setsDisplay: string; repsDisplay: string } {
  const split = splitSetsAndReps(ex.sets);
  if (split) {
    return {
      setsDisplay: split.sets,
      repsDisplay: ex.reps?.trim() || split.reps,
    };
  }
  return {
    setsDisplay: (ex.sets || '').trim(),
    repsDisplay: (ex.reps || '').trim(),
  };
}

function formatEntryBrief(entry: ExerciseLogEntry | undefined, fallbackUnit: WeightUnit): string {
  if (!entry) return '';
  if (entry.setEntries && entry.setEntries.length > 0) {
    const populated = entry.setEntries.filter(s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '');
    if (populated.length > 0) {
      return populated
        .map(s => `S${s.setNumber}: ${s.weight ? `${s.weight}${s.unit || entry.unit || fallbackUnit}` : '—'}×${s.reps || '—'}`)
        .join(', ');
    }
  }
  if (entry.weight?.trim() || entry.reps?.trim()) {
    return `${entry.weight ? `${entry.weight}${entry.unit || fallbackUnit}` : '—'}×${entry.reps || '—'}`;
  }
  return '';
}

export const AdminWorkoutManager: React.FC<AdminWorkoutManagerProps> = ({ userAccounts, currentAdmin = 'admin' }) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [filterUser, setFilterUser] = useState<string>('all');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploaderTarget, setUploaderTarget] = useState<{ assignTo?: string; targetPlanId?: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Custom Delete Confirmation Dialog state (replaces window.confirm)
  const [planToDelete, setPlanToDelete] = useState<WorkoutPlan | null>(null);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);

  // Inline Worksheet Editor state per user plan (updates sheet while preserving saved logs & progress)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [worksheetDraft, setWorksheetDraft] = useState<{
    title: string;
    description: string;
    instructions: string;
    weeks: number;
    defaultWeightUnit: WeightUnit;
    sourceFileName?: string;
    exercises: Array<{
      id?: string;
      day: string;
      name: string;
      sets: string;
      reps: string;
      notes: string;
      videoUrl: string;
      isSuperset: boolean;
      supersetGroup: string;
      loggedWeight?: string;
      loggedUnit?: WeightUnit;
      loggedReps?: string;
      weeklyLogs?: Record<number, ParsedWeekData>;
      completed?: boolean;
    }>;
  } | null>(null);
  const [worksheetNotice, setWorksheetNotice] = useState<string | null>(null);
  const [isSavingWorksheet, setIsSavingWorksheet] = useState(false);
  const [savedPlanNoticeId, setSavedPlanNoticeId] = useState<string | null>(null);

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

  const ownerDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    userAccounts.forEach((u) => {
      if (u.username) {
        map.set(u.username.toLowerCase().trim(), u.displayName?.trim() || u.username);
      }
    });
    return map;
  }, [userAccounts]);

  const visiblePlans = useMemo(() => {
    const list = filterUser === 'all'
      ? plans
      : plans.filter((p) => (p.ownerUsername || '').toLowerCase() === filterUser.toLowerCase());
    return list.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });
  }, [plans, filterUser]);

  const confirmDeletePlan = async () => {
    if (!planToDelete) return;
    const id = planToDelete.id;
    setIsDeletingPlan(true);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    if (editingPlanId === id) {
      setEditingPlanId(null);
      setWorksheetDraft(null);
    }
    try {
      await deleteWorkoutPlanDoc(id);
      setPlanToDelete(null);
    } catch {
      // Realtime subscription restores if write failed
    } finally {
      setIsDeletingPlan(false);
    }
  };

  const startEditPlan = (plan: WorkoutPlan) => {
    setIsUploadOpen(false);
    setUploaderTarget(null);
    setWorksheetNotice(null);
    setEditingPlanId(plan.id);
    setExpandedId(plan.id);
    setWorksheetDraft({
      title: plan.title || '',
      description: plan.description || '',
      instructions: plan.instructions || '',
      weeks: Math.max(1, plan.weeks || 1),
      defaultWeightUnit: plan.defaultWeightUnit || 'kg',
      sourceFileName: plan.sourceFileName,
      exercises: (plan.exercises || []).map((ex) => {
        const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
        return {
          id: ex.id,
          day: ex.day || '',
          name: ex.name || '',
          sets: setsDisplay || '',
          reps: repsDisplay || '',
          notes: ex.notes || '',
          videoUrl: ex.videoUrl || '',
          isSuperset: !!ex.isSuperset,
          supersetGroup: ex.supersetGroup || '',
        };
      }),
    });
  };

  const handleImportFileForPlan = async (file: File, plan: WorkoutPlan) => {
    if (!worksheetDraft) return;
    setWorksheetNotice('Scanning updated file...');
    try {
      const detected = await parseSheetFileAllSheets(file);
      const workoutTabs = detected.filter(s => s.suggestedRole === 'workout' && s.exercises.length > 0);
      const bestTab =
        workoutTabs.find(s => plan.sheetName && plan.sheetName.toLowerCase().includes(s.name.toLowerCase())) ||
        workoutTabs.find(s => s.name.trim().toLowerCase() === plan.title.trim().toLowerCase()) ||
        workoutTabs[0] ||
        detected.find(s => s.exercises.length > 0);

      if (!bestTab || bestTab.exercises.length === 0) {
        setWorksheetNotice('No exercise rows detected in this file.');
        return;
      }

      let importedExercises = bestTab.exercises;
      if (bestTab.detectedDays.length > 1) {
        const matchingDay = bestTab.detectedDays.find(
          d =>
            d.trim().toLowerCase() === plan.title.trim().toLowerCase() ||
            (plan.sheetName && plan.sheetName.toLowerCase().includes(d.toLowerCase()))
        );
        if (matchingDay) {
          const dayFiltered = importedExercises.filter(ex => !ex.day || ex.day === matchingDay);
          if (dayFiltered.length > 0) importedExercises = dayFiltered;
        }
      }

      const usedIds = new Set<string>();
      const mapped = importedExercises.map((row) => {
        const normName = (row.name || '').trim().toLowerCase();
        const normDay = (row.day || '').trim().toLowerCase();
        const matched =
          (normName && normDay
            ? plan.exercises.find(
                e =>
                  !usedIds.has(e.id) &&
                  e.name.trim().toLowerCase() === normName &&
                  (e.day || '').trim().toLowerCase() === normDay
              )
            : undefined) ||
          (normName ? plan.exercises.find(e => !usedIds.has(e.id) && e.name.trim().toLowerCase() === normName) : undefined);
        if (matched) usedIds.add(matched.id);

        return {
          ...(matched ? { id: matched.id } : {}),
          day: row.day || '',
          name: row.name || '',
          sets: row.sets || '',
          reps: row.reps || '',
          notes: row.notes || '',
          videoUrl: row.video || '',
          isSuperset: !!row.isSuperset,
          supersetGroup: row.supersetGroup || '',
          ...(row.loggedWeight ? { loggedWeight: row.loggedWeight } : {}),
          ...(row.loggedUnit ? { loggedUnit: row.loggedUnit } : {}),
          ...(row.loggedReps ? { loggedReps: row.loggedReps } : {}),
          ...(row.weeklyLogs ? { weeklyLogs: row.weeklyLogs } : {}),
          ...(row.completed ? { completed: row.completed } : {}),
        };
      });

      const infoText = detected
        .filter(s => s.suggestedRole === 'instructions' && s.textContent.trim() !== '')
        .map(s => s.textContent.trim())
        .join('\n\n');

      setWorksheetDraft(prev =>
        prev
          ? {
              ...prev,
              weeks: Math.max(prev.weeks, bestTab.detectedDataWeeks || 0),
              defaultWeightUnit: bestTab.detectedWeightUnit || prev.defaultWeightUnit,
              sourceFileName: file.name,
              instructions: infoText || prev.instructions,
              exercises: mapped,
            }
          : prev
      );
      setWorksheetNotice(
        `Loaded ${mapped.length} exercises from "${file.name}" (${usedIds.size} matched to preserve member's saved weights/reps). Click Save Update to apply.`
      );
    } catch (err: any) {
      setWorksheetNotice(`Failed to parse file: ${err?.message || String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSavePlanUpdate = async (plan: WorkoutPlan) => {
    if (!worksheetDraft) return;
    setIsSavingWorksheet(true);
    try {
      const merged = mergeUpdatedWorksheetIntoPlan(plan, {
        title: worksheetDraft.title,
        description: worksheetDraft.description,
        instructions: worksheetDraft.instructions,
        weeks: worksheetDraft.weeks,
        defaultWeightUnit: worksheetDraft.defaultWeightUnit,
        sourceFileName: worksheetDraft.sourceFileName,
        exercises: worksheetDraft.exercises.map(row => {
          const split = splitSetsAndReps(row.sets);
          return {
            id: row.id,
            day: row.day,
            name: row.name,
            sets: split ? split.sets : row.sets,
            reps: row.reps.trim() || (split ? split.reps : ''),
            notes: row.notes,
            videoUrl: row.videoUrl,
            isSuperset: row.isSuperset,
            supersetGroup: row.supersetGroup,
            loggedWeight: row.loggedWeight,
            loggedUnit: row.loggedUnit,
            loggedReps: row.loggedReps,
            weeklyLogs: row.weeklyLogs,
            completed: row.completed,
          };
        }),
      });
      await saveWorkoutPlanDoc(merged);
      setEditingPlanId(null);
      setWorksheetDraft(null);
      setWorksheetNotice(null);
      setSavedPlanNoticeId(plan.id);
      setTimeout(() => setSavedPlanNoticeId(prev => (prev === plan.id ? null : prev)), 3000);
    } catch (err: any) {
      setWorksheetNotice(`Failed to save update: ${err?.message || String(err)}`);
    } finally {
      setIsSavingWorksheet(false);
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
            {owners.map((o) => {
              const disp = ownerDisplayMap.get(o.toLowerCase().trim());
              return (
                <option key={o} value={o}>
                  {disp && disp.toLowerCase() !== o.toLowerCase() ? `${disp} (${o})` : o}
                </option>
              );
            })}
          </select>
        </label>

        <button
          type="button"
          onClick={() => {
            if (isUploadOpen) {
              setIsUploadOpen(false);
              setUploaderTarget(null);
            } else {
              setUploaderTarget(filterUser !== 'all' ? { assignTo: filterUser } : null);
              setIsUploadOpen(true);
            }
          }}
          className="ml-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold shadow-lg shadow-red-950/40 cursor-pointer"
        >
          {isUploadOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {isUploadOpen ? 'Close uploader' : 'Upload & assign sheet'}
        </button>
      </div>

      {/* Uploader */}
      {isUploadOpen && (
        <div className="rounded-2xl border border-red-500/20 bg-neutral-950/60 p-4">
          <p className="text-[12px] text-neutral-400 mb-3">
            {uploaderTarget?.targetPlanId
              ? `Updating existing plan for "${uploaderTarget.assignTo}" — upload a revised sheet to merge updates while preserving all saved member logs.`
              : 'Upload an Excel / CSV / PDF sheet and assign it to a member, or select an existing plan below to update it cleanly.'}
          </p>
          <SheetUploader
            mode="admin"
            currentUser={currentAdmin}
            userAccounts={userAccounts}
            existingPlans={plans}
            initialAssignTo={uploaderTarget?.assignTo || ''}
            initialTargetPlanId={uploaderTarget?.targetPlanId || ''}
            onSaved={(_, firstId) => {
              setIsUploadOpen(false);
              setUploaderTarget(null);
              if (firstId) {
                setSavedPlanNoticeId(firstId);
                setTimeout(() => setSavedPlanNoticeId(prev => (prev === firstId ? null : prev)), 3000);
              }
            }}
            onCancel={() => {
              setIsUploadOpen(false);
              setUploaderTarget(null);
            }}
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
        <div className="space-y-3">
          {visiblePlans.map((plan) => {
            const isExpanded = expandedId === plan.id;
            const isEditing = editingPlanId === plan.id && worksheetDraft !== null;
            const completion = planCompletion(plan);
            const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
            const ownerLabel = ownerDisplayMap.get((plan.ownerUsername || '').toLowerCase().trim()) || plan.ownerUsername;
            const lastDateStr = plan.updatedAt || plan.createdAt;
            const formattedDate = lastDateStr ? new Date(lastDateStr).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

            return (
              <div key={plan.id} className="rounded-2xl border border-white/10 bg-neutral-900/70 overflow-hidden">
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 sm:p-4">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                    className="flex-1 text-left min-w-0 cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white text-[14px] truncate">{plan.title}</span>
                      {plan.assignedByAdmin && (
                        <span className="text-[9px] uppercase tracking-wider text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 shrink-0">
                          Coach
                        </span>
                      )}
                      <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5 shrink-0">
                        {completion.pct}% ({completion.done}/{completion.total})
                      </span>
                      <span className="text-[10px] font-mono uppercase text-neutral-300 bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 shrink-0">
                        {planUnit}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-neutral-400 mt-1">
                      <span>
                        Member:{' '}
                        <span className="text-neutral-200 font-semibold">
                          {ownerLabel !== plan.ownerUsername ? `${ownerLabel} (@${plan.ownerUsername})` : plan.ownerUsername}
                        </span>
                      </span>
                      <span>·</span>
                      <span>{plan.exercises.length} exercises</span>
                      <span>·</span>
                      <span>{plan.weeks}w</span>
                      {plan.sourceFileName && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-neutral-500">{plan.sourceFileName}</span>
                        </>
                      )}
                      {formattedDate && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-sky-300/90">
                            <Clock className="w-3 h-3" />
                            {plan.updatedAt ? `Updated ${formattedDate}` : `Created ${formattedDate}`}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Mini progress bar + week pills */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="w-28 h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-red-600 to-emerald-400" style={{ width: `${completion.pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: Math.max(1, plan.weeks || 1) }, (_, wIdx) => {
                          const wkDone = (plan.progress?.[weekKey(wIdx)] || []).length;
                          const full = plan.exercises.length > 0 && wkDone === plan.exercises.length;
                          return (
                            <span
                              key={wIdx}
                              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                full
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : wkDone > 0
                                  ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                                  : 'border-white/10 text-neutral-500'
                              }`}
                            >
                              W{wIdx + 1}: {wkDone}/{plan.exercises.length}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </button>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => (isEditing ? (setEditingPlanId(null), setWorksheetDraft(null)) : startEditPlan(plan))}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                        isEditing
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                      }`}
                      title="Edit exercises, sets, reps, notes or import updated file while preserving saved logs"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      {isEditing ? 'Close Editor' : 'Update Sheet'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlanId(null);
                        setWorksheetDraft(null);
                        setUploaderTarget({ assignTo: plan.ownerUsername, targetPlanId: plan.id });
                        setIsUploadOpen(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-all cursor-pointer"
                      title={`Upload new sheet file directly into "${plan.title}"`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Re-Upload
                    </button>

                    <button
                      type="button"
                      onClick={() => exportWorkoutPlanToPdf(plan, { ownerName: ownerLabel })}
                      className="p-2 rounded-lg text-neutral-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 cursor-pointer"
                      title="Export member workout summary PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setPlanToDelete(plan)}
                      className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                      title="Delete plan"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                      className="p-2 text-neutral-500 hover:text-white cursor-pointer"
                      title={isExpanded ? 'Collapse details' : 'Expand details'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {savedPlanNoticeId === plan.id && (
                  <div className="mx-4 mb-3 flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Sheet updated cleanly — member&apos;s saved weights, reps, weekly history &amp; checkmarks were preserved!</span>
                  </div>
                )}

                {/* Inline Sheet Updater Editor */}
                {isEditing && worksheetDraft && (
                  <div className="border-t border-emerald-500/30 bg-neutral-950/90 p-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4" />
                          Update Sheet for {ownerLabel} — Preserves Saved Member Data
                        </h4>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                          Modify exercises, sets, reps, supersets, video links or import an updated sheet file without erasing logged sets.
                        </p>
                      </div>
                      <div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleImportFileForPlan(f, plan);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600/25 hover:bg-sky-600/40 border border-sky-400/40 text-sky-200 text-xs font-bold cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" /> Import Updated File
                        </button>
                      </div>
                    </div>

                    {worksheetNotice && (
                      <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-xl px-3 py-2">
                        {worksheetNotice}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-neutral-400 font-semibold">Workout Title</span>
                        <input
                          value={worksheetDraft.title}
                          onChange={(e) => setWorksheetDraft({ ...worksheetDraft, title: e.target.value })}
                          className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-neutral-400 font-semibold">Weeks</span>
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={worksheetDraft.weeks}
                          onChange={(e) => setWorksheetDraft({ ...worksheetDraft, weeks: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                          className="bg-neutral-900 border border-white/15 focus:border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-white outline-none"
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-neutral-400 font-semibold">Weight Unit</span>
                        <div className="inline-flex rounded-xl bg-neutral-900 border border-white/15 p-1 w-fit">
                          {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => setWorksheetDraft({ ...worksheetDraft, defaultWeightUnit: u })}
                              className={`px-3 py-1 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                                worksheetDraft.defaultWeightUnit === u ? 'bg-red-600 text-white' : 'text-neutral-400 hover:text-white'
                              }`}
                            >
                              {u}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-neutral-400 font-semibold">Information &amp; Instructions</span>
                        <textarea
                          rows={2}
                          value={worksheetDraft.instructions}
                          onChange={(e) => setWorksheetDraft({ ...worksheetDraft, instructions: e.target.value })}
                          className="bg-neutral-900 border border-white/15 rounded-xl px-3 py-2 text-xs text-white outline-none resize-y"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase text-neutral-400 font-semibold">Description</span>
                        <textarea
                          rows={2}
                          value={worksheetDraft.description}
                          onChange={(e) => setWorksheetDraft({ ...worksheetDraft, description: e.target.value })}
                          className="bg-neutral-900 border border-white/15 rounded-xl px-3 py-2 text-xs text-white outline-none resize-y"
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/40 overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[780px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/80">
                            <th className="px-2 py-2 w-28">Day</th>
                            <th className="px-2 py-2 w-20">Type</th>
                            <th className="px-2 py-2">Exercise Name</th>
                            <th className="px-2 py-2 w-20">Sets</th>
                            <th className="px-2 py-2 w-24">Reps</th>
                            <th className="px-2 py-2">Notes</th>
                            <th className="px-2 py-2 w-48">Video URL</th>
                            <th className="px-2 py-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {worksheetDraft.exercises.map((row, rIdx) => (
                            <tr
                              key={row.id || `adm-new-${rIdx}`}
                              className={`border-t border-white/5 ${row.isSuperset ? 'bg-fuchsia-950/25 border-l-4 border-l-fuchsia-400' : ''}`}
                            >
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.day}
                                  onChange={(e) => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], day: e.target.value };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  placeholder="Day..."
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-amber-200 outline-none"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], isSuperset: !next[rIdx].isSuperset };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer ${
                                    row.isSuperset
                                      ? 'bg-fuchsia-500/25 border-fuchsia-400/60 text-fuchsia-200'
                                      : 'bg-neutral-900 border-white/10 text-neutral-400'
                                  }`}
                                >
                                  <Zap className="w-3 h-3" /> {row.isSuperset ? (row.supersetGroup || 'SS') : 'Std'}
                                </button>
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.name}
                                  onChange={(e) => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], name: e.target.value };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.sets}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const sp = splitSetsAndReps(val);
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = sp
                                      ? { ...next[rIdx], sets: sp.sets, reps: next[rIdx].reps || sp.reps }
                                      : { ...next[rIdx], sets: val };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.reps}
                                  onChange={(e) => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], reps: e.target.value };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono outline-none"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.notes}
                                  onChange={(e) => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], notes: e.target.value };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-neutral-300 outline-none"
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  value={row.videoUrl}
                                  onChange={(e) => {
                                    const next = [...worksheetDraft.exercises];
                                    next[rIdx] = { ...next[rIdx], videoUrl: e.target.value };
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="w-full bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono text-sky-300 outline-none"
                                />
                              </td>
                              <td className="px-1 py-1 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = worksheetDraft.exercises.filter((_, i) => i !== rIdx);
                                    setWorksheetDraft({ ...worksheetDraft, exercises: next });
                                  }}
                                  className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                                  title="Remove exercise row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setWorksheetDraft({
                            ...worksheetDraft,
                            exercises: [
                              ...worksheetDraft.exercises,
                              {
                                day: '',
                                name: '',
                                sets: '3',
                                reps: '8-12',
                                notes: '',
                                videoUrl: '',
                                isSuperset: false,
                                supersetGroup: '',
                              },
                            ],
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Row
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlanId(null);
                            setWorksheetDraft(null);
                            setWorksheetNotice(null);
                          }}
                          className="px-3.5 py-2 rounded-xl bg-neutral-800 text-neutral-300 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isSavingWorksheet}
                          onClick={() => handleSavePlanUpdate(plan)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow cursor-pointer"
                        >
                          {isSavingWorksheet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Save Update
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded Read-Only Details + Member Progress Logs */}
                {isExpanded && !isEditing && (
                  <div className="border-t border-white/10 overflow-x-auto">
                    {plan.instructions && plan.instructions.trim() !== '' && (
                      <div className="px-4 py-2.5 bg-sky-950/20 border-b border-sky-500/15 text-[11px] text-sky-200/90 whitespace-pre-wrap">
                        <span className="font-bold uppercase tracking-wider text-sky-300 mr-2">Instructions:</span>
                        {plan.instructions}
                      </div>
                    )}
                    <table className="w-full text-left border-collapse min-w-[740px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-950/50">
                          <th className="px-3 py-2 font-semibold">Day / Exercise</th>
                          <th className="px-3 py-2 font-semibold w-20">Sets</th>
                          <th className="px-3 py-2 font-semibold w-24">Reps</th>
                          <th className="px-3 py-2 font-semibold">Member Logged Updates</th>
                          <th className="px-3 py-2 font-semibold">Notes</th>
                          <th className="px-3 py-2 font-semibold w-16">Video</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.exercises.map((ex) => {
                          const { setsDisplay, repsDisplay } = getExerciseTargetDisplay(ex);
                          const loggedParts: string[] = [];
                          const exLogs = plan.exerciseLogs || {};
                          Object.keys(exLogs)
                            .sort((a, b) => {
                              const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
                              const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
                              return na - nb;
                            })
                            .forEach((wk) => {
                              const brief = formatEntryBrief(exLogs[wk]?.[ex.id], planUnit);
                              if (brief) loggedParts.push(`${wk.toUpperCase()}: ${brief}`);
                            });
                          const prevBrief = formatEntryBrief(plan.previousLogs?.[ex.id], planUnit);
                          if (prevBrief) loggedParts.push(`Prev: ${prevBrief}`);

                          const completedWeeks: string[] = [];
                          for (let w = 1; w <= Math.max(1, plan.weeks || 1); w++) {
                            if ((plan.progress?.[weekKey(w - 1)] || []).includes(ex.id)) {
                              completedWeeks.push(`W${w}`);
                            }
                          }

                          return (
                            <tr
                              key={ex.id}
                              className={`border-t border-white/5 text-[12px] ${ex.isSuperset ? 'bg-fuchsia-950/15' : ''}`}
                            >
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-white font-semibold">{ex.name}</span>
                                  {ex.isSuperset && (
                                    <span className="text-[9px] font-bold uppercase text-fuchsia-200 bg-fuchsia-500/20 border border-fuchsia-400/40 px-1.5 py-0.5 rounded-full">
                                      SS{ex.supersetGroup && ex.supersetGroup !== 'SUPERSET' ? ` · ${ex.supersetGroup}` : ''}
                                    </span>
                                  )}
                                  {ex.day && (
                                    <span className="text-[9px] text-amber-200 bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                                      {ex.day}
                                    </span>
                                  )}
                                  {completedWeeks.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                                      <CheckCircle2 className="w-2.5 h-2.5" /> {completedWeeks.join(', ')}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-neutral-300 font-mono">{setsDisplay || '—'}</td>
                              <td className="px-3 py-2 text-neutral-300 font-mono">{repsDisplay || '—'}</td>
                              <td className="px-3 py-2 text-[11px] font-mono">
                                {loggedParts.length > 0 ? (
                                  <div className="space-y-0.5 text-indigo-200">
                                    {loggedParts.map((part, pIdx) => (
                                      <div key={pIdx}>{part}</div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-neutral-600 inline-flex items-center gap-1">
                                    <History className="w-3 h-3" /> No logs yet
                                  </span>
                                )}
                              </td>
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
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION DIALOG */}
      {planToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => !isDeletingPlan && setPlanToDelete(null)}
        >
          <div
            className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 to-rose-600" />
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Workout Plan?</h3>
                <p className="text-[11px] text-neutral-400 font-mono uppercase tracking-wider mt-0.5">
                  Irreversible Action
                </p>
              </div>
            </div>

            <p className="text-sm text-neutral-300 leading-relaxed mb-6">
              Are you sure you want to delete{' '}
              <span className="text-white font-semibold">&ldquo;{planToDelete.title}&rdquo;</span> assigned to{' '}
              <span className="text-red-300 font-semibold">{planToDelete.ownerUsername}</span> ({planToDelete.exercises.length} exercises)?
              All logged weights, reps, and weekly progress for this plan will be permanently removed.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={() => setPlanToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingPlan}
                onClick={confirmDeletePlan}
                className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white shadow-md transition-all cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeletingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWorkoutManager;
