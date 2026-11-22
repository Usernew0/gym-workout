import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, Loader2, Trash2, Plus, Check,
  AlertTriangle, Video, User as UserIcon, Dumbbell, FileText,
  Layers, Eye, Ban, CalendarDays, Tag, Zap, Download, Columns3, ChevronDown, ChevronUp
} from 'lucide-react';
import { UserAccount, WeightUnit, WorkoutPlan } from '../../types';
import {
  parseSheetFileAllSheets,
  rowsToExercisesWithMeta,
  consolidateMultiTabWorkoutSheets,
  extractWeekNumberFromTabName,
  ParsedExerciseRow,
  SheetRole,
  ManualColumnMappingRole,
  AssignableColumnKey,
  DetectedSheetColumnInfo,
  emptyRow,
  getVideoThumbnailInfo,
  parseSetsCount,
  splitSetsAndReps,
} from '../../lib/sheetParser';
import { buildWorkoutPlan, mergeUpdatedWorksheetIntoPlan, saveWorkoutPlanDoc } from '../../lib/gymService';
import { downloadStandardWorkoutTemplateExcel } from '../../lib/workoutExcelExport';

interface SheetUploaderProps {
  mode: 'user' | 'admin';
  currentUser: string;
  userAccounts?: UserAccount[];
  existingPlans?: WorkoutPlan[];
  activePlanId?: string;
  initialAssignTo?: string;
  initialTargetPlanId?: string;
  onSaved?: (ownerUsername: string, firstSavedPlanId?: string) => void;
  onCancel?: () => void;
}

type UploadTargetMode = 'smart' | 'update_current' | 'create_new';

