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
  rpe?: string;
  rir?: string;
}

export interface ParsedWeekData {
  weekNumber: number; // 1..52 for Week N; 0 for Previous / Prior / Baseline
  unit?: 'kg' | 'lbs';
  entries: ParsedWeekSetEntry[];
  completed?: boolean;
  weekNote?: string;
}

export interface ParsedExerciseRow {
  day?: string;
  name: string;
  sets: string;
  reps: string;
  rpe?: string;
  rir?: string;
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

export type WeekColumnMetricRole = 'weight' | 'reps' | 'rpe' | 'rir' | 'done' | 'notes' | 'combined';

export type ManualColumnMappingRole =
  | 'ignore'
  | 'name'
  | 'day'
  | 'superset'
  | 'setsReps'
  | 'sets'
  | 'reps'
  | 'weight'
  | 'actual_reps'
  | 'weight_reps'
  | 'rpe'
  | 'rir'
  | 'notes'
  | 'video'
  | 'done'
  | 'prev_combined'
  | 'prev_weight'
  | 'prev_reps'
  | 'prev_rpe'
  | 'prev_rir'
  | `w${number}_${WeekColumnMetricRole}`;

export type AssignableColumnKey =
  | 'name'
  | 'sets'
  | 'reps'
  | 'day'
  | 'weight'
  | 'actual_reps'
  | 'rpe'
  | 'rir'
  | 'notes'
  | 'video';

export interface DetectedSheetColumnInfo {
  colIdx: number;
  columnLetter: string;
  headerName: string;
  hasExplicitHeader: boolean;
  sampleValues: string[];
  assignedRole: ManualColumnMappingRole;
}

export interface SheetColumnOverride {
  headerRowIndex: number;
  assignments: Record<number, ManualColumnMappingRole>;
}

export interface DetectedSheet {
  name: string;
  rawRows: string[][];
  linkGrid?: (string | undefined)[][];
  textContent: string;
  exercises: ParsedExerciseRow[];
  detectedDays: string[];
  suggestedRole: SheetRole;
  headerMatched: boolean;
  headerRowIndex: number;
  detectedColumns: DetectedSheetColumnInfo[];
  missingRequiredColumns: AssignableColumnKey[];
  missingOptionalColumns: AssignableColumnKey[];
  detectedDataWeeks: number;
  detectedWeightUnit?: 'kg' | 'lbs';
  prefilledRowCount: number;
  hasRpeColumn: boolean;
  hasRirColumn: boolean;
}

const HEADER_HINTS = {
  day: /^(?:workout\s*day|training\s*day|day\s*(?:[\/|&-]?\s*split)?\s*#?|split(?:\s*day)?|muscle\s*group|body\s*part|session|اليوم)(?:\s*\(.*\))?$/i,
  superset: /^(?:superset|super\s*set|ss|group|pair|code|order|type|method|سوبر)(?:\s*(?:tag|id|code|group|#|no\.?))?(?:\s*\(.*\))?$/i,
  setsReps: /^(?:sets?|rounds?)\s*(?:[x×*\/&,+\\-]|\band\b|\s+)\s*(?:reps?|repetitions?)|^(?:reps?|repetitions?)\s*(?:[x×*\/&,+\\-]|\band\b)\s*(?:sets?|rounds?)/i,
  name: /^(?:(?:main|primary|core|target)\s+)?(?:ex(?:er|re|cer|ec|cr)?[scz]?i[scz]?e?s?|exc?erc?is\w*|exersis\w*|exeriz\w*|exercise|workout|movement|lifts?|drill|activity|name|title|تمرين|اسم)(?:\s*(?:[/|&-]\s*(?:day|split|videos?|links?|url|notes?)|name|title|#|\(.*\)))*$/i,
  sets: /^(?:#\s*|no\.?\s*of\s*|num(?:ber)?\s*of\s*|target\s*|planned\s*)?(?:sets?|rounds?|المجموعات|جولات)(?:\s*\(.*\))?$/i,
  reps: /^(?:#\s*|target\s*|planned\s*|goal\s*)?(?:rep(?:etition)?s?(?:\s*(?:range|goal|target))?|repeat|التكرار|تكرار)(?:\s*\(.*\))?$/i,
  notes: /^(?:coach\s*|exercise\s*|workout\s*)?(?:note|notes|comment|comments|cue|cues|tempo|rest|instruction|instructions|details|تفاصيل|ملاحظ\w*|تعليق\w*)(?:\s*\(.*\))?$/i,
  video: /^(?:demo\s*|exercise\s*|workout\s*)?(?:video|link|url|clip|demo|youtube|tutorial|فيديو|رابط)(?:\s*(?:url|link|\(.*\)))*$/i,
};

const INFO_SHEET_NAME_HINT = /info|instruction|guide|intro|readme|note|rule|about|faq|tip|overview|warm|تعليم|معلوم|ارشاد|ملاحظ/i;
const WORKOUT_SHEET_NAME_HINT = /workout|day|week|push|pull|leg|torso|limb|anterior|posterior|upper|lower|full|chest|back|shoulder|delt|arm|bicep|tricep|core|abs|glute|quad|ham|calf|calves|cardio|hiit|program|plan|split|bro|pro|ppl|exercise|تمارين|جدول|يوم/i;
const EXERCISE_NOUN_HINT = /\b(?:press|fly|flye|raises?|curls?|extensions?|ext\.?|rows?|pulldowns?|pull-?downs?|pullovers?|push-?ups?|pull-?ups?|pushdowns?|kickbacks?|squats?|lunges?|deadlifts?|rdls?|shrugs?|dips?|crunches?|planks?|twists?|bridges?|thrusts?|marches?|walks?|runs?|sprints?|stretches?|rotations?|raises?|hold|holds|carries|carry|slams?|swings?|jumps?|ups?)\b/i;
const STRICT_DAY_BANNER_PATTERN = /^(?:day\s*#?\s*\d+|day\s+[a-e]\b|d\d+|split\s*[a-z0-9#]+|(?:pro|bro)\s*split\b|week\s*#?\s*\d+\s*[-–:|]?\s*day\s*#?\s*\d*|session\s*#?\s*[a-z0-9]+|workout\s*[a-z0-9]+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|اليوم)/i;
const DAY_BANNER_PATTERN = /^(?:day\s*#?\s*\d+|day\s+[a-e]\b|d\d+|split\s*[a-z0-9#]+|(?:pro|bro)\s*split\b|week\s*#?\s*\d+\s*[-–:|]?\s*day\s*#?\s*\d*|session\s*#?\s*[a-z0-9]+|workout\s*[a-z0-9]+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:push|pull|legs?|ppl|torso|limbs?|anterior|posterior|upper(?:\s*body)?|lower(?:\s*body)?|full\s*body|chest|back|shoulders?|delts?|arms?|biceps?|triceps?|forearms?|core|abs|glutes?|quads?|hamstrings?|calves?|cardio|hiit)(?=\s*$|\s+(?:day|session|split|focus|strength|hypertrophy|power|heavy|light|#\d+|\d+|[a-e])(?:\b|$)|\s*[:\-–&+/|(])|اليوم)/i;

/**
 * Canonicalize an exercise name for reliable cross-sheet & sheet-to-plan matching.
 * - `loose = false`: normalizes Unicode whitespace/NBSP, dashes, quotes, slash/hyphen spacing, and case.
 * - `loose = true`: also strips leading list numbers/bullets ("1.", "1)") and superset tags ("[SS]", "A1 -").
 */
export function normalizeExerciseMatchKey(name?: string, loose = false): string {
  let s = (name || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!s) return '';

  if (loose) {
    s = s
      .replace(/^(?:\[?(?:ss\s*\d*|superset|super\s*set|[a-d][1-3])\]?\s*[:.\-–)]\s*)+/i, '')
      .replace(/^(?:\d+\s*[.)\-:]|[•·*])\s+/, '')
      .replace(/\s*\((?:ss\d*|superset|super\s*set)\)\s*/gi, ' ')
      .replace(/\s*\[(?:ss\d*|superset|super\s*set)\]\s*/gi, ' ')
      .replace(/\s*([/\-])\s*/g, '$1')
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return s;
}

interface ExtraDataColumn {
  colIdx: number;
  kind:
    | 'week_combined'
    | 'week_breakdown'
    | 'week_weight'
    | 'week_reps'
    | 'week_rpe'
    | 'week_rir'
    | 'week_notes'
    | 'week_done'
    | 'set_combined'
    | 'set_weight'
    | 'set_reps'
    | 'set_rpe'
    | 'set_rir'
    | 'weight'
    | 'actual_reps'
    | 'rpe'
    | 'rir'
    | 'done'
    | 'prev_combined'
    | 'prev_weight'
    | 'prev_reps'
    | 'prev_rpe'
    | 'prev_rir';
  weekNumber?: number; // 1..52 (or 0 for prev)
  setNumber?: number;  // 1..20 for set_weight / set_reps / set_combined
  unitHint?: 'kg' | 'lbs';
}

const TARGET_RPE_HEADER_HINT = /^(?:target\s*|planned\s*|goal\s*|prescribed\s*|expected\s*|recommended\s*)?(?:rpe|r\.p\.e\.?|intensity\s*\(?rpe\)?|effort\s*\(?rpe\)?)(?:\s*(?:target|goal|level)|\s*\([^)]*\))?$/i;
const TARGET_RIR_HEADER_HINT = /^(?:target\s*|planned\s*|goal\s*|prescribed\s*|expected\s*|recommended\s*)?(?:(?:rir|rip|r\.i\.r\.?|r\.i\.p\.?)(?:\s*[/|]\s*(?:rir|rip))?|reps?\s*in\s*reserve)(?:\s*(?:target|goal|level)|\s*\([^)]*\))?$/i;

interface ColumnMap {
  day: number;
  superset: number;
  setsReps: number;
  name: number;
  sets: number;
  reps: number;
  targetRpe: number;
  targetRir: number;
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
export function splitSetsAndReps(raw?: string, allowSlash = false): { sets: string; reps: string } | null {
  const str = (raw || '').trim();
  if (!str) return null;

  // Match pattern like: "4 × 5–12", "4 x 5-12", "3 * 10", "4 sets × 8-12 reps", "4 sets of 10"
  const sepPattern = allowSlash ? '(?:[x×*\\/]|\\bof\\b)' : '(?:[x×*]|\\bsets?\\s+(?:of|\\/)\\s*)';
  const match = str.match(
    new RegExp(`^(\\d+(?:\\s*[-–]\\s*\\d+)?)\\s*(?:sets?|rounds?)?\\s*${sepPattern}\\s*(.+)$`, 'i')
  );
  if (match && match[1] && match[2]) {
    const setsPart = match[1].trim();
    const repsPart = match[2].replace(/\s*reps?$/i, '').trim();
    if (repsPart) {
      return { sets: setsPart, reps: repsPart };
    }
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

  // 1. Week + Set + Weight / Reps / RPE / RIR (e.g. "W1 S1 Weight", "Week 1 Set 2", "W1 S1 RPE", "W1 S1 RIP")
  const weekSetMatch = cell.match(
    /^(?:week|wk|w)\s*#?\s*(\d+)\s*[-–_: ]*\s*(?:set|s)\s*#?\s*(\d+)(?:\s*[-–_: ]*\s*(weight|wt|load|kg|lbs?|reps?|r|rpe|rir|rip|r\.i\.r\.?|r\.i\.p\.?))?$/i
  );
  if (weekSetMatch) {
    const wk = parseInt(weekSetMatch[1], 10);
    const sn = parseInt(weekSetMatch[2], 10);
    const sub = (weekSetMatch[3] || '').toLowerCase().replace(/\./g, '');
    if (wk >= 1 && wk <= 52 && sn >= 1 && sn <= 20) {
      if (sub === 'rpe') return { colIdx, kind: 'set_rpe', weekNumber: wk, setNumber: sn, unitHint };
      if (sub === 'rir' || sub === 'rip') return { colIdx, kind: 'set_rir', weekNumber: wk, setNumber: sn, unitHint };
      if (sub.startsWith('r')) return { colIdx, kind: 'set_reps', weekNumber: wk, setNumber: sn, unitHint };
      if (sub) return { colIdx, kind: 'set_weight', weekNumber: wk, setNumber: sn, unitHint };
      return { colIdx, kind: 'set_combined', weekNumber: wk, setNumber: sn, unitHint };
    }
  }

  // 2. Week N Weight / Reps / RPE / RIR / Notes / Done / Combined
  const weekPrefixMatch = cell.match(
    /^(?:week|wk|w)\s*#?\s*(\d+)\s*[-–_: ]*(.*)$/i
  );
  if (weekPrefixMatch) {
    const wk = parseInt(weekPrefixMatch[1], 10);
    const rest = (weekPrefixMatch[2] || '').trim().toLowerCase();
    if (wk >= 1 && wk <= 52) {
      if (/^(?:set\s*breakdown|sets?\s*summary|set\s*details?)$/i.test(rest)) {
        return { colIdx, kind: 'week_breakdown', weekNumber: wk, unitHint };
      }
      if (!rest || /^(?:log|data|actual|performance|result|score|weight\s*(?:[x×*\/&,+]|\band\b)\s*reps?)$/i.test(rest)) {
        return { colIdx, kind: 'week_combined', weekNumber: wk, unitHint };
      }
      if (/\b(?:rpe|r\.p\.e)\b/i.test(rest)) {
        return { colIdx, kind: 'week_rpe', weekNumber: wk, unitHint };
      }
      if (/\b(?:rir|rip|r\.i\.r|r\.i\.p)\b|reps?\s*in\s*reserve/i.test(rest)) {
        return { colIdx, kind: 'week_rir', weekNumber: wk, unitHint };
      }
      if (/note|comment|feedback/i.test(rest)) {
        return { colIdx, kind: 'week_notes', weekNumber: wk, unitHint };
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
    /^(weight|wt|load|kg|lbs?|reps?|rpe|rir|rip|r\.i\.r\.?|r\.i\.p\.?|notes?|done|completed|status)\s*[-–_: (]*\s*(?:week|wk|w)\s*#?\s*(\d+)\)?$/i
  );
  if (weekSuffixMatch) {
    const sub = weekSuffixMatch[1].toLowerCase().replace(/\./g, '');
    const wk = parseInt(weekSuffixMatch[2], 10);
    if (wk >= 1 && wk <= 52) {
      if (/rpe/.test(sub)) return { colIdx, kind: 'week_rpe', weekNumber: wk, unitHint };
      if (/rir|rip/.test(sub)) return { colIdx, kind: 'week_rir', weekNumber: wk, unitHint };
      if (/note/.test(sub)) return { colIdx, kind: 'week_notes', weekNumber: wk, unitHint };
      if (/reps?/.test(sub)) return { colIdx, kind: 'week_reps', weekNumber: wk, unitHint };
      if (/done|complete|status/.test(sub)) return { colIdx, kind: 'week_done', weekNumber: wk, unitHint };
      return { colIdx, kind: 'week_weight', weekNumber: wk, unitHint };
    }
  }

  // 3. Per-Set columns without week (defaults to Week 1): "Set 1", "S1", "Set 1 Weight", "Set 2 Reps", "Set 1 RPE", "Set 1 RIP"
  const setColMatch = cell.match(
    /^(?:set|s)\s*#?\s*(\d+)(?:\s*[-–_: ]*\s*(weight|wt|load|kg|lbs?|reps?|r|rpe|rir|rip|r\.i\.r\.?|r\.i\.p\.?))?$/i
  );
  if (setColMatch) {
    const sn = parseInt(setColMatch[1], 10);
    const sub = (setColMatch[2] || '').toLowerCase().replace(/\./g, '');
    if (sn >= 1 && sn <= 20) {
      if (sub === 'rpe') return { colIdx, kind: 'set_rpe', weekNumber: 1, setNumber: sn, unitHint };
      if (sub === 'rir' || sub === 'rip') return { colIdx, kind: 'set_rir', weekNumber: 1, setNumber: sn, unitHint };
      if (sub.startsWith('r')) return { colIdx, kind: 'set_reps', weekNumber: 1, setNumber: sn, unitHint };
      if (sub) return { colIdx, kind: 'set_weight', weekNumber: 1, setNumber: sn, unitHint };
      return { colIdx, kind: 'set_combined', weekNumber: 1, setNumber: sn, unitHint };
    }
  }

  // 4. Previous / Prior / Last session columns (stored as weekNumber: 0 -> previousLogs)
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session)?)\s*rpe$/i.test(cell)) {
    return { colIdx, kind: 'prev_rpe', weekNumber: 0, unitHint };
  }
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session)?)\s*(?:rir|rip|r\.i\.r\.?|r\.i\.p\.?)$/i.test(cell)) {
    return { colIdx, kind: 'prev_rir', weekNumber: 0, unitHint };
  }
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session|time)?|old)\s*(?:weight|wt|load|kg|lbs?)?$/i.test(cell)) {
    if (/weight|wt|load|kg|lbs?/i.test(cell)) {
      return { colIdx, kind: 'prev_weight', weekNumber: 0, unitHint };
    }
    return { colIdx, kind: 'prev_combined', weekNumber: 0, unitHint };
  }
  if (/^(?:prev(?:ious)?|prior|last\s*(?:week|session)?)\s*reps?$/i.test(cell)) {
    return { colIdx, kind: 'prev_reps', weekNumber: 0, unitHint };
  }

  // 5a. Combined Weight x Reps / Load & Reps column (defaults to Week 1)
  if (/^(?:actual\s*|logged\s*|current\s*)?(?:weight|wt|load|kg|lbs?)\s*(?:[x×*\/&,+]|\band\b)\s*(?:reps?|r)(?:\s*\(.*\))?$/i.test(cell)) {
    return { colIdx, kind: 'week_combined', weekNumber: 1, unitHint };
  }

  // 5b. Generic logged Weight / Load column (defaults to Week 1)
  if (/^(?:actual\s*|logged\s*|current\s*|starting\s*|working\s*|prefilled\s*)?(?:weights?|wt|load|kg|lbs?|الوزن)(?:\s*\(.*\))?$/i.test(cell)) {
    return { colIdx, kind: 'weight', weekNumber: 1, unitHint };
  }

  // 6. Generic logged Actual/Performed Reps column (distinct from target Reps column)
  if (/^(?:actual\s*reps?|logged\s*reps?|done\s*reps?|completed\s*reps?|performed\s*reps?|prefilled\s*reps?|reps?\s*(?:done|logged|completed)|actual)$/i.test(cell)) {
    return { colIdx, kind: 'actual_reps', weekNumber: 1, unitHint };
  }

  // 7a. Generic / Target RPE column
  if (
    /^(?:actual\s*|logged\s*|avg\s*|target\s*|planned\s*|goal\s*|prescribed\s*|expected\s*|recommended\s*)?(?:rpe|r\.p\.e\.?|intensity\s*\(?rpe\)?|effort\s*\(?rpe\)?)(?:\s*(?:target|goal|level)|\s*\([^)]*\))?$/i.test(cell)
  ) {
    return { colIdx, kind: 'rpe', weekNumber: 1, unitHint };
  }

  // 7b. Generic / Target RIR (or RIP) column
  if (
    /^(?:actual\s*|logged\s*|avg\s*|target\s*|planned\s*|goal\s*|prescribed\s*|expected\s*|recommended\s*)?(?:(?:rir|rip|r\.i\.r\.?|r\.i\.p\.?)(?:\s*[/|]\s*(?:rir|rip))?|reps?\s*in\s*reserve)(?:\s*(?:target|goal|level)|\s*\([^)]*\))?$/i.test(cell)
  ) {
    return { colIdx, kind: 'rir', weekNumber: 1, unitHint };
  }

  // 8. Done / Completed / Checkmark status column
  if (/^(?:done|completed?|checked|status|finished|تم)$/i.test(cell)) {
    return { colIdx, kind: 'done', weekNumber: 1, unitHint };
  }

  return null;
}

function isHeaderRowMatch(row: string[]): { map: ColumnMap; matched: boolean; matchCount: number } {
  const fallback: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: 0, sets: 1, reps: 2, targetRpe: -1, targetRir: -1, notes: 3, video: 4, dataCols: [] };
  const map: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: -1, sets: -1, reps: -1, targetRpe: -1, targetRir: -1, notes: -1, video: -1, dataCols: [] };
  let matches = 0;

  // Track implicit un-numbered Week N blocks when coaches create repeated columns:
  // e.g. Exercise | Sets | Reps | Weight | Reps | Weight | Reps | Weight | Reps
  let implicitWeek = 1;
  const seenInImplicitWeek = new Set<string>();
  const advanceImplicitWeekIfSeen = (key: string) => {
    if (seenInImplicitWeek.has(key)) {
      implicitWeek = Math.min(52, implicitWeek + 1);
      seenInImplicitWeek.clear();
    }
  };

  let numericDataCells = 0;

  (row || []).forEach((rawCell, idx) => {
    const cell = (rawCell || '').toString().trim();
    if (!cell) return;
    if (/^[\d.,\-\s]+$/.test(cell)) {
      numericDataCells++;
      return;
    }
    if (/^\d+(?:[.,]\d+)?\s*(?:kgs?|lbs?|pounds?|x\s*\d+)$/i.test(cell) || /^(?:bw|bodyweight)(?:\s*\+\s*\d+)?$/i.test(cell)) {
      numericDataCells++;
      return;
    }

    const unit = detectUnitFromText(cell);
    if (unit && !map.unitHint) map.unitHint = unit;

    // Check explicit logged data columns FIRST so "Week 1 Reps" / "Set 1 Weight" / "Actual Reps" / "RIP" don't hijack target Sets/Reps
    const extraCol = classifyExtraDataHeader(cell, idx);
    if (extraCol) {
      const isGenericUnnumberedWeekMetric =
        extraCol.kind === 'weight' ||
        extraCol.kind === 'actual_reps' ||
        extraCol.kind === 'rpe' ||
        extraCol.kind === 'rir' ||
        extraCol.kind === 'done' ||
        (extraCol.kind === 'week_combined' && !/^(?:week|wk|w)\s*#?\s*\d+/i.test(cell));

      if (isGenericUnnumberedWeekMetric) {
        if (extraCol.kind === 'weight' || extraCol.kind === 'week_combined') {
          if (seenInImplicitWeek.has('weight') || seenInImplicitWeek.has('week_combined')) {
            implicitWeek = Math.min(52, implicitWeek + 1);
            seenInImplicitWeek.clear();
          }
          seenInImplicitWeek.add(extraCol.kind);
        } else {
          advanceImplicitWeekIfSeen(extraCol.kind);
          seenInImplicitWeek.add(extraCol.kind);
        }
        extraCol.weekNumber = implicitWeek;

        // If this is a subsequent repeated week block (Week 2+), upgrade generic kind -> week_* so it stays distinct
        if (implicitWeek >= 2) {
          if (extraCol.kind === 'weight') extraCol.kind = 'week_weight';
          else if (extraCol.kind === 'actual_reps') extraCol.kind = 'week_reps';
          else if (extraCol.kind === 'rpe') extraCol.kind = 'week_rpe';
          else if (extraCol.kind === 'rir') extraCol.kind = 'week_rir';
          else if (extraCol.kind === 'done') extraCol.kind = 'week_done';
        }
      }

      if (extraCol.kind === 'rpe' && implicitWeek === 1 && map.targetRpe === -1 && TARGET_RPE_HEADER_HINT.test(cell)) {
        map.targetRpe = idx;
      }
      if (extraCol.kind === 'rir' && implicitWeek === 1 && map.targetRir === -1 && TARGET_RIR_HEADER_HINT.test(cell)) {
        map.targetRir = idx;
      }

      map.dataCols.push(extraCol);
      matches++;
      return;
    }

    if (map.targetRpe === -1 && TARGET_RPE_HEADER_HINT.test(cell)) {
      map.targetRpe = idx;
    }
    if (map.targetRir === -1 && TARGET_RIR_HEADER_HINT.test(cell)) {
      map.targetRir = idx;
    }

    // Check combined "Sets x Reps" BEFORE individual sets / reps, and check video/notes/day BEFORE name
    if (map.setsReps === -1 && HEADER_HINTS.setsReps.test(cell)) { map.setsReps = idx; matches += 2; return; }
    if (map.day === -1 && HEADER_HINTS.day.test(cell)) { map.day = idx; matches++; return; }
    if (map.superset === -1 && HEADER_HINTS.superset.test(cell)) { map.superset = idx; matches++; return; }
    if (HEADER_HINTS.video.test(cell)) {
      if (map.video === -1) {
        map.video = idx;
        matches++;
      }
      // Never allow video/link/url columns to fall through and match map.name
      return;
    }
    if (HEADER_HINTS.notes.test(cell)) {
      if (map.notes === -1) {
        map.notes = idx;
        matches++;
      } else if (implicitWeek >= 2 || seenInImplicitWeek.size > 0) {
        advanceImplicitWeekIfSeen('week_notes');
        seenInImplicitWeek.add('week_notes');
        map.dataCols.push({ colIdx: idx, kind: 'week_notes', weekNumber: implicitWeek, unitHint: unit || map.unitHint });
        matches++;
      }
      return;
    }
    if (map.sets === -1 && HEADER_HINTS.sets.test(cell)) { map.sets = idx; matches++; return; }
    if (HEADER_HINTS.reps.test(cell)) {
      if (map.reps === -1) {
        map.reps = idx;
        matches++;
      } else {
        // Subsequent "Reps" column represents logged reps for the active implicit week block
        advanceImplicitWeekIfSeen('actual_reps');
        seenInImplicitWeek.add('actual_reps');
        map.dataCols.push({
          colIdx: idx,
          kind: implicitWeek >= 2 ? 'week_reps' : 'actual_reps',
          weekNumber: implicitWeek,
          unitHint: unit || map.unitHint,
        });
        matches++;
      }
      return;
    }
    if (map.name === -1 && HEADER_HINTS.name.test(cell)) { map.name = idx; matches++; return; }
  });

  // Standard 1st-column support: if Col 0 header matched Day/Split (no separate Exercise column) and Col 1+ matched Sets/Sets x Reps,
  // Col 0 holds Day banners + Exercise names together.
  if (map.name === -1 && map.day === 0 && (map.sets >= 1 || map.setsReps >= 1)) {
    map.name = 0;
    map.day = -1;
  }

  // If the sheet has both a combined "Sets x Reps" column AND a separate "Reps" column,
  // treat the separate "Reps" column as Week 1 actual/prefilled reps so user-logged reps aren't discarded.
  if (map.setsReps !== -1 && map.reps !== -1) {
    const repUnit = detectUnitFromText((row[map.reps] || '').toString());
    map.dataCols.push({ colIdx: map.reps, kind: 'actual_reps', weekNumber: 1, unitHint: repUnit || map.unitHint });
    map.reps = -1;
  }

  // Guard against false-positive header matches on actual exercise rows containing numeric sets/reps/weights
  // (unless explicit Sets & Reps / Exercise headers are actually present on this row)
  if (numericDataCells >= 1 && map.sets === -1 && map.reps === -1 && map.setsReps === -1) {
    return { map: fallback, matched: false, matchCount: 0 };
  }

  if (matches >= 2 && map.name !== -1) {
    return {
      map,
      matched: true,
      matchCount: matches,
    };
  }

  return { map: fallback, matched: false, matchCount: 0 };
}

