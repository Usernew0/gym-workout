/**
 * Workout sheet parser
 * Supports multi-sheet Excel (.xlsx / .xls), CSV / TSV and PDF files.
 * - Detects combined "Sets x Reps" columns (e.g. "4 × 5–12" -> sets: "4", reps: "5–12") as well as separate Sets/Reps columns.
 * - Detects Superset exercises (SS, A1/A2, B1/B2, Superset column/text) so they highlight specially.
 * - Detects Day/Section headers inside sheets to link exercises to days.
 * - Auto-fetches video URLs from hyperlinks, =HYPERLINK() formulas, or embedded text URLs.
 * - Detects & extracts pre-filled training data if the uploaded sheet already contains weights, reps, kg/lbs units, Week 1..N columns, Set 1..N columns, Previous/Last Week values, or Done flags.
 */

export interface ParsedWeekSetEntry {
  setNumber: number;
  weight: string;
  unit?: 'kg' | 'lbs';
  reps: string;
}

export interface ParsedWeekData {
  weekNumber: number; // 1..52 for Week N; 0 for Previous / Prior / Baseline
  unit?: 'kg' | 'lbs';
  entries: ParsedWeekSetEntry[];
  completed?: boolean;
}

export interface ParsedExerciseRow {
  day?: string;
  name: string;
  sets: string;
  reps: string;
  notes: string;
  video: string;
  isSuperset?: boolean;
  supersetGroup?: string;
  // Pre-filled training data detected in uploaded sheet
  loggedWeight?: string;
  loggedUnit?: 'kg' | 'lbs';
  loggedReps?: string;
  weeklyLogs?: Record<number, ParsedWeekData>;
  completed?: boolean;
}

export type SheetRole = 'workout' | 'instructions' | 'skip';

export interface DetectedSheet {
  name: string;
  rawRows: string[][];
  textContent: string;
  exercises: ParsedExerciseRow[];
  detectedDays: string[];
  suggestedRole: SheetRole;
  headerMatched: boolean;
  detectedDataWeeks: number;
  detectedWeightUnit?: 'kg' | 'lbs';
  prefilledRowCount: number;
}

const HEADER_HINTS = {
  day: /^(day|split|session|workout\s*day|اليوم)$/i,
  superset: /superset|super\s*set|group|pair|code|order|type|method|سوبر/i,
  setsReps: /sets?\s*[x×*\/]\s*reps?|reps?\s*[x×*\/]\s*sets?/i,
  name: /exercise|workout|movement|name|title|تمرين|اسم/i,
  sets: /^(?:target\s*|planned\s*)?(?:sets?|rounds?|المجموعات|جولات)(?:\s*\(.*\))?$/i,
  reps: /^(?:target\s*|planned\s*|goal\s*)?(?:reps?|repetitions?|repeat|التكرار|تكرار)(?:\s*\(.*\))?$/i,
  notes: /note|comment|cue|tempo|rest|تفاصيل|ملاحظ|تعليق/i,
  video: /video|link|url|clip|demo|youtube|فيديو|رابط/i,
};