function normMatchText(s?: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findAutoMatchedPlan(
  entries: SheetEntry[],
  uploadedFileName: string,
  candidates: WorkoutPlan[],
  preferredPlanId?: string
): { plan: WorkoutPlan; reason: string; score: number } | null {
  if (candidates.length === 0) return null;
  const workoutEntries = entries.filter(e => e.role === 'workout' && e.exercises.length > 0);
  const allUploadedNames = new Set(
    workoutEntries
      .flatMap(e => e.exercises)
      .map(ex => normMatchText(ex.name))
      .filter(Boolean)
  );
  const uploadedFileNorm = normMatchText(uploadedFileName);
  const sheetNamesNorm = workoutEntries.map(e => normMatchText(e.customTitle || e.name)).filter(Boolean);

  let best: { plan: WorkoutPlan; reason: string; score: number } | null = null;

  for (const p of candidates) {
    let score = 0;
    const reasons: string[] = [];

    const pTitleNorm = normMatchText(p.title);
    const pFileNorm = normMatchText(p.sourceFileName);
    const pSheetNorm = normMatchText(p.sheetName);

    if (uploadedFileNorm && pFileNorm && uploadedFileNorm === pFileNorm) {
      score += 80;
      reasons.push('same filename');
    } else if (uploadedFileNorm && pTitleNorm && (uploadedFileNorm === pTitleNorm || uploadedFileNorm.includes(pTitleNorm) || pTitleNorm.includes(uploadedFileNorm))) {
      score += 65;
      reasons.push('matching title');
    }

    if (
      sheetNamesNorm.some(
        sn =>
          sn &&
          ((pTitleNorm && (sn === pTitleNorm || sn.includes(pTitleNorm) || pTitleNorm.includes(sn))) ||
            (pSheetNorm && (sn === pSheetNorm || pSheetNorm.includes(sn))))
      )
    ) {
      score += 55;
      if (!reasons.includes('matching title')) reasons.push('matching sheet tab');
    }

    const planExNames = (p.exercises || []).map(ex => normMatchText(ex.name)).filter(Boolean);
    if (planExNames.length > 0 && allUploadedNames.size > 0) {
      let overlap = 0;
      for (const name of planExNames) {
        if (allUploadedNames.has(name)) overlap++;
      }
      const ratio = overlap / Math.max(planExNames.length, allUploadedNames.size);
      if (overlap > 0) {
        score += Math.round(ratio * 100);
        reasons.push(`${overlap}/${planExNames.length} matching exercises`);
      }
    }

    if (preferredPlanId && p.id === preferredPlanId && score > 0) {
      score += 20;
    }

    if (score >= 30 && (!best || score > best.score)) {
      best = {
        plan: p,
        reason: reasons.join(' · ') || 'active workout match',
        score,
      };
    }
  }

  return best;
}

interface SheetEntry {
  name: string;
  role: SheetRole;
  rawRows: string[][];
  linkGrid?: (string | undefined)[][];
  textContent: string;
  exercises: ParsedExerciseRow[];
  detectedDays: string[];
  selectedDays: string[]; // Selected day headers to import/link
  splitByDay: boolean;    // Save each selected day as its own workout title vs 1 combined plan
  customTitle: string;
  headerMatched: boolean;
  headerRowIndex: number;
  detectedColumns: DetectedSheetColumnInfo[];
  missingRequiredColumns: AssignableColumnKey[];
  missingOptionalColumns: AssignableColumnKey[];
  columnAssignments: Record<number, ManualColumnMappingRole>;
  hasCustomColumnOverride?: boolean;
  detectedDataWeeks: number;
  detectedWeightUnit?: WeightUnit;
  prefilledRowCount: number;
  hasRpeColumn: boolean;
  hasRirColumn: boolean;
}

const BASE_COLUMN_ROLE_OPTIONS: Array<{ value: ManualColumnMappingRole; label: string }> = [
  { value: 'ignore', label: '— Ignore / Unused —' },
  { value: 'name', label: 'Exercises (Exercise Name)' },
  { value: 'day', label: 'Day / Split Header' },
  { value: 'setsReps', label: 'Sets × Reps (Combined)' },
  { value: 'sets', label: 'Sets (Target)' },
  { value: 'reps', label: 'Reps (Target)' },
  { value: 'weight', label: 'Week 1 / Weight (Logged)' },
  { value: 'actual_reps', label: 'Week 1 / Actual Reps (Logged)' },
  { value: 'weight_reps', label: 'Week 1 / Weight × Reps (Logged)' },
  { value: 'rpe', label: 'RPE (Target / Week 1)' },
  { value: 'rir', label: 'RIP / RIR (Target / Week 1)' },
  { value: 'w1_notes', label: 'Week 1 Notes' },
  { value: 'w1_done', label: 'Week 1 Done / Status' },
  { value: 'w1_combined', label: 'Week 1 Set Breakdown / Combined' },
  { value: 'notes', label: 'Coach Notes / Tempo / Rest' },
  { value: 'video', label: 'Video URL / Link' },
  { value: 'superset', label: 'Superset Tag' },
  { value: 'done', label: 'Done / Status' },
  { value: 'prev_combined', label: 'Previous Session (Weight × Reps)' },
  { value: 'prev_weight', label: 'Previous Weight' },
  { value: 'prev_reps', label: 'Previous Reps' },
  { value: 'prev_rpe', label: 'Previous RPE' },
  { value: 'prev_rir', label: 'Previous RIR / RIP' },
];

function buildColumnRoleOptions(maxWeeks: number): Array<{ value: ManualColumnMappingRole; label: string }> {
  const limit = Math.min(52, Math.max(8, maxWeeks));
  const weekOpts: Array<{ value: ManualColumnMappingRole; label: string }> = [];
  for (let w = 2; w <= limit; w++) {
    weekOpts.push(
      { value: `w${w}_weight`, label: `Week ${w} Weight (Logged)` },
      { value: `w${w}_reps`, label: `Week ${w} Reps (Logged)` },
      { value: `w${w}_rpe`, label: `Week ${w} RPE` },
      { value: `w${w}_rir`, label: `Week ${w} RIP / RIR` },
      { value: `w${w}_notes`, label: `Week ${w} Notes` },
      { value: `w${w}_done`, label: `Week ${w} Done / Status` },
      { value: `w${w}_combined`, label: `Week ${w} Combined / Set Breakdown` }
    );
  }
  return [...BASE_COLUMN_ROLE_OPTIONS, ...weekOpts];
}

const FIELD_META: Record<AssignableColumnKey | 'setsReps', { label: string; role: ManualColumnMappingRole; hint: string }> = {
  name: { label: 'Exercises Name', role: 'name', hint: 'Column containing movement names (and optional Day rows)' },
  sets: { label: 'Sets', role: 'sets', hint: 'Column with target set count (e.g. 3 or 4)' },
  reps: { label: 'Reps', role: 'reps', hint: 'Column with target rep range (e.g. 8-12)' },
  setsReps: { label: 'Sets × Reps', role: 'setsReps', hint: 'Combined column like "4 × 10"' },
  day: { label: 'Day Header', role: 'day', hint: 'Separate Day column if days are not inline banners' },
  weight: { label: 'Weight', role: 'weight', hint: 'Pre-filled or logged weights (kg/lbs)' },
  actual_reps: { label: 'Actual Reps', role: 'actual_reps', hint: 'Logged actual reps performed' },
  rpe: { label: 'RPE', role: 'rpe', hint: 'Target or logged RPE effort scale' },
  rir: { label: 'RIP / RIR', role: 'rir', hint: 'Reps in Reserve (RIR / RIP)' },
  notes: { label: 'Notes', role: 'notes', hint: 'Coaching cues, tempo, or rest instructions' },
  video: { label: 'Video URL', role: 'video', hint: 'Exercise demo link (YouTube, Vimeo, Drive, etc.)' },
};

const ACCEPTED = '.xlsx,.xls,.csv,.tsv,.txt,.pdf';

export const SheetUploader: React.FC<SheetUploaderProps> = ({
  mode,
  currentUser,
  userAccounts = [],
  existingPlans = [],
  activePlanId = '',
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
  const [showColumnMapperPanel, setShowColumnMapperPanel] = useState(false);
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
  const [uploadTargetMode, setUploadTargetMode] = useState<UploadTargetMode>(
    initialTargetPlanId ? 'update_current' : 'smart'
  );
  const [autoMatchReason, setAutoMatchReason] = useState<string | null>(null);
  const [importSheetData, setImportSheetData] = useState(true);
  const [replaceExistingWeekLogs, setReplaceExistingWeekLogs] = useState(false);
  const [manualShowRpe, setManualShowRpe] = useState(false);
  const [manualShowRir, setManualShowRir] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const initializedTargetRef = useRef<string>('');

  useEffect(() => {
    if (initialAssignTo) setAssignTo(initialAssignTo);
    if (initialTargetPlanId && initializedTargetRef.current !== initialTargetPlanId) {
      const found = existingPlans.find(p => p.id === initialTargetPlanId);
      if (found) {
        initializedTargetRef.current = initialTargetPlanId;
        setTargetPlanIdToUpdate(initialTargetPlanId);
        setUploadTargetMode('update_current');
        setWeeks(prev => Math.max(prev, found.weeks || 1));
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

  const currentWorkoutPlan = useMemo(
    () =>
      (activePlanId ? candidateExistingPlans.find(p => p.id === activePlanId) : null) ||
      candidateExistingPlans[0] ||
      null,
    [candidateExistingPlans, activePlanId]
  );

  const selectedExistingPlan = useMemo(
    () => candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate) || null,
    [candidateExistingPlans, targetPlanIdToUpdate]
  );

  const isCombinedMultiDayPlan = (plan?: WorkoutPlan | null): boolean => {
    if (!plan) return false;
    const distinctDays = new Set((plan.exercises || []).map(e => (e.day || '').trim()).filter(Boolean));
    return distinctDays.size > 1;
  };

  const hasSeparateExistingPlansForDays = (daysOrTitles: string[]): boolean => {
    if (daysOrTitles.length < 2) return false;
    const normTitles = new Set(candidateExistingPlans.map(p => p.title.trim().toLowerCase()).filter(Boolean));
    let matchedCount = 0;
    for (const d of daysOrTitles) {
      if (normTitles.has(d.trim().toLowerCase())) matchedCount++;
    }
    return matchedCount >= 2;
  };

  const selectTargetPlanToUpdate = (planId: string, manualReason: string | null = null) => {
    setTargetPlanIdToUpdate(planId);
    setAutoMatchReason(manualReason);
    if (!planId) {
      setUploadTargetMode('create_new');
      setReplaceExistingWeekLogs(false);
      return;
    }
    const found = candidateExistingPlans.find(p => p.id === planId);
    if (found) {
      setWeeks(prev => Math.max(prev, found.weeks || 1));
      setWeightUnit(found.defaultWeightUnit || 'kg');
      if (!description.trim() && found.description) setDescription(found.description);
      if (!instructions.trim() && found.instructions) setInstructions(found.instructions);
      const loadedHasTrainedWeeks = sheets.some(
        s =>
          s.role === 'workout' &&
          ((s.prefilledRowCount || 0) > 0 ||
            (s.detectedDataWeeks || 0) > 0 ||
            Boolean(extractWeekNumberFromTabName(s.name)))
      );
      if (loadedHasTrainedWeeks) {
        setReplaceExistingWeekLogs(true);
      }
      // When updating one specific plan, keep all days combined inside it unless separate existing day plans exist
      setSheets(prev =>
        prev.map(s =>
          s.role === 'workout' && (isCombinedMultiDayPlan(found) || !hasSeparateExistingPlansForDays(s.selectedDays))
            ? { ...s, splitByDay: false }
            : s
        )
      );
    }
  };

  const applyUploadTargetMode = (nextMode: UploadTargetMode) => {
    setUploadTargetMode(nextMode);
    if (nextMode === 'create_new') {
      selectTargetPlanToUpdate('', null);
      return;
    }
    if (nextMode === 'update_current') {
      const target = currentWorkoutPlan;
      if (target) {
        selectTargetPlanToUpdate(target.id, 'Targeted current active workout');
      }
      return;
    }
    // 'smart': re-evaluate auto-match if sheets are already loaded, or default to currentWorkoutPlan
    if (sheets.length > 0) {
      const matched = findAutoMatchedPlan(sheets, fileName, candidateExistingPlans, currentWorkoutPlan?.id);
      if (matched) {
        selectTargetPlanToUpdate(matched.plan.id, `Auto-matched (${matched.reason})`);
      } else if (currentWorkoutPlan) {
        selectTargetPlanToUpdate(currentWorkoutPlan.id, 'Defaulted to current active workout');
      } else {
        selectTargetPlanToUpdate('', null);
      }
    } else if (currentWorkoutPlan) {
      selectTargetPlanToUpdate(currentWorkoutPlan.id, 'Ready to update current workout');
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

      const entries: SheetEntry[] = detected.map((s) => {
        const assignments: Record<number, ManualColumnMappingRole> = {};
        (s.detectedColumns || []).forEach((col) => {
          assignments[col.colIdx] = col.assignedRole;
        });
        return {
          name: s.name,
          role: s.suggestedRole,
          rawRows: s.rawRows,
          linkGrid: s.linkGrid,
          textContent: s.textContent,
          exercises: s.exercises,
          detectedDays: s.detectedDays || [],
          selectedDays: [...(s.detectedDays || [])],
          splitByDay: (s.detectedDays || []).length > 1,
          customTitle: hasMultiple ? s.name : (baseFileTitle || s.name),
          headerMatched: s.headerMatched,
          headerRowIndex: s.headerRowIndex ?? -1,
          detectedColumns: s.detectedColumns || [],
          missingRequiredColumns: s.missingRequiredColumns || [],
          missingOptionalColumns: s.missingOptionalColumns || [],
          columnAssignments: assignments,
          hasCustomColumnOverride: false,
          detectedDataWeeks: s.detectedDataWeeks || 0,
          detectedWeightUnit: s.detectedWeightUnit,
          prefilledRowCount: s.prefilledRowCount || 0,
          hasRpeColumn: Boolean(s.hasRpeColumn),
          hasRirColumn: Boolean(s.hasRirColumn),
        };
      });

      setSheets(entries);
      setManualRows([]);
      setInstructions(rebuildInstructionsFromSheets(entries));
      setImportSheetData(true);

      const maxDetectedWeeks = entries.reduce((mx, s) => {
        const tabWk = s.role === 'workout' ? extractWeekNumberFromTabName(s.name) || 0 : 0;
        return Math.max(mx, s.detectedDataWeeks || 0, tabWk);
      }, 0);
      if (maxDetectedWeeks > 1) {
        setWeeks(prev => Math.max(prev, maxDetectedWeeks));
      }
      const detectedUnit = entries.find(s => s.detectedWeightUnit)?.detectedWeightUnit;
      if (detectedUnit) {
        setWeightUnit(detectedUnit);
      }

      const hasTrainedWeekData = entries.some(
        s =>
          s.role === 'workout' &&
          ((s.prefilledRowCount || 0) > 0 ||
            (s.detectedDataWeeks || 0) > 0 ||
            Boolean(extractWeekNumberFromTabName(s.name)))
      );

      const firstWorkoutIdx = entries.findIndex(s => s.role === 'workout');
      setActiveWorkoutIdx(firstWorkoutIdx >= 0 ? firstWorkoutIdx : 0);

      // Automatically open column mapper whenever any workout sheet has missing required columns or unmatched headers
      const hasMissingColumns = entries.some(
        s => s.role === 'workout' && (!s.headerMatched || s.missingRequiredColumns.length > 0)
      );
      setShowColumnMapperPanel(hasMissingColumns);

      // Auto-Update existing plan by default when candidate plans exist (unless user explicitly chose Create as New Plan)
      let resolvedTargetPlan: WorkoutPlan | undefined;
      if (uploadTargetMode === 'update_current') {
        const preferred =
          (targetPlanIdToUpdate ? candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate) : null) ||
          currentWorkoutPlan;
        if (preferred) {
          resolvedTargetPlan = preferred;
          setTargetPlanIdToUpdate(preferred.id);
          setAutoMatchReason('Auto-updating active workout plan');
          setWeeks(prev => Math.max(prev, preferred.weeks || 1, maxDetectedWeeks));
        }
      } else if (uploadTargetMode === 'smart' && candidateExistingPlans.length > 0) {
        const matched = findAutoMatchedPlan(entries, file.name, candidateExistingPlans, currentWorkoutPlan?.id);
        if (matched) {
          resolvedTargetPlan = matched.plan;
          setTargetPlanIdToUpdate(matched.plan.id);
          setAutoMatchReason(`Auto-matched (${matched.reason})`);
          setWeeks(prev => Math.max(prev, matched.plan.weeks || 1, maxDetectedWeeks));
          if (!detectedUnit && matched.plan.defaultWeightUnit) {
            setWeightUnit(matched.plan.defaultWeightUnit);
          }
          if (!description.trim() && matched.plan.description) {
            setDescription(matched.plan.description);
          }
        } else if (currentWorkoutPlan) {
          // Automatic fallback to current active workout so uploaded updated sheets auto-update without manual selection
          resolvedTargetPlan = currentWorkoutPlan;
          setTargetPlanIdToUpdate(currentWorkoutPlan.id);
          setAutoMatchReason('Auto-updating current workout plan');
          setWeeks(prev => Math.max(prev, currentWorkoutPlan.weeks || 1, maxDetectedWeeks));
          if (!detectedUnit && currentWorkoutPlan.defaultWeightUnit) {
            setWeightUnit(currentWorkoutPlan.defaultWeightUnit);
          }
          if (!description.trim() && currentWorkoutPlan.description) {
            setDescription(currentWorkoutPlan.description);
          }
        }
      }

      // Default to replacing/updating matching week logs automatically when updating an existing plan with trained week data
      setReplaceExistingWeekLogs(Boolean(resolvedTargetPlan && hasTrainedWeekData));

      // When updating a single target plan, preserve its title (for single-tab uploads) and keep splitByDay = false so ALL days merge
      if (resolvedTargetPlan) {
        const workoutCount = entries.filter(s => s.role === 'workout').length;
        setSheets(prev =>
          prev.map(s => {
            if (s.role !== 'workout') return s;
            const keepCombined =
              isCombinedMultiDayPlan(resolvedTargetPlan) || !hasSeparateExistingPlansForDays(s.selectedDays);
            return {
              ...s,
              ...(keepCombined ? { splitByDay: false } : {}),
              ...(workoutCount === 1 && resolvedTargetPlan?.title ? { customTitle: resolvedTargetPlan.title } : {}),
            };
          })
        );
      }

      if (entries.every(s => s.exercises.length === 0)) {
        setError('No exercises could be extracted yet — check the Uploaded Sheet Columns panel below and assign which column holds Exercises, Sets, and Reps.');
      }
    } catch (err: any) {
      console.error('Sheet parse failed:', err);
      setError(`Could not read this file: ${err?.message || String(err)}`);
    } finally {
      setIsParsing(false);
    }
  };

  const applySheetColumnOverride = (
    sheetIdx: number,
    nextHeaderRowIndex: number,
    nextAssignments: Record<number, ManualColumnMappingRole>
  ) => {
    setError(null);
    setSheets(prev => {
      const next = prev.map((s, i) => {
        if (i !== sheetIdx) return s;
        const reparsed = rowsToExercisesWithMeta(s.rawRows, s.linkGrid, {
          headerRowIndex: nextHeaderRowIndex,
          assignments: nextAssignments,
        });
        const nextDetectedDays = reparsed.detectedDays || [];
        return {
          ...s,
          exercises: reparsed.exercises,
          detectedDays: nextDetectedDays,
          selectedDays: nextDetectedDays.length > 0 ? [...nextDetectedDays] : [],
          headerMatched: reparsed.headerMatched,
          headerRowIndex: nextHeaderRowIndex,
          detectedColumns: reparsed.detectedColumns,
          missingRequiredColumns: reparsed.missingRequiredColumns,
          missingOptionalColumns: reparsed.missingOptionalColumns,
          columnAssignments: nextAssignments,
          hasCustomColumnOverride: true,
          detectedDataWeeks: reparsed.detectedDataWeeks || 0,
          detectedWeightUnit: reparsed.detectedWeightUnit || s.detectedWeightUnit,
          prefilledRowCount: reparsed.prefilledRowCount || 0,
          hasRpeColumn: Boolean(reparsed.hasRpeColumn),
          hasRirColumn: Boolean(reparsed.hasRirColumn),
        };
      });
      const updatedTarget = next[sheetIdx];
      if (updatedTarget) {
        if ((updatedTarget.detectedDataWeeks || 0) > 1) {
          setWeeks(w => Math.max(w, updatedTarget.detectedDataWeeks || 1));
        }
        if (updatedTarget.detectedWeightUnit) {
          setWeightUnit(updatedTarget.detectedWeightUnit);
        }
        const nowHasTrainedData = next.some(
          st =>
            st.role === 'workout' &&
            ((st.prefilledRowCount || 0) > 0 ||
              (st.detectedDataWeeks || 0) > 0 ||
              Boolean(extractWeekNumberFromTabName(st.name)))
        );
        if (targetPlanIdToUpdate && nowHasTrainedData) {
          setReplaceExistingWeekLogs(true);
        }
      }
      return next;
    });
  };

  const assignMissingFieldToColumn = (
    sheetIdx: number,
    role: ManualColumnMappingRole,
    chosenColIdx: number
  ) => {
    const target = sheets[sheetIdx];
    if (!target) return;
    const nextAssignments: Record<number, ManualColumnMappingRole> = { ...target.columnAssignments };
    // Clear previous column holding the same singular role
    if (role !== 'ignore') {
      Object.keys(nextAssignments).forEach(k => {
        const idxNum = Number(k);
        if (nextAssignments[idxNum] === role) {
          nextAssignments[idxNum] = 'ignore';
        }
      });
    }
    if (chosenColIdx >= 0) {
      nextAssignments[chosenColIdx] = role;
    }
    applySheetColumnOverride(sheetIdx, target.headerRowIndex, nextAssignments);
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
        const split = splitSetsAndReps(value, false);
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
        hasRpeColumn: boolean;
        hasRirColumn: boolean;
        planWeeks: number;
      }> = [];

      const weekTaggedWorkouts = selectedWorkouts.filter(ws => extractWeekNumberFromTabName(ws.name) !== null);
      const isWeekByTabWorkbook =
        selectedWorkouts.length > 1 &&
        (weekTaggedWorkouts.length >= 2 ||
          (weekTaggedWorkouts.length >= 1 &&
            weekTaggedWorkouts.some(ws => (extractWeekNumberFromTabName(ws.name) || 0) >= 2)));

      // If updating a single target plan from a multi-tab workbook (or consolidating Week 1..N tabs),
      // merge all selected workout tabs cleanly into a unified plan.
      const shouldCombineMultiTabIntoTarget =
        isWeekByTabWorkbook ||
        (Boolean(targetPlanIdToUpdate) &&
          selectedWorkouts.length > 1 &&
          !hasSeparateExistingPlansForDays(selectedWorkouts.map(ws => ws.customTitle.trim() || ws.name)));

      if (shouldCombineMultiTabIntoTarget) {
        const tabsForConsolidation = [];
        for (const ws of selectedWorkouts) {
          if (ws.detectedDays.length > 0 && ws.selectedDays.length === 0) {
            setError(`Please select at least one Day header inside "${ws.name}" to link its exercises.`);
            return;
          }
          const filtered = getFilteredExercisesForSheet(ws);
          if (filtered.length === 0) continue;
          tabsForConsolidation.push({
            name: ws.name,
            customTitle: ws.customTitle,
            exercises: filtered,
            hasRpeColumn: ws.hasRpeColumn,
            hasRirColumn: ws.hasRirColumn,
            detectedDataWeeks: ws.detectedDataWeeks,
          });
        }
        const consolidated = consolidateMultiTabWorkoutSheets(tabsForConsolidation);
        if (consolidated.exercises.length === 0) {
          setError('No exercises matched the selected Day(s) inside the uploaded workbook.');
          return;
        }
        const effectivePlanWeeks = Math.max(weeks, consolidated.highestWeek || 1);
        if (effectivePlanWeeks > weeks) {
          setWeeks(effectivePlanWeeks);
        }
        const targetObj = candidateExistingPlans.find(p => p.id === targetPlanIdToUpdate);
        plansToCreate.push({
          title: targetObj?.title || selectedWorkouts[0].customTitle.trim() || selectedWorkouts[0].name,
          sheetName: selectedWorkouts.map(w => w.name).join(', '),
          exercises: consolidated.exercises,
          hasRpeColumn: consolidated.hasRpeColumn,
          hasRirColumn: consolidated.hasRirColumn,
          planWeeks: effectivePlanWeeks,
        });
      } else {
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

          const tabWeekNum = extractWeekNumberFromTabName(ws.name) || 0;
          let maxExWeek = Math.max(weeks, ws.detectedDataWeeks || 0, tabWeekNum);
          filtered.forEach(ex => {
            Object.keys(ex.weeklyLogs || {}).forEach(k => {
              const wn = Number(k);
              if (wn >= 1 && wn <= 52 && wn > maxExWeek) maxExWeek = wn;
            });
          });

          const sheetHasRpe = Boolean(
            ws.hasRpeColumn ||
              filtered.some(ex => Boolean(ex.rpe?.trim()) || Object.values(ex.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rpe?.trim()))))
          );
          const sheetHasRir = Boolean(
            ws.hasRirColumn ||
              filtered.some(ex => Boolean(ex.rir?.trim()) || Object.values(ex.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rir?.trim()))))
          );

          if (ws.splitByDay && ws.selectedDays.length > 1) {
            for (const dayName of ws.selectedDays) {
              const dayExercises = filtered.filter(ex => ex.day === dayName);
              if (dayExercises.length > 0) {
                plansToCreate.push({
                  title: dayName,
                  sheetName: `${ws.name} · ${dayName}`,
                  exercises: dayExercises,
                  hasRpeColumn: sheetHasRpe,
                  hasRirColumn: sheetHasRir,
                  planWeeks: maxExWeek,
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
                hasRpeColumn: sheetHasRpe,
                hasRirColumn: sheetHasRir,
                planWeeks: maxExWeek,
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
              hasRpeColumn: sheetHasRpe,
              hasRirColumn: sheetHasRir,
              planWeeks: maxExWeek,
            });
          }
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
              weeks: Math.max(weeks, item.planWeeks, existingMatch.weeks || 1),
              hasRpeColumn: item.hasRpeColumn,
              hasRirColumn: item.hasRirColumn,
              exercises: item.exercises,
              importSheetData,
              replaceExistingWeekLogs,
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
              weeks: Math.max(weeks, item.planWeeks),
              hasRpeColumn: item.hasRpeColumn,
              hasRirColumn: item.hasRirColumn,
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

      const manualHasRpe = Boolean(manualShowRpe || manualRows.some(r => Boolean(r.rpe?.trim())));
      const manualHasRir = Boolean(manualShowRir || manualRows.some(r => Boolean(r.rir?.trim())));

      const plan = existingMatch
        ? mergeUpdatedWorksheetIntoPlan(existingMatch, {
            title: manualTitle.trim(),
            description: description.trim() !== '' ? description : existingMatch.description,
            instructions: instructions.trim() !== '' ? instructions : existingMatch.instructions,
            defaultWeightUnit: weightUnit,
            weeks,
            hasRpeColumn: manualHasRpe,
            hasRirColumn: manualHasRir,
            exercises: manualRows,
            importSheetData,
            replaceExistingWeekLogs,
            sourceFileName: fileName || existingMatch.sourceFileName,
          })
        : buildWorkoutPlan({
            ownerUsername,
            title: manualTitle.trim(),
            description,
            instructions,
            defaultWeightUnit: weightUnit,
            weeks,
            hasRpeColumn: manualHasRpe,
            hasRirColumn: manualHasRir,
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

  const mergePreviewSummary = useMemo(() => {
    if (!selectedExistingPlan) return null;
    const incoming = isMultiSheetMode
      ? consolidateMultiTabWorkoutSheets(
          sheets
            .filter(s => s.role === 'workout' && s.exercises.length > 0)
            .map(s => ({
              name: s.name,
              customTitle: s.customTitle,
              exercises: getFilteredExercisesForSheet(s),
              detectedDataWeeks: s.detectedDataWeeks,
            }))
        ).exercises
      : manualRows;
    if (incoming.length === 0) return null;

    const existing = selectedExistingPlan.exercises || [];
    const matchedIds = new Set<string>();
    let updatedCount = 0;
    let addedCount = 0;

    for (const row of incoming) {
      const rName = (row.name || '').trim().toLowerCase();
      const rDay = (row.day || '').trim().toLowerCase();
      const match =
        existing.find(e => !matchedIds.has(e.id) && (e.name || '').trim().toLowerCase() === rName && (e.day || '').trim().toLowerCase() === rDay) ||
        existing.find(e => !matchedIds.has(e.id) && (e.name || '').trim().toLowerCase() === rName);
      if (match) {
        matchedIds.add(match.id);
        updatedCount++;
      } else {
        addedCount++;
      }
    }

    const removedCount = existing.filter(e => !matchedIds.has(e.id)).length;
    const preservedLoggedCount = existing.filter(e => {
      if (!matchedIds.has(e.id)) return false;
      return Object.values(selectedExistingPlan.exerciseLogs || {}).some(wkMap => Boolean(wkMap?.[e.id]));
    }).length;

    return {
      updatedCount,
      addedCount,
      removedCount,
      preservedLoggedCount,
      warmupCount: (selectedExistingPlan.warmupExercises || []).length,
    };
  }, [selectedExistingPlan, isMultiSheetMode, sheets, manualRows]);

  const activeDaySet = new Set(activeSheet?.selectedDays || []);

  return (
    <div className="space-y-4">
      {/* Standard Uploaded Sheet Format Guide + 1-Click Template Download */}
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-200 flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5 text-red-400 shrink-0" />
            Standard Sheet Column Layout
          </div>
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            <strong className="text-white">Col 1:</strong> Day ·{' '}
            <strong className="text-white">Col 2:</strong> Exercises ·{' '}
            <strong className="text-white">Col 3:</strong> Sets ·{' '}
            <strong className="text-white">Col 4:</strong> Reps ·{' '}
            <strong className="text-white">Col 5:</strong> RPE ·{' '}
            <strong className="text-white">Col 6:</strong> RIR / RIP ·{' '}
            <strong className="text-white">Col 7:</strong> Weight ({weightUnit}) ·{' '}
            <strong className="text-white">Col 8:</strong> Actual Reps ·{' '}
            <strong className="text-white">Col 9:</strong> Notes ·{' '}
            <strong className="text-white">Col 10:</strong> Video URL
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadStandardWorkoutTemplateExcel(weightUnit)}
          className="h-9 px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-bold text-white inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-red-400" />
          Download Standard Template (.xlsx)
        </button>
      </div>

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
              placeholder="Add day header (e.g. Day 1, Day 2, Day 3)"
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
            placeholder="e.g. 4-Week Program — Phase 1"
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

      {/* Save Destination: Auto-Match / Update Current Workout / Create New (preserving saved logs & history) */}
      {candidateExistingPlans.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-emerald-300 font-bold">
              Upload Mode — Auto-Update Current Workout or Create New
            </span>
            {autoMatchReason && selectedExistingPlan && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                {autoMatchReason}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyUploadTargetMode('smart')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                uploadTargetMode === 'smart'
                  ? 'bg-emerald-600/85 text-white border-emerald-400'
                  : 'bg-neutral-950 text-neutral-300 border-white/10 hover:border-emerald-500/40'
              }`}
            >
              Auto-Match Uploaded Sheet
            </button>
            {currentWorkoutPlan && (
              <button
                type="button"
                onClick={() => applyUploadTargetMode('update_current')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors truncate max-w-full ${
                  uploadTargetMode === 'update_current' || (selectedExistingPlan?.id === currentWorkoutPlan.id && uploadTargetMode !== 'create_new')
                    ? 'bg-emerald-600/85 text-white border-emerald-400'
                    : 'bg-neutral-950 text-neutral-300 border-white/10 hover:border-emerald-500/40'
                }`}
              >
                Update Current: {currentWorkoutPlan.title}
              </button>
            )}
            <button
              type="button"
              onClick={() => applyUploadTargetMode('create_new')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                uploadTargetMode === 'create_new'
                  ? 'bg-red-600/85 text-white border-red-400'
                  : 'bg-neutral-950 text-neutral-300 border-white/10 hover:border-red-500/40'
              }`}
            >
              Create as New Plan
            </button>
          </div>

          <select
            value={targetPlanIdToUpdate}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                applyUploadTargetMode('create_new');
              } else {
                setUploadTargetMode('update_current');
                selectTargetPlanToUpdate(val, 'Selected existing workout plan');
              }
            }}
            className="w-full bg-neutral-950 border border-emerald-500/30 focus:border-emerald-400 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none"
          >
            <option value="">Create as a New Workout Plan</option>
            {candidateExistingPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {currentWorkoutPlan?.id === p.id ? '[Current] ' : ''}Update existing: {p.title} ({p.exercises.length} exercises, {p.weeks}w — keeps saved data)
              </option>
            ))}
          </select>

          {selectedExistingPlan && mergePreviewSummary && (
            <div className="rounded-xl bg-black/40 border border-emerald-500/20 px-3 py-2 text-[11px] text-emerald-100 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
              <span className="font-sans font-semibold text-emerald-300">Merge preview:</span>
              <span>{mergePreviewSummary.updatedCount} matched</span>
              {mergePreviewSummary.preservedLoggedCount > 0 && (
                <span className="text-sky-300">{mergePreviewSummary.preservedLoggedCount} with saved logs preserved</span>
              )}
              {mergePreviewSummary.addedCount > 0 && (
                <span className="text-emerald-300">+{mergePreviewSummary.addedCount} new</span>
              )}
              {mergePreviewSummary.removedCount > 0 && (
                <span className="text-amber-300">-{mergePreviewSummary.removedCount} removed</span>
              )}
              {mergePreviewSummary.warmupCount > 0 && (
                <span className="text-amber-200">{mergePreviewSummary.warmupCount} warm-ups kept</span>
              )}
            </div>
          )}
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

      {/* UPLOADED SHEET COLUMNS & MISSING COLUMN ASSIGNMENT */}
      {isMultiSheetMode && activeSheet && activeSheetIndex >= 0 && (
        <div
          className={`rounded-2xl border p-4 space-y-3 ${
            activeSheet.missingRequiredColumns.length > 0 || !activeSheet.headerMatched
              ? 'border-amber-500/45 bg-amber-950/15'
              : 'border-white/10 bg-neutral-900/60'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Columns3
                  className={`w-4 h-4 shrink-0 ${
                    activeSheet.missingRequiredColumns.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                />
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                  Uploaded Sheet Columns ({activeSheet.detectedColumns.length} found in &ldquo;{activeSheet.name}&rdquo;)
                </h4>
                {activeSheet.missingRequiredColumns.length > 0 ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-200">
                    Missing {activeSheet.missingRequiredColumns.length} required column{activeSheet.missingRequiredColumns.length === 1 ? '' : 's'} — Assign below
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Core Columns Matched
                  </span>
                )}
              </div>
              {activeSheet.detectedColumns.length > 0 && (
                <p className="text-[11px] text-neutral-400 truncate">
                  Sheet headers:{' '}
                  <span className="text-neutral-200 font-mono">
                    {activeSheet.detectedColumns.map(c => `${c.columnLetter}: "${c.headerName}"`).join(' · ')}
                  </span>
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowColumnMapperPanel(v => !v)}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-bold text-neutral-200 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {showColumnMapperPanel ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" /> Hide Column Mapper
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" /> Assign / Inspect Columns
                </>
              )}
            </button>
          </div>

          {/* Highlighted Missing Required Columns Quick-Assigner (always visible when any required column is missing) */}
          {activeSheet.missingRequiredColumns.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-black/40 p-3 space-y-2.5">
              <div className="text-[11px] font-semibold text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Assign the missing column(s) below using the columns found in your uploaded sheet:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {activeSheet.missingRequiredColumns.map((missingKey) => {
                  const meta = FIELD_META[missingKey];
                  const assignedCol = activeSheet.detectedColumns.find(
                    c => c.assignedRole === meta.role || (missingKey !== 'name' && c.assignedRole === 'setsReps')
                  );
                  return (
                    <label key={missingKey} className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-amber-100">
                        Missing: {meta.label} *
                      </span>
                      <select
                        value={assignedCol ? String(assignedCol.colIdx) : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') return;
                          assignMissingFieldToColumn(activeSheetIndex, meta.role, Number(val));
                        }}
                        className="bg-neutral-950 border border-amber-500/40 focus:border-amber-400 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                      >
                        <option value="">— Select sheet column for {meta.label} —</option>
                        {activeSheet.detectedColumns.map((col) => (
                          <option key={col.colIdx} value={String(col.colIdx)}>
                            Col {col.columnLetter}: {col.headerName}
                            {col.sampleValues.length > 0 ? ` (e.g. "${col.sampleValues[0].slice(0, 28)}")` : ''}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-neutral-400">{meta.hint}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Full Column Names & Mapping Panel */}
          {showColumnMapperPanel && (
            <div className="rounded-xl border border-white/10 bg-black/45 p-3 space-y-3">
              {/* Header row selector */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                <span className="text-[11px] text-neutral-300 font-semibold">
                  Which row in &ldquo;{activeSheet.name}&rdquo; contains your column headers?
                </span>
                <select
                  value={String(activeSheet.headerRowIndex)}
                  onChange={(e) => {
                    const nextHdr = Number(e.target.value);
                    applySheetColumnOverride(activeSheetIndex, nextHdr, activeSheet.columnAssignments);
                  }}
                  className="bg-neutral-950 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white outline-none"
                >
                  <option value="-1">No Header Row (Start from Row 1)</option>
                  {activeSheet.rawRows.slice(0, 12).map((rowCells, rIdx) => {
                    const preview = rowCells.filter(Boolean).slice(0, 4).join(' | ');
                    return (
                      <option key={rIdx} value={String(rIdx)}>
                        Row {rIdx + 1}{preview ? `: ${preview.slice(0, 55)}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Optional Missing Columns Quick-Assigner (Weight, Actual Reps, RPE, RIP/RIR, Notes, Video URL) */}
              {activeSheet.missingOptionalColumns.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">
                    Optional / Data Columns Not Yet Assigned (Assign if your sheet uses custom names)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {activeSheet.missingOptionalColumns.map((optKey) => {
                      const meta = FIELD_META[optKey];
                      const currentCol = activeSheet.detectedColumns.find(c => c.assignedRole === meta.role);
                      return (
                        <div key={optKey} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-900/70 border border-white/10 px-2.5 py-1.5">
                          <span className="text-[11px] font-semibold text-neutral-300 shrink-0">{meta.label}</span>
                          <select
                            value={currentCol ? String(currentCol.colIdx) : ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              assignMissingFieldToColumn(activeSheetIndex, meta.role, val === '' ? -1 : Number(val));
                            }}
                            className="bg-neutral-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none max-w-[170px]"
                          >
                            <option value="">Not in sheet</option>
                            {activeSheet.detectedColumns.map((col) => (
                              <option key={col.colIdx} value={String(col.colIdx)}>
                                Col {col.columnLetter}: {col.headerName}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All Uploaded Columns Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="py-1.5 pr-3">Col</th>
                      <th className="py-1.5 pr-3">Uploaded Sheet Column Name</th>
                      <th className="py-1.5 pr-3">Sample Data</th>
                      <th className="py-1.5">Assigned Workout Field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(() => {
                      const roleOptions = buildColumnRoleOptions(Math.max(weeks, activeSheet.detectedDataWeeks || 0, 8));
                      return activeSheet.detectedColumns.map((col) => {
                        const assigned = activeSheet.columnAssignments[col.colIdx] ?? col.assignedRole;
                        const hasOption = roleOptions.some(o => o.value === assigned);
                        return (
                          <tr key={col.colIdx} className="hover:bg-white/[0.02]">
                            <td className="py-1.5 pr-3 font-mono text-[11px] text-neutral-400">
                              {col.columnLetter}
                            </td>
                            <td className="py-1.5 pr-3 font-semibold text-white">
                              {col.headerName}
                            </td>
                            <td className="py-1.5 pr-3 text-[11px] text-neutral-400 font-mono max-w-[200px] truncate">
                              {col.sampleValues.length > 0 ? col.sampleValues.join(' · ') : '—'}
                            </td>
                            <td className="py-1.5">
                              <select
                                value={assigned}
                                onChange={(e) => {
                                  const nextRole = e.target.value as ManualColumnMappingRole;
                                  assignMissingFieldToColumn(activeSheetIndex, nextRole, col.colIdx);
                                }}
                                className={`bg-neutral-950 border rounded-lg px-2 py-1 text-[11px] font-semibold outline-none ${
                                  assigned === 'ignore'
                                    ? 'border-white/10 text-neutral-400'
                                    : 'border-emerald-500/40 text-emerald-200'
                                }`}
                              >
                                {!hasOption && (
                                  <option value={assigned}>{assigned.replace('_', ' ').toUpperCase()}</option>
                                )}
                                {roleOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PRE-FILLED DATA NOTICE & TOGGLE */}
      {(() => {
        const rowsToCheck = isMultiSheetMode
          ? sheets.filter(s => s.role === 'workout').flatMap(s => s.exercises)
          : displayedRows;
        const prefilledExercises = rowsToCheck.filter(
          r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed
        );
        if (prefilledExercises.length === 0) return null;

        const detectedWeekNums = new Set<number>();
        sheets.forEach((s) => {
          if (s.role !== 'workout') return;
          const tabWk = extractWeekNumberFromTabName(s.name);
          if (tabWk && s.exercises.some(e => e.weeklyLogs || e.loggedWeight || e.loggedReps || e.completed)) {
            detectedWeekNums.add(tabWk);
          }
          s.exercises.forEach(ex => {
            Object.keys(ex.weeklyLogs || {}).forEach(k => {
              const n = Number(k);
              if (n >= 1 && n <= 52) detectedWeekNums.add(n);
            });
          });
        });
        const sortedWeeks = Array.from(detectedWeekNums).sort((a, b) => a - b);

        return (
        <div className="rounded-2xl border border-indigo-500/35 bg-indigo-950/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-indigo-100 space-y-0.5">
            <p className="font-bold text-indigo-200 flex flex-wrap items-center gap-2">
              <span>
                Pre-filled training data detected ({prefilledExercises.length} exercises)
              </span>
              {sortedWeeks.length > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/25 border border-indigo-400/40 text-indigo-100">
                  Weeks: {sortedWeeks.map(w => `W${w}`).join(', ')}
                </span>
              )}
            </p>
            <p className="text-[11px] text-indigo-300/85">
              Weights, kg/lbs units, actual reps, Week 1..N logs, Set 1..N data, RPE/RIP, and Done flags import automatically into your weekly history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-white bg-black/40 border border-indigo-400/30 rounded-xl px-3 py-1.5 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={importSheetData}
                onChange={(e) => setImportSheetData(e.target.checked)}
                className="accent-indigo-500 w-4 h-4 cursor-pointer"
              />
              Import sheet weights &amp; weeks
            </label>
            {selectedExistingPlan && importSheetData && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-200 bg-black/40 border border-amber-400/30 rounded-xl px-3 py-1.5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={replaceExistingWeekLogs}
                  onChange={(e) => setReplaceExistingWeekLogs(e.target.checked)}
                  className="accent-amber-500 w-4 h-4 cursor-pointer"
                />
                Overwrite existing week logs from sheet
              </label>
            )}
          </div>
        </div>
        );
      })()}

      {/* Preview / editor */}
      {displayedRows.length > 0 && (() => {
        const showRpeCol = isMultiSheetMode
          ? Boolean(
              activeSheet?.hasRpeColumn ||
                displayedRows.some(
                  r =>
                    Boolean(r.rpe?.trim()) ||
                    Object.values(r.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rpe?.trim())))
                )
            )
          : Boolean(manualShowRpe || displayedRows.some(r => Boolean(r.rpe?.trim())));

        const showRirCol = isMultiSheetMode
          ? Boolean(
              activeSheet?.hasRirColumn ||
                displayedRows.some(
                  r =>
                    Boolean(r.rir?.trim()) ||
                    Object.values(r.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rir?.trim())))
                )
            )
          : Boolean(manualShowRir || displayedRows.some(r => Boolean(r.rir?.trim())));

        return (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/60 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-white/10">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-red-500" />
              {activeSheet ? `${activeSheet.name}: ` : ''}
              {displayedRows.length} exercise{displayedRows.length === 1 ? '' : 's'} detected
            </span>
            <div className="flex items-center gap-2">
              {!isMultiSheetMode && (
                <>
                  <button
                    type="button"
                    onClick={() => setManualShowRpe(v => !v)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border cursor-pointer ${
                      showRpeCol
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                        : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {showRpeCol ? '✓ RPE Col' : '+ RPE Col'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualShowRir(v => !v)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border cursor-pointer ${
                      showRirCol
                        ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                        : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {showRirCol ? '✓ RIR / RIP Col' : '+ RIR / RIP Col'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={addRow}
                className="text-[11px] font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add row
              </button>
            </div>
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
                  {showRpeCol && <th className="px-2 py-2 font-semibold w-20 text-amber-300">RPE</th>}
                  {showRirCol && <th className="px-2 py-2 font-semibold w-20 text-sky-300">RIR / RIP</th>}
                  {displayedRows.some(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed) && (
                    <th className="px-2 py-2 font-semibold w-52 text-indigo-300">Prefilled Sheet Data</th>
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

                      {/* Sheet RPE (Conditional) */}
                      {showRpeCol && (
                        <td className="px-1 py-1">
                          <input
                            value={row.rpe || ''}
                            onChange={(e) => updateRow(idx, 'rpe', e.target.value)}
                            placeholder="—"
                            aria-label={`Target RPE for ${row.name || `row ${idx + 1}`}`}
                            className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-amber-500/50 rounded-lg px-2 py-1.5 text-[12px] text-amber-200 font-mono outline-none"
                          />
                        </td>
                      )}

                      {/* Sheet RIR (Conditional) */}
                      {showRirCol && (
                        <td className="px-1 py-1">
                          <input
                            value={row.rir || ''}
                            onChange={(e) => updateRow(idx, 'rir', e.target.value)}
                            placeholder="—"
                            aria-label={`Target RIR for ${row.name || `row ${idx + 1}`}`}
                            className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-sky-500/50 rounded-lg px-2 py-1.5 text-[12px] text-sky-200 font-mono outline-none"
                          />
                        </td>
                      )}

                      {/* Prefilled Sheet Data Chips */}
                      {displayedRows.some(r => r.weeklyLogs || r.loggedWeight || r.loggedReps || r.completed) && (
                        <td className="px-1.5 py-1">
                          <div className="flex flex-wrap gap-1">
                            {row.weeklyLogs ? (
                              Object.entries(row.weeklyLogs)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([wkKey, wData]) => {
                                  const first = wData.entries.find(e => e.weight || e.reps || e.rpe || e.rir);
                                  const wkLabel = Number(wkKey) === 0 ? 'Prev' : `W${wkKey}`;
                                  const unitLbl = first?.unit || wData.unit || weightUnit;
                                  const rpes = Array.from(
                                    new Set(wData.entries.map(e => (e.rpe || '').trim()).filter(Boolean))
                                  );
                                  const rirs = Array.from(
                                    new Set(wData.entries.map(e => (e.rir || '').trim()).filter(Boolean))
                                  );
                                  const rpePart = rpes.length > 0 ? ` RPE ${rpes.join('/')}` : '';
                                  const rirPart = rirs.length > 0 ? ` RIR ${rirs.join('/')}` : '';
                                  return (
                                    <span
                                      key={wkKey}
                                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/30 text-indigo-200 whitespace-nowrap"
                                    >
                                      {wkLabel}:{' '}
                                      {first
                                        ? `${first.weight || '—'}${first.weight && first.weight !== 'BW' ? unitLbl : ''}×${first.reps || '—'}${rpePart}${rirPart}`
                                        : wData.completed
                                        ? 'Done ✓'
                                        : 'Logged'}
                                    </span>
                                  );
                                })
                            ) : row.loggedWeight || row.loggedReps || row.rpe || row.rir ? (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/30 text-indigo-200">
                                {row.loggedWeight || '—'}{row.loggedWeight ? (row.loggedUnit || weightUnit) : ''}×{row.loggedReps || '—'}{row.rpe ? ` RPE ${row.rpe}` : ''}{row.rir ? ` RIR ${row.rir}` : ''}
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
        );
      })()}

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
