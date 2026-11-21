import {
  ExerciseLogEntry,
  SetLogEntry,
  WeightUnit,
  WorkoutExercise,
  WorkoutPlan,
} from '../types';
import { planHasRirColumn, planHasRpeColumn } from './gymService';
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
      (s) =>
        (s.weight || '').trim() !== '' ||
        (s.reps || '').trim() !== '' ||
        (s.rpe || '').trim() !== '' ||
        (s.rir || '').trim() !== ''
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
      (s) =>
        (s.weight || '').trim() !== '' ||
        (s.reps || '').trim() !== '' ||
        (s.rpe || '').trim() !== '' ||
        (s.rir || '').trim() !== ''
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
    rir: '',
  }));
}

function averageMetric(rawList: string[]): string {
  const clean = rawList.map((v) => v.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  const nums = clean.map((v) => parseFloat(v)).filter((n) => Number.isFinite(n));
  if (nums.length > 0) {
    if (nums.length === 1) return String(nums[0]);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return avg.toFixed(1).replace(/\.0$/, '');
  }
  return Array.from(new Set(clean)).join(', ');
}

function summarizeWeekMetrics(
  ex: WorkoutExercise,
  entry: ExerciseLogEntry | undefined,
  fallbackUnit: WeightUnit,
  showRpe: boolean,
  showRir: boolean
): {
  weightSummary: string;
  repsSummary: string;
  rpeSummary: string;
  rirSummary: string;
  setBreakdown: string;
} {
  if (!entry || !entryHasData(entry)) {
    return { weightSummary: '', repsSummary: '', rpeSummary: '', rirSummary: '', setBreakdown: '' };
  }
  const list = resolveSetList(ex, entry, fallbackUnit).filter(
    (s) =>
      (s.weight || '').trim() !== '' ||
      (s.reps || '').trim() !== '' ||
      (s.rpe || '').trim() !== '' ||
      (s.rir || '').trim() !== ''
  );
  if (list.length === 0) {
    return { weightSummary: '', repsSummary: '', rpeSummary: '', rirSummary: '', setBreakdown: '' };
  }

  const weights = list.map((s) => (s.weight || '').trim()).filter(Boolean);
  const repsList = list.map((s) => (s.reps || '').trim()).filter(Boolean);
  const rpes = list.map((s) => (s.rpe || '').trim()).filter(Boolean);
  const rirs = list.map((s) => (s.rir || '').trim()).filter(Boolean);

  const uniqueWeights = Array.from(new Set(weights));
  const uniqueReps = Array.from(new Set(repsList));

  const setBreakdown = list
    .map((s) => {
      const wt = (s.weight || '').trim();
      const rp = (s.reps || '').trim();
      const rpe = showRpe ? (s.rpe || '').trim() : '';
      const rir = showRir ? (s.rir || '').trim() : '';
      const unit = s.unit || entry.unit || fallbackUnit;
      const wtPart = wt ? (wt.toUpperCase() === 'BW' ? 'BW' : `${wt} ${unit}`) : '-';
      const rpPart = rp || '-';
      const extraTags: string[] = [];
      if (rpe) extraTags.push(`RPE ${rpe}`);
      if (rir) extraTags.push(`RIR ${rir}`);
      const extraStr = extraTags.length > 0 ? ` (${extraTags.join(' · ')})` : '';
      return `Set ${s.setNumber}: ${wtPart} x ${rpPart}${extraStr}`;
    })
    .join('\n');

  return {
    weightSummary: uniqueWeights.length === 1 ? uniqueWeights[0] : weights.join(' / '),
    repsSummary: uniqueReps.length === 1 ? uniqueReps[0] : repsList.join(' / '),
    rpeSummary: showRpe ? averageMetric(rpes) : '',
    rirSummary: showRir ? averageMetric(rirs) : '',
    setBreakdown,
  };
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

function applySheetColumnWidths(
  ws: any,
  rows: Array<Array<string | number>>,
  minWidth = 11,
  maxWidth = 42,
  skipTopRows = 0
) {
  const sample = rows.slice(skipTopRows);
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  for (let c = 1; c <= colCount; c++) {
    let widest = minWidth;
    sample.forEach((r) => {
      const raw = r[c - 1];
      const str = raw !== undefined && raw !== null ? String(raw) : '';
      str.split('\n').forEach((line) => {
        if (line.length + 4 > widest) widest = line.length + 4;
      });
    });
    const col = ws.getColumn(c);
    col.width = Math.min(maxWidth, widest);
    col.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function styleAllWorksheetCellsCentered(ws: any) {
  ws.eachRow({ includeEmpty: false }, (row: any) => {
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
  });
}

function styleBannerRow(row: any, colCount: number, bgArgb = 'FF0F172A', accentFontArgb = 'FFFFFFFF') {
  row.height = 30;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: accentFontArgb } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

function styleMetaRow(row: any, colCount: number) {
  row.height = 22;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    const isLabel = c % 2 === 1;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLabel ? 'FFF1F5F9' : 'FFFFFFFF' } };
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: isLabel,
      color: { argb: isLabel ? 'FF475569' : 'FF0F172A' },
    };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

function styleHeaderRow(row: any, colCount: number, bgArgb = 'FF1E293B') {
  row.height = 25;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FFDC2626' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

function styleDataRow(row: any, colCount: number, stripe: boolean, bgOverride?: string) {
  const fillArgb = bgOverride || (stripe ? 'FFF8FAFC' : 'FFFFFFFF');
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

/**
 * Builds a styled ExcelJS workbook with ALL cells centered horizontally & vertically,
 * NO volume columns/totals, and conditional RPE / RIR columns matching the workout sheet.
 *  1. Workout Sheet       (Banner + KPIs + Super-Headers + Day-grouped rows + Re-import compatible)
 *  2. Daily Analytics     (Day x Week completion, sets logged, conditional Avg RPE/RIR & feedback)
 *  3. Set-by-Set Log      (Flat filterable ledger across Warm-up & Main Workout)
 *  4. Warm-up & Hydration (Dedicated warm-up duration/sets/logs + daily water intake summary)
 *  5. Notes & Instructions(Instructions, Description, Exercise Week Notes & Session Feedback)
 */
export async function buildWorkoutPlanExcelWorkbook(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<{ wb: any; filename: string }> {
  const ExcelJSMod: any = await import('exceljs');
  const ExcelJS = ExcelJSMod.default || ExcelJSMod;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gym Workout Tracker';
  wb.created = new Date();

  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = plan.exercises || [];
  const warmupExercises = plan.warmupExercises || [];
  const loggedWeeks = plan.exerciseLogs || {};

  const showRpe = planHasRpeColumn(plan);
  const showRir = planHasRirColumn(plan);

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

  // =========================================================================
  // SHEET 1: WORKOUT SHEET (Row 5 = Main Headers <= Row 15 for sheetParser)
  // =========================================================================
  const ws1 = wb.addWorksheet('Workout Sheet', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  const fixedHeaders: string[] = ['#', 'Day', 'Type', 'Exercise', 'Sets', 'Reps'];
  if (showRpe) fixedHeaders.push('Target RPE');
  if (showRir) fixedHeaders.push('Target RIR');
  fixedHeaders.push('Coach Notes', 'Video');
  const fixedColCount = fixedHeaders.length;

  const weekGroupHeaders = (w: number): string[] => {
    const h = [`Week ${w} Done`, `Week ${w} Weight (${planUnit})`, `Week ${w} Reps`];
    if (showRpe) h.push(`Week ${w} RPE`);
    if (showRir) h.push(`Week ${w} RIR`);
    h.push(`Week ${w} Set Breakdown`, `Week ${w} Notes`);
    return h;
  };
  const weekGroupCols = weekGroupHeaders(1).length;
  const totalSheet1Cols = fixedColCount + totalWeekColumns * weekGroupCols;

  const sheet1AllRows: Array<Array<string | number>> = [];

  // Row 1: Title Banner
  const titleRowData: Array<string | number> = [`GYM WORKOUT  —  ${plan.title || 'Training Plan'}`];
  while (titleRowData.length < totalSheet1Cols) titleRowData.push('');
  const rTitle1 = ws1.addRow(titleRowData);
  ws1.mergeCells(1, 1, 1, totalSheet1Cols);
  styleBannerRow(rTitle1, totalSheet1Cols, 'FF111827', 'FFFFFFFF');
  sheet1AllRows.push(titleRowData);

  // Row 2: Meta Strip (No Volume!)
  const metaRowData: Array<string | number> = [
    'Athlete',
    options.ownerName || plan.ownerUsername || 'Athlete',
    'Unit',
    planUnit.toUpperCase(),
    'Program',
    `${dayOrder.length} Days / ${weeks} Weeks`,
    'Completion',
    `${overallPct}% (${totalDone}/${totalPossible})`,
    'Water Today',
    typeof options.waterGlasses === 'number' ? `${options.waterGlasses} / 8 glasses` : '—',
  ];
  while (metaRowData.length < totalSheet1Cols) metaRowData.push('');
  const rMeta1 = ws1.addRow(metaRowData);
  styleMetaRow(rMeta1, totalSheet1Cols);
  sheet1AllRows.push(metaRowData);

  // Row 3: Spacer
  const spacerData: Array<string | number> = [''];
  const rSpacer1 = ws1.addRow(spacerData);
  rSpacer1.height = 8;
  sheet1AllRows.push(spacerData);

  // Row 4: Super-Header (Program Specification | Week 1 Performance | ...)
  const superHeaderData: Array<string | number> = ['Program Specification'];
  for (let c = 1; c < fixedColCount; c++) superHeaderData.push('');
  for (let w = 1; w <= totalWeekColumns; w++) {
    superHeaderData.push(`Week ${w} Performance`);
    for (let k = 1; k < weekGroupCols; k++) superHeaderData.push('');
  }
  const rSuper1 = ws1.addRow(superHeaderData);
  rSuper1.height = 22;
  ws1.mergeCells(4, 1, 4, fixedColCount);
  for (let c = 1; c <= fixedColCount; c++) {
    const cell = rSuper1.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFCA5A5' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  for (let w = 1; w <= totalWeekColumns; w++) {
    const startCol = fixedColCount + (w - 1) * weekGroupCols + 1;
    const endCol = startCol + weekGroupCols - 1;
    ws1.mergeCells(4, startCol, 4, endCol);
    const wkBg = w % 2 === 1 ? 'FF1E293B' : 'FF334155';
    for (let c = startCol; c <= endCol; c++) {
      const cell = rSuper1.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: wkBg } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }
  sheet1AllRows.push(superHeaderData);

  // Row 5: Main Column Headers
  const planHeaders: string[] = [...fixedHeaders];
  for (let w = 1; w <= totalWeekColumns; w++) {
    planHeaders.push(...weekGroupHeaders(w));
  }
  const rHead1 = ws1.addRow(planHeaders);
  styleHeaderRow(rHead1, totalSheet1Cols, 'FF1E293B');
  sheet1AllRows.push(planHeaders);

  // Day-Grouped Rows
  let dataRowCounter = 0;
  dayOrder.forEach((dayName) => {
    const dayItems = dayExercisesMap.get(dayName) || [];
    // Single-cell Day Banner row (recognized cleanly by sheetParser.ts)
    const bannerRowData: Array<string | number> = [dayName];
    const rDayBanner = ws1.addRow(bannerRowData);
    rDayBanner.height = 24;
    const bannerRowNum = rDayBanner.number;
    ws1.mergeCells(bannerRowNum, 1, bannerRowNum, totalSheet1Cols);
    for (let c = 1; c <= totalSheet1Cols; c++) {
      const cell = rDayBanner.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF991B1B' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FFEF4444' } },
        bottom: { style: 'thin', color: { argb: 'FFFCA5A5' } },
        left: THIN_BORDER.left,
        right: THIN_BORDER.right,
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    sheet1AllRows.push(bannerRowData);

    dayItems.forEach(({ ex, globalIdx }) => {
      const { setsDisplay, repsDisplay } = getTargetText(ex);
      const typeCell = ex.isSuperset
        ? ex.supersetGroup && ex.supersetGroup.trim()
          ? `Superset (${ex.supersetGroup.trim()})`
          : 'Superset'
        : 'Standard';

      const rowData: Array<string | number> = [
        globalIdx + 1,
        ex.day || dayName,
        typeCell,
        ex.name || '',
        setsDisplay || '',
        repsDisplay || '',
      ];
      if (showRpe) rowData.push(ex.targetRpe || '');
      if (showRir) rowData.push(ex.targetRir || '');
      rowData.push(ex.notes || '', ex.videoUrl || '');

      let maxLinesInRow = 1;
      for (let w = 1; w <= totalWeekColumns; w++) {
        const wKey = weekKey(w - 1);
        const entry = loggedWeeks[wKey]?.[ex.id];
        const metrics = summarizeWeekMetrics(ex, entry, planUnit, showRpe, showRir);
        const isDone = (plan.progress?.[wKey] || []).includes(ex.id) ? 'Yes' : 'No';
        const exWeekNote = entry?.notes?.trim() || '';
        const lineCount = metrics.setBreakdown ? metrics.setBreakdown.split('\n').length : 1;
        if (lineCount > maxLinesInRow) maxLinesInRow = lineCount;

        rowData.push(isDone, metrics.weightSummary, metrics.repsSummary);
        if (showRpe) rowData.push(metrics.rpeSummary);
        if (showRir) rowData.push(metrics.rirSummary);
        rowData.push(metrics.setBreakdown, exWeekNote);
      }

      const addedRow = ws1.addRow(rowData);
      const isStripe = dataRowCounter % 2 === 1;
      dataRowCounter++;
      styleDataRow(addedRow, totalSheet1Cols, isStripe, ex.isSuperset ? 'FFFDF4FF' : undefined);
      addedRow.height = Math.max(22, maxLinesInRow * 15 + 6);
      addedRow.getCell(4).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      // Color-code Done status per week
      for (let w = 1; w <= totalWeekColumns; w++) {
        const doneColIdx = fixedColCount + (w - 1) * weekGroupCols + 1;
        const doneCell = addedRow.getCell(doneColIdx);
        const isYes = doneCell.value === 'Yes';
        doneCell.font = {
          name: 'Calibri',
          size: 10,
          bold: true,
          color: { argb: isYes ? 'FF15803D' : 'FF94A3B8' },
        };
      }

      sheet1AllRows.push(rowData);
    });
  });

  if (ws1.rowCount >= 5) {
    ws1.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: ws1.rowCount, column: totalSheet1Cols },
    };
  }
  applySheetColumnWidths(ws1, sheet1AllRows, 11, 40, 3);
  ws1.getColumn(1).width = 7;
  ws1.getColumn(4).width = 28;
  styleAllWorksheetCellsCentered(ws1);

  // =========================================================================
  // SHEET 2: DAILY ANALYTICS (No Volume! Conditional Avg RPE & Avg RIR)
  // =========================================================================
  const ws2 = wb.addWorksheet('Daily Analytics', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  const analyticsHeaders: string[] = [
    'Training Day',
    'Week',
    'Exercises Done',
    'Day Exercises',
    'Completion %',
    'Sets Logged',
  ];
  if (showRpe) analyticsHeaders.push('Avg RPE');
  if (showRir) analyticsHeaders.push('Avg RIR');
  analyticsHeaders.push('Day Session Feedback');

  const ws2Cols = analyticsHeaders.length;
  const analyticsAllRows: Array<Array<string | number>> = [];

  const aBannerData: Array<string | number> = [`Daily & Weekly Training Analytics  —  ${plan.title || 'Workout Plan'}`];
  while (aBannerData.length < ws2Cols) aBannerData.push('');
  const rABanner = ws2.addRow(aBannerData);
  ws2.mergeCells(1, 1, 1, ws2Cols);
  styleBannerRow(rABanner, ws2Cols);
  analyticsAllRows.push(aBannerData);

  const aMetaData: Array<string | number> = [
    'Member',
    options.ownerName || plan.ownerUsername || 'Athlete',
    'Overall Progress',
    `${overallPct}% (${totalDone}/${totalPossible})`,
    'Water Today',
    typeof options.waterGlasses === 'number' ? `${options.waterGlasses} glasses` : '—',
  ];
  while (aMetaData.length < ws2Cols) aMetaData.push('');
  const rAMeta = ws2.addRow(aMetaData);
  styleMetaRow(rAMeta, ws2Cols);
  analyticsAllRows.push(aMetaData);

  const aSpacer = ws2.addRow(['']);
  aSpacer.height = 8;
  analyticsAllRows.push(['']);

  const rAHead = ws2.addRow(analyticsHeaders);
  styleHeaderRow(rAHead, ws2Cols);
  analyticsAllRows.push(analyticsHeaders);

  let aRowIdx = 0;
  dayOrder.forEach((dayName) => {
    const dayItems = dayExercisesMap.get(dayName) || [];
    for (let w = 1; w <= totalWeekColumns; w++) {
      const wKey = weekKey(w - 1);
      const doneSet = new Set(plan.progress?.[wKey] || []);
      let doneInDay = 0;
      let setsLogged = 0;
      const rpeNums: number[] = [];
      const rirNums: number[] = [];

      dayItems.forEach(({ ex }) => {
        if (doneSet.has(ex.id)) doneInDay++;
        const entry = loggedWeeks[wKey]?.[ex.id];
        if (entryHasData(entry)) {
          const list = resolveSetList(ex, entry!, planUnit).filter(
            (s) =>
              (s.weight || '').trim() !== '' ||
              (s.reps || '').trim() !== '' ||
              (s.rpe || '').trim() !== '' ||
              (s.rir || '').trim() !== ''
          );
          setsLogged += list.length;
          list.forEach((s) => {
            const rVal = parseFloat((s.rpe || '').trim());
            if (Number.isFinite(rVal)) rpeNums.push(rVal);
            const rirVal = parseFloat((s.rir || '').trim());
            if (Number.isFinite(rirVal)) rirNums.push(rirVal);
          });
        }
      });

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
      const avgRirStr =
        rirNums.length > 0
          ? (rirNums.reduce((a, b) => a + b, 0) / rirNums.length).toFixed(1).replace(/\.0$/, '')
          : '—';

      const rowData: Array<string | number> = [
        dayName,
        `Week ${w}`,
        doneInDay,
        dayItems.length,
        `${pct}%`,
        setsLogged,
      ];
      if (showRpe) rowData.push(avgRpeStr);
      if (showRir) rowData.push(avgRirStr);
      rowData.push(sessionFeedback);

      const added = ws2.addRow(rowData);
      styleDataRow(added, ws2Cols, aRowIdx % 2 === 1);
      added.height = 22;
      aRowIdx++;
      analyticsAllRows.push(rowData);
    }
  });

  if (ws2.rowCount >= 4) {
    ws2.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: ws2.rowCount, column: ws2Cols },
    };
  }
  applySheetColumnWidths(ws2, analyticsAllRows, 13, 46, 3);
  styleAllWorksheetCellsCentered(ws2);

  // =========================================================================
  // SHEET 3: SET-BY-SET LOG (No Volume! Conditional Target/Actual RPE & RIR)
  // =========================================================================
  const ws3 = wb.addWorksheet('Set-by-Set Log', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const setHeaders: string[] = [
    'Week',
    'Category',
    'Day',
    'Exercise',
    'Superset',
    'Set #',
    'Target',
  ];
  if (showRpe) setHeaders.push('Target RPE');
  if (showRir) setHeaders.push('Target RIR');
  setHeaders.push('Weight', 'Unit', 'Reps');
  if (showRpe) setHeaders.push('Actual RPE');
  if (showRir) setHeaders.push('Actual RIR');
  setHeaders.push('Done', 'Exercise Note', 'Updated At');

  const ws3Cols = setHeaders.length;
  const setHistoryAllRows: Array<Array<string | number>> = [setHeaders];
  const rSHead = ws3.addRow(setHeaders);
  styleHeaderRow(rSHead, ws3Cols);

  let sRowIdx = 0;
  for (let w = 1; w <= totalWeekColumns; w++) {
    const wKey = weekKey(w - 1);
    const doneSet = new Set(plan.progress?.[wKey] || []);

    warmupExercises.forEach((wu) => {
      const wLog = plan.warmupLogs?.[wKey]?.[wu.id];
      if (!wLog) return;
      const validSets = (wLog.setEntries || []).filter(
        (s) =>
          (s.weight || '').trim() !== '' ||
          (s.reps || '').trim() !== '' ||
          (s.rpe || '').trim() !== '' ||
          (s.rir || '').trim() !== ''
      );
      validSets.forEach((s) => {
        const rowData: Array<string | number> = [
          `Week ${w}`,
          'Warm-up',
          'Warm-up',
          wu.name || '',
          'No',
          s.setNumber,
          formatWarmupSummaryTarget(wu),
        ];
        if (showRpe) rowData.push('');
        if (showRir) rowData.push('');
        rowData.push(s.weight || '', s.unit || planUnit, s.reps || '');
        if (showRpe) rowData.push(s.rpe || '');
        if (showRir) rowData.push(s.rir || '');
        rowData.push(
          wLog.completed ? 'Yes' : 'No',
          wLog.notes || '',
          wLog.updatedAt ? new Date(wLog.updatedAt).toLocaleString() : ''
        );
        const added = ws3.addRow(rowData);
        styleDataRow(added, ws3Cols, sRowIdx % 2 === 1, 'FFFFFBEB');
        added.height = 20;
        sRowIdx++;
        setHistoryAllRows.push(rowData);
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
        (s) =>
          (s.weight || '').trim() !== '' ||
          (s.reps || '').trim() !== '' ||
          (s.rpe || '').trim() !== '' ||
          (s.rir || '').trim() !== ''
      );
      setsList.forEach((s) => {
        const rowData: Array<string | number> = [
          `Week ${w}`,
          'Main Workout',
          ex.day || 'General Workout',
          ex.name || '',
          ex.isSuperset ? (ex.supersetGroup || 'Yes') : 'No',
          s.setNumber,
          targetStr,
        ];
        if (showRpe) rowData.push(ex.targetRpe || '');
        if (showRir) rowData.push(ex.targetRir || '');
        rowData.push(s.weight || '', s.unit || entry?.unit || planUnit, s.reps || '');
        if (showRpe) rowData.push(s.rpe || '');
        if (showRir) rowData.push(s.rir || '');
        rowData.push(
          doneSet.has(ex.id) ? 'Yes' : 'No',
          entry?.notes?.trim() || '',
          entry?.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ''
        );
        const added = ws3.addRow(rowData);
        styleDataRow(added, ws3Cols, sRowIdx % 2 === 1);
        added.height = 20;
        sRowIdx++;
        setHistoryAllRows.push(rowData);
      });
    });
  }

  if (setHistoryAllRows.length === 1) {
    const emptyRowData: Array<string | number> = ['—', '—', '—', 'No logged sets recorded yet.'];
    while (emptyRowData.length < ws3Cols) emptyRowData.push('');
    const added = ws3.addRow(emptyRowData);
    styleDataRow(added, ws3Cols, false);
    added.height = 22;
    setHistoryAllRows.push(emptyRowData);
  }

  ws3.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: ws3.rowCount, column: ws3Cols },
  };
  applySheetColumnWidths(ws3, setHistoryAllRows, 10, 40, 0);
  styleAllWorksheetCellsCentered(ws3);

  // =========================================================================
  // SHEET 4: WARM-UP & HYDRATION
  // =========================================================================
  const ws4 = wb.addWorksheet('Warm-up & Hydration', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  const ws4Cols = 9;
  const warmupAllRows: Array<Array<string | number>> = [];

  const wBannerData = [`Warm-up Protocol & Hydration Tracker  —  ${plan.title || 'Workout Plan'}`, '', '', '', '', '', '', '', ''];
  const rWBanner = ws4.addRow(wBannerData);
  ws4.mergeCells(1, 1, 1, ws4Cols);
  styleBannerRow(rWBanner, ws4Cols, 'FF78350F', 'FFFFFFFF');
  warmupAllRows.push(wBannerData);

  const wMetaData: Array<string | number> = [
    'Daily Water Intake',
    typeof options.waterGlasses === 'number' ? `${options.waterGlasses} / 8 glasses` : 'Not logged',
    'Warm-up Movements',
    warmupExercises.length,
    'Exported Date',
    new Date().toLocaleDateString(),
    '',
    '',
    '',
  ];
  const rWMeta = ws4.addRow(wMetaData);
  styleMetaRow(rWMeta, ws4Cols);
  warmupAllRows.push(wMetaData);

  const wSpacer = ws4.addRow(['']);
  wSpacer.height = 8;
  warmupAllRows.push(['']);

  const wuHeaders = [
    'Warm-up #',
    'Warm-up Exercise',
    'Duration (Min)',
    'Target Sets',
    'Target Reps / Cue',
    'Week',
    'Completed',
    'Warm-up Sets Summary',
    'Updated At',
  ];
  const rWHead = ws4.addRow(wuHeaders);
  styleHeaderRow(rWHead, ws4Cols, 'FF92400E');
  warmupAllRows.push(wuHeaders);

  let wRowIdx = 0;
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
          (s) =>
            (s.weight || '').trim() !== '' ||
            (s.reps || '').trim() !== '' ||
            (s.rpe || '').trim() !== '' ||
            (s.rir || '').trim() !== ''
        );
        if (!wLog?.completed && validSets.length === 0) continue;
        hasAnyWeek = true;
        const setSummary = validSets
          .map((s) => {
            const wt = (s.weight || '').trim();
            const rp = (s.reps || '').trim();
            const rpe = showRpe ? (s.rpe || '').trim() : '';
            const rir = showRir ? (s.rir || '').trim() : '';
            const unit = s.unit || planUnit;
            const tags: string[] = [];
            if (rpe) tags.push(`RPE ${rpe}`);
            if (rir) tags.push(`RIR ${rir}`);
            return `S${s.setNumber}: ${wt ? `${wt} ${unit}` : '-'} x ${rp || '-'}${tags.length ? ` (${tags.join(' ')})` : ''}`;
          })
          .join(' | ');
        const rowData: Array<string | number> = [
          idx + 1,
          wu.name || '',
          durMin ? `${durMin} min` : '',
          tSets || '',
          tCue,
          `Week ${w}`,
          wLog?.completed ? 'Yes' : 'No',
          setSummary || 'Completed',
          wLog?.updatedAt ? new Date(wLog.updatedAt).toLocaleString() : '',
        ];
        const added = ws4.addRow(rowData);
        styleDataRow(added, ws4Cols, wRowIdx % 2 === 1);
        added.height = 22;
        wRowIdx++;
        warmupAllRows.push(rowData);
      }
      if (!hasAnyWeek) {
        const rowData: Array<string | number> = [
          idx + 1,
          wu.name || '',
          durMin ? `${durMin} min` : '',
          tSets || '',
          tCue,
          'All Weeks',
          'No',
          'Not logged yet',
          '',
        ];
        const added = ws4.addRow(rowData);
        styleDataRow(added, ws4Cols, wRowIdx % 2 === 1);
        added.height = 22;
        wRowIdx++;
        warmupAllRows.push(rowData);
      }
    });
  } else {
    const emptyW = ['—', 'No warm-up exercises configured for this workout plan.', '', '', '', '', '', '', ''];
    const added = ws4.addRow(emptyW);
    styleDataRow(added, ws4Cols, false);
    added.height = 22;
    warmupAllRows.push(emptyW);
  }

  applySheetColumnWidths(ws4, warmupAllRows, 12, 46, 3);
  styleAllWorksheetCellsCentered(ws4);

  // =========================================================================
  // SHEET 5: NOTES & INSTRUCTIONS
  // =========================================================================
  const ws5 = wb.addWorksheet('Notes & Instructions');
  const ws5Cols = 6;
  const notesAllRows: Array<Array<string | number>> = [];

  const nBannerData = [`Instructions, Coach Overview & Session Notes  —  ${plan.title || 'Workout Plan'}`, '', '', '', '', ''];
  const rNBanner = ws5.addRow(nBannerData);
  ws5.mergeCells(1, 1, 1, ws5Cols);
  styleBannerRow(rNBanner, ws5Cols);
  notesAllRows.push(nBannerData);

  if (plan.description) {
    const dRow = ['Plan Description', plan.description, '', '', '', ''];
    const added = ws5.addRow(dRow);
    ws5.mergeCells(added.number, 2, added.number, ws5Cols);
    styleMetaRow(added, ws5Cols);
    notesAllRows.push(dRow);
  }
  if (plan.instructions) {
    const iRow = ['Coach Instructions', plan.instructions, '', '', '', ''];
    const added = ws5.addRow(iRow);
    ws5.mergeCells(added.number, 2, added.number, ws5Cols);
    styleMetaRow(added, ws5Cols);
    added.height = Math.max(26, Math.ceil(plan.instructions.length / 70) * 16 + 8);
    notesAllRows.push(iRow);
  }

  const nSpacer = ws5.addRow(['']);
  nSpacer.height = 8;
  notesAllRows.push(['']);

  const notesHeaders = ['Note Type', 'Week', 'Day / Scope', 'Exercise', 'Notes / Feedback', 'Updated At'];
  const rNHead = ws5.addRow(notesHeaders);
  styleHeaderRow(rNHead, ws5Cols);
  notesAllRows.push(notesHeaders);

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
        const exObj = exercises.find((e) => e.id === entryKey);
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

  let nIdx = 0;
  collectedNotes
    .sort((a, b) => a.weekNum - b.weekNum || a.type.localeCompare(b.type) || a.scope.localeCompare(b.scope))
    .forEach((item) => {
      const rowData = [
        item.type,
        `Week ${item.weekNum}`,
        item.scope,
        item.exerciseName,
        item.notes,
        item.updatedAt,
      ];
      const added = ws5.addRow(rowData);
      styleDataRow(added, ws5Cols, nIdx % 2 === 1);
      added.height = Math.max(22, Math.ceil(item.notes.length / 45) * 15 + 6);
      nIdx++;
      notesAllRows.push(rowData);
    });

  if (collectedNotes.length === 0) {
    const emptyN = ['—', '—', '—', '—', 'No exercise notes or session notes recorded yet.', ''];
    const added = ws5.addRow(emptyN);
    styleDataRow(added, ws5Cols, false);
    added.height = 22;
    notesAllRows.push(emptyN);
  }

  applySheetColumnWidths(ws5, notesAllRows, 14, 58, 3);
  styleAllWorksheetCellsCentered(ws5);

  const safeSlug =
    (plan.title || 'workout-plan')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workout-plan';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeSlug}-${dateStamp}.xlsx`;

  return { wb, filename };
}