const INFO_SHEET_NAME_HINT = /info|instruction|guide|intro|readme|note|rule|about|faq|tip|overview|warm|تعليم|معلوم|ارشاد|ملاحظ/i;
const WORKOUT_SHEET_NAME_HINT = /workout|day|week|push|pull|leg|upper|lower|full|chest|back|shoulder|arm|core|program|plan|split|exercise|تمارين|جدول|يوم/i;
const DAY_BANNER_PATTERN = /^(day\s*#?\s*\d+|d\d+|week\s*\d+\s*[-:|]?\s*day\s*\d*|session\s*\d+|workout\s*[a-z0-9]+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|push(\s*day|\s*\d*)?|pull(\s*day|\s*\d*)?|legs?(\s*day|\s*\d*)?|upper(\s*body|\s*\d*)?|lower(\s*body|\s*\d*)?|full\s*body|chest|back|shoulders?|arms?|core|glutes?|cardio|hiit|اليوم)/i;

interface ExtraDataColumn {
  colIdx: number;
  kind:
    | 'week_combined'
    | 'week_weight'
    | 'week_reps'
    | 'week_done'
    | 'set_combined'
    | 'set_weight'
    | 'set_reps'
    | 'weight'
    | 'actual_reps'
    | 'done'
    | 'prev_combined'
    | 'prev_weight'
    | 'prev_reps';
  weekNumber?: number; // 1..52 (or 0 for prev)
  setNumber?: number;  // 1..20 for set_weight / set_reps / set_combined
  unitHint?: 'kg' | 'lbs';
}

interface ColumnMap {
  day: number;
  superset: number;
  setsReps: number;
  name: number;
  sets: number;
  reps: number;
  notes: number;
  video: number;
  dataCols: ExtraDataColumn[];
  unitHint?: 'kg' | 'lbs';
}

function normalizeUrlCandidate(raw: string): string {
  const trimmed = (raw || '').trim().replace(/[),.;]+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.|youtu\.be\/|youtube\.com\/|vimeo\.com\/|drive\.google\.com\/|instagram\.com\/|tiktok\.com\/)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** Extract the cleanest video/external URL from cell text, hyperlink target, or Excel HYPERLINK() formula. */
export function extractUrlFromText(text?: string): string {
  const str = (text || '').trim();
  if (!str) return '';

  const httpMatch = str.match(/https?:\/\/[^\s"'<>]+/i);
  if (httpMatch && httpMatch[0]) return normalizeUrlCandidate(httpMatch[0]);

  const domainMatch = str.match(/(?:www\.|youtu\.be\/|youtube\.com\/|vimeo\.com\/|drive\.google\.com\/|instagram\.com\/|tiktok\.com\/)[^\s"'<>]+/i);
  if (domainMatch && domainMatch[0]) return normalizeUrlCandidate(domainMatch[0]);

  return '';
}

function extractUrlFromFormula(formula?: string): string {
  const f = (formula || '').trim();
  if (!f) return '';
  const match = f.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
  if (match && match[1]) {
    return extractUrlFromText(match[1]) || normalizeUrlCandidate(match[1]);
  }
  return extractUrlFromText(f);
}

/**
 * Split a combined "sets x reps" string (e.g. "4 × 5–12", "3 x 8-10", "4*12", "4 sets x 5-12 reps")
 * into { sets: "4", reps: "5–12" }.
 */
export function splitSetsAndReps(raw?: string): { sets: string; reps: string } | null {
  const str = (raw || '').trim();
  if (!str) return null;

  // Match pattern like: "4 × 5–12", "4 x 5-12", "3 * 10", "4 sets × 8-12 reps"
  const match = str.match(/^(\d+(?:\s*[-–]\s*\d+)?)\s*(?:sets?|rounds?)?\s*[x×*]\s*(.+)$/i);
  if (match && match[1] && match[2]) {
    const setsPart = match[1].trim();
    const repsPart = match[2].replace(/\s*reps?$/i, '').trim();
    return { sets: setsPart, reps: repsPart };
  }
  return null;
}

/** Detect superset marker from column cell, exercise name, or notes. */
function detectSupersetInfo(
  supersetCell: string,
  name: string,
  notes: string
): { isSuperset: boolean; supersetGroup?: string } {
  const ssCell = supersetCell.trim();
  const nm = name.trim();
  const nt = notes.trim();

  // 1. Explicit superset column cell: "SS", "SS1", "Superset", "A1", "A2", "B1", "B2", "Super Set", "Yes"
  if (ssCell) {
    if (/^(no|none|normal|standard|-|—)$/i.test(ssCell)) {
      // explicitly not superset
    } else if (/superset|super\s*set|giant|سوبر|^ss\d*$/i.test(ssCell)) {
      return { isSuperset: true, supersetGroup: ssCell.toUpperCase() };
    } else if (/^[a-z]\d+$/i.test(ssCell)) {
      // e.g. A1 / A2 / B1 / B2
      return { isSuperset: true, supersetGroup: ssCell.toUpperCase() };
    } else if (/^(yes|true|1|✓)$/i.test(ssCell)) {
      return { isSuperset: true, supersetGroup: 'Superset' };
    }
  }

  // 2. Exercise name starts with or contains Superset / A1 / B1 / SS tag
  const nameTagMatch = nm.match(/^(?:\[?(SS\s*\d*|Superset|Super\s*Set|[A-D][1-3])\]?)\s*[:.\-–)]?\s+/i);
  if (nameTagMatch && nameTagMatch[1]) {
    return { isSuperset: true, supersetGroup: nameTagMatch[1].toUpperCase() };
  }
  if (/superset|super\s*set|سوبر\s*ست|\(ss\d*\)|\[ss\d*\]/i.test(nm)) {
    return { isSuperset: true, supersetGroup: 'Superset' };
  }

  // 3. Notes mention superset
  if (/superset|super\s*set|سوبر\s*ست|\bss\d*\b/i.test(nt)) {
    return { isSuperset: true, supersetGroup: 'Superset' };
  }

  return { isSuperset: false };
}

function detectUnitFromText(text?: string): 'kg' | 'lbs' | undefined {
  const t = (text || '').toLowerCase();
  if (!t) return undefined;
  if (/\b(?:lbs?|pounds?)\b|\(lbs?\)/i.test(t) || /\d\s*lbs?\b/i.test(t)) return 'lbs';
  if (/\b(?:kgs?|kilograms?)\b|\(kgs?\)/i.test(t) || /\d\s*kgs?\b/i.test(t)) return 'kg';
  return undefined;
}

function classifyExtraDataHeader(rawHeader: string, colIdx: number): ExtraDataColumn | null {
  const cell = (rawHeader || '').trim();
  if (!cell) return null;
  const unitHint = detectUnitFromText(cell);

  // 1. Week + Set + Weight / Reps (e.g. "W1 S1 Weight", "Week 1 Set 2")
  const weekSetMatch = cell.match(
    /^(?:week|wk|w)\s*#?\s*(\d+)\s*[-–_: ]*\s*(?:set|s)\s*#?\s*(\d+)(?:\s*[-–_: ]*\s*(weight|wt|load|kg|lbs?|reps?|r))?$/i
  );
  if (weekSetMatch) {
    const wk = parseInt(weekSetMatch[1], 10);
    const sn = parseInt(weekSetMatch[2], 10);
    const sub = (weekSetMatch[3] || '').toLowerCase();
    if (wk >= 1 && wk <= 52 && sn >= 1 && sn <= 20) {
      if (sub.startsWith('r')) return { colIdx, kind: 'set_reps', weekNumber: wk, setNumber: sn, unitHint };
      if (sub) return { colIdx, kind: 'set_weight', weekNumber: wk, setNumber: sn, unitHint };
      return { colIdx, kind: 'set_combined', weekNumber: wk, setNumber: sn, unitHint };
    }
  }

  // 2. Week N Weight / Reps / Done / Combined (e.g. "Week 1", "W1", "Week 1 Weight (kg)", "W2 Reps", "Weight W1")
  const weekPrefixMatch = cell.match(
    /^(?:week|wk|w)\s*#?\s*(\d+)\s*[-–_: ]*(.*)$/i
  );
  if (weekPrefixMatch) {
    const wk = parseInt(weekPrefixMatch[1], 10);
    const rest = (weekPrefixMatch[2] || '').trim().toLowerCase();
    if (wk >= 1 && wk <= 52) {
      if (!rest || /^(?:log|data|actual|performance|result|score)?$/i.test(rest)) {
        return { colIdx, kind: 'week_combined', weekNumber: wk, unitHint };
      }
      if (/weight|wt|load|kg|lbs?|الوزن/i.test(rest)) {
        return { colIdx, kind: 'week_weight', weekNumber: wk, unitHint };
      }
      if (/reps?|repet|تكرار/i.test(rest)) {
        return { colIdx, kind: 'week_reps', weekNumber: wk, unitHint };
      }
      if (/done|complete|status|check/i.test(rest)) {
        return { colIdx, kind: 'week_done', weekNumber: wk, unitHint };
      }
    }
  }

  const weekSuffixMatch = cell.match(
    /^(weight|wt|load|kg|lbs?|reps?|done|completed|status)\s*[-–_: (]*\s*(?:week|wk|w)\s*#?\s*(\d+)\)?$/i
  );
  if (weekSuffixMatch) {
    const sub = weekSuffixMatch[1].toLowerCase();
    const wk = parseInt(weekSuffixMatch[2], 10);
    if (wk >= 1 && wk <= 52) {
      if (/reps?/.test(sub)) return { colIdx, kind: 'week_reps', weekNumber: wk, unitHint };
      if (/done|complete|status/.test(sub)) return { colIdx, kind: 'week_done', weekNumber: wk, unitHint };
      return { colIdx, kind: 'week_weight', weekNumber: wk, unitHint };
    }
  }

  // 3. Per-Set columns without week (defaults to Week 1): "Set 1", "S1", "Set 1 Weight", "Set 2 Reps"
  const setColMatch = cell.match(
    /^(?:set|s)\s*#?\s*(\d+)(?:\s*[-–_: ]*\s*(weight|wt|load|kg|lbs?|reps?|r))?$/i
  );
  if (setColMatch) {
    const sn = parseInt(setColMatch[1], 10);
    const sub = (setColMatch[2] || '').toLowerCase();
    if (sn >= 1 && sn <= 20) {
      if (sub.startsWith('r')) return { colIdx, kind: 'set_reps', weekNumber: 1, setNumber: sn, unitHint };
      if (sub) return { colIdx, kind: 'set_weight', weekNumber: 1, setNumber: sn, unitHint };
      return { colIdx, kind: 'set_combined', weekNumber: 1, setNumber: sn, unitHint };
    }
  }

  // 4. Previous / Prior / Last session columns (stored as weekNumber: 0 -> previousLogs)
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session|time)?|old)\s*(?:weight|wt|load|kg|lbs?)?$/i.test(cell)) {
    if (/weight|wt|load|kg|lbs?/i.test(cell)) {
      return { colIdx, kind: 'prev_weight', weekNumber: 0, unitHint };
    }
    return { colIdx, kind: 'prev_combined', weekNumber: 0, unitHint };
  }
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session)?)\s*reps?$/i.test(cell)) {
    return { colIdx, kind: 'prev_reps', weekNumber: 0, unitHint };
  }

  // 5. Generic logged Weight / Load column (defaults to Week 1)
  if (/^(?:actual\s*|logged\s*|current\s*|starting\s*|working\s*)?(?:weight|wt|load|kg|lbs?|الوزن)(?:\s*\(.*\))?$/i.test(cell)) {
    return { colIdx, kind: 'weight', weekNumber: 1, unitHint };
  }

  // 6. Generic logged Actual/Performed Reps column (distinct from target Reps column)
  if (/^(?:actual\s*reps?|logged\s*reps?|done\s*reps?|completed\s*reps?|performed\s*reps?|reps?\s*done|actual)$/i.test(cell)) {
    return { colIdx, kind: 'actual_reps', weekNumber: 1, unitHint };
  }

  // 7. Done / Completed / Checkmark status column
  if (/^(?:done|completed?|checked|status|finished|تم)$/i.test(cell)) {
    return { colIdx, kind: 'done', weekNumber: 1, unitHint };
  }

  return null;
}