/**
 * Merge dual-row headers when templates have group headers like [Program, '', '', Week 1, '', Week 2, '']
 * directly above sub-headers like [Exercise, Sets, Reps, Weight, Reps, Weight, Reps].
 */
function buildMergedDualHeaderRow(primaryRow: string[], subRow?: string[]): { combined: string[]; usedSubRow: boolean } {
  if (!subRow || subRow.length === 0) return { combined: primaryRow, usedSubRow: false };

  const subHeaderToken = /^(?:weight|wt|load|kg|lbs?|reps?|rpe|rir|rip|r\.i\.r\.?|r\.i\.p\.?|set\s*detail|set\s*breakdown|sets?\s*summary|weight\s*(?:[x×*\/&,+]|\band\b)\s*reps?|notes?|comments?|remarks?|actual(?:\s*reps?)?|done|status|completed?|finished|check(?:ed)?|s\d+|set\s*\d+|الوزن|تكرار)(?:\s*\([^)]*\))?$/i;
  const subMatches = subRow.filter(c => subHeaderToken.test((c || '').trim())).length;
  if (subMatches < 2) return { combined: primaryRow, usedSubRow: false };

  const isCoreHeaderToken = (s: string): boolean =>
    HEADER_HINTS.name.test(s) ||
    HEADER_HINTS.sets.test(s) ||
    HEADER_HINTS.reps.test(s) ||
    HEADER_HINTS.setsReps.test(s) ||
    HEADER_HINTS.day.test(s) ||
    HEADER_HINTS.superset.test(s) ||
    HEADER_HINTS.notes.test(s) ||
    HEADER_HINTS.video.test(s) ||
    TARGET_RPE_HEADER_HINT.test(s) ||
    TARGET_RIR_HEADER_HINT.test(s);

  const maxLen = Math.max(primaryRow.length, subRow.length);
  const combined: string[] = [];
  let carriedGroup = '';

  for (let c = 0; c < maxLen; c++) {
    const p = (primaryRow[c] || '').trim();
    const s = (subRow[c] || '').trim();

    if (p) {
      // Carry forward group headers like "Week 1", "W1", "Set 1", "Previous" across blank sub-columns
      if (/^(?:(?:week|wk|w)\s*#?\s*\d+|(?:set|s)\s*#?\s*\d+|prev(?:ious)?|prior|last\s*week)(?:\s*[-–:|].*)?$/i.test(p)) {
        const prefixMatch = p.match(/^((?:week|wk|w)\s*#?\s*\d+|(?:set|s)\s*#?\s*\d+|prev(?:ious)?|prior|last\s*week)/i);
        carriedGroup = prefixMatch ? prefixMatch[1] : p;
      } else {
        carriedGroup = '';
      }
    }

    if (s && subHeaderToken.test(s)) {
      const prefix = carriedGroup;
      // Avoid double-prefixing if s already begins with Week / W1 / Set / Prev
      const alreadyPrefixed = /^(?:week|wk|w)\s*#?\s*\d+|^(?:set|s)\s*#?\s*\d+|^prev/i.test(s);
      combined.push(prefix && !alreadyPrefixed ? `${prefix} ${s}` : s);
    } else if (s && !carriedGroup && (isCoreHeaderToken(s) || !p)) {
      // Preserve specific Row-2 headers like Exercise / Sets / Reps / Video over generic Row-1 banners like "Program"
      combined.push(s);
    } else {
      combined.push(p || s);
    }
  }

  return { combined, usedSubRow: true };
}

function detectColumnMap(rows: string[][]): { map: ColumnMap; headerIndex: number; headerEndIndex: number; matched: boolean } {
  const fallback: ColumnMap = { day: -1, superset: -1, setsReps: -1, name: 0, sets: 1, reps: 2, targetRpe: -1, targetRir: -1, notes: 3, video: 4, dataCols: [] };

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
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

/** Parse a single cell or multi-set cell into one or more { weight, unit, reps, rpe, rir } pieces. */
function parseLoggedCellEntries(
  rawCell: string,
  defaultUnit?: 'kg' | 'lbs',
  options?: { pureWeightColumn?: boolean }
): Array<{ setNumber?: number; weight: string; unit?: 'kg' | 'lbs'; reps: string; rpe?: string; rir?: string }> {
  const raw = (rawCell || '').trim();
  if (!raw || /^[-—–_=]+$|^n\/?a$/i.test(raw)) return [];

  // Split multi-set cells separated by newline, semicolon, pipe, comma, or (in pure Weight columns) slash "/"
  const splitRegex = options?.pureWeightColumn
    ? /[\n;|\/]+|,(?=\s*\d)/
    : /[\n;|]+|,(?=\s*\d)/;
  const parts = raw
    .split(splitRegex)
    .map(p => p.trim())
    .filter(Boolean);

  const results: Array<{ setNumber?: number; weight: string; unit?: 'kg' | 'lbs'; reps: string; rpe?: string; rir?: string }> = [];

  for (const part of parts) {
    if (/^[-—–_=]+$|^n\/?a$/i.test(part)) continue;
    const partUnit = detectUnitFromText(part) || defaultUnit;

    // Optional trailing/inline RPE and RIR/RIP tokens (supports standalone OR combined "(RPE 8 · RIR 2)")
    let rpeVal: string | undefined;
    let rirVal: string | undefined;
    const body = part
      .replace(
        /\(([^)]*\b(?:rpe|rir|rip)\b[^)]*)\)/gi,
        (full, inner) => {
          const rpeIn = String(inner).match(/\brpe\s*[:=]?\s*(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/i)
            || String(inner).match(/(\d+(?:[.,]\d+)?)\s*rpe\b/i);
          const rirIn = String(inner).match(/\b(?:rir|rip)\s*[:=]?\s*(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/i)
            || String(inner).match(/(\d+(?:[.,]\d+)?)\s*(?:rir|rip)\b/i);
          if (rpeIn) rpeVal = rpeIn[1].replace(',', '.').trim();
          if (rirIn) rirVal = rirIn[1].replace(',', '.').trim();
          return (rpeIn || rirIn) ? '' : full;
        }
      )
      .replace(/\s*[@]?\s*\brpe\s*[:=]?\s*(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/gi, (_, val) => {
        if (!rpeVal) rpeVal = String(val).replace(',', '.').trim();
        return '';
      })
      .replace(/\s*[@]?\s*\b(?:rir|rip)\s*[:=]?\s*(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)/gi, (_, val) => {
        if (!rirVal) rirVal = String(val).replace(',', '.').trim();
        return '';
      })
      .trim();

    // Optional leading "S1:" or "Set 2:" label (preserve explicit setNumber so skipped empty sets don't shift indices)
    const setPrefixMatch = body.match(/^(?:set|s)\s*#?\s*(\d+)\s*[:.\-–]?\s*/i);
    const explicitSetNum = setPrefixMatch ? parseInt(setPrefixMatch[1], 10) : undefined;
    const cleaned = setPrefixMatch ? body.slice(setPrefixMatch[0].length).trim() : body;

    // Strip benign trailing annotations inside weight/rep cells like "(drop)", "each", "per arm", "paused"
    const repTokenPattern = '(\\d+(?:\\s*[-–]\\s*\\d+)?|amrap|failure|fail|max)';

    // Format: "BW + 15kg x 10", "BW+10 x AMRAP", "BW x 12", "Bodyweight x Failure", "BW + 15"
    const bwMatch = cleaned.match(
      new RegExp(`^(?:bw|bodyweight)(?:\\s*\\+\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:kgs?|lbs?|pounds?)?)?(?:\\s*(?:[x×*@/]|for)\\s*${repTokenPattern}(?:\\s*reps?)?)?(?:\\s*(?:\\([^)]*\\)|each(?:\\s*(?:side|arm|leg))?|per\\s*(?:side|arm|leg)|paused?|drop))?$`, 'i')
    );
    if (bwMatch) {
      const addedLoad = bwMatch[1] ? bwMatch[1].replace(',', '.').trim() : '';
      const rawRepToken = (bwMatch[2] || '').trim();
      const repOut = /^(?:amrap|failure|fail|max)$/i.test(rawRepToken) ? rawRepToken.toUpperCase() : rawRepToken;
      results.push({
        ...(explicitSetNum && explicitSetNum >= 1 && explicitSetNum <= 20 ? { setNumber: explicitSetNum } : {}),
        weight: addedLoad ? `BW+${addedLoad}` : 'BW',
        ...(partUnit ? { unit: partUnit } : {}),
        reps: repOut,
        ...(rpeVal ? { rpe: rpeVal } : {}),
        ...(rirVal ? { rir: rirVal } : {}),
      });
      continue;
    }

    // Format: "80kg x 10", "80 x 10", "80 * 10", "80 / 10", "80 @ 10", "80kg × 8-10", "100 x AMRAP"
    const wtRepsMatch = cleaned.match(
      new RegExp(`^(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?)\\s*(?:kgs?|lbs?|pounds?)?\\s*(?:[x×*@/]|for)\\s*${repTokenPattern}(?:\\s*reps?)?(?:\\s*(?:\\([^)]*\\)|each(?:\\s*(?:side|arm|leg))?|per\\s*(?:side|arm|leg)|paused?|drop))?$`, 'i')
    );
    if (wtRepsMatch) {
      const rawRepToken = wtRepsMatch[2].trim();
      const repOut = /^(?:amrap|failure|fail|max)$/i.test(rawRepToken) ? rawRepToken.toUpperCase() : rawRepToken;
      results.push({
        ...(explicitSetNum && explicitSetNum >= 1 && explicitSetNum <= 20 ? { setNumber: explicitSetNum } : {}),
        weight: wtRepsMatch[1].replace(',', '.').trim(),
        ...(partUnit ? { unit: partUnit } : {}),
        reps: repOut,
        ...(rpeVal ? { rpe: rpeVal } : {}),
        ...(rirVal ? { rir: rirVal } : {}),
      });
      continue;
    }

    // Format: "80kg", "80.5 lbs", "80", "25kg each", "80kg (paused)"
    const singleWtMatch = cleaned.match(
      /^(\d+(?:[.,]\d+)?)\s*(?:kgs?|lbs?|pounds?)?(?:\s*(?:\([^)]*\)|each(?:\s*(?:side|arm|leg))?|per\s*(?:side|arm|leg)|db|dbs|kb|plates?|paused?|drop))?$/i
    );
    if (singleWtMatch) {
      results.push({
        ...(explicitSetNum && explicitSetNum >= 1 && explicitSetNum <= 20 ? { setNumber: explicitSetNum } : {}),
        weight: singleWtMatch[1].replace(',', '.').trim(),
        ...(partUnit ? { unit: partUnit } : {}),
        reps: '',
        ...(rpeVal ? { rpe: rpeVal } : {}),
        ...(rirVal ? { rir: rirVal } : {}),
      });
      continue;
    }
  }

  return results;
}

function isTruthyDoneCell(raw?: string): boolean {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return false;
  return /^(✓|✔|☑|✅|x|yes|true|1|done|completed?|finished|ok|تم)$/i.test(v);
}

function isExplicitlyFalsyDoneCell(raw?: string): boolean {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return false;
  return /^(no|false|0|incomplete|pending|not\s*done|✗|✘)$/i.test(v);
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
  const notesCell = map.notes >= 0 && map.notes < cells.length ? cells[map.notes].trim() : '';
  const supersetCell = map.superset >= 0 && map.superset < cells.length ? cells[map.superset].trim() : '';
  const dayColCell = map.day >= 0 && map.day < cells.length ? cells[map.day].trim() : '';
  const nameColCell = map.name >= 0 && map.name < cells.length ? cells[map.name].trim() : '';

  // When an explicit Day column AND Exercise column both exist and hold distinct non-empty values on this row,
  // it is always an exercise row (even if Sets/Reps/Weights are temporarily blank), never a standalone Day banner.
  if (
    map.day >= 0 &&
    map.name >= 0 &&
    map.day !== map.name &&
    dayColCell !== '' &&
    nameColCell !== '' &&
    dayColCell.toLowerCase() !== nameColCell.toLowerCase()
  ) {
    return null;
  }

  const isRestNoteInReps = /^(?:rest|break|pause)\b/i.test(repsCell);
  const isQualitativeReps = /\b(?:amrap|failure|fail|max|bw|bodyweight|each)\b/i.test(`${setsCell} ${repsCell} ${srCell}`);
  const hasNumericSetsOrReps =
    /\d/.test(setsCell) ||
    /\d/.test(srCell) ||
    (/\d/.test(repsCell) && !isRestNoteInReps) ||
    isQualitativeReps;
  const hasExtraNumericData = map.dataCols.some(
    dc => dc.colIdx < cells.length && (/\d/.test(cells[dc.colIdx]) || /\b(?:amrap|failure|fail|max|bw|bodyweight)\b/i.test(cells[dc.colIdx]))
  );

  // If Sets/Reps/Weight/Notes/Superset columns are populated for this row, it's an exercise row — not a Day banner
  if ((hasNumericSetsOrReps || hasExtraNumericData || (nonEmpty.length >= 2 && (setsCell || repsCell || srCell || supersetCell))) && nonEmpty.length >= 2) {
    return null;
  }

  const isBannerText = (text: string): boolean => {
    const clean = text.trim();
    if (!clean) return false;
    if (STRICT_DAY_BANNER_PATTERN.test(clean)) return true;
    if (EXERCISE_NOUN_HINT.test(clean)) return false;
    return DAY_BANNER_PATTERN.test(clean);
  };

  if (nonEmpty.length === 1) {
    const label = nonEmpty[0];
    if (label.length >= 2 && label.length <= 100) {
      // Never swallow a lone exercise name like "Back Extension" or "Shoulder Press" as a Day banner
      if (EXERCISE_NOUN_HINT.test(label) && !STRICT_DAY_BANNER_PATTERN.test(label)) {
        return null;
      }
      return label;
    }
  }

  if (nonEmpty.length >= 2 && nonEmpty.length <= 3 && !hasNumericSetsOrReps && !hasExtraNumericData) {
    // If Notes is filled alongside Name (e.g. only 2 cells populated: Exercise + Notes), don't skip it as a Day banner unless it strictly looks like a Day header
    if (notesCell && !STRICT_DAY_BANNER_PATTERN.test(nonEmpty[0])) {
      return null;
    }
    const first = nonEmpty[0];
    const combined = nonEmpty.join(' — ');
    if (isBannerText(first)) {
      // If first cell is just "Day 1" / "D1", combine with second label like "Push" -> "Day 1 — Push"
      if (/^(?:day\s*#?\s*\d+|d\d+)$/i.test(first) && nonEmpty[1]) {
        return `${first} — ${nonEmpty[1]}`;
      }
      return first;
    }
    if (isBannerText(combined) && !EXERCISE_NOUN_HINT.test(combined)) {
      return nonEmpty.slice(0, 2).join(' — ');
    }
  }

  return null;
}

function colIndexToLetter(idx: number): string {
  let n = idx + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

function buildColumnMapFromOverride(
  cleanRows: string[][],
  override: SheetColumnOverride
): { map: ColumnMap; headerIndex: number; headerEndIndex: number; matched: boolean } {
  const hdrIdx = override.headerRowIndex;
  const headerRow = hdrIdx >= 0 && hdrIdx < cleanRows.length ? cleanRows[hdrIdx] : [];
  const subRow = hdrIdx >= 0 && hdrIdx + 1 < cleanRows.length ? cleanRows[hdrIdx + 1] : undefined;
  const dual = hdrIdx >= 0 ? buildMergedDualHeaderRow(headerRow, subRow) : { combined: [], usedSubRow: false };
  const effectiveHeaderRow = dual.usedSubRow ? dual.combined : headerRow;
  const headerEndIdx = dual.usedSubRow ? hdrIdx + 1 : hdrIdx;
  const autoBase = hdrIdx >= 0 ? isHeaderRowMatch(effectiveHeaderRow).map : undefined;

  const map: ColumnMap = {
    day: -1,
    superset: -1,
    setsReps: -1,
    name: -1,
    sets: -1,
    reps: -1,
    targetRpe: -1,
    targetRir: -1,
    notes: -1,
    video: -1,
    dataCols: [],
    unitHint: autoBase?.unitHint,
  };

  // Preserve specialized Set N / Prev / Week Breakdown metadata from auto-detection unless explicitly reassigned to something else
  const autoColByIdx = new Map<number, ExtraDataColumn>();
  if (autoBase) {
    for (const dc of autoBase.dataCols) {
      autoColByIdx.set(dc.colIdx, dc);
      if (dc.kind.startsWith('set_') || dc.kind.startsWith('prev_')) {
        if (!override.assignments[dc.colIdx]) {
          map.dataCols.push(dc);
        }
      }
    }
  }

  Object.entries(override.assignments).forEach(([colStr, role]) => {
    const colIdx = Number(colStr);
    if (!Number.isFinite(colIdx) || colIdx < 0 || !role || role === 'ignore') return;
    const hdrText = (effectiveHeaderRow[colIdx] || '').trim();
    const unit = detectUnitFromText(hdrText) || map.unitHint;
    if (unit && !map.unitHint) map.unitHint = unit;
    const autoCol = autoColByIdx.get(colIdx);

    switch (role) {
      case 'name':
        if (map.name === -1) map.name = colIdx;
        break;
      case 'day':
        if (map.day === -1) map.day = colIdx;
        break;
      case 'superset':
        if (map.superset === -1) map.superset = colIdx;
        break;
      case 'setsReps':
        if (map.setsReps === -1) map.setsReps = colIdx;
        break;
      case 'sets':
        if (map.sets === -1) map.sets = colIdx;
        break;
      case 'reps':
        if (map.reps === -1) map.reps = colIdx;
        break;
      case 'notes':
        if (autoCol?.kind === 'week_notes') {
          map.dataCols.push(autoCol);
        } else if (map.notes === -1) {
          map.notes = colIdx;
        }
        break;
      case 'video':
        if (map.video === -1) map.video = colIdx;
        break;
      case 'weight':
        map.dataCols.push(
          autoCol?.kind === 'set_weight' || autoCol?.kind === 'prev_weight'
            ? autoCol
            : { colIdx, kind: 'weight', weekNumber: 1, unitHint: unit }
        );
        break;
      case 'actual_reps':
        map.dataCols.push(
          autoCol?.kind === 'set_reps' || autoCol?.kind === 'prev_reps'
            ? autoCol
            : { colIdx, kind: 'actual_reps', weekNumber: 1, unitHint: unit }
        );
        break;
      case 'weight_reps':
        map.dataCols.push(
          autoCol?.kind === 'week_breakdown' || autoCol?.kind === 'set_combined' || autoCol?.kind === 'prev_combined'
            ? autoCol
            : { colIdx, kind: 'week_combined', weekNumber: 1, unitHint: unit }
        );
        break;
      case 'rpe':
        if (map.targetRpe === -1) map.targetRpe = colIdx;
        map.dataCols.push(
          autoCol?.kind === 'set_rpe' || autoCol?.kind === 'prev_rpe'
            ? autoCol
            : { colIdx, kind: 'rpe', weekNumber: 1, unitHint: unit }
        );
        break;
      case 'rir':
        if (map.targetRir === -1) map.targetRir = colIdx;
        map.dataCols.push(
          autoCol?.kind === 'set_rir' || autoCol?.kind === 'prev_rir'
            ? autoCol
            : { colIdx, kind: 'rir', weekNumber: 1, unitHint: unit }
        );
        break;
      case 'done':
        map.dataCols.push({ colIdx, kind: 'done', weekNumber: 1, unitHint: unit });
        break;
      case 'prev_combined':
        map.dataCols.push({ colIdx, kind: 'prev_combined', weekNumber: 0, unitHint: unit });
        break;
      case 'prev_weight':
        map.dataCols.push({ colIdx, kind: 'prev_weight', weekNumber: 0, unitHint: unit });
        break;
      case 'prev_reps':
        map.dataCols.push({ colIdx, kind: 'prev_reps', weekNumber: 0, unitHint: unit });
        break;
      case 'prev_rpe':
        map.dataCols.push({ colIdx, kind: 'prev_rpe', weekNumber: 0, unitHint: unit });
        break;
      case 'prev_rir':
        map.dataCols.push({ colIdx, kind: 'prev_rir', weekNumber: 0, unitHint: unit });
        break;
      default: {
        const wkRoleMatch = String(role).match(/^w([1-9]|[1-4]\d|5[0-2])_(weight|reps|rpe|rir|done|notes|combined)$/);
        if (wkRoleMatch) {
          const wkNum = Number(wkRoleMatch[1]);
          const metric = wkRoleMatch[2];
          if (metric === 'weight') {
            map.dataCols.push({ colIdx, kind: 'week_weight', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'reps') {
            map.dataCols.push({ colIdx, kind: 'week_reps', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'rpe') {
            if (wkNum === 1 && map.targetRpe === -1) map.targetRpe = colIdx;
            map.dataCols.push({ colIdx, kind: 'week_rpe', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'rir') {
            if (wkNum === 1 && map.targetRir === -1) map.targetRir = colIdx;
            map.dataCols.push({ colIdx, kind: 'week_rir', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'done') {
            map.dataCols.push({ colIdx, kind: 'week_done', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'notes') {
            map.dataCols.push({ colIdx, kind: 'week_notes', weekNumber: wkNum, unitHint: unit });
          } else if (metric === 'combined') {
            const kind = autoCol?.kind === 'week_breakdown' && autoCol.weekNumber === wkNum ? 'week_breakdown' : 'week_combined';
            map.dataCols.push({ colIdx, kind, weekNumber: wkNum, unitHint: unit });
          }
        }
        break;
      }
    }
  });

  return {
    map,
    headerIndex: hdrIdx,
    headerEndIndex: headerEndIdx,
    matched: map.name >= 0,
  };
}

function summarizeColumnsAndMissing(
  cleanRows: string[][],
  map: ColumnMap,
  headerIndex: number,
  headerEndIndex: number
): {
  detectedColumns: DetectedSheetColumnInfo[];
  missingRequiredColumns: AssignableColumnKey[];
  missingOptionalColumns: AssignableColumnKey[];
} {
  const sampleStart = headerEndIndex >= 0 ? headerEndIndex + 1 : 0;
  const headerRow =
    headerIndex >= 0 && headerIndex < cleanRows.length
      ? headerEndIndex > headerIndex
        ? buildMergedDualHeaderRow(cleanRows[headerIndex], cleanRows[headerEndIndex]).combined
        : cleanRows[headerIndex]
      : [];

  const maxCols = Math.max(
    headerRow.length,
    ...cleanRows.slice(0, 40).map(r => r.length),
    0
  );

  const detectedColumns: DetectedSheetColumnInfo[] = [];

  const getRoleForCol = (colIdx: number): ManualColumnMappingRole => {
    if (map.name === colIdx) return 'name';
    if (map.day === colIdx) return 'day';
    if (map.superset === colIdx) return 'superset';
    if (map.setsReps === colIdx) return 'setsReps';
    if (map.sets === colIdx) return 'sets';
    if (map.reps === colIdx) return 'reps';
    if (map.notes === colIdx) return 'notes';
    if (map.video === colIdx) return 'video';

    const dc = map.dataCols.find(d => d.colIdx === colIdx);
    if (dc) {
      const wk = dc.weekNumber ?? 1;
      if (wk >= 1 && wk <= 52) {
        if (dc.kind === 'week_weight') return `w${wk}_weight` as ManualColumnMappingRole;
        if (dc.kind === 'week_reps') return `w${wk}_reps` as ManualColumnMappingRole;
        if (dc.kind === 'week_rpe') return `w${wk}_rpe` as ManualColumnMappingRole;
        if (dc.kind === 'week_rir') return `w${wk}_rir` as ManualColumnMappingRole;
        if (dc.kind === 'week_done') return `w${wk}_done` as ManualColumnMappingRole;
        if (dc.kind === 'week_notes') return `w${wk}_notes` as ManualColumnMappingRole;
        if (dc.kind === 'week_breakdown' || (dc.kind === 'week_combined' && wk >= 2)) {
          return `w${wk}_combined` as ManualColumnMappingRole;
        }
      }
      if (dc.kind === 'prev_weight') return 'prev_weight';
      if (dc.kind === 'prev_reps') return 'prev_reps';
      if (dc.kind === 'prev_combined') return 'prev_combined';
      if (dc.kind === 'prev_rpe') return 'prev_rpe';
      if (dc.kind === 'prev_rir') return 'prev_rir';
      if (dc.kind === 'weight' || dc.kind === 'set_weight') return 'weight';
      if (dc.kind === 'actual_reps' || dc.kind === 'set_reps') return 'actual_reps';
      if (dc.kind === 'week_combined' || dc.kind === 'set_combined') return 'weight_reps';
      if (dc.kind === 'rpe' || dc.kind === 'set_rpe') return 'rpe';
      if (dc.kind === 'rir' || dc.kind === 'set_rir') return 'rir';
      if (dc.kind === 'done') return 'done';
    }
    if (map.targetRpe === colIdx) return 'rpe';
    if (map.targetRir === colIdx) return 'rir';
    return 'ignore';
  };

  for (let c = 0; c < maxCols; c++) {
    const rawHdr = headerIndex >= 0 ? (headerRow[c] || '').trim() : '';
    const sampleValues: string[] = [];
    for (let r = sampleStart; r < Math.min(cleanRows.length, sampleStart + 25); r++) {
      const val = (cleanRows[r]?.[c] || '').trim();
      if (val && !sampleValues.includes(val)) {
        sampleValues.push(val);
        if (sampleValues.length >= 2) break;
      }
    }
    const role = getRoleForCol(c);
    if (!rawHdr && sampleValues.length === 0 && role === 'ignore') continue;

    detectedColumns.push({
      colIdx: c,
      columnLetter: colIndexToLetter(c),
      headerName: rawHdr || `Column ${colIndexToLetter(c)} (${c + 1})`,
      hasExplicitHeader: Boolean(rawHdr),
      sampleValues,
      assignedRole: role,
    });
  }

  const hasName = map.name >= 0;
  const hasSets = map.sets >= 0 || map.setsReps >= 0;
  const hasReps = map.reps >= 0 || map.setsReps >= 0;

  const missingRequiredColumns: AssignableColumnKey[] = [];
  if (!hasName) missingRequiredColumns.push('name');
  if (!hasSets) missingRequiredColumns.push('sets');
  if (!hasReps) missingRequiredColumns.push('reps');

  const hasWeight = map.dataCols.some(dc =>
    dc.kind === 'weight' || dc.kind === 'week_weight' || dc.kind === 'set_weight' || dc.kind === 'week_combined' || dc.kind === 'week_breakdown' || dc.kind === 'set_combined'
  );
  const hasActualReps = map.dataCols.some(dc =>
    dc.kind === 'actual_reps' || dc.kind === 'week_reps' || dc.kind === 'set_reps' || dc.kind === 'week_combined' || dc.kind === 'week_breakdown' || dc.kind === 'set_combined'
  );
  const hasRpe = map.targetRpe >= 0 || map.dataCols.some(dc => dc.kind.includes('rpe'));
  const hasRir = map.targetRir >= 0 || map.dataCols.some(dc => dc.kind.includes('rir'));

  const missingOptionalColumns: AssignableColumnKey[] = [];
  if (!hasWeight) missingOptionalColumns.push('weight');
  if (!hasActualReps) missingOptionalColumns.push('actual_reps');
  if (!hasRpe) missingOptionalColumns.push('rpe');
  if (!hasRir) missingOptionalColumns.push('rir');
  if (map.notes < 0) missingOptionalColumns.push('notes');
  if (map.video < 0) missingOptionalColumns.push('video');

  return { detectedColumns, missingRequiredColumns, missingOptionalColumns };
}

/**
 * Convert a rectangular grid of text cells into structured exercise rows, linking each row to detected Day headers,
 * splitting "Sets x Reps", detecting supersets, auto-fetching video URLs, and extracting any pre-filled weights/reps/weeks.
 */
export function rowsToExercisesWithMeta(
  rows: string[][],
  linkGrid?: (string | undefined)[][],
  customOverride?: SheetColumnOverride
): {
  exercises: ParsedExerciseRow[];
  headerMatched: boolean;
  headerRowIndex: number;
  detectedColumns: DetectedSheetColumnInfo[];
  missingRequiredColumns: AssignableColumnKey[];
  missingOptionalColumns: AssignableColumnKey[];
  detectedDays: string[];
  detectedDataWeeks: number;
  detectedWeightUnit?: 'kg' | 'lbs';
  prefilledRowCount: number;
  hasRpeColumn: boolean;
  hasRirColumn: boolean;
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
      headerRowIndex: -1,
      detectedColumns: [],
      missingRequiredColumns: ['name', 'sets', 'reps'],
      missingOptionalColumns: ['weight', 'actual_reps', 'rpe', 'rir', 'notes', 'video'],
      detectedDays: [],
      detectedDataWeeks: 0,
      prefilledRowCount: 0,
      hasRpeColumn: false,
      hasRirColumn: false,
    };
  }

  const cleanRows = indexedRows.map(item => item.cells);
  const detectedInfo = customOverride
    ? buildColumnMapFromOverride(cleanRows, customOverride)
    : detectColumnMap(cleanRows);
  const { map: initialMap, headerIndex, headerEndIndex, matched } = detectedInfo;
  let activeMap = initialMap;
  const { detectedColumns, missingRequiredColumns, missingOptionalColumns } = summarizeColumnsAndMissing(
    cleanRows,
    initialMap,
    headerIndex,
    headerEndIndex
  );

  const mapHasRpe = (m: ColumnMap) =>
    m.targetRpe >= 0 || m.dataCols.some(dc => dc.kind === 'rpe' || dc.kind === 'week_rpe' || dc.kind === 'set_rpe' || dc.kind === 'prev_rpe');
  const mapHasRir = (m: ColumnMap) =>
    m.targetRir >= 0 || m.dataCols.some(dc => dc.kind === 'rir' || dc.kind === 'week_rir' || dc.kind === 'set_rir' || dc.kind === 'prev_rir');

  let hasRpeHeader = mapHasRpe(initialMap);
  let hasRirHeader = mapHasRir(initialMap);

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

  const initialHeaderSignature =
    headerIndex >= 0 && headerIndex < cleanRows.length
      ? cleanRows[headerIndex].map(c => c.trim().toLowerCase()).filter(Boolean).join('|')
      : '';

  for (let i = startIdx; i < indexedRows.length; i++) {
    const { cells, links } = indexedRows[i];

    // Skip exact repeated header rows (including custom user-mapped header rows repeated under Day 2+)
    if (initialHeaderSignature) {
      const rowSig = cells.map(c => c.trim().toLowerCase()).filter(Boolean).join('|');
      if (rowSig === initialHeaderSignature) {
        continue;
      }
    }

    // Check repeated section headers ONLY when no custom column override is locking the layout,
    // and never treat a row containing active sets/reps/data values as a section header.
    const rowHasConcreteExerciseData =
      (activeMap.sets >= 0 && /^\d+(?:\s*[-–]\s*\d+)?$/.test(at(cells, activeMap.sets))) ||
      (activeMap.reps >= 0 && /^\d+(?:\s*[-–]\s*\d+)?$/.test(at(cells, activeMap.reps))) ||
      (activeMap.setsReps >= 0 && /^\d+\s*[x×*\/]\s*\d+/i.test(at(cells, activeMap.setsReps))) ||
      activeMap.dataCols.some(dc => /^\d+(?:[.,]\d+)?(?:\s*(?:kgs?|lbs?))?$/i.test(at(cells, dc.colIdx)));

    if (!customOverride && !rowHasConcreteExerciseData) {
      const dualSub = buildMergedDualHeaderRow(cells, indexedRows[i + 1]?.cells);
      if (dualSub.usedSubRow) {
        const dualHeader = isHeaderRowMatch(dualSub.combined);
        if (dualHeader.matched) {
          activeMap = dualHeader.map;
          if (mapHasRpe(dualHeader.map)) hasRpeHeader = true;
          if (mapHasRir(dualHeader.map)) hasRirHeader = true;
          if (dualHeader.map.unitHint && !sheetUnitHint) sheetUnitHint = dualHeader.map.unitHint;
          i++; // skip consumed sub-header row
          continue;
        }
      }
      const subHeader = isHeaderRowMatch(cells);
      if (subHeader.matched) {
        activeMap = subHeader.map;
        if (mapHasRpe(subHeader.map)) hasRpeHeader = true;
        if (mapHasRir(subHeader.map)) hasRirHeader = true;
        if (subHeader.map.unitHint && !sheetUnitHint) sheetUnitHint = subHeader.map.unitHint;
        continue;
      }
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
      const split = splitSetsAndReps(srVal, true);
      if (split) {
        setsVal = split.sets;
        repsVal = split.reps;
      } else if (srVal) {
        setsVal = srVal;
      }
    } else if (setsVal) {
      const split = splitSetsAndReps(setsVal, false);
      if (split) {
        setsVal = split.sets;
        if (!repsVal) repsVal = split.reps;
      }
    }

    const rawNameVal = at(cells, activeMap.name);
    const extractedNameUrl = extractUrlFromText(rawNameVal);
    let nameVal = rawNameVal;
    if (extractedNameUrl) {
      nameVal = rawNameVal
        .replace(/https?:\/\/[^\s"'<>]+|(?:www\.|youtu\.be\/|youtube\.com\/|vimeo\.com\/|drive\.google\.com\/|instagram\.com\/|tiktok\.com\/)[^\s"'<>]+/gi, '')
        .replace(/^[\s\-–|:·()\[\]]+|[\s\-–|:·()\[\]]+$/g, '')
        .trim();
    }

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
    if (!resolvedVideo && extractedNameUrl) {
      resolvedVideo = extractedNameUrl;
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

    // If a row contained ONLY a URL (e.g. wrapped PDF video link row or mis-aligned link cell) and no exercise name/sets/reps,
    // attach the video URL to the previous exercise if missing and skip adding a URL-named exercise row.
    if (!nameVal && extractedNameUrl && !setsVal && !repsVal) {
      if (exercises.length > 0 && !exercises[exercises.length - 1].video && resolvedVideo) {
        exercises[exercises.length - 1].video = resolvedVideo;
      }
      continue;
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
        ...(patch.rpe !== undefined && patch.rpe !== '' ? { rpe: patch.rpe } : existing.rpe ? { rpe: existing.rpe } : {}),
        ...(patch.rir !== undefined && patch.rir !== '' ? { rir: patch.rir } : existing.rir ? { rir: existing.rir } : {}),
      };
    };

    const targetSetsNum = parseSetsCount(setsVal);
    let rowCompleted: boolean | undefined;

    // Process exported Set Breakdown columns FIRST as a baseline so explicit edits to Week N Weight / Reps / RPE / RIR always win
    const orderedDataCols = [
      ...activeMap.dataCols.filter(dc => dc.kind === 'week_breakdown'),
      ...activeMap.dataCols.filter(dc => dc.kind !== 'week_breakdown'),
    ];

    for (const dc of orderedDataCols) {
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
        } else if (isExplicitlyFalsyDoneCell(cellVal)) {
          const b = ensureWeek(wkNum, cellUnit);
          b.completed = false;
          if (wkNum === 1) rowCompleted = false;
        }
        continue;
      }

      if (dc.kind === 'week_notes') {
        const b = ensureWeek(wkNum, cellUnit);
        b.weekNote = cellVal;
        continue;
      }

      if (dc.kind === 'set_rpe') {
        const sIdx = Math.max(0, (dc.setNumber || 1) - 1);
        const rMatch = cellVal.match(/(\d+(?:[.,]\d+)?)/);
        if (rMatch) setEntrySlot(wkNum, sIdx, { rpe: rMatch[1].replace(',', '.').trim() }, cellUnit);
        continue;
      }

      if (dc.kind === 'set_rir') {
        const sIdx = Math.max(0, (dc.setNumber || 1) - 1);
        const rMatch = cellVal.match(/(\d+(?:[.,]\d+)?)/);
        if (rMatch) setEntrySlot(wkNum, sIdx, { rir: rMatch[1].replace(',', '.').trim() }, cellUnit);
        continue;
      }

      if (dc.kind === 'rpe' || dc.kind === 'week_rpe' || dc.kind === 'prev_rpe') {
        const cleanRawRpe = cellVal
          .replace(/^(?:target\s*|goal\s*)?rpe\s*[:=]?\s*/gi, '')
          .replace(/\s*\(avg\)\s*/gi, '')
          .trim();
        const rpeParts = cleanRawRpe
          .split(/[\n,;|/]+/)
          .map(x => x.replace(/rpe\s*[:=]?\s*/gi, '').trim())
          .filter(x => /\d/.test(x) && !/^[-—_]+$/.test(x));
        if (rpeParts.length === 1 && targetSetsNum > 1) {
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, { rpe: rpeParts[0] }, cellUnit);
          }
        } else {
          rpeParts.forEach((rv, idx) => {
            setEntrySlot(wkNum, idx, { rpe: rv }, cellUnit);
          });
        }
        continue;
      }

      if (dc.kind === 'rir' || dc.kind === 'week_rir' || dc.kind === 'prev_rir') {
        const cleanRawRir = cellVal
          .replace(/^(?:target\s*|goal\s*)?(?:rir|rip)\s*[:=]?\s*/gi, '')
          .replace(/\s*\(avg\)\s*/gi, '')
          .trim();
        const rirParts = cleanRawRir
          .split(/[\n,;|/]+/)
          .map(x => x.replace(/(?:rir|rip)\s*[:=]?\s*/gi, '').trim())
          .filter(x => /\d/.test(x) && !/^[-—_]+$/.test(x));
        if (rirParts.length === 1 && targetSetsNum > 1) {
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, { rir: rirParts[0] }, cellUnit);
          }
        } else {
          rirParts.forEach((rv, idx) => {
            setEntrySlot(wkNum, idx, { rir: rv }, cellUnit);
          });
        }
        continue;
      }

      if (dc.kind === 'set_combined' || dc.kind === 'set_weight' || dc.kind === 'set_reps') {
        const sIdx = Math.max(0, (dc.setNumber || 1) - 1);
        if (dc.kind === 'set_reps') {
          const rMatch = cellVal.match(/(\d+(?:\s*[-–]\s*\d+)?|\b(?:amrap|failure|fail|max)\b)/i);
          if (rMatch) {
            const cleanedRep = /^(?:amrap|failure|fail|max)$/i.test(rMatch[1]) ? rMatch[1].toUpperCase() : rMatch[1].trim();
            setEntrySlot(wkNum, sIdx, { reps: cleanedRep }, cellUnit);
          }
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
                ...(parsed[0].rpe ? { rpe: parsed[0].rpe } : {}),
                ...(parsed[0].rir ? { rir: parsed[0].rir } : {}),
              },
              cellUnit
            );
          }
        }
        continue;
      }

      if (dc.kind === 'week_combined' || dc.kind === 'week_breakdown' || dc.kind === 'prev_combined') {
        const parsedList = parseLoggedCellEntries(cellVal, cellUnit);
        if (parsedList.length === 1 && targetSetsNum > 1 && !parsedList[0].reps && !parsedList[0].setNumber) {
          // Single weight entered for a multi-set week (e.g. "80kg") -> fill Set 1..N
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, parsedList[0], cellUnit);
          }
        } else {
          parsedList.forEach((p, idx) => {
            const slotIdx = p.setNumber ? Math.max(0, p.setNumber - 1) : idx;
            setEntrySlot(wkNum, slotIdx, p, cellUnit);
          });
        }
        continue;
      }

      if (dc.kind === 'weight' || dc.kind === 'week_weight' || dc.kind === 'prev_weight') {
        const parsedList = parseLoggedCellEntries(cellVal, cellUnit, { pureWeightColumn: true });
        if (parsedList.length === 1 && targetSetsNum > 1 && !parsedList[0].setNumber) {
          // Single value in Weight column (e.g. "80") -> apply across sets 1..N
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, parsedList[0], cellUnit);
          }
        } else {
          parsedList.forEach((p, idx) => {
            const slotIdx = p.setNumber ? Math.max(0, p.setNumber - 1) : idx;
            setEntrySlot(wkNum, slotIdx, p, cellUnit);
          });
        }
        continue;
      }

      if (dc.kind === 'actual_reps' || dc.kind === 'week_reps' || dc.kind === 'prev_reps') {
        const repParts = cellVal
          .split(/[\n,;|\/]+/)
          .map(x => x.trim())
          .filter(x => (/\d/.test(x) || /^(?:amrap|failure|fail|max)$/i.test(x)) && !/^[-—_]+$/.test(x));
        if (repParts.length === 1 && targetSetsNum > 1) {
          const cleanR = repParts[0].replace(/\s*reps?$/i, '').trim();
          const finalR = /^(?:amrap|failure|fail|max)$/i.test(cleanR) ? cleanR.toUpperCase() : cleanR;
          for (let s = 0; s < targetSetsNum; s++) {
            setEntrySlot(wkNum, s, { reps: finalR }, cellUnit);
          }
        } else {
          repParts.forEach((r, idx) => {
            const cleanR = r.replace(/\s*reps?$/i, '').trim();
            const finalR = /^(?:amrap|failure|fail|max)$/i.test(cleanR) ? cleanR.toUpperCase() : cleanR;
            setEntrySlot(wkNum, idx, { reps: finalR }, cellUnit);
          });
        }
      }
    }

    // If a single-week sheet has Weight prefilled AND an exact numeric target/logged Reps column (e.g. "10" or "10, 9, 8", not a broad range "8-12"),
    // and no dedicated actual_reps/week_reps column already populated Week 1 reps, fill Week 1 set reps automatically too.
    if (
      weeklyLogs[1] &&
      weeklyLogs[1].entries.some(e => e.weight.trim() !== '' && e.reps.trim() === '') &&
      repsVal &&
      /^\d+(?:\s*[,;|\/]\s*\d+)*$/.test(repsVal.trim())
    ) {
      const exactRepParts = repsVal
        .split(/[,;|\/]+/)
        .map(x => x.trim())
        .filter(Boolean);
      const count = Math.max(targetSetsNum, weeklyLogs[1].entries.length, exactRepParts.length);
      for (let s = 0; s < count; s++) {
        const rVal = exactRepParts.length === 1 ? exactRepParts[0] : (exactRepParts[s] || '');
        if (rVal && (!weeklyLogs[1].entries[s] || !weeklyLogs[1].entries[s].reps.trim())) {
          setEntrySlot(1, s, { reps: rVal }, weeklyLogs[1].unit || sheetUnitHint);
        }
      }
    }

    // Clean empty weeklyLog buckets and compute summary fields
    const nonEmptyWeeks: Record<number, ParsedWeekData> = {};
    for (const [k, data] of Object.entries(weeklyLogs)) {
      const wk = Number(k);
      const populatedEntries = data.entries.filter(
        s => s.weight.trim() !== '' || s.reps.trim() !== '' || (s.rpe || '').trim() !== '' || (s.rir || '').trim() !== ''
      );
      if (populatedEntries.length > 0 || data.completed === true || data.completed === false || data.weekNote) {
        nonEmptyWeeks[wk] = {
          weekNumber: wk,
          ...(data.unit ? { unit: data.unit } : {}),
          entries: data.entries,
          ...(data.completed !== undefined ? { completed: data.completed } : {}),
          ...(data.weekNote ? { weekNote: data.weekNote } : {}),
        };
        if ((populatedEntries.length > 0 || data.completed === true || data.weekNote) && wk > maxDataWeek) {
          maxDataWeek = wk;
        }
      }
    }

    const rawTargetRpe = activeMap.targetRpe >= 0 ? at(cells, activeMap.targetRpe) : '';
    const cleanedTargetRpe = rawTargetRpe
      .replace(/^(?:target\s*)?rpe\s*[:=]?\s*/gi, '')
      .replace(/\s*\(avg\)\s*/gi, '')
      .trim();
    const firstWeekRpeEntry = nonEmptyWeeks[1]?.entries.find(e => (e.rpe || '').trim() !== '')?.rpe
      || Object.values(nonEmptyWeeks)[0]?.entries.find(e => (e.rpe || '').trim() !== '')?.rpe
      || '';
    const resolvedRpe = cleanedTargetRpe || firstWeekRpeEntry;

    const rawTargetRir = activeMap.targetRir >= 0 ? at(cells, activeMap.targetRir) : '';
    const cleanedTargetRir = rawTargetRir
      .replace(/^(?:target\s*)?(?:rir|rip)\s*[:=]?\s*/gi, '')
      .replace(/\s*\(avg\)\s*/gi, '')
      .trim();
    const firstWeekRirEntry = nonEmptyWeeks[1]?.entries.find(e => (e.rir || '').trim() !== '')?.rir
      || Object.values(nonEmptyWeeks)[0]?.entries.find(e => (e.rir || '').trim() !== '')?.rir
      || '';
    const resolvedRir = cleanedTargetRir || firstWeekRirEntry;

    const hasPrefilledData = Object.keys(nonEmptyWeeks).length > 0 || rowCompleted === true;
    if (hasPrefilledData) prefilledRowCount++;

    const w1Primary = nonEmptyWeeks[1]?.entries.find(e => e.weight || e.reps || e.rpe || e.rir)
      || Object.values(nonEmptyWeeks)[0]?.entries.find(e => e.weight || e.reps || e.rpe || e.rir);

    const row: ParsedExerciseRow = {
      ...(currentDay ? { day: currentDay } : {}),
      name: nameVal,
      sets: setsVal,
      reps: repsVal,
      ...(resolvedRpe ? { rpe: resolvedRpe } : {}),
      ...(resolvedRir ? { rir: resolvedRir } : {}),
      notes: notesVal,
      video: resolvedVideo,
      ...(ssInfo.isSuperset ? { isSuperset: true, supersetGroup: ssInfo.supersetGroup } : {}),
      ...(w1Primary?.weight ? { loggedWeight: w1Primary.weight } : {}),
      ...(w1Primary?.unit || sheetUnitHint ? { loggedUnit: w1Primary?.unit || sheetUnitHint } : {}),
      ...(w1Primary?.reps ? { loggedReps: w1Primary.reps } : {}),
      ...(Object.keys(nonEmptyWeeks).length > 0 ? { weeklyLogs: nonEmptyWeeks } : {}),
      ...(rowCompleted !== undefined ? { completed: rowCompleted } : {}),
    };

    if (row.name !== '' || row.sets !== '' || row.reps !== '' || row.rpe || row.rir || row.notes !== '' || row.video !== '' || hasPrefilledData) {
      exercises.push(row);
    }
  }

  const usedDays = Array.from(
    new Set(exercises.map(e => e.day?.trim()).filter((d): d is string => Boolean(d)))
  );

  const hasRpeColumn =
    hasRpeHeader ||
    exercises.some(
      e =>
        Boolean(e.rpe?.trim()) ||
        Object.values(e.weeklyLogs || {}).some(w => w.entries.some(s => Boolean(s.rpe?.trim())))
    );
  const hasRirColumn =
    hasRirHeader ||
    exercises.some(
      e =>
        Boolean(e.rir?.trim()) ||
        Object.values(e.weeklyLogs || {}).some(w => w.entries.some(s => Boolean(s.rir?.trim())))
    );

  return {
    exercises,
    headerMatched: matched,
    headerRowIndex: headerIndex,
    detectedColumns,
    missingRequiredColumns,
    missingOptionalColumns,
    detectedDays: usedDays,
    detectedDataWeeks: maxDataWeek,
    ...(sheetUnitHint ? { detectedWeightUnit: sheetUnitHint } : {}),
    prefilledRowCount,
    hasRpeColumn,
    hasRirColumn,
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

  const hasSetsOrRepsData = exercises.some(
    (e) => Boolean((e.sets || '').trim() || (e.reps || '').trim())
  );

  if (INFO_SHEET_NAME_HINT.test(trimmedName) && (!headerMatched || !hasSetsOrRepsData)) {
    return 'instructions';
  }

  if (headerMatched && exercises.length > 0 && hasSetsOrRepsData) {
    return 'workout';
  }

  if (WORKOUT_SHEET_NAME_HINT.test(trimmedName) && exercises.length > 0) {
    return 'workout';
  }

  if (headerMatched && exercises.length > 0) {
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
  const rawRowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;

  // Build dense grid first so vertical single-column !merges (e.g. merged Sets/Reps/Day/Video cells) can propagate cleanly
  const denseValues: string[][] = Array.from({ length: rawRowCount }, () => Array(colCount).fill(''));
  const denseLinks: (string | undefined)[][] = Array.from({ length: rawRowCount }, () => Array(colCount).fill(undefined));

  for (let r = range.s.r; r <= range.e.r; r++) {
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
      denseValues[r - range.s.r][c - range.s.c] = val;
      denseLinks[r - range.s.r][c - range.s.c] = link;
    }
  }

  // Propagate ONLY vertical single-column merges downward (leaves horizontal Day/Group banner merges untouched)
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = Array.isArray(sheet['!merges'])
    ? sheet['!merges']
    : [];
  for (const m of merges) {
    if (m.s.c === m.e.c && m.e.r > m.s.r) {
      const colOffset = m.s.c - range.s.c;
      const topRowOffset = m.s.r - range.s.r;
      if (topRowOffset < 0 || topRowOffset >= rawRowCount || colOffset < 0 || colOffset >= colCount) continue;
      const topVal = denseValues[topRowOffset][colOffset];
      const topLink = denseLinks[topRowOffset][colOffset];
      if (!topVal && !topLink) continue;
      for (let rr = m.s.r + 1; rr <= m.e.r; rr++) {
        const ro = rr - range.s.r;
        if (ro >= 0 && ro < rawRowCount) {
          if (!denseValues[ro][colOffset] && topVal) denseValues[ro][colOffset] = topVal;
          if (!denseLinks[ro][colOffset] && topLink) denseLinks[ro][colOffset] = topLink;
        }
      }
    }
  }

  const rows: string[][] = [];
  const linkGrid: (string | undefined)[][] = [];
  for (let r = 0; r < rawRowCount; r++) {
    const rowValues = denseValues[r];
    const rowLinks = denseLinks[r];
    if (rowValues.some(v => v !== '') || rowLinks.some(l => !!l)) {
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
      const parsed = rowsToExercisesWithMeta(rawRows, linkGrid);
      const suggestedRole = classifySheetRole(sheetName, rawRows, parsed.exercises, parsed.headerMatched);
      return {
        name: sheetName,
        rawRows,
        linkGrid,
        textContent: rowsToTextContent(rawRows),
        exercises: parsed.exercises,
        detectedDays: parsed.detectedDays,
        suggestedRole,
        headerMatched: parsed.headerMatched,
        headerRowIndex: parsed.headerRowIndex,
        detectedColumns: parsed.detectedColumns,
        missingRequiredColumns: parsed.missingRequiredColumns,
        missingOptionalColumns: parsed.missingOptionalColumns,
        detectedDataWeeks: parsed.detectedDataWeeks,
        ...(parsed.detectedWeightUnit ? { detectedWeightUnit: parsed.detectedWeightUnit } : {}),
        prefilledRowCount: parsed.prefilledRowCount,
        hasRpeColumn: parsed.hasRpeColumn,
        hasRirColumn: parsed.hasRirColumn,
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
    const parsed = rowsToExercisesWithMeta(rawRows);
    return [{
      name: file.name.replace(/\.[^.]+$/, '') || 'PDF Sheet',
      rawRows,
      textContent: rowsToTextContent(rawRows),
      exercises: parsed.exercises,
      detectedDays: parsed.detectedDays,
      suggestedRole: parsed.exercises.length > 0 ? 'workout' : 'instructions',
      headerMatched: parsed.headerMatched,
      headerRowIndex: parsed.headerRowIndex,
      detectedColumns: parsed.detectedColumns,
      missingRequiredColumns: parsed.missingRequiredColumns,
      missingOptionalColumns: parsed.missingOptionalColumns,
      detectedDataWeeks: parsed.detectedDataWeeks,
      ...(parsed.detectedWeightUnit ? { detectedWeightUnit: parsed.detectedWeightUnit } : {}),
      prefilledRowCount: parsed.prefilledRowCount,
      hasRpeColumn: parsed.hasRpeColumn,
      hasRirColumn: parsed.hasRirColumn,
    }];
  }

  const text = await file.text();
  const rawRows = parseDelimitedText(text)
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(c => c !== ''));
  const parsed = rowsToExercisesWithMeta(rawRows);
  return [{
    name: file.name.replace(/\.[^.]+$/, '') || 'Workout Sheet',
    rawRows,
    textContent: rowsToTextContent(rawRows),
    exercises: parsed.exercises,
    detectedDays: parsed.detectedDays,
    suggestedRole: parsed.exercises.length > 0 ? 'workout' : 'instructions',
    headerMatched: parsed.headerMatched,
    headerRowIndex: parsed.headerRowIndex,
    detectedColumns: parsed.detectedColumns,
    missingRequiredColumns: parsed.missingRequiredColumns,
    missingOptionalColumns: parsed.missingOptionalColumns,
    detectedDataWeeks: parsed.detectedDataWeeks,
    ...(parsed.detectedWeightUnit ? { detectedWeightUnit: parsed.detectedWeightUnit } : {}),
    prefilledRowCount: parsed.prefilledRowCount,
    hasRpeColumn: parsed.hasRpeColumn,
    hasRirColumn: parsed.hasRirColumn,
  }];
}

/** Parse any supported workout sheet file into structured exercise rows (first workout sheet). */
export async function parseSheetFile(file: File): Promise<ParsedExerciseRow[]> {
  const sheets = await parseSheetFileAllSheets(file);
  const preferred = sheets.find(s => s.suggestedRole === 'workout') || sheets[0];
  return preferred ? preferred.exercises : [];
}

/** Extract an explicit week number (1..52) from a sheet tab name like "Week 2", "Wk 3 - Push", "W4". */
export function extractWeekNumberFromTabName(tabName: string): number | null {
  const m = (tabName || '').trim().match(/^(?:week|wk|w)\s*#?\s*(\d{1,2})(?:\b.*)?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 52 ? n : null;
}

function stripWeekPrefixFromTabName(tabName: string): string {
  return (tabName || '')
    .trim()
    .replace(/^(?:week|wk|w)\s*#?\s*\d{1,2}\s*[-–:|·]*\s*/i, '')
    .trim();
}

export interface ConsolidatableWorkoutTab {
  name: string;
  customTitle?: string;
  exercises: ParsedExerciseRow[];
  hasRpeColumn?: boolean;
  hasRirColumn?: boolean;
  detectedDataWeeks?: number;
}

/**
 * Consolidate multiple workout tabs from a workbook into a unified exercise list with merged multi-week logs.
 * Handles both Week-by-Tab workbooks ("Week 1", "Week 2", "Week 3" OR "Program" + "Week 2" + "Week 3"
 * OR "Week 1 - Push", "Week 2 - Push") and Day-by-Tab workbooks ("Push", "Pull", "Legs").
 */
export function consolidateMultiTabWorkoutSheets(tabs: ConsolidatableWorkoutTab[]): {
  exercises: ParsedExerciseRow[];
  isWeekByTab: boolean;
  highestWeek: number;
  hasRpeColumn: boolean;
  hasRirColumn: boolean;
} {
  const weekTaggedCount = tabs.filter(t => extractWeekNumberFromTabName(t.name) !== null).length;
  const hasExplicitWeek2Plus = tabs.some(t => {
    const n = extractWeekNumberFromTabName(t.name);
    return n !== null && n >= 2;
  });
  const isWeekByTab =
    tabs.length > 1 &&
    (weekTaggedCount >= 2 || (hasExplicitWeek2Plus && weekTaggedCount >= 1));

  // Process week tabs chronologically (Week 1 -> Week 2 -> Week 3...) when week-by-tab is detected
  const orderedTabs = isWeekByTab
    ? [...tabs].sort((a, b) => (extractWeekNumberFromTabName(a.name) ?? 1) - (extractWeekNumberFromTabName(b.name) ?? 1))
    : tabs;

  const combinedExercises: ParsedExerciseRow[] = [];
  const weekConsolidationMap = new Map<string, ParsedExerciseRow[]>();
  const rowLatestTabWeek = new WeakMap<ParsedExerciseRow, number>();
  let highestWeek = 1;
  let hasRpeColumn = false;
  let hasRirColumn = false;

  const takeNextUnused = (list: ParsedExerciseRow[] | undefined, consumedInTab: Set<ParsedExerciseRow>): ParsedExerciseRow | undefined => {
    if (!list) return undefined;
    for (const candidate of list) {
      if (!consumedInTab.has(candidate)) {
        consumedInTab.add(candidate);
        return candidate;
      }
    }
    return undefined;
  };

  const findExistingRowForWeekConsolidation = (
    exDay: string,
    exName: string,
    consumedInTab: Set<ParsedExerciseRow>
  ): ParsedExerciseRow | undefined => {
    const strictName = normalizeExerciseMatchKey(exName, false);
    const looseName = normalizeExerciseMatchKey(exName, true);
    const normDay = normalizeExerciseMatchKey(exDay, false);
    if (!strictName && !looseName) return undefined;

    // 1. Exact canonical name + exact day
    if (normDay && strictName) {
      const m1 = takeNextUnused(weekConsolidationMap.get(`S:${normDay}||${strictName}`), consumedInTab);
      if (m1) return m1;
    }

    // 2. Fuzzy day match (e.g. "Push" vs "Day 1 - Push") + canonical name
    if (normDay && (strictName || looseName)) {
      const namePool = [
        ...(strictName ? weekConsolidationMap.get(`S:*||${strictName}`) || [] : []),
        ...(looseName ? weekConsolidationMap.get(`L:*||${looseName}`) || [] : []),
      ];
      for (const candidate of namePool) {
        if (consumedInTab.has(candidate)) continue;
        const candDay = normalizeExerciseMatchKey(candidate.day, false);
        if (candDay && (candDay.includes(normDay) || normDay.includes(candDay))) {
          consumedInTab.add(candidate);
          return candidate;
        }
      }
    }

    // 3. Loose canonical name + exact day
    if (normDay && looseName) {
      const m3 = takeNextUnused(weekConsolidationMap.get(`L:${normDay}||${looseName}`), consumedInTab);
      if (m3) return m3;
    }

    // 4. Exact canonical name across any day
    if (strictName) {
      const m4 = takeNextUnused(weekConsolidationMap.get(`S:*||${strictName}`), consumedInTab);
      if (m4) return m4;
    }

    // 5. Loose canonical name across any day
    if (looseName) {
      const m5 = takeNextUnused(weekConsolidationMap.get(`L:*||${looseName}`), consumedInTab);
      if (m5) return m5;
    }

    return undefined;
  };

  for (const ws of orderedTabs) {
    if (ws.detectedDataWeeks && ws.detectedDataWeeks > highestWeek) {
      highestWeek = ws.detectedDataWeeks;
    }
    const rawTabWeek = extractWeekNumberFromTabName(ws.name);
    // In a week-by-tab workbook, an untagged lead tab ("Program" / "Sheet1") serves as Week 1
    const effectiveTabWeek = isWeekByTab ? (rawTabWeek ?? 1) : null;
    if (effectiveTabWeek && effectiveTabWeek > highestWeek) {
      highestWeek = effectiveTabWeek;
    }
    const tabFallbackDay = rawTabWeek
      ? stripWeekPrefixFromTabName(ws.name)
      : (ws.customTitle?.trim() || ws.name);

    const consumedInTab = new Set<ParsedExerciseRow>();

    for (const ex of ws.exercises) {
      Object.keys(ex.weeklyLogs || {}).forEach(k => {
        const wn = Number(k);
        if (wn >= 1 && wn <= 52 && wn > highestWeek) highestWeek = wn;
      });

      if (isWeekByTab && effectiveTabWeek) {
        const exDay = (ex.day || tabFallbackDay || '').trim();
        const existingRow = findExistingRowForWeekConsolidation(exDay, ex.name || '', consumedInTab);

        // If this tab's name is e.g. "Week 2" and used Week 2 headers, prefer ex.weeklyLogs[2];
        // otherwise if it used generic Weight/Reps headers (mapped to week 1), promote week 1 -> week 2!
        const directTabWeekData = ex.weeklyLogs?.[effectiveTabWeek];
        const genericW1Data = effectiveTabWeek > 1 ? ex.weeklyLogs?.[1] : undefined;
        const sourceForTabWeek = directTabWeekData || genericW1Data;

        const mappedEntries =
          sourceForTabWeek?.entries && sourceForTabWeek.entries.length > 0
            ? sourceForTabWeek.entries
            : ex.loggedWeight || ex.loggedReps
            ? [{ setNumber: 1, weight: ex.loggedWeight || '', unit: ex.loggedUnit, reps: ex.loggedReps || '' }]
            : [];

        const incomingWeeklyClean: Record<number, ParsedWeekData> = {};
        Object.entries(ex.weeklyLogs || {}).forEach(([k, val]) => {
          const wk = Number(k);
          // Don't leave promoted generic week 1 inside week 1 if this tab itself is Week 2+ and had no explicit Week 1 data
          if (wk === 1 && effectiveTabWeek > 1 && !directTabWeekData && genericW1Data) return;
          incomingWeeklyClean[wk] = val;
        });

        const mergedWeekly: Record<number, ParsedWeekData> = {
          ...(existingRow?.weeklyLogs || {}),
          ...incomingWeeklyClean,
          ...(mappedEntries.length > 0 || sourceForTabWeek?.completed !== undefined || sourceForTabWeek?.weekNote
            ? {
                [effectiveTabWeek]: {
                  weekNumber: effectiveTabWeek,
                  unit: sourceForTabWeek?.unit || ex.loggedUnit,
                  entries: mappedEntries,
                  ...(sourceForTabWeek?.completed !== undefined
                    ? { completed: sourceForTabWeek.completed }
                    : ex.completed !== undefined
                    ? { completed: ex.completed }
                    : {}),
                  ...(sourceForTabWeek?.weekNote ? { weekNote: sourceForTabWeek.weekNote } : {}),
                },
              }
            : {}),
        };

        if (existingRow) {
          existingRow.weeklyLogs = mergedWeekly;
          const prevLatestWk = rowLatestTabWeek.get(existingRow) || 1;
          const isNewerTab = effectiveTabWeek >= prevLatestWk;
          if (isNewerTab) {
            rowLatestTabWeek.set(existingRow, effectiveTabWeek);
            if (exDay && (!existingRow.day || exDay !== existingRow.day)) existingRow.day = exDay;
            if (ex.sets?.trim()) existingRow.sets = ex.sets;
            if (ex.reps?.trim()) existingRow.reps = ex.reps;
            if (ex.video?.trim()) existingRow.video = ex.video;
            if (ex.notes?.trim()) existingRow.notes = ex.notes;
            if (ex.rpe?.trim()) existingRow.rpe = ex.rpe;
            if (ex.rir?.trim()) existingRow.rir = ex.rir;
            if (ex.isSuperset !== undefined) existingRow.isSuperset = ex.isSuperset;
            if (ex.supersetGroup?.trim()) existingRow.supersetGroup = ex.supersetGroup;
          } else {
            if (!existingRow.day && exDay) existingRow.day = exDay;
            if (!existingRow.sets && ex.sets) existingRow.sets = ex.sets;
            if (!existingRow.reps && ex.reps) existingRow.reps = ex.reps;
            if (!existingRow.video && ex.video) existingRow.video = ex.video;
            if (!existingRow.notes && ex.notes) existingRow.notes = ex.notes;
            if (!existingRow.rpe && ex.rpe) existingRow.rpe = ex.rpe;
            if (!existingRow.rir && ex.rir) existingRow.rir = ex.rir;
          }
        } else {
          const clone: ParsedExerciseRow = {
            ...ex,
            ...(exDay ? { day: exDay } : { day: undefined }),
            weeklyLogs: Object.keys(mergedWeekly).length > 0 ? mergedWeekly : ex.weeklyLogs,
          };
          rowLatestTabWeek.set(clone, effectiveTabWeek);
          consumedInTab.add(clone);
          const strictName = normalizeExerciseMatchKey(ex.name, false);
          const looseName = normalizeExerciseMatchKey(ex.name, true);
          const normDay = normalizeExerciseMatchKey(exDay, false);
          if (strictName) {
            weekConsolidationMap.set(`S:${normDay}||${strictName}`, [...(weekConsolidationMap.get(`S:${normDay}||${strictName}`) || []), clone]);
            weekConsolidationMap.set(`S:*||${strictName}`, [...(weekConsolidationMap.get(`S:*||${strictName}`) || []), clone]);
          }
          if (looseName) {
            weekConsolidationMap.set(`L:${normDay}||${looseName}`, [...(weekConsolidationMap.get(`L:${normDay}||${looseName}`) || []), clone]);
            weekConsolidationMap.set(`L:*||${looseName}`, [...(weekConsolidationMap.get(`L:*||${looseName}`) || []), clone]);
          }
          combinedExercises.push(clone);
        }
      } else {
        combinedExercises.push({
          ...ex,
          day: ex.day?.trim() || tabFallbackDay || undefined,
        });
      }
    }

    if (
      ws.hasRpeColumn ||
      ws.exercises.some(
        ex =>
          Boolean(ex.rpe?.trim()) ||
          Object.values(ex.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rpe?.trim())))
      )
    ) {
      hasRpeColumn = true;
    }
    if (
      ws.hasRirColumn ||
      ws.exercises.some(
        ex =>
          Boolean(ex.rir?.trim()) ||
          Object.values(ex.weeklyLogs || {}).some(w => w.entries?.some(e => Boolean(e.rir?.trim())))
      )
    ) {
      hasRirColumn = true;
    }
  }

  return {
    exercises: combinedExercises,
    isWeekByTab,
    highestWeek,
    hasRpeColumn,
    hasRirColumn,
  };
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