export async function exportWorkoutPlanToExcelBuffer(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<{ filename: string; buffer: Uint8Array }> {
  const { wb, filename } = await buildWorkoutPlanExcelWorkbook(plan, options);
  const rawBuffer = await wb.xlsx.writeBuffer();
  return {
    filename,
    buffer: new Uint8Array(rawBuffer),
  };
}

export async function exportWorkoutPlanToExcel(
  plan: WorkoutPlan,
  options: ExportWorkoutExcelOptions = {}
): Promise<string> {
  const { filename, buffer } = await exportWorkoutPlanToExcelBuffer(plan, options);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Generates and downloads the Standard Upload Sheet template:
 * Col 1: Exercises (with Day header rows inside Column 1 above each day's exercises)
 * Col 2: Sets | Col 3: Reps | Col 4: RPE | Col 5: RIP | Col 6: Weight (kg) | Col 7: Actual Reps | Col 8: Notes | Col 9: Video URL
 */
export async function downloadStandardWorkoutTemplateExcel(unit: WeightUnit = 'kg'): Promise<string> {
  const ExcelJSMod: any = await import('exceljs');
  const ExcelJS = ExcelJSMod.default || ExcelJSMod;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gym Workout Tracker';
  wb.created = new Date();

  const ws = wb.addWorksheet('Workout Plan', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  const headers = [
    'Exercises',
    'Sets',
    'Reps',
    'RPE',
    'RIP',
    `Weight (${unit})`,
    'Actual Reps',
    'Notes',
    'Video URL',
  ];
  const colCount = headers.length;

  const titleRow = ws.addRow(['STANDARD WORKOUT SHEET — Column 1: Exercises + Day Headers | Col 2: Sets | Col 3: Reps']);
  ws.mergeCells(1, 1, 1, colCount);
  styleBannerRow(titleRow, colCount, 'FF111827', 'FFFFFFFF');

  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow, colCount, 'FF1E293B');

  const templateRows: Array<{ isDay?: boolean; values: Array<string | number> }> = [
    { isDay: true, values: ['Day 1 - Push'] },
    { values: ['Barbell Bench Press', 4, '8-10', '8', '2', unit === 'lbs' ? '175 / 185' : '80 / 85', '8 / 8', 'Control eccentric, pause on chest', 'https://www.youtube.com/watch?v=rT7DgCr-3pg'] },
    { values: ['Incline Dumbbell Press', 3, '10-12', '8.5', '1-2', unit === 'lbs' ? '65' : '30', '10', '30° bench angle', 'https://www.youtube.com/watch?v=8iPEnn-ltC8'] },
    { values: ['Lateral Raises', 4, '12-15', '9', '1', unit === 'lbs' ? '25' : '12', '', 'Strict form, no swinging', ''] },
    { isDay: true, values: ['Day 2 - Pull'] },
    { values: ['Lat Pulldown', 4, '10-12', '8', '2', unit === 'lbs' ? '130' : '60', '10', 'Full stretch at top', 'https://www.youtube.com/watch?v=CAwf7n6Luuc'] },
    { values: ['Seated Cable Row', 3, '10-12', '8', '2', unit === 'lbs' ? '140' : '65', '', 'Squeeze shoulder blades', ''] },
    { isDay: true, values: ['Day 3 - Legs'] },
    { values: ['Barbell Squat', 4, '6-8', '8.5', '1-2', unit === 'lbs' ? '225' : '100', '6', 'Break parallel with brace', 'https://www.youtube.com/watch?v=ultWZbUMPL8'] },
    { values: ['Romanian Deadlift', 3, '8-10', '8', '2', unit === 'lbs' ? '185' : '85', '', 'Hinge at hips, soft knees', ''] },
  ];

  const allRows: Array<Array<string | number>> = [headers];
  let dataIdx = 0;

  templateRows.forEach((item) => {
    const r = ws.addRow(item.values);
    if (item.isDay) {
      r.height = 24;
      ws.mergeCells(r.number, 1, r.number, colCount);
      for (let c = 1; c <= colCount; c++) {
        const cell = r.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF991B1B' } };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FFEF4444' } },
          bottom: { style: 'thin', color: { argb: 'FFFCA5A5' } },
          left: THIN_BORDER.left,
          right: THIN_BORDER.right,
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      allRows.push([item.values[0]]);
    } else {
      r.height = 22;
      styleDataRow(r, colCount, dataIdx % 2 === 1);
      r.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      dataIdx++;
      allRows.push(item.values);
    }
  });

  applySheetColumnWidths(ws, allRows, 11, 44, 0);
  styleAllWorksheetCellsCentered(ws);

  const filename = 'gym-standard-workout-template.xlsx';
  const rawBuffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(rawBuffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