function isHeaderRowMatch(row: string[]): { map: ColumnMap; matched: boolean; matchCount: number } {
  const fallback: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: 0, sets: 1, reps: 2, notes: 3, video: 4, dataCols: [] };
  const map: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: -1, sets: -1, reps: -1, notes: -1, video: -1, dataCols: [] };
  let matches = 0;

  (row || []).forEach((rawCell, idx) => {
    const cell = (rawCell || '').toString().trim();
    if (!cell) return;
    if (/^[\d.,\-\s]+$/.test(cell)) return;

    const unit = detectUnitFromText(cell);
    if (unit && !map.unitHint) map.unitHint = unit;

    // Check explicit logged data columns FIRST so "Week 1 Reps" / "Set 1 Weight" / "Actual Reps" don't hijack target Sets/Reps
    const extraCol = classifyExtraDataHeader(cell, idx);
    if (extraCol) {
      map.dataCols.push(extraCol);
      matches++;
      return;
    }

    // Check combined "Sets x Reps" BEFORE individual sets / reps
    if (map.setsReps === -1 && HEADER_HINTS.setsReps.test(cell)) { map.setsReps = idx; matches += 2; return; }
    if (map.day === -1 && HEADER_HINTS.day.test(cell)) { map.day = idx; matches++; return; }
    if (map.superset === -1 && HEADER_HINTS.superset.test(cell)) { map.superset = idx; matches++; return; }
    if (map.name === -1 && HEADER_HINTS.name.test(cell)) { map.name = idx; matches++; return; }
    if (map.sets === -1 && HEADER_HINTS.sets.test(cell)) { map.sets = idx; matches++; return; }
    if (map.reps === -1 && HEADER_HINTS.reps.test(cell)) { map.reps = idx; matches++; return; }
    if (map.video === -1 && HEADER_HINTS.video.test(cell)) { map.video = idx; matches++; return; }
    if (map.notes === -1 && HEADER_HINTS.notes.test(cell)) { map.notes = idx; matches++; return; }
  });

  if (matches >= 2 && map.name !== -1) {
    const positional = map.day === 0
      ? { day: 0, superset: -1, setsReps: -1, name: 1, sets: 2, reps: 3, notes: 4, video: 5 }
      : { day: -1, superset: -1, setsReps: -1, name: 0, sets: 1, reps: 2, notes: 3, video: 4 };
    const scalarEntries = Object.entries(map).filter(([k, v]) => k !== 'dataCols' && k !== 'unitHint' && v !== -1);
    return {
      map: {
        ...positional,
        ...Object.fromEntries(scalarEntries),
        dataCols: map.dataCols,
        ...(map.unitHint ? { unitHint: map.unitHint } : {}),
      } as ColumnMap,
      matched: true,
      matchCount: matches,
    };
  }

  return { map: fallback, matched: false, matchCount: 0 };
}

/**
 * Merge dual-row headers when templates have group headers like [Week 1, '', Week 2, '']
 * directly above sub-headers like [Weight, Reps, Weight, Reps].
 */
