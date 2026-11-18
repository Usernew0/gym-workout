import { jsPDF } from 'jspdf';
import { ExerciseLogEntry, SetLogEntry, WeightUnit, WorkoutExercise, WorkoutPlan } from '../types';
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
    .replace(/[→➔➔]/g, '->')
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

function entryHasData(entry?: ExerciseLogEntry): boolean {
  if (!entry) return false;
  if (entry.setEntries && entry.setEntries.some(s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '')) {
    return true;
  }
  return Boolean(entry.weight?.trim() || entry.reps?.trim() || entry.sets?.trim());
}

function formatSetEntries(
  ex: WorkoutExercise,
  entry: ExerciseLogEntry,
  fallbackUnit: WeightUnit
): string {
  const list: SetLogEntry[] =
    entry.setEntries && entry.setEntries.length > 0
      ? entry.setEntries.filter(s => (s.weight || '').trim() !== '' || (s.reps || '').trim() !== '')
      : [
          {
            setNumber: 1,
            weight: entry.weight || '',
            unit: entry.unit || fallbackUnit,
            reps: entry.reps || '',
          },
        ];

  if (list.length === 0) {
    const count = parseSetsCount(ex.sets);
    return `${count} sets logged`;
  }

  return list
    .map((s) => {
      const wt = (s.weight || '').trim();
      const rp = (s.reps || '').trim();
      const unit = s.unit || entry.unit || fallbackUnit;
      const wtPart = wt ? (wt.toUpperCase() === 'BW' ? 'BW' : `${wt} ${unit}`) : '-';
      const rpPart = rp || '-';
      return `S${s.setNumber}: ${wtPart} x ${rpPart}`;
    })
    .join('  |  ');
}

export interface ExportWorkoutPdfOptions {
  ownerName?: string;
}

/**
 * Generate a multi-page jsPDF summary for a WorkoutPlan, including overall & per-week progress,
 * exercise targets, instructions, notes, and full weekly set-by-set weight/reps history.
 */
