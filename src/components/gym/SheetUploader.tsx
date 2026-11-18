import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, Loader2, Trash2, Plus, Check,
  AlertTriangle, Video, User as UserIcon, Dumbbell, FileText,
  Layers, Eye, Ban, CalendarDays, Tag, Zap
} from 'lucide-react';
import { UserAccount, WeightUnit, WorkoutPlan } from '../../types';
import {
  parseSheetFileAllSheets,
  ParsedExerciseRow,
  SheetRole,
  emptyRow,
  getVideoThumbnailInfo,
  parseSetsCount,
  splitSetsAndReps,
} from '../../lib/sheetParser';
import { buildWorkoutPlan, mergeUpdatedWorksheetIntoPlan, saveWorkoutPlanDoc } from '../../lib/gymService';

interface SheetUploaderProps {
  mode: 'user' | 'admin';
  currentUser: string;
  userAccounts?: UserAccount[];
  existingPlans?: WorkoutPlan[];
  initialAssignTo?: string;
  initialTargetPlanId?: string;
  onSaved?: (ownerUsername: string, firstSavedPlanId?: string) => void;
  onCancel?: () => void;
}

interface SheetEntry {
  name: string;
  role: SheetRole;
  rawRows: string[][];
  textContent: string;
  exercises: ParsedExerciseRow[];
  detectedDays: string[];
  selectedDays: string[]; // Selected day headers to import/link
  splitByDay: boolean;    // Save each selected day as its own workout title vs 1 combined plan
  customTitle: string;
  headerMatched: boolean;
  detectedDataWeeks: number;
  detectedWeightUnit?: WeightUnit;
  prefilledRowCount: number;
}

const ACCEPTED = '.xlsx,.xls,.csv,.tsv,.txt,.pdf';