function buildMergedDualHeaderRow(primaryRow: string[], subRow?: string[]): { combined: string[]; usedSubRow: boolean } {
  if (!subRow || subRow.length === 0) return { combined: primaryRow, usedSubRow: false };

  const subHeaderToken = /^(?:weight|wt|load|kg|lbs?|reps?|actual(?:\s*reps?)?|done|status|completed?|s\d+|set\s*\d+|الوزن|تكرار)(?:\s*\([^)]*\))?$/i;
  const subMatches = subRow.filter(c => subHeaderToken.test((c || '').trim())).length;
  if (subMatches < 2) return { combined: primaryRow, usedSubRow: false };

  const maxLen = Math.max(primaryRow.length, subRow.length);
  const combined: string[] = [];
  let carriedGroup = '';

  for (let c = 0; c < maxLen; c++) {
    const p = (primaryRow[c] || '').trim();
    const s = (subRow[c] || '').trim();

    if (p) {
      // Carry forward group headers like "Week 1", "W1", "Set 1", "Previous" across blank sub-columns
      if (/^(?:(?:week|wk|w)\s*#?\s*\d+|(?:set|s)\s*#?\s*\d+|prev(?:ious)?|prior|last\s*week)$/i.test(p)) {
        carriedGroup = p;
      } else {
        carriedGroup = '';
      }
    }

    if (s && subHeaderToken.test(s)) {
      const prefix = p || carriedGroup;
      combined.push(prefix ? `${prefix} ${s}` : s);
    } else {
      combined.push(p || s);
    }
  }

  return { combined, usedSubRow: true };
}

function detectColumnMap(rows: string[][]): { map: ColumnMap; headerIndex: number; headerEndIndex: number; matched: boolean } {
  const fallback: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: 0, sets: 1, reps: 2, notes: 3, video: 4, dataCols: [] };

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const primary = rows[i] || [];
    const sub = rows[i + 1];
    const dual = buildMergedDualHeaderRow(primary, sub);
    if (dual.usedSubRow) {
      const dualRes = isHeaderRowMatch(dual.combined);
      if (dualRes.matched) {
        return { map: dualRes.map, headerIndex: i, headerEndIndex: i + 1, matched: true };
      }
    }
    const res = isHeaderRowMatch(primary);
    if (res.matched) {
      return { map: res.map, headerIndex: i, headerEndIndex: i, matched: true };
    }
  }

  return { map: fallback, headerIndex: -1, headerEndIndex: -1, matched: false };
}