export function buildWorkoutPlanPdfDocument(
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {}
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 16;

  const planUnit: WeightUnit = plan.defaultWeightUnit || 'kg';
  const weeks = Math.max(1, Number(plan.weeks) || 1);
  const exercises = plan.exercises || [];

  let totalDone = 0;
  const totalPossible = exercises.length * weeks;
  for (let w = 0; w < weeks; w++) {
    totalDone += (plan.progress?.[weekKey(w)] || []).length;
  }
  const overallPct = totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0;

  let y = 14;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 16;
    }
  };

  // --- HEADER BANNER ---
  doc.setFillColor(18, 18, 22);
  doc.roundedRect(margin, y, contentWidth, 28, 3, 3, 'F');
  doc.setFillColor(220, 38, 38);
  doc.rect(margin, y, 2.5, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(248, 113, 113);
  doc.text('IRON HOUSE - WORKOUT PLAN & PROGRESS SUMMARY', margin + 6, y + 7);

  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(pdfSafeText(plan.title) || 'Workout Plan', contentWidth - 12);
  doc.text(titleLines[0], margin + 6, y + 14.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 210);
  const memberLabel = pdfSafeText(options.ownerName || plan.ownerUsername || 'Member');
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const metaLine = `Member: ${memberLabel}   |   ${exercises.length} Exercises   |   ${weeks} Week${weeks === 1 ? '' : 's'}   |   Unit: ${planUnit.toUpperCase()}   |   Exported: ${exportDate}`;
  doc.text(metaLine, margin + 6, y + 22);

  y += 33;

  if (plan.description && pdfSafeText(plan.description)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(75, 85, 99);
    const descLines = doc.splitTextToSize(pdfSafeText(plan.description), contentWidth);
    ensureSpace(descLines.length * 4.5 + 3);
    doc.text(descLines, margin, y);
    y += descLines.length * 4.5 + 3;
  }

  // --- OVERALL & WEEKLY PROGRESS CARD ---
  ensureSpace(28);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 23, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Overall Progress: ${overallPct}% (${totalDone}/${totalPossible} exercise completions)`, margin + 4, y + 6.5);

  // Progress bar
  const barWidth = contentWidth - 8;
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(margin + 4, y + 9, barWidth, 3.2, 1.5, 1.5, 'F');
  if (overallPct > 0) {
    doc.setFillColor(220, 38, 38);
    doc.roundedRect(margin + 4, y + 9, Math.max(2, (barWidth * overallPct) / 100), 3.2, 1.5, 1.5, 'F');
  }

  // Week pills summary line
  const weekSummaryTokens: string[] = [];
  for (let w = 1; w <= weeks; w++) {
    const doneInW = (plan.progress?.[weekKey(w - 1)] || []).length;
    const isDone = exercises.length > 0 && doneInW === exercises.length;
    weekSummaryTokens.push(`W${w}: ${doneInW}/${exercises.length}${isDone ? ' [Done]' : ''}`);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const weekLines = doc.splitTextToSize(weekSummaryTokens.join('   |   '), contentWidth - 8);
  doc.text(weekLines[0] || '', margin + 4, y + 17.5);
  if (weekLines.length > 1) {
    doc.text(weekLines[1], margin + 4, y + 21);
  }

  y += 28;

  // --- INFORMATION & INSTRUCTIONS ---
  if (plan.instructions && pdfSafeText(plan.instructions)) {
    const instrLines = doc.splitTextToSize(pdfSafeText(plan.instructions), contentWidth - 8);
    const boxHeight = Math.min(80, instrLines.length * 4.2 + 10);
    ensureSpace(boxHeight + 4);

    doc.setFillColor(240, 249, 255);
    doc.setDrawColor(186, 230, 253);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(3, 105, 161);
    doc.text('Information & Instructions', margin + 4, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    const maxVisibleLines = Math.floor((boxHeight - 9) / 4.2);
    doc.text(instrLines.slice(0, maxVisibleLines), margin + 4, y + 11);
    y += boxHeight + 5;
  }

  // --- EXERCISES & WEEKLY HISTORY ---
  ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('Exercises & Weekly History', margin, y);
  y += 5;

  exercises.forEach((ex, idx) => {
    const { setsDisplay, repsDisplay } = getTargetText(ex);
    const targetStr = [
      setsDisplay ? `${setsDisplay} sets` : '',
      repsDisplay ? `${repsDisplay} reps` : '',
    ]
      .filter(Boolean)
      .join(' x ');

    // Gather completion weeks for this exercise
    const completedWeeks: string[] = [];
    for (let w = 1; w <= weeks; w++) {
      if ((plan.progress?.[weekKey(w - 1)] || []).includes(ex.id)) {
        completedWeeks.push(`W${w}`);
      }
    }

    // Gather logged week history rows
    const historyLines: string[] = [];
    const loggedWeeks = plan.exerciseLogs || {};
    const weekNumbers = new Set<number>();
    for (let w = 1; w <= weeks; w++) weekNumbers.add(w);
    Object.keys(loggedWeeks).forEach((k) => {
      const m = k.match(/^w(\d+)$/i);
      if (m) weekNumbers.add(parseInt(m[1], 10));
    });

    Array.from(weekNumbers)
      .sort((a, b) => a - b)
      .forEach((w) => {
        const entry = loggedWeeks[weekKey(w - 1)]?.[ex.id];
        if (!entryHasData(entry)) return;
        const formatted = formatSetEntries(ex, entry!, planUnit);
        historyLines.push(`Week ${w}: ${pdfSafeText(formatted)}`);
      });

    if (plan.previousLogs?.[ex.id] && entryHasData(plan.previousLogs[ex.id])) {
      historyLines.push(`Previous Baseline: ${pdfSafeText(formatSetEntries(ex, plan.previousLogs[ex.id], planUnit))}`);
    }

    const notesLines = ex.notes ? doc.splitTextToSize(`Notes: ${pdfSafeText(ex.notes)}`, contentWidth - 10) : [];
    const wrappedHistoryLines: string[] = [];
    if (historyLines.length > 0) {
      historyLines.forEach((hl) => {
        doc.splitTextToSize(hl, contentWidth - 12).forEach((part: string) => wrappedHistoryLines.push(part));
      });
    } else {
      wrappedHistoryLines.push('No logged weights/reps recorded yet.');
    }

    const headerSubParts: string[] = [];
    if (ex.day) headerSubParts.push(pdfSafeText(ex.day));
    if (ex.isSuperset) {
      headerSubParts.push(
        ex.supersetGroup && ex.supersetGroup.toUpperCase() !== 'SUPERSET'
          ? `SUPERSET (${pdfSafeText(ex.supersetGroup)})`
          : 'SUPERSET'
      );
    }
    if (targetStr) headerSubParts.push(`Target: ${pdfSafeText(targetStr)}`);
    if (completedWeeks.length > 0) headerSubParts.push(`Done: ${completedWeeks.join(', ')}`);

    const cardHeight =
      14 +
      (headerSubParts.length > 0 ? 4.5 : 0) +
      notesLines.length * 4 +
      (ex.videoUrl ? 4.2 : 0) +
      wrappedHistoryLines.length * 4.2;

    const fitsSinglePage = cardHeight <= pageHeight - 36;
    ensureSpace(fitsSinglePage ? cardHeight + 3 : 32);

    // Card background & border (magenta tint if superset)
    const drawHeight = fitsSinglePage ? cardHeight : Math.min(cardHeight, bottomLimit - y);
    if (ex.isSuperset) {
      doc.setFillColor(253, 244, 255);
      doc.setDrawColor(217, 70, 239);
    } else {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
    }
    doc.roundedRect(margin, y, contentWidth, drawHeight, 2, 2, 'FD');

    let cy = y + 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`#${idx + 1}  ${pdfSafeText(ex.name)}`, margin + 4, cy);
    cy += 4.5;

    if (headerSubParts.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(ex.isSuperset ? 162 : 185, ex.isSuperset ? 28 : 28, ex.isSuperset ? 175 : 28);
      const subStr = doc.splitTextToSize(headerSubParts.join('   |   '), contentWidth - 8);
      doc.text(subStr[0], margin + 4, cy);
      cy += 4.5;
    }

    if (notesLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(71, 85, 105);
      doc.text(notesLines, margin + 4, cy);
      cy += notesLines.length * 4;
    }

    if (ex.videoUrl) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(37, 99, 235);
      const videoStr = doc.splitTextToSize(`Video: ${pdfSafeText(ex.videoUrl)}`, contentWidth - 8);
      doc.text(videoStr[0], margin + 4, cy);
      cy += 4.2;
    }

    // History section divider
    doc.setDrawColor(226, 232, 240);
    doc.line(margin + 4, cy - 1, pageWidth - margin - 4, cy - 1);
    cy += 3;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    wrappedHistoryLines.forEach((line) => {
      if (cy > bottomLimit) {
        doc.addPage();
        cy = 18;
      }
      doc.text(line, margin + 5, cy);
      cy += 4.2;
    });

    y = cy + 4;
  });

  // --- PAGE FOOTERS ---
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Iron House Workout Archive - ${pdfSafeText(plan.title)}`, margin, pageHeight - 7);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  return doc;
}

export function exportWorkoutPlanToPdf(
  plan: WorkoutPlan,
  options: ExportWorkoutPdfOptions = {}
): string {
  const doc = buildWorkoutPlanPdfDocument(plan, options);
  const safeSlug = (plan.title || 'workout-plan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workout-plan';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeSlug}-${dateStamp}.pdf`;
  doc.save(filename);
  return filename;
}
