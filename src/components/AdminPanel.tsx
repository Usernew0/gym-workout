import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, KeyRound, UserPlus, Lock, LogOut, CheckCircle, AlertCircle, 
  Trash2, Edit3, ShieldAlert, ShieldCheck, Database, RefreshCw, Home,
  LogIn, Eye, EyeOff, MessageSquareHeart, Gift, Calendar, Mail, HelpCircle, Images, 
  Clock, Search, Sparkles, Heart, ImageIcon, Upload, Download, FileText,
  Check, X, Sliders, User, HeartHandshake, Link, Unlink, Activity, Play,
  CheckCircle2, XCircle, AlertTriangle, Bug, Terminal, Copy, FileCheck, ChevronDown, ChevronUp,
  Crown, Plus, Shield, DollarSign, Layers, Ticket, Tag, Percent,
  Compass, Navigation, ChevronRight, Wrench, Code, Cake, Timer, SlidersHorizontal, Send,
  Music, Headphones, Volume2, VolumeX, Pause, ExternalLink, Dumbbell
} from 'lucide-react';

import imageCompression from 'browser-image-compression';
import { 
  UserAccount, AdminSetting, AdminAccount, UserActivityLog,
  TelegramConfig, DEFAULT_TELEGRAM_CONFIG,
  TelegramAuthorizedUser, TelegramCapturedSender, TelegramDiagnosticReport
} from '../types';
import { runAutomatedWebsiteTests, FullTestReport, TestCaseResult } from '../utils/autoTester';
import { 
  getTelegramConfig, 
  saveTelegramConfig as persistTelegramConfig, 
  testTelegramConnection,
  runTelegramBotDiagnostics,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  deleteTelegramWebhook,
  extractTelegramUsernamesFromProfiles,
  mergeProfileUsernamesIntoWhitelist,
  sendDirectTelegramMessage,
  addAuthorizedTelegramUser,
  removeAuthorizedTelegramUser,
  toggleAuthorizedTelegramUserStatus,
  fetchTelegramChatIdsFromUpdates,
  fetchTelegramChatIdsDetailed,
  fetchCapturedTelegramSenders,
  clearCapturedTelegramSenders,
  autoResolveTelegramUsers,
  testTelegramMultiBroadcast,
  syncTelegramBotCommands,
  TELEGRAM_COMMAND_DEFINITIONS
} from '../lib/telegramService';

import { HorizontalScrollWrapper } from './HorizontalScrollWrapper';
import { SecurityLogsDashboard } from './SecurityLogsDashboard';
import { AdminWorkoutManager } from './gym/AdminWorkoutManager';
import { TwoFactorSetupModal } from './TwoFactorSetupModal';
import { saveUserAccountDoc, 
  deleteUserAccountDoc, 
  saveAdminSettingDoc,
  subscribeToActivityLogs,
  getFirestoreActivityLogs,
  logActivity,
  useDatabaseStatus,
  useSupabaseTableDiagnostics,
  TableDiagnosticStatus,
  migrateAndDeduplicateFirestoreToSupabase,
  MigrationResult,
  syncAllDataToSupabase,
  SupabaseSyncSummary,
  SYNC_TABLES_LIST,
  SyncTableKey,
  syncSingleTableFirestoreToSupabase,
  syncSingleTableSupabaseToFirestore,
  syncAllTablesFirestoreToSupabase,
  syncAllTablesSupabaseToFirestore,
  TableSyncResult
} from '../lib/syncService';
import { isSupabaseConfigured } from '../lib/supabase';
import { isFirestoreOnline } from '../lib/firebase';
import { hashPassword } from '../utils/crypto';

export const SUPABASE_SCHEMA_FIX_SQL = `-- COMPLETE ALL-IN-ONE SUPABASE SCHEMA SETUP SCRIPT
-- Paste into Supabase Dashboard -> SQL Editor and click "Run"

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. User Accounts Table
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT,
  display_name TEXT,
  gender TEXT,
  role TEXT DEFAULT 'user',
  visible_tabs JSONB,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_backup_codes JSONB DEFAULT '[]'::jsonb,
  two_factor_created_at TIMESTAMPTZ,
  telegram_username TEXT,
  telegram_chat_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_created_at TIMESTAMPTZ;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User accounts access policy" ON public.user_accounts;
CREATE POLICY "User accounts access policy" ON public.user_accounts FOR ALL USING (true) WITH CHECK (true);

-- 2. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles access policy" ON public.profiles;
CREATE POLICY "Profiles access policy" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- 3. Activity Logs Table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Activity logs access policy" ON public.activity_logs;
CREATE POLICY "Activity logs access policy" ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);

-- 4. Admin Settings Table
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id TEXT PRIMARY KEY,
  password TEXT,
  username TEXT,
  admin_accounts JSONB,
  visible_tabs JSONB,
  favicon TEXT,
  auto_logout_minutes INT DEFAULT 15,
  auto_logout_enabled BOOLEAN DEFAULT FALSE,
  login_lockout_seconds INT DEFAULT 60,
  login_max_attempts INT DEFAULT 5,
  telegram_config JSONB,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_backup_codes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS admin_accounts JSONB;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS telegram_config JSONB;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS login_lockout_seconds INT DEFAULT 60;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS login_max_attempts INT DEFAULT 5;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin settings access policy" ON public.admin_settings;
CREATE POLICY "Admin settings access policy" ON public.admin_settings FOR ALL USING (true) WITH CHECK (true);

-- 5. Workout Plans Table
CREATE TABLE IF NOT EXISTS public.workout_plans (
  id TEXT PRIMARY KEY,
  owner_username TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  sheet_name TEXT,
  default_weight_unit TEXT DEFAULT 'kg',
  weeks INT DEFAULT 1,
  exercises JSONB DEFAULT '[]'::jsonb,
  source_file_name TEXT,
  created_by TEXT,
  assigned_by_admin BOOLEAN DEFAULT FALSE,
  progress JSONB DEFAULT '{}'::jsonb,
  exercise_logs JSONB DEFAULT '{}'::jsonb,
  previous_logs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS sheet_name TEXT;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS default_weight_unit TEXT DEFAULT 'kg';
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS exercise_logs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS previous_logs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workout plans access policy" ON public.workout_plans;
CREATE POLICY "Workout plans access policy" ON public.workout_plans FOR ALL USING (true) WITH CHECK (true);`;

const getLogIcon = (action: string) => {
  const normalized = action.toLowerCase();
  if (normalized.includes('login')) return <LogIn className="w-3.5 h-3.5 text-emerald-400" />;
  if (normalized.includes('logout')) return <LogOut className="w-3.5 h-3.5 text-neutral-400" />;
  if (normalized.includes('created')) return <Sparkles className="w-3.5 h-3.5 text-rose-400" />;
  if (normalized.includes('updated')) return <Edit3 className="w-3.5 h-3.5 text-sky-400" />;
  if (normalized.includes('deleted')) return <Trash2 className="w-3.5 h-3.5 text-rose-500" />;
  if (normalized.includes('reacted')) return <Heart className="w-3.5 h-3.5 text-pink-400 fill-pink-400 animate-pulse" />;
  if (normalized.includes('sent') || normalized.includes('letter')) return <Mail className="w-3.5 h-3.5 text-indigo-400" />;
  if (normalized.includes('chat')) return <MessageSquareHeart className="w-3.5 h-3.5 text-rose-400" />;
  return <Database className="w-3.5 h-3.5 text-blue-400" />;
};