/** Parse a single cell or multi-set cell into one or more { weight, unit, reps } pieces. */
function parseLoggedCellEntries(
  rawCell: string,
  defaultUnit?: 'kg' | 'lbs'
): Array<{ weight: string; unit?: 'kg' | 'lbs'; reps: string }> {
  const raw = (rawCell || '').trim();
  if (!raw || /^[-—–_=]+$|^n\/?a$/i.test(raw)) return [];

  // Split multi-set cells separated by newline, semicolon, pipe, or comma (when comma separates full sets)
  const parts = raw
    .split(/[\n;|]+|,(?=\s*\d)/)
    .map(p => p.trim())
    .filter(Boolean);

  const results: Array<{ weight: string; unit?: 'kg' | 'lbs'; reps: string }> = [];

  for (const part of parts) {
    if (/^[-—–_=]+$|^n\/?a$/i.test(part)) continue;
    const partUnit = detectUnitFromText(part) || defaultUnit;

    // Optional leading "S1:" or "Set 1:" label
    const cleaned = part.replace(/^(?:set|s)\s*#?\s*\d+\s*[:.\-–]?\s*/i, '').trim();

    // Format: "80kg x 10", "80 x 10", "80 * 10", "80 / 10", "80 @ 10", "80kg × 8-10"
    const wtRepsMatch = cleaned.match(
      /^(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(?:kgs?|lbs?|pounds?)?\s*(?:[x×*@/]|for)\s*(\d+(?:\s*[-–]\s*\d+)?)(?:\s*reps?)?$/i
    );
    if (wtRepsMatch) {
      results.push({
        weight: wtRepsMatch[1].replace(',', '.').trim(),
        ...(partUnit ? { unit: partUnit } : {}),
        reps: wtRepsMatch[2].trim(),
      });
      continue;
    }

    // Format: "80kg", "80.5 lbs", "BW", "80"
    const singleWtMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(?:kgs?|lbs?|pounds?)?$/i);
    if (singleWtMatch) {
      results.push({
        weight: singleWtMatch[1].replace(',', '.').trim(),
        ...(partUnit ? { unit: partUnit } : {}),
        reps: '',
      });
      continue;
    }

    // Bodyweight or text load like "BW x 12" or "Bodyweight x 10"
    const bwMatch = cleaned.match(/^(bw|bodyweight)\s*(?:[x×*@/]\s*(\d+(?:\s*[-–]\s*\d+)?))?$/i);
    if (bwMatch) {
      results.push({
        weight: 'BW',
        ...(partUnit ? { unit: partUnit } : {}),
        reps: (bwMatch[2] || '').trim(),
      });
    }
  }

  return results;
}

function isTruthyDoneCell(raw?: string): boolean {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return false;
  return /^(✓|✔|☑|✅|x|yes|true|1|done|completed?|finished|ok|تم)$/i.test(v);
}

function looksLikeDayBanner(cells: string[], links: (string | undefined)[], map: ColumnMap): string | null {
  const nonEmpty = cells.map(c => c.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return null;

  if (nonEmpty.some(c => extractUrlFromText(c) !== '') || links.some(l => !!l)) {
    return null;
  }

  const setsCell = map.sets >= 0 && map.sets < cells.length ? cells[map.sets].trim() : '';
  const repsCell = map.reps >= 0 && map.reps < cells.length ? cells[map.reps].trim() : '';
  const srCell = map.setsReps >= 0 && map.setsReps < cells.length ? cells[map.setsReps].trim() : '';
  const hasNumericSetsOrReps = /\d/.test(setsCell) || /\d/.test(repsCell) || /\d/.test(srCell);
  const hasExtraNumericData = map.dataCols.some(dc => dc.colIdx < cells.length && /\d/.test(cells[dc.colIdx]));

  if ((hasNumericSetsOrReps || hasExtraNumericData) && nonEmpty.length >= 2) {
    return null;
  }

  if (nonEmpty.length === 1) {
    const label = nonEmpty[0];
    if (label.length >= 2 && label.length <= 100) {
      return label;
    }
  }

  if (nonEmpty.length === 2 && !hasNumericSetsOrReps && !hasExtraNumericData) {
    const combined = nonEmpty.join(' — ');
    if (DAY_BANNER_PATTERN.test(combined)) {
      return combined;
    }
  }

  return null;
}

/**
 * Convert a rectangular grid of text cells into structured exercise rows, linking each row to detected Day headers,
 * splitting "Sets x Reps", detecting supersets, auto-fetching video URLs, and extracting any pre-filled weights/reps/weeks.
 */
export function rowsToExercisesWithMeta(
  rows: string[][],
  linkGrid?: (string | undefined)[][]
): {
  exercises: ParsedExerciseRow[];
  headerMatched: boolean;
  detectedDays: string[];
  detectedDataWeeks: number;
  detectedWeightUnit?: 'kg' | 'lbs';
  prefilledRowCount: number;
} {
  const indexedRows = (rows || [])
    .map((r, rowIdx) => ({
      cells: (r || []).map(c => (c === null || c === undefined ? '' : String(c).trim())),
      links: linkGrid?.[rowIdx] || [],
    }))
    .filter(item => item.cells.some(c => c !== '') || item.links.some(l => !!l));

  if (indexedRows.length === 0) {
    return {
      exercises: [],
      headerMatched: false,
      detectedDays: [],
      detectedDataWeeks: 0,
      prefilledRowCount: 0,
    };
  }

  const cleanRows = indexedRows.map(item => item.cells);
  const { map: initialMap, headerIndex, headerEndIndex, matched } = detectColumnMap(cleanRows);
  let activeMap = initialMap;

  let currentDay = '';
  if (headerIndex > 0) {
    for (let i = 0; i < headerIndex; i++) {
      const candidate = looksLikeDayBanner(indexedRows[i].cells, indexedRows[i].links, activeMap);
      if (candidate && (DAY_BANNER_PATTERN.test(candidate) || i === headerIndex - 1)) {
        currentDay = candidate.trim();
      }
    }
  }

  const startIdx = headerEndIndex >= 0 ? headerEndIndex + 1 : 0;
  const at = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? (row[idx] || '').trim() : '');
  const linkAt = (links: (string | undefined)[], idx: number) =>
    idx >= 0 && idx < links.length ? (links[idx] || '').trim() : '';

  const exercises: ParsedExerciseRow[] = [];
  let maxDataWeek = 0;
  let sheetUnitHint: 'kg' | 'lbs' | undefined = initialMap.unitHint;
  let prefilledRowCount = 0;

  for (let i = startIdx; i < indexedRows.length; i++) {
    const { cells, links } = indexedRows[i];

    // Check repeated section headers (including dual-row)
    const dualSub = buildMergedDualHeaderRow(cells, indexedRows[i + 1]?.cells);
    if (dualSub.usedSubRow) {
      const dualHeader = isHeaderRowMatch(dualSub.combined);
      if (dualHeader.matched) {
        activeMap = dualHeader.map;
        if (dualHeader.map.unitHint && !sheetUnitHint) sheetUnitHint = dualHeader.map.unitHint;
        i++; // skip consumed sub-header row
        continue;
      }
    }
    const subHeader = isHeaderRowMatch(cells);
    if (subHeader.matched) {
      activeMap = subHeader.map;
      if (subHeader.map.unitHint && !sheetUnitHint) sheetUnitHint = subHeader.map.unitHint;
      continue;
    }

    const bannerDay = looksLikeDayBanner(cells, links, activeMap);
    if (bannerDay) {
      currentDay = bannerDay.trim();
      continue;
    }

    if (activeMap.day >= 0) {
      const colDay = at(cells, activeMap.day);
      if (colDay) {
        currentDay = colDay.trim();
      }
    }

    // Handle combined "Sets x Reps" column or combined value in the Sets column (e.g. "4 × 5–12")
    let setsVal = at(cells, activeMap.sets);
    let repsVal = at(cells, activeMap.reps);

    if (activeMap.setsReps >= 0) {
      const srVal = at(cells, activeMap.setsReps);
      const split = splitSetsAndReps(srVal);
      if (split) {
        setsVal = split.sets;
        repsVal = split.reps;
      } else if (srVal) {
        setsVal = srVal;
      }
    } else if (setsVal) {
      const split = splitSetsAndReps(setsVal);
      if (split) {
        setsVal = split.sets;
        if (!repsVal) repsVal = split.reps;
      }
    }

    const nameVal = at(cells, activeMap.name);
    const notesVal = at(cells, activeMap.notes);
    const supersetCell = activeMap.superset >= 0 ? at(cells, activeMap.superset) : '';
    const ssInfo = detectSupersetInfo(supersetCell, nameVal, notesVal);

    const rawVideoCell = at(cells, activeMap.video);
    const videoHyperlink = linkAt(links, activeMap.video);
    const nameHyperlink = linkAt(links, activeMap.name);

    let resolvedVideo = '';
    if (videoHyperlink) {
      resolvedVideo = extractUrlFromText(videoHyperlink) || normalizeUrlCandidate(videoHyperlink);
    }
    if (!resolvedVideo && rawVideoCell) {
      resolvedVideo = extractUrlFromText(rawVideoCell) || rawVideoCell;
    }
    if (!resolvedVideo && nameHyperlink) {
      resolvedVideo = extractUrlFromText(nameHyperlink) || normalizeUrlCandidate(nameHyperlink);
    }
    if (!resolvedVideo) {
      const anyRowLink = links.find(l => !!l && (extractUrlFromText(l) !== '' || /^https?:\/\//i.test(l)));
      if (anyRowLink) {
        resolvedVideo = extractUrlFromText(anyRowLink) || normalizeUrlCandidate(anyRowLink);
      } else {
        for (let cIdx = 0; cIdx < cells.length; cIdx++) {
          if (cIdx === activeMap.name || cIdx === activeMap.notes) continue;
          const found = extractUrlFromText(cells[cIdx]);
          if (found) { resolvedVideo = found; break; }
        }
      }
    }

    // Extract any pre-filled weights, reps, weekly logs, Set 1..N logs, Previous logs, or Done flags
    const weeklyLogs: Record<number, ParsedWeekData> = {};
    const ensureWeek = (wk: number, unit?: 'kg' | 'lbs'): ParsedWeekData => {
      if (!weeklyLogs[wk]) {
        weeklyLogs[wk] = {
          weekNumber: wk,
          ...(unit || activeMap.unitHint ? { unit: unit || activeMap.unitHint } : {}),
          entries: [],
        };
      } else if (unit && !weeklyLogs[wk].unit) {
        weeklyLogs[wk].unit = unit;
      }
      return weeklyLogs[wk];
    };

    const setEntrySlot = (wk: number, setIdxZeroBased: number, patch: Partial<ParsedWeekSetEntry>, unit?: 'kg' | 'lbs') => {
      const bucket = ensureWeek(wk, unit);
      while (bucket.entries.length <= setIdxZeroBased) {
        bucket.entries.push({
          setNumber: bucket.entries.length + 1,
          weight: '',
          ...(bucket.unit ? { unit: bucket.unit } : {}),
          reps: '',
        });
      }
      const existing = bucket.entries[setIdxZeroBased];
      bucket.entries[setIdxZeroBased] = {
        setNumber: setIdxZeroBased + 1,
        weight: patch.weight !== undefined && patch.weight !== '' ? patch.weight : existing.weight,
        unit: patch.unit || existing.unit || bucket.unit,
        reps: patch.reps !== undefined && patch.reps !== '' ? patch.reps : existing.reps,
      };
    };

    const targetSetsNum = parseSetsCount(setsVal);
    let rowCompleted = false;

    for (const dc of activeMap.dataCols) {
      const cellVal = at(cells, dc.colIdx);
      if (!cellVal) continue;
      const cellUnit = detectUnitFromText(cellVal) || dc.unitHint || activeMap.unitHint;
      if (cellUnit && !sheetUnitHint) sheetUnitHint = cellUnit;

      const wkNum = dc.weekNumber !== undefined ? dc.weekNumber : 1;

      if (dc.kind === 'done' || dc.kind === 'week_done') {
        if (isTruthyDoneCell(cellVal)) {
          const b = ensureWeek(wkNum, cellUnit);
          b.completed = true;
          if (wkNum === 1) rowCompleted = true;
        }
        continue;
      }

      if (dc.kind === 'set_combined' || dc.kind === 'set_weight' || dc.kind === 'set_reps') {
        const sIdx = Math.max(0, (dc.setNumber || 1) - 1);
        if (dc.kind === 'set_reps') {
          const rMatch = cellVal.match(/(\d+(?:\s*[-–]\s*\d+)?)/);
          if (rMatch) setEntrySlot(wkNum, sIdx, { reps: rMatch[1].trim() }, cellUnit);
        } else {
          const parsed = parseLoggedCellEntries(cellVal, cellUnit);
          if (parsed.length > 0) {
            setEntrySlot(
              wkNum,
              sIdx,
              {
                weight: parsed[0].weight,
                unit: parsed[0].unit || cellUnit,
                reps: dc.kind === 'set_combined' ? parsed[0].reps : '',
              },
              cellUnit
            );
          }
        }
        continue;
      }

      if (dc.kind === 'week_combined' || dc.kind === 'prev_combined') {
        const parsedList = parseLoggedCellEntries(cellVal, cellUnit);
        if (parsedList.length === 1 && targetSetsNum > 1 && !parsedList[0].reps) {
          // Single weight entered for a multi-set week (e.g. "80kg") -> fill Set 1..N
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, parsedList[0], cellUnit);
          }
        } else {
          parsedList.forEach((p, idx) => setEntrySlot(wkNum, idx, p, cellUnit));
        }
        continue;
      }

      if (dc.kind === 'weight' || dc.kind === 'week_weight' || dc.kind === 'prev_weight') {
        const parsedList = parseLoggedCellEntries(cellVal, cellUnit);
        if (parsedList.length === 1 && targetSetsNum > 1) {
          // Single value in Weight column (e.g. "80") -> apply across sets 1..N
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, parsedList[0], cellUnit);
          }
        } else {
          parsedList.forEach((p, idx) => setEntrySlot(wkNum, idx, p, cellUnit));
        }
        continue;
      }

      if (dc.kind === 'actual_reps' || dc.kind === 'week_reps' || dc.kind === 'prev_reps') {
        const repParts = cellVal
          .split(/[\n,;|/]+/)
          .map(x => x.trim())
          .filter(x => /\d/.test(x) && !/^[-—_]+$/.test(x));
        if (repParts.length === 1 && targetSetsNum > 1) {
          const cleanR = repParts[0].replace(/\s*reps?$/i, '').trim();
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, { reps: cleanR }, cellUnit);
          }
        } else {
          repParts.forEach((r, idx) => {
            setEntrySlot(wkNum, idx, { reps: r.replace(/\s*reps?$/i, '').trim() }, cellUnit);
          });
        }
      }
    }

    // Clean empty weeklyLog buckets and compute summary fields
    const nonEmptyWeeks: Record<number, ParsedWeekData> = {};
    for (const [k, data] of Object.entries(weeklyLogs)) {
      const wk = Number(k);
      const populatedEntries = data.entries.filter(s => s.weight.trim() !== '' || s.reps.trim() !== '');
      if (populatedEntries.length > 0 || data.completed) {
        nonEmptyWeeks[wk] = {
          weekNumber: wk,
          ...(data.unit ? { unit: data.unit } : {}),
          entries: data.entries,
          ...(data.completed ? { completed: true } : {}),
        };
        if (wk > maxDataWeek) maxDataWeek = wk;
      }
    }

    const hasPrefilledData = Object.keys(nonEmptyWeeks).length > 0 || rowCompleted;
    if (hasPrefilledData) prefilledRowCount++;

    const w1Primary = nonEmptyWeeks[1]?.entries.find(e => e.weight || e.reps)
      || Object.values(nonEmptyWeeks)[0]?.entries.find(e => e.weight || e.reps);

    const row: ParsedExerciseRow = {
      ...(currentDay ? { day: currentDay } : {}),
      name: nameVal,
      sets: setsVal,
      reps: repsVal,
      notes: notesVal,
      video: resolvedVideo,
      ...(ssInfo.isSuperset ? { isSuperset: true, supersetGroup: ssInfo.supersetGroup } : {}),
      ...(w1Primary?.weight ? { loggedWeight: w1Primary.weight } : {}),
      ...(w1Primary?.unit || sheetUnitHint ? { loggedUnit: w1Primary?.unit || sheetUnitHint } : {}),
      ...(w1Primary?.reps ? { loggedReps: w1Primary.reps } : {}),
      ...(Object.keys(nonEmptyWeeks).length > 0 ? { weeklyLogs: nonEmptyWeeks } : {}),
      ...(rowCompleted ? { completed: true } : {}),
    };

    if (row.name !== '' || row.sets !== '' || row.reps !== '' || row.notes !== '' || row.video !== '' || hasPrefilledData) {
      exercises.push(row);
    }
  }

  const usedDays = Array.from(
    new Set(exercises.map(e => e.day?.trim()).filter((d): d is string => Boolean(d)))
  );

  return {
    exercises,
    headerMatched: matched,
    detectedDays: usedDays,
    detectedDataWeeks: maxDataWeek,
    ...(sheetUnitHint ? { detectedWeightUnit: sheetUnitHint } : {}),
    prefilledRowCount,
  };
}

