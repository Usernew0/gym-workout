export interface UserAccount {
  id: string;
  username: string;
  password?: string;
  role?: string;
  gender?: 'male' | 'female' | 'other' | string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string[];
  twoFactorCreatedAt?: string;
  telegramUsername?: string;
  telegramChatId?: string;
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
  notifyMilestones?: boolean;
  notifyDates?: boolean;
  notifyLetters?: boolean;
  notifyChat?: boolean;
  notifyCards?: boolean;
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
  whitelistedUsernames: [],
  authorizedUsers: [],
  capturedSenders: [],
  autoSyncProfiles: true,
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
  name: string;      // Exercise name
  sets?: string;     // Number of sets (e.g. "3" or "3-4")
  reps?: string;     // Repetitions (e.g. "12" or "10-12")
  notes?: string;    // Coach notes / form cues
  videoUrl?: string; // Demo video link
}

export interface WorkoutPlan {
  id: string;
  ownerUsername: string;         // The gym member this plan belongs to (data isolation key)
  title: string;
  description?: string;
  weeks: number;                 // Optional repeatable duration in weeks (>= 1)
  exercises: WorkoutExercise[];
  sourceFileName?: string;       // Original uploaded sheet file name
  createdBy: string;             // Username that created/uploaded the plan
  assignedByAdmin?: boolean;     // true when an admin uploaded & assigned the plan
  progress?: { [weekKey: string]: string[] }; // weekKey (e.g. "w1") -> completed exercise IDs
  createdAt: string;
  updatedAt?: string;
}
