import {
  ExerciseLogEntry,
  SetLogEntry,
  WeightUnit,
  WorkoutExercise,
  WorkoutPlan,
} from '../types';
import { parseSetsCount, splitSetsAndReps } from './sheetParser';

const weekKey = (weekIdx: number) => `w${weekIdx + 1}`;

export interface ExportWorkoutExcelOptions {
  ownerName?: string;
  waterGlasses?: number;
}

function getTargetText(ex: WorkoutExercise): { setsDisplay: string; repsDisplay: string } {
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

function entryHasData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (
    entry.setEntries &&
    entry.setEntries.some(
      s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
    )
  ) {
    return true;
  }
  return Boolean(entry.weight?.trim() || entry.reps?.trim() || entry.sets?.trim() || entry.notes?.trim());
}

function resolveSetList(
  ex: WorkoutExercise,
  entry: ExerciseLogEntry,
  fallbackUnit: WeightUnit
): SetLogEntry[] {
  if (entry.setEntries && entry.setEntries.length > 0) {
    const populated = entry.setEntries.filter(
      s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
    );
    if (populated.length > 0) {
      return populated.map((s) => ({
        ...s,
        unit: s.unit || entry.unit || fallbackUnit,
      }));
    }
  }
  if (entry.weight?.trim() || entry.reps?.trim()) {
    return [
      {
        setNumber: 1,
        weight: entry.weight || '',
        unit: entry.unit || fallbackUnit,
        reps: entry.reps || '',
      },
    ];
  }
  const count = parseSetsCount(ex.sets);
  return Array.from({ length: count }, (_, idx) => ({
    setNumber: idx + 1,
    weight: '',
    unit: entry.unit || fallbackUnit,
    reps: '',
    rpe: '',
  }));
}

function summarizeWeekMetrics(
  ex: WorkoutExercise,
  entry: ExerciseLogEntry | undefined,
  fallbackUnit: WeightUnit
): {
  weightSummary: string;
  repsSummary: string;
  rpeSummary: string;
  setBreakdown: string;
  weekVolume: number;
} {
  if (!entry || !entryHasData(entry)) {
    return { weightSummary: '', repsSummary: '', rpeSummary: '', setBreakdown: '', weekVolume: 0 };
  }
  const list = resolveSetList(ex, entry, fallbackUnit).filter(
    s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
  );
  if (list.length === 0) {
    return { weightSummary: '', repsSummary: '', rpeSummary: '', setBreakdown: '', weekVolume: 0 };
  }

  const weights = list.map(s => (s.weight || '').trim()).filter(Boolean);
  const repsList = list.map(s => (s.reps || '').trim()).filter(Boolean);
  const rpes = list.map(s => (s.rpe || '').trim()).filter(Boolean);

  const uniqueWeights = Array.from(new Set(weights));
  const uniqueReps = Array.from(new Set(repsList));

  const numericRpes = rpes.map(r => parseFloat(r)).filter(n => Number.isFinite(n));
  const rpeSummary =
    numericRpes.length > 0
      ? numericRpes.length === 1
        ? String(numericRpes[0])
        : numericRpes.reduce((a, b) => a + b, 0) / numericRpes.length > 0
        ? (numericRpes.reduce((a, b) => a + b, 0) / numericRpes.length).toFixed(1).replace(/\.0$/, '')
        : rpes.join(', ')
      : rpes.join(', ');

  let weekVolume = 0;
  const setBreakdown = list
    .map((s) => {
      const wt = (s.weight || '').trim();
      const rp = (s.reps || '').trim();
      const rpe = (s.rpe || '').trim();
      const unit = s.unit || entry.unit || fallbackUnit;
      const wNum = parseFloat(wt);
      const rNum = parseFloat(rp);
      if (Number.isFinite(wNum) && Number.isFinite(rNum) && wNum > 0 && rNum > 0) {
        weekVolume += wNum * rNum;
      }
      const wtPart = wt ? (wt.toUpperCase() === 'BW' ? 'BW' : `${wt} ${unit}`) : '-';
      const rpPart = rp || '-';
      const rpePart = rpe ? ` (RPE ${rpe})` : '';
      return `Set ${s.setNumber}: ${wtPart} x ${rpPart}${rpePart}`;
    })
    .join('\n');

  return {
    weightSummary: uniqueWeights.length === 1 ? uniqueWeights[0] : weights.join(' / '),
    repsSummary: uniqueReps.length === 1 ? uniqueReps[0] : repsList.join(' / '),
    rpeSummary,
    setBreakdown,
    weekVolume: Math.round(weekVolume * 100) / 100,
  };
}

