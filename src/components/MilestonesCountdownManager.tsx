import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, Cake, Sparkles, Gift, ShieldCheck, 
  Timer, Clock, Check, AlertTriangle, 
  SlidersHorizontal, CheckCircle2, Heart, Layers, Lock
} from 'lucide-react';
import { 
  MilestoneCategory, CountdownConfig, 
  MilestoneQuotas, CoupleTenant, DEFAULT_COUNTDOWN_CONFIG, 
  DEFAULT_MILESTONE_QUOTAS 
} from '../types';

interface MilestonesCountdownManagerProps {
  totalMilestonesCount?: number;
  countdownConfig: CountdownConfig;
  milestoneQuotas: MilestoneQuotas;
  coupleTenants?: CoupleTenant[];
  onSaveCountdownConfig: (config: CountdownConfig) => Promise<void>;
  onSaveMilestoneQuotas: (quotas: MilestoneQuotas) => Promise<void>;
  isSyncing: boolean;
}

export const MilestonesCountdownManager: React.FC<MilestonesCountdownManagerProps> = ({
  totalMilestonesCount = 0,
  countdownConfig,
  milestoneQuotas,
  coupleTenants = [],
  onSaveCountdownConfig,
  onSaveMilestoneQuotas,
  isSyncing
}) => {
  // Local state for countdown config edits
  const [localCountdown, setLocalCountdown] = useState<CountdownConfig>(() => ({
    ...DEFAULT_COUNTDOWN_CONFIG,
    ...countdownConfig,
    allowedCategories: countdownConfig?.allowedCategories || ['anniversary', 'engagement', 'birthday', 'other']
  }));

  // Local state for milestone quotas edits
  const [localQuotas, setLocalQuotas] = useState<MilestoneQuotas>(() => ({
    ...DEFAULT_MILESTONE_QUOTAS,
    ...milestoneQuotas
  }));

  // Feedback notifications
  const [localSuccessMsg, setLocalSuccessMsg] = useState<string | null>(null);
  const [localErrorMsg, setLocalErrorMsg] = useState<string | null>(null);

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setLocalErrorMsg(msg);
      setTimeout(() => setLocalErrorMsg(null), 3500);
    } else {
      setLocalSuccessMsg(msg);
      setTimeout(() => setLocalSuccessMsg(null), 3500);
    }
  };

  // Synchronize when external props update
  React.useEffect(() => {
    if (countdownConfig) {
      setLocalCountdown(prev => ({
        ...prev,
        ...countdownConfig,
        allowedCategories: countdownConfig.allowedCategories || ['anniversary', 'engagement', 'birthday', 'other']
      }));
    }
  }, [countdownConfig]);

  React.useEffect(() => {
    if (milestoneQuotas) {
      setLocalQuotas(prev => ({
        ...prev,
        ...milestoneQuotas
      }));
    }
  }, [milestoneQuotas]);

  // Category visual badge helper
  const getCategoryMeta = (cat: MilestoneCategory) => {
    switch (cat) {
      case 'birthday':
        return {
          label: 'Birthdays',
          icon: Cake,
          badgeClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          textAccent: 'text-amber-400'
        };
      case 'engagement':
        return {
          label: 'Engagements',
          icon: Sparkles,
          badgeClass: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
          textAccent: 'text-purple-400'
        };
      case 'other':
        return {
          label: 'Other Milestones',
          icon: Gift,
          badgeClass: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
          textAccent: 'text-sky-400'
        };
      case 'anniversary':
      default:
        return {
          label: 'Anniversaries',
          icon: Heart,
          badgeClass: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
          textAccent: 'text-rose-400'
        };
    }
  };

  // Save countdown configuration
  const handleSaveCountdown = async () => {
    try {
      await onSaveCountdownConfig(localCountdown);
      showNotification('Dashboard countdown configuration saved successfully!');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save countdown configuration.', true);
    }
  };

  // Save milestone quotas
  const handleSaveQuotas = async () => {
    try {
      await onSaveMilestoneQuotas(localQuotas);
      showNotification('Milestone count capacity quotas saved successfully!');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save milestone count quotas.', true);
    }
  };

  // Quick adjust quota count
  const handleAdjustQuotaCount = (
    field: 'maxTotalMilestones' | 'maxAnniversaries' | 'maxBirthdays' | 'maxOtherMilestones',
    delta: number | 'unlimited'
  ) => {
    setLocalQuotas(prev => {
      let val: number;
      if (delta === 'unlimited') {
        val = -1;
      } else {
        const cur = prev[field] ?? -1;
        if (cur === -1) {
          val = Math.max(1, 10 + delta);
        } else {
          val = Math.max(1, cur + delta);
        }
      }
      return {
        ...prev,
        [field]: val
      };
    });
  };

  // Toggle category in allowed categories for countdown
  const handleToggleAllowedCategory = (cat: MilestoneCategory) => {
    setLocalCountdown(prev => {
      const existing = prev.allowedCategories || ['anniversary', 'engagement', 'birthday', 'other'];
      let updated: MilestoneCategory[];
      if (existing.includes(cat)) {
        if (existing.length <= 1) {
          showNotification('You must keep at least one category enabled for countdown cycling!', true);
          return prev;
        }
        updated = existing.filter(c => c !== cat);
      } else {
        updated = [...existing, cat];
      }
      return {
        ...prev,
        allowedCategories: updated
      };
    });
  };

  return (
    <div id="countdown_milestones_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24 space-y-6">
      
      {/* SECTION HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-rose-500/15 border border-rose-500/25 rounded-2xl text-rose-400 shadow-inner">
            <Timer className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-lg font-serif font-bold text-white tracking-wide flex items-center gap-2">
              Countdown & Milestone Quotas Manager
              <span className="text-[10px] font-sans font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Privacy Protected
              </span>
            </h2>
            <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
              Configure countdown behavior & milestone quotas without exposing private user memories
            </p>
          </div>
        </div>
      </div>

      {/* STRICT PRIVACY PROTECTION DIRECTIVE BANNER */}
      <div className="bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-neutral-900/60 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5 shadow-lg relative overflow-hidden">
        <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 shrink-0 mt-0.5">
          <Lock className="w-5 h-5" />
        </div>
        <div className="space-y-1 text-xs">
          <h4 className="font-semibold text-emerald-300 flex items-center gap-1.5 font-sans">
            Personal User Milestones Privacy Isolation
          </h4>
          <p className="text-neutral-300 leading-relaxed font-light">
            In compliance with our strict tenant privacy policies, individual milestone titles, descriptions, photos, and romantic love letters are <strong>strictly private to each couple</strong> and are <strong>never rendered or exposed in the admin panel</strong>. Admins can manage platform-level countdown rules, automated next-milestone behaviors, and capacity count quotas below.
          </p>
        </div>
      </div>

      {/* FEEDBACK TOASTS */}
      <AnimatePresence>
        {localSuccessMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center gap-2 shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{localSuccessMsg}</span>
          </motion.div>
        )}
        {localErrorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs rounded-xl flex items-center gap-2 shadow-lg"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{localErrorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5-METRIC HIGH-LEVEL SYSTEM STATS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* TOTAL CAPACITY QUOTA CARD */}
        <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-neutral-400">
            <span className="text-[10px] uppercase font-mono tracking-wider">Total Quota</span>
            <Layers className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-white font-mono">
              {localQuotas.maxTotalMilestones === -1 ? '∞' : localQuotas.maxTotalMilestones}
            </span>
            <span className="text-[10px] text-neutral-400">
              {localQuotas.maxTotalMilestones === -1 ? 'Unlimited' : 'Cap Limit'}
            </span>
          </div>
          <span className="text-[9px] text-neutral-500 mt-1">
            {totalMilestonesCount > 0 ? `${totalMilestonesCount} records synced` : 'Per couple space'}
          </span>
        </div>

        {/* ANNIVERSARIES CAPACITY QUOTA CARD */}
        <div className="bg-neutral-950/70 border border-rose-500/20 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-rose-300">
            <span className="text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-400 fill-rose-400/40" /> Anniversaries
            </span>
            <span className="text-[10px] font-mono bg-rose-500/20 px-1.5 py-0.2 rounded-md">💍</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-rose-400 font-mono">
              {localQuotas.maxAnniversaries === -1 ? '∞' : localQuotas.maxAnniversaries}
            </span>
            <span className="text-[10px] text-rose-300/70">
              {localQuotas.maxAnniversaries === -1 ? 'Unlimited' : 'Max Allowed'}
            </span>
          </div>
          <span className="text-[9px] text-rose-400/70 mt-1">Private memory quota</span>
        </div>

        {/* BIRTHDAYS CAPACITY QUOTA CARD */}
        <div className="bg-neutral-950/70 border border-amber-500/20 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-300">
            <span className="text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
              <Cake className="w-3 h-3 text-amber-400" /> Birthdays
            </span>
            <span className="text-[10px] font-mono bg-amber-500/20 px-1.5 py-0.2 rounded-md">🎂</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-amber-400 font-mono">
              {localQuotas.maxBirthdays === -1 ? '∞' : localQuotas.maxBirthdays}
            </span>
            <span className="text-[10px] text-amber-300/70">
              {localQuotas.maxBirthdays === -1 ? 'Unlimited' : 'Max Allowed'}
            </span>
          </div>
          <span className="text-[9px] text-amber-400/70 mt-1">Private memory quota</span>
        </div>

        {/* OTHER MILESTONES CAPACITY QUOTA CARD */}
        <div className="bg-neutral-950/70 border border-sky-500/20 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-sky-300">
            <span className="text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
              <Gift className="w-3 h-3 text-sky-400" /> Other Events
            </span>
            <span className="text-[10px] font-mono bg-sky-500/20 px-1.5 py-0.2 rounded-md">✨</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-sky-400 font-mono">
              {localQuotas.maxOtherMilestones === -1 ? '∞' : localQuotas.maxOtherMilestones}
            </span>
            <span className="text-[10px] text-sky-300/70">
              {localQuotas.maxOtherMilestones === -1 ? 'Unlimited' : 'Max Allowed'}
            </span>
          </div>
          <span className="text-[9px] text-sky-400/70 mt-1">Private memory quota</span>
        </div>

        {/* PRIVACY SHIELD CARD */}
        <div className="bg-neutral-950/70 border border-emerald-500/25 rounded-2xl p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-[10px] uppercase font-mono tracking-wider flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" /> Privacy
            </span>
            <span className="text-[10px] font-mono bg-emerald-500/20 px-1.5 py-0.2 rounded-md">🔒</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-bold text-emerald-300 font-mono">Protected</span>
            <span className="text-[10px] text-emerald-400/80">Per User</span>
          </div>
          <span className="text-[9px] text-emerald-400/70 mt-1">Zero admin leaks</span>
        </div>
      </div>

      {/* TWO COLUMN GRID: COUNTDOWN CONFIG (LEFT) & MILESTONE QUOTAS / CAPACITY LIMITS (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* COUNTDOWN MANAGER PANEL (7 COLS) */}
        <div className="lg:col-span-7 bg-neutral-950/80 border border-rose-500/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-rose-400" />
              <h3 className="text-sm font-serif font-bold text-white">Dashboard Countdown Rules</h3>
            </div>
            
            {/* Master Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs font-mono text-neutral-300">
                {localCountdown.enabled ? '🟢 Active on Home' : '🔴 Paused'}
              </span>
              <input
                type="checkbox"
                checked={localCountdown.enabled}
                onChange={(e) => setLocalCountdown({ ...localCountdown, enabled: e.target.checked })}
                className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 bg-neutral-900 border-white/20 cursor-pointer"
              />
            </label>
          </div>

          {/* Countdown Target Mode */}
          <div className="space-y-3">
            <label className="block text-xs font-mono uppercase text-rose-300">Countdown Mode Strategy</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLocalCountdown({ ...localCountdown, mode: 'auto_nearest' })}
                className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  localCountdown.mode !== 'custom'
                    ? 'bg-rose-500/20 border-rose-400 text-rose-200 shadow-md shadow-rose-950/50'
                    : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                }`}
              >
                <Clock className="w-4 h-4 text-rose-400" />
                <span className="font-bold">Auto-Nearest Milestone (Recommended)</span>
                <span className="text-[10px] text-neutral-400 text-center font-normal">
                  Calculates each couple's upcoming milestone automatically within their private space
                </span>
              </button>

              <button
                type="button"
                onClick={() => setLocalCountdown({ ...localCountdown, mode: 'custom' })}
                className={`p-3 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  localCountdown.mode === 'custom'
                    ? 'bg-rose-500/20 border-rose-400 text-rose-200 shadow-md shadow-rose-950/50'
                    : 'bg-neutral-900 border-white/10 text-neutral-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="font-bold">Platform-Wide Event Countdown</span>
                <span className="text-[10px] text-neutral-400 text-center font-normal">
                  Sets a custom system date (e.g. Valentine's Day, New Year, Anniversary Special)
                </span>
              </button>
            </div>
          </div>

          {/* If mode is custom: Custom inputs */}
          {localCountdown.mode === 'custom' && (
            <div className="space-y-3 bg-neutral-900/60 border border-white/5 p-3.5 rounded-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-neutral-300 mb-1">Custom Event Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Valentine's Day 2027, Our Special Day"
                    value={localCountdown.customTitle || ''}
                    onChange={(e) => setLocalCountdown({ ...localCountdown, customTitle: e.target.value })}
                    className="w-full bg-neutral-950 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-neutral-300 mb-1">Target Date (Egypt Time) *</label>
                  <input
                    type="date"
                    value={localCountdown.customDate || ''}
                    onChange={(e) => setLocalCountdown({ ...localCountdown, customDate: e.target.value })}
                    className="w-full bg-neutral-950 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-neutral-300 mb-1">Category Vibe</label>
                <select
                  value={localCountdown.customCategory || 'anniversary'}
                  onChange={(e) => setLocalCountdown({ ...localCountdown, customCategory: e.target.value as MilestoneCategory })}
                  className="w-full bg-neutral-950 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="anniversary">💍 Anniversary Countdown</option>
                  <option value="birthday">🎂 Birthday Countdown</option>
                  <option value="engagement">💎 Engagement Countdown</option>
                  <option value="other">✨ Special Milestone Countdown</option>
                </select>
              </div>
            </div>
          )}

          {/* Allowed Categories filter for Dashboard Carousel cycling */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono uppercase text-rose-300">
                Allowed Milestone Categories for Couples
              </label>
              <span className="text-[10px] text-neutral-500">
                Permitted types in private space countdown
              </span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['anniversary', 'birthday', 'engagement', 'other'] as MilestoneCategory[]).map((cat, idx) => {
                const isSelected = (localCountdown.allowedCategories || []).includes(cat);
                const meta = getCategoryMeta(cat);
                const CatIcon = meta.icon;
                return (
                  <button
                    key={`allowed-cat-${cat}-${idx}`}
                    type="button"
                    onClick={() => handleToggleAllowedCategory(cat)}
                    className={`px-2.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-500/20 border-rose-500/50 text-white'
                        : 'bg-neutral-900 border-white/5 text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 capitalize text-[11px]">
                      <CatIcon className="w-3 h-3" />
                      {cat}
                    </span>
                    {isSelected ? <Check className="w-3 h-3 text-rose-400" /> : <span className="text-neutral-600 text-xs">—</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Celebration message */}
          <div>
            <label className="block text-xs font-mono uppercase text-rose-300 mb-1">
              Celebration Banner Announcement (When Countdown Reaches 0)
            </label>
            <input
              type="text"
              placeholder="e.g. 🎉 Happy Anniversary & Special Day, My Love! 🎉"
              value={localCountdown.customCelebrationMessage || ''}
              onChange={(e) => setLocalCountdown({ ...localCountdown, customCelebrationMessage: e.target.value })}
              className="w-full bg-neutral-950 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500 placeholder:text-neutral-600"
            />
          </div>

          {/* Seconds toggle & Save Button */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-white/10">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={localCountdown.showFlipSeconds !== false}
                onChange={(e) => setLocalCountdown({ ...localCountdown, showFlipSeconds: e.target.checked })}
                className="w-3.5 h-3.5 rounded text-rose-600 bg-neutral-950 border-white/20"
              />
              <span>Display Seconds Flip Tiles</span>
            </label>

            <button
              type="button"
              onClick={handleSaveCountdown}
              disabled={isSyncing}
              className="w-full sm:w-auto px-5 py-2 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-rose-950/40 cursor-pointer disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Countdown Settings</span>
            </button>
          </div>
        </div>

        {/* MILESTONE COUNT CAPACITY LIMITS & QUOTAS PANEL (5 COLS) */}
        <div className="lg:col-span-5 bg-neutral-950/80 border border-amber-500/20 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-serif font-bold text-white">Milestone Count Capacity Quotas</h3>
              </div>
              <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                SaaS Quotas
              </span>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Define the maximum milestone count couples are allowed to add and retain in their private spaces. Set to <span className="text-amber-300 font-mono">-1</span> for unlimited capacity.
            </p>

            {/* Stepper Inputs for Quotas */}
            <div className="space-y-3">
              {/* Max Total Milestones */}
              <div className="bg-neutral-900/70 border border-white/5 p-2.5 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-white block">Total Milestone Capacity</span>
                  <span className="text-[10px] text-neutral-400">
                    {localQuotas.maxTotalMilestones === -1 ? 'Unlimited (-1)' : `Capped at ${localQuotas.maxTotalMilestones}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxTotalMilestones', -1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                    title="-1 limit"
                  >
                    -
                  </button>
                  <span className="text-xs font-mono font-bold text-amber-300 w-12 text-center">
                    {localQuotas.maxTotalMilestones === -1 ? '∞' : localQuotas.maxTotalMilestones}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxTotalMilestones', 1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                    title="+1 limit"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxTotalMilestones', 'unlimited')}
                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-neutral-400 hover:text-white cursor-pointer ml-1"
                  >
                    ∞
                  </button>
                </div>
              </div>

              {/* Max Anniversaries */}
              <div className="bg-neutral-900/70 border border-white/5 p-2.5 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-rose-300 block">💍 Anniversaries Allowed</span>
                  <span className="text-[10px] text-neutral-400">
                    {localQuotas.maxAnniversaries === -1 ? 'Unlimited (-1)' : `Capped at ${localQuotas.maxAnniversaries}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxAnniversaries', -1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-xs font-mono font-bold text-rose-300 w-12 text-center">
                    {localQuotas.maxAnniversaries === -1 ? '∞' : localQuotas.maxAnniversaries}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxAnniversaries', 1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxAnniversaries', 'unlimited')}
                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-neutral-400 hover:text-white cursor-pointer ml-1"
                  >
                    ∞
                  </button>
                </div>
              </div>

              {/* Max Birthdays */}
              <div className="bg-neutral-900/70 border border-white/5 p-2.5 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-amber-300 block">🎂 Birthdays Allowed</span>
                  <span className="text-[10px] text-neutral-400">
                    {localQuotas.maxBirthdays === -1 ? 'Unlimited (-1)' : `Capped at ${localQuotas.maxBirthdays}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxBirthdays', -1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-xs font-mono font-bold text-amber-300 w-12 text-center">
                    {localQuotas.maxBirthdays === -1 ? '∞' : localQuotas.maxBirthdays}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxBirthdays', 1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxBirthdays', 'unlimited')}
                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-neutral-400 hover:text-white cursor-pointer ml-1"
                  >
                    ∞
                  </button>
                </div>
              </div>

              {/* Max Other Milestones */}
              <div className="bg-neutral-900/70 border border-white/5 p-2.5 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-sky-300 block">✨ Other Milestones Allowed</span>
                  <span className="text-[10px] text-neutral-400">
                    {localQuotas.maxOtherMilestones === -1 ? 'Unlimited (-1)' : `Capped at ${localQuotas.maxOtherMilestones}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxOtherMilestones', -1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-xs font-mono font-bold text-sky-300 w-12 text-center">
                    {localQuotas.maxOtherMilestones === -1 ? '∞' : localQuotas.maxOtherMilestones}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxOtherMilestones', 1)}
                    className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 flex items-center justify-center text-xs font-bold cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustQuotaCount('maxOtherMilestones', 'unlimited')}
                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-neutral-400 hover:text-white cursor-pointer ml-1"
                  >
                    ∞
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10 flex justify-end">
            <button
              type="button"
              onClick={handleSaveQuotas}
              disabled={isSyncing}
              className="w-full sm:w-auto px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 active:scale-95"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save Milestone Count Quotas</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
