import React, { useState, useEffect, Suspense, lazy } from 'react';

// Initial unauthenticated login shell (eager)
import { Login } from './components/Login';
import { ErrorBoundary } from './components/ErrorBoundary';

import { sendTelegramAlert, formatSecurityAlertTelegramMessage } from './lib/telegramService';
import { UserAccount, AdminSetting, AdminAccount } from './types';
import {
  subscribeToUserAccounts,
  subscribeToAdminSettings,
  saveAdminSettingDoc,
  getFirestoreAdminSettings,
  logActivity
} from './lib/syncService';
import { createSessionToken, verifySessionToken, getClientIp, hashPassword } from './utils/crypto';

// Default bootstrap admin, seeded once on a brand-new empty database.
// The password MUST be changed immediately from Admin Portal Credentials.
const BOOTSTRAP_ADMIN_USERNAME = 'admin';
const BOOTSTRAP_ADMIN_PASSWORD = 'admin123123';

// Resilient dynamic import helper with automatic retry and stale-chunk recovery
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T } | { [key: string]: any }>,
  componentName?: string,
  retries = 3,
  interval = 800
): React.LazyExoticComponent<T> {
  return lazy(() => {
    return new Promise<{ default: T }>((resolve, reject) => {
      const attempt = (remaining: number) => {
        factory()
          .then((module: any) => {
            if (module && module.default) {
              resolve({ default: module.default });
            } else if (componentName && module && module[componentName]) {
              resolve({ default: module[componentName] });
            } else if (module) {
              const namedExport = Object.values(module).find((exp) => typeof exp === 'function') as T;
              if (namedExport) {
                resolve({ default: namedExport });
              } else {
                resolve({ default: module as unknown as T });
              }
            } else {
              reject(new Error(`Failed to resolve component export from module.`));
            }
          })
          .catch((error) => {
            console.warn(`[DynamicImport] Retry ${retries - remaining + 1}/${retries} for ${componentName || 'component'}:`, error);
            if (remaining > 0) {
              setTimeout(() => attempt(remaining - 1), interval);
            } else {
              const isChunkOrFetchError =
                error?.message?.includes('dynamically imported module') ||
                error?.message?.includes('Failed to fetch') ||
                error?.name === 'ChunkLoadError' ||
                error?.name === 'TypeError';

              const sessionKey = 'app_chunk_retry_key';
              const hasAutoReloaded = sessionStorage.getItem(sessionKey);
              if (isChunkOrFetchError && !hasAutoReloaded) {
                sessionStorage.setItem(sessionKey, Date.now().toString());
                window.location.reload();
                return;
              }
              sessionStorage.removeItem(sessionKey);
              reject(error);
            }
          });
      };
      attempt(retries);
    });
  });
}

const GymApp = lazyWithRetry(() => import('./components/gym/GymApp'), 'GymApp');
const AdminPanel = lazyWithRetry(() => import('./components/AdminPanel'), 'AdminPanel');

const ViewLoadingFallback = () => (
  <div className="min-h-screen bg-black flex items-center justify-center text-white">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-neutral-400 font-sans tracking-wide">Loading training space...</span>
    </div>
  </div>
);