function calcVolume(weight?: string, reps?: string): string | number {
  const w = parseFloat((weight || '').trim());
  const r = parseFloat((reps || '').trim());
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return '';
  return Math.round(w * r * 100) / 100;
}

function computeColWidths(rows: Array<Array<string | number>>, minWidth = 10, maxWidth = 44) {
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: colCount }, (_, colIdx) => {
    let widest = minWidth;
    rows.forEach((r) => {
      const val = r[colIdx] !== undefined && r[colIdx] !== null ? String(r[colIdx]) : '';
      val.split('\n').forEach((line) => {
        if (line.length + 3 > widest) widest = line.length + 3;
      });
    });
    return { wch: Math.min(maxWidth, widest) };
  });
}

function formatWarmupSummaryTarget(wu: { minutes?: string; targetSets?: string; target?: string }): string {
  const parts: string[] = [];
  if (wu.minutes?.trim()) parts.push(`${wu.minutes.trim()} min`);
  if (wu.targetSets?.trim()) parts.push(`${wu.targetSets.trim()} sets`);
  if (wu.target?.trim()) parts.push(wu.target.trim());
  return parts.join(' | ');
}

function normalizeDayKey(day?: string): string {
  const d = (day || '').trim();
  return d ? d : 'General Workout';
}

/**
 * Recreated 5-sheet .xlsx workbook designed for clarity, day-grouped coaching readability,
 * analytics, and seamless re-import compatibility with sheetParser.ts:
 *  1. Workout Sheet       (Banner + KPIs + 2-row Week Super-Headers + Day-grouped rows + Target RPE + Set Details)
 *  2. Daily Analytics     (Day x Week completion, sets logged, avg RPE, volume & session notes)
 *  3. Set-by-Set Log      (Flat filterable ledger across Warm-up & Main Workout + RPE + Volume)
 *  4. Warm-up & Hydration (Dedicated warm-up duration/sets/logs + daily water intake summary)
 *  5. Notes & Instructions(Instructions, Description, Exercise Week Notes & Session Feedback)
 */