interface AdminPanelProps {
  userAccounts: UserAccount[];
  adminSettings: AdminSetting[];
  onLogout: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ 
  userAccounts, 
  adminSettings, 
  onLogout 
}) => {
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUserGender, setNewUserGender] = useState<string>('male');
  const [newUserTelegram, setNewUserTelegram] = useState('');
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const [editingPassword, setEditingPassword] = useState('');
  const [editingUserGender, setEditingUserGender] = useState<string>('male');
  const [editingUserTelegram, setEditingUserTelegram] = useState('');
  const [userToDelete, setUserToDelete] = useState<UserAccount | null>(null);
  const [confirmActionDialog, setConfirmActionDialog] = useState<{
    title: string;
    subtitle: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [isConfirmActionRunning, setIsConfirmActionRunning] = useState(false);

  // Telegram Bot & Alert Notifications State
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(() => {
    const doc = adminSettings.find(s => s.id === 'telegramConfig');
    return doc?.telegramConfig || getTelegramConfig(adminSettings);
  });
  const [showBotToken, setShowBotToken] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isSavingTelegram, setIsSavingTelegram] = useState(false);
  const [telegramSaveStatus, setTelegramSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    const doc = adminSettings.find(s => s.id === 'telegramConfig');
    if (doc?.telegramConfig) {
      setTelegramConfig(doc.telegramConfig);
    }
  }, [adminSettings]);

  const [isResolvingChatIds, setIsResolvingChatIds] = useState(false);
  const [autoResolveStatus, setAutoResolveStatus] = useState<string | null>(null);
  const [detectedSenders, setDetectedSenders] = useState<TelegramCapturedSender[]>(() => {
    return telegramConfig.capturedSenders || [];
  });
  const [isRefreshingSenders, setIsRefreshingSenders] = useState(false);
  const [selectedLinkTargets, setSelectedLinkTargets] = useState<{ [chatId: string]: string }>({});
  const [linkingSenderChatId, setLinkingSenderChatId] = useState<string | null>(null);
  const [copiedChatId, setCopiedChatId] = useState<string | null>(null);

  // Load any cached or server senders on mount
  useEffect(() => {
    fetchCapturedTelegramSenders().then(senders => {
      if (Array.isArray(senders) && senders.length > 0) {
        setDetectedSenders(senders);
      }
    });
  }, []);

  const handleAutoResolveChatIds = async () => {
    if (!telegramConfig.botToken.trim()) {
      setAutoResolveStatus('⚠️ Please enter your Bot Token first.');
      setTimeout(() => setAutoResolveStatus(null), 4000);
      return;
    }

    setIsResolvingChatIds(true);
    setAutoResolveStatus(null);
    try {
      const res = await autoResolveTelegramUsers(telegramConfig, userAccounts);
      setTelegramConfig(res.updatedConfig);
      if (res.allSenders) {
        setDetectedSenders(res.allSenders);
      }
      await persistTelegramConfig(res.updatedConfig, async (setting) => {
        await saveAdminSettingDoc(setting);
      });

      if (res.newlyResolvedCount > 0) {
        const usernamesList = res.resolvedUsers.map(u => `${u.username} (ID: ${u.chatId})`).join(', ');
        setAutoResolveStatus(`🎉 Success! Auto-detected & verified Chat IDs for ${res.newlyResolvedCount} user(s): ${usernamesList}!`);
      } else {
        const totalKnown = (res.updatedConfig.authorizedUsers || []).filter(u => u.chatId && u.confirmed).length;
        const sendersFound = res.allSenders?.length || 0;
        if (sendersFound > 0) {
          const senderPreview = res.allSenders.slice(0, 3).map(s => `${s.username || s.firstName || 'User'} (ID: ${s.chatId})`).join(', ');
          setAutoResolveStatus(`ℹ️ Found ${sendersFound} recent message(s) from Telegram (${senderPreview}). You can link any of them instantly using the "⚡ Link & Verify" button in the Detected Senders card below!`);
        } else {
          setAutoResolveStatus(`ℹ️ Found ${totalKnown} active user(s) with Chat IDs. To add someone new, ask them to open your bot in Telegram and send "start" or "confirm", then click this button again!`);
        }
      }
    } catch (e: any) {
      setAutoResolveStatus(`❌ Failed to resolve updates: ${e.message || String(e)}`);
    } finally {
      setIsResolvingChatIds(false);
      setTimeout(() => setAutoResolveStatus(null), 8000);
    }
  };

  const handleRefreshDetectedSenders = async () => {
    if (!telegramConfig.botToken.trim()) {
      setAutoResolveStatus('⚠️ Please enter your Bot Token first.');
      setTimeout(() => setAutoResolveStatus(null), 3000);
      return;
    }
    setIsRefreshingSenders(true);
    try {
      const detailed = await fetchTelegramChatIdsDetailed(telegramConfig.botToken);
      if (detailed.senders) {
        setDetectedSenders(detailed.senders);
        setTelegramConfig(prev => ({
          ...prev,
          capturedSenders: detailed.senders
        }));
      }
      if (detailed.webhookReleased) {
        setAutoResolveStatus('🔓 Note: Bot webhook was active; automatically unlocked pending updates from Telegram!');
      } else {
        setAutoResolveStatus(`⚡ Retrieved ${detailed.senders?.length || 0} recent message(s) from Telegram Bot!`);
      }
    } catch (err: any) {
      setAutoResolveStatus(`Failed to fetch updates: ${err.message || String(err)}`);
    } finally {
      setIsRefreshingSenders(false);
      setTimeout(() => setAutoResolveStatus(null), 6000);
    }
  };

  const handleClearDetectedSenders = () => {
    setConfirmActionDialog({
      title: 'Clear Recent Telegram History?',
      subtitle: 'Detected Senders Cache',
      message: 'Are you sure you want to clear the recent Telegram messages & detected senders history?',
      confirmLabel: 'Clear History',
      onConfirm: async () => {
        await clearCapturedTelegramSenders();
        setDetectedSenders([]);
        setTelegramConfig(prev => ({ ...prev, capturedSenders: [] }));
        setAutoResolveStatus('Cleared recent message history.');
        setTimeout(() => setAutoResolveStatus(null), 3000);
      }
    });
  };

  const handleReleaseWebhookAndPull = async () => {
    if (!telegramConfig.botToken.trim()) {
      setAutoResolveStatus('⚠️ Please enter your Bot Token first.');
      setTimeout(() => setAutoResolveStatus(null), 3000);
      return;
    }
    setIsRefreshingSenders(true);
    setAutoResolveStatus('🔓 Releasing Telegram webhook lock and pulling unread messages...');
    try {
      await deleteTelegramWebhook(telegramConfig.botToken);
      await new Promise(r => setTimeout(r, 400));
      const detailed = await fetchTelegramChatIdsDetailed(telegramConfig.botToken);
      if (detailed.senders) {
        setDetectedSenders(detailed.senders);
        setTelegramConfig(prev => ({
          ...prev,
          webhookEnabled: false,
          capturedSenders: detailed.senders
        }));
      }
      setAutoResolveStatus(`🎉 Webhook released! Successfully retrieved ${detailed.senders?.length || 0} messages from Telegram!`);
    } catch (err: any) {
      setAutoResolveStatus(`Error: ${err.message || String(err)}`);
    } finally {
      setIsRefreshingSenders(false);
      setTimeout(() => setAutoResolveStatus(null), 6000);
    }
  };

  const handleQuickLinkSender = async (sender: TelegramCapturedSender) => {
    const target = selectedLinkTargets[sender.chatId] || sender.username || sender.firstName;
    if (!target) {
      setAutoResolveStatus('Please select or specify a target username to link.');
      setTimeout(() => setAutoResolveStatus(null), 3000);
      return;
    }
    setLinkingSenderChatId(sender.chatId);
    try {
      const cleanUser = target.startsWith('@') ? target.toLowerCase().trim() : `@${target.toLowerCase().trim()}`;
      
      const updated = addAuthorizedTelegramUser(telegramConfig, {
        telegramUsername: cleanUser,
        chatId: sender.chatId,
        appUsername: sender.firstName || cleanUser.replace(/^@/, ''),
        role: 'partner',
        confirmed: true
      });

      setTelegramConfig(updated);
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });

      setAutoResolveStatus(`🎉 Linked & Verified ${cleanUser} to Chat ID ${sender.chatId} successfully!`);
    } catch (err: any) {
      setAutoResolveStatus(`Failed to link user: ${err.message || String(err)}`);
    } finally {
      setLinkingSenderChatId(null);
      setTimeout(() => setAutoResolveStatus(null), 6000);
    }
  };

  const handleCopyChatId = (chatId: string) => {
    try {
      navigator.clipboard.writeText(chatId);
      setCopiedChatId(chatId);
      setTimeout(() => setCopiedChatId(null), 2500);
    } catch (e) {
      // ignore
    }
  };


  const handleTestTelegramConnection = async () => {
    if (!telegramConfig.botToken.trim()) {
      setTelegramTestStatus({
        success: false,
        message: 'Please enter your Telegram Bot Token.'
      });
      return;
    }

    setIsTestingTelegram(true);
    setTelegramTestStatus(null);
    try {
      // 1. Try to auto-resolve any missing Chat IDs from Telegram first
      let currentCfg = telegramConfig;
      try {
        const resolveRes = await autoResolveTelegramUsers(telegramConfig, userAccounts);
        if (resolveRes.newlyResolvedCount > 0) {
          currentCfg = resolveRes.updatedConfig;
          setTelegramConfig(currentCfg);
          await persistTelegramConfig(currentCfg, async (setting) => {
            await saveAdminSettingDoc(setting);
          });
        }
      } catch (rErr) {
        console.warn("Auto-resolve during test skipped:", rErr);
      }

      // 2. Dispatch multi-broadcast test alert to all recipients
      const result = await testTelegramMultiBroadcast(currentCfg);
      setTelegramTestStatus({
        success: result.success,
        message: result.message
      });
    } catch (err: any) {
      setTelegramTestStatus({
        success: false,
        message: err.message || 'Failed to ping Telegram Bot API'
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSaveTelegramConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingTelegram(true);
    setTelegramSaveStatus(null);
    try {
      await persistTelegramConfig(telegramConfig, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus('Telegram configuration saved and synchronized successfully!');
      setTimeout(() => setTelegramSaveStatus(null), 4000);
    } catch (err: any) {
      setTelegramTestStatus({
        success: false,
        message: 'Failed to save settings: ' + (err.message || String(err))
      });
    } finally {
      setIsSavingTelegram(false);
    }
  };

  // ==========================================
  // TELEGRAM WHITELIST & WEBHOOK MANAGEMENT
  // ==========================================
  const [newWhitelistUsername, setNewWhitelistUsername] = useState('');

  // Discovered Telegram usernames across registered user accounts
  const discoveredProfileUsernames = useMemo(() => {
    return extractTelegramUsernamesFromProfiles(userAccounts);
  }, [userAccounts]);

  // Combined active whitelist: manual usernames + auto-discovered from user profiles
  const activeCombinedWhitelist = useMemo(() => {
    const manual = telegramConfig.whitelistedUsernames || [];
    if (telegramConfig.autoSyncProfiles !== false) {
      return mergeProfileUsernamesIntoWhitelist(manual, userAccounts);
    }
    return manual;
  }, [telegramConfig.whitelistedUsernames, telegramConfig.autoSyncProfiles, userAccounts]);

  // Webhook form state
  const [webhookInputUrl, setWebhookInputUrl] = useState<string>(() => {
    if (telegramConfig.webhookUrl) return telegramConfig.webhookUrl;
    if (typeof window !== 'undefined' && window.location.origin) {
      return `${window.location.origin}/api/telegram/webhook`;
    }
    return '';
  });
  const [isManagingWebhook, setIsManagingWebhook] = useState(false);
  const [webhookInfoData, setWebhookInfoData] = useState<any | null>(null);
  const [webhookStatusNotice, setWebhookStatusNotice] = useState<{ success: boolean; message: string } | null>(null);

  // Synchronize webhookInputUrl if telegramConfig.webhookUrl changes
  useEffect(() => {
    if (telegramConfig.webhookUrl) {
      setWebhookInputUrl(telegramConfig.webhookUrl);
    }
  }, [telegramConfig.webhookUrl]);

  // Whitelist Handlers
  const handleAddWhitelistUsername = () => {
    const raw = newWhitelistUsername.trim();
    if (!raw) return;
    const clean = raw.startsWith('@') ? raw.toLowerCase() : `@${raw.toLowerCase()}`;
    const current = telegramConfig.whitelistedUsernames || [];
    if (!current.includes(clean)) {
      setTelegramConfig(prev => ({
        ...prev,
        whitelistedUsernames: [...(prev.whitelistedUsernames || []), clean]
      }));
    }
    setNewWhitelistUsername('');
  };

  const handleRemoveWhitelistUsername = (userToRemove: string) => {
    setTelegramConfig(prev => ({
      ...prev,
      whitelistedUsernames: (prev.whitelistedUsernames || []).filter(u => u.toLowerCase() !== userToRemove.toLowerCase())
    }));
  };

  const handleSyncAllProfilesToWhitelist = () => {
    const merged = mergeProfileUsernamesIntoWhitelist(telegramConfig.whitelistedUsernames || [], userAccounts);
    setTelegramConfig(prev => ({
      ...prev,
      whitelistedUsernames: merged
    }));
    setTelegramSaveStatus(`Auto-synced ${discoveredProfileUsernames.length} profile Telegram username(s) into whitelist!`);
    setTimeout(() => setTelegramSaveStatus(null), 4000);
  };

  // Webhook Handlers
  const handleSetWebhook = async () => {
    if (!telegramConfig.botToken || !webhookInputUrl) {
      setWebhookStatusNotice({ success: false, message: 'Please provide both Bot Token and Webhook URL.' });
      return;
    }
    setIsManagingWebhook(true);
    setWebhookStatusNotice(null);
    try {
      const res = await setTelegramWebhook(telegramConfig.botToken, webhookInputUrl);
      if (res.success) {
        setTelegramConfig(prev => ({
          ...prev,
          webhookUrl: webhookInputUrl,
          webhookEnabled: true,
          webhookLastCheckedAt: new Date().toISOString()
        }));
        setWebhookStatusNotice({ success: true, message: res.message || 'Webhook activated successfully on Telegram!' });
      } else {
        setWebhookStatusNotice({ success: false, message: res.error || 'Failed to set webhook.' });
      }
    } catch (e: any) {
      setWebhookStatusNotice({ success: false, message: e.message || 'Error configuring webhook.' });
    } finally {
      setIsManagingWebhook(false);
    }
  };

  const handleCheckWebhookInfo = async () => {
    if (!telegramConfig.botToken) {
      setWebhookStatusNotice({ success: false, message: 'Bot Token is required to inspect webhook.' });
      return;
    }
    setIsManagingWebhook(true);
    setWebhookStatusNotice(null);
    try {
      const res = await getTelegramWebhookInfo(telegramConfig.botToken);
      if (res.success && res.info) {
        setWebhookInfoData(res.info);
        const hasUrl = !!res.info.url;
        setWebhookStatusNotice({
          success: true,
          message: hasUrl 
            ? `Webhook is ACTIVE on: ${res.info.url} (${res.info.pending_update_count || 0} pending updates)`
            : 'No webhook is currently active on this bot (standard push/polling mode).'
        });
      } else {
        setWebhookStatusNotice({ success: false, message: res.error || 'Failed to inspect webhook.' });
      }
    } catch (e: any) {
      setWebhookStatusNotice({ success: false, message: e.message || 'Error checking webhook.' });
    } finally {
      setIsManagingWebhook(false);
    }
  };

  const handleDeleteWebhook = () => {
    if (!telegramConfig.botToken) {
      setWebhookStatusNotice({ success: false, message: 'Bot Token is required.' });
      return;
    }
    setConfirmActionDialog({
      title: 'Remove Telegram Webhook?',
      subtitle: 'Bot Connection Mode',
      message: 'Are you sure you want to remove the active Telegram webhook? The bot will revert to direct push/polling mode.',
      confirmLabel: 'Remove Webhook',
      onConfirm: async () => {
        setIsManagingWebhook(true);
        setWebhookStatusNotice(null);
        try {
          const res = await deleteTelegramWebhook(telegramConfig.botToken);
          if (res.success) {
            setTelegramConfig(prev => ({ ...prev, webhookEnabled: false }));
            setWebhookInfoData(null);
            setWebhookStatusNotice({ success: true, message: 'Webhook removed successfully!' });
          } else {
            setWebhookStatusNotice({ success: false, message: res.error || 'Failed to delete webhook.' });
          }
        } catch (e: any) {
          setWebhookStatusNotice({ success: false, message: e.message || 'Error deleting webhook.' });
        } finally {
          setIsManagingWebhook(false);
        }
      }
    });
  };

  const [isSyncingCommands, setIsSyncingCommands] = useState(false);

  const handleSyncBotCommands = async () => {
    if (!telegramConfig.botToken?.trim()) {
      setWebhookStatusNotice({ success: false, message: 'Enter your Telegram Bot Token first to register commands.' });
      return;
    }
    setIsSyncingCommands(true);
    setWebhookStatusNotice(null);
    try {
      const res = await syncTelegramBotCommands(telegramConfig.botToken);
      if (res.success) {
        setTelegramConfig(prev => ({
          ...prev,
          webhookEnabled: res.mode === 'webhook',
          webhookLastCheckedAt: new Date().toISOString()
        }));
        const replyInfo = res.repliesSent ? ` (${res.repliesSent} pending message${res.repliesSent === 1 ? '' : 's'} answered)` : '';
        setWebhookStatusNotice({
          success: true,
          message: `${res.message || 'Bot commands registered on Telegram!'}${replyInfo}`
        });
      } else {
        setWebhookStatusNotice({ success: false, message: res.error || 'Failed to sync bot commands.' });
      }
    } catch (err: any) {
      setWebhookStatusNotice({ success: false, message: err?.message || 'Error syncing bot commands.' });
    } finally {
      setIsSyncingCommands(false);
    }
  };

  // ==========================================
  // UNIFIED TELEGRAM & SECURITY HUB STATE & ACTIONS
  // ==========================================
  const [telegramHubActiveTab, setTelegramHubActiveTab] = useState<'users' | 'senders' | 'settings'>('users');
  const [telegramUserSearch, setTelegramUserSearch] = useState('');
  const [telegramUserFilter, setTelegramUserFilter] = useState<'all' | 'verified' | 'pending' | 'paused'>('all');
  
  // Telegram Diagnostics State
  const [isDiagnosingTelegram, setIsDiagnosingTelegram] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<TelegramDiagnosticReport | null>(null);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [diagnosticCustomChatId, setDiagnosticCustomChatId] = useState('');
  const [copyDiagnosticJsonSuccess, setCopyDiagnosticJsonSuccess] = useState(false);

  const [newAuthUsername, setNewAuthUsername] = useState('');
  const [newAuthAppUsername, setNewAuthAppUsername] = useState('');
  const [newAuthChatId, setNewAuthChatId] = useState('');
  const [newAuthRole, setNewAuthRole] = useState<'partner' | 'admin' | 'guest'>('partner');
  const [testingUserId, setTestingUserId] = useState<string | null>(null);
  const [userActionNotice, setUserActionNotice] = useState<{ [userId: string]: string }>({});

  // Consolidated Telegram Users & Whitelist Directory (No Duplication)
  const consolidatedTelegramUsers = useMemo(() => {
    const list: Array<{
      key: string;
      telegramUsername: string;
      id?: string;
      chatId?: string;
      appUsername?: string;
      role: 'partner' | 'admin' | 'guest';
      confirmed: boolean;
      confirmedAt?: string;
      isActive: boolean;
      source: 'registry' | 'whitelist' | 'profile';
      profileAccount?: UserAccount;
    }> = [];

    const processedHandles = new Set<string>();

    // 1. Process authorizedUsers registry
    (telegramConfig.authorizedUsers || []).forEach(u => {
      const handleLower = u.telegramUsername.toLowerCase().trim();
      processedHandles.add(handleLower);
      const matchedProfile = userAccounts.find(
        acc => acc.telegramUsername && acc.telegramUsername.toLowerCase().trim().replace(/^@/, '') === handleLower.replace(/^@/, '')
      ) || (u.appUsername ? userAccounts.find(acc => acc.username.toLowerCase() === u.appUsername!.toLowerCase()) : undefined);

      list.push({
        key: `auth-${u.id}`,
        id: u.id,
        telegramUsername: u.telegramUsername,
        chatId: u.chatId,
        appUsername: u.appUsername || matchedProfile?.username,
        role: u.role || 'partner',
        confirmed: !!u.confirmed,
        confirmedAt: u.confirmedAt,
        isActive: u.isActive !== false,
        source: matchedProfile ? 'profile' : 'registry',
        profileAccount: matchedProfile
      });
    });

    // 2. Process activeCombinedWhitelist (incorporates manual whitelistedUsernames & profile usernames)
    activeCombinedWhitelist.forEach(handle => {
      const handleLower = handle.toLowerCase().trim();
      if (!processedHandles.has(handleLower)) {
        processedHandles.add(handleLower);
        const matchedProfile = userAccounts.find(
          acc => acc.telegramUsername && acc.telegramUsername.toLowerCase().trim().replace(/^@/, '') === handleLower.replace(/^@/, '')
        );

        list.push({
          key: `white-${handleLower}`,
          telegramUsername: handle,
          role: 'partner',
          confirmed: false,
          isActive: true,
          source: matchedProfile ? 'profile' : 'whitelist',
          appUsername: matchedProfile?.username,
          profileAccount: matchedProfile
        });
      }
    });

    return list;
  }, [telegramConfig.authorizedUsers, activeCombinedWhitelist, userAccounts]);

  // Filtered Directory for Search & Status
  const filteredConsolidatedUsers = useMemo(() => {
    return consolidatedTelegramUsers.filter(u => {
      // Status filter
      if (telegramUserFilter === 'verified' && !u.confirmed) return false;
      if (telegramUserFilter === 'pending' && u.confirmed) return false;
      if (telegramUserFilter === 'paused' && u.isActive) return false;

      // Text search
      if (telegramUserSearch.trim()) {
        const query = telegramUserSearch.toLowerCase().trim();
        const matchHandle = u.telegramUsername.toLowerCase().includes(query);
        const matchApp = u.appUsername ? u.appUsername.toLowerCase().includes(query) : false;
        const matchChat = u.chatId ? u.chatId.includes(query) : false;
        const matchRole = u.role.toLowerCase().includes(query);
        if (!matchHandle && !matchApp && !matchChat && !matchRole) return false;
      }

      return true;
    });
  }, [consolidatedTelegramUsers, telegramUserFilter, telegramUserSearch]);

  // Diagnostic Test Runner
  const handleRunDiagnostics = async (customChat?: string) => {
    if (!telegramConfig.botToken.trim()) {
      setTelegramTestStatus({
        success: false,
        message: 'Please enter your Telegram Bot Token before running diagnostics.'
      });
      return;
    }

    setIsDiagnosingTelegram(true);
    setShowDiagnosticModal(true);
    setDiagnosticReport(null);

    const targetChat = (
      customChat !== undefined ? customChat : 
      diagnosticCustomChatId || 
      telegramConfig.chatId || 
      (telegramConfig.authorizedUsers || []).find(u => u.chatId && u.confirmed)?.chatId || 
      ''
    ).trim();

    try {
      const report = await runTelegramBotDiagnostics(telegramConfig.botToken, targetChat);
      setDiagnosticReport(report);
      if (report.success) {
        setTelegramTestStatus({
          success: true,
          message: `Diagnostics passed! Bot @${report.bot?.username || 'bot'} verified (${report.latencyMs}ms latency).`
        });
      } else {
        setTelegramTestStatus({
          success: false,
          message: report.error || 'Diagnostics reported an issue connecting to Telegram.'
        });
      }
    } catch (err: any) {
      setTelegramTestStatus({
        success: false,
        message: `Diagnostics failed: ${err.message || String(err)}`
      });
    } finally {
      setIsDiagnosingTelegram(false);
    }
  };

  const handleAddTelegramAuthorizedUser = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = newAuthUsername.trim();
    if (!raw) return;

    const cleanHandle = raw.startsWith('@') ? raw.toLowerCase() : `@${raw.toLowerCase()}`;

    // Add to authorized users
    let updated = addAuthorizedTelegramUser(telegramConfig, {
      telegramUsername: cleanHandle,
      chatId: newAuthChatId.trim() || undefined,
      appUsername: newAuthAppUsername.trim() || undefined,
      role: newAuthRole
    });

    // Keep whitelistedUsernames synced as well
    const currentWhitelist = updated.whitelistedUsernames || [];
    if (!currentWhitelist.map(w => w.toLowerCase()).includes(cleanHandle)) {
      updated = {
        ...updated,
        whitelistedUsernames: [...currentWhitelist, cleanHandle]
      };
    }

    setTelegramConfig(updated);
    setNewAuthUsername('');
    setNewAuthAppUsername('');
    setNewAuthChatId('');
    
    // Auto-save to persistence
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus(`Added ${cleanHandle} to Telegram & Security Hub!`);
      setTimeout(() => setTelegramSaveStatus(null), 4000);
    } catch (err: any) {
      console.warn("Could not auto-save after adding authorized user:", err);
    }
  };

  const handleRemoveConsolidatedUser = async (u: { id?: string; telegramUsername: string }) => {
    let updated = { ...telegramConfig };
    if (u.id) {
      updated = removeAuthorizedTelegramUser(updated, u.id);
    }
    const cleanHandle = u.telegramUsername.toLowerCase().trim();
    updated.whitelistedUsernames = (updated.whitelistedUsernames || []).filter(
      h => h.toLowerCase().trim() !== cleanHandle
    );

    setTelegramConfig(updated);
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus(`User ${u.telegramUsername} removed from Telegram & Security Hub.`);
      setTimeout(() => setTelegramSaveStatus(null), 3000);
    } catch (err: any) {
      console.warn("Could not save user removal:", err);
    }
  };

  const handlePromoteWhitelistUser = async (handle: string, role: 'partner' | 'admin' | 'guest' = 'partner') => {
    const clean = handle.startsWith('@') ? handle.toLowerCase() : `@${handle.toLowerCase()}`;
    const matchedProfile = userAccounts.find(
      acc => acc.telegramUsername && acc.telegramUsername.toLowerCase().trim().replace(/^@/, '') === clean.replace(/^@/, '')
    );
    
    const updated = addAuthorizedTelegramUser(telegramConfig, {
      telegramUsername: clean,
      appUsername: matchedProfile?.username,
      role,
      confirmed: true
    });

    setTelegramConfig(updated);
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus(`Verified and activated ${clean}!`);
      setTimeout(() => setTelegramSaveStatus(null), 4000);
    } catch (err: any) {
      console.warn("Could not save user promotion:", err);
    }
  };

  const handleRemoveAuthorizedUser = async (id: string) => {
    const updated = removeAuthorizedTelegramUser(telegramConfig, id);
    setTelegramConfig(updated);
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus('Authorized user removed.');
      setTimeout(() => setTelegramSaveStatus(null), 3000);
    } catch (err: any) {
      console.warn("Could not auto-save after removing authorized user:", err);
    }
  };

  const handleToggleAuthorizedUser = async (id: string, currentActive: boolean) => {
    const updated = toggleAuthorizedTelegramUserStatus(telegramConfig, id, !currentActive);
    setTelegramConfig(updated);
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
    } catch (err: any) {
      console.warn("Could not auto-save toggle state:", err);
    }
  };

  const handleManualConfirmUser = async (userId: string) => {
    const updatedUsers = (telegramConfig.authorizedUsers || []).map(u => {
      if (u.id === userId) {
        return {
          ...u,
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          isActive: true
        };
      }
      return u;
    });

    const updated = {
      ...telegramConfig,
      authorizedUsers: updatedUsers
    };
    setTelegramConfig(updated);
    try {
      await persistTelegramConfig(updated, async (setting) => {
        await saveAdminSettingDoc(setting);
      });
      setTelegramSaveStatus('User marked as manually confirmed & access granted!');
      setTimeout(() => setTelegramSaveStatus(null), 4000);
    } catch (err: any) {
      console.warn("Could not save manual confirm:", err);
    }
  };

  const handleTestIndividualUser = async (user: { id?: string; telegramUsername: string; chatId?: string }) => {
    if (!telegramConfig.botToken) {
      setTelegramTestStatus({ success: false, message: 'Bot Token is required to send tests.' });
      return;
    }
    const key = user.id || user.telegramUsername;
    if (!user.chatId) {
      setUserActionNotice(prev => ({ ...prev, [key]: 'No Chat ID! Ask user to send /confirm in the bot.' }));
      setTimeout(() => setUserActionNotice(prev => { const n = { ...prev }; delete n[key]; return n; }), 4000);
      return;
    }

    setTestingUserId(key);
    try {
      const pingMessage = `✨ <b>Our Home Verification Ping</b> 💕\n\n` +
        `Hello <b>${user.telegramUsername}</b>!\n` +
        `Your personal Telegram access is <b>Verified & Active</b> in Our Home.\n` +
        `You will receive milestone countdowns, date night alerts, and love letters directly in this chat! 💌\n\n` +
        `<i>Sent at ${new Date().toLocaleTimeString()}</i>`;

      const res = await sendDirectTelegramMessage(telegramConfig.botToken, user.chatId, pingMessage);
      if (res.success) {
        setUserActionNotice(prev => ({ ...prev, [key]: '✅ Test Ping Sent!' }));
      } else {
        setUserActionNotice(prev => ({ ...prev, [key]: `❌ ${res.error || 'Failed'}` }));
      }
    } catch (e: any) {
      setUserActionNotice(prev => ({ ...prev, [key]: `❌ ${e.message || 'Error'}` }));
    } finally {
      setTestingUserId(null);
      setTimeout(() => setUserActionNotice(prev => { const n = { ...prev }; delete n[key]; return n; }), 4000);
    }
  };

  // Floating Section Index Navigation & Real-time Scroll Tracking State
  const [activeSectionId, setActiveSectionId] = useState<string>('users_section');
  const [isSectionMenuOpen, setIsSectionMenuOpen] = useState<boolean>(false);
  const [isFloatingNavMinimized, setIsFloatingNavMinimized] = useState<boolean>(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);

  // Active section tracking via IntersectionObserver
  useEffect(() => {
    const sectionIds = [
      'workout_plans_section',
      'users_section',
      'activity_logs_section',
      'security_threats_section',
      'security_favicon_section',
      'telegram_alerts_section',
      'credentials_section',
      'db_diagnostics_section',
      'test_report_section',
    ];

    const observerOptions: IntersectionObserverInit = {
      root: null,
      rootMargin: '-15% 0px -60% 0px',
      threshold: 0
    };

    const handleIntersect: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSectionId(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(handleIntersect, observerOptions);

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => {
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) observer.unobserve(el);
      });
    };
  }, []);

  // Section index list for floating navigation
  const SECTION_LIST = useMemo(() => [
    { id: 'workout_plans_section', label: 'Workout Plans', icon: Dumbbell, badge: 'Gym' },
    { id: 'users_section', label: 'User Accounts', icon: Users, count: userAccounts.length },
    { id: 'activity_logs_section', label: 'Live Website Activity Logs', icon: Activity, badge: 'Logs' },
    { id: 'security_threats_section', label: 'Security Logs', icon: ShieldAlert, badge: 'Threats' },
    { id: 'security_favicon_section', label: 'Security Settings & Favicon', icon: ShieldCheck, badge: 'Settings' },
    { id: 'telegram_alerts_section', label: 'Telegram Bot Alerts', icon: Send, badge: 'Telegram' },
    { id: 'credentials_section', label: 'Admin Portal Credentials', icon: KeyRound, badge: 'Auth' },
    { id: 'db_diagnostics_section', label: 'Database Diagnostics & Sync', icon: Database, badge: 'Sync' },
    { id: 'test_report_section', label: 'Automated Test Report', icon: CheckCircle2, badge: 'Tests' },
  ], [userAccounts.length]);

  // Admin credentials state (Multi-admin portal support)
  const [adminAccountsList, setAdminAccountsList] = useState<AdminAccount[]>([]);
  const [showAdminPasswordIds, setShowAdminPasswordIds] = useState<Record<string, boolean>>({});
  const [showAllAdminPasswords, setShowAllAdminPasswords] = useState(false);
  const [syncingAdminId, setSyncingAdminId] = useState<string | null>(null);

  // Add new admin modal state
  const [isAddingAdmin, setIsAddingAdmin] = useState(false);
  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [newAdminRole, setNewAdminRole] = useState('Super Admin');
  const [newAdminNotes, setNewAdminNotes] = useState('');

  // Edit existing admin state
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [editAdminUser, setEditAdminUser] = useState('');
  const [editAdminPass, setEditAdminPass] = useState('');
  const [editAdminRole, setEditAdminRole] = useState('Super Admin');
  const [editAdminNotes, setEditAdminNotes] = useState('');

  // Delete admin confirmation state
  const [adminToDelete, setAdminToDelete] = useState<AdminAccount | null>(null);

  const [adminUsername, setAdminUsername] = useState(() => {
    const envUser = (import.meta as any).env?.VITE_APP_USERNAME || 'Admin';
    return envUser.trim();
  });
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [hasLoadedAdminSettings, setHasLoadedAdminSettings] = useState(false);
  
  // Feedback messages
  const [userSuccessMsg, setUserSuccessMsg] = useState<string | null>(null);
  const [userErrorMsg, setUserErrorMsg] = useState<string | null>(null);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Favicon upload states
  const [faviconSuccessMsg, setFaviconSuccessMsg] = useState<string | null>(null);
  const [faviconErrorMsg, setFaviconErrorMsg] = useState<string | null>(null);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [isDragOverFavicon, setIsDragOverFavicon] = useState(false);

  // Security auto-logout and login lockout settings states
  const [secLogoutEnabled, setSecLogoutEnabled] = useState(false);
  const [secLogoutMinutes, setSecLogoutMinutes] = useState(15);
  const [secLockoutSeconds, setSecLockoutSeconds] = useState(60);
  const [secMaxAttempts, setSecMaxAttempts] = useState(5);
  const [hasLoadedSecuritySettings, setHasLoadedSecuritySettings] = useState(false);
  const [secSuccessMsg, setSecSuccessMsg] = useState<string | null>(null);
  const [secErrorMsg, setSecErrorMsg] = useState<string | null>(null);

  // Two-Factor Authentication (TOTP / Google Authenticator) Modal state
  const [twoFactorModalAccount, setTwoFactorModalAccount] = useState<{
    type: 'admin' | 'user';
    id: string;
    username: string;
    enabled: boolean;
    secret: string;
    backupCodes: string[];
  } | null>(null);

  // Database Connection Health & Table Diagnostics Hooks
  const { status: dbStatus, isChecking: isCheckingDb, refresh: refreshDbStatus } = useDatabaseStatus(30000);
  const { diagnostics: tableDiagnostics, isChecking: isCheckingTables, runDiagnostics: refreshTableDiagnostics } = useSupabaseTableDiagnostics(true);
  const [showSqlSetupModal, setShowSqlSetupModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  const [isFixingDb, setIsFixingDb] = useState(false);
  const [autoFixMessage, setAutoFixMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAutoFixDatabase = async () => {
    setIsFixingDb(true);
    setAutoFixMessage(null);
    try {
      await refreshTableDiagnostics();
      const summary = await syncAllDataToSupabase({ userAccounts, adminSettings });
      setSyncDataSummary(summary);
      await refreshDbStatus();
      await refreshTableDiagnostics();

      if (summary.errors.length === 0) {
        setAutoFixMessage({
          type: 'success',
          text: summary.supabaseConfigured
            ? 'Database schema repair & dual-cloud sync completed successfully! Diagnostics refreshed.'
            : 'Firestore cloud health & collections verified! (Optional Supabase env vars not configured.)'
        });
      } else {
        setAutoFixMessage({
          type: 'error',
          text: `Schema sync completed with notices: ${summary.errors[0]}. Click "View SQL Fix Code" to review full SQL script.`
        });
      }
    } catch (err: any) {
      setAutoFixMessage({
        type: 'error',
        text: `Auto-repair error: ${err?.message || String(err)}. Click "View SQL Fix Code" to review SQL script.`
      });
    } finally {
      setIsFixingDb(false);
    }
  };

  const [syncDataSummary, setSyncDataSummary] = useState<SupabaseSyncSummary | null>(null);
  const [isSyncingAllData, setIsSyncingAllData] = useState(false);

  const [syncingTableState, setSyncingTableState] = useState<Record<string, 'to_supabase' | 'to_firestore' | null>>({});
  const [tableSyncResults, setTableSyncResults] = useState<Record<string, TableSyncResult>>({});
  const [bulkSyncDirection, setBulkSyncDirection] = useState<'to_supabase' | 'to_firestore' | null>(null);

  // Automated Test Report state
  const [testReport, setTestReport] = useState<FullTestReport | null>(null);
  const [isRunningAutoTests, setIsRunningAutoTests] = useState(false);
  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [testStatusFilter, setTestStatusFilter] = useState<'all' | 'passed' | 'warning' | 'failed'>('all');
  const [testCategoryFilter, setTestCategoryFilter] = useState<string>('all');
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [copiedErrors, setCopiedErrors] = useState(false);

  const handleRunAutoTests = async () => {
    setIsRunningAutoTests(true);
    try {
      const report = await runAutomatedWebsiteTests();
      setTestReport(report);
    } catch (err) {
      console.error('Failed to run automated website tests:', err);
    } finally {
      setIsRunningAutoTests(false);
    }
  };

  const handleDownloadTestReport = () => {
    if (!testReport) return;
    const lines = [
      `====================================================`,
      `OUR HOME WEBSITE AUTOMATED TEST REPORT`,
      `====================================================`,
      `Generated At   : ${testReport.timestamp}`,
      `Overall Status : ${testReport.overallStatus.toUpperCase()}`,
      `Execution Time : ${testReport.durationMs} ms`,
      `Total Tests    : ${testReport.totalTests}`,
      `Passed         : ${testReport.passedCount}`,
      `Warnings       : ${testReport.warningCount}`,
      `Failures       : ${testReport.failedCount}`,
      `====================================================\n`
    ];

    testReport.results.forEach((test, idx) => {
      lines.push(`[${idx + 1}] ${test.status.toUpperCase()}: ${test.name}`);
      lines.push(`    Category    : ${test.category}`);
      lines.push(`    Duration    : ${test.durationMs} ms`);
      lines.push(`    Message     : ${test.message}`);
      if (test.details) lines.push(`    Details     : ${test.details}`);
      if (test.remedy)  lines.push(`    Remedy      : ${test.remedy}`);
      lines.push(``);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OurHome_TestReport_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyErrors = () => {
    if (!testReport) return;
    const errors = testReport.results.filter(r => r.status === 'failed' || r.status === 'warning');
    if (errors.length === 0) return;

    const errorText = errors.map(e => `[${e.status.toUpperCase()}] ${e.name} (${e.category}): ${e.message} ${e.details ? '| ' + e.details : ''}`).join('\n');
    navigator.clipboard.writeText(errorText);
    setCopiedErrors(true);
    setTimeout(() => setCopiedErrors(false), 2500);
  };

  const handleSyncSingleTable = async (tableKey: SyncTableKey, direction: 'firestore_to_supabase' | 'supabase_to_firestore') => {
    setSyncingTableState(prev => ({ ...prev, [tableKey]: direction === 'firestore_to_supabase' ? 'to_supabase' : 'to_firestore' }));
    setMigrationError(null);
    try {
      const res = direction === 'firestore_to_supabase' 
        ? await syncSingleTableFirestoreToSupabase(tableKey)
        : await syncSingleTableSupabaseToFirestore(tableKey);
      
      setTableSyncResults(prev => ({ ...prev, [tableKey]: res }));
      if (res.errors.length > 0) {
        setMigrationError(`${tableKey} sync notice: ${res.errors[0]}`);
      }
      logActivity('Admin', `Sync ${tableKey}`, `Synced ${tableKey} (${direction === 'firestore_to_supabase' ? 'Firestore ➔ Supabase' : 'Supabase ➔ Firestore'}) - ${res.syncedCount} items.`);
      refreshDbStatus();
      refreshTableDiagnostics();
    } catch (err: any) {
      setMigrationError(`Error syncing ${tableKey}: ${err?.message || String(err)}`);
    } finally {
      setSyncingTableState(prev => ({ ...prev, [tableKey]: null }));
    }
  };

  const handleBulkSyncTables = async (direction: 'firestore_to_supabase' | 'supabase_to_firestore') => {
    setBulkSyncDirection(direction === 'firestore_to_supabase' ? 'to_supabase' : 'to_firestore');
    setIsSyncingAllData(true);
    setMigrationError(null);
    try {
      const { totalSynced, results, errors } = direction === 'firestore_to_supabase'
        ? await syncAllTablesFirestoreToSupabase()
        : await syncAllTablesSupabaseToFirestore();

      const resultMap: Record<string, TableSyncResult> = {};
      results.forEach(r => { resultMap[r.tableKey] = r; });
      setTableSyncResults(resultMap);

      if (errors.length > 0) {
        setMigrationError(`Bulk sync notices (${errors.length}): ${errors.slice(0, 3).join('; ')}`);
      }

      logActivity('Admin', `Bulk Sync (${direction})`, `Synced all tables (${direction === 'firestore_to_supabase' ? 'Firestore ➔ Supabase' : 'Supabase ➔ Firestore'}) - total ${totalSynced} items.`);
      refreshDbStatus();
      refreshTableDiagnostics();
    } catch (err: any) {
      setMigrationError(`Bulk sync failed: ${err?.message || String(err)}`);
    } finally {
      setIsSyncingAllData(false);
      setBulkSyncDirection(null);
    }
  };

  const handleSyncAllSupabaseData = async () => {
    setIsSyncingAllData(true);
    setMigrationError(null);
    try {
      const summary = await syncAllDataToSupabase({ userAccounts, adminSettings });
      setSyncDataSummary(summary);
      if (summary.errors.length > 0) {
        setMigrationError(`Database sync notices (${summary.errors.length}): ${summary.errors[0]}`);
      }
      await logActivity(
        'Admin',
        'Database Sync',
        summary.mode === 'firestore_and_supabase'
          ? `Synchronized ${summary.userAccountsSynced} users, ${summary.adminSettingsSynced} settings, ${summary.workoutPlansSynced} workouts across Firestore & Supabase.`
          : `Verified & synced ${summary.userAccountsSynced} users, ${summary.adminSettingsSynced} settings, ${summary.workoutPlansSynced} workouts in Firestore cloud.`
      );
      await refreshDbStatus();
      await refreshTableDiagnostics();
    } catch (err: any) {
      setMigrationError(err?.message || 'Failed to synchronize database.');
    } finally {
      setIsSyncingAllData(false);
    }
  };

  const handleRunMigration = async () => {
    setIsMigrating(true);
    setMigrationError(null);
    try {
      const res = await migrateAndDeduplicateFirestoreToSupabase();
      setMigrationResult(res);
      logActivity('Admin', 'System Maintenance', 'Ran Firestore to Supabase deduplication & purge migration routine.');
      refreshDbStatus();
    } catch (err: any) {
      setMigrationError(err?.message || 'Migration execution failed.');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleDownloadReport = () => {
    if (!migrationResult) return;
    
    const lines = [
      `===================================================`,
      `DATABASE MAINTENANCE & MIGRATION REPORT`,
      `===================================================`,
      `Generated At: ${migrationResult.timestamp}`,
      ``,
      `DATABASE HEALTH STATUS:`,
      `---------------------------------------------------`,
      `Firebase DB : ${dbStatus.firebase.online ? 'Connected' : 'Offline'} (${dbStatus.firebase.latencyMs}ms) - ${dbStatus.firebase.details}`,
      `Supabase DB : ${dbStatus.supabase.online ? 'Connected' : dbStatus.supabase.configured ? 'Unreachable' : 'Local Fallback Mode'} (${dbStatus.supabase.latencyMs}ms) - ${dbStatus.supabase.details}`,
      ``,
      `MIGRATION & DEDUPLICATION RESULTS:`,
      `---------------------------------------------------`,
      `Activity Logs Examined in Firestore : ${migrationResult.logsProcessed}`,
      `Activity Logs Migrated to Supabase    : ${migrationResult.logsMigrated}`,
      `Activity Logs Purged from Firestore   : ${migrationResult.logsPurgedFromFirestore}`,
      ``,
      `Admin Settings Examined in Firestore : ${migrationResult.settingsProcessed}`,
      `Admin Settings Migrated to Supabase   : ${migrationResult.settingsMigrated}`,
      `Admin Settings Purged from Firestore  : ${migrationResult.settingsPurgedFromFirestore}`,
      ``,
      `NOTICES / LOG DETAILS:`,
      `---------------------------------------------------`
    ];

    if (migrationResult.errors && migrationResult.errors.length > 0) {
      migrationResult.errors.forEach((err, idx) => {
        lines.push(`[Notice ${idx + 1}] ${err}`);
      });
    } else {
      lines.push(`All records successfully verified, deduplicated, and old Firestore copies purged.`);
    }

    lines.push(
      ``,
      `===================================================`,
      `End of Report`,
      `===================================================`
    );

    const reportContent = lines.join('\r\n');
    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanDate = migrationResult.timestamp.replace(/[/, :]/g, '_');
    link.download = `database_maintenance_report_${cleanDate}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // User password visibility states
  const [showAllUserPasswords, setShowAllUserPasswords] = useState(false);
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Record<string, boolean>>({});
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [showEditUserPassword, setShowEditUserPassword] = useState(false);

  // Sync state when admin credentials load
  useEffect(() => {
    if (adminSettings.length > 0) {
      const adminAccountsDoc = adminSettings.find(s => s.id === 'adminAccounts');
      const legacyCreds = adminSettings.find(s => s.id === 'credentials');

      if (adminAccountsDoc && adminAccountsDoc.adminAccounts && adminAccountsDoc.adminAccounts.length > 0) {
        const normalized = adminAccountsDoc.adminAccounts.map(a => ({
          ...a,
          role: 'Super Admin'
        }));
        setAdminAccountsList(normalized);
        setAdminUsername(adminAccountsDoc.adminAccounts[0].username);
        setHasLoadedAdminSettings(true);
      } else if (legacyCreds && legacyCreds.username) {
        const initialAdmin: AdminAccount = {
          id: 'admin_primary',
          username: legacyCreds.username,
          password: legacyCreds.password || '',
          role: 'Super Admin',
          createdAt: new Date().toISOString(),
          notes: 'Primary System Admin'
        };
        setAdminAccountsList([initialAdmin]);
        setAdminUsername(legacyCreds.username);
        setHasLoadedAdminSettings(true);
      } else {
        setAdminAccountsList([]);
        setHasLoadedAdminSettings(true);
      }
    }
  }, [adminSettings, hasLoadedAdminSettings]);

  // Sync security settings when loaded
  useEffect(() => {
    if (!hasLoadedSecuritySettings && adminSettings.length > 0) {
      const secDoc = adminSettings.find(s => s.id === 'securityConfig');
      if (secDoc) {
        setSecLogoutEnabled(secDoc.autoLogoutEnabled ?? false);
        setSecLogoutMinutes(secDoc.autoLogoutMinutes ?? 15);
        setSecLockoutSeconds(secDoc.loginLockoutSeconds ?? 60);
        setSecMaxAttempts(secDoc.loginMaxAttempts ?? 5);
        setHasLoadedSecuritySettings(true);
      }
    }
  }, [adminSettings, hasLoadedSecuritySettings]);

  // Run initial website auto-test suite on load
  useEffect(() => {
    let isMounted = true;
    const runInitialTests = async () => {
      setIsRunningAutoTests(true);
      try {
        const report = await runAutomatedWebsiteTests();
        if (isMounted) {
          setTestReport(report);
        }
      } catch (err) {
        console.error('Initial auto test failed:', err);
      } finally {
        if (isMounted) {
          setIsRunningAutoTests(false);
        }
      }
    };
    runInitialTests();
    return () => { isMounted = false; };
  }, []);

  // Logs state
  const [logs, setLogs] = useState<UserActivityLog[]>([]);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  
  // Subscribe to activity logs on mount
  useEffect(() => {
    const unsubscribe = subscribeToActivityLogs((data) => {
      setLogs(data);
    });
    return () => unsubscribe();
  }, []);

  // Favicon Helpers
  const fileToBase64 = (file: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleFaviconFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setFaviconErrorMsg('Please select a valid image file.');
      setTimeout(() => setFaviconErrorMsg(null), 3000);
      return;
    }

    setIsUploadingFavicon(true);
    setFaviconSuccessMsg(null);
    setFaviconErrorMsg(null);

    try {
      const options = {
        maxSizeMB: 0.05, // 50KB limit is perfect for a favicon
        maxWidthOrHeight: 128, // Max size 128x128 pixels (great for high-res favicons)
        useWebWorker: true,
        fileType: 'image/png',
        initialQuality: 0.8
      };
      
      const compressedBlob = await imageCompression(file, options);
      const base64String = await fileToBase64(compressedBlob);
      
      await saveAdminSettingDoc({
        id: 'websiteFavicon',
        favicon: base64String
      });

      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(currentAdmin, 'admin_favicon_updated', 'Uploaded and set a new website favicon');
      
      setFaviconSuccessMsg('Website favicon updated successfully!');
      setTimeout(() => setFaviconSuccessMsg(null), 3000);
    } catch (err) {
      console.error("Favicon compression/upload error:", err);
      setFaviconErrorMsg('Failed to upload and set website favicon.');
      setTimeout(() => setFaviconErrorMsg(null), 3000);
    } finally {
      setIsUploadingFavicon(false);
    }
  };

  const handleResetFavicon = async () => {
    setFaviconSuccessMsg(null);
    setFaviconErrorMsg(null);
    setIsUploadingFavicon(true);
    try {
      await saveAdminSettingDoc({
        id: 'websiteFavicon',
        favicon: ''
      });
      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(currentAdmin, 'admin_favicon_reset', 'Reset website favicon to default');
      setFaviconSuccessMsg('Website favicon reset to default successfully!');
      setTimeout(() => setFaviconSuccessMsg(null), 3000);
    } catch (err) {
      setFaviconErrorMsg('Failed to reset website favicon.');
      setTimeout(() => setFaviconErrorMsg(null), 3000);
    } finally {
      setIsUploadingFavicon(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserSuccessMsg(null);
    setUserErrorMsg(null);

    const uName = newUsername.trim().toLowerCase();
    const rawPass = newPassword.trim();

    if (!uName || !rawPass) {
      setUserErrorMsg('Both username and password are required.');
      return;
    }

    const configUser = ((import.meta as any).env?.VITE_APP_USERNAME || '').toLowerCase().trim();
    if (uName === configUser || uName === adminUsername.toLowerCase().trim()) {
      setUserErrorMsg(`"${newUsername}" is reserved for the Admin Panel.`);
      return;
    }

    // Check if user already exists
    if (userAccounts.some(u => u.username.toLowerCase() === uName)) {
      setUserErrorMsg(`User "${newUsername}" already exists.`);
      return;
    }

    setIsSyncing(true);
    try {
      const uPass = await hashPassword(rawPass);
      const cleanTg = newUserTelegram.trim()
        ? (newUserTelegram.trim().startsWith('@') ? newUserTelegram.trim().toLowerCase() : `@${newUserTelegram.trim().toLowerCase()}`)
        : '';

      const newUser: UserAccount = {
        id: `user_${Date.now()}`,
        username: newUsername.trim(),
        ...(newDisplayName.trim() ? { displayName: newDisplayName.trim() } : {}),
        password: uPass,
        gender: newUserGender,
        role: 'user',
        ...(cleanTg ? { telegramUsername: cleanTg } : {}),
      };
      await saveUserAccountDoc(newUser);

      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewUserGender('male');
      setNewUserTelegram('');
      setUserSuccessMsg(`User account "${newUser.username}" created successfully (Password Cryptographically Hashed)!`);
      
      setTimeout(() => setUserSuccessMsg(null), 4000);
    } catch (err: any) {
      setUserErrorMsg(`Failed to save user account: ${err?.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpdateUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserSuccessMsg(null);
    setUserErrorMsg(null);

    if (!editingUser) return;
    const rawPass = editingPassword.trim();

    if (!rawPass && !editingUser.password) {
      setUserErrorMsg('Password cannot be empty for an account with no existing password.');
      return;
    }

    setIsSyncing(true);
    try {
      const uPass = rawPass ? await hashPassword(rawPass) : editingUser.password;
      const cleanTg = editingUserTelegram.trim()
        ? (editingUserTelegram.trim().startsWith('@') ? editingUserTelegram.trim().toLowerCase() : `@${editingUserTelegram.trim().toLowerCase()}`)
        : '';
      const updated: UserAccount = {
        ...editingUser,
        displayName: editingDisplayName.trim() || editingUser.username,
        password: uPass,
        gender: editingUserGender,
        ...(cleanTg ? { telegramUsername: cleanTg } : { telegramUsername: '' }),
      };
      await saveUserAccountDoc(updated);

      setUserSuccessMsg(`User account "${editingUser.username}" updated successfully!`);
      setEditingUser(null);
      setEditingDisplayName('');
      setEditingPassword('');
      setEditingUserGender('male');
      setEditingUserTelegram('');
      
      setTimeout(() => setUserSuccessMsg(null), 4000);
    } catch (err: any) {
      setUserErrorMsg(`Failed to update user account: ${err?.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const [syncingUserId, setSyncingUserId] = useState<string | null>(null);

  const handleSyncUser = async (user: UserAccount) => {
    setUserSuccessMsg(null);
    setUserErrorMsg(null);
    setSyncingUserId(user.id);
    setIsSyncing(true);
    const targetDesc = isSupabaseConfigured ? 'Firestore and Supabase' : 'Firestore';
    try {
      await saveUserAccountDoc(user);
      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(currentAdmin, 'user_synced', `Synchronized account "${user.username}" to ${targetDesc}.`);
      setUserSuccessMsg(`User account "${user.username}" synchronized to ${targetDesc} successfully!`);
      setTimeout(() => setUserSuccessMsg(null), 4000);
    } catch (err: any) {
      setUserErrorMsg(`Failed to synchronize user account "${user.username}": ${err?.message || String(err)}`);
    } finally {
      setSyncingUserId(null);
      setIsSyncing(false);
    }
  };

  const handleSyncAllUsers = async () => {
    if (userAccounts.length === 0) {
      setUserErrorMsg('No user accounts available to sync.');
      return;
    }
    setUserSuccessMsg(null);
    setUserErrorMsg(null);
    setIsSyncing(true);
    const targetDesc = isSupabaseConfigured ? 'Firestore and Supabase' : 'Firestore';
    try {
      for (const user of userAccounts) {
        await saveUserAccountDoc(user);
      }
      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(currentAdmin, 'all_users_synced', `Synchronized all ${userAccounts.length} user accounts to ${targetDesc}.`);
      setUserSuccessMsg(`All ${userAccounts.length} user accounts synchronized to ${targetDesc} successfully!`);
      setTimeout(() => setUserSuccessMsg(null), 4000);
    } catch (err: any) {
      setUserErrorMsg(`Failed to synchronize all user accounts: ${err?.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteUser = async (user: UserAccount) => {
    setUserSuccessMsg(null);
    setUserErrorMsg(null);
    setIsSyncing(true);
    try {
      await deleteUserAccountDoc(user.id);
      setUserSuccessMsg(`User "${user.username}" deleted successfully.`);
      setUserToDelete(null);
      setTimeout(() => setUserSuccessMsg(null), 4000);
    } catch (err: any) {
      setUserErrorMsg(`Failed to delete user: ${err?.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveAdminAccountsList = async (updatedList: AdminAccount[], logMsg?: string) => {
    setIsSyncing(true);
    setAdminSuccessMsg(null);
    setAdminErrorMsg(null);
    try {
      // 1. Save adminAccounts document
      await saveAdminSettingDoc({
        id: 'adminAccounts',
        adminAccounts: updatedList
      });

      // 2. Save legacy credentials document for backwards compatibility
      if (updatedList.length > 0) {
        await saveAdminSettingDoc({
          id: 'credentials',
          username: updatedList[0].username,
          password: updatedList[0].password
        });
      }

      setAdminAccountsList(updatedList);
      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(currentAdmin, 'admin_credentials_updated', logMsg || `Updated admin credentials in ${isSupabaseConfigured ? 'Firestore & Supabase' : 'Firestore'}.`);
      setAdminSuccessMsg('Admin portal credentials synchronized to database successfully!');
      setTimeout(() => setAdminSuccessMsg(null), 4000);
    } catch (err: any) {
      setAdminErrorMsg(`Failed to save admin credentials: ${err?.message || String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminSuccessMsg(null);
    setAdminErrorMsg(null);

    const cleanUser = newAdminUser.trim();
    if (!cleanUser) {
      setAdminErrorMsg('Admin username cannot be empty.');
      return;
    }

    if (adminAccountsList.some(a => a.username.toLowerCase() === cleanUser.toLowerCase())) {
      setAdminErrorMsg(`Admin account "${cleanUser}" already exists.`);
      return;
    }

    const hashedAdminPass = newAdminPass.trim() ? await hashPassword(newAdminPass.trim()) : '';

    const newAcc: AdminAccount = {
      id: `admin_${Date.now()}`,
      username: cleanUser,
      password: hashedAdminPass,
      role: newAdminRole || 'Super Admin',
      createdAt: new Date().toISOString(),
      notes: newAdminNotes.trim()
    };

    const updated = [...adminAccountsList, newAcc];
    await handleSaveAdminAccountsList(updated, `Created new admin portal credential "${cleanUser}" (${newAcc.role}) [Hashed].`);

    setNewAdminUser('');
    setNewAdminPass('');
    setNewAdminRole('Super Admin');
    setNewAdminNotes('');
    setIsAddingAdmin(false);
  };

  const handleUpdateAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    setAdminSuccessMsg(null);
    setAdminErrorMsg(null);

    const cleanUser = editAdminUser.trim();
    if (!cleanUser) {
      setAdminErrorMsg('Admin username cannot be empty.');
      return;
    }

    const updated = await Promise.all(adminAccountsList.map(async a => {
      if (a.id === editingAdmin.id) {
        const pass = editAdminPass.trim() !== '' ? await hashPassword(editAdminPass.trim()) : a.password;
        return {
          ...a,
          username: cleanUser,
          password: pass,
          role: editAdminRole || 'Super Admin',
          notes: editAdminNotes.trim()
        };
      }
      return a;
    }));

    await handleSaveAdminAccountsList(updated, `Updated admin portal credential "${cleanUser}".`);
    setEditingAdmin(null);
  };

  const handleDeleteAdminAccount = async (account: AdminAccount) => {
    if (adminAccountsList.length <= 1) {
      setAdminErrorMsg('Cannot delete the last admin account. At least one admin credential is required.');
      setAdminToDelete(null);
      return;
    }

    const updated = adminAccountsList.filter(a => a.id !== account.id);
    await handleSaveAdminAccountsList(updated, `Deleted admin credential "${account.username}".`);
    setAdminToDelete(null);
  };

  const handleSyncAdminAccount = async (account: AdminAccount) => {
    setSyncingAdminId(account.id);
    try {
      await handleSaveAdminAccountsList(adminAccountsList, `Synchronized admin credential "${account.username}" across Firestore & Supabase.`);
    } finally {
      setSyncingAdminId(null);
    }
  };

  const handleSyncAllAdmins = async () => {
    await handleSaveAdminAccountsList(adminAccountsList, `Synchronized all ${adminAccountsList.length} admin accounts across Firestore & Supabase.`);
  };

  const handleOpen2FAModalForAdmin = (acc: AdminAccount) => {
    setTwoFactorModalAccount({
      type: 'admin',
      id: acc.id,
      username: acc.username,
      enabled: !!acc.twoFactorEnabled,
      secret: acc.twoFactorSecret || '',
      backupCodes: acc.twoFactorBackupCodes || []
    });
  };

  const handleOpen2FAModalForUser = (user: UserAccount) => {
    setTwoFactorModalAccount({
      type: 'user',
      id: user.id,
      username: user.username,
      enabled: !!user.twoFactorEnabled,
      secret: user.twoFactorSecret || '',
      backupCodes: user.twoFactorBackupCodes || []
    });
  };

  const handleSave2FA = async (newSecret: string, newBackupCodes: string[]) => {
    if (!twoFactorModalAccount) return;
    const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';

    if (twoFactorModalAccount.type === 'admin') {
      const updated = adminAccountsList.map(a => {
        if (a.id === twoFactorModalAccount.id || a.username.toLowerCase() === twoFactorModalAccount.username.toLowerCase()) {
          return {
            ...a,
            twoFactorEnabled: true,
            twoFactorSecret: newSecret,
            twoFactorBackupCodes: newBackupCodes,
            twoFactorCreatedAt: new Date().toISOString()
          };
        }
        return a;
      });
      await handleSaveAdminAccountsList(updated, `Activated Two-Factor Authentication (TOTP RFC 6238) for admin "${twoFactorModalAccount.username}".`);
      setTwoFactorModalAccount(prev => prev ? { ...prev, enabled: true, secret: newSecret, backupCodes: newBackupCodes } : null);
    } else {
      const targetUser = userAccounts.find(u => u.id === twoFactorModalAccount.id || u.username.toLowerCase() === twoFactorModalAccount.username.toLowerCase());
      if (targetUser) {
        const updatedUser: UserAccount = {
          ...targetUser,
          twoFactorEnabled: true,
          twoFactorSecret: newSecret,
          twoFactorBackupCodes: newBackupCodes,
          twoFactorCreatedAt: new Date().toISOString()
        };
        await saveUserAccountDoc(updatedUser);
        await logActivity(currentAdmin, 'security_2fa_enabled', `Activated Two-Factor Authentication (TOTP RFC 6238) for user "${targetUser.username}".`);
        setTwoFactorModalAccount(prev => prev ? { ...prev, enabled: true, secret: newSecret, backupCodes: newBackupCodes } : null);
      }
    }
  };

  const handleDisable2FA = async () => {
    if (!twoFactorModalAccount) return;
    const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';

    if (twoFactorModalAccount.type === 'admin') {
      const updated = adminAccountsList.map(a => {
        if (a.id === twoFactorModalAccount.id || a.username.toLowerCase() === twoFactorModalAccount.username.toLowerCase()) {
          return {
            ...a,
            twoFactorEnabled: false,
            twoFactorSecret: '',
            twoFactorBackupCodes: [],
            twoFactorCreatedAt: ''
          };
        }
        return a;
      });
      await handleSaveAdminAccountsList(updated, `Disabled Two-Factor Authentication for admin "${twoFactorModalAccount.username}".`);
    } else {
      const targetUser = userAccounts.find(u => u.id === twoFactorModalAccount.id || u.username.toLowerCase() === twoFactorModalAccount.username.toLowerCase());
      if (targetUser) {
        const updatedUser: UserAccount = {
          ...targetUser,
          twoFactorEnabled: false,
          twoFactorSecret: '',
          twoFactorBackupCodes: [],
          twoFactorCreatedAt: ''
        };
        await saveUserAccountDoc(updatedUser);
        await logActivity(currentAdmin, 'security_2fa_disabled', `Disabled Two-Factor Authentication for user "${targetUser.username}".`);
      }
    }
    setTwoFactorModalAccount(null);
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecSuccessMsg(null);
    setSecErrorMsg(null);
    setIsSyncing(true);

    try {
      await saveAdminSettingDoc({
        id: 'securityConfig',
        autoLogoutEnabled: secLogoutEnabled,
        autoLogoutMinutes: Number(secLogoutMinutes),
        loginLockoutSeconds: Number(secLockoutSeconds),
        loginMaxAttempts: Number(secMaxAttempts)
      });

      const currentAdmin = localStorage.getItem('love_app_username') || 'Admin';
      await logActivity(
        currentAdmin,
        'admin_security_updated',
        `Configured security: auto-logout ${secLogoutEnabled ? 'Enabled' : 'Disabled'} (${secLogoutMinutes}m), login cooldown ${secLockoutSeconds}s after ${secMaxAttempts} attempts`
      );

      setSecSuccessMsg('Security settings updated successfully!');
      setTimeout(() => setSecSuccessMsg(null), 3000);
    } catch (err) {
      setSecErrorMsg('Failed to save security settings.');
      setTimeout(() => setSecErrorMsg(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSimulateTestAlert = async () => {
    try {
      const sampleIps = ['197.38.45.12', '156.204.88.3', '41.233.19.45', '102.189.72.10'];
      const randomIp = sampleIps[Math.floor(Math.random() * sampleIps.length)];
      const randomUser = ['Intruder_Probe', 'Unknown_Visitor', 'admin'][Math.floor(Math.random() * 3)];
      await logActivity(
        randomUser,
        'security_failed_login',
        `Failed login password attempt (4/5). IP: ${randomIp} | Late-night / Unusual Hour (03:42)`
      );
      setAdminSuccessMsg(`Simulated test security event recorded for "${randomUser}" from IP ${randomIp}!`);
      setTimeout(() => setAdminSuccessMsg(null), 3500);
    } catch {
      setAdminErrorMsg('Failed to log test security alert.');
      setTimeout(() => setAdminErrorMsg(null), 3000);
    }
  };

  return (
    <div id="admin_portal_container" className="min-h-screen bg-neutral-950 text-neutral-100 font-sans flex flex-col relative overflow-x-clip">
      
      {/* ATMOSPHERIC BACKGROUND BLOBS */}
      <div className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[150px] pointer-events-none z-0"></div>
      <div className="absolute top-[-200px] right-[-200px] w-[600px] h-[600px] bg-rose-600/10 rounded-full blur-[150px] pointer-events-none z-0"></div>

      {/* HEADER (PERMANENTLY FIXED ON SCROLL) */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-neutral-950/95 backdrop-blur-2xl px-4 py-3 sm:px-6 shadow-2xl">
        <div className="max-w-[1600px] mx-auto flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Iron House
                <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-mono tracking-wider bg-red-500/20 text-red-300 border border-red-500/25">
                  Admin
                </span>
              </h1>
              <p className="text-[10px] text-neutral-400 font-mono tracking-widest uppercase mt-0.5">
                Gym Admin Console
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* INTEGRATED SECTION INDEX DROPDOWN */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSectionMenuOpen(!isSectionMenuOpen)}
                className="px-3 sm:px-3.5 py-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white transition-all duration-200 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Compass className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="hidden md:inline font-mono text-[10px] uppercase tracking-wider text-indigo-300">Section Index:</span>
                <span className="max-w-[120px] sm:max-w-[160px] truncate text-white">
                  {SECTION_LIST.find(s => s.id === activeSectionId)?.label || 'Workout Plans'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 ${isSectionMenuOpen ? 'rotate-180 text-white' : ''}`} />
              </button>

              {/* DROPDOWN MENU POPOVER */}
              <AnimatePresence>
                {isSectionMenuOpen && (
                  <>
                    {/* BACKDROP TO CLOSE */}
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsSectionMenuOpen(false)} 
                    />
                    
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      className="absolute right-0 top-full mt-2 w-72 bg-neutral-900/95 border border-white/15 rounded-2xl p-3 shadow-2xl backdrop-blur-2xl ring-1 ring-white/10 space-y-1 z-50 max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10"
                    >
                      <div className="px-2 py-1.5 mb-1 border-b border-white/10 flex items-center justify-between">
                        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">Jump to Section</span>
                        <span className="text-[9px] font-mono text-indigo-400 font-bold">{SECTION_LIST.length} Sections</span>
                      </div>
                      
                      {SECTION_LIST.map((sec, idx) => {
                        const SecIcon = sec.icon;
                        const isActive = activeSectionId === sec.id;
                        return (
                          <button
                            key={`admin-sec-item-${sec.id}-${idx}`}
                            type="button"
                            onClick={() => {
                              setIsSectionMenuOpen(false);
                              const el = document.getElementById(sec.id);
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                setActiveSectionId(sec.id);
                              }
                            }}
                            className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all text-left cursor-pointer group ${
                              isActive
                                ? 'bg-gradient-to-r from-indigo-600/30 via-purple-600/20 to-indigo-600/10 border border-indigo-500/50 text-white font-semibold shadow-lg shadow-indigo-500/10'
                                : 'text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`p-1 rounded-lg border transition-all shrink-0 ${
                                isActive
                                  ? 'bg-indigo-500 text-white border-indigo-400'
                                  : 'bg-neutral-950 border-white/10 text-neutral-400 group-hover:text-indigo-300'
                              }`}>
                                <SecIcon className="w-3.5 h-3.5" />
                              </div>
                              <span className="truncate text-[11px]">{sec.label}</span>
                            </div>
                            {'count' in sec && sec.count !== undefined && (
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md border shrink-0 ${
                                isActive ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/30' : 'bg-neutral-950 text-neutral-500 border-white/5'
                              }`}>
                                {sec.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={handleSyncAllSupabaseData}
              disabled={isSyncingAllData || isSyncing}
              className="px-3 py-2 rounded-xl border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 hover:text-teal-100 transition-all duration-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
              title="Sync All Data & Sections to Database"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAllData || isSyncing ? 'animate-spin text-teal-300' : 'text-teal-400'}`} />
              <span className="hidden sm:inline">
                {isSyncingAllData ? 'Syncing All...' : 'Sync All Data'}
              </span>
            </button>

            <button
              onClick={() => setShowSqlSetupModal(true)}
              className="px-3 py-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 hover:text-white transition-all duration-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="View full Supabase SQL Schema Setup Script"
            >
              <Code className="w-3.5 h-3.5 text-indigo-300" />
              <span>Fix DB / SQL Script</span>
            </button>
            <button
              onClick={onLogout}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 transition-all cursor-pointer text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 border border-rose-900/10 shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Lock Panel</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="relative z-10 flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-20 pb-6 flex flex-col gap-6">

        {/* GLOBAL SYNC NOTIFICATION TOAST */}
        <AnimatePresence>
          {syncDataSummary && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full p-3.5 bg-gradient-to-r from-teal-950/90 via-emerald-950/90 to-neutral-950/90 border border-teal-500/40 backdrop-blur-md rounded-2xl text-xs text-teal-200 shadow-2xl flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-teal-300 font-bold">
                  <CheckCircle className="w-4 h-4 text-teal-400 shrink-0" />
                  <span>
                    {syncDataSummary.mode === 'firestore_and_supabase'
                      ? 'All Collections Synchronized (Firestore + Supabase)'
                      : 'All Collections Synchronized (Firestore Cloud Active)'}
                  </span>
                </div>
                <button
                  onClick={() => setSyncDataSummary(null)}
                  className="p-1 hover:bg-teal-500/20 rounded-md transition-all cursor-pointer text-neutral-400 hover:text-white shrink-0"
                  title="Close notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div className="bg-black/40 p-2 rounded-xl border border-teal-500/20 flex flex-col items-center">
                  <span className="text-neutral-400">Users</span>
                  <strong className="text-teal-300 text-xs mt-0.5">{syncDataSummary?.userAccountsSynced ?? 0}</strong>
                </div>
                <div className="bg-black/40 p-2 rounded-xl border border-teal-500/20 flex flex-col items-center">
                  <span className="text-neutral-400">Settings</span>
                  <strong className="text-teal-300 text-xs mt-0.5">{syncDataSummary?.adminSettingsSynced ?? 0}</strong>
                </div>
                <div className="bg-black/40 p-2 rounded-xl border border-teal-500/20 flex flex-col items-center">
                  <span className="text-neutral-400">Workouts</span>
                  <strong className="text-teal-300 text-xs mt-0.5">{syncDataSummary?.workoutPlansSynced ?? 0}</strong>
                </div>
                <div className="bg-black/40 p-2 rounded-xl border border-teal-500/20 flex flex-col items-center">
                  <span className="text-neutral-400">Logs</span>
                  <strong className="text-teal-300 text-xs mt-0.5">{syncDataSummary?.activityLogsSynced ?? 0}</strong>
                </div>
              </div>

              {syncDataSummary?.errors && syncDataSummary.errors.length > 0 && (
                <div className="mt-1 pt-1.5 border-t border-teal-500/20 text-[10px] text-rose-300 space-y-0.5 max-h-20 overflow-y-auto">
                  <span className="font-semibold text-rose-400">Sync Notices:</span>
                  {syncDataSummary.errors.map((err, idx) => (
                    <p key={`sync-summary-err-${idx}`} className="truncate">• {err}</p>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* WORKOUT PLANS & SHEET ASSIGNMENT (GYM) */}
        <div id="workout_plans_section" className="w-full bg-neutral-900/60 border border-red-500/20 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-red-500/35 scroll-mt-24">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-red-500/15 border border-red-500/25 rounded-2xl text-red-400 shadow-inner">
              <Dumbbell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-serif font-bold text-white tracking-wide">Workout Plans & Sheet Assignment</h2>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Upload training sheets and assign them to specific gym members</p>
            </div>
          </div>
          <AdminWorkoutManager userAccounts={userAccounts} currentAdmin={adminUsername} />
        </div>

        {/* USER MANAGEMENT CARD */}
        <div id="users_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/25 rounded-2xl text-indigo-400 shadow-inner">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-serif font-bold text-white tracking-wide">Website User Accounts</h2>
                <p className="text-[11px] text-neutral-400 font-mono mt-0.5">User accounts, passwords & access rules</p>
              </div>
            </div>

            {/* Error & Success Feedback */}
            <AnimatePresence>
              {userSuccessMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{userSuccessMsg}</span>
                </motion.div>
              )}
              {userErrorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{userErrorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Create / Edit Form */}
            <div className="mb-8 p-5 bg-neutral-950/40 border border-white/5 rounded-2xl">
              {editingUser ? (
                <form onSubmit={handleUpdateUserPassword} className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-semibold text-indigo-300 uppercase tracking-widest font-mono">
                      Edit Account Details for: <span className="text-white capitalize">{editingUser.username}</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(null);
                        setEditingDisplayName('');
                        setEditingPassword('');
                        setEditingUserTelegram('');
                        setUserErrorMsg(null);
                      }}
                      className="text-xs text-neutral-400 hover:text-white transition-all"
                    >
                      Cancel Edit
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Display Name</label>
                      <input
                        type="text"
                        value={editingDisplayName}
                        onChange={(e) => setEditingDisplayName(e.target.value)}
                        placeholder="Full name"
                        className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">New Password (Optional)</label>
                      <div className="relative">
                        <input
                          type={showEditUserPassword ? "text" : "password"}
                          value={editingPassword}
                          onChange={(e) => setEditingPassword(e.target.value)}
                          placeholder="Leave blank to keep current"
                          className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-indigo-500/60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowEditUserPassword(!showEditUserPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors p-0.5"
                          title={showEditUserPassword ? "Hide password" : "Show password"}
                        >
                          {showEditUserPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Gender</label>
                      <select
                        value={editingUserGender}
                        onChange={(e) => setEditingUserGender(e.target.value)}
                        className="w-full bg-neutral-950/80 border border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="male">Male 👨</option>
                        <option value="female">Female 👩</option>
                        <option value="other">Other 🧑</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Telegram @Handle</label>
                      <input
                        type="text"
                        value={editingUserTelegram}
                        onChange={(e) => setEditingUserTelegram(e.target.value)}
                        placeholder="@username"
                        className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-sky-300 font-mono focus:outline-none focus:border-indigo-500/60"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSyncing}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 px-5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 h-10"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Save Account Changes
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <h3 className="text-xs font-semibold text-indigo-300 uppercase tracking-widest font-mono flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5" />
                    Create New Website User
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Username</label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="e.g. alex"
                        className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Display Name</label>
                      <input
                        type="text"
                        value={newDisplayName}
                        onChange={(e) => setNewDisplayName(e.target.value)}
                        placeholder="e.g. Alex Carter"
                        className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Secret Password</label>
                      <div className="relative">
                        <input
                          type={showNewUserPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Secret code"
                          className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-indigo-500/60"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors p-0.5"
                          title={showNewUserPassword ? "Hide password" : "Show password"}
                        >
                          {showNewUserPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Gender</label>
                      <select
                        value={newUserGender}
                        onChange={(e) => setNewUserGender(e.target.value)}
                        className="w-full bg-neutral-950/80 border border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="male">Male 👨</option>
                        <option value="female">Female 👩</option>
                        <option value="other">Other 🧑</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Telegram @Handle</label>
                      <input
                        type="text"
                        value={newUserTelegram}
                        onChange={(e) => setNewUserTelegram(e.target.value)}
                        placeholder="@username (optional)"
                        className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-sky-300 font-mono focus:outline-none focus:border-indigo-500/60"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSyncing}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 px-5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 h-10"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Create Account
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* List of Accounts */}
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-widest font-mono">
                  Active User Accounts
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSyncAllUsers}
                    disabled={isSyncing}
                    className="text-[11px] text-sky-400 hover:text-sky-300 font-mono flex items-center gap-1.5 bg-sky-500/10 px-2.5 py-1 rounded-lg border border-sky-500/20 transition-all cursor-pointer disabled:opacity-50"
                    title="Sync and push all user accounts to Firestore & Supabase"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>Sync All Users</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showAllUserPasswords;
                      setShowAllUserPasswords(next);
                      if (!next) {
                        setVisiblePasswordIds({});
                      }
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-mono flex items-center gap-1.5 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition-all cursor-pointer"
                  >
                    {showAllUserPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showAllUserPasswords ? 'Hide All Passwords' : 'Show All Passwords'}</span>
                  </button>
                </div>
              </div>

              {userAccounts.length === 0 ? (
                <div className="text-center py-6 text-neutral-500 text-xs font-mono">
                  Loading user accounts...
                </div>
              ) : (
                <div className="divide-y divide-white/5 border border-white/10 rounded-2xl overflow-hidden bg-neutral-950/20">
                  {(() => {
                    const seen = new Set<string>();
                    const uniqueUsers = userAccounts.filter(u => {
                      const key = (u.id || u.username || '').toLowerCase().trim();
                      if (!key || seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    });
                    return uniqueUsers.map((user, uIdx) => {
                    const isPasswordVisible = showAllUserPasswords || !!visiblePasswordIds[user.id];

                    return (
                      <div key={`user-row-${user.id || user.username}-${uIdx}`} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/5 transition-all">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-mono text-xs uppercase font-semibold flex-shrink-0 mt-0.5">
                            {user.username.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-white">
                                {user.displayName?.trim() ? user.displayName.trim() : user.username}
                              </p>
                              {user.displayName?.trim() && user.displayName.trim().toLowerCase() !== user.username.toLowerCase() && (
                                <span className="text-[10px] font-mono text-neutral-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">
                                  @{user.username}
                                </span>
                              )}
                              {user.gender && (
                                <span className="text-[10px] font-mono text-purple-300 bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-md capitalize">
                                  {user.gender === 'male' ? '👨 Male' : user.gender === 'female' ? '👩 Female' : `🧑 ${user.gender}`}
                                </span>
                              )}
                              {user.telegramUsername && (
                                <span className="text-[10px] font-mono text-sky-300 bg-sky-500/10 border border-sky-500/25 px-2 py-0.5 rounded-md">
                                  {user.telegramUsername}{user.telegramChatId ? ' ✓' : ''}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-neutral-500 font-mono flex items-center gap-1">
                                <span>Password:</span>
                                <span className="text-indigo-300 font-sans tracking-wide">
                                  {isPasswordVisible ? (user.password?.startsWith('sha256_v1:') ? '🔒 [SHA-256 Hashed]' : (user.password || '••••••••')) : '••••••••'}
                                </span>
                              </p>
                              <button
                                type="button"
                                onClick={() => setVisiblePasswordIds(prev => ({
                                  ...prev,
                                  [user.id]: !isPasswordVisible
                                }))}
                                className="p-1 text-neutral-500 hover:text-indigo-300 hover:bg-white/5 rounded transition-all cursor-pointer"
                                title={isPasswordVisible ? "Hide password" : "Show password"}
                              >
                                {isPasswordVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            {/* Security & 2FA Badge */}
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              {user.twoFactorEnabled ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpen2FAModalForUser(user)}
                                  className="inline-flex items-center gap-1 text-[10px] font-mono bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-full hover:bg-emerald-500/25 transition-colors cursor-pointer"
                                  title="2FA Protected - Click to manage"
                                >
                                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                  <span>2FA Active</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpen2FAModalForUser(user)}
                                  className="inline-flex items-center gap-1 text-[10px] font-mono bg-neutral-800/80 border border-neutral-700/50 text-neutral-400 hover:text-white px-2 py-0.5 rounded-full hover:bg-white/5 transition-colors cursor-pointer"
                                  title="Setup 2FA for this user"
                                >
                                  <KeyRound className="w-2.5 h-2.5 text-neutral-500" />
                                  <span>2FA Off</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => handleOpen2FAModalForUser(user)}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              user.twoFactorEnabled 
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' 
                                : 'border-white/10 text-neutral-400 hover:text-white hover:bg-white/5'
                            }`}
                            title={user.twoFactorEnabled ? "2FA Protected - Click to manage" : "Setup 2FA for this user"}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleSyncUser(user)}
                            disabled={isSyncing || syncingUserId === user.id}
                            className="p-1.5 rounded-lg border border-sky-500/20 hover:bg-sky-500/10 text-sky-400 hover:text-sky-300 transition-all cursor-pointer"
                            title={`Sync "${user.username}" to Firestore & Supabase`}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingUserId === user.id ? 'animate-spin text-sky-300' : ''}`} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingUser(user);
                              setEditingDisplayName(user.displayName || user.username || '');
                              setEditingPassword('');
                              setEditingUserGender(user.gender || 'male');
                              setEditingUserTelegram(user.telegramUsername || '');
                            }}
                            className="p-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-neutral-400 hover:text-white transition-all cursor-pointer"
                            title="Edit Account Details"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setUserToDelete(user)}
                            className="p-1.5 rounded-lg border border-rose-900/10 hover:bg-rose-950/20 text-neutral-500 hover:text-rose-400 transition-all cursor-pointer"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
                </div>
              )}
            </div>

          </div>

          {/* USER ACTIVITY LOGS PANEL */}
          <div id="activity_logs_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/25 rounded-2xl text-indigo-400 shadow-inner">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-serif font-bold text-white tracking-wide">Live Website Activity Logs</h2>
                  <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Real-time session auditing & tracking</p>
                </div>
              </div>

              {/* Search input */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Filter logs by user or action..."
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  className="w-full bg-neutral-950/80 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500/60"
                />
              </div>
            </div>

            {/* Logs Table / List */}
            <div className="border border-white/10 rounded-2xl overflow-hidden bg-neutral-950/20">
              <div className="max-h-[450px] overflow-y-auto no-scrollbar divide-y divide-white/5">
                {(() => {
                  const filteredLogs = logs.filter(l => {
                    const query = logSearchQuery.toLowerCase().trim();
                    if (!query) return true;
                    return (
                      l.username.toLowerCase().includes(query) ||
                      l.action.toLowerCase().includes(query) ||
                      l.details.toLowerCase().includes(query)
                    );
                  });

                  if (filteredLogs.length === 0) {
                    return (
                      <div className="p-12 text-center text-xs text-neutral-500 font-mono">
                        {logs.length === 0 ? 'No activity logs found. Try performing actions on the website!' : 'No matching logs found.'}
                      </div>
                    );
                  }

                  return filteredLogs.map((log, index) => {
                    const formattedDate = new Date(log.timestamp).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    });

                    return (
                      <div key={`log-${log.id || 'log'}-${index}`} className="p-3 sm:p-4 hover:bg-white/5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 p-1.5 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0">
                            {getLogIcon(log.action)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-white capitalize">{log.username}</span>
                              <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 font-mono text-[9px] uppercase tracking-wider border border-indigo-900/30">
                                {log.action.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <p className="text-neutral-400 mt-1 leading-relaxed break-all font-sans">{log.details}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 text-[10px] text-neutral-500 font-mono shrink-0">
                          <Clock className="w-3 h-3 text-neutral-600" />
                          <span>{formattedDate}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            
            <div className="mt-4 text-[10px] text-neutral-500 font-mono flex items-center justify-between">
              <span>Showing {logs.length} total logged events</span>
              <span>Central Audit System</span>
            </div>
          </div>

          {/* SECURITY LOGS & THREAT INTELLIGENCE DASHBOARD */}
          <div id="security_threats_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-5 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24">
            <SecurityLogsDashboard
              activityLogs={logs}
              defaultCollapsed={true}
              onRefreshLogs={() => {
                getFirestoreActivityLogs().then(setLogs).catch(() => {});
              }}
              onSimulateTestAlert={handleSimulateTestAlert}
            />
          </div>


          {/* SECURITY SETTINGS & WEBSITE FAVICON (SIDE-BY-SIDE GRID) */}
          <div id="security_favicon_section" className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full scroll-mt-24">
            
            {/* SECURITY SETTINGS CARD */}
            <div className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/25 rounded-2xl text-indigo-400 shadow-inner">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-serif font-bold text-white tracking-wide">Security Settings</h2>
                    <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Session timeout & access controls</p>
                  </div>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed mb-5">
                  Configure auto-logout timers to log users (including admin) out automatically after a specific period of inactivity for enhanced privacy.
                </p>

                <form onSubmit={handleSaveSecuritySettings} className="space-y-4">
                  {/* Toggle Enable */}
                  <div className="flex items-center justify-between p-4 bg-neutral-950/60 rounded-2xl border border-white/10 hover:border-white/15 transition-all">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-white">Auto-Logout on Inactivity</span>
                      <span className="text-[10px] text-neutral-500 font-mono">Enable automatic session termination</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={secLogoutEnabled}
                        onChange={(e) => setSecLogoutEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-neutral-800 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-500/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-neutral-400 peer-checked:after:bg-indigo-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-950/60 border border-white/10 peer-checked:border-indigo-500/30"></div>
                    </label>
                  </div>

                  {/* Inactivity Minutes input */}
                  {secLogoutEnabled && (
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold text-neutral-400 tracking-wide uppercase block font-mono">
                        Screen Inactivity Waiting Time (Minutes)
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                          <Clock className="w-4 h-4" />
                        </div>
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          value={secLogoutMinutes}
                          onChange={(e) => setSecLogoutMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                          placeholder="e.g. 15"
                          className="w-full bg-neutral-950/80 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/60 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <p className="text-[10px] text-neutral-500 font-mono">
                        Screen will automatically lock after {secLogoutMinutes} minute{secLogoutMinutes === 1 ? '' : 's'} of inactivity.
                      </p>
                    </div>
                  )}

                  {/* Anti-Brute-Force Login Waiting Time & Lockout Controls */}
                  <div className="pt-2 border-t border-white/5 space-y-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-white">Login Cooldown & Anti-Brute-Force Waiting Time</span>
                      <span className="text-[10px] text-neutral-500 font-mono">Control lockout duration after incorrect passwords</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-neutral-400 tracking-wide uppercase block font-mono">
                          Max Failed Attempts
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={secMaxAttempts}
                          onChange={(e) => setSecMaxAttempts(Math.max(1, parseInt(e.target.value) || 1))}
                          placeholder="5"
                          className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60 transition-all font-mono"
                        />
                        <p className="text-[10px] text-neutral-500 font-mono">Lockout triggers after {secMaxAttempts} bad passwords.</p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-neutral-400 tracking-wide uppercase block font-mono">
                          Lockout Waiting Time (Seconds)
                        </label>
                        <input
                          type="number"
                          min="5"
                          max="3600"
                          value={secLockoutSeconds}
                          onChange={(e) => setSecLockoutSeconds(Math.max(5, parseInt(e.target.value) || 5))}
                          placeholder="60"
                          className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60 transition-all font-mono"
                        />
                        <p className="text-[10px] text-neutral-500 font-mono">Screen waiting cooldown: {secLockoutSeconds}s.</p>
                      </div>
                    </div>
                  </div>

                  {/* Two-Factor Authentication (TOTP / Google Authenticator) Section */}
                  <div className="pt-3 border-t border-white/5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-500/15 border border-indigo-500/25 rounded-lg text-indigo-400">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-white block">Google Authenticator (2FA / TOTP)</span>
                          <span className="text-[10px] text-neutral-400 font-mono">RFC 6238 Two-Factor Protection</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const myAdmin = adminAccountsList.find(a => a.username.toLowerCase() === adminUsername.toLowerCase()) || adminAccountsList[0];
                          if (myAdmin) {
                            handleOpen2FAModalForAdmin(myAdmin);
                          }
                        }}
                        className="px-2.5 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-indigo-300" />
                        <span>Configure 2FA</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 font-mono leading-relaxed">
                      Generate QR codes, secret backup keys & single-use recovery codes to safeguard admin accounts from unauthorized logins.
                    </p>
                  </div>

                  {/* Security feedback messages */}
                  {secSuccessMsg && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 text-center font-medium">
                      {secSuccessMsg}
                    </div>
                  )}
                  {secErrorMsg && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 text-center font-medium">
                      {secErrorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="w-full bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-xs py-3 px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-indigo-500/15 active:scale-[0.99] disabled:opacity-50 mt-2"
                  >
                    {isSyncing ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Save Security Settings</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* WEBSITE FAVICON CONTROLS CARD */}
            <div className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2.5 bg-rose-500/15 border border-rose-500/25 rounded-2xl text-rose-400 shadow-inner">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-serif font-bold text-white tracking-wide">Website Favicon</h2>
                    <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Browser tab icon customization</p>
                  </div>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed mb-6">
                  Upload an image to customize the tab icon shown in visitors' browsers. We automatically compress it for optimal loading speed.
                </p>

                <AnimatePresence>
                  {faviconSuccessMsg && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>{faviconSuccessMsg}</span>
                    </motion.div>
                  )}
                  {faviconErrorMsg && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <span>{faviconErrorMsg}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Current Favicon mock browser tab preview */}
                {(() => {
                  const faviconDoc = adminSettings.find(s => s.id === 'websiteFavicon');
                  const hasCustomFavicon = !!faviconDoc?.favicon;
                  return (
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-neutral-950/40 border border-white/5 space-y-3">
                        <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">Browser Preview</span>
                        <div className="bg-neutral-900 border border-white/10 rounded-t-xl px-3 py-2 flex items-center gap-2">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500/60"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60"></span>
                          </div>
                          <div className="flex-1 max-w-[150px] bg-neutral-950 px-2.5 py-1 rounded-md border border-white/5 flex items-center gap-2 text-[10px] text-neutral-300 truncate">
                            {hasCustomFavicon ? (
                              <img 
                                src={faviconDoc.favicon} 
                                alt="Favicon" 
                                className="w-3.5 h-3.5 rounded object-contain"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                            )}
                            <span className="truncate font-sans font-medium">Iron House 🏋️</span>
                          </div>
                        </div>
                      </div>

                      {/* Drag and Drop Zone */}
                      <label 
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragOverFavicon(true);
                        }}
                        onDragLeave={() => setIsDragOverFavicon(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragOverFavicon(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) handleFaviconFile(file);
                        }}
                        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 transition-all cursor-pointer text-center group ${
                          isDragOverFavicon 
                            ? 'border-indigo-500 bg-indigo-500/5' 
                            : 'border-white/10 hover:border-white/20 bg-neutral-950/20 hover:bg-neutral-950/40'
                        }`}
                      >
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFaviconFile(file);
                          }} 
                          className="hidden" 
                          disabled={isUploadingFavicon}
                        />
                        
                        <div className="p-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 group-hover:scale-105 transition-transform mb-3">
                          {isUploadingFavicon ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <Upload className="w-5 h-5" />
                          )}
                        </div>

                        <p className="text-xs font-semibold text-white">
                          {isUploadingFavicon ? 'Compressing and uploading...' : 'Upload custom favicon'}
                        </p>
                        <p className="text-[10px] text-neutral-500 mt-1">
                          Drag & drop image, or click to browse
                        </p>
                      </label>

                      {hasCustomFavicon && (
                        <button
                          onClick={handleResetFavicon}
                          disabled={isUploadingFavicon}
                          className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400 hover:text-white font-semibold text-xs py-2 px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 mt-2"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Reset to Default
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

          </div>

          {/* TELEGRAM BOT & REAL-TIME ALERTS SECTION */}
          {/* ========================================================= */}
          {/* UNIFIED TELEGRAM & SECURITY HUB                            */}
          {/* ========================================================= */}
          <div id="telegram_alerts_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24 space-y-6">
            
            {/* Header: Title, KPI Badges, Master Switch & Quick Diagnostic */}
            <div className="flex items-center justify-between flex-wrap gap-4 border-b border-white/5 pb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 rounded-2xl text-sky-400 shadow-inner">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-serif font-bold text-white tracking-wide">
                      Telegram & Security Hub
                    </h2>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${telegramConfig.enabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-neutral-800 text-neutral-400 border-white/10'}`}>
                      {telegramConfig.enabled ? 'Active 🟢' : 'Disabled ⚪'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/15 text-sky-300 border border-sky-500/25">
                      {consolidatedTelegramUsers.length} Users
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/25">
                      {consolidatedTelegramUsers.filter(u => u.confirmed && u.isActive).length} Verified 🟢
                    </span>
                    {consolidatedTelegramUsers.filter(u => !u.confirmed).length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25">
                        {consolidatedTelegramUsers.filter(u => !u.confirmed).length} Pending ⏳
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-neutral-800 text-neutral-300 border border-white/10">
                      {detectedSenders.length} Inbound Msgs
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                    Unified access control, whitelist directory, live sender detection & real-time couple event alerts
                  </p>
                </div>
              </div>

              {/* Header Right Actions: Quick Diagnostic & Master Broadcast Toggle */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleRunDiagnostics()}
                  disabled={isDiagnosingTelegram || !telegramConfig.botToken.trim()}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-sky-500/20"
                  title="Run end-to-end bot connection audit, API key check, and ping test"
                >
                  {isDiagnosingTelegram ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Bug className="w-3.5 h-3.5" />
                  )}
                  <span>🔍 Run Bot Diagnostics</span>
                </button>

                <div className="flex items-center gap-2 bg-neutral-950/60 border border-white/10 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-mono text-neutral-300">Bot Broadcast</span>
                  <button
                    type="button"
                    onClick={() => setTelegramConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${telegramConfig.enabled ? 'bg-sky-500' : 'bg-neutral-800'}`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${telegramConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Step-by-Step Setup Guide Banner */}
            <div className="bg-gradient-to-r from-sky-950/30 via-indigo-950/20 to-neutral-950/40 border border-sky-500/20 rounded-2xl p-4 text-xs text-neutral-300 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sky-300">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <span>Telegram Bot Setup & Access Guide:</span>
                </div>
                <span className="text-[10px] font-mono text-neutral-400">Step-by-step connection</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11px] leading-relaxed">
                <div className="bg-black/30 p-2.5 rounded-xl border border-white/5 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-[10px] font-mono font-bold">1</span>
                    <span>Get Bot Token</span>
                  </div>
                  <p className="text-neutral-400">
                    Search <code className="text-sky-300">@BotFather</code> in Telegram, send <code className="text-sky-300">/newbot</code>, and copy your HTTP API Bot Token.
                  </p>
                </div>
                <div className="bg-black/30 p-2.5 rounded-xl border border-white/5 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-[10px] font-mono font-bold">2</span>
                    <span>Authorize Users</span>
                  </div>
                  <p className="text-neutral-400">
                    Add Telegram usernames below. Users simply open your bot and send <code className="text-sky-300 font-mono">/start</code> or <code className="text-sky-300 font-mono">/confirm</code> to activate.
                  </p>
                </div>
                <div className="bg-black/30 p-2.5 rounded-xl border border-white/5 space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center text-[10px] font-mono font-bold">3</span>
                    <span>Couple & Security Alerts</span>
                  </div>
                  <p className="text-neutral-400">
                    Partners receive instant alerts for milestone countdowns, date nights, sealed love letters, chat messages, and cards!
                  </p>
                </div>
              </div>
            </div>

            {/* Unified Hub Sub-Navigation Tabs */}
            <div className="flex items-center gap-2 p-1 bg-neutral-950/70 border border-white/10 rounded-2xl flex-wrap sm:flex-nowrap">
              <button
                type="button"
                onClick={() => setTelegramHubActiveTab('users')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  telegramHubActiveTab === 'users'
                    ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>👥 Authorized Users & Whitelist</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  telegramHubActiveTab === 'users' ? 'bg-white/20 text-white' : 'bg-neutral-800 text-neutral-300'
                }`}>
                  {consolidatedTelegramUsers.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTelegramHubActiveTab('senders')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  telegramHubActiveTab === 'senders'
                    ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>📥 Detected Senders & Messages</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  telegramHubActiveTab === 'senders' ? 'bg-white/20 text-white' : 'bg-neutral-800 text-neutral-300'
                }`}>
                  {detectedSenders.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTelegramHubActiveTab('settings')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  telegramHubActiveTab === 'settings'
                    ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>⚙️ Bot Config, Webhook & Triggers</span>
              </button>
            </div>

            {/* ========================================================================= */}
            {/* SUB-VIEW 1: AUTHORIZED USERS & WHITELIST DIRECTORY                        */}
            {/* ========================================================================= */}
            {telegramHubActiveTab === 'users' && (
              <div className="space-y-4">
                {/* Directory Controls: Search, Status Filters & Action Buttons */}
                <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    {/* Search filter input */}
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={telegramUserSearch}
                        onChange={(e) => setTelegramUserSearch(e.target.value)}
                        placeholder="Search directory by @handle, account, or role..."
                        className="w-full bg-neutral-900 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-sky-500/60"
                      />
                      {telegramUserSearch && (
                        <button
                          type="button"
                          onClick={() => setTelegramUserSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1.5 bg-neutral-900 p-1 rounded-xl border border-white/5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setTelegramUserFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer ${
                          telegramUserFilter === 'all' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        All ({consolidatedTelegramUsers.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelegramUserFilter('verified')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer ${
                          telegramUserFilter === 'verified' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Verified ({consolidatedTelegramUsers.filter(u => u.confirmed && u.isActive).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelegramUserFilter('pending')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer ${
                          telegramUserFilter === 'pending' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Pending ({consolidatedTelegramUsers.filter(u => !u.confirmed).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelegramUserFilter('paused')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all cursor-pointer ${
                          telegramUserFilter === 'paused' ? 'bg-neutral-800 text-neutral-300 border border-white/10' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        Paused ({consolidatedTelegramUsers.filter(u => !u.isActive).length})
                      </button>
                    </div>

                    {/* Toolbar Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 bg-neutral-900 px-3 py-1.5 rounded-xl border border-white/10 cursor-pointer" title="Automatically imports and links usernames saved in user profiles">
                        <input
                          type="checkbox"
                          checked={telegramConfig.autoSyncProfiles !== false}
                          onChange={(e) => setTelegramConfig(prev => ({ ...prev, autoSyncProfiles: e.target.checked }))}
                          className="rounded border-white/20 text-sky-500 focus:ring-0"
                        />
                        <span className="text-[11px] text-neutral-300 font-mono">
                          Auto-Sync Profiles
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={handleReleaseWebhookAndPull}
                        disabled={isRefreshingSenders || !telegramConfig.botToken.trim()}
                        className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                        title="Deletes active Telegram webhook lock and pulls unread messages"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isRefreshingSenders ? 'animate-spin' : ''}`} />
                        <span>Unlock & Pull</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleAutoResolveChatIds}
                        disabled={isResolvingChatIds || !telegramConfig.botToken.trim()}
                        className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-sky-600 hover:from-purple-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-purple-500/20"
                        title="Inspect Telegram updates to auto-detect numeric Chat IDs for every username"
                      >
                        {isResolvingChatIds ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>Auto-Detect Chat IDs</span>
                      </button>
                    </div>
                  </div>

                  {/* Auto-Resolve Status Notice */}
                  {autoResolveStatus && (
                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs text-purple-300 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>{autoResolveStatus}</span>
                    </div>
                  )}

                  {/* Unified Add/Authorize User Input Row */}
                  <form onSubmit={handleAddTelegramAuthorizedUser} className="bg-neutral-900/90 border border-white/10 rounded-xl p-3 pt-2.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 text-sky-400" />
                        <span>Authorize & Whitelist New Telegram Account</span>
                      </span>
                      <span className="text-[10px] text-neutral-400 font-mono">
                        Instant bot access & couple alerts authorization
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {/* Telegram Username */}
                      <div>
                        <label className="text-[10px] font-semibold text-neutral-400 block mb-1 font-mono uppercase">
                          Telegram Username *
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-neutral-500 font-mono text-xs">
                            @
                          </span>
                          <input
                            type="text"
                            placeholder="username (e.g. mariem)"
                            value={newAuthUsername}
                            onChange={(e) => setNewAuthUsername(e.target.value)}
                            className="w-full bg-neutral-950 border border-white/10 rounded-xl pl-7 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-sky-500/60"
                          />
                        </div>
                      </div>

                      {/* Linked App Account */}
                      <div>
                        <label className="text-[10px] font-semibold text-neutral-400 block mb-1 font-mono uppercase">
                          Linked App Profile
                        </label>
                        <select
                          value={newAuthAppUsername}
                          onChange={(e) => setNewAuthAppUsername(e.target.value)}
                          className="w-full bg-neutral-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500/60 font-mono"
                        >
                          <option value="">-- Choose Account (Optional) --</option>
                          {userAccounts.map(acc => (
                            <option key={`opt-acc-${acc.id}`} value={acc.username}>
                              {acc.username} {acc.gender ? `(${acc.gender})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Optional Chat ID */}
                      <div>
                        <label className="text-[10px] font-semibold text-neutral-400 block mb-1 font-mono uppercase">
                          Chat ID (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="Auto-captured on /confirm"
                          value={newAuthChatId}
                          onChange={(e) => setNewAuthChatId(e.target.value)}
                          className="w-full bg-neutral-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-sky-500/60"
                        />
                      </div>

                      {/* Role & Submit */}
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] font-semibold text-neutral-400 block mb-1 font-mono uppercase">
                            Access Role
                          </label>
                          <select
                            value={newAuthRole}
                            onChange={(e) => setNewAuthRole(e.target.value as any)}
                            className="w-full bg-neutral-950 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500/60 font-mono"
                          >
                            <option value="partner">Partner 💖</option>
                            <option value="admin">Admin 🛡️</option>
                            <option value="guest">Guest 👤</option>
                          </select>
                        </div>

                        <button
                          type="submit"
                          disabled={!newAuthUsername.trim()}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50 shrink-0 h-[32px] shadow-sm"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Authorize</span>
                        </button>
                      </div>
                    </div>
                  </form>
                </div>

                {/* Unified User Directory List */}
                <div className="space-y-2">
                  {filteredConsolidatedUsers.map((user) => {
                    const noticeKey = user.id || user.telegramUsername;
                    const notice = userActionNotice[noticeKey];
                    const isTesting = testingUserId === noticeKey;

                    return (
                      <div
                        key={user.key}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3.5 ${
                          user.isActive
                            ? 'bg-neutral-950/70 border-white/10 hover:border-sky-500/30'
                            : 'bg-neutral-950/40 border-white/5 opacity-60'
                        }`}
                      >
                        {/* User Identity & Badges */}
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 sm:mt-0 ${
                            user.confirmed
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {user.confirmed ? '✓' : '⏳'}
                          </div>

                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={`https://t.me/${user.telegramUsername.replace(/^@/, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs font-bold text-sky-300 hover:underline flex items-center gap-1"
                              >
                                <span>{user.telegramUsername}</span>
                                <ExternalLink className="w-3 h-3 opacity-60" />
                              </a>

                              <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25 uppercase font-semibold">
                                {user.role}
                              </span>

                              {user.confirmed ? (
                                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <span>Verified & Active 🟢</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                                  Awaiting /confirm in bot ⏳
                                </span>
                              )}

                              {user.source === 'profile' && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/20">
                                  Profile Linked
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono flex-wrap">
                              {user.appUsername && (
                                <span>Profile: <strong className="text-white">@{user.appUsername}</strong></span>
                              )}
                              <span>•</span>
                              <span>
                                Chat ID: {user.chatId ? (
                                  <code className="text-sky-300 font-bold bg-neutral-900 px-1.5 py-0.5 rounded border border-white/5">
                                    {user.chatId}
                                  </code>
                                ) : (
                                  <span className="text-neutral-500 italic">Pending /confirm in bot</span>
                                )}
                              </span>
                              {user.confirmedAt && (
                                <>
                                  <span>•</span>
                                  <span>Confirmed: {new Date(user.confirmedAt).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>

                            {notice && (
                              <p className="text-[10px] font-mono text-sky-400 animate-pulse">
                                {notice}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 self-end md:self-center shrink-0 flex-wrap">
                          {/* Manual Confirm / Promote Button */}
                          {!user.confirmed && (
                            <button
                              type="button"
                              onClick={() => {
                                if (user.id) {
                                  handleManualConfirmUser(user.id);
                                } else {
                                  handlePromoteWhitelistUser(user.telegramUsername, user.role);
                                }
                              }}
                              className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                              title="Manually verify and grant access without waiting for /confirm"
                            >
                              Verify Access
                            </button>
                          )}

                          {/* Individual Diagnostic Ping Button */}
                          <button
                            type="button"
                            disabled={isTesting || !user.chatId}
                            onClick={() => handleTestIndividualUser(user)}
                            className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-200 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-40"
                            title={user.chatId ? `Send a direct test alert to ${user.telegramUsername}` : "User has not messaged bot yet"}
                          >
                            {isTesting ? (
                              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Send className="w-3 h-3 text-sky-400" />
                            )}
                            <span>Test Ping</span>
                          </button>

                          {/* Toggle Active Switch if user has id */}
                          {user.id && (
                            <button
                              type="button"
                              onClick={() => handleToggleAuthorizedUser(user.id!, user.isActive)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all cursor-pointer ${
                                user.isActive
                                  ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                                  : 'bg-neutral-800 border-white/5 text-neutral-500'
                              }`}
                              title={user.isActive ? "Pause alerts for this user" : "Resume alerts"}
                            >
                              {user.isActive ? 'Active' : 'Paused'}
                            </button>
                          )}

                          {/* Delete button (removes cleanly from both registry and whitelist) */}
                          <button
                            type="button"
                            onClick={() => handleRemoveConsolidatedUser(user)}
                            className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Remove user from Telegram & Security Hub"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {filteredConsolidatedUsers.length === 0 && (
                    <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2">
                      <p className="text-xs text-neutral-300 font-semibold">
                        {telegramUserSearch ? 'No matching users found in directory.' : 'No users registered in Telegram & Security Hub yet.'}
                      </p>
                      <p className="text-[11px] text-neutral-400 max-w-md mx-auto">
                        Add a partner's Telegram username above or have them save their Telegram handle in their User Profile to grant access!
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SUB-VIEW 2: DETECTED TELEGRAM SENDERS & LIVE MESSAGES                     */}
            {/* ========================================================================= */}
            {telegramHubActiveTab === 'senders' && (
              <div className="space-y-4">
                <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                        Live Detected Telegram Senders ({detectedSenders.length})
                      </h4>
                      <p className="text-[11px] text-neutral-400">
                        Inbound messages sent to your bot (<code className="text-sky-300 font-mono">/start</code>, <code className="text-sky-300 font-mono">/confirm</code>). Link any sender to an account with 1 click.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRefreshDetectedSenders}
                        disabled={isRefreshingSenders || !telegramConfig.botToken.trim()}
                        className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                        title="Fetch latest updates and unread messages"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isRefreshingSenders ? 'animate-spin' : ''}`} />
                        <span>Refresh Messages</span>
                      </button>

                      {detectedSenders.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearDetectedSenders}
                          className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-400 hover:text-rose-400 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          title="Clear message history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Clear Log</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Senders Cards */}
                <div className="space-y-2.5">
                  {detectedSenders.map((sender, idx) => {
                    const isLinked = (telegramConfig.authorizedUsers || []).some(
                      u => u.chatId === sender.chatId && u.confirmed
                    );
                    const linkedUser = (telegramConfig.authorizedUsers || []).find(
                      u => u.chatId === sender.chatId
                    );
                    const isLinking = linkingSenderChatId === sender.chatId;
                    const isCopied = copiedChatId === sender.chatId;

                    return (
                      <div
                        key={`det-snd-${sender.chatId}-${idx}`}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3.5 ${
                          isLinked 
                            ? 'bg-neutral-950/70 border-emerald-500/20' 
                            : 'bg-neutral-950/90 border-white/10 hover:border-sky-500/30'
                        }`}
                      >
                        {/* Sender info */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                            isLinked 
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          }`}>
                            {isLinked ? '✓' : (sender.firstName ? sender.firstName[0].toUpperCase() : 'TG')}
                          </div>

                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs text-white">
                                {sender.firstName} {sender.lastName || ''}
                              </span>

                              {sender.username ? (
                                <a
                                  href={`https://t.me/${sender.username.replace(/^@/, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-mono text-sky-400 hover:underline flex items-center gap-1"
                                >
                                  <span>{sender.username}</span>
                                  <ExternalLink className="w-3 h-3 opacity-70" />
                                </a>
                              ) : (
                                <span className="text-[10px] font-mono text-neutral-500 italic">
                                  No @username
                                </span>
                              )}

                              {isLinked ? (
                                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                                  Verified & Linked {linkedUser ? `(${linkedUser.telegramUsername})` : ''} 🟢
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">
                                  Unlinked Sender ⚠️
                                </span>
                              )}
                            </div>

                            {/* Message details & Chat ID */}
                            <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-300 flex-wrap">
                              <div className="flex items-center gap-1.5 bg-neutral-900 px-2 py-0.5 rounded-md border border-white/5">
                                <span className="text-neutral-500">Chat ID:</span>
                                <code className="text-sky-300 font-bold">{sender.chatId}</code>
                                <button
                                  type="button"
                                  onClick={() => handleCopyChatId(sender.chatId)}
                                  className="text-neutral-400 hover:text-white transition-colors cursor-pointer ml-0.5"
                                  title="Copy numeric Chat ID"
                                >
                                  {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>

                              {sender.text && (
                                <div className="bg-neutral-900 px-2 py-0.5 rounded-md border border-white/5 text-neutral-300 truncate max-w-[240px]">
                                  <span>Msg: </span>
                                  <strong className="text-white">"{sender.text}"</strong>
                                </div>
                              )}

                              {sender.timestamp && (
                                <span className="text-[10px] text-neutral-500">
                                  {new Date(sender.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Quick Link Action Form */}
                        {!isLinked && (
                          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 self-end md:self-center">
                            <select
                              value={selectedLinkTargets[sender.chatId] || sender.username || activeCombinedWhitelist[0] || ''}
                              onChange={(e) => setSelectedLinkTargets(prev => ({ ...prev, [sender.chatId]: e.target.value }))}
                              className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500/60 font-mono"
                            >
                              <optgroup label="Whitelist Handles">
                                {activeCombinedWhitelist.map(u => (
                                  <option key={`wh-tgt-${u}`} value={u}>{u}</option>
                                ))}
                              </optgroup>
                              <optgroup label="App User Accounts">
                                {userAccounts.map(acc => (
                                  <option key={`acc-tgt-${acc.id}`} value={acc.telegramUsername ? (acc.telegramUsername.startsWith('@') ? acc.telegramUsername : `@${acc.telegramUsername}`) : `@${acc.username}`}>
                                    {acc.username} {acc.telegramUsername ? `(${acc.telegramUsername})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                              {sender.username && !activeCombinedWhitelist.includes(sender.username.toLowerCase()) && (
                                <option value={sender.username}>This Sender: {sender.username}</option>
                              )}
                            </select>

                            <button
                              type="button"
                              disabled={isLinking}
                              onClick={() => handleQuickLinkSender(sender)}
                              className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-500/15 shrink-0"
                              title="Instantly link and verify this Telegram Chat ID to the selected account"
                            >
                              {isLinking ? (
                                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>⚡ Link & Verify</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {detectedSenders.length === 0 && (
                    <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2">
                      <p className="text-xs text-neutral-300 font-semibold">No recent Telegram bot messages captured yet.</p>
                      <p className="text-[11px] text-neutral-400 max-w-lg mx-auto">
                        Open your bot in Telegram and send <code className="text-sky-300 font-mono font-bold">/start</code> or <code className="text-sky-300 font-mono font-bold">/confirm</code>. Then click <b>"Refresh Messages"</b> or <b>"Auto-Detect Chat IDs"</b> above!
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SUB-VIEW 3: BOT CREDENTIALS, WEBHOOK & EVENT TRIGGERS                     */}
            {/* ========================================================================= */}
            {telegramHubActiveTab === 'settings' && (
              <div className="space-y-6">
                {/* Credentials Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bot Token */}
                  <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-2">
                    <label className="text-xs font-semibold text-neutral-300 block">
                      Telegram Bot Token (HTTP API)
                    </label>
                    <div className="relative">
                      <input
                        type={showBotToken ? "text" : "password"}
                        value={telegramConfig.botToken}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, botToken: e.target.value }))}
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        className="w-full bg-neutral-900 border border-white/10 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500/60 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowBotToken(!showBotToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                      >
                        {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 font-mono">
                      Generated by Telegram's @BotFather when creating your bot.
                    </p>
                  </div>

                  {/* Primary Group Chat ID (Optional) */}
                  <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-2">
                    <label className="text-xs font-semibold text-neutral-300 block">
                      Primary Group Chat ID <span className="text-[10px] text-neutral-500 font-mono font-normal">(Optional for shared groups)</span>
                    </label>
                    <input
                      type="text"
                      value={telegramConfig.chatId}
                      onChange={(e) => setTelegramConfig(prev => ({ ...prev, chatId: e.target.value }))}
                      placeholder="-100... (Optional for shared couple group chats)"
                      className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500/60 transition-all font-mono"
                    />
                    <p className="text-[10px] text-neutral-500 font-mono">
                      Optional. Authorized users receive alerts in their personal chats automatically by their @usernames.
                    </p>
                  </div>
                </div>

                {/* Event Category Notification Toggles */}
                <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                        Broadcast Event Triggers & Reminders
                      </h4>
                      <p className="text-[11px] text-neutral-400">
                        Choose which romance, couple celebration, and security events trigger automated Telegram alerts
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifyMilestones}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifyMilestones: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">💍 Milestones & Anniversaries</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Countdowns & celebration pings</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifyDates}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifyDates: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">🗓️ Date Night Reminders</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Itineraries & checklist alerts</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifyLetters}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifyLetters: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">💌 Sealed Love Letters</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Alert when partner seals a letter</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifyChat}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifyChat: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">💬 Sweet Chat Messages</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Direct message partner notices</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifySecurity}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifySecurity: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">🛡️ Security & Login Alerts</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Suspicious login & lockout alerts</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 bg-neutral-900 border border-white/10 p-3 rounded-xl cursor-pointer hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        checked={telegramConfig.notifyCards !== false}
                        onChange={(e) => setTelegramConfig(prev => ({ ...prev, notifyCards: e.target.checked }))}
                        className="rounded border-white/20 text-sky-500 focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white block">🎉 Choose Moment & Cards</span>
                        <span className="text-[10px] text-neutral-400 font-mono">Interactive cards & celebrations</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Telegram Webhook Engine */}
                <div className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                            Telegram Webhook &amp; Bot Commands Engine
                          </h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border ${telegramConfig.webhookEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-sky-500/15 text-sky-300 border-sky-500/30'}`}>
                            {telegramConfig.webhookEnabled ? 'Webhook Active 🟢' : 'Auto-Polling Active 🟢'}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400">
                          Handles interactive commands in both Webhook and Direct Polling modes and auto-replies with Chat ID, account link, workouts &amp; progress.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isSyncingCommands || !telegramConfig.botToken}
                        onClick={handleSyncBotCommands}
                        className="px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                        title="Register slash commands menu (setMyCommands) and process pending messages"
                      >
                        {isSyncingCommands ? (
                          <div className="w-3 h-3 border-2 border-sky-300/30 border-t-sky-300 rounded-full animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>Sync Bot / Menu</span>
                      </button>
                    </div>

                    {/* Supported Commands Directory */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                      {TELEGRAM_COMMAND_DEFINITIONS.map((item) => (
                        <div
                          key={item.command}
                          className="bg-neutral-900/70 border border-white/5 rounded-xl px-2.5 py-1.5 flex items-start gap-2"
                        >
                          <code className="text-[11px] font-mono font-bold text-sky-300 shrink-0">
                            /{item.command}
                          </code>
                          <span className="text-[10px] text-neutral-400 leading-tight">
                            {item.description}
                          </span>
                        </div>
                      ))}
                    </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-300 block">
                      Public Webhook Endpoint URL
                    </label>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <input
                        type="text"
                        value={webhookInputUrl}
                        onChange={(e) => setWebhookInputUrl(e.target.value)}
                        placeholder="https://your-domain.app/api/telegram/webhook"
                        className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-indigo-500/60"
                      />

                      <button
                        type="button"
                        disabled={isManagingWebhook || !telegramConfig.botToken || !webhookInputUrl}
                        onClick={handleSetWebhook}
                        className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                      >
                        {isManagingWebhook ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>Activate Webhook</span>
                      </button>

                      <button
                        type="button"
                        disabled={isManagingWebhook || !telegramConfig.botToken}
                        onClick={handleCheckWebhookInfo}
                        className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-neutral-300 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                      >
                        <span>Inspect Info</span>
                      </button>

                      <button
                        type="button"
                        disabled={isManagingWebhook || !telegramConfig.botToken}
                        onClick={handleDeleteWebhook}
                        className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0"
                        title="Remove webhook and return to polling"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {webhookStatusNotice && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${webhookStatusNotice.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'}`}>
                      {webhookStatusNotice.success ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                      <span>{webhookStatusNotice.message}</span>
                    </div>
                  )}

                  {webhookInfoData && (
                    <div className="bg-black/50 p-3 rounded-xl border border-white/5 text-[11px] font-mono space-y-1 text-neutral-300">
                      <div><b>Active URL:</b> <span className="text-sky-300">{webhookInfoData.url || 'None'}</span></div>
                      <div><b>Pending Updates:</b> {webhookInfoData.pending_update_count || 0}</div>
                      {webhookInfoData.last_error_message && (
                        <div className="text-rose-400"><b>Last Error:</b> {webhookInfoData.last_error_message}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status Feedback */}
            {telegramTestStatus && (
              <div className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 ${telegramTestStatus.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'}`}>
                {telegramTestStatus.success ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                <span className="leading-relaxed">{telegramTestStatus.message}</span>
              </div>
            )}

            {telegramSaveStatus && (
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{telegramSaveStatus}</span>
              </div>
            )}

            {/* Bottom Primary Actions Bar */}
            <div className="flex items-center gap-3 pt-3 flex-wrap border-t border-white/5">
              {/* DIAGNOSTIC BUTTON: Sends test message & audits connection */}
              <button
                type="button"
                disabled={isDiagnosingTelegram || !telegramConfig.botToken.trim()}
                onClick={() => handleRunDiagnostics()}
                className="px-4 py-2.5 bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 hover:from-sky-500 hover:to-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-sky-500/20"
                title="Sends a test diagnostic message and audits Bot API connection, latency, and keys"
              >
                {isDiagnosingTelegram ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Bug className="w-3.5 h-3.5" />
                )}
                <span>🔍 Run Bot Diagnostics & API Ping</span>
              </button>

              <button
                type="button"
                disabled={isTestingTelegram || !telegramConfig.botToken.trim()}
                onClick={handleTestTelegramConnection}
                className="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                title="Dispatches a test alert to all confirmed user chat IDs simultaneously"
              >
                {isTestingTelegram ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span>📢 Broadcast Alert to All Users</span>
              </button>

              <button
                type="button"
                disabled={isResolvingChatIds || !telegramConfig.botToken.trim()}
                onClick={handleAutoResolveChatIds}
                className="px-4 py-2.5 bg-purple-950/60 hover:bg-purple-900/60 border border-purple-500/30 text-purple-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                title="Auto-detects Chat IDs for all whitelisted usernames from Telegram bot updates"
              >
                {isResolvingChatIds ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                )}
                <span>⚡ Auto-Detect Chat IDs</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveTelegramConfig()}
                disabled={isSavingTelegram}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-emerald-500/15 ml-auto"
              >
                {isSavingTelegram ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>💾 Save Telegram Settings</span>
              </button>
            </div>

            {/* ========================================================================= */}
            {/* COMPREHENSIVE BOT DIAGNOSTIC & API TEST MODAL                             */}
            {/* ========================================================================= */}
            {showDiagnosticModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                <div className="bg-neutral-900 border border-white/15 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl relative">
                  
                  {/* Modal Header */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-sky-500/20 text-sky-400 rounded-2xl border border-sky-500/30">
                        <Bug className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white font-serif">
                          Telegram Bot Connection Diagnostics & Audit
                        </h3>
                        <p className="text-xs text-neutral-400 font-mono">
                          API key validation, latency check & live test message delivery
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowDiagnosticModal(false)}
                      className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Execution Spinner if running */}
                  {isDiagnosingTelegram && (
                    <div className="py-12 text-center space-y-3">
                      <div className="w-10 h-10 border-3 border-sky-500/30 border-t-sky-400 rounded-full animate-spin mx-auto" />
                      <p className="text-xs font-mono text-sky-300">
                        Auditing Telegram API cloud connection & bot credentials...
                      </p>
                    </div>
                  )}

                  {/* Diagnostic Results Report */}
                  {!isDiagnosingTelegram && diagnosticReport && (
                    <div className="space-y-4">
                      {/* Overall Health Summary Banner */}
                      <div className={`p-4 rounded-2xl border flex items-center justify-between flex-wrap gap-3 ${
                        diagnosticReport.success
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      }`}>
                        <div className="flex items-center gap-3">
                          {diagnosticReport.success ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-6 h-6 text-rose-400 shrink-0" />
                          )}
                          <div>
                            <h4 className="text-sm font-bold">
                              {diagnosticReport.success ? 'Diagnostic Passed: Telegram Bot Online 🟢' : 'Diagnostic Alert: Connection Issue Detected 🔴'}
                            </h4>
                            <p className="text-xs opacity-90 font-mono mt-0.5">
                              {diagnosticReport.success 
                                ? `Bot @${diagnosticReport.bot?.username || 'bot'} verified and responding normally.` 
                                : diagnosticReport.error || 'Failed to authenticate with Telegram API.'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 bg-black/40 rounded-xl text-xs font-mono font-bold border border-white/10 text-white">
                            ⚡ {diagnosticReport.latencyMs} ms latency
                          </span>
                        </div>
                      </div>

                      {/* Custom Chat ID or Username Input to Re-Test with specific recipient */}
                      <div className="bg-neutral-950 p-3.5 rounded-2xl border border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-neutral-300 block">
                            Test Message Destination (Chat ID or @username)
                          </label>
                          <span className="text-[10px] text-sky-400 font-mono">Supports Chat ID & @username</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                          <input
                            type="text"
                            value={diagnosticCustomChatId}
                            onChange={(e) => setDiagnosticCustomChatId(e.target.value)}
                            placeholder="Enter numeric Chat ID (e.g. -100...) or @username"
                            className="flex-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-sky-500/60"
                          />
                          <button
                            type="button"
                            onClick={() => handleRunDiagnostics(diagnosticCustomChatId)}
                            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Dispatch Diagnostic Ping</span>
                          </button>
                        </div>
                        <p className="text-[10px] text-neutral-400 font-mono">
                          ℹ️ If you enter a username (e.g. <code className="text-sky-300">@ebrahimayman</code>), the system automatically resolves its Chat ID from recent bot updates or cache.
                        </p>
                      </div>

                      {/* Diagnostic Checklist */}
                      <div className="bg-neutral-950 p-4 rounded-2xl border border-white/10 space-y-2.5">
                        <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider font-mono">
                          Verification Checklist
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                          <div className="flex items-center gap-2 p-2 bg-neutral-900/60 rounded-xl border border-white/5">
                            {diagnosticReport.checks.tokenProvided ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            <span className="text-neutral-300">Bot Token Configured</span>
                          </div>

                          <div className="flex items-center gap-2 p-2 bg-neutral-900/60 rounded-xl border border-white/5">
                            {diagnosticReport.checks.apiReachable ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            <span className="text-neutral-300">Telegram Cloud Reachable</span>
                          </div>

                          <div className="flex items-center gap-2 p-2 bg-neutral-900/60 rounded-xl border border-white/5">
                            {diagnosticReport.checks.botAuthenticated ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            <span className="text-neutral-300">
                              Auth: @{diagnosticReport.bot?.username || 'unknown'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 p-2 bg-neutral-900/60 rounded-xl border border-white/5">
                            {diagnosticReport.checks.webhookHealthy ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            )}
                            <span className="text-neutral-300">
                              Webhook: {diagnosticReport.webhook?.url ? 'Active' : 'Polling Mode'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 p-2 bg-neutral-900/60 rounded-xl border border-white/5 sm:col-span-2">
                            {diagnosticReport.testMessageSent ? (
                              diagnosticReport.testMessageDelivered ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                              )
                            ) : (
                              <div className="w-4 h-4 rounded-full border border-neutral-600 flex items-center justify-center text-[10px] text-neutral-400">⚪</div>
                            )}
                            <span className="text-neutral-300">
                              {diagnosticReport.testMessageSent 
                                ? (diagnosticReport.testMessageDelivered ? 'Test Message Delivered to Chat ID ✅' : `Delivery Failed: ${diagnosticReport.testMessageError || 'Chat not found'}`)
                                : 'No Destination Chat ID entered (message test skipped)'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bot Details Card */}
                      {diagnosticReport.bot && (
                        <div className="bg-neutral-950 p-4 rounded-2xl border border-white/10 space-y-2 text-xs font-mono">
                          <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider font-mono">
                            Bot Identity & Permissions
                          </h4>
                          <div className="grid grid-cols-2 gap-2 text-neutral-400">
                            <div><b>Bot ID:</b> <span className="text-white">{diagnosticReport.bot.id}</span></div>
                            <div><b>Username:</b> <span className="text-sky-300">@{diagnosticReport.bot.username}</span></div>
                            <div><b>Display Name:</b> <span className="text-white">{diagnosticReport.bot.firstName}</span></div>
                            <div><b>Join Groups:</b> <span className={diagnosticReport.bot.canJoinGroups ? 'text-emerald-400' : 'text-neutral-500'}>{diagnosticReport.bot.canJoinGroups ? 'Allowed' : 'Disabled'}</span></div>
                          </div>
                        </div>
                      )}

                      {/* Raw Telegram API Response Payload */}
                      {diagnosticReport.rawTelegramResponse && (
                        <div className="bg-neutral-950 p-4 rounded-2xl border border-white/10 space-y-2 text-xs font-mono">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                              <Terminal className="w-3.5 h-3.5 text-sky-400" />
                              <span>Raw Telegram Response Payload</span>
                            </h4>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(diagnosticReport.rawTelegramResponse, null, 2));
                                setCopyDiagnosticJsonSuccess(true);
                                setTimeout(() => setCopyDiagnosticJsonSuccess(false), 2000);
                              }}
                              className="text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
                            >
                              {copyDiagnosticJsonSuccess ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 text-[10px]">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span className="text-[10px]">Copy JSON</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="bg-black/60 p-3 rounded-xl border border-white/5 text-[10px] text-sky-300 overflow-x-auto max-h-48 leading-relaxed">
                            {JSON.stringify(diagnosticReport.rawTelegramResponse, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Modal Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleRunDiagnostics()}
                      disabled={isDiagnosingTelegram}
                      className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isDiagnosingTelegram ? 'animate-spin' : ''}`} />
                      <span>Re-Run Audit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowDiagnosticModal(false)}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
                    >
                      Close Diagnostics
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* ALL ADMIN CREDENTIALS & ACCESS CONTROL CARD */}
          <div id="credentials_section" className="bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 scroll-mt-24">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/25 rounded-2xl text-indigo-400 shadow-inner">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-serif font-bold text-white tracking-wide">Admin Portal Credentials</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {adminAccountsList.length} Active
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Synchronized across Firestore & Supabase</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleSyncAllAdmins}
                  disabled={isSyncing}
                  className="text-xs text-sky-300 hover:text-white font-mono flex items-center gap-1.5 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-2 rounded-xl border border-sky-500/25 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                  title="Sync all admin credentials across database tables"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Sync All</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewAdminUser('');
                    setNewAdminPass('');
                    setNewAdminRole('Super Admin');
                    setNewAdminNotes('');
                    setIsAddingAdmin(true);
                  }}
                  className="text-xs text-white font-mono font-medium flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-md shadow-indigo-500/20 active:scale-[0.98]"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Admin</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed mb-5">
              Manage all administrator login accounts and permissions for the admin portal. All changes immediately sync across Firestore & Supabase databases.
            </p>

            <AnimatePresence>
              {adminSuccessMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5 shadow-sm"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span className="font-medium">{adminSuccessMsg}</span>
                </motion.div>
              )}
              {adminErrorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-300 flex items-center gap-2.5 shadow-sm"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span className="font-medium">{adminErrorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* List of Admin Accounts */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                  Registered Admin Accounts ({adminAccountsList.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !showAllAdminPasswords;
                    setShowAllAdminPasswords(next);
                    if (!next) {
                      setShowAdminPasswordIds({});
                    }
                  }}
                  className="text-[11px] text-neutral-400 hover:text-white font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {showAllAdminPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showAllAdminPasswords ? 'Hide Passwords' : 'Show Passwords'}</span>
                </button>
              </div>

              {adminAccountsList.length === 0 ? (
                <div className="p-5 rounded-2xl bg-neutral-950/50 border border-white/5 text-center text-xs text-neutral-500 font-mono">
                  No custom admin accounts configured. Default environment admin is active.
                </div>
              ) : (
                adminAccountsList.map((acc, index) => {
                  const isPasswordShown = showAllAdminPasswords || !!showAdminPasswordIds[acc.id];
                  const displayPass = acc.password ? (isPasswordShown ? (acc.password.startsWith('sha256_v1:') ? '🔒 [SHA-256 Hashed]' : acc.password) : '••••••••') : '(No password set)';

                  return (
                    <div
                      key={`acc-${acc.id}-${index}`}
                      className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 hover:border-indigo-500/35 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 text-xs shadow-sm hover:shadow-md hover:bg-neutral-950/90 group"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0 mt-0.5 group-hover:border-indigo-500/40 transition-colors">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white text-sm font-serif tracking-wide">{acc.username}</span>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {acc.role || 'Super Admin'}
                            </span>
                            {index === 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                Primary
                              </span>
                            )}
                            {acc.twoFactorEnabled ? (
                              <button
                                type="button"
                                onClick={() => handleOpen2FAModalForAdmin(acc)}
                                className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                                title="2FA Active - Click to view recovery codes or reconfigure"
                              >
                                <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
                                <span>2FA Active</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpen2FAModalForAdmin(acc)}
                                className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1 hover:bg-amber-500/20 transition-colors cursor-pointer"
                                title="Click to enable Google Authenticator 2FA"
                              >
                                <KeyRound className="w-2.5 h-2.5 text-amber-400" />
                                <span>Setup 2FA</span>
                              </button>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono mt-1.5">
                            <Lock className="w-3 h-3 text-neutral-500" />
                            <span className="tracking-wider">{displayPass}</span>
                            <button
                              type="button"
                              onClick={() => setShowAdminPasswordIds(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                              className="text-neutral-500 hover:text-neutral-200 transition-colors ml-1 p-0.5 rounded cursor-pointer"
                              title={isPasswordShown ? "Hide password" : "Show password"}
                            >
                              {isPasswordShown ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>

                          {acc.notes && (
                            <p className="text-[11px] text-neutral-500 mt-1 italic">{acc.notes}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpen2FAModalForAdmin(acc)}
                          className={`p-2 rounded-xl border transition-all cursor-pointer ${
                            acc.twoFactorEnabled 
                              ? 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300' 
                              : 'border-white/10 hover:bg-white/10 text-neutral-400 hover:text-white'
                          }`}
                          title={acc.twoFactorEnabled ? "Manage Google Authenticator 2FA" : "Enable Google Authenticator 2FA"}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleSyncAdminAccount(acc)}
                          disabled={isSyncing || syncingAdminId === acc.id}
                          className="p-2 rounded-xl border border-sky-500/20 hover:bg-sky-500/15 text-sky-400 hover:text-sky-300 transition-all cursor-pointer disabled:opacity-50"
                          title={`Sync "${acc.username}" credential to Firestore & Supabase`}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${syncingAdminId === acc.id ? 'animate-spin text-sky-300' : ''}`} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingAdmin(acc);
                            setEditAdminUser(acc.username);
                            setEditAdminPass('');
                            setEditAdminRole(acc.role || 'Super Admin');
                            setEditAdminNotes(acc.notes || '');
                          }}
                          className="p-2 rounded-xl border border-indigo-500/20 hover:bg-indigo-500/15 text-indigo-400 hover:text-indigo-300 transition-all cursor-pointer"
                          title={`Edit "${acc.username}" admin account`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setAdminToDelete(acc)}
                          disabled={adminAccountsList.length <= 1}
                          className="p-2 rounded-xl border border-rose-500/20 hover:bg-rose-500/15 text-rose-400 hover:text-rose-300 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          title={adminAccountsList.length <= 1 ? "Cannot delete last admin account" : `Delete "${acc.username}" admin account`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-white/5 flex items-start gap-2.5 text-[11px] text-neutral-500 leading-relaxed font-mono">
              <ShieldAlert className="w-4 h-4 text-neutral-500 flex-shrink-0 mt-0.5" />
              <span>
                All admin accounts grant full administrative access to the Iron House gym portal and activity logs.
              </span>
            </div>

          </div>

          {/* SUPABASE SCHEMA & TABLE DIAGNOSTICS CARD */}
          <div id="db_diagnostics_section" className="w-full bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-7 relative shadow-xl backdrop-blur-xl transition-all hover:border-white/15 overflow-hidden scroll-mt-24">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-500/15 border border-sky-500/25 rounded-2xl text-sky-400 shrink-0 shadow-inner">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-serif font-bold text-white tracking-wide">Database Diagnostics & Sync</h2>
                  <p className="text-[11px] text-neutral-400 font-mono mt-0.5">Automated table existence & sync checks</p>
                </div>
              </div>
              <button
                onClick={() => refreshTableDiagnostics()}
                disabled={isCheckingTables}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-neutral-300 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                title="Re-check table status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingTables ? 'animate-spin text-sky-400' : ''}`} />
                <span className="hidden sm:inline">Check Tables</span>
              </button>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              Verifies if critical Supabase PostgreSQL tables exist in schema cache upon application load. Missing tables automatically trigger local fallback storage to guarantee zero downtime.
            </p>

            {/* Overall Status Banner */}
            {tableDiagnostics && (
              <div className={`p-3 rounded-2xl border mb-4 flex items-center justify-between gap-3 text-xs ${
                tableDiagnostics.allCriticalTablesExist
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : tableDiagnostics.configured
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                  : 'bg-neutral-800/80 border-neutral-700 text-neutral-300'
              }`}>
                <div className="flex items-center gap-2">
                  {tableDiagnostics.allCriticalTablesExist ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : tableDiagnostics.configured ? (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <Database className="w-4 h-4 text-neutral-400 shrink-0" />
                  )}
                  <span className="font-semibold">
                    {tableDiagnostics.allCriticalTablesExist
                      ? 'All Critical Tables Active & Synchronized'
                      : tableDiagnostics.configured
                      ? 'Synchronization Issue: Some Critical Tables Missing'
                      : 'Supabase Unconfigured (Local Storage Active)'}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                  Checked: {tableDiagnostics.checkedAt}
                </span>
              </div>
            )}

            {/* Table Indicators Grid */}
            {tableDiagnostics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 mb-4 w-full">
                {tableDiagnostics.tables.map((t, idx) => {
                  const isActive = t.status === 'active';
                  const isMissing = t.status === 'missing';
                  const isError = t.status === 'error';

                  return (
                    <div
                      key={`diag-table-${t.tableName}-${idx}`}
                      className={`p-2.5 rounded-2xl border flex items-center justify-between transition-all ${
                        isActive
                          ? 'bg-neutral-950/40 border-white/5 hover:border-emerald-500/30'
                          : isMissing
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : isError
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-neutral-950/20 border-white/5 text-neutral-400'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white truncate block">
                            {t.displayName}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-neutral-400 block truncate">
                          public.{t.tableName}
                        </span>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active
                          </span>
                        )}
                        {isMissing && (
                          <div className="flex items-center gap-1">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span> Missing
                            </span>
                            <button
                              onClick={() => setShowSqlSetupModal(true)}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-rose-600/80 hover:bg-rose-500 text-white border border-rose-400/40 shadow-sm transition-all cursor-pointer flex items-center gap-1"
                              title="Fix missing table schema"
                            >
                              <Wrench className="w-3 h-3" /> Fix
                            </button>
                          </div>
                        )}
                        {isError && (
                          <div className="flex items-center gap-1">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Error
                            </span>
                            <button
                              onClick={() => setShowSqlSetupModal(true)}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-amber-600/80 hover:bg-amber-500 text-white border border-amber-400/40 shadow-sm transition-all cursor-pointer flex items-center gap-1"
                              title="Fix database error"
                            >
                              <Wrench className="w-3 h-3" /> Fix
                            </button>
                          </div>
                        )}
                        {t.status === 'unconfigured' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700">
                            Offline
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Database Schema Repair & SQL Setup Action Banner */}
            <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl text-xs space-y-3 shadow-lg relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-indigo-200 font-bold text-sm">
                  <Wrench className="w-5 h-5 text-indigo-400 shrink-0" />
                  <span>Supabase Schema Tools & SQL Migration Script</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleAutoFixDatabase}
                    disabled={isFixingDb}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold rounded-xl shadow transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    title="Run automatic schema repair and sync routine"
                  >
                    <Wrench className={`w-3.5 h-3.5 ${isFixingDb ? 'animate-spin' : ''}`} />
                    <span>{isFixingDb ? 'Repairing Schema...' : 'Fix DB / Auto-Repair'}</span>
                  </button>
                  <button
                    onClick={() => setShowSqlSetupModal(true)}
                    className="px-3.5 py-1.5 bg-indigo-500/30 hover:bg-indigo-500/40 border border-indigo-400/40 text-indigo-100 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                  >
                    <Code className="w-3.5 h-3.5 text-indigo-300" />
                    <span>View SQL Fix Code</span>
                  </button>
                </div>
              </div>
              <p className="text-xs text-indigo-200/90 leading-relaxed">
                If any Supabase PostgreSQL tables or columns (like <code className="text-white font-mono bg-black/50 px-1.5 py-0.5 rounded border border-indigo-500/30">public.user_accounts</code>, <code className="text-white font-mono bg-black/50 px-1.5 py-0.5 rounded border border-indigo-500/30">public.admin_settings</code>, or <code className="text-white font-mono bg-black/50 px-1.5 py-0.5 rounded border border-indigo-500/30">public.workout_plans</code>) are missing or need updating in remote Supabase, click <strong className="text-amber-200">Fix DB / Auto-Repair</strong> to synchronize, or click <strong className="text-sky-200">View SQL Fix Code</strong> to copy and run the SQL script in your Supabase SQL Editor.
              </p>
              {autoFixMessage && (
                <div className={`p-2.5 rounded-xl text-xs font-mono flex items-center gap-2 ${
                  autoFixMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}>
                  {autoFixMessage.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                  <span>{autoFixMessage.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* DATABASE MAINTENANCE & DEDUPLICATION MIGRATION ROUTINE CARD */}
          <div className="bg-neutral-900/50 border border-white/10 rounded-3xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400 shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-serif font-bold text-white">Database Maintenance & Clean</h2>
                  <p className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider">Verify & Sync Collections</p>
                </div>
              </div>
              <button
                onClick={() => refreshDbStatus()}
                disabled={isCheckingDb}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-neutral-300 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                title="Ping connection health"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingDb ? 'animate-spin text-indigo-400' : ''}`} />
                <span className="hidden sm:inline">Ping</span>
              </button>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed mb-3">
              Check database health, verify Firestore connectivity, deduplicate activity logs & settings, and mirror data cleanly when dual-cloud Supabase is configured.
            </p>

            {/* Connection latency details in compact row */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-2.5 bg-neutral-950/50 border border-white/5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-neutral-500 uppercase tracking-widest font-mono block">Firebase DB</span>
                  <span className={`text-xs font-semibold ${dbStatus.firebase.online ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {dbStatus.firebase.online ? 'Connected' : 'Offline'}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-400 font-mono px-1.5 py-0.5 bg-white/5 rounded-md">{dbStatus.firebase.latencyMs}ms</span>
              </div>

              <div className="p-2.5 bg-neutral-950/50 border border-white/5 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-neutral-500 uppercase tracking-widest font-mono block">Supabase DB</span>
                  <span className={`text-xs font-semibold ${dbStatus.supabase.online ? 'text-emerald-400' : dbStatus.supabase.configured ? 'text-rose-400' : 'text-amber-400'}`}>
                    {dbStatus.supabase.online ? 'Connected' : dbStatus.supabase.configured ? 'Unreachable' : 'Not Configured'}
                  </span>
                </div>
                <span className="text-[10px] text-neutral-400 font-mono px-1.5 py-0.5 bg-white/5 rounded-md">{dbStatus.supabase.latencyMs}ms</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={handleRunMigration}
                disabled={isMigrating || !isSupabaseConfigured}
                className="w-full bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 text-white font-semibold text-xs py-2.5 px-4 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                title={!isSupabaseConfigured ? 'Requires Supabase credentials in .env to migrate logs from Firestore' : 'Migrate & deduplicate activity logs to Supabase'}
              >
                <RefreshCw className={`w-4 h-4 ${isMigrating ? 'animate-spin' : ''}`} />
                {isMigrating ? 'Processing Deduplication & Purge...' : 'Run Migration & Purge Old Firestore Data'}
              </button>
            </div>

            {/* BULK & TABLE-BY-TABLE BIDIRECTIONAL SYNC SECTION */}
            <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-teal-400" />
                    Bidirectional Data Table Synchronization
                  </h3>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    {isSupabaseConfigured
                      ? 'Sync specific Firestore & Supabase tables individually in either direction.'
                      : 'Firestore cloud is active. Add VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY to enable Supabase mirroring.'}
                  </p>
                </div>

                {/* Bulk Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleBulkSyncTables('firestore_to_supabase')}
                    disabled={isSyncingAllData || !isSupabaseConfigured}
                    className="px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-medium text-[11px] rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow disabled:opacity-40"
                    title="Sync all Firestore collections to Supabase"
                  >
                    <Upload className={`w-3.5 h-3.5 ${bulkSyncDirection === 'to_supabase' ? 'animate-spin' : ''}`} />
                    <span>Sync All ➔ Supabase</span>
                  </button>

                  <button
                    onClick={() => handleBulkSyncTables('supabase_to_firestore')}
                    disabled={isSyncingAllData || !isSupabaseConfigured}
                    className="px-3 py-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-medium text-[11px] rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow disabled:opacity-40"
                    title="Sync all Supabase tables to Firestore"
                  >
                    <Download className={`w-3.5 h-3.5 ${bulkSyncDirection === 'to_firestore' ? 'animate-spin' : ''}`} />
                    <span>Sync All ➔ Firestore</span>
                  </button>
                </div>
              </div>

              {/* INDIVIDUAL TABLE CARDS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 w-full">
                {SYNC_TABLES_LIST.map((table, idx) => {
                  const isSyncingToSupa = syncingTableState[table.key] === 'to_supabase';
                  const isSyncingToFire = syncingTableState[table.key] === 'to_firestore';
                  const isBusy = isSyncingToSupa || isSyncingToFire || isSyncingAllData || !isSupabaseConfigured;
                  const lastResult = tableSyncResults[table.key];
                  const diagStatus = tableDiagnostics?.tables?.find(t => t.tableName === table.supabaseTable);

                  return (
                    <div 
                      key={`sync-table-box-${table.key}-${idx}`}
                      className="p-3 bg-neutral-950/60 border border-white/5 rounded-2xl flex flex-col justify-between gap-2.5 hover:border-white/10 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-neutral-200">{table.label}</span>
                            <span className="text-[9px] font-mono text-neutral-500 bg-white/5 px-1.5 py-0.5 rounded">
                              {table.supabaseTable}
                            </span>
                          </div>
                          <p className="text-[10px] text-neutral-400 mt-0.5 leading-tight">
                            {table.description}
                          </p>
                        </div>

                        {diagStatus && (
                          <div className="flex items-center gap-1 text-[10px] shrink-0">
                            {diagStatus.status === 'active' ? (
                              <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono rounded-md">
                                Active
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono rounded-md">
                                {diagStatus.status}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Sync Result Banner for Table */}
                      {lastResult && (
                        <div className={`p-1.5 rounded-lg text-[10px] font-mono flex items-center justify-between gap-2 ${
                          lastResult.errors.length > 0
                            ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                            : 'bg-teal-500/10 border border-teal-500/20 text-teal-300'
                        }`}>
                          <div className="flex items-center gap-1.5 truncate">
                            <CheckCircle className="w-3 h-3 shrink-0 text-teal-400" />
                            <span className="truncate">
                              {lastResult.direction === 'firestore_to_supabase' ? 'FS ➔ Supa' : 'Supa ➔ FS'}: {lastResult.syncedCount} synced / {lastResult.processedCount} processed
                            </span>
                          </div>
                          {lastResult.errors.length > 0 && (
                            <span className="text-amber-400 font-bold shrink-0">({lastResult.errors.length} notices)</span>
                          )}
                        </div>
                      )}

                      {/* Directional Action Buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleSyncSingleTable(table.key, 'firestore_to_supabase')}
                          disabled={isBusy}
                          className="w-full bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 text-teal-300 hover:text-teal-100 text-[11px] font-medium py-1.5 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40"
                          title={`Sync Firestore ${table.label} to Supabase`}
                        >
                          <Upload className={`w-3 h-3 ${isSyncingToSupa ? 'animate-spin' : ''}`} />
                          <span>{isSyncingToSupa ? 'Uploading...' : 'FS ➔ Supabase'}</span>
                        </button>

                        <button
                          onClick={() => handleSyncSingleTable(table.key, 'supabase_to_firestore')}
                          disabled={isBusy}
                          className="w-full bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 hover:text-sky-100 text-[11px] font-medium py-1.5 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40"
                          title={`Sync Supabase ${table.label} to Firestore`}
                        >
                          <Download className={`w-3.5 h-3.5 ${isSyncingToFire ? 'animate-spin' : ''}`} />
                          <span>{isSyncingToFire ? 'Downloading...' : 'Supabase ➔ FS'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <AnimatePresence>
              {syncDataSummary && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 p-3 bg-teal-500/10 border border-teal-500/20 rounded-2xl text-xs space-y-2 text-teal-200 overflow-hidden"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-teal-500/20 gap-2">
                    <div className="flex items-center gap-1.5 text-teal-300 font-bold truncate">
                      <CheckCircle className="w-4 h-4 text-teal-400 shrink-0" />
                      <span className="truncate">
                        {syncDataSummary.mode === 'firestore_and_supabase'
                          ? 'Firestore + Supabase Data Sync Completed'
                          : 'Firestore Cloud Sync Verified'}
                      </span>
                    </div>
                    <button 
                      onClick={() => setSyncDataSummary(null)}
                      className="p-1 hover:bg-teal-500/20 rounded-md transition-all cursor-pointer text-neutral-400 hover:text-white shrink-0"
                      title="Dismiss summary"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-teal-500/10 flex justify-between">
                      <span className="text-neutral-400">User Accounts:</span>
                      <strong className="text-teal-300">{syncDataSummary?.userAccountsSynced ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-teal-500/10 flex justify-between">
                      <span className="text-neutral-400">Admin Settings:</span>
                      <strong className="text-teal-300">{syncDataSummary?.adminSettingsSynced ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-teal-500/10 flex justify-between">
                      <span className="text-neutral-400">Workout Plans:</span>
                      <strong className="text-teal-300">{syncDataSummary?.workoutPlansSynced ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-teal-500/10 flex justify-between">
                      <span className="text-neutral-400">Activity Logs:</span>
                      <strong className="text-teal-300">{syncDataSummary?.activityLogsSynced ?? 0}</strong>
                    </div>
                  </div>

                  {syncDataSummary?.errors && syncDataSummary.errors.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-teal-500/20 text-[9px] text-rose-300 space-y-0.5 max-h-16 overflow-y-auto">
                      <span className="font-semibold text-rose-400 block">Notices:</span>
                      {syncDataSummary.errors.map((err, idx) => (
                        <p key={`sync-data-err-${idx}`} className="truncate">• {err}</p>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {migrationError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center justify-between gap-2 overflow-hidden"
                >
                  <div className="flex items-center gap-2 truncate">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <span className="truncate">{migrationError}</span>
                  </div>
                  <button onClick={() => setMigrationError(null)} className="p-1 hover:bg-white/10 rounded cursor-pointer shrink-0">
                    <X className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                </motion.div>
              )}

              {migrationResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs space-y-2 text-emerald-200 overflow-hidden"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-emerald-500/20 gap-2">
                    <div className="flex items-center gap-1.5 text-emerald-300 font-bold truncate">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="truncate">Maintenance & Purge Complete</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={handleDownloadReport}
                        className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg text-[10px] font-semibold text-emerald-200 transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                        title="Download report TXT file"
                      >
                        <Download className="w-3 h-3 text-emerald-300" />
                        <span>Report .TXT</span>
                      </button>
                      <button 
                        onClick={() => setMigrationResult(null)}
                        className="p-1 hover:bg-emerald-500/20 rounded-md transition-all cursor-pointer text-neutral-400 hover:text-white"
                        title="Dismiss summary"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Compact stats pill strip */}
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-emerald-500/10 flex justify-between">
                      <span className="text-neutral-400">Logs Migrated:</span>
                      <strong className="text-emerald-300">{migrationResult?.logsMigrated ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-emerald-500/10 flex justify-between">
                      <span className="text-neutral-400">Logs Purged:</span>
                      <strong className="text-rose-300">{migrationResult?.logsPurgedFromFirestore ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-emerald-500/10 flex justify-between">
                      <span className="text-neutral-400">Settings Migrated:</span>
                      <strong className="text-emerald-300">{migrationResult?.settingsMigrated ?? 0}</strong>
                    </div>
                    <div className="bg-neutral-950/40 p-1.5 rounded-lg border border-emerald-500/10 flex justify-between">
                      <span className="text-neutral-400">Settings Purged:</span>
                      <strong className="text-rose-300">{migrationResult?.settingsPurgedFromFirestore ?? 0}</strong>
                    </div>
                  </div>

                  {migrationResult?.errors && migrationResult.errors.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-emerald-500/20 text-[9px] text-rose-300 space-y-0.5 max-h-16 overflow-y-auto">
                      <span className="font-semibold text-rose-400 block">Notices:</span>
                      {migrationResult.errors.map((err, idx) => (
                        <p key={`mig-res-err-${idx}`} className="truncate">• {err}</p>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        {/* AUTOMATED WEBSITE TEST REPORT SECTION */}
        <div id="test_report_section" className="w-full bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-8 relative shadow-2xl backdrop-blur-xl transition-all hover:border-white/15 overflow-hidden scroll-mt-24">
          
          {/* BACKGROUND AMBIENT GLOW */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

          {/* CARD HEADER & CONTROLS */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative z-10 pb-6 border-b border-white/10">
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-purple-500/15 border border-purple-500/30 rounded-2xl text-purple-400 shadow-inner shrink-0">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-serif font-bold text-white tracking-wide">Automated Website Test Report</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-mono tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Auto-Diagnostics Suite
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-1 font-mono">
                  Full-stack diagnostic runner testing storage, database connectivity, data integrity & browser APIs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {testReport && (testReport.warningCount > 0 || testReport.failedCount > 0) && (
                <button
                  onClick={handleCopyErrors}
                  className="px-3 py-2 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-xl text-xs font-semibold text-rose-300 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                  title="Copy error details to clipboard"
                >
                  {copiedErrors ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-rose-400" />}
                  <span>{copiedErrors ? 'Copied!' : 'Copy Errors'}</span>
                </button>
              )}

              {testReport && (
                <button
                  onClick={handleDownloadTestReport}
                  className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 border border-white/10 rounded-xl text-xs font-semibold text-neutral-200 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                  title="Download complete test report as TXT"
                >
                  <Download className="w-3.5 h-3.5 text-purple-400" />
                  <span>Report .TXT</span>
                </button>
              )}

              <button
                onClick={handleRunAutoTests}
                disabled={isRunningAutoTests}
                className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg transition-all duration-200 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRunningAutoTests ? 'animate-spin' : ''}`} />
                <span>{isRunningAutoTests ? 'Running Auto-Tests...' : 'Run Auto-Test Suite'}</span>
              </button>
            </div>
          </div>

          {/* TEST REPORT RESULTS BODY */}
          {isRunningAutoTests && !testReport ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin"></div>
                <Bug className="w-5 h-5 text-purple-400 absolute inset-0 m-auto" />
              </div>
              <p className="text-sm text-neutral-300 font-medium font-serif">Testing website modules & cloud connections...</p>
              <p className="text-xs text-neutral-500 font-mono">Running local storage, Firestore, Supabase & API checks</p>
            </div>
          ) : testReport ? (
            <div className="space-y-6 relative z-10">
              
              {/* SUMMARY STATS BANNER */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                
                {/* OVERALL STATUS */}
                <div className={`col-span-2 sm:col-span-3 lg:col-span-2 p-4 rounded-2xl border flex items-center gap-3.5 ${
                  testReport.overallStatus === 'passed'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : testReport.overallStatus === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                }`}>
                  <div className={`p-2.5 rounded-xl border shrink-0 ${
                    testReport.overallStatus === 'passed' ? 'bg-emerald-500/20 border-emerald-500/30' : testReport.overallStatus === 'warning' ? 'bg-amber-500/20 border-amber-500/30' : 'bg-rose-500/20 border-rose-500/30'
                  }`}>
                    {testReport.overallStatus === 'passed' ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    ) : testReport.overallStatus === 'warning' ? (
                      <AlertTriangle className="w-6 h-6 text-amber-400" />
                    ) : (
                      <XCircle className="w-6 h-6 text-rose-400" />
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider font-mono opacity-80">Overall Health</span>
                    <h3 className="text-base font-bold font-serif uppercase tracking-wide">
                      {testReport.overallStatus === 'passed' ? 'System Healthy' : testReport.overallStatus === 'warning' ? 'Passed with Warnings' : 'Critical Errors Detected'}
                    </h3>
                    <p className="text-[10px] font-mono mt-0.5 opacity-80">
                      Completed in {testReport.durationMs}ms ({testReport.timestamp})
                    </p>
                  </div>
                </div>

                {/* STAT: PASSED */}
                <div className="p-3.5 bg-neutral-950/50 border border-emerald-500/20 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-neutral-400 uppercase font-mono">Passed</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-xl font-bold text-emerald-400">{testReport.passedCount}</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500/60" />
                  </div>
                </div>

                {/* STAT: WARNINGS */}
                <div className="p-3.5 bg-neutral-950/50 border border-amber-500/20 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-neutral-400 uppercase font-mono">Warnings</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-xl font-bold text-amber-400">{testReport.warningCount}</span>
                    <AlertTriangle className="w-4 h-4 text-amber-500/60" />
                  </div>
                </div>

                {/* STAT: FAILURES */}
                <div className="p-3.5 bg-neutral-950/50 border border-rose-500/20 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-neutral-400 uppercase font-mono">Failures</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-xl font-bold text-rose-400">{testReport.failedCount}</span>
                    <XCircle className="w-4 h-4 text-rose-500/60" />
                  </div>
                </div>

                {/* STAT: TOTAL TESTS */}
                <div className="p-3.5 bg-neutral-950/50 border border-white/10 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-neutral-400 uppercase font-mono">Total Cases</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-xl font-bold text-purple-300">{testReport.totalTests}</span>
                    <FileCheck className="w-4 h-4 text-purple-400/60" />
                  </div>
                </div>

              </div>

              {/* SEARCH & FILTERS ROW */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={testSearchQuery}
                    onChange={(e) => setTestSearchQuery(e.target.value)}
                    placeholder="Search test names, categories or messages..."
                    className="w-full pl-9 pr-3 py-1.5 bg-neutral-900 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/50 font-mono"
                  />
                  {testSearchQuery && (
                    <button onClick={() => setTestSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-white/10 overflow-x-auto">
                  {(['all', 'passed', 'warning', 'failed'] as const).map((status, idx) => (
                    <button
                      key={`test-status-${status}-${idx}`}
                      onClick={() => setTestStatusFilter(status)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                        testStatusFilter === status
                          ? status === 'passed' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : status === 'warning' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : status === 'failed' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>

              </div>

              {/* CATEGORY FILTER STRIP */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px]">
                <span className="text-neutral-500 font-mono uppercase text-[9px] mr-1">Category:</span>
                {[
                  'all',
                  'Storage & Local State',
                  'Database & Cloud Services',
                  'Data Schema & Integrity',
                  'Browser & Runtime APIs',
                  'Component & Navigation'
                ].map((cat, idx) => (
                  <button
                    key={`test-cat-${cat}-${idx}`}
                    onClick={() => setTestCategoryFilter(cat)}
                    className={`px-2.5 py-1 rounded-xl border font-mono transition-all cursor-pointer whitespace-nowrap ${
                      testCategoryFilter === cat
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-semibold shadow-sm'
                        : 'bg-neutral-950/60 text-neutral-400 border-white/5 hover:border-white/15'
                    }`}
                  >
                    {cat === 'all' ? 'All Categories' : cat}
                  </button>
                ))}
              </div>

              {/* DETAILED TEST RESULTS LIST */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {(() => {
                  const filtered = testReport.results.filter(test => {
                    const matchesSearch = 
                      test.name.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
                      test.message.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
                      test.category.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
                      (test.details && test.details.toLowerCase().includes(testSearchQuery.toLowerCase()));
                    
                    const matchesStatus = testStatusFilter === 'all' || test.status === testStatusFilter;
                    const matchesCategory = testCategoryFilter === 'all' || test.category === testCategoryFilter;

                    return matchesSearch && matchesStatus && matchesCategory;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="py-8 text-center bg-neutral-950/40 rounded-2xl border border-white/5 text-neutral-500 text-xs font-mono">
                        No test results match the selected query or filters.
                      </div>
                    );
                  }

                  return filtered.map((test, idx) => {
                    const isExpanded = expandedTestId === test.id;
                    const isPassed = test.status === 'passed';
                    const isWarning = test.status === 'warning';

                    return (
                      <div 
                        key={`auto-test-row-${test.id}-${idx}`} 
                        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                          isPassed 
                            ? 'bg-neutral-950/40 border-white/5 hover:border-emerald-500/30'
                            : isWarning 
                            ? 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40'
                            : 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40'
                        }`}
                      >
                        {/* MAIN TEST ROW */}
                        <div 
                          onClick={() => setExpandedTestId(isExpanded ? null : test.id)}
                          className="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Status Icon */}
                            <div className="shrink-0">
                              {isPassed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : isWarning ? (
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-400" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-xs text-white truncate font-sans">
                                  {test.name}
                                </span>
                                <span className="px-2 py-0.2 rounded-md text-[9px] font-mono bg-white/5 text-neutral-400 border border-white/5">
                                  {test.category}
                                </span>
                              </div>
                              <p className={`text-[11px] mt-0.5 font-mono truncate ${
                                isPassed ? 'text-neutral-400' : isWarning ? 'text-amber-300' : 'text-rose-300'
                              }`}>
                                {test.message}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] font-mono text-neutral-500">
                              {test.durationMs}ms
                            </span>

                            <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-mono font-bold tracking-wider ${
                              isPassed 
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                : isWarning
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                            }`}>
                              {test.status}
                            </span>

                            {(test.details || test.remedy) && (
                              <div className="text-neutral-500 hover:text-white transition-colors">
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* EXPANDED ACCORDION DETAILS */}
                        <AnimatePresence>
                          {isExpanded && (test.details || test.remedy) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="px-3.5 pb-3.5 pt-1 border-t border-white/5 bg-black/40 text-xs space-y-2 overflow-hidden"
                            >
                              {test.details && (
                                <div>
                                  <span className="text-[10px] uppercase font-mono font-semibold text-neutral-400 block mb-0.5">
                                    Technical Diagnostics & Logs:
                                  </span>
                                  <pre className="p-2 bg-neutral-950 rounded-xl border border-white/5 text-[10px] font-mono text-purple-200 whitespace-pre-wrap overflow-x-auto">
                                    {test.details}
                                  </pre>
                                </div>
                              )}

                              {test.remedy && (
                                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 flex items-start gap-2 text-[11px]">
                                  <Bug className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                                  <div>
                                    <strong className="block font-semibold text-indigo-200">Suggested Action / Fix:</strong>
                                    <span>{test.remedy}</span>
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  });
                })()}
              </div>

            </div>
          ) : null}
        </div>

      </main>

      {/* MOBILE FLOATING ACTION BUTTON (Section Index for Mobile Views) */}
      <div className="lg:hidden fixed bottom-6 right-6 z-50">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsMobileNavOpen(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 rounded-full shadow-2xl border border-white/20 backdrop-blur-xl cursor-pointer text-xs font-bold"
        >
          <Compass className="w-4 h-4 text-white" />
          <span>Sections</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </motion.button>
      </div>

      {/* MOBILE FLOATING SECTION INDEX DRAWER MODAL */}
      <AnimatePresence>
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="w-full sm:max-w-md bg-neutral-900 border border-white/15 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-500/15 border border-indigo-500/30 rounded-xl text-indigo-400">
                    <Compass className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-serif font-bold text-white">Section Index Navigation</h3>
                    <p className="text-[10px] text-neutral-400 font-mono">Jump directly to any admin panel section</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileNavOpen(false)}
                  className="p-2 rounded-xl bg-white/5 text-neutral-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
                {SECTION_LIST.map((sec, idx) => {
                  const SecIcon = sec.icon;
                  const isActive = activeSectionId === sec.id;
                  return (
                    <button
                      key={`mobile-drawer-sec-${sec.id}-${idx}`}
                      type="button"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        const el = document.getElementById(sec.id);
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          setActiveSectionId(sec.id);
                        }
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl text-xs transition-all text-left cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-600/30 to-purple-600/20 border border-indigo-500/50 text-white font-bold'
                          : 'bg-neutral-950/40 text-neutral-300 hover:text-white border border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl border ${
                          isActive ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-neutral-900 border-white/10 text-indigo-400'
                        }`}>
                          <SecIcon className="w-4 h-4" />
                        </div>
                        <span className="font-medium text-xs">{sec.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isActive && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Active
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-neutral-500" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-white/5 bg-neutral-950/40 py-4 px-4">
        <p className="text-center text-xs text-neutral-500 font-mono">
          &copy; {new Date().getFullYear()} Iron House 🏋️. Admin Panel Console.
        </p>
      </footer>

      {/* CUSTOM CONFIRM DELETE MODAL */}
      <AnimatePresence>
        {userToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              {/* Decorative accent */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-indigo-500"></div>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-bold text-white">Delete User Account?</h3>
                  <p className="text-xs text-neutral-400 font-mono uppercase tracking-widest mt-0.5">Irreversible Action</p>
                </div>
              </div>

              <p className="text-sm text-neutral-300 leading-relaxed mb-6">
                Are you absolutely sure you want to delete <span className="text-indigo-300 font-semibold capitalize">"{userToDelete.username}"</span>? This will permanently remove their login access to Iron House.
              </p>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteUser(userToDelete)}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Permanently
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* GENERIC IN-APP CONFIRMATION DIALOG MODAL */}
        {confirmActionDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500"></div>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-bold text-white">{confirmActionDialog.title}</h3>
                  <p className="text-xs text-neutral-400 font-mono uppercase tracking-widest mt-0.5">
                    {confirmActionDialog.subtitle}
                  </p>
                </div>
              </div>

              <p className="text-sm text-neutral-300 leading-relaxed mb-6">
                {confirmActionDialog.message}
              </p>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  disabled={isConfirmActionRunning}
                  onClick={() => setConfirmActionDialog(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isConfirmActionRunning}
                  onClick={async () => {
                    setIsConfirmActionRunning(true);
                    try {
                      await confirmActionDialog.onConfirm();
                      setConfirmActionDialog(null);
                    } finally {
                      setIsConfirmActionRunning(false);
                    }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmActionDialog.confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ADD ADMIN MODAL */}
        {isAddingAdmin && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-serif font-bold text-white">Add New Admin Credential</h3>
                    <p className="text-[10px] text-neutral-400 font-mono">Create administrator login account</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAddingAdmin(false)}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddAdminAccount} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Admin Username</label>
                  <input
                    type="text"
                    value={newAdminUser}
                    onChange={(e) => setNewAdminUser(e.target.value)}
                    placeholder="e.g. admin_manager"
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Admin Password</label>
                  <input
                    type="password"
                    value={newAdminPass}
                    onChange={(e) => setNewAdminPass(e.target.value)}
                    placeholder="Password for admin login"
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Role Title</label>
                  <select
                    value={newAdminRole}
                    onChange={(e) => setNewAdminRole(e.target.value)}
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                  >
                    <option value="Super Admin">Super Admin</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Notes / Label (Optional)</label>
                  <input
                    type="text"
                    value={newAdminNotes}
                    onChange={(e) => setNewAdminNotes(e.target.value)}
                    placeholder="e.g. Primary backup admin"
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                  />
                </div>

                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingAdmin(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save Admin Credential
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* EDIT ADMIN MODAL */}
        {editingAdmin && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-serif font-bold text-white">Edit Admin Account</h3>
                    <p className="text-[10px] text-neutral-400 font-mono">Update username, password, or role</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingAdmin(null)}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUpdateAdminAccount} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Admin Username</label>
                  <input
                    type="text"
                    value={editAdminUser}
                    onChange={(e) => setEditAdminUser(e.target.value)}
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">New Password (Leave empty to keep current)</label>
                  <input
                    type="password"
                    value={editAdminPass}
                    onChange={(e) => setEditAdminPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Role Title</label>
                  <select
                    value={editAdminRole}
                    onChange={(e) => setEditAdminRole(e.target.value)}
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                  >
                    <option value="Super Admin">Super Admin</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Notes / Label</label>
                  <input
                    type="text"
                    value={editAdminNotes}
                    onChange={(e) => setEditAdminNotes(e.target.value)}
                    placeholder="e.g. Primary admin account"
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/60"
                  />
                </div>

                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingAdmin(null)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Update Admin
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* DELETE ADMIN CONFIRMATION MODAL */}
        {adminToDelete && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-indigo-500"></div>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-bold text-white">Delete Admin Credential?</h3>
                  <p className="text-xs text-neutral-400 font-mono uppercase tracking-widest mt-0.5">Revoke Portal Access</p>
                </div>
              </div>

              <p className="text-sm text-neutral-300 leading-relaxed mb-6">
                Are you sure you want to delete admin account <span className="text-indigo-300 font-semibold">"{adminToDelete.username}"</span>? They will no longer be able to log in to the admin portal.
              </p>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setAdminToDelete(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteAdminAccount(adminToDelete)}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Admin Account
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SUPABASE SCHEMA FIX SQL MODAL */}
      <AnimatePresence>
        {showSqlSetupModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-white">
                  <Database className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-serif font-bold text-lg">Supabase Schema Fix SQL</h3>
                </div>
                <button
                  onClick={() => setShowSqlSetupModal(false)}
                  className="p-1 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed">
                Copy and execute this complete script in your <strong className="text-indigo-300">Supabase Dashboard → SQL Editor</strong> to create all critical tables (including <code className="text-indigo-200 bg-white/5 px-1 py-0.5 rounded font-mono">celebration_cards</code>, <code className="text-indigo-200 bg-white/5 px-1 py-0.5 rounded font-mono">user_accounts</code>, <code className="text-indigo-200 bg-white/5 px-1 py-0.5 rounded font-mono">letters</code>, <code className="text-indigo-200 bg-white/5 px-1 py-0.5 rounded font-mono">memories</code>, <code className="text-indigo-200 bg-white/5 px-1 py-0.5 rounded font-mono">date_plans</code>, etc.) and storage buckets in one click:
              </p>

              <div className="relative">
                <pre className="bg-neutral-950 p-4 rounded-2xl border border-white/10 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-80 leading-relaxed">
{SUPABASE_SCHEMA_FIX_SQL}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(SUPABASE_SCHEMA_FIX_SQL);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2000);
                  }}
                  className="absolute top-3 right-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <FileText className="w-3.5 h-3.5" />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShowSqlSetupModal(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* TWO-FACTOR AUTHENTICATION (TOTP) SETUP MODAL */}
      <AnimatePresence>
        {twoFactorModalAccount && (
          <TwoFactorSetupModal
            isOpen={!!twoFactorModalAccount}
            onClose={() => setTwoFactorModalAccount(null)}
            username={twoFactorModalAccount.username}
            isAlreadyEnabled={twoFactorModalAccount.enabled}
            currentSecret={twoFactorModalAccount.secret}
            currentBackupCodes={twoFactorModalAccount.backupCodes}
            onSave2FA={handleSave2FA}
            onDisable2FA={handleDisable2FA}
          />
        )}
      </AnimatePresence>

    </div>
  );
};

export default AdminPanel;
