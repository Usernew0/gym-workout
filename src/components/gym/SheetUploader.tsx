import React, { useRef, useState } from 'react';
import {
  Upload, FileSpreadsheet, Loader2, Trash2, Plus, Check,
  AlertTriangle, Video, User as UserIcon, Dumbbell
} from 'lucide-react';
import { UserAccount } from '../../types';
import { parseSheetFile, ParsedExerciseRow, emptyRow } from '../../lib/sheetParser';
import { buildWorkoutPlan, saveWorkoutPlanDoc } from '../../lib/gymService';

interface SheetUploaderProps {
  mode: 'user' | 'admin';
  currentUser: string;
  userAccounts?: UserAccount[];
  onSaved?: (ownerUsername: string) => void;
  onCancel?: () => void;
}

const ACCEPTED = '.xlsx,.xls,.csv,.tsv,.txt,.pdf';

export const SheetUploader: React.FC<SheetUploaderProps> = ({
  mode,
  currentUser,
  userAccounts = [],
  onSaved,
  onCancel,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedExerciseRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [assignTo, setAssignTo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setSavedMsg(null);
    setIsParsing(true);
    setFileName(file.name);
    try {
      const parsed = await parseSheetFile(file);
      if (parsed.length === 0) {
        setError('No exercise rows were detected in this file. Make sure the sheet has columns for exercise name, sets, reps, notes and video.');
        setRows([]);
      } else {
        setRows(parsed);
        if (!title) {
          setTitle(file.name.replace(/\.[^.]+$/, ''));
        }
      }
    } catch (err: any) {
      console.error('Sheet parse failed:', err);
      setError(`Could not read this file: ${err?.message || String(err)}`);
    } finally {
      setIsParsing(false);
    }
  };

  const updateRow = (idx: number, key: keyof ParsedExerciseRow, value: string) => {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const addRow = () => setRows(prev => [...prev, emptyRow()]);
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setError(null);
    if (rows.length === 0) {
      setError('Upload a sheet first (or add exercises manually).');
      return;
    }
    const ownerUsername = mode === 'admin' ? assignTo.trim() : currentUser.trim();
    if (!ownerUsername) {
      setError(mode === 'admin' ? 'Please choose which member this plan is assigned to.' : 'Missing user.');
      return;
    }
    if (!title.trim()) {
      setError('Please give this workout plan a title.');
      return;
    }

    setIsSaving(true);
    try {
      const plan = buildWorkoutPlan({
        ownerUsername,
        title,
        description,
        weeks,
        exercises: rows,
        sourceFileName: fileName || undefined,
        createdBy: currentUser,
        assignedByAdmin: mode === 'admin',
      });
      await saveWorkoutPlanDoc(plan);
      setSavedMsg(
        mode === 'admin'
          ? `Workout plan assigned to ${ownerUsername}.`
          : 'Your workout plan was saved. Check "My Workouts".'
      );
      setRows([]);
      setTitle('');
      setDescription('');
      setWeeks(1);
      setFileName('');
      if (inputRef.current) inputRef.current.value = '';
      onSaved?.(ownerUsername);
    } catch (err: any) {
      setError(`Failed to save the plan: ${err?.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

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
          {isParsing ? 'Reading sheet...' : 'Click or drop a workout sheet here'}
        </p>
        <p className="text-[11px] text-neutral-500 font-mono">Excel (.xlsx/.xls) · CSV · PDF</p>
        {fileName && !isParsing && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-full px-2.5 py-1 mt-1">
            <FileSpreadsheet className="w-3 h-3" /> {fileName}
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

      {/* Plan meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Plan title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            <span className="text-[11px] text-neutral-500">Optional — repeat the same sheet for this many weeks</span>
          </div>
        </label>
      </div>

      {mode === 'admin' && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5 text-red-400" /> Assign to member
          </span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="bg-neutral-900 border border-white/10 focus:border-red-500/60 rounded-xl px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">— Select a member —</option>
            {userAccounts.map((u) => (
              <option key={u.id} value={u.username}>{u.username}</option>
            ))}
          </select>
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

      {/* Preview / editor */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/60 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-red-500" />
              {rows.length} exercise{rows.length === 1 ? '' : 's'} detected
            </span>
            <button
              onClick={addRow}
              className="text-[11px] font-semibold text-red-300 hover:text-red-200 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/60">
                  <th className="px-2 py-2 font-semibold">Exercise</th>
                  <th className="px-2 py-2 font-semibold w-20">Sets</th>
                  <th className="px-2 py-2 font-semibold w-20">Reps</th>
                  <th className="px-2 py-2 font-semibold">Notes</th>
                  <th className="px-2 py-2 font-semibold">Video link</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className="border-t border-white/5">
                    {(['name', 'sets', 'reps', 'notes', 'video'] as (keyof ParsedExerciseRow)[]).map((key) => (
                      <td key={key} className="px-1 py-1">
                        <input
                          value={row[key]}
                          onChange={(e) => updateRow(idx, key, e.target.value)}
                          className="w-full bg-transparent focus:bg-neutral-900 border border-transparent focus:border-red-500/40 rounded-lg px-2 py-1.5 text-[12px] text-white outline-none"
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-center">
                      <button
                        onClick={() => removeRow(idx)}
                        className="p-1.5 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2 text-[11px] text-neutral-500">
            <Video className="w-3.5 h-3.5" />
            Video links open directly from each exercise when the plan is viewed.
          </div>
        </div>
      )}

      {rows.length === 0 && !isParsing && (
        <button
          onClick={addRow}
          className="text-[12px] font-semibold text-neutral-400 hover:text-white inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Or build the plan row by row
        </button>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={isSaving || rows.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-red-950/50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {mode === 'admin' ? 'Assign workout plan' : 'Save my workout plan'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-neutral-900 border border-white/10 hover:border-white/20 text-neutral-300 text-sm font-semibold"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default SheetUploader;
