/**
 * Workout sheet parser
 * Supports Excel (.xlsx / .xls), CSV / TSV and PDF files.
 * Extracts rows of exercises with the columns: name, sets, reps, notes, video.
 */

export interface ParsedExerciseRow {
  name: string;
  sets: string;
  reps: string;
  notes: string;
  video: string;
}

const HEADER_HINTS = {
  name: /exercise|workout|movement|name|title|تمرين|اسم/i,
  sets: /set|round|مجموع|جولات/i,
  reps: /rep|repeat|تكرار/i,
  notes: /note|comment|cue|tempo|rest|تفاصيل|ملاحظ|تعليق/i,
  video: /video|link|url|clip|فيديو|رابط/i,
};

interface ColumnMap {
  name: number;
  sets: number;
  reps: number;
  notes: number;
  video: number;
}

function detectColumnMap(rows: string[][]): { map: ColumnMap; headerIndex: number } {
  // Default fallback: positional columns
  const fallback: ColumnMap = { name: 0, sets: 1, reps: 2, notes: 3, video: 4 };

  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const row = rows[i] || [];
    const lower = row.map(c => (c || '').toString());
    let matches = 0;
    const map: ColumnMap = { name: -1, sets: -1, reps: -1, notes: -1, video: -1 };

    lower.forEach((cell, idx) => {
      if (!cell) return;
      // Skip a cell that is purely numeric (data row, not a header)
      if (/^[\d.,\-\s]+$/.test(cell)) return;
      if (map.name === -1 && HEADER_HINTS.name.test(cell)) { map.name = idx; matches++; return; }
      if (map.sets === -1 && HEADER_HINTS.sets.test(cell)) { map.sets = idx; matches++; return; }
      if (map.reps === -1 && HEADER_HINTS.reps.test(cell)) { map.reps = idx; matches++; return; }
      if (map.video === -1 && HEADER_HINTS.video.test(cell)) { map.video = idx; matches++; return; }
      if (map.notes === -1 && HEADER_HINTS.notes.test(cell)) { map.notes = idx; matches++; return; }
    });

    if (matches >= 2 && map.name !== -1) {
      return { map: { ...fallback, ...Object.fromEntries(Object.entries(map).filter(([, v]) => v !== -1)) } as ColumnMap, headerIndex: i };
    }
  }

  return { map: fallback, headerIndex: -1 };
}

/** Convert a rectangular grid of text cells into structured exercise rows. */
export function rowsToExercises(rows: string[][]): ParsedExerciseRow[] {
  const cleanRows = (rows || [])
    .map(r => (r || []).map(c => (c === null || c === undefined ? '' : String(c).trim())))
    .filter(r => r.some(c => c !== ''));

  if (cleanRows.length === 0) return [];

  const { map, headerIndex } = detectColumnMap(cleanRows);
  const dataRows = headerIndex >= 0 ? cleanRows.slice(headerIndex + 1) : cleanRows;

  const at = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? (row[idx] || '').trim() : '');

  return dataRows
    .map(row => ({
      name: at(row, map.name),
      sets: at(row, map.sets),
      reps: at(row, map.reps),
      notes: at(row, map.notes),
      video: at(row, map.video),
    }))
    .filter(r => r.name !== '' || r.sets !== '' || r.reps !== '' || r.notes !== '' || r.video !== '');
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

    // Group text items into visual lines using their Y coordinate
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
      // Split into columns when the horizontal gap between items is large
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

/** Parse any supported workout sheet file into structured exercise rows. */
export async function parseSheetFile(file: File): Promise<ParsedExerciseRow[]> {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX: any = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const grid: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    return rowsToExercises(grid);
  }

  if (name.endsWith('.pdf')) {
    const grid = await parsePdf(file);
    return rowsToExercises(grid);
  }

  // Default: treat as delimited text (csv / tsv / txt)
  const text = await file.text();
  return rowsToExercises(parseDelimitedText(text));
}

export function emptyRow(): ParsedExerciseRow {
  return { name: '', sets: '', reps: '', notes: '', video: '' };
}
