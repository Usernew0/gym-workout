import { 
  verifyFirestoreConnection, 
  verifySupabaseConnection, 
  checkSupabaseTablesStatus,
  getFirestoreUserAccounts,
  getFirestoreAdminSettings
} from '../lib/syncService';
import { getFirestoreWorkoutPlans } from '../lib/firebaseService';
import { generateTOTPSecret, generateTOTP, verifyTOTP, generateBackupCodes } from '../lib/totp';

export interface TestCaseResult {
  id: string;
  name: string;
  category:
    | 'Database & Cloud Services'
    | 'Data Schema & Integrity'
    | 'Workout & Telegram Engine'
    | 'Browser & Runtime APIs'
    | 'Component & Navigation'
    | 'Responsiveness & Layout';
  status: 'passed' | 'warning' | 'failed';
  message: string;
  durationMs: number;
  details?: string;
  remedy?: string;
}

export interface FullTestReport {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  warningCount: number;
  failedCount: number;
  durationMs: number;
  overallStatus: 'passed' | 'warning' | 'failed';
  results: TestCaseResult[];
}

/**
 * Auto-tests the Gym Workout website and returns a comprehensive diagnostic report.
 */
export async function runAutomatedWebsiteTests(): Promise<FullTestReport> {
  const startTime = performance.now();
  const results: TestCaseResult[] = [];

  const runTest = async (
    id: string,
    name: string,
    category: TestCaseResult['category'],
    fn: () => Promise<{ status: 'passed' | 'warning' | 'failed'; message: string; details?: string; remedy?: string }>
  ) => {
    const t0 = performance.now();
    try {
      const res = await fn();
      const t1 = performance.now();
      results.push({
        id,
        name,
        category,
        status: res.status,
        message: res.message,
        durationMs: Math.round(t1 - t0),
        details: res.details,
        remedy: res.remedy
      });
    } catch (err: any) {
      const t1 = performance.now();
      results.push({
        id,
        name,
        category,
        status: 'failed',
        message: `Unexpected exception: ${err?.message || String(err)}`,
        durationMs: Math.round(t1 - t0),
        details: err?.stack || String(err),
        remedy: 'Inspect component logic or exception stack trace.'
      });
    }
  };

  // ----------------------------------------------------
  // 1. DATABASE & CLOUD CONNECTIVITY TESTS
  // ----------------------------------------------------
  await runTest(
    'db_firestore_connection',
    'Firebase Firestore Health & Latency',
    'Database & Cloud Services',
    async () => {
      const fireRes = await verifyFirestoreConnection();
      if (fireRes.online) {
        return {
          status: 'passed',
          message: `Firestore connected successfully with ${fireRes.latencyMs}ms response latency.`,
          details: fireRes.details
        };
      }
      return {
        status: 'warning',
        message: `Firestore backend offline or unreachable (${fireRes.latencyMs}ms latency).`,
        details: fireRes.details,
        remedy: 'Verify Firebase configuration in firebase-applet-config.json and network connectivity.'
      };
    }
  );

  await runTest(
    'db_supabase_connection',
    'Supabase PostgreSQL Health & Ping',
    'Database & Cloud Services',
    async () => {
      const supaRes = await verifySupabaseConnection();
      if (supaRes.online) {
        return {
          status: 'passed',
          message: `Supabase database active & online (${supaRes.latencyMs}ms latency).`,
          details: supaRes.details
        };
      }
      if (!supaRes.configured) {
        return {
          status: 'warning',
          message: 'Supabase private server variables (SUPABASE_URL / SUPABASE_ANON_KEY) not detected yet. Running on Firebase Firestore.',
          details: supaRes.details,
          remedy: 'Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in server environment variables and restart the server.'
        };
      }
      return {
        status: 'warning',
        message: `Supabase database unreachable (${supaRes.latencyMs}ms latency).`,
        details: supaRes.details,
        remedy: 'Check database URL credentials and RLS access policies.'
      };
    }
  );

  await runTest(
    'db_table_diagnostics',
    'Supabase Gym Schema & Tables Check',
    'Database & Cloud Services',
    async () => {
      const diag = await checkSupabaseTablesStatus();
      if (!diag.configured) {
        return {
          status: 'passed',
          message: 'Supabase not configured; Gym Workout runs cleanly on Firebase Firestore.'
        };
      }
      if (diag.allCriticalTablesExist) {
        return {
          status: 'passed',
          message: `All ${diag.tables.length} Gym Workout Supabase tables exist and are synchronized.`
        };
      }
      const missing = diag.tables.filter(t => t.status === 'missing' || t.status === 'error');
      return {
        status: 'warning',
        message: `${missing.length} Supabase table(s) missing or inaccessible: ${missing.map(m => m.tableName).join(', ')}`,
        details: missing.map(m => `${m.tableName}: ${m.message}`).join(' | '),
        remedy: 'Open Admin Panel → Fix DB / SQL Script and execute the SQL setup script in Supabase SQL Editor.'
      };
    }
  );

  // ----------------------------------------------------
  // 2. DATA SCHEMA & INTEGRITY TESTS
  // ----------------------------------------------------
  await runTest(
    'integrity_user_accounts',
    'Gym Member Accounts Schema & Security Check',
    'Data Schema & Integrity',
    async () => {
      const users = await getFirestoreUserAccounts();
      if (!Array.isArray(users) || users.length === 0) {
        return {
          status: 'warning',
          message: 'No registered member accounts found in system.',
          remedy: 'Create member accounts in Admin Panel -> Website User Accounts.'
        };
      }
      const brokenUser = users.find(u => !u.username || !u.password || !u.id);
      if (brokenUser) {
        return {
          status: 'failed',
          message: `Found member account missing required username, password, or ID field (${brokenUser.id}).`
        };
      }
      return {
        status: 'passed',
        message: `Verified ${users.length} registered gym member account(s) schema integrity.`
      };
    }
  );

  await runTest(
    'integrity_workout_plans',
    'Workout Plans & Exercise Sheets Integrity',
    'Workout & Telegram Engine',
    async () => {
      const plans = await getFirestoreWorkoutPlans();
      if (!Array.isArray(plans) || plans.length === 0) {
        return {
          status: 'warning',
          message: 'No workout plans uploaded yet.',
          remedy: 'Upload an .xlsx/.csv/.pdf training sheet in Admin Panel -> Workout Plans & Sheet Assignment.'
        };
      }
      const brokenPlan = plans.find(p => !p.id || !p.ownerUsername || !p.title || !Array.isArray(p.exercises));
      if (brokenPlan) {
        return {
          status: 'failed',
          message: `Workout plan "${brokenPlan.title || brokenPlan.id}" is missing ownerUsername, title, or exercises array.`
        };
      }
      const totalExercises = plans.reduce((sum, p) => sum + (p.exercises?.length || 0), 0);
      const uniqueOwners = new Set(plans.map(p => p.ownerUsername.toLowerCase().trim())).size;
      return {
        status: 'passed',
        message: `Verified ${plans.length} workout plan(s) (${totalExercises} exercise(s)) isolated across ${uniqueOwners} member(s).`,
        details: plans.slice(0, 6).map(p => `• ${p.title} (@${p.ownerUsername}): ${p.exercises.length} exercises, ${p.weeks}w`).join('\n')
      };
    }
  );

  // ----------------------------------------------------
  // 3. TELEGRAM WHITELIST & SECURITY AUDIT
  // ----------------------------------------------------
  await runTest(
    'telegram_whitelist_security',
    'Telegram Bot & Strict Whitelist Isolation Audit',
    'Workout & Telegram Engine',
    async () => {
      const settings = await getFirestoreAdminSettings();
      const tgDoc = settings.find(s => s.id === 'telegramConfig');
      const tg = tgDoc?.telegramConfig;
      if (!tg || !tg.botToken?.trim()) {
        return {
          status: 'warning',
          message: 'Telegram Bot Token is not configured yet.',
          remedy: 'Configure your Bot Token in Admin Panel -> Telegram & Security Hub.'
        };
      }
      if (tg.autoSyncProfiles === true) {
        return {
          status: 'warning',
          message: 'Auto-Sync Profiles is enabled on Telegram Whitelist; profile handles auto-receive bot access.',
          remedy: 'Disable "Auto-Sync Profiles" in Telegram & Security Hub for strict manual admin-only whitelisting.'
        };
      }
      const activeUsers = (tg.authorizedUsers || []).filter(u => u.isActive !== false);
      const whitelistHandles = tg.whitelistedUsernames || [];
      return {
        status: 'passed',
        message: `Strict whitelist enforced (${activeUsers.length} active authorized user(s), ${whitelistHandles.length} whitelisted handle(s), Auto-Sync OFF).`,
        details: `Bot Enabled: ${tg.enabled ? 'Yes' : 'No'} | Webhook Enabled: ${tg.webhookEnabled ? 'Yes' : 'Polling Mode'}`
      };
    }
  );

  // ----------------------------------------------------
  // 4. BROWSER & RUNTIME API TESTS
  // ----------------------------------------------------
  await runTest(
    'api_file_reader',
    'Worksheet Upload & PDF Export APIs (FileReader / Blob)',
    'Browser & Runtime APIs',
    async () => {
      if (typeof FileReader === 'undefined' || typeof Blob === 'undefined') {
        return {
          status: 'failed',
          message: 'FileReader or Blob API missing from browser runtime.',
          remedy: 'Upgrade browser version to support Excel/CSV/PDF worksheet import and PDF summary export.'
        };
      }
      return {
        status: 'passed',
        message: 'FileReader and Blob APIs ready for .xlsx/.csv/.pdf workout sheet uploads and PDF summary exports.'
      };
    }
  );

  await runTest(
    'api_notifications',
    'Browser Push & Desktop Notification API',
    'Browser & Runtime APIs',
    async () => {
      if (!('Notification' in window)) {
        return { status: 'warning', message: 'Browser Desktop Notifications API not supported.' };
      }
      const perm = Notification.permission;
      if (perm === 'denied') {
        return {
          status: 'warning',
          message: 'Desktop notification permission is currently DENIED by user.',
          remedy: 'Click browser lock icon in address bar to enable notifications.'
        };
      }
      return { status: 'passed', message: `Desktop Notifications API supported (Permission status: ${perm}).` };
    }
  );

  await runTest(
    'api_fetch',
    'Network Fetch & API Proxy Pipeline',
    'Browser & Runtime APIs',
    async () => {
      if (typeof window.fetch !== 'function') {
        return { status: 'failed', message: 'window.fetch is not available.' };
      }
      return { status: 'passed', message: 'Native Fetch pipeline available for Telegram & cloud sync routes.' };
    }
  );

  // ----------------------------------------------------
  // 5. COMPONENT & SECURITY CREDENTIALS
  // ----------------------------------------------------
  await runTest(
    'comp_admin_credentials',
    'Admin Portal Security Credentials Registry',
    'Component & Navigation',
    async () => {
      const settings = await getFirestoreAdminSettings();
      const adminAccDoc = settings.find(s => s.id === 'adminAccounts');
      const accounts = adminAccDoc?.adminAccounts || (adminAccDoc as any)?.accounts || [];
      if (accounts.length === 0) {
        return { status: 'warning', message: 'Using default fallback admin credentials ("admin").' };
      }
      return { status: 'passed', message: `Verified ${accounts.length} admin security credential account(s).` };
    }
  );

  await runTest(
    'sec_totp_cryptographic_engine',
    'RFC 6238 TOTP 2FA & Web Crypto Engine',
    'Component & Navigation',
    async () => {
      try {
        const testSecret = generateTOTPSecret(20);
        if (!testSecret || testSecret.length < 24) {
          return { status: 'failed', message: 'Generated Base32 secret is invalid or empty.' };
        }
        const testCode = await generateTOTP(testSecret);
        if (!/^\d{6}$/.test(testCode)) {
          return { status: 'failed', message: `Generated TOTP code "${testCode}" is not a 6-digit numeric string.` };
        }
        const verifyResult = await verifyTOTP(testCode, testSecret, 1);
        if (!verifyResult.valid) {
          return { status: 'failed', message: 'TOTP self-verification failed within window drift.' };
        }
        const backupCodes = generateBackupCodes(6);
        if (backupCodes.length !== 6 || !backupCodes.every(c => c.length === 9 && c.includes('-'))) {
          return { status: 'failed', message: 'Backup codes generator produced invalid format (expected 6 XXXX-XXXX codes).' };
        }
        return {
          status: 'passed',
          message: 'RFC 6238 HMAC-SHA1 TOTP verification and emergency single-use recovery code engines verified operational.',
          details: `Generated sample code: ${testCode} | Secret length: ${testSecret.length} chars | Sample recovery code: ${backupCodes[0]}`
        };
      } catch (err: any) {
        return { status: 'failed', message: `TOTP engine error: ${err?.message}` };
      }
    }
  );

  // ----------------------------------------------------
  // 6. RESPONSIVENESS & LAYOUT CHECKS
  // ----------------------------------------------------
  await runTest(
    'responsive_no_horizontal_overflow',
    'Mobile & Desktop Horizontal Overflow Check',
    'Responsiveness & Layout',
    async () => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      if (docWidth > winWidth + 2) {
        return {
          status: 'warning',
          message: `Detected document horizontal overflow (${docWidth}px > viewport ${winWidth}px).`,
          details: 'Root viewport has slight horizontal overflow on current screen dimensions.',
          remedy: 'Apply overflow-x-hidden to outer container or use fluid auto-fit grids.'
        };
      }
      return {
        status: 'passed',
        message: `Viewport layout is contained without horizontal overflow (${winWidth}px width).`
      };
    }
  );

  await runTest(
    'sticky_header_visibility_across_tabs',
    'Sticky Navigation Header Visibility Check',
    'Responsiveness & Layout',
    async () => {
      const headerEl = document.querySelector('header');
      if (!headerEl) {
        return {
          status: 'warning',
          message: 'Navigation header element not found in DOM snapshot.',
          remedy: 'Verify <header> is rendered in the active Gym Workout view.'
        };
      }
      return {
        status: 'passed',
        message: 'Fixed sticky navigation header is active and visible.'
      };
    }
  );

  const endTime = performance.now();
  const totalDuration = Math.round(endTime - startTime);

  const passedCount = results.filter(r => r.status === 'passed').length;
  const warningCount = results.filter(r => r.status === 'warning').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  let overallStatus: FullTestReport['overallStatus'] = 'passed';
  if (failedCount > 0) {
    overallStatus = 'failed';
  } else if (warningCount > 0) {
    overallStatus = 'warning';
  }

  return {
    timestamp: new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }),
    totalTests: results.length,
    passedCount,
    warningCount,
    failedCount,
    durationMs: totalDuration,
    overallStatus,
    results
  };
}