export function rowsToExercises(rows: string[][]): ParsedExerciseRow[] {
  return rowsToExercisesWithMeta(rows).exercises;
}

/**
 * Parse set count from the Sets column (e.g., "4" -> 4, "4 × 5–12" -> 4, "3-4" -> 4, "3 sets" -> 3).
 */
export function parseSetsCount(setsStr?: string): number {
  const str = (setsStr || '').trim();
  if (!str) return 1;

  // If combined "4 × 5–12", extract set portion BEFORE ×/x/*
  const split = splitSetsAndReps(str);
  const target = split ? split.sets : str;

  // Handle range like "3-4" or "3 to 4" -> use upper bound
  const rangeMatch = target.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  if (rangeMatch && rangeMatch[2]) {
    const val = parseInt(rangeMatch[2], 10);
    if (!Number.isNaN(val) && val > 0) return Math.min(20, Math.max(1, val));
  }

  const singleMatch = target.match(/(\d+)/);
  if (singleMatch && singleMatch[1]) {
    const val = parseInt(singleMatch[1], 10);
    if (!Number.isNaN(val) && val > 0) return Math.min(20, Math.max(1, val));
  }

  return 1;
}

function classifySheetRole(
  sheetName: string,
  rawRows: string[][],
  exercises: ParsedExerciseRow[],
  headerMatched: boolean
): SheetRole {
  const trimmedName = (sheetName || '').trim();
  if (rawRows.length === 0) return 'skip';

  if (INFO_SHEET_NAME_HINT.test(trimmedName) && !headerMatched) {
    return 'instructions';
  }

  if (headerMatched && exercises.length > 0) {
    return 'workout';
  }

  if (WORKOUT_SHEET_NAME_HINT.test(trimmedName) && exercises.length > 0) {
    return 'workout';
  }

  const singleColRows = rawRows.filter(r => r.filter(c => c.trim() !== '').length <= 1).length;
  if (!headerMatched && singleColRows >= Math.ceil(rawRows.length * 0.6)) {
    return 'instructions';
  }

  return exercises.length > 0 ? 'workout' : 'instructions';
}