export const SheetUploader: React.FC<SheetUploaderProps> = ({
  mode,
  currentUser,
  userAccounts = [],
  existingPlans = [],
  initialAssignTo = '',
  initialTargetPlanId = '',
  onSaved,
  onCancel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');

  // Multi-sheet workbook state
  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [activeWorkoutIdx, setActiveWorkoutIdx] = useState<number>(0);
  const [previewInfoSheetIdx, setPreviewInfoSheetIdx] = useState<number | null>(null);
  const [newDayInput, setNewDayInput] = useState('');

  // Manual row builder when no workbook is loaded
  const [manualTitle, setManualTitle] = useState('');
  const [manualRows, setManualRows] = useState<ParsedExerciseRow[]>([]);

  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [assignTo, setAssignTo] = useState(initialAssignTo);
  const [targetPlanIdToUpdate, setTargetPlanIdToUpdate] = useState(initialTargetPlanId);
  const [importSheetData, setImportSheetData] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialAssignTo) setAssignTo(initialAssignTo);
    if (initialTargetPlanId) {
      setTargetPlanIdToUpdate(initialTargetPlanId);
      const found = existingPlans.find(p => p.id === initialTargetPlanId);
      if (found) {
        setWeeks(Math.max(1, found.weeks || 1));
        setWeightUnit(found.defaultWeightUnit || 'kg');
        if (found.description) setDescription(found.description);
        if (found.instructions) setInstructions(found.instructions);
      }
    }
  }, [initialAssignTo, initialTargetPlanId, existingPlans]);

  const ownerForMatch = (mode === 'admin' ? assignTo : currentUser).toLowerCase().trim();
  const candidateExistingPlans = useMemo(() => {
    if (!ownerForMatch) return existingPlans;
    return existingPlans.filter(p => (p.ownerUsername || '').toLowerCase().trim() === ownerForMatch);
  }, [existingPlans, ownerForMatch]);

  const selectedExistingPlan = useMemo(
    () => candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate) || null,
    [candidateExistingPlans, targetPlanIdToUpdate]
  );

  const selectTargetPlanToUpdate = (planId: string) => {
    setTargetPlanIdToUpdate(planId);
    const found = candidateExistingPlans.find(p => p.id === planId);
    if (found) {
      setWeeks(Math.max(1, found.weeks || 1));
      setWeightUnit(found.defaultWeightUnit || 'kg');
      if (!description.trim() && found.description) setDescription(found.description);
      if (!instructions.trim() && found.instructions) setInstructions(found.instructions);
    }
  };

  const rebuildInstructionsFromSheets = (entries: SheetEntry[]) => {
    const infoSheets = entries.filter(s => s.role === 'instructions' && s.textContent.trim() !== '');
    if (infoSheets.length === 0) return '';
    if (infoSheets.length === 1) return infoSheets[0].textContent;
    return infoSheets
      .map(s => `[${s.name}]\n${s.textContent}`)
      .join('\n\n');
  };

  const handleFile = async (file: File) => {
    setError(null);
    setSavedMsg(null);
    setIsParsing(true);
    setFileName(file.name);
    setPreviewInfoSheetIdx(null);

    try {
      const detected = await parseSheetFileAllSheets(file);
      const baseFileTitle = file.name.replace(/\.[^.]+$/, '');
      const hasMultiple = detected.length > 1;

      const entries: SheetEntry[] = detected.map((s) => ({
        name: s.name,
        role: s.suggestedRole,
        rawRows: s.rawRows,
        textContent: s.textContent,
        exercises: s.exercises,
        detectedDays: s.detectedDays || [],
        selectedDays: [...(s.detectedDays || [])],
        splitByDay: (s.detectedDays || []).length > 1,
        customTitle: hasMultiple ? s.name : (baseFileTitle || s.name),
        headerMatched: s.headerMatched,
        detectedDataWeeks: s.detectedDataWeeks || 0,
        detectedWeightUnit: s.detectedWeightUnit,
        prefilledRowCount: s.prefilledRowCount || 0,
      }));

      setSheets(entries);
      setManualRows([]);
      setInstructions(rebuildInstructionsFromSheets(entries));
      setImportSheetData(true);

      const maxDetectedWeeks = entries.reduce((mx, s) => Math.max(mx, s.detectedDataWeeks || 0), 0);
      if (maxDetectedWeeks > 1) {
        setWeeks(prev => Math.max(prev, maxDetectedWeeks));
      }
      const detectedUnit = entries.find(s => s.detectedWeightUnit)?.detectedWeightUnit;
      if (detectedUnit) {
        setWeightUnit(detectedUnit);
      }

      const firstWorkoutIdx = entries.findIndex(s => s.role === 'workout');
      setActiveWorkoutIdx(firstWorkoutIdx >= 0 ? firstWorkoutIdx : 0);

      if (entries.every(s => s.exercises.length === 0)) {
        setError('Sheets were detected, but no structured exercise rows were recognized automatically. Select the Workout sheet tab below or add exercises manually.');
      }
    } catch (err: any) {
      console.error('Sheet parse failed:', err);
      setError(`Could not read this file: ${err?.message || String(err)}`);
    } finally {
      setIsParsing(false);
    }
  };

  const workoutSheets = useMemo(
    () => sheets.map((s, idx) => ({ sheet: s, idx })).filter(item => item.sheet.role === 'workout'),
    [sheets]
  );

  const isMultiSheetMode = sheets.length > 0;
  const activeSheet = isMultiSheetMode
    ? (sheets[activeWorkoutIdx]?.role === 'workout'
        ? sheets[activeWorkoutIdx]
        : workoutSheets[0]?.sheet || null)
    : null;
  const activeSheetIndex = activeSheet ? sheets.indexOf(activeSheet) : -1;

  const setSheetRole = (idx: number, newRole: SheetRole) => {
    setSheets(prev => {
      const next = prev.map((s, i) => (i === idx ? { ...s, role: newRole } : s));
      setInstructions(rebuildInstructionsFromSheets(next));
      if (newRole === 'workout') {
        setActiveWorkoutIdx(idx);
      }
      return next;
    });
  };

  const updateSheetTitle = (idx: number, newTitle: string) => {
    setSheets(prev => prev.map((s, i) => (i === idx ? { ...s, customTitle: newTitle } : s)));
  };

  const toggleDaySelection = (sheetIdx: number, day: string) => {
    setSheets(prev =>
      prev.map((s, i) => {
        if (i !== sheetIdx) return s;
        const exists = s.selectedDays.includes(day);
        const nextDays = exists
          ? s.selectedDays.filter(d => d !== day)
          : [...s.selectedDays, day];
        return { ...s, selectedDays: nextDays };
      })
    );
  };

  const selectOnlyDay = (sheetIdx: number, day: string) => {
    setSheets(prev =>
      prev.map((s, i) => (i === sheetIdx ? { ...s, selectedDays: [day] } : s))
    );
  };

  const selectAllDays = (sheetIdx: number) => {
    setSheets(prev =>
      prev.map((s, i) => (i === sheetIdx ? { ...s, selectedDays: [...s.detectedDays] } : s))
    );
  };

  const toggleSplitByDay = (sheetIdx: number, split: boolean) => {
    setSheets(prev =>
      prev.map((s, i) => (i === sheetIdx ? { ...s, splitByDay: split } : s))
    );
  };

  const addCustomDayHeader = () => {
    const clean = newDayInput.trim();
    if (!clean || !isMultiSheetMode || activeSheetIndex < 0) return;
    setSheets(prev =>
      prev.map((s, i) => {
        if (i !== activeSheetIndex) return s;
        const detectedDays = s.detectedDays.includes(clean) ? s.detectedDays : [...s.detectedDays, clean];
        const selectedDays = s.selectedDays.includes(clean) ? s.selectedDays : [...s.selectedDays, clean];
        return { ...s, detectedDays, selectedDays };
      })
    );
    setNewDayInput('');
  };

  const updateRow = (rowIdx: number, key: keyof ParsedExerciseRow, value: string) => {
    const applyPatch = (r: ParsedExerciseRow): ParsedExerciseRow => {
      if (key === 'sets') {
        const split = splitSetsAndReps(value);
        if (split) {
          return { ...r, sets: split.sets, reps: r.reps || split.reps };
        }
      }
      return { ...r, [key]: value };
    };

    if (isMultiSheetMode && activeSheetIndex >= 0) {
      setSheets(prev =>
        prev.map((s, i) => {
          if (i !== activeSheetIndex) return s;
          const nextExercises = s.exercises.map((r, rIdx) => (rIdx === rowIdx ? applyPatch(r) : r));
          let nextDetected = s.detectedDays;
          let nextSelected = s.selectedDays;
          if (key === 'day' && value.trim()) {
            const cleanDay = value.trim();
            if (!nextDetected.includes(cleanDay)) nextDetected = [...nextDetected, cleanDay];
            if (!nextSelected.includes(cleanDay)) nextSelected = [...nextSelected, cleanDay];
          }
          return { ...s, exercises: nextExercises, detectedDays: nextDetected, selectedDays: nextSelected };
        })
      );
    } else {
      setManualRows(prev => prev.map((r, i) => (i === rowIdx ? applyPatch(r) : r)));
    }
  };

  const toggleRowSuperset = (rowIdx: number) => {
    if (isMultiSheetMode && activeSheetIndex >= 0) {
      setSheets(prev =>
        prev.map((s, i) =>
          i === activeSheetIndex
            ? {
                ...s,
                exercises: s.exercises.map((r, rIdx) =>
                  rIdx === rowIdx ? { ...r, isSuperset: !r.isSuperset } : r
                ),
              }
            : s
        )
      );
    } else {
      setManualRows(prev =>
        prev.map((r, i) => (i === rowIdx ? { ...r, isSuperset: !r.isSuperset } : r))
      );
    }
  };

  const promoteRowToDayHeader = (rowIdx: number) => {
    if (!isMultiSheetMode || activeSheetIndex < 0 || !activeSheet) return;
    const row = activeSheet.exercises[rowIdx];
    const headerLabel = (row?.name || '').trim();
    if (!headerLabel) return;

    setSheets(prev =>
      prev.map((s, i) => {
        if (i !== activeSheetIndex) return s;
        // Remove that banner row and assign its header label to subsequent rows until the next existing day change
        const origDay = s.exercises[rowIdx]?.day || '';
        const nextExercises: ParsedExerciseRow[] = [];
        let apply = false;
        s.exercises.forEach((ex, idx) => {
          if (idx === rowIdx) {
            apply = true;
            return;
          }
          if (apply) {
            if ((ex.day || '') === origDay || !ex.day) {
              nextExercises.push({ ...ex, day: headerLabel });
            } else {
              apply = false;
              nextExercises.push(ex);
            }
          } else {
            nextExercises.push(ex);
          }
        });
        const detectedDays = Array.from(new Set(nextExercises.map(e => e.day).filter(Boolean) as string[]));
        const selectedDays = s.selectedDays.includes(headerLabel)
          ? s.selectedDays
          : [...s.selectedDays, headerLabel];
        return { ...s, exercises: nextExercises, detectedDays, selectedDays };
      })
    );
  };

  const addRow = () => {
    if (isMultiSheetMode && activeSheetIndex >= 0) {
      const defaultDay = activeSheet?.selectedDays[0] || activeSheet?.detectedDays[0];
      setSheets(prev =>
        prev.map((s, i) =>
          i === activeSheetIndex ? { ...s, exercises: [...s.exercises, emptyRow(defaultDay)] } : s
        )
      );
    } else {
      setManualRows(prev => [...prev, emptyRow()]);
    }
  };

  const removeRow = (rowIdx: number) => {
    if (isMultiSheetMode && activeSheetIndex >= 0) {
      setSheets(prev =>
        prev.map((s, i) =>
          i === activeSheetIndex
            ? { ...s, exercises: s.exercises.filter((_, rIdx) => rIdx !== rowIdx) }
            : s
        )
      );
    } else {
      setManualRows(prev => prev.filter((_, i) => i !== rowIdx));
    }
  };

  // Helper to filter exercises of a sheet by its selected day headers
  const getFilteredExercisesForSheet = (sheet: SheetEntry): ParsedExerciseRow[] => {
    if (sheet.detectedDays.length === 0) return sheet.exercises;
    if (sheet.selectedDays.length === 0) return [];
    const allowed = new Set(sheet.selectedDays);
    return sheet.exercises.filter(ex => !ex.day || allowed.has(ex.day));
  };

  const displayedRows = isMultiSheetMode ? (activeSheet?.exercises || []) : manualRows;
  const displayedTitle = isMultiSheetMode ? (activeSheet?.customTitle || '') : manualTitle;

  const handleSave = async () => {
    setError(null);
    const ownerUsername = mode === 'admin' ? assignTo.trim() : currentUser.trim();
    if (!ownerUsername) {
      setError(mode === 'admin' ? 'Please choose which member this plan is assigned to.' : 'Missing user.');
      return;
    }

    if (isMultiSheetMode) {
      const selectedWorkouts = sheets.filter(s => s.role === 'workout' && s.exercises.length > 0);
      if (selectedWorkouts.length === 0) {
        setError('Please mark at least one non-empty sheet as "Workout" before saving.');
        return;
      }

      // Build list of plans to create (respecting selected day headers and splitByDay)
      const plansToCreate: Array<{
        title: string;
        sheetName: string;
        exercises: ParsedExerciseRow[];
      }> = [];

      for (const ws of selectedWorkouts) {
        if (!ws.customTitle.trim()) {
          setError(`Please enter a title for sheet "${ws.name}".`);
          return;
        }
        if (ws.detectedDays.length > 0 && ws.selectedDays.length === 0) {
          setError(`Please select at least one Day header inside "${ws.name}" to link its exercises.`);
          return;
        }

        const filtered = getFilteredExercisesForSheet(ws);
        if (filtered.length === 0) {
          setError(`No exercises matched the selected Day(s) inside "${ws.name}".`);
          return;
        }

        if (ws.splitByDay && ws.selectedDays.length > 1) {
          for (const dayName of ws.selectedDays) {
            const dayExercises = filtered.filter(ex => ex.day === dayName);
            if (dayExercises.length > 0) {
              plansToCreate.push({
                title: dayName,
                sheetName: `${ws.name} · ${dayName}`,
                exercises: dayExercises,
              });
            }
          }
          // Include any exercises without a day label if present
          const untagged = filtered.filter(ex => !ex.day);
          if (untagged.length > 0) {
            plansToCreate.push({
              title: ws.customTitle.trim(),
              sheetName: ws.name,
              exercises: untagged,
            });
          }
        } else {
          const singleDaySuffix = ws.selectedDays.length === 1 && ws.detectedDays.length > 1
            ? `${ws.selectedDays[0]}`
            : ws.customTitle.trim();
          plansToCreate.push({
            title: singleDaySuffix,
            sheetName: ws.name,
            exercises: filtered,
          });
        }
      }

      setIsSaving(true);
      try {
        let firstPlanId: string | undefined;
        let updatedCount = 0;
        let createdCount = 0;
        const consumedPlanIds = new Set<string>();

        for (let idx = 0; idx < plansToCreate.length; idx++) {
          const item = plansToCreate[idx];
          let existingMatch: WorkoutPlan | undefined;

          if (targetPlanIdToUpdate) {
            if (plansToCreate.length === 1 && idx === 0) {
              existingMatch = candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate);
            } else {
              // For multi-day / multi-tab uploads, match by title first, or fall back to targetPlanIdToUpdate for the first unmatched item
              existingMatch = candidateExistingPlans.find(
                p => !consumedPlanIds.has(p.id) && p.title.trim().toLowerCase() === item.title.trim().toLowerCase()
              );
              if (!existingMatch && idx === 0) {
                existingMatch = candidateExistingPlans.find(p => !consumedPlanIds.has(p.id) && p.id === targetPlanIdToUpdate);
              }
            }
          }

          if (existingMatch) {
            consumedPlanIds.add(existingMatch.id);
            const merged = mergeUpdatedWorksheetIntoPlan(existingMatch, {
              title: item.title,
              description: description.trim() !== '' ? description : existingMatch.description,
              instructions: instructions.trim() !== '' ? instructions : existingMatch.instructions,
              sheetName: item.sheetName,
              defaultWeightUnit: weightUnit,
              weeks,
              exercises: item.exercises,
              importSheetData,
              sourceFileName: fileName || existingMatch.sourceFileName,
            });
            if (!firstPlanId) firstPlanId = merged.id;
            await saveWorkoutPlanDoc(merged);
            updatedCount++;
          } else {
            const plan = buildWorkoutPlan({
              ownerUsername,
              title: item.title,
              description,
              instructions,
              sheetName: item.sheetName,
              defaultWeightUnit: weightUnit,
              weeks,
              exercises: item.exercises,
              importSheetData,
              sourceFileName: fileName || undefined,
              createdBy: currentUser,
              assignedByAdmin: mode === 'admin',
            });
            if (!firstPlanId) firstPlanId = plan.id;
            await saveWorkoutPlanDoc(plan);
            createdCount++;
          }
        }

        const statusParts: string[] = [];
        if (updatedCount > 0) statusParts.push(`updated ${updatedCount} existing plan${updatedCount > 1 ? 's' : ''} (saved logs & history preserved)`);
        if (createdCount > 0) statusParts.push(`created ${createdCount} new plan${createdCount > 1 ? 's' : ''}`);
        setSavedMsg(
          mode === 'admin'
            ? `Successfully ${statusParts.join(' & ')} for ${ownerUsername}.`
            : `Successfully ${statusParts.join(' & ')}!`
        );
        setSheets([]);
        setManualRows([]);
        setManualTitle('');
        setDescription('');
        setInstructions('');
        setWeeks(1);
        setFileName('');
        setTargetPlanIdToUpdate('');
        if (inputRef.current) inputRef.current.value = '';
        onSaved?.(ownerUsername, firstPlanId);
      } catch (err: any) {
        setError(`Failed to save the plan: ${err?.message || String(err)}`);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // Manual row builder path
    if (manualRows.length === 0) {
      setError('Upload a sheet first (or add exercises manually).');
      return;
    }
    if (!manualTitle.trim()) {
      setError('Please give this workout plan a title.');
      return;
    }

    setIsSaving(true);
    try {
      const existingMatch = targetPlanIdToUpdate
        ? candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate)
        : undefined;

      const plan = existingMatch
        ? mergeUpdatedWorksheetIntoPlan(existingMatch, {
            title: manualTitle.trim(),
            description: description.trim() !== '' ? description : existingMatch.description,
            instructions: instructions.trim() !== '' ? instructions : existingMatch.instructions,
            defaultWeightUnit: weightUnit,
            weeks,
            exercises: manualRows,
            importSheetData,
            sourceFileName: fileName || existingMatch.sourceFileName,
          })
        : buildWorkoutPlan({
            ownerUsername,
            title: manualTitle.trim(),
            description,
            instructions,
            defaultWeightUnit: weightUnit,
            weeks,
            exercises: manualRows,
            importSheetData,
            sourceFileName: fileName || undefined,
            createdBy: currentUser,
            assignedByAdmin: mode === 'admin',
          });

      await saveWorkoutPlanDoc(plan);
      setSavedMsg(
        existingMatch
          ? `Updated "${plan.title}" — all saved weights, reps & weekly history preserved.`
          : mode === 'admin'
          ? `Workout plan assigned to ${ownerUsername}.`
          : 'Your workout plan was saved. Check "My Workouts".'
      );
      setManualRows([]);
      setManualTitle('');
      setDescription('');
      setInstructions('');
      setWeeks(1);
      setFileName('');
      setTargetPlanIdToUpdate('');
      if (inputRef.current) inputRef.current.value = '';
      onSaved?.(ownerUsername, plan.id);
    } catch (err: any) {
      setError(`Failed to save the plan: ${err?.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalWorkoutsToSave = useMemo(() => {
    if (!isMultiSheetMode) return manualRows.length > 0 ? 1 : 0;
    let count = 0;
    for (const s of sheets) {
      if (s.role !== 'workout' || s.exercises.length === 0) continue;
      if (s.detectedDays.length > 0) {
        if (s.selectedDays.length === 0) continue;
        count += s.splitByDay && s.selectedDays.length > 1 ? s.selectedDays.length : 1;
      } else {
        count += 1;
      }
    }
    return count;
  }, [isMultiSheetMode, sheets, manualRows.length]);

  const activeDaySet = new Set(activeSheet?.selectedDays || []);

  return (
    <div className="space-y-4">
      {/* Upload dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-red-500/30 hover:border-red-500/70 bg-neutral-900/60 hover:bg-neutral-900 transition-all p-6 flex flex-col items-center justify-center text-center gap-2"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {isParsing ? (
          <Loader2 className="w-7 h-7 text-red-500 animate-spin" />
        ) : (
          <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
            <Upload className="w-6 h-6" />
          </div>
        )}
        <p className="text-sm font-semibold text-white">
          {isParsing ? 'Scanning all sheets, day headers & video URLs...' : 'Click or drop a workout sheet here'}
        </p>
        <p className="text-[11px] text-neutral-500 font-mono">Multi-sheet Excel (.xlsx/.xls) · CSV · PDF</p>
        {fileName && !isParsing && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2.5 py-1 mt-1">
            <FileSpreadsheet className="w-3 h-3" /> {fileName}
            {sheets.length > 0 && ` · ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} detected`}
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {savedMsg && (
        <div className="flex items-center gap-2 text-[12px] text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3 py-2.5">
          <Check className="w-4 h-4 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* MULTI-SHEET DETECTOR & ROLE SELECTOR */}
      {sheets.length > 0 && (
        <div className="rounded-2xl border border-indigo-500/25 bg-neutral-950/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Detected Sheets ({sheets.length}) — Choose Role For Each Tab
              </h4>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Pick which sheet contains <strong className="text-red-300">Workouts</strong>, which holds <strong className="text-sky-300">Info / Instructions</strong>, or skip unused tabs.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {sheets.map((sheet, idx) => {
              const isWorkout = sheet.role === 'workout';
              const isInfo = sheet.role === 'instructions';
              const isSelectedForEdit = isWorkout && activeSheetIndex === idx;

              return (
                <div
                  key={`${sheet.name}-${idx}`}
                  className={`rounded-xl border p-3 transition-all flex flex-col gap-2.5 ${
                    isSelectedForEdit
                      ? 'border-red-500/60 bg-red-950/20'
                      : isInfo
                      ? 'border-sky-500/40 bg-sky-950/15'
                      : sheet.role === 'skip'
                      ? 'border-white/5 bg-neutral-900/40 opacity-60'
                      : 'border-white/10 bg-neutral-900/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">{sheet.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-neutral-400">
                          {sheet.exercises.length} rows
                        </span>
                        {sheet.detectedDays.length > 0 && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
                            {sheet.detectedDays.length} Day{sheet.detectedDays.length === 1 ? '' : 's'}
                          </span>
                        )}
                        {sheet.headerMatched && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                            Columns Matched
                          </span>
                        )}
                        {sheet.prefilledRowCount > 0 && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                            {sheet.prefilledRowCount} Pre-filled Data
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewInfoSheetIdx(previewInfoSheetIdx === idx ? null : idx)}
                      className="text-[10px] text-neutral-400 hover:text-white inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 shrink-0 cursor-pointer"
                      title="Preview raw sheet lines"
                    >
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                  </div>

                  {/* Role selector pills */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSheetRole(idx, 'workout')}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-all cursor-pointer ${
                        isWorkout
                          ? 'bg-red-600/90 text-white border-red-400 shadow-sm'
                          : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <Dumbbell className="w-3 h-3" /> Workout
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetRole(idx, 'instructions')}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-all cursor-pointer ${
                        isInfo
                          ? 'bg-sky-600/90 text-white border-sky-400 shadow-sm'
                          : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <FileText className="w-3 h-3" /> Info / Guide
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetRole(idx, 'skip')}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-all cursor-pointer ${
                        sheet.role === 'skip'
                          ? 'bg-neutral-700 text-neutral-200 border-neutral-500'
                          : 'bg-neutral-900 text-neutral-500 border-white/10 hover:text-neutral-300'
                      }`}
                    >
                      <Ban className="w-3 h-3" /> Skip
                    </button>
                  </div>

                  {previewInfoSheetIdx === idx && (
                    <div className="max-h-32 overflow-y-auto bg-black/50 border border-white/10 rounded-lg p-2 text-[11px] font-mono text-neutral-300 space-y-1 whitespace-pre-wrap">
                      {sheet.rawRows.slice(0, 12).map((r, rIdx) => (
                        <div key={rIdx} className="truncate border-b border-white/5 pb-0.5 last:border-none">
                          {r.filter(Boolean).join(' | ')}
                        </div>
                      ))}
                      {sheet.rawRows.length === 0 && <span className="text-neutral-500">Empty sheet</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Switcher when multiple sheets are tagged as Workout */}
      {workoutSheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 bg-neutral-900/70 border border-white/10 rounded-xl p-2.5">
          <span className="text-[11px] text-neutral-400 font-semibold px-1">Editing workout tab:</span>
          {workoutSheets.map(({ sheet, idx }) => (
            <button
              key={`edit-ws-${sheet.name}-${idx}`}
              type="button"
              onClick={() => setActiveWorkoutIdx(idx)}
              className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                activeSheetIndex === idx
                  ? 'bg-red-600 text-white border-red-400'
                  : 'bg-neutral-950 text-neutral-300 border-white/10 hover:border-red-500/40'
              }`}
            >
              {sheet.customTitle || sheet.name} ({sheet.exercises.length})
            </button>
          ))}
        </div>
      )}

      {/* DAY HEADERS SELECTOR INSIDE ACTIVE WORKOUT SHEET */}
      {isMultiSheetMode && activeSheet && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-950/10 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wider flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-amber-400" />
                Day Headers Inside "{activeSheet.name}" ({activeSheet.detectedDays.length})
              </h4>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Select which day header(s) to import and link their exercises. Unselected days are excluded on save.
              </p>
            </div>
            {activeSheet.detectedDays.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectAllDays(activeSheetIndex)}
                  className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 cursor-pointer"
                >
                  Select All
                </button>
              </div>
            )}
          </div>

          {activeSheet.detectedDays.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2">
                {activeSheet.detectedDays.map((dayName) => {
                  const isChecked = activeSheet.selectedDays.includes(dayName);
                  const dayCount = activeSheet.exercises.filter(e => e.day === dayName).length;
                  return (
                    <div
                      key={dayName}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all ${
                        isChecked
                          ? 'bg-amber-500/20 border-amber-400/60 text-white'
                          : 'bg-neutral-900/70 border-white/10 text-neutral-400 opacity-65'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDaySelection(activeSheetIndex, dayName)}
                        className="inline-flex items-center gap-1.5 font-bold cursor-pointer"
                      >
                        <span
                          className={`w-4 h-4 rounded flex items-center justify-center border ${
                            isChecked ? 'bg-amber-500 border-amber-400 text-black' : 'border-white/20 bg-neutral-950'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </span>
                        <span>{dayName}</span>
                        <span className="text-[10px] font-mono text-amber-300/90">({dayCount})</span>
                      </button>
                      {activeSheet.detectedDays.length > 1 && (
                        <button
                          type="button"
                          onClick={() => selectOnlyDay(activeSheetIndex, dayName)}
                          className="ml-1 text-[10px] text-amber-300 hover:text-white underline cursor-pointer"
                          title={`Select only ${dayName}`}
                        >
                          Only
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {activeSheet.selectedDays.length > 1 && (
                <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-amber-500/15 text-[11px]">
                  <span className="text-neutral-300 font-semibold">How to save selected days:</span>
                  <button
                    type="button"
                    onClick={() => toggleSplitByDay(activeSheetIndex, true)}
                    className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer transition-all ${
                      activeSheet.splitByDay
                        ? 'bg-red-600/90 text-white border-red-400'
                        : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                    }`}
                  >
                    Separate Workout Title per Day ({activeSheet.selectedDays.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSplitByDay(activeSheetIndex, false)}
                    className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer transition-all ${
                      !activeSheet.splitByDay
                        ? 'bg-red-600/90 text-white border-red-400'
                        : 'bg-neutral-900 text-neutral-400 border-white/10 hover:text-white'
                    }`}
                  >
                    1 Combined Plan (Filterable by Day)
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-[11px] text-neutral-400">
              No day banner headers were auto-detected in this sheet. You can add a Day header below or click <strong className="text-amber-300">Set as Day</strong> on any exercise row to link subsequent exercises.
            </p>
          )}

          {/* Add custom day tag */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              value={newDayInput}
              onChange={(e) => setNewDayInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomDayHeader(); } }}
              placeholder="Add day header (e.g. Day 1 - Push)"
              className="bg-neutral-950 border border-white/10 focus:border-amber-500/60 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none flex-1 min-w-[200px]"
            />
            <button
              type="button"
              onClick={addCustomDayHeader}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Day Header
            </button>
          </div>
        </div>
      )}

      {/* Plan meta */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
            {workoutSheets.length > 1 ? `Workout Title (${activeSheet?.name || 'Tab'})` : 'Workout Plan Title'}
          </span>
          <input
            value={displayedTitle}
            onChange={(e) => {
              if (isMultiSheetMode && activeSheetIndex >= 0) {
                updateSheetTitle(activeSheetIndex, e.target.value);
              } else {
                setManualTitle(e.target.value);
              }
            }}
            placeholder="e.g. Push / Pull / Legs — Week 1"
            className="bg-neutral-900 border border-white/10 focus:border-red-500/60 rounded-xl px-3 py-2 text-sm text-white outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Repeat for (weeks)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-24 bg-neutral-900 border border-white/10 focus:border-red-500/60 rounded-xl px-3 py-2 text-sm text-white outline-none"
            />
            <span className="text-[11px] text-neutral-500">Weekly logs</span>
          </div>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Default Weight Unit</span>
          <div className="inline-flex rounded-xl bg-neutral-900 border border-white/10 p-1 w-fit">
            {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setWeightUnit(u)}
                className={`px-3.5 py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                  weightUnit === u
                    ? 'bg-red-600 text-white shadow'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === 'admin' && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5 text-red-400" /> Assign to member
          </span>
          <select
            value={assignTo}
            onChange={(e) => {
              setAssignTo(e.target.value);
              setTargetPlanIdToUpdate('');
            }}
            className="bg-neutral-900 border border-white/10 focus:border-red-500/60 rounded-xl px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">— Select a member —</option>
            {userAccounts.map((u) => (
              <option key={u.id} value={u.username}>{u.username}</option>
            ))}
          </select>
        </label>
      )}

      {/* Save Destination: Create New vs Update Existing Plan (preserving saved logs & history) */}
      {candidateExistingPlans.length > 0 && (displayedRows.length > 0 || isMultiSheetMode) && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-emerald-300 font-bold">
              Save Mode — New Plan or Update Existing (Preserve Saved Logs)
            </span>
            {selectedExistingPlan && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                Preserving saved weights, reps &amp; history
              </span>
            )}
          </div>
          <select
            value={targetPlanIdToUpdate}
            onChange={(e) => selectTargetPlanToUpdate(e.target.value)}
            className="w-full bg-neutral-950 border border-emerald-500/30 focus:border-emerald-400 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none"
          >
            <option value="">➕ Create as a New Workout Plan</option>
            {candidateExistingPlans.map((p) => (
              <option key={p.id} value={p.id}>
                🔄 Update existing: {p.title} ({p.exercises.length} exercises, {p.weeks}w — keeps saved data)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Instructions / Info extracted from Info sheet (or editable) */}
      {(instructions.trim() !== '' || sheets.some(s => s.role === 'instructions')) && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-sky-400 font-semibold flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Information & Instructions (from selected Info sheet)
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder="General instructions, warm-up rules, tempo or nutrition notes..."
            className="bg-sky-950/15 border border-sky-500/30 focus:border-sky-400 rounded-xl px-3 py-2 text-xs text-sky-100 outline-none resize-y font-sans leading-relaxed"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Focus, goals, coach notes..."
          className="bg-neutral-900 border border-white/10 focus:border-red-500/60 rounded-xl px-3 py-2 text-sm text-white outline-none resize-none"
        />
      </label>

      {/* PRE-FILLED DATA NOTICE & TOGGLE */}
      {displayedRows.some(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed) && (
        <div className="rounded-2xl border border-indigo-500/35 bg-indigo-950/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-indigo-100 space-y-0.5">
            <p className="font-bold text-indigo-200">
              Pre-filled training data detected inside this sheet (
              {displayedRows.filter(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed).length} exercises)
            </p>
            <p className="text-[11px] text-indigo-300/85">
              Weights, kg/lbs units, actual reps, Week 1..N logs, Set 1..N data, Previous columns, and Done flags will be saved directly into your history.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-white bg-black/40 border border-indigo-400/30 rounded-xl px-3 py-1.5 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={importSheetData}
              onChange={(e) => setImportSheetData(e.target.checked)}
              className="accent-indigo-500 w-4 h-4 cursor-pointer"
            />
            Import sheet weights &amp; reps
          </label>
        </div>
      )}

      {/* Preview / editor */}
      {displayedRows.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/60 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-red-500" />
              {activeSheet ? `${activeSheet.name}: ` : ''}
              {displayedRows.length} exercise{displayedRows.length === 1 ? '' : 's'} detected
            </span>
            <button
              type="button"
              onClick={addRow}
              className="text-[11px] font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[940px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/60">
                  <th className="px-2 py-2 font-semibold w-40">Day Header</th>
                  <th className="px-2 py-2 font-semibold w-24">Type</th>
                  <th className="px-2 py-2 font-semibold">Exercise</th>
                  <th className="px-2 py-2 font-semibold w-24">Sets (Auto)</th>
                  <th className="px-2 py-2 font-semibold w-24">Reps Range</th>
                  {displayedRows.some(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed) && (
                    <th className="px-2 py-2 font-semibold w-48 text-indigo-300">Prefilled Sheet Data</th>
                  )}
                  <th className="px-2 py-2 font-semibold">Notes</th>
                  <th className="px-2 py-2 font-semibold w-64">Video URL (Auto)</th>
                  <th className="px-2 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row, idx) => {
                  const thumb = getVideoThumbnailInfo(row.video);
                  const autoSetCount = parseSetsCount(row.sets);
                  const isExcludedByDay =
                    isMultiSheetMode &&
                    (activeSheet?.detectedDays.length || 0) > 0 &&
                    !!row.day &&
                    !activeDaySet.has(row.day);

                  return (
                    <tr
                      key={idx}
                      className={`border-t border-white/5 ${
                        isExcludedByDay
                          ? 'opacity-40 bg-neutral-950'
                          : row.isSuperset
                          ? 'bg-fuchsia-950/30 border-l-4 border-l-fuchsia-400'
                          : ''
                      }`}
                    >
                      {/* Linked Day Header */}
                      <td className="px-1.5 py-1">
                        {isMultiSheetMode && (activeSheet?.detectedDays.length || 0) > 0 ? (
                          <select
                            value={row.day || ''}
                            onChange={(e) => updateRow(idx, 'day', e.target.value)}
                            className="w-full bg-neutral-900 border border-white/10 focus:border-amber-500/50 rounded-lg px-2 py-1.5 text-[11px] text-amber-200 outline-none"
                          >
                            <option value="">(Unassigned)</option>
                            {activeSheet?.detectedDays.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={row.day || ''}
                            onChange={(e) => updateRow(idx, 'day', e.target.value)}
                            placeholder="Day..."
                            className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-amber-500/40 rounded-lg px-2 py-1.5 text-[11px] text-amber-200 outline-none"
                          />
                        )}
                      </td>

                      {/* Superset Toggle Badge */}
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => toggleRowSuperset(idx)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer transition-all ${
                            row.isSuperset
                              ? 'bg-fuchsia-500/25 border-fuchsia-400/60 text-fuchsia-200'
                              : 'bg-neutral-900 border-white/10 text-neutral-500 hover:text-neutral-300'
                          }`}
                          title="Toggle Superset highlight"
                        >
                          <Zap className="w-3 h-3" />
                          {row.isSuperset ? (row.supersetGroup || 'SS') : 'Std'}
                        </button>
                      </td>

                      {/* Exercise Name */}
                      <td className="px-1 py-1">
                        <input
                          value={row.name}
                          onChange={(e) => updateRow(idx, 'name', e.target.value)}
                          className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[12px] text-white outline-none"
                        />
                      </td>

                      {/* Sets + Auto Badge */}
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1">
                          <input
                            value={row.sets}
                            onChange={(e) => updateRow(idx, 'sets', e.target.value)}
                            className="w-12 bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[12px] text-white font-mono outline-none"
                          />
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 shrink-0"
                            title={`Generates ${autoSetCount} Weight/Reps set row(s) automatically`}
                          >
                            {autoSetCount}×
                          </span>
                        </div>
                      </td>

                      {/* Reps */}
                      <td className="px-1 py-1">
                        <input
                          value={row.reps}
                          onChange={(e) => updateRow(idx, 'reps', e.target.value)}
                          className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[12px] text-white font-mono outline-none"
                        />
                      </td>

                      {/* Prefilled Sheet Data Chips */}
                      {displayedRows.some(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed) && (
                        <td className="px-1.5 py-1">
                          <div className="flex flex-wrap gap-1">
                            {row.weeklyLogs ? (
                              Object.entries(row.weeklyLogs)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([wkKey, wData]) => {
                                  const first = wData.entries.find(e => e.weight || e.reps);
                                  const wkLabel = Number(wkKey) === 0 ? 'Prev' : `W${wkKey}`;
                                  const unitLbl = first?.unit || wData.unit || weightUnit;
                                  return (
                                    <span
                                      key={wkKey}
                                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/30 text-indigo-200 whitespace-nowrap"
                                    >
                                      {wkLabel}: {first ? `${first.weight || '—'}${first.weight && first.weight !== 'BW' ? unitLbl : ''}×${first.reps || '—'}` : (wData.completed ? 'Done ✓' : 'Logged')}
                                    </span>
                                  );
                                })
                            ) : row.loggedWeight || row.loggedReps ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/30 text-indigo-200">
                                {row.loggedWeight || '—'}{row.loggedUnit || weightUnit}×{row.loggedReps || '—'}
                              </span>
                            ) : row.completed ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-200">
                                Done ✓
                              </span>
                            ) : (
                              <span className="text-[10px] text-neutral-600">—</span>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Notes */}
                      <td className="px-1 py-1">
                        <input
                          value={row.notes}
                          onChange={(e) => updateRow(idx, 'notes', e.target.value)}
                          className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[12px] text-neutral-300 outline-none"
                        />
                      </td>

                      {/* Auto-fetched Video URL + Thumbnail */}
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1.5">
                          {thumb?.thumbnailUrl && (
                            <img
                              src={thumb.thumbnailUrl}
                              alt=""
                              className="w-8 h-6 object-cover rounded border border-white/10 shrink-0"
                            />
                          )}
                          <input
                            value={row.video}
                            onChange={(e) => updateRow(idx, 'video', e.target.value)}
                            placeholder="https://..."
                            className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[11px] font-mono text-sky-300 outline-none"
                          />
                        </div>
                      </td>

                      {/* Row actions: promote as day header + delete */}
                      <td className="px-1 py-1 text-right">
                        <div className="inline-flex items-center gap-0.5">
                          {isMultiSheetMode && !row.sets && !row.reps && row.name && (
                            <button
                              type="button"
                              onClick={() => promoteRowToDayHeader(idx)}
                              className="p-1.5 text-amber-400 hover:text-amber-300 rounded-lg hover:bg-amber-500/10 cursor-pointer"
                              title="Set this row as Day Header for exercises below"
                            >
                              <Tag className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRow(idx)}
                            className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-white/10 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5" />
              Video URLs & thumbnails are auto-fetched from links, hyperlinks, or formulas.
            </span>
            <span>·</span>
            <span>Each Set row (Set 1..N) is auto-generated from the Sets column with Weight & Reps inputs.</span>
          </div>
        </div>
      )}

      {displayedRows.length === 0 && !isParsing && (
        <button
          type="button"
          onClick={addRow}
          className="text-[12px] font-semibold text-neutral-400 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Or add exercises row by row
        </button>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || totalWorkoutsToSave === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-red-950/50 cursor-pointer"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {selectedExistingPlan
            ? 'Update Worksheet (Keep Saved Data)'
            : mode === 'admin'
            ? totalWorkoutsToSave > 1
              ? `Assign ${totalWorkoutsToSave} Workout Plans`
              : 'Assign workout plan'
            : totalWorkoutsToSave > 1
              ? `Save ${totalWorkoutsToSave} Workout Plans`
              : 'Save my workout plan'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/20 text-neutral-300 text-sm font-semibold cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default SheetUploader;