export async function buildWorkoutPlanExcelWorkbook(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<{ wb: any; filename: string; XLSX: any }> {
  const XLSX: any = await import('xlsx');

  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = plan.exercises || [];
  const warmupExercises = plan.warmupExercises || [];
  const loggedWeeks = plan.exerciseLogs || {};

  // Discover max week index present across plan & logs
  let totalWeekColumns = weeks;
  Object.keys(loggedWeeks).forEach((k) => {
    const m = k.match(/^w(\d+)$/i);
    if (m) totalWeekColumns = Math.max(totalWeekColumns, parseInt(m[1], 10));
  });
  Object.keys(plan.warmupLogs || {}).forEach((k) => {
    const m = k.match(/^w(\d+)$/i);
    if (m) totalWeekColumns = Math.max(totalWeekColumns, parseInt(m[1], 10));
  });

  // Group exercises into ordered Days
  const dayOrder: string[] = [];
  const dayExercisesMap = new Map<string, Array<{ ex: WorkoutExercise; globalIdx: number }>>();
  exercises.forEach((ex, idx) => {
    const dKey = normalizeDayKey(ex.day);
    if (!dayExercisesMap.has(dKey)) {
      dayOrder.push(dKey);
      dayExercisesMap.set(dKey, []);
    }
    dayExercisesMap.get(dKey)!.push({ ex, globalIdx: idx });
  });

  let totalDone = 0;
  const totalPossible = exercises.length * weeks;
  for (let w = 0; w < weeks; w++) {
    totalDone += (plan.progress?.[weekKey(w)] || []).length;
  }
  const overallPct = totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0;

  let grandTotalVolume = 0;
  const weeklyVolumeTotals: Record<number, number> = {};

  for (let w = 1; w <= totalWeekColumns; w++) {
    const wk = weekKey(w - 1);
    exercises.forEach((ex) => {
      const metrics = summarizeWeekMetrics(ex, loggedWeeks[wk]?.[ex.id], planUnit);
      if (metrics.weekVolume > 0) {
        weeklyVolumeTotals[w] = (weeklyVolumeTotals[w] || 0) + metrics.weekVolume;
        grandTotalVolume += metrics.weekVolume;
      }
    });
  }

  // =========================================================================
  // SHEET 1: WORKOUT SHEET (BY DAY — Banner + Week Super-Headers + Clean Columns)
  // Row indices: 0 = Banner, 1 = Meta Strip, 2 = Spacer, 3 = Super-Header, 4 = Header (scan-friendly <= row 15)
  // =========================================================================
  const fixedColCount = 9; // #, Day, Type, Exercise, Sets, Reps, Target RPE, Coach Notes, Video
  const weekGroupCols = 6; // Done, Weight, Reps, RPE, Set Breakdown, Notes
  const totalSheet1Cols = fixedColCount + totalWeekColumns * weekGroupCols;

  const sheet1Merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  const sheet1RowHeights: Array<{ hpt?: number } | undefined> = [];

  // Row 0: Banner
  const titleRow: Array<string | number> = [`GYM WORKOUT  —  ${plan.title || 'Training Plan'}`];
  while (titleRow.length < totalSheet1Cols) titleRow.push('');
  sheet1Merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(8, fixedColCount - 1) } });
  sheet1RowHeights[0] = { hpt: 28 };

  // Row 1: Meta strip
  const metaRow: Array<string | number> = [
    'Athlete',
    options.ownerName || plan.ownerUsername || 'Athlete',
    'Unit',
    planUnit.toUpperCase(),
    'Program',
    `${dayOrder.length} Days / ${weeks} Weeks`,
    'Completion',
    `${overallPct}% (${totalDone}/${totalPossible})`,
    grandTotalVolume > 0
      ? `Total Volume: ${Math.round(grandTotalVolume)} ${planUnit}`
      : `Water Today: ${typeof options.waterGlasses === 'number' ? `${options.waterGlasses}/8` : '—'}`,
  ];
  while (metaRow.length < totalSheet1Cols) metaRow.push('');
  sheet1RowHeights[1] = { hpt: 20 };

  // Row 2: Spacer
  const spacerRow: Array<string | number> = [''];
  sheet1RowHeights[2] = { hpt: 8 };

  // Row 3: Super-Header (Program Specification | Week 1 | Week 2 | ...)
  const superHeaderRow: Array<string | number> = ['Program Specification'];
  for (let c = 1; c < fixedColCount; c++) superHeaderRow.push('');
  sheet1Merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: fixedColCount - 1 } });

  for (let w = 1; w <= totalWeekColumns; w++) {
    const startCol = fixedColCount + (w - 1) * weekGroupCols;
    superHeaderRow.push(`Week ${w} Performance`);
    for (let k = 1; k < weekGroupCols; k++) superHeaderRow.push('');
    sheet1Merges.push({ s: { r: 3, c: startCol }, e: { r: 3, c: startCol + weekGroupCols - 1 } });
  }
  sheet1RowHeights[3] = { hpt: 22 };

  // Row 4: Main Table Header (Explicit re-import compatible headers!)
  const planHeaders: string[] = [
    '#',
    'Day',
    'Type',
    'Exercise',
    'Sets',
    'Reps',
    'Target RPE',
    'Coach Notes',
    'Video',
  ];
  for (let w = 1; w <= totalWeekColumns; w++) {
    planHeaders.push(
      `Week ${w} Done`,
      `Week ${w} Weight (${planUnit})`,
      `Week ${w} Reps`,
      `Week ${w} RPE`,
      `Week ${w} Set Breakdown`,
      `Week ${w} Notes`
    );
  }
  sheet1RowHeights[4] = { hpt: 22 };

  const planRows: Array<Array<string | number>> = [
    titleRow,
    metaRow,
    spacerRow,
    superHeaderRow,
    planHeaders,
  ];

  dayOrder.forEach((dayName) => {
    const dayItems = dayExercisesMap.get(dayName) || [];
    // Single-cell Day Banner Row (visually clear + recognized cleanly as Day Header by sheetParser!)
    const dayBannerIdx = planRows.length;
    planRows.push([dayName]);
    sheet1Merges.push({ s: { r: dayBannerIdx, c: 0 }, e: { r: dayBannerIdx, c: fixedColCount - 1 } });
    sheet1RowHeights[dayBannerIdx] = { hpt: 22 };

    dayItems.forEach(({ ex, globalIdx }) => {
      const { setsDisplay, repsDisplay } = getTargetText(ex);
      const typeCell = ex.isSuperset
        ? ex.supersetGroup && ex.supersetGroup.trim()
          ? `Superset (${ex.supersetGroup.trim()})`
          : 'Superset'
        : 'Standard';

      const row: Array<string | number> = [
        globalIdx + 1,
        ex.day || dayName,
        typeCell,
        ex.name || '',
        setsDisplay || '',
        repsDisplay || '',
        ex.targetRpe || '',
        ex.notes || '',
        ex.videoUrl || '',
      ];

      let maxLinesInRow = 1;
      for (let w = 1; w <= totalWeekColumns; w++) {
        const wKey = weekKey(w - 1);
        const entry = loggedWeeks[wKey]?.[ex.id];
        const metrics = summarizeWeekMetrics(ex, entry, planUnit);
        const isDone = (plan.progress?.[wKey] || []).includes(ex.id) ? 'Yes' : 'No';
        const exWeekNote = entry?.notes?.trim() || '';
        const lineCount = metrics.setBreakdown ? metrics.setBreakdown.split('\n').length : 1;
        if (lineCount > maxLinesInRow) maxLinesInRow = lineCount;

        row.push(
          isDone,
          metrics.weightSummary,
          metrics.repsSummary,
          metrics.rpeSummary,
          metrics.setBreakdown,
          exWeekNote
        );
      }

      const rIdx = planRows.length;
      planRows.push(row);
      sheet1RowHeights[rIdx] = { hpt: Math.max(20, maxLinesInRow * 14 + 4) };
    });
  });

  const planSheet = XLSX.utils.aoa_to_sheet(planRows);
  planSheet['!merges'] = sheet1Merges;
  planSheet['!rows'] = sheet1RowHeights;
  planSheet['!cols'] = computeColWidths(planRows.slice(3), 10, 40);
  if (planHeaders.length > 0 && planRows.length > 5) {
    planSheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 4, c: 0 },
        e: { r: planRows.length - 1, c: planHeaders.length - 1 },
      }),
    };
  }

  // =========================================================================
  // SHEET 2: DAILY ANALYTICS (Day x Week Breakdown + Completion + Volume + RPE)
  // =========================================================================
  const analyticsRows: Array<Array<string | number>> = [
    [`Daily & Weekly Training Analytics  —  ${plan.title || 'Workout Plan'}`, '', '', '', '', '', '', '', ''],
    ['Member', options.ownerName || plan.ownerUsername || 'Athlete', 'Overall Progress', `${overallPct}% (${totalDone}/${totalPossible})`, 'Total Volume', grandTotalVolume > 0 ? `${Math.round(grandTotalVolume)} ${planUnit}` : `0 ${planUnit}`, 'Water Intake Today', typeof options.waterGlasses === 'number' ? `${options.waterGlasses} glasses` : '—', ''],
    ['', '', '', '', '', '', '', '', ''],
    [
      'Training Day',
      'Week',
      'Exercises Done',
      'Day Exercises',
      'Completion %',
      'Sets Logged',
      'Avg RPE',
      `Day Volume (${planUnit})`,
      'Day Session Feedback',
    ],
  ];

  dayOrder.forEach((dayName) => {
    const dayItems = dayExercisesMap.get(dayName) || [];
    for (let w = 1; w <= totalWeekColumns; w++) {
      const wKey = weekKey(w - 1);
      const doneSet = new Set(plan.progress?.[wKey] || []);
      let doneInDay = 0;
      let setsLogged = 0;
      let dayVol = 0;
      const rpeNums: number[] = [];

      dayItems.forEach(({ ex }) => {
        if (doneSet.has(ex.id)) doneInDay++;
        const entry = loggedWeeks[wKey]?.[ex.id];
        if (entryHasData(entry)) {
          const list = resolveSetList(ex, entry!, planUnit).filter(
            s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
          );
          setsLogged += list.length;
          list.forEach((s) => {
            const rVal = parseFloat((s.rpe || '').trim());
            if (Number.isFinite(rVal)) rpeNums.push(rVal);
            const v = calcVolume(s.weight, s.reps);
            if (typeof v === 'number') dayVol += v;
          });
        }
      });

      // Find day-specific session note for this week
      let sessionFeedback = '';
      Object.entries(loggedWeeks[wKey] || {}).forEach(([k, val]) => {
        if (!k.startsWith('__session_note__') || !val?.notes?.trim()) return;
        const scope =
          val.day?.trim() ||
          (k === '__session_note__ALL' ? 'All Days' : k.replace(/^__session_note__/, '').replace(/_/g, ' '));
        if (scope.toLowerCase() === dayName.toLowerCase()) {
          sessionFeedback = val.notes.trim();
        }
      });

      const pct = dayItems.length > 0 ? Math.round((doneInDay / dayItems.length) * 100) : 0;
      const avgRpeStr =
        rpeNums.length > 0
          ? (rpeNums.reduce((a, b) => a + b, 0) / rpeNums.length).toFixed(1).replace(/\.0$/, '')
          : '—';

      analyticsRows.push([
        dayName,
        `Week ${w}`,
        doneInDay,
        dayItems.length,
        `${pct}%`,
        setsLogged,
        avgRpeStr,
        Math.round(dayVol),
        sessionFeedback,
      ]);
    }
  });

  const analyticsSheet = XLSX.utils.aoa_to_sheet(analyticsRows);
  analyticsSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  analyticsSheet['!rows'] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 8 }, { hpt: 22 }];
  analyticsSheet['!cols'] = computeColWidths(analyticsRows.slice(3), 12, 48);
  analyticsSheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 3, c: 0 },
      e: { r: analyticsRows.length - 1, c: 8 },
    }),
  };

  // =========================================================================
  // SHEET 3: SET-BY-SET LOG (Granular Ledger + RPE + Volume)
  // =========================================================================
  const setHistoryRows: Array<Array<string | number>> = [
    [
      'Week',
      'Category',
      'Day',
      'Exercise',
      'Superset',
      'Set #',
      'Target',
      'Target RPE',
      'Weight',
      'Unit',
      'Reps',
      'Actual RPE',
      'Volume (Wt x Reps)',
      'Done',
      'Exercise Note',
      'Updated At',
    ],
  ];

  for (let w = 1; w <= totalWeekColumns; w++) {
    const wKey = weekKey(w - 1);
    const doneSet = new Set(plan.progress?.[wKey] || []);

    warmupExercises.forEach((wu) => {
      const wLog = plan.warmupLogs?.[wKey]?.[wu.id];
      if (!wLog) return;
      const validSets = (wLog.setEntries || []).filter(
        s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
      );
      validSets.forEach((s) => {
        const vol = calcVolume(s.weight, s.reps);
        setHistoryRows.push([
          `Week ${w}`,
          'Warm-up',
          'Warm-up',
          wu.name || '',
          'No',
          s.setNumber,
          formatWarmupSummaryTarget(wu),
          '',
          s.weight || '',
          s.unit || planUnit,
          s.reps || '',
          s.rpe || '',
          vol,
          wLog.completed ? 'Yes' : 'No',
          wLog.notes || '',
          wLog.updatedAt ? new Date(wLog.updatedAt).toLocaleString() : '',
        ]);
      });
    });

    exercises.forEach((ex) => {
      const entry = loggedWeeks[wKey]?.[ex.id];
      if (!entryHasData(entry)) return;
      const { setsDisplay, repsDisplay } = getTargetText(ex);
      const targetStr = [setsDisplay && `${setsDisplay} sets`, repsDisplay && `${repsDisplay} reps`]
        .filter(Boolean)
        .join(' x ');
      const setsList = resolveSetList(ex, entry!, planUnit).filter(
        s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
      );
      setsList.forEach((s) => {
        const vol = calcVolume(s.weight, s.reps);
        setHistoryRows.push([
          `Week ${w}`,
          'Main Workout',
          ex.day || 'General Workout',
          ex.name || '',
          ex.isSuperset ? (ex.supersetGroup || 'Yes') : 'No',
          s.setNumber,
          targetStr,
          ex.targetRpe || '',
          s.weight || '',
          s.unit || entry?.unit || planUnit,
          s.reps || '',
          s.rpe || '',
          vol,
          doneSet.has(ex.id) ? 'Yes' : 'No',
          entry?.notes?.trim() || '',
          entry?.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '',
        ]);
      });
    });
  }

  if (setHistoryRows.length === 1) {
    setHistoryRows.push(['—', '—', '—', 'No logged sets recorded yet.', '', '', '', '', '', '', '', '', '', '', '', '']);
  }
  const setHistorySheet = XLSX.utils.aoa_to_sheet(setHistoryRows);
  setHistorySheet['!rows'] = [{ hpt: 22 }];
  setHistorySheet['!cols'] = computeColWidths(setHistoryRows, 10, 40);
  setHistorySheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: setHistoryRows.length - 1, c: 15 },
    }),
  };

  // =========================================================================
  // SHEET 4: WARM-UP & HYDRATION
  // =========================================================================
  const warmupRows: Array<Array<string | number>> = [
    [`Warm-up Protocol & Hydration Tracker  —  ${plan.title || 'Workout Plan'}`, '', '', '', '', '', '', '', ''],
    [
      'Daily Water Intake',
      typeof options.waterGlasses === 'number' ? `${options.waterGlasses} / 8 glasses` : 'Not logged',
      'Warm-up Movements',
      warmupExercises.length,
      'Exported Date',
      new Date().toLocaleDateString(),
      '',
      '',
      '',
    ],
    ['', '', '', '', '', '', '', '', ''],
    [
      'Warm-up #',
      'Warm-up Exercise',
      'Duration (Min)',
      'Target Sets',
      'Target Reps / Cue',
      'Week',
      'Completed',
      'Warm-up Sets Summary',
      'Updated At',
    ],
  ];

  if (warmupExercises.length > 0) {
    warmupExercises.forEach((wu, idx) => {
      const durMin = wu.minutes?.trim() || '';
      const tSets = wu.targetSets?.trim() || '';
      const tCue = wu.target?.trim() || '';
      let hasAnyWeek = false;
      for (let w = 1; w <= totalWeekColumns; w++) {
        const wKey = weekKey(w - 1);
        const wLog = plan.warmupLogs?.[wKey]?.[wu.id];
        const validSets = (wLog?.setEntries || []).filter(
          s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '' || (s.rpe || '').trim() !== ''
        );
        if (!wLog?.completed && validSets.length === 0) continue;
        hasAnyWeek = true;
        const setSummary = validSets
          .map((s) => {
            const wt = (s.weight || '').trim();
            const rp = (s.reps || '').trim();
            const rpe = (s.rpe || '').trim();
            const unit = s.unit || planUnit;
            return `S${s.setNumber}: ${wt ? `${wt} ${unit}` : '-'} x ${rp || '-'}${rpe ? ` (RPE ${rpe})` : ''}`;
          })
          .join(' | ');
        warmupRows.push([
          idx + 1,
          wu.name || '',
          durMin ? `${durMin} min` : '',
          tSets || '',
          tCue,
          `Week ${w}`,
          wLog?.completed ? 'Yes' : 'No',
          setSummary || 'Completed',
          wLog?.updatedAt ? new Date(wLog.updatedAt).toLocaleString() : '',
        ]);
      }
      if (!hasAnyWeek) {
        warmupRows.push([
          idx + 1,
          wu.name || '',
          durMin ? `${durMin} min` : '',
          tSets || '',
          tCue,
          'All Weeks',
          'No',
          'Not logged yet',
          '',
        ]);
      }
    });
  } else {
    warmupRows.push(['—', 'No warm-up exercises configured for this workout plan.', '', '', '', '', '', '', '']);
  }

  const warmupSheet = XLSX.utils.aoa_to_sheet(warmupRows);
  warmupSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  warmupSheet['!rows'] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 8 }, { hpt: 22 }];
  warmupSheet['!cols'] = computeColWidths(warmupRows.slice(3), 12, 48);

  // =========================================================================
  // SHEET 5: INSTRUCTIONS & NOTES
  // =========================================================================
  const notesRows: Array<Array<string | number>> = [
    [`Instructions, Coach Overview & Session Notes  —  ${plan.title || 'Workout Plan'}`, '', '', '', '', ''],
    ...(plan.description ? [['Plan Description', plan.description, '', '', '', '']] : []),
    ...(plan.instructions ? [['Coach Instructions', plan.instructions, '', '', '', '']] : []),
    ['', '', '', '', '', ''],
    ['Note Type', 'Week', 'Day / Scope', 'Exercise', 'Notes / Feedback', 'Updated At'],
  ];

  const collectedNotes: Array<{
    type: string;
    weekNum: number;
    scope: string;
    exerciseName: string;
    notes: string;
    updatedAt: string;
  }> = [];

  Object.entries(loggedWeeks).forEach(([wKeyStr, logsMap]) => {
    const m = wKeyStr.match(/^w(\d+)$/i);
    const weekNum = m ? parseInt(m[1], 10) : 1;
    Object.entries(logsMap || {}).forEach(([entryKey, entryVal]) => {
      const notesText = (entryVal?.notes || '').trim();
      if (!notesText) return;

      if (entryKey.startsWith('__session_note__')) {
        const scope =
          entryVal?.day?.trim() ||
          (entryKey === '__session_note__ALL'
            ? 'All Days'
            : entryKey.replace(/^__session_note__/, '').replace(/_/g, ' '));
        collectedNotes.push({
          type: 'Session Feedback',
          weekNum,
          scope,
          exerciseName: '— (Entire Session)',
          notes: notesText,
          updatedAt: entryVal?.updatedAt ? new Date(entryVal.updatedAt).toLocaleString() : '',
        });
      } else {
        const exObj = exercises.find(e => e.id === entryKey);
        collectedNotes.push({
          type: 'Exercise Week Note',
          weekNum,
          scope: exObj?.day || 'General',
          exerciseName: exObj?.name || entryKey,
          notes: notesText,
          updatedAt: entryVal?.updatedAt ? new Date(entryVal.updatedAt).toLocaleString() : '',
        });
      }
    });
  });

  collectedNotes
    .sort((a, b) => a.weekNum - b.weekNum || a.type.localeCompare(b.type) || a.scope.localeCompare(b.scope))
    .forEach((item) => {
      notesRows.push([
        item.type,
        `Week ${item.weekNum}`,
        item.scope,
        item.exerciseName,
        item.notes,
        item.updatedAt,
      ]);
    });

  if (collectedNotes.length === 0) {
    notesRows.push(['—', '—', '—', '—', 'No exercise notes or session notes recorded yet.', '']);
  }
  const notesSheet = XLSX.utils.aoa_to_sheet(notesRows);
  notesSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  notesSheet['!rows'] = [{ hpt: 26 }];
  notesSheet['!cols'] = computeColWidths(notesRows, 14, 62);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, planSheet, 'Workout Sheet');
  XLSX.utils.book_append_sheet(wb, analyticsSheet, 'Daily Analytics');
  XLSX.utils.book_append_sheet(wb, setHistorySheet, 'Set-by-Set Log');
  XLSX.utils.book_append_sheet(wb, warmupSheet, 'Warm-up & Hydration');
  XLSX.utils.book_append_sheet(wb, notesSheet, 'Notes & Instructions');

  const safeSlug =
    (plan.title || 'workout-plan')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workout-plan';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeSlug}-${dateStamp}.xlsx`;

  return { wb, filename, XLSX };
}

export async function exportWorkoutPlanToExcelBuffer(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<{ filename: string; buffer: Uint8Array }> {
  const { wb, filename, XLSX } = await buildWorkoutPlanExcelWorkbook(plan, options);
  const arrayOut = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return {
    filename,
    buffer: new Uint8Array(arrayOut),
  };
}

export async function exportWorkoutPlanToExcel(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<string> {
  const { wb, filename, XLSX } = await buildWorkoutPlanExcelWorkbook(plan, options);
  XLSX.writeFile(wb, filename);
  return filename;
}
