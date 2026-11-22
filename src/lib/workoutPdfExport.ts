import { jsPDF } from 'jspdf';
import { ExerciseLogEntry, SetLogEntry, WeightUnit, WorkoutExercise, WorkoutPlan } from '../types';
import { planHasRirColumn, planHasRpeColumn } from './gymService';
import { parseSetsCount, splitSetsAndReps } from './sheetParser';

const weekKey = (weekIdx: number) => `w${weekIdx + 1}`;

/** Replace symbols outside jsPDF's built-in WinAnsi encoding (emojis, arrows, etc.) so text renders cleanly. */
function pdfSafeText(input?: string): string {
  if (!input) return '';
  return input
    .replace(/[×✕✖]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[✓✔✅]/g, '[Done]')
    .replace(/[•·]/g, '-')
    .replace(/[→➔]/g, '->')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .trim();
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

function getPopulatedSetList(
  _ex: WorkoutExercise,
  entry: ExerciseLogEntry | undefined,
  fallbackUnit: WeightUnit
): SetLogEntry[] {
  if (!entry) return [];
  if (entry.setEntries && entry.setEntries.length > 0) {
    return entry.setEntries
      .filter(
        (s) =>
          (s.weight || '').trim() !== '' ||
          (s.reps || '').trim() !== '' ||
          (s.rpe || '').trim() !== '' ||
          (s.rir || '').trim() !== ''
      )
      .map((s) => ({ ...s, unit: s.unit || entry.unit || fallbackUnit }));
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
  return [];
}

function formatCompactSet(
  s: SetLogEntry,
  fallbackUnit: WeightUnit,
  showRpe: boolean,
  showRir: boolean
): string {
  const wt = (s.weight || '').trim();
  const rp = (s.reps || '').trim();
  const rpe = showRpe ? (s.rpe || '').trim() : '';
  const rir = showRir ? (s.rir || '').trim() : '';
  const unit = s.unit || fallbackUnit;
  const wtPart = wt ? (wt.toUpperCase() === 'BW' ? 'BW' : `${wt}${unit}`) : '-';
  const rpPart = rp || '-';
  const tags: string[] = [];
  if (rpe) tags.push(`RPE ${rpe}`);
  if (rir) tags.push(`RIR ${rir}`);
  const extraPart = tags.length > 0 ? ` (${tags.join(' ')})` : '';
  return `S${s.setNumber}: ${wtPart} x ${rpPart}${extraPart}`;
}

function calcAvgMetric(sets: SetLogEntry[], field: 'rpe' | 'rir'): string {
  const vals = sets
    .map((s) => parseFloat((s[field] || '').trim()))
    .filter((n) => Number.isFinite(n));
  if (vals.length === 0) return '-';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg.toFixed(1).replace(/\.0$/, '');
}

function normalizeDayKey(day?: string): string {
  const d = (day || '').trim();
  return d ? d : 'General Workout';
}

export interface ExportWorkoutPdfOptions {
  ownerName?: string;
  waterGlasses?: number;
  waterGoalGlasses?: number;
  waterTargetLiters?: number;
}

/**
 * Generate a clean, day-combined multi-page jsPDF report for a WorkoutPlan:
 * - Executive Header & KPI Summary + Split Overview Table
 * - Weekly Progress & Total Volume Breakdown
 * - Warm-up Protocol Table
 * - Day-Combined Training Sections (Day Header + Exercises + Aligned Weekly Set/RPE/Volume Tables + Day Session Notes)
 */
function renderPlanIntoPdfDoc(
  doc: jsPDF,
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {},
  startOnNewPage = false
): void {
  if (startOnNewPage) {
    doc.addPage();
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 13;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 15;

  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = plan.exercises || [];
  const warmupExercises = plan.warmupExercises || [];
  const showRpe = planHasRpeColumn(plan);
  const showRir =
    planHasRirColumn(plan) ||
    exercises.some((ex) => Boolean(ex.targetRir?.trim()));

  const resolvedWaterGoal = Math.max(1, Math.round(options.waterGoalGlasses || 8));
  const resolvedTargetLiters =
    typeof options.waterTargetLiters === 'number' &&
    Number.isFinite(options.waterTargetLiters) &&
    options.waterTargetLiters > 0
      ? Number(options.waterTargetLiters.toFixed(1))
      : Number((resolvedWaterGoal * 0.25).toFixed(1));
  const consumedWaterLiters =
    typeof options.waterGlasses === 'number'
      ? Number((options.waterGlasses * 0.25).toFixed(2))
      : undefined;

  // Discover all week numbers present across plan & logs
  const weekNumsSet = new Set<number>();
  for (let w = 1; w <= weeks; w++) weekNumsSet.add(w);
  Object.keys(plan.exerciseLogs || {}).forEach((k) => {
    const m = k.match(/^w(\d+)$/i);
    if (m) weekNumsSet.add(parseInt(m[1], 10));
  });
  Object.keys(plan.warmupLogs || {}).forEach((k) => {
    const m = k.match(/^w(\d+)$/i);
    if (m) weekNumsSet.add(parseInt(m[1], 10));
  });
  const sortedWeekNums = Array.from(weekNumsSet).sort((a, b) => a - b);

  // Aggregate completions, per-week done/remaining breakdown, notes, & total sets logged
  let totalDone = 0;
  const totalPossible = exercises.length * weeks;
  for (let w = 0; w < weeks; w++) {
    totalDone += (plan.progress?.[weekKey(w)] || []).length;
  }
  const overallPct = totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0;

  let totalSetsLogged = 0;
  const weekBreakdown: Array<{
    weekNum: number;
    doneCount: number;
    totalCount: number;
    setsCount: number;
    notesCount: number;
    status: 'Done' | 'In Progress' | 'Remaining';
  }> = [];

  sortedWeekNums.forEach((w) => {
    const wk = weekKey(w - 1);
    const doneSet = new Set(plan.progress?.[wk] || []);
    const doneInWeek = exercises.filter((ex) => doneSet.has(ex.id)).length;
    let wkSets = 0;
    let wkNotes = 0;

    exercises.forEach((ex) => {
      const entry = plan.exerciseLogs?.[wk]?.[ex.id];
      wkSets += getPopulatedSetList(ex, entry, planUnit).length;
      if (entry?.notes?.trim()) wkNotes++;
    });

    Object.entries(plan.exerciseLogs?.[wk] || {}).forEach(([entryKey, entryVal]) => {
      if (entryKey.startsWith('__session_note__') && entryVal?.notes?.trim()) {
        wkNotes++;
      }
    });

    Object.values(plan.warmupLogs?.[wk] || {}).forEach((wEntry) => {
      if (wEntry?.notes?.trim()) wkNotes++;
    });

    totalSetsLogged += wkSets;
    const isWeekDone = exercises.length > 0 && doneInWeek >= exercises.length;
    const isInProgress = !isWeekDone && (doneInWeek > 0 || wkSets > 0 || wkNotes > 0);
    if (w <= weeks || wkSets > 0 || wkNotes > 0 || doneInWeek > 0) {
      weekBreakdown.push({
        weekNum: w,
        doneCount: doneInWeek,
        totalCount: exercises.length,
        setsCount: wkSets,
        notesCount: wkNotes,
        status: isWeekDone ? 'Done' : isInProgress ? 'In Progress' : 'Remaining',
      });
    }
  });

  const plannedWeekBreakdown = weekBreakdown.filter((wb) => wb.weekNum <= weeks);
  const doneWeekNums = plannedWeekBreakdown.filter((wb) => wb.status === 'Done').map((wb) => wb.weekNum);
  const remainingWeekItems = plannedWeekBreakdown.filter((wb) => wb.status !== 'Done');

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

  // Organize session notes by scope/day + week, plus collect all exercise & warmup notes
  const daySessionNotes = new Map<string, Array<{ weekNum: number; scope: string; note: string }>>();
  const globalSessionNotes: Array<{ weekNum: number; scope: string; note: string }> = [];
  const allCollectedNotes: Array<{
    category: 'Session Feedback' | 'Coach Note' | 'Exercise Week Note' | 'Warm-up Note';
    label: string;
    note: string;
    sortWeek: number;
  }> = [];

  warmupExercises.forEach((wu, wuIdx) => {
    const wuCoachNote = pdfSafeText(wu.notes);
    if (wuCoachNote) {
      allCollectedNotes.push({
        category: 'Warm-up Note',
        label: `Warm-up #${wuIdx + 1}: ${pdfSafeText(wu.name)}`,
        note: wuCoachNote,
        sortWeek: 0,
      });
    }
    sortedWeekNums.forEach((w) => {
      const wNote = pdfSafeText(plan.warmupLogs?.[weekKey(w - 1)]?.[wu.id]?.notes);
      if (wNote) {
        allCollectedNotes.push({
          category: 'Warm-up Note',
          label: `Week ${w} - Warm-up: ${pdfSafeText(wu.name)}`,
          note: wNote,
          sortWeek: w,
        });
      }
    });
  });

  exercises.forEach((ex, idx) => {
    const exCoachNote = pdfSafeText(ex.notes);
    if (exCoachNote) {
      allCollectedNotes.push({
        category: 'Coach Note',
        label: `#${idx + 1} ${pdfSafeText(ex.name)}${ex.day?.trim() ? ` (${pdfSafeText(ex.day)})` : ''}`,
        note: exCoachNote,
        sortWeek: 0,
      });
    }
    sortedWeekNums.forEach((w) => {
      const wNote = pdfSafeText(plan.exerciseLogs?.[weekKey(w - 1)]?.[ex.id]?.notes);
      if (wNote) {
        allCollectedNotes.push({
          category: 'Exercise Week Note',
          label: `Week ${w} - #${idx + 1} ${pdfSafeText(ex.name)}`,
          note: wNote,
          sortWeek: w,
        });
      }
    });
  });

  Object.entries(plan.exerciseLogs || {}).forEach(([wKeyStr, logsMap]) => {
    const m = wKeyStr.match(/^w(\d+)$/i);
    const weekNum = m ? parseInt(m[1], 10) : 1;
    Object.entries(logsMap || {}).forEach(([entryKey, entryVal]) => {
      if (!entryKey.startsWith('__session_note__')) return;
      const text = pdfSafeText(entryVal?.notes);
      if (!text) return;
      const scope =
        pdfSafeText(entryVal?.day) ||
        (entryKey === '__session_note__ALL'
          ? 'All Days'
          : entryKey.replace(/^__session_note__/, '').replace(/_/g, ' '));
      allCollectedNotes.push({
        category: 'Session Feedback',
        label: `Week ${weekNum} - ${scope}`,
        note: text,
        sortWeek: weekNum,
      });
      const matchedDay = dayOrder.find(d => pdfSafeText(d).toLowerCase() === scope.toLowerCase());
      if (matchedDay) {
        if (!daySessionNotes.has(matchedDay)) daySessionNotes.set(matchedDay, []);
        daySessionNotes.get(matchedDay)!.push({ weekNum, scope, note: text });
      } else {
        globalSessionNotes.push({ weekNum, scope, note: text });
      }
    });
  });

  let y = 13;
  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 14;
    }
  };

  // =========================================================================
  // 1. EXECUTIVE HEADER BANNER
  // =========================================================================
  doc.setFillColor(17, 20, 28);
  doc.roundedRect(margin, y, contentWidth, 33, 3, 3, 'F');
  doc.setFillColor(220, 38, 38);
  doc.rect(margin, y, 2.8, 33, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(248, 113, 113);
  doc.text('GYM WORKOUT  -  TRAINING PROGRAM, WEEKS & PERFORMANCE REPORT', margin + 6, y + 6.2);

  doc.setFontSize(15.5);
  doc.setTextColor(255, 255, 255);
  const titleLine = doc.splitTextToSize(pdfSafeText(plan.title) || 'Workout Plan', contentWidth - 12)[0];
  doc.text(titleLine, margin + 6, y + 13.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(203, 213, 225);
  const memberLabel = pdfSafeText(options.ownerName || plan.ownerUsername || 'Athlete');
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const planUpdatedRaw = plan.updatedAt || plan.createdAt;
  const planUpdatedDate =
    planUpdatedRaw && Number.isFinite(Date.parse(planUpdatedRaw))
      ? new Date(Date.parse(planUpdatedRaw)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : exportDate;
  const waterMeta =
    typeof options.waterGlasses === 'number'
      ? `  |  Water: ${options.waterGlasses}/${resolvedWaterGoal} Gl (${consumedWaterLiters}/${resolvedTargetLiters} L)`
      : '';
  const metaLine = `Athlete: ${memberLabel}  |  ${dayOrder.length} Day${dayOrder.length === 1 ? '' : 's'}  |  ${exercises.length} Exercises  |  ${weeks} Week${weeks === 1 ? '' : 's'} (${doneWeekNums.length} Done, ${remainingWeekItems.length} Left)  |  Unit: ${planUnit.toUpperCase()}${waterMeta}`;
  doc.text(doc.splitTextToSize(metaLine, contentWidth - 12)[0] || metaLine, margin + 6, y + 20.5);

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  const subMetaParts = [
    `Updated: ${planUpdatedDate}`,
    plan.sourceFileName ? `Sheet: ${pdfSafeText(plan.sourceFileName)}` : '',
    allCollectedNotes.length > 0 ? `Notes Logged: ${allCollectedNotes.length}` : '',
    `Exported: ${exportDate}`,
  ].filter(Boolean);
  doc.text(doc.splitTextToSize(subMetaParts.join('  |  '), contentWidth - 12)[0] || '', margin + 6, y + 26.8);
  y += 37;

  if (plan.description && pdfSafeText(plan.description)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const descLines = doc.splitTextToSize(pdfSafeText(plan.description), contentWidth);
    ensureSpace(descLines.length * 4.2 + 3);
    doc.text(descLines, margin, y);
    y += descLines.length * 4.2 + 3;
  }

  // =========================================================================
  // 2. KPI METRICS STRIP + PROGRESS BAR
  // =========================================================================
  ensureSpace(28);
  const kpiGap = 3;
  const kpiW = (contentWidth - kpiGap * 3) / 4;
  const kpis = [
    { label: 'OVERALL COMPLETION', value: `${overallPct}% (${totalDone}/${totalPossible})` },
    { label: 'TRAINING WEEKS', value: `${doneWeekNums.length} Done / ${remainingWeekItems.length} Left` },
    { label: 'SETS LOGGED', value: `${totalSetsLogged} Set${totalSetsLogged === 1 ? '' : 's'} (${exercises.length} Ex)` },
    {
      label: 'HYDRATION TODAY',
      value:
        typeof options.waterGlasses === 'number'
          ? `${options.waterGlasses}/${resolvedWaterGoal} Gl (${consumedWaterLiters}/${resolvedTargetLiters}L)`
          : `${weeks}w (${planUnit.toUpperCase()})`,
    },
  ];
  kpis.forEach((kpi, kIdx) => {
    const kx = margin + kIdx * (kpiW + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(kx, y, kpiW, 14, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, kx + 2.8, y + 4.8);

    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(kpi.value, kpiW - 5)[0] || kpi.value, kx + 2.8, y + 10.6);
  });
  y += 17;

  // Progress bar + Weekly strip
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 3, 1.5, 1.5, 'F');
  if (overallPct > 0) {
    doc.setFillColor(220, 38, 38);
    doc.roundedRect(margin, y, Math.max(3, (contentWidth * overallPct) / 100), 3, 1.5, 1.5, 'F');
  }
  y += 6.5;

  // =========================================================================
  // 2B. WEEKLY TRAINING SCHEDULE (DONE VS REMAINING WEEKS)
  // =========================================================================
  if (weekBreakdown.length > 0) {
    const doneWeeksLabel = doneWeekNums.length > 0 ? doneWeekNums.map((n) => `W${n}`).join(', ') : 'None yet';
    const remainingWeeksLabel =
      remainingWeekItems.length > 0
        ? remainingWeekItems
            .map((rw) => (rw.status === 'In Progress' ? `W${rw.weekNum} (${rw.doneCount}/${rw.totalCount})` : `W${rw.weekNum}`))
            .join(', ')
        : 'All planned weeks complete';
    const summaryLine = `Done Weeks (${doneWeekNums.length}): ${doneWeeksLabel}   |   Remaining Weeks (${remainingWeekItems.length}): ${remainingWeeksLabel}`;
    const summaryWrapped = doc.splitTextToSize(summaryLine, contentWidth - 4);
    const wkRowH = 5.6;
    ensureSpace(15 + summaryWrapped.length * 3.8 + Math.min(weekBreakdown.length, 6) * wkRowH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Weekly Progress Schedule (Done vs Remaining Weeks)', margin, y);
    y += 4.2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(summaryWrapped, margin, y);
    y += summaryWrapped.length * 3.8 + 2.5;

    const wkCols = [contentWidth * 0.16, contentWidth * 0.24, contentWidth * 0.24, contentWidth * 0.18, contentWidth * 0.18];
    const wkHdrs = ['Week', 'Status', 'Completed Ex', 'Sets Logged', 'Notes'];
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, contentWidth, 6.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(255, 255, 255);
    let wkx = margin;
    wkHdrs.forEach((h, i) => {
      doc.text(h, wkx + 2.5, y + 4.3);
      wkx += wkCols[i];
    });
    y += 6.2;

    weekBreakdown.forEach((wb, idx) => {
      ensureSpace(wkRowH + 2);
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentWidth, wkRowH, 'FD');

      let rx = margin;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(15, 23, 42);
      doc.text(`Week ${wb.weekNum}`, rx + 2.5, y + 4);
      rx += wkCols[0];

      doc.setFont('helvetica', 'bold');
      if (wb.status === 'Done') doc.setTextColor(22, 163, 74);
      else if (wb.status === 'In Progress') doc.setTextColor(217, 119, 6);
      else doc.setTextColor(100, 116, 139);
      doc.text(wb.status, rx + 2.5, y + 4);
      rx += wkCols[1];

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const exPct = wb.totalCount > 0 ? Math.round((wb.doneCount / wb.totalCount) * 100) : 0;
      doc.text(`${wb.doneCount}/${wb.totalCount} (${exPct}%)`, rx + 2.5, y + 4);
      rx += wkCols[2];
      doc.text(String(wb.setsCount), rx + 2.5, y + 4);
      rx += wkCols[3];
      doc.text(wb.notesCount > 0 ? `${wb.notesCount} note${wb.notesCount === 1 ? '' : 's'}` : '-', rx + 2.5, y + 4);
      y += wkRowH;
    });
    y += 5.5;
  }

  // =========================================================================
  // 3. TRAINING SPLIT BY DAY (COMBINED OVERVIEW TABLE)
  // =========================================================================
  if (dayOrder.length > 0) {
    const rowH = 6.2;
    const tblH = 12 + dayOrder.length * rowH;
    ensureSpace(Math.min(tblH + 4, 65));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Program Split Summary (By Training Day)', margin, y);
    y += 4;

    const colWidths = [contentWidth * 0.44, contentWidth * 0.16, contentWidth * 0.18, contentWidth * 0.22];
    const headers = ['Training Day', 'Exercises', 'Target Sets', 'Completion'];

    // Header row
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, contentWidth, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(255, 255, 255);
    let cx = margin;
    headers.forEach((h, i) => {
      doc.text(h, cx + 2.5, y + 4.6);
      cx += colWidths[i];
    });
    y += 6.8;

    dayOrder.forEach((dayName, dIdx) => {
      ensureSpace(rowH + 2);
      const list = dayExercisesMap.get(dayName) || [];
      const dayTargetSets = list.reduce((acc, item) => acc + parseSetsCount(item.ex.sets), 0);
      let dayDoneCount = 0;
      const dayPossible = list.length * weeks;
      sortedWeekNums.forEach((w) => {
        const wk = weekKey(w - 1);
        const doneSet = new Set(plan.progress?.[wk] || []);
        list.forEach(({ ex }) => {
          if (w <= weeks && doneSet.has(ex.id)) dayDoneCount++;
        });
      });
      const dayPct = dayPossible > 0 ? Math.round((dayDoneCount / dayPossible) * 100) : 0;

      doc.setFillColor(dIdx % 2 === 0 ? 255 : 248, dIdx % 2 === 0 ? 255 : 250, dIdx % 2 === 0 ? 255 : 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentWidth, rowH, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      let rx = margin;
      doc.text(doc.splitTextToSize(pdfSafeText(dayName), colWidths[0] - 4)[0] || dayName, rx + 2.5, y + 4.3);
      rx += colWidths[0];

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(String(list.length), rx + 2.5, y + 4.3);
      rx += colWidths[1];
      doc.text(String(dayTargetSets), rx + 2.5, y + 4.3);
      rx += colWidths[2];
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(dayPct === 100 ? 22 : 185, dayPct === 100 ? 163 : 28, dayPct === 100 ? 74 : 28);
      doc.text(`${dayPct}% (${dayDoneCount}/${dayPossible})`, rx + 2.5, y + 4.3);

      y += rowH;
    });
    y += 6;
  }

  // =========================================================================
  // 4. INFORMATION & INSTRUCTIONS
  // =========================================================================
  if (plan.instructions && pdfSafeText(plan.instructions)) {
    const instrLines = doc.splitTextToSize(pdfSafeText(plan.instructions), contentWidth - 8);
    const boxHeight = Math.min(72, instrLines.length * 4 + 10);
    ensureSpace(boxHeight + 5);

    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(3, 105, 161);
    doc.text('Coach Information & Program Instructions', margin + 4, y + 5.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(30, 41, 59);
    const maxVisible = Math.floor((boxHeight - 9) / 4);
    doc.text(instrLines.slice(0, maxVisible), margin + 4, y + 10.5);
    y += boxHeight + 5.5;
  }

  // =========================================================================
  // 5. WARM-UP PROTOCOL TABLE
  // =========================================================================
  if (warmupExercises.length > 0) {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(146, 64, 14);
    doc.text(`Warm-up Protocol (${warmupExercises.length} Movement${warmupExercises.length === 1 ? '' : 's'})`, margin, y);
    y += 4;

    const wuCols = [10, contentWidth * 0.34, 22, 22, contentWidth - 54 - contentWidth * 0.34];
    doc.setFillColor(180, 83, 9);
    doc.rect(margin, y, contentWidth, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(255, 255, 255);
    const wuHeaders = ['#', 'Warm-up Movement', 'Minutes', 'Sets', 'Target / Weekly Logs'];
    let wx = margin;
    wuHeaders.forEach((h, i) => {
      doc.text(h, wx + 2, y + 4.4);
      wx += wuCols[i];
    });
    y += 6.5;

    warmupExercises.forEach((wu, wuIdx) => {
      const logBits: string[] = [];
      sortedWeekNums.forEach((w) => {
        const wEntry = plan.warmupLogs?.[weekKey(w - 1)]?.[wu.id];
        if (!wEntry) return;
        const popSets = (wEntry.setEntries || []).filter(
          (s) =>
            (s.weight || '').trim() !== '' ||
            (s.reps || '').trim() !== '' ||
            (s.rpe || '').trim() !== '' ||
            (s.rir || '').trim() !== ''
        );
        const parts: string[] = [];
        if (wEntry.completed) parts.push('[Done]');
        if (popSets.length > 0) parts.push(popSets.map((s) => formatCompactSet(s, planUnit, showRpe, showRir)).join(', '));
        if (wEntry.notes?.trim()) parts.push(`Note: ${pdfSafeText(wEntry.notes)}`);
        if (parts.length > 0) logBits.push(`W${w}: ${parts.join(' ')}`);
      });
      const detailParts = [
        wu.target?.trim() ? `Target: ${pdfSafeText(wu.target)}` : '',
        wu.notes?.trim() ? `Note: ${pdfSafeText(wu.notes)}` : '',
        ...logBits,
      ].filter(Boolean);
      const detailStr = detailParts.join('  |  ') || '-';
      const detailWrapped = doc.splitTextToSize(detailStr, wuCols[4] - 4);
      const rHeight = Math.max(6.4, detailWrapped.length * 3.8 + 2.6);

      ensureSpace(rHeight + 2);
      doc.setFillColor(wuIdx % 2 === 0 ? 255 : 255, wuIdx % 2 === 0 ? 251 : 247, wuIdx % 2 === 0 ? 235 : 225);
      doc.setDrawColor(253, 230, 138);
      doc.rect(margin, y, contentWidth, rHeight, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(120, 53, 15);
      let xPos = margin;
      doc.text(String(wuIdx + 1), xPos + 2, y + 4.3);
      xPos += wuCols[0];
      doc.text(doc.splitTextToSize(pdfSafeText(wu.name), wuCols[1] - 4)[0] || '', xPos + 2, y + 4.3);
      xPos += wuCols[1];
      doc.setFont('helvetica', 'normal');
      doc.text(wu.minutes?.trim() ? `${wu.minutes.trim()}m` : '-', xPos + 2, y + 4.3);
      xPos += wuCols[2];
      doc.text(wu.targetSets?.trim() || '-', xPos + 2, y + 4.3);
      xPos += wuCols[3];
      doc.setFontSize(7.4);
      doc.setTextColor(51, 65, 85);
      doc.text(detailWrapped, xPos + 2, y + 4.1);

      y += rHeight;
    });
    y += 6.5;
  }

  // =========================================================================
  // 6. COMBINED DAY SECTIONS (EXERCISES + WEEKLY SET TABLES + DAY NOTES)
  // =========================================================================
  dayOrder.forEach((dayName, dayIdx) => {
    const dayItems = dayExercisesMap.get(dayName) || [];
    const dayNotes = (daySessionNotes.get(dayName) || []).sort((a, b) => a.weekNum - b.weekNum);
    const dayTargetSets = dayItems.reduce((acc, item) => acc + parseSetsCount(item.ex.sets), 0);

    ensureSpace(26);
    // Bold Day Group Banner
    doc.setFillColor(24, 24, 32);
    doc.roundedRect(margin, y, contentWidth, 9.5, 2, 2, 'F');
    doc.setFillColor(220, 38, 38);
    doc.rect(margin, y, 2.5, 9.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `DAY ${dayIdx + 1}: ${doc.splitTextToSize(pdfSafeText(dayName).toUpperCase(), contentWidth * 0.56)[0]}`,
      margin + 5,
      y + 6.2
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    const rightMeta = `${dayItems.length} Exercises  |  ${dayTargetSets} Target Sets`;
    doc.text(rightMeta, pageWidth - margin - 3, y + 6.2, { align: 'right' });
    y += 12.5;

    dayItems.forEach(({ ex, globalIdx }) => {
      const { setsDisplay, repsDisplay } = getTargetText(ex);
      const completedWeeks: string[] = [];
      for (let w = 1; w <= weeks; w++) {
        if ((plan.progress?.[weekKey(w - 1)] || []).includes(ex.id)) {
          completedWeeks.push(`W${w}`);
        }
      }

      // Build structured weekly log rows for this exercise (No Volume; conditional RPE & RIR)
      const weekTableRows: Array<{
        wkLabel: string;
        status: string;
        setsText: string;
        avgRpe: string;
        avgRir: string;
        note: string;
      }> = [];

      sortedWeekNums.forEach((w) => {
        const wk = weekKey(w - 1);
        const entry = plan.exerciseLogs?.[wk]?.[ex.id];
        const isDone = (plan.progress?.[wk] || []).includes(ex.id);
        const popSets = getPopulatedSetList(ex, entry, planUnit);
        const wkNote = pdfSafeText(entry?.notes);
        if (popSets.length === 0 && !wkNote && !isDone) return;

        weekTableRows.push({
          wkLabel: `W${w}`,
          status: isDone ? 'Done' : '-',
          setsText: popSets.length > 0 ? popSets.map((s) => formatCompactSet(s, planUnit, showRpe, showRir)).join('  |  ') : '-',
          avgRpe: showRpe && popSets.length > 0 ? calcAvgMetric(popSets, 'rpe') : '-',
          avgRir: showRir && popSets.length > 0 ? calcAvgMetric(popSets, 'rir') : '-',
          note: wkNote || '',
        });
      });

      const metaBadges: string[] = [];
      if (ex.isSuperset) {
        metaBadges.push(
          ex.supersetGroup && ex.supersetGroup.toUpperCase() !== 'SUPERSET'
            ? `SUPERSET (${pdfSafeText(ex.supersetGroup)})`
            : 'SUPERSET'
        );
      }
      if (setsDisplay || repsDisplay) {
        metaBadges.push(`Target: ${[setsDisplay && `${setsDisplay} sets`, repsDisplay && `${repsDisplay} reps`].filter(Boolean).join(' x ')}`);
      }
      if (showRpe && ex.targetRpe?.trim()) {
        metaBadges.push(`Target RPE: ${pdfSafeText(ex.targetRpe)}`);
      }
      if (ex.targetRir?.trim()) {
        metaBadges.push(`Target RIR: ${pdfSafeText(ex.targetRir)}`);
      }
      if (completedWeeks.length > 0) {
        metaBadges.push(`Done: ${completedWeeks.join(', ')}`);
      }

      const prevSets = getPopulatedSetList(ex, plan.previousLogs?.[ex.id], planUnit);
      const prevSummaryLine =
        prevSets.length > 0
          ? `Previous: ${prevSets.map((s) => formatCompactSet(s, planUnit, showRpe, showRir)).join('  |  ')}`
          : '';
      const prevLines = prevSummaryLine
        ? doc.splitTextToSize(pdfSafeText(prevSummaryLine), contentWidth - 10)
        : [];

      const coachNotesLines = ex.notes?.trim()
        ? doc.splitTextToSize(`Coach Note: ${pdfSafeText(ex.notes)}`, contentWidth - 12)
        : [];
      const coachNoteBoxH = coachNotesLines.length > 0 ? coachNotesLines.length * 3.8 + 2.6 : 0;

      const extraColW = (showRpe ? 16 : 0) + (showRir ? 16 : 0);
      const setsColW = contentWidth - 6 - 26 - extraColW;
      const wrappedRows = weekTableRows.map((r) => {
        const setLines = doc.splitTextToSize(pdfSafeText(r.setsText), setsColW - 4);
        const noteLines = r.note ? doc.splitTextToSize(`Note: ${pdfSafeText(r.note)}`, setsColW - 4) : [];
        const totalLines = setLines.length + noteLines.length;
        const rh = Math.max(5.5, totalLines * 3.7 + 2.2);
        return { ...r, setLines, noteLines, rh };
      });
      const tableTotalH = wrappedRows.length > 0 ? 5.8 + wrappedRows.reduce((s, r) => s + r.rh, 0) : 7.5;

      const cardH =
        11.5 +
        (metaBadges.length > 0 ? 4.4 : 0) +
        prevLines.length * 3.8 +
        coachNoteBoxH +
        (ex.videoUrl ? 3.8 : 0) +
        tableTotalH +
        3;

      const fitsSingle = cardH <= pageHeight - 36;
      ensureSpace(fitsSingle ? cardH + 2.5 : 32);

      // Card chrome
      const boxDrawH = fitsSingle ? cardH : Math.min(cardH, bottomLimit - y);
      if (ex.isSuperset) {
        doc.setFillColor(253, 244, 255);
        doc.setDrawColor(217, 70, 239);
      } else {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
      }
      doc.roundedRect(margin, y, contentWidth, boxDrawH, 2, 2, 'FD');

      let cy = y + 5.2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(`#${globalIdx + 1}  ${pdfSafeText(ex.name)}`, margin + 3.5, cy);
      cy += 4.3;

      if (metaBadges.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(ex.isSuperset ? 162 : 185, ex.isSuperset ? 28 : 28, ex.isSuperset ? 175 : 28);
        doc.text(doc.splitTextToSize(metaBadges.join('   |   '), contentWidth - 8)[0], margin + 3.5, cy);
        cy += 4.3;
      }

      if (prevLines.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        doc.setTextColor(79, 70, 229);
        doc.text(prevLines, margin + 3.5, cy);
        cy += prevLines.length * 3.8;
      }

      if (coachNotesLines.length > 0) {
        doc.setFillColor(255, 251, 235);
        doc.setDrawColor(253, 230, 138);
        doc.roundedRect(margin + 3, cy - 2.6, contentWidth - 6, coachNoteBoxH - 0.8, 1.2, 1.2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        doc.setTextColor(146, 64, 14);
        doc.text(coachNotesLines, margin + 4.5, cy + 0.8);
        cy += coachNoteBoxH;
      }

      if (ex.videoUrl) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.3);
        doc.setTextColor(37, 99, 235);
        doc.text(doc.splitTextToSize(`Video: ${pdfSafeText(ex.videoUrl)}`, contentWidth - 8)[0], margin + 3.5, cy);
        cy += 3.8;
      }

      if (wrappedRows.length > 0) {
        // Sub-table Header
        doc.setFillColor(241, 245, 249);
        doc.setDrawColor(203, 213, 225);
        doc.rect(margin + 3, cy, contentWidth - 6, 5.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(51, 65, 85);

        const metricSuffix = [showRpe ? 'RPE' : '', showRir ? 'RIR' : ''].filter(Boolean).join('/');
        const setsHeaderLabel = metricSuffix
          ? `Logged Sets & Notes (Wt x Reps - ${metricSuffix})`
          : 'Logged Sets & Notes (Weight x Reps)';
        const tblHeaders: string[] = ['Week', 'Done', setsHeaderLabel];
        const innerCols: number[] = [13, 13, setsColW];
        if (showRpe) {
          tblHeaders.push('RPE Avg');
          innerCols.push(16);
        }
        if (showRir) {
          tblHeaders.push('RIR Avg');
          innerCols.push(16);
        }

        let tx = margin + 3;
        tblHeaders.forEach((hdr, i) => {
          doc.text(hdr, tx + 1.8, cy + 3.9);
          tx += innerCols[i];
        });
        cy += 5.5;

        wrappedRows.forEach((wr, rIdx) => {
          if (cy + wr.rh > bottomLimit) {
            doc.addPage();
            cy = 16;
          }
          doc.setFillColor(rIdx % 2 === 0 ? 255 : 248, rIdx % 2 === 0 ? 255 : 250, rIdx % 2 === 0 ? 255 : 252);
          doc.setDrawColor(226, 232, 240);
          doc.rect(margin + 3, cy, contentWidth - 6, wr.rh, 'FD');

          let rx = margin + 3;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(15, 23, 42);
          doc.text(wr.wkLabel, rx + 1.8, cy + 3.8);
          rx += innerCols[0];

          doc.setFont('helvetica', 'bold');
          doc.setTextColor(wr.status === 'Done' ? 22 : 148, wr.status === 'Done' ? 163 : 163, wr.status === 'Done' ? 74 : 184);
          doc.text(wr.status, rx + 1.8, cy + 3.8);
          rx += innerCols[1];

          doc.setFont('courier', 'normal');
          doc.setFontSize(7.2);
          doc.setTextColor(30, 41, 59);
          doc.text(wr.setLines, rx + 1.8, cy + 3.8);
          if (wr.noteLines.length > 0) {
            const noteY = cy + 3.8 + wr.setLines.length * 3.7;
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(7.3);
            doc.setTextColor(146, 64, 14);
            doc.text(wr.noteLines, rx + 1.8, noteY);
          }
          rx += innerCols[2];

          let extraColIdx = 3;
          if (showRpe) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(180, 83, 9);
            doc.text(wr.avgRpe, rx + 1.8, cy + 3.8);
            rx += innerCols[extraColIdx];
            extraColIdx++;
          }
          if (showRir) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(3, 105, 161);
            doc.text(wr.avgRir, rx + 1.8, cy + 3.8);
          }

          cy += wr.rh;
        });
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.6);
        doc.setTextColor(148, 163, 184);
        doc.text('No weekly logs recorded for this exercise yet.', margin + 3.5, cy + 3.8);
        cy += 6.5;
      }

      y = cy + 4.5;
    });

    // Render any Day-Matched Session Notes right at the close of that Day's block
    if (dayNotes.length > 0) {
      dayNotes.forEach((dn) => {
        const wrapped = doc.splitTextToSize(dn.note, contentWidth - 10);
        const nh = 9 + wrapped.length * 3.8;
        ensureSpace(nh + 3);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(margin, y, contentWidth, nh, 1.8, 1.8, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(185, 28, 28);
        doc.text(`${pdfSafeText(dayName)} - Week ${dn.weekNum} Session Feedback`, margin + 3.5, y + 4.8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(30, 41, 59);
        doc.text(wrapped, margin + 3.5, y + 8.8);
        y += nh + 3;
      });
    }

    y += 3;
  });

  // =========================================================================
  // 7. CONSOLIDATED NOTES, COACH CUES & SESSION FEEDBACK
  // =========================================================================
  const hasAnyNotesSection =
    allCollectedNotes.length > 0 || globalSessionNotes.length > 0;
  if (hasAnyNotesSection) {
    const categoryOrder: Record<string, number> = {
      'Session Feedback': 1,
      'Exercise Week Note': 2,
      'Coach Note': 3,
      'Warm-up Note': 4,
    };
    const sortedNotes = [...allCollectedNotes].sort(
      (a, b) =>
        (categoryOrder[a.category] || 9) - (categoryOrder[b.category] || 9) ||
        a.sortWeek - b.sortWeek ||
        a.label.localeCompare(b.label)
    );

    ensureSpace(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Notes, Coach Cues & Session Feedback (${sortedNotes.length})`, margin, y);
    y += 4.5;

    sortedNotes.forEach((item) => {
      const wrapped = doc.splitTextToSize(item.note, contentWidth - 10);
      const boxH = 9.2 + wrapped.length * 3.9;
      ensureSpace(boxH + 3);

      if (item.category === 'Coach Note' || item.category === 'Warm-up Note') {
        doc.setFillColor(255, 251, 235);
        doc.setDrawColor(253, 230, 138);
      } else {
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
      }
      doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      if (item.category === 'Session Feedback') doc.setTextColor(185, 28, 28);
      else if (item.category === 'Exercise Week Note') doc.setTextColor(3, 105, 161);
      else doc.setTextColor(146, 64, 14);
      doc.text(`[${item.category}]  ${item.label}`, margin + 4, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(wrapped, margin + 4, y + 9.1);
      y += boxH + 2.8;
    });
  }

}

function applyPdfFooters(doc: jsPDF, footerTitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 13;
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Gym Workout  -  ${pdfSafeText(footerTitle)}`, margin, pageHeight - 6.5);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 6.5, { align: 'right' });
  }
}

export function buildWorkoutPlanPdfDocument(
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {}
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  renderPlanIntoPdfDoc(doc, plan, options, false);
  applyPdfFooters(doc, plan.title || 'Workout Plan');
  return doc;
}

export function buildAllWorkoutPlansPdfDocument(
  plans: WorkoutPlan[],
  options: ExportWorkoutPdfOptions = {}
): jsPDF {
  if (plans.length <= 1 && plans[0]) {
    return buildWorkoutPlanPdfDocument(plans[0], options);
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 13;
  const contentWidth = pageWidth - margin * 2;
  let y = 13;

  doc.setFillColor(17, 20, 28);
  doc.roundedRect(margin, y, contentWidth, 27, 3, 3, 'F');
  doc.setFillColor(220, 38, 38);
  doc.rect(margin, y, 2.8, 27, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(248, 113, 113);
  doc.text('GYM WORKOUT  -  COMPLETE MULTI-SPLIT PROGRAM REPORT', margin + 6, y + 6.5);

  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(`All Workouts Portfolio (${plans.length} Programs)`, margin + 6, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const memberLabel = pdfSafeText(options.ownerName || plans[0]?.ownerUsername || 'Athlete');
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const multiWaterGoal = Math.max(1, Math.round(options.waterGoalGlasses || 8));
  const multiWaterStr =
    typeof options.waterGlasses === 'number'
      ? `  |  Water: ${options.waterGlasses}/${multiWaterGoal} Gl`
      : '';
  doc.text(`Athlete: ${memberLabel}  |  Total Plans: ${plans.length}${multiWaterStr}  |  ${exportDate}`, margin + 6, y + 21);
  y += 33;

  // Overview table of all uploaded splits / programs
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('Included Workout Programs & Splits', margin, y);
  y += 4;

  const cols = [contentWidth * 0.30, contentWidth * 0.30, contentWidth * 0.11, contentWidth * 0.17, contentWidth * 0.12];
  const hdrs = ['Workout Title', 'Days / Split', 'Exercises', 'Done / Left Wks', 'Done %'];
  doc.setFillColor(30, 41, 59);
  doc.rect(margin, y, contentWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(255, 255, 255);
  let cx = margin;
  hdrs.forEach((h, i) => {
    doc.text(h, cx + 2, y + 4.6);
    cx += cols[i];
  });
  y += 6.8;

  plans.forEach((p, idx) => {
    if (y + 8 > pageHeight - 18) {
      doc.addPage();
      y = 14;
    }
    const exs = p.exercises || [];
    const wks = Math.max(1, Number(p.weeks) || 1);
    const daysList = Array.from(new Set(exs.map((e) => normalizeDayKey(e.day))));
    let doneCount = 0;
    let doneWks = 0;
    for (let w = 0; w < wks; w++) {
      const len = (p.progress?.[weekKey(w)] || []).length;
      doneCount += len;
      if (exs.length > 0 && len >= exs.length) doneWks++;
    }
    const remWks = Math.max(0, wks - doneWks);
    const totalPossible = exs.length * wks;
    const pct = totalPossible > 0 ? Math.round((doneCount / totalPossible) * 100) : 0;

    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentWidth, 6.6, 'FD');

    let rx = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(doc.splitTextToSize(pdfSafeText(p.title), cols[0] - 3)[0] || '', rx + 2, y + 4.4);
    rx += cols[0];

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(pdfSafeText(daysList.join(' - ')), cols[1] - 3)[0] || '', rx + 2, y + 4.4);
    rx += cols[1];
    doc.text(String(exs.length), rx + 2, y + 4.4);
    rx += cols[2];
    doc.text(`${doneWks}d / ${remWks}r (${wks}w)`, rx + 2, y + 4.4);
    rx += cols[3];
    doc.setFont('helvetica', 'bold');
    doc.text(`${pct}%`, rx + 2, y + 4.4);

    y += 6.6;
  });

  plans.forEach((plan) => {
    renderPlanIntoPdfDoc(doc, plan, options, true);
  });

  applyPdfFooters(doc, `All Workouts (${plans.length})`);
  return doc;
}

export function getWorkoutPdfFilename(plan: WorkoutPlan): string {
  const safeSlug =
    (plan.title || 'workout-plan')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'workout-plan';
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `${safeSlug}-${dateStamp}.pdf`;
}

export function exportAllWorkoutPlansToPdfBuffer(
  plans: WorkoutPlan[],
  options: ExportWorkoutPdfOptions = {}
): { filename: string; buffer: Uint8Array } {
  const doc = buildAllWorkoutPlansPdfDocument(plans, options);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const athleteSlug =
    (options.ownerName || plans[0]?.ownerUsername || 'athlete')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'athlete';
  const filename = `gym-all-workouts-${athleteSlug}-${dateStamp}.pdf`;
  return { filename, buffer: new Uint8Array(doc.output('arraybuffer')) };
}

export function exportAllWorkoutPlansToPdf(
  plans: WorkoutPlan[],
  options: ExportWorkoutPdfOptions = {}
): string {
  const doc = buildAllWorkoutPlansPdfDocument(plans, options);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const athleteSlug =
    (options.ownerName || plans[0]?.ownerUsername || 'athlete')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'athlete';
  const filename = `gym-all-workouts-${athleteSlug}-${dateStamp}.pdf`;
  doc.save(filename);
  return filename;
}

export function exportWorkoutPlanToPdfBuffer(
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {}
): { filename: string; buffer: Uint8Array } {
  const doc = buildWorkoutPlanPdfDocument(plan, options);
  const filename = getWorkoutPdfFilename(plan);
  const arrayBuffer = doc.output('arraybuffer');
  return {
    filename,
    buffer: new Uint8Array(arrayBuffer),
  };
}

export function exportWorkoutPlanToPdf(
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {}
): string {
  const doc = buildWorkoutPlanPdfDocument(plan, options);
  const filename = getWorkoutPdfFilename(plan);
  doc.save(filename);
  return filename;
}