function rowsToTextContent(rows: string[][]): string {
  return rows
    .map(r => r.map(c => c.trim()).filter(Boolean).join(' — '))
    .filter(Boolean)
    .join('\n');
}

/** Parse a raw CSV / TSV string into a grid, handling quoted fields. */
export function parseDelimitedText(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = pickDelimiter(normalized);
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { current.push(field); field = ''; continue; }
    if (char === '\n') { current.push(field); rows.push(current); current = []; field = ''; continue; }
    field += char;
  }
  current.push(field);
  rows.push(current);

  return rows;
}

function pickDelimiter(text: string): string {
  const firstLine = text.split('\n').find(l => l.trim() !== '') || '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

/** Extract a positional text grid from a PDF using pdf.js. Best-effort table recovery. */
async function parsePdf(file: File): Promise<string[][]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const rows: string[][] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const lineMap = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      let bucketKey = y;
      for (const existing of lineMap.keys()) {
        if (Math.abs(existing - y) <= 3) { bucketKey = existing; break; }
      }
      if (!lineMap.has(bucketKey)) lineMap.set(bucketKey, []);
      lineMap.get(bucketKey)!.push({ x, str: item.str });
    }

    const sortedLines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x));

    for (const items of sortedLines) {
      const cells: string[] = [];
      let currentCell = '';
      let prevEnd: number | null = null;
      for (const item of items) {
        if (prevEnd !== null && item.x - prevEnd > 12) {
          cells.push(currentCell.trim());
          currentCell = '';
        }
        currentCell += (currentCell ? ' ' : '') + item.str;
        prevEnd = item.x + item.str.length * 5;
      }
      if (currentCell.trim()) cells.push(currentCell.trim());
      if (cells.some(c => c !== '')) rows.push(cells);
    }
  }

  return rows;
}

function extractExcelHyperlinkGrid(XLSX: any, sheet: any): { rows: string[][]; linkGrid: (string | undefined)[][] } {
  const ref = sheet?.['!ref'];
  if (!ref) return { rows: [], linkGrid: [] };

  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  const linkGrid: (string | undefined)[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowValues: string[] = [];
    const rowLinks: (string | undefined)[] = [];
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      let val = '';
      if (cell) {
        if (typeof XLSX.utils.format_cell === 'function') {
          val = String(XLSX.utils.format_cell(cell) ?? '').trim();
        }
        if (!val && cell.v !== undefined && cell.v !== null) {
          val = String(cell.v).trim();
        }
      }
      const targetLink = cell?.l?.Target ? String(cell.l.Target).trim() : '';
      const formulaLink = cell?.f ? extractUrlFromFormula(String(cell.f)) : '';
      const link = targetLink || formulaLink || undefined;
      if (val !== '' || link) hasValue = true;
      rowValues.push(val);
      rowLinks.push(link);
    }
    if (hasValue) {
      rows.push(rowValues);
      linkGrid.push(rowLinks);
    }
  }

  return { rows, linkGrid };
}

