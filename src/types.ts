export interface UserAccount {
  id: string;
  username: string;
  displayName?: string;
  password?: string;
  role?: string;
  gender?: 'male' | 'female' | 'other' | string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorCreatedAt?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  telegramNotificationsEnabled?: boolean;
  weightUnitPreference?: WeightUnit;
  waterIntake?: {
    date: string;
    glasses: number;
    updatedAt?: string;
    reminderEnabled?: boolean;
    reminderIntervalMinutes?: number;
  };
}

export interface AdminAccount {
  id: string;
  username: string;
  password?: string;
  role?: string;
  createdAt?: string;
  lastLogin?: string;
  notes?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorCreatedAt?: string;
}

export interface TelegramCapturedSender {
  chatId: string;
  username: string; // e.g. '@ebrahimayman' or ''
  firstName: string;
  lastName?: string;
  text: string;
  date: number;
  timestamp: string;
  isConfirmedCommand?: boolean;
}

export interface TelegramAuthorizedUser {
  id: string;
  telegramUsername: string; // e.g. '@ebrahimayman'
  chatId?: string; // numeric chat ID
  appUsername?: string; // e.g. 'mariem' or 'ebrahim'
  confirmed: boolean; // true once user has confirmed via the bot
  confirmedAt?: string;
  lastNotifiedAt?: string;
  isActive: boolean; // toggle delivery for this specific user
  role?: 'partner' | 'admin' | 'guest';
}

export interface TelegramAlertOptions {
  targetUsername?: string; // Delivers specifically to this single user account / telegram handle
  excludeUsername?: string; // Excludes sender from receiving their own alert (e.g. sender of chat or letter)
  adminSettings?: AdminSetting[];
  customConfig?: TelegramConfig;
  userAccounts?: UserAccount[];
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  notifySecurity: boolean;
  notifyWater?: boolean;
  waterReminderMinutes?: number;
  lastTestedAt?: string;
  whitelistedUsernames?: string[]; // e.g. ['@ebrahimayman', '@mariem']
  authorizedUsers?: TelegramAuthorizedUser[]; // Multi-user confirmed access registry
  capturedSenders?: TelegramCapturedSender[]; // Recent senders & messages detected from bot
  autoSyncProfiles?: boolean; // automatically sync telegram usernames from user profiles into whitelist
  webhookUrl?: string; // e.g. https://domain.vercel.app/api/telegram/webhook
  webhookEnabled?: boolean;
  webhookLastCheckedAt?: string;
  webhookStatusMessage?: string;
}

export interface TelegramDiagnosticReport {
  success: boolean;
  latencyMs: number;
  error?: string;
  checks: {
    tokenProvided: boolean;
    apiReachable: boolean;
    botAuthenticated: boolean;
    webhookHealthy: boolean;
  };
  bot?: {
    id: number | string;
    username: string;
    firstName: string;
    canJoinGroups?: boolean;
  };
  webhook?: {
    url?: string;
    pendingUpdateCount?: number;
    lastErrorMessage?: string;
  };
  testMessageSent: boolean;
  testMessageDelivered: boolean;
  testMessageError?: string;
  rawTelegramResponse?: any;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  enabled: false,
  notifySecurity: true,
  notifyWater: true,
  waterReminderMinutes: 60,
  whitelistedUsernames: [],
  authorizedUsers: [],
  capturedSenders: [],
  autoSyncProfiles: false,
  webhookUrl: '',
  webhookEnabled: false
};

export interface AdminSetting {
  id: string;
  password?: string;
  username?: string;
  adminAccounts?: AdminAccount[];
  favicon?: string;
  autoLogoutMinutes?: number;
  autoLogoutEnabled?: boolean;
  loginLockoutSeconds?: number;
  loginMaxAttempts?: number;
  telegramConfig?: TelegramConfig;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorCreatedAt?: string;
}

export interface UserActivityLog {
  id: string;
  username: string;
  action: string;
  details: string;
  timestamp: string;
}

// ==========================================
// GYM / WORKOUT MODELS
// ==========================================

export interface WorkoutExercise {
  id: string;
  name: string;           // Exercise name
  day?: string;           // Linked day / section header (e.g. "Day 1 - Push")
  sets?: string;          // Number of sets (e.g. "4")
  reps?: string;          // Repetitions (e.g. "5-12")
  targetRpe?: string;     // Target / prescribed RPE from uploaded sheet or coach (e.g. "8", "7-8")
  notes?: string;         // Coach notes / form cues
  videoUrl?: string;      // Demo video link
  isSuperset?: boolean;   // Highlighted as superset exercise
  supersetGroup?: string; // Optional superset group label (e.g. "SS1", "A1")
}

export type WeightUnit = 'kg' | 'lbs';

export interface SetLogEntry {
  setNumber: number; // 1, 2, 3...
  weight: string;    // Weight lifted (e.g. "80")
  unit?: WeightUnit; // Weight unit ("kg" or "lbs")
  reps: string;      // Reps completed (e.g. "10")
  rpe?: string;      // Rate of Perceived Exertion (e.g. "8", "8.5")
}

export interface ExerciseLogEntry {
  sets?: string;
  reps?: string;
  weight?: string;
  unit?: WeightUnit;
  setEntries?: SetLogEntry[]; // Per-set weight (with unit), reps & RPE log
  notes?: string;
  noteEnabled?: boolean;      // Checkbox toggle state for this exercise + week note
  day?: string;
  updatedAt?: string;
}

export interface WarmupExercise {
  id: string;
  name: string;
  minutes?: string;     // Dedicated warm-up duration in minutes (e.g. "5")
  targetSets?: string;  // Structured target set count (e.g. "2")
  target?: string;      // Optional reps/cue or legacy combined target (e.g. "12 reps", "2 x 12")
  notes?: string;
}

export interface WarmupLogEntry {
  completed?: boolean;
  minutesCompleted?: string;    // Optional logged duration in minutes
  setEntries?: SetLogEntry[];   // Separate warm-up sets (weight, unit, reps, rpe)
  notes?: string;
  updatedAt?: string;
}

export interface WorkoutPlan {
  id: string;
  ownerUsername: string;         // The gym member this plan belongs to (data isolation key)
  title: string;
  description?: string;
  instructions?: string;         // Extracted from Information / Instructions sheet tab
  sheetName?: string;            // Original Excel sheet tab name
  defaultWeightUnit?: WeightUnit;// Preferred default weight unit ('kg' or 'lbs')
  weeks: number;                 // Optional repeatable duration in weeks (>= 1)
  warmupExercises?: WarmupExercise[]; // Dedicated warm-up exercises at the top of the plan
  warmupLogs?: { [weekKey: string]: { [warmupId: string]: WarmupLogEntry } }; // Separate warm-up set logs per week
  exercises: WorkoutExercise[];
  sourceFileName?: string;       // Original uploaded sheet file name
  createdBy: string;             // Username that created/uploaded the plan
  assignedByAdmin?: boolean;     // true when an admin uploaded & assigned the plan
  progress?: { [weekKey: string]: string[] }; // weekKey (e.g. "w1") -> completed exercise IDs
  exerciseLogs?: { [weekKey: string]: { [exerciseId: string]: ExerciseLogEntry } }; // Logged sets, weights (kg/lbs), reps, RPE & notes per week/exercise
  previousLogs?: { [exerciseId: string]: ExerciseLogEntry }; // Last recorded performance snapshot before current edit
  createdAt: string;
  updatedAt?: string;
}