export default function App() {
  // Auth states
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);

  // Data — hydrated from Firestore + Supabase via the realtime subscriptions below.
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>([]);
  const [adminSettings, setAdminSettings] = useState<AdminSetting[]>([]);

  // Dynamic favicon & document title
  useEffect(() => {
    const faviconDoc = adminSettings.find(s => s.id === 'websiteFavicon');
    const faviconUrl = faviconDoc?.favicon || "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏋️</text></svg>";
    document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']").forEach(el => el.remove());
    const linkIcon = document.createElement('link');
    linkIcon.rel = 'icon';
    linkIcon.href = faviconUrl;
    document.head.appendChild(linkIcon);
    const linkShortcut = document.createElement('link');
    linkShortcut.rel = 'shortcut icon';
    linkShortcut.href = faviconUrl;
    document.head.appendChild(linkShortcut);
  }, [adminSettings]);

  useEffect(() => {
    document.title = 'Gym Workout';
  }, []);

  // First-run bootstrap: seed a default admin account only when the database has
  // no admin credentials at all (fresh install / new Firebase project).
  useEffect(() => {
    let cancelled = false;

    const seedIfNoAdmin = async () => {
      const settings = await getFirestoreAdminSettings();
      const hasAdminAccounts = settings.some(
        s => s.id === 'adminAccounts' && Array.isArray(s.adminAccounts) && s.adminAccounts.length > 0
      );
      const hasLegacyCreds = settings.some(s => s.id === 'credentials' && !!s.username);
      if (hasAdminAccounts || hasLegacyCreds || cancelled) return;

      const hashedPassword = await hashPassword(BOOTSTRAP_ADMIN_PASSWORD);
      const defaultAdmin: AdminAccount = {
        id: 'admin_primary',
        username: BOOTSTRAP_ADMIN_USERNAME,
        password: hashedPassword,
        role: 'Super Admin',
        createdAt: new Date().toISOString(),
        notes: 'Default bootstrap admin — change this password in Admin Portal Credentials.'
      };

      await saveAdminSettingDoc({ id: 'adminAccounts', adminAccounts: [defaultAdmin] } as AdminSetting);
      await saveAdminSettingDoc({ id: 'credentials', username: BOOTSTRAP_ADMIN_USERNAME, password: hashedPassword } as AdminSetting);
      logActivity(
        BOOTSTRAP_ADMIN_USERNAME,
        'admin_credentials_updated',
        'Created default bootstrap admin account. Change the password in Admin Portal Credentials.'
      ).catch(() => {});
    };

    // Give Firestore a moment to deliver any existing settings before seeding.
    const timer = setTimeout(seedIfNoAdmin, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Session restore + system config subscriptions
  useEffect(() => {
    const checkSession = async () => {
      const savedLogin = localStorage.getItem('love_app_is_logged_in');
      const sessionToken = localStorage.getItem('love_app_session_token');

      if (savedLogin === 'true') {
        const verifyResult = await verifySessionToken(sessionToken);
        if (verifyResult.valid && verifyResult.username) {
          setIsLoggedIn(true);
          setCurrentUser(verifyResult.username);
        } else {
          console.warn("[Security Alert] Session token check failed:", verifyResult.reason);
          setIsLoggedIn(false);
          setCurrentUser('');
          localStorage.removeItem('love_app_is_logged_in');
          localStorage.removeItem('love_app_session_token');
          localStorage.removeItem('love_app_username');
          setLogoutMessage("Session expired or unauthorized token detected. Please sign in securely.");

          getClientIp().then(ip => {
            const detailMsg = `Attempted unauthorized session bypass via modified browser storage. IP: ${ip} | Reason: ${verifyResult.reason}`;
            logActivity('Unauthorized Client', 'security_tamper_attempt', detailMsg).catch(() => {});
            sendTelegramAlert(
              formatSecurityAlertTelegramMessage('Unauthorized Client', 'security_tamper_attempt', detailMsg),
              'security',
              adminSettings
            ).catch(() => {});
          });
        }
      }
    };
    checkSession();

    let unsubUserAccounts = () => {};
    let unsubAdminSettings = () => {};

    const timer = setTimeout(() => {
      unsubUserAccounts = subscribeToUserAccounts((data) => setUserAccounts(data));
      unsubAdminSettings = subscribeToAdminSettings((data) => setAdminSettings(data));
    }, 50);

    return () => {
      clearTimeout(timer);
      unsubUserAccounts();
      unsubAdminSettings();
    };
  }, []);

  const handleLoginSuccess = async (username: string) => {
    setLogoutMessage(null);
    setIsLoggedIn(true);
    setCurrentUser(username);
    const token = await createSessionToken(username);
    localStorage.setItem('love_app_session_token', token);
    localStorage.setItem('love_app_is_logged_in', 'true');
    localStorage.setItem('love_app_username', username);
    logActivity(username, 'login', 'Logged into the gym website successfully.');
  };

  const handleLogout = () => {
    const userBeforeLogout = currentUser;
    setIsLoggedIn(false);
    setCurrentUser('');
    localStorage.removeItem('love_app_is_logged_in');
    localStorage.removeItem('love_app_session_token');
    localStorage.removeItem('love_app_username');
    if (userBeforeLogout) {
      logActivity(userBeforeLogout, 'logout', 'Logged out of the gym website.');
    }
  };

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} userAccounts={userAccounts} adminSettings={adminSettings} logoutMessage={logoutMessage} />;
  }

  // Intercept and render AdminPanel if the user matches any admin username from the database
  const adminAccountsDoc = adminSettings.find(s => s.id === 'adminAccounts');
  const adminAccounts = adminAccountsDoc?.adminAccounts || [];
  const adminCreds = adminSettings.find(s => s.id === 'credentials');
  const currentCleanUser = (currentUser || '').toLowerCase().trim();

  const isAdmin =
    adminAccounts.some(a => a.username.toLowerCase().trim() === currentCleanUser) ||
    (adminCreds?.username && adminCreds.username.toLowerCase().trim() === currentCleanUser);

  if (isAdmin) {
    return (
      <ErrorBoundary fallbackTitle="Admin Panel Error">
        <Suspense fallback={<ViewLoadingFallback />}>
          <AdminPanel
            userAccounts={userAccounts}
            adminSettings={adminSettings}
            onLogout={handleLogout}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallbackTitle="Training App Error">
      <Suspense fallback={<ViewLoadingFallback />}>
        <GymApp
          currentUser={currentUser}
          userAccounts={userAccounts}
          adminSettings={adminSettings}
          onLogout={handleLogout}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