/** Detect and parse ALL sheets inside an uploaded workbook/file. */
export async function parseSheetFileAllSheets(file: File): Promise<DetectedSheet[]> {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX: any = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const detected: DetectedSheet[] = workbook.SheetNames.map((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      const { rows: rawRows, linkGrid } = extractExcelHyperlinkGrid(XLSX, sheet);
      const {
        exercises,
        headerMatched,
        detectedDays,
        detectedDataWeeks,
        detectedWeightUnit,
        prefilledRowCount,
      } = rowsToExercisesWithMeta(rawRows, linkGrid);
      const suggestedRole = classifySheetRole(sheetName, rawRows, exercises, headerMatched);
      return {
        name: sheetName,
        rawRows,
        textContent: rowsToTextContent(rawRows),
        exercises,
        detectedDays,
        suggestedRole,
        headerMatched,
        detectedDataWeeks,
        ...(detectedWeightUnit ? { detectedWeightUnit } : {}),
        prefilledRowCount,
      };
    });

    if (detected.length > 0 && !detected.some(s => s.suggestedRole === 'workout')) {
      const bestWorkoutIdx = detected.findIndex(s => s.exercises.length > 0);
      if (bestWorkoutIdx >= 0) {
        detected[bestWorkoutIdx].suggestedRole = 'workout';
      }
    }

    return detected;
  }

  if (name.endsWith('.pdf')) {
    const rawRows = (await parsePdf(file))
      .map(r => r.map(c => c.trim()))
      .filter(r => r.some(c => c !== ''));
    const {
      exercises,
      headerMatched,
      detectedDays,
      detectedDataWeeks,
      detectedWeightUnit,
      prefilledRowCount,
    } = rowsToExercisesWithMeta(rawRows);
    return [{
      name: file.name.replace(/\.[^.]+$/, '') || 'PDF Sheet',
      rawRows,
      textContent: rowsToTextContent(rawRows),
      exercises,
      detectedDays,
      suggestedRole: exercises.length > 0 ? 'workout' : 'instructions',
      headerMatched,
      detectedDataWeeks,
      ...(detectedWeightUnit ? { detectedWeightUnit } : {}),
      prefilledRowCount,
    }];
  }

  const text = await file.text();
  const rawRows = parseDelimitedText(text)
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
  const {
    exercises,
    headerMatched,
    detectedDays,
    detectedDataWeeks,
    detectedWeightUnit,
    prefilledRowCount,
  } = rowsToExercisesWithMeta(rawRows);
  return [{
    name: file.name.replace(/\.[^.]+$/, '') || 'Workout Sheet',
    rawRows,
    textContent: rowsToTextContent(rawRows),
    exercises,
    detectedDays,
    suggestedRole: exercises.length > 0 ? 'workout' : 'instructions',
    headerMatched,
    detectedDataWeeks,
    ...(detectedWeightUnit ? { detectedWeightUnit } : {}),
    prefilledRowCount,
  }];
}

/** Parse any supported workout sheet file into structured exercise rows (first workout sheet). */
export async function parseSheetFile(file: File): Promise<ParsedExerciseRow[]> {
  const sheets = await parseSheetFileAllSheets(file);
  const preferred = sheets.find(s => s.suggestedRole === 'workout') || sheets[0];
  return preferred ? preferred.exercises : [];
}

export function emptyRow(day?: string): ParsedExerciseRow {
  return { ...(day ? { day } : {}), name: '', sets: '', reps: '', notes: '', video: '' };
}

export interface VideoThumbnailInfo {
  normalizedUrl: string;
  provider: 'youtube' | 'vimeo' | 'direct' | 'instagram' | 'tiktok' | 'drive' | 'external';
  providerLabel: string;
  thumbnailUrl?: string;
  embedUrl?: string;
}

export function getVideoThumbnailInfo(rawUrl?: string): VideoThumbnailInfo | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  const extracted = extractUrlFromText(trimmed) || trimmed;
  const normalizedUrl = /^https?:\/\//i.test(extracted) ? extracted : `https://${extracted}`;

  // YouTube (watch?v=, youtu.be/, shorts/, live/, embed/, v/)
  const ytMatch = normalizedUrl.match(
    /(?:(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/i
  );
  if (ytMatch && ytMatch[1]) {
    const id = ytMatch[1];
    // Preserve optional timestamp (?t=90 or ?t=1m30s or ?start=90)
    let startParam = '';
    const tMatch = normalizedUrl.match(/[?&](?:t|start)=([0-9hms]+)/i);
    if (tMatch && tMatch[1]) {
      const rawT = tMatch[1];
      if (/^\d+$/.test(rawT)) {
        startParam = `&start=${rawT}`;
      } else {
        const h = parseInt((rawT.match(/(\d+)h/i) || [])[1] || '0', 10);
        const m = parseInt((rawT.match(/(\d+)m/i) || [])[1] || '0', 10);
        const s = parseInt((rawT.match(/(\d+)s/i) || [])[1] || '0', 10);
        const total = h * 3600 + m * 60 + s;
        if (total > 0) startParam = `&start=${total}`;
      }
    }
    return {
      normalizedUrl,
      provider: 'youtube',
      providerLabel: 'YouTube',
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      embedUrl: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1${startParam}`,
    };
  }

  const vimeoMatch = normalizedUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    const id = vimeoMatch[1];
    return {
      normalizedUrl,
      provider: 'vimeo',
      providerLabel: 'Vimeo',
      embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`,
    };
  }

  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(normalizedUrl)) {
    return {
      normalizedUrl,
      provider: 'direct',
      providerLabel: 'Video Clip',
    };
  }

  if (/instagram\.com/i.test(normalizedUrl)) {
    return { normalizedUrl, provider: 'instagram', providerLabel: 'Instagram' };
  }
  if (/tiktok\.com/i.test(normalizedUrl)) {
    return { normalizedUrl, provider: 'tiktok', providerLabel: 'TikTok' };
  }
  if (/drive\.google\.com/i.test(normalizedUrl)) {
    const driveMatch = normalizedUrl.match(/\/file\/d\/([A-Za-z0-9_-]+)/i) || normalizedUrl.match(/[?&]id=([A-Za-z0-9_-]+)/i);
    return {
      normalizedUrl,
      provider: 'drive',
      providerLabel: 'Google Drive',
      ...(driveMatch?.[1] ? { embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview` } : {}),
    };
  }

  return { normalizedUrl, provider: 'external', providerLabel: 'Demo Video' };
}
