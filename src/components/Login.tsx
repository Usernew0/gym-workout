import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Heart, Lock, User, Sparkles, KeyRound, ShieldAlert, ShieldCheck, Dumbbell } from 'lucide-react';
import { UserAccount, AdminSetting, AdminAccount } from '../types';
import { verifyPassword, getClientIp, isUnusualAccessHour } from '../utils/crypto';
import { logActivity, saveUserAccountDoc, saveAdminSettingDoc } from '../lib/syncService';
import { TwoFactorAuthStep } from './TwoFactorAuthStep';
import { verifyTOTP, verifyAndConsumeBackupCode } from '../lib/totp';
import { sendTelegramAlert, formatSecurityAlertTelegramMessage } from '../lib/telegramService';

interface LoginProps {
  onLoginSuccess: (username: string) => void;
  userAccounts: UserAccount[];
  adminSettings: AdminSetting[];
  logoutMessage?: string | null;
}

interface TwoFactorPendingAccount {
  type: 'adminAccount' | 'legacyAdmin' | 'userAccount';
  username: string;
  secret: string;
  backupCodes: string[];
  accountObj: any;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, userAccounts, adminSettings, logoutMessage }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);

  // 2FA pending state
  const [pending2FA, setPending2FA] = useState<TwoFactorPendingAccount | null>(null);

  // Anti-brute-force rate limiting state
  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    const stored = localStorage.getItem('love_login_failed_attempts');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [lockoutUntil, setLockoutUntil] = useState<number>(() => {
    const stored = localStorage.getItem('love_login_lockout_until');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  const loveQuotes = [
    "“The only bad workout is the one that didn’t happen.”",
    "“Discipline is choosing between what you want now and what you want most.”",
    "“Sweat is just fat crying. Show up and train.”",
    "“Strength doesn’t come from what you can do. It comes from overcoming what you couldn’t.”"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % loveQuotes.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update lockout countdown timer
  useEffect(() => {
    const checkLockout = () => {
      const now = Date.now();
      if (lockoutUntil > now) {
        setLockoutRemaining(Math.ceil((lockoutUntil - now) / 1000));
      } else {
        setLockoutRemaining(0);
      }
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const secDoc = adminSettings.find(s => s.id === 'securityConfig');
  const configuredMaxAttempts = Math.max(1, secDoc?.loginMaxAttempts ?? 5);
  const configuredLockoutSeconds = Math.max(5, secDoc?.loginLockoutSeconds ?? 60);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (Date.now() < lockoutUntil) {
      setError(`Too many failed attempts. Please wait ${lockoutRemaining}s before trying again.`);
      return;
    }

    if (!username.trim()) {
      setError('Please enter your username');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setIsSubmitting(true);

    const inputUserClean = username.trim().toLowerCase();
    const inputPass = password;

    let isAuthorized = false;
    let authenticatedUsername = username.trim();
    let accountWith2FA: TwoFactorPendingAccount | null = null;

    // Retrieve active admin settings from database if any
    const adminAccountsDoc = adminSettings.find(s => s.id === 'adminAccounts');
    const adminAccounts: AdminAccount[] = adminAccountsDoc?.adminAccounts || [];
    const legacyAdminCreds = adminSettings.find(s => s.id === 'credentials');

    // 1. Check against multi-admin accounts database
    const matchingAdminAccount = adminAccounts.find(a => a.username.toLowerCase().trim() === inputUserClean);
    if (matchingAdminAccount) {
      const isMatch = !matchingAdminAccount.password || (await verifyPassword(inputPass, matchingAdminAccount.password));
      if (isMatch) {
        isAuthorized = true;
        authenticatedUsername = matchingAdminAccount.username;
        if (matchingAdminAccount.twoFactorEnabled && matchingAdminAccount.twoFactorSecret) {
          accountWith2FA = {
            type: 'adminAccount',
            username: matchingAdminAccount.username,
            secret: matchingAdminAccount.twoFactorSecret,
            backupCodes: matchingAdminAccount.twoFactorBackupCodes || [],
            accountObj: matchingAdminAccount
          };
        }
      }
    }

    // 1b. Check legacy admin credentials setting from database
    if (!isAuthorized && legacyAdminCreds?.username && legacyAdminCreds.username.toLowerCase().trim() === inputUserClean) {
      if (legacyAdminCreds.password && (await verifyPassword(inputPass, legacyAdminCreds.password))) {
        isAuthorized = true;
        authenticatedUsername = legacyAdminCreds.username;
        if (legacyAdminCreds.twoFactorEnabled && legacyAdminCreds.twoFactorSecret) {
          accountWith2FA = {
            type: 'legacyAdmin',
            username: legacyAdminCreds.username,
            secret: legacyAdminCreds.twoFactorSecret,
            backupCodes: legacyAdminCreds.twoFactorBackupCodes || [],
            accountObj: legacyAdminCreds
          };
        }
      }
    }

    // 2. Supabase / Firestore database users check
    if (!isAuthorized) {
      const dbUser = userAccounts.find(u => 
        u.username.toLowerCase().trim() === inputUserClean ||
        u.id.toLowerCase() === inputUserClean ||
        u.id.toLowerCase() === `user_${inputUserClean}`
      );

      if (dbUser && dbUser.password && (await verifyPassword(inputPass, dbUser.password))) {
        isAuthorized = true;
        authenticatedUsername = dbUser.username;
        if (dbUser.twoFactorEnabled && dbUser.twoFactorSecret) {
          accountWith2FA = {
            type: 'userAccount',
            username: dbUser.username,
            secret: dbUser.twoFactorSecret,
            backupCodes: dbUser.twoFactorBackupCodes || [],
            accountObj: dbUser
          };
        }
      }
    }

    const clientIp = await getClientIp();
    const unusualTime = isUnusualAccessHour();

    if (isAuthorized) {
      // If the account has Two-Factor Authentication enabled, transition to 2FA Step!
      if (accountWith2FA) {
        setIsSubmitting(false);
        setPending2FA(accountWith2FA);
        logActivity(
          authenticatedUsername,
          'security_2fa_prompted',
          `Password verified. 2FA verification step prompted for "${authenticatedUsername}". IP: ${clientIp}`
        ).catch(() => {});
        return;
      }

      // 2FA is not enabled on this account; proceed with normal login
      setFailedAttempts(0);
      setLockoutUntil(0);
      localStorage.removeItem('love_login_failed_attempts');
      localStorage.removeItem('love_login_lockout_until');

      if (unusualTime.isUnusual) {
        logActivity(
          authenticatedUsername,
          'security_unusual_time_login',
          `Login detected during unusual off-hours (${unusualTime.label}) from IP: ${clientIp}`
        ).catch(() => {});
      }

      // Dispatch Telegram Security Alert for Successful Login
      sendTelegramAlert(
        formatSecurityAlertTelegramMessage(
          authenticatedUsername,
          unusualTime.isUnusual ? 'security_unusual_time_login' : 'security_login_success',
          `User '${authenticatedUsername}' logged in successfully. IP: ${clientIp} | ${unusualTime.label}`
        ),
        'security',
        {
          targetUsername: authenticatedUsername,
          adminSettings,
          userAccounts
        }
      ).catch(() => {});

      onLoginSuccess(authenticatedUsername);
    } else {
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      localStorage.setItem('love_login_failed_attempts', nextFailed.toString());

      if (nextFailed >= configuredMaxAttempts) {
        const lockoutTime = Date.now() + configuredLockoutSeconds * 1000;
        setLockoutUntil(lockoutTime);
        localStorage.setItem('love_login_lockout_until', lockoutTime.toString());
        setError(`Too many failed login attempts. Please wait ${configuredLockoutSeconds} seconds.`);

        const lockoutDetails = `🚨 Account locked out for ${configuredLockoutSeconds}s after ${nextFailed} failed password attempts. IP: ${clientIp} | ${unusualTime.label}`;
        logActivity(
          username.trim() || 'Unknown User',
          'security_lockout_triggered',
          lockoutDetails
        ).catch(() => {});

        // Dispatch Telegram Security Alert for Account Lockout
        sendTelegramAlert(
          formatSecurityAlertTelegramMessage(
            username.trim() || 'Unknown User',
            'security_lockout_triggered',
            lockoutDetails
          ),
          'security',
          {
            targetUsername: username.trim(),
            adminSettings,
            userAccounts
          }
        ).catch(() => {});
      } else {
        const remainingAttempts = configuredMaxAttempts - nextFailed;
        setError(`Incorrect username or password. (${remainingAttempts} attempts remaining)`);

        const failedDetails = `Failed login password attempt (${nextFailed}/${configuredMaxAttempts}). IP: ${clientIp} | ${unusualTime.label}`;
        logActivity(
          username.trim() || 'Unknown User',
          'security_failed_login',
          failedDetails
        ).catch(() => {});

        // Dispatch Telegram Security Alert for Failed Password Attempt
        sendTelegramAlert(
          formatSecurityAlertTelegramMessage(
            username.trim() || 'Unknown User',
            'security_failed_login',
            failedDetails
          ),
          'security',
          {
            targetUsername: username.trim(),
            adminSettings,
            userAccounts
          }
        ).catch(() => {});
      }
      setIsSubmitting(false);
    }
  };

  // Verify TOTP 6-digit code
  const handleVerifyTOTP = async (code: string): Promise<{ success: boolean; message?: string }> => {
    if (!pending2FA) return { success: false, message: 'No 2FA session found.' };

    const clientIp = await getClientIp();
    const unusualTime = isUnusualAccessHour();

    const verifyResult = await verifyTOTP(code, pending2FA.secret, 1);

    if (verifyResult.valid) {
      // Successful 2FA verification
      setFailedAttempts(0);
      setLockoutUntil(0);
      localStorage.removeItem('love_login_failed_attempts');
      localStorage.removeItem('love_login_lockout_until');

      await logActivity(
        pending2FA.username,
        'security_2fa_success',
        `🔐 Two-factor authentication (TOTP) successful for "${pending2FA.username}". IP: ${clientIp} | ${unusualTime.label}`
      ).catch(() => {});

      if (unusualTime.isUnusual) {
        await logActivity(
          pending2FA.username,
          'security_unusual_time_login',
          `Login detected during unusual off-hours (${unusualTime.label}) from IP: ${clientIp}`
        ).catch(() => {});
      }

      sendTelegramAlert(
        formatSecurityAlertTelegramMessage(
          pending2FA.username,
          'security_2fa_success',
          `🔐 Two-factor authentication (TOTP) successful for "${pending2FA.username}". IP: ${clientIp} | ${unusualTime.label}`
        ),
        'security',
        {
          targetUsername: pending2FA.username,
          adminSettings,
          userAccounts
        }
      ).catch(() => {});

      const userToLogin = pending2FA.username;
      setPending2FA(null);
      onLoginSuccess(userToLogin);
      return { success: true };
    }

    // Failed TOTP attempt
    const nextFailed = failedAttempts + 1;
    setFailedAttempts(nextFailed);
    localStorage.setItem('love_login_failed_attempts', nextFailed.toString());

    if (nextFailed >= configuredMaxAttempts) {
      const lockoutTime = Date.now() + configuredLockoutSeconds * 1000;
      setLockoutUntil(lockoutTime);
      localStorage.setItem('love_login_lockout_until', lockoutTime.toString());
      setPending2FA(null);
      setError(`Too many failed 2FA verification attempts. Locked out for ${configuredLockoutSeconds}s.`);

      const lockoutDetails = `🚨 Account locked out for ${configuredLockoutSeconds}s after ${nextFailed} failed 2FA attempts. IP: ${clientIp} | ${unusualTime.label}`;
      logActivity(
        pending2FA.username,
        'security_lockout_triggered',
        lockoutDetails
      ).catch(() => {});

      sendTelegramAlert(
        formatSecurityAlertTelegramMessage(
          pending2FA.username,
          'security_lockout_triggered',
          lockoutDetails
        ),
        'security',
        {
          targetUsername: pending2FA.username,
          adminSettings,
          userAccounts
        }
      ).catch(() => {});

      return { success: false, message: `Account locked out for ${configuredLockoutSeconds} seconds.` };
    }

    const remainingAttempts = configuredMaxAttempts - nextFailed;
    logActivity(
      pending2FA.username,
      'security_2fa_failed',
      `🚨 Failed 2FA TOTP code attempt (${nextFailed}/${configuredMaxAttempts}). IP: ${clientIp} | ${unusualTime.label}`
    ).catch(() => {});

    return {
      success: false,
      message: `Invalid 6-digit code. Please verify your authenticator app clock. (${remainingAttempts} attempts remaining)`
    };
  };

  // Verify Single-Use Emergency Recovery Backup Code
  const handleVerifyBackupCode = async (code: string): Promise<{ success: boolean; message?: string }> => {
    if (!pending2FA) return { success: false, message: 'No 2FA session found.' };

    const clientIp = await getClientIp();
    const unusualTime = isUnusualAccessHour();

    const result = verifyAndConsumeBackupCode(code, pending2FA.backupCodes);

    if (result.valid) {
      // Consume the code in the database so it cannot be reused
      try {
        if (pending2FA.type === 'adminAccount') {
          const adminAccountsDoc = adminSettings.find(s => s.id === 'adminAccounts');
          const currentList: AdminAccount[] = adminAccountsDoc?.adminAccounts || [];
          const updatedList = currentList.map(a => {
            if (a.id === pending2FA.accountObj.id) {
              return { ...a, twoFactorBackupCodes: result.remainingCodes };
            }
            return a;
          });
          await saveAdminSettingDoc({
            id: 'adminAccounts',
            adminAccounts: updatedList
          });
        } else if (pending2FA.type === 'legacyAdmin') {
          const legacyAdminCreds = adminSettings.find(s => s.id === 'credentials');
          await saveAdminSettingDoc({
            ...legacyAdminCreds,
            id: 'credentials',
            twoFactorBackupCodes: result.remainingCodes
          });
        } else if (pending2FA.type === 'userAccount') {
          await saveUserAccountDoc({
            ...pending2FA.accountObj,
            twoFactorBackupCodes: result.remainingCodes
          });
        }
      } catch (err) {
        console.error("Failed to update burned backup codes:", err);
      }

      setFailedAttempts(0);
      setLockoutUntil(0);
      localStorage.removeItem('love_login_failed_attempts');
      localStorage.removeItem('love_login_lockout_until');

      await logActivity(
        pending2FA.username,
        'security_backup_code_used',
        `🚨 Emergency single-use backup recovery code was used to bypass TOTP for "${pending2FA.username}". Code permanently burned (${result.remainingCodes.length} remaining). IP: ${clientIp} | ${unusualTime.label}`
      ).catch(() => {});

      const userToLogin = pending2FA.username;
      setPending2FA(null);
      onLoginSuccess(userToLogin);
      return { success: true };
    }

    // Invalid backup code
    const nextFailed = failedAttempts + 1;
    setFailedAttempts(nextFailed);
    localStorage.setItem('love_login_failed_attempts', nextFailed.toString());

    if (nextFailed >= configuredMaxAttempts) {
      const lockoutTime = Date.now() + configuredLockoutSeconds * 1000;
      setLockoutUntil(lockoutTime);
      localStorage.setItem('love_login_lockout_until', lockoutTime.toString());
      setPending2FA(null);
      setError(`Too many failed 2FA verification attempts. Locked out for ${configuredLockoutSeconds}s.`);

      logActivity(
        pending2FA.username,
        'security_lockout_triggered',
        `🚨 Account locked out for ${configuredLockoutSeconds}s after failed recovery code attempt. IP: ${clientIp} | ${unusualTime.label}`
      ).catch(() => {});

      return { success: false, message: `Account locked out for ${configuredLockoutSeconds} seconds.` };
    }

    const remainingAttempts = configuredMaxAttempts - nextFailed;
    logActivity(
      pending2FA.username,
      'security_2fa_failed',
      `🚨 Failed emergency backup recovery code attempt (${nextFailed}/${configuredMaxAttempts}). IP: ${clientIp} | ${unusualTime.label}`
    ).catch(() => {});

    return {
      success: false,
      message: `Invalid or already consumed emergency recovery code. (${remainingAttempts} attempts remaining)`
    };
  };

  return (
    <main id="login_container" className="min-h-screen min-h-[100dvh] w-full flex items-center justify-center bg-neutral-950 text-white relative px-4 overflow-hidden">
      
      {/* ATMOSPHERIC BACKGROUND BLOBS */}
      <div className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[150px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-200px] right-[-200px] w-[600px] h-[600px] bg-red-800/10 rounded-full blur-[150px] pointer-events-none z-0"></div>

      <div className="relative z-10 w-full max-w-md">
        
        {/* LOGO AND BRANDING */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="inline-block p-4 bg-red-500/10 border border-red-500/20 rounded-2xl mb-4 text-red-500 shadow-xl shadow-red-950/20"
          >
            <Dumbbell className="w-10 h-10 text-red-500" />
          </motion.div>
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="font-serif text-3xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-white via-red-100 to-red-400 bg-clip-text text-transparent uppercase"
          >
            Gym Workout
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-xs text-red-200/60 font-mono tracking-widest uppercase"
          >
            Train Hard · Track Everything
          </motion.p>
        </div>

        {/* LOGIN FORM / 2FA CARD */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="bg-neutral-900/60 border border-white/10 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl shadow-neutral-950/80 relative"
        >
          {/* Subtle sparkles decoration */}
          <div className="absolute top-4 right-4 text-red-500/30">
            <Sparkles className="w-5 h-5 animate-spin-slow" />
          </div>

          {pending2FA ? (
            /* TWO-FACTOR AUTHENTICATION STEP */
            <TwoFactorAuthStep
              username={pending2FA.username}
              onVerifyTOTP={handleVerifyTOTP}
              onVerifyBackupCode={handleVerifyBackupCode}
              onCancel={() => setPending2FA(null)}
              remainingAttempts={configuredMaxAttempts - failedAttempts}
            />
          ) : (
            /* STANDARD PASSWORD FORM */
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Logout/Security Warning Message */}
              {logoutMessage && !error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-300 text-center font-sans font-medium flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{logoutMessage}</span>
                </motion.div>
              )}
              
              {/* Username Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-red-200/80 tracking-wide uppercase block">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20 transition-all font-sans"
                    placeholder="e.g. username"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-red-200/80 tracking-wide uppercase block">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-neutral-950/80 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-red-500/60 focus:ring-2 focus:ring-red-500/20 transition-all font-sans"
                    placeholder="••••••••"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300 text-center font-sans font-medium"
                >
                  {error}
                </motion.div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full relative group overflow-hidden bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-2xl py-3.5 px-4 font-semibold text-sm active:scale-[0.98] transition-all duration-200 shadow-lg shadow-red-950/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>Enter the Gym</span>
                    <Dumbbell className="w-4 h-4" />
                  </>
                )}
              </button>

            </form>
          )}
        </motion.div>

        {/* ROTATING MOTIVATION FOOTER */}
        <div className="mt-12 text-center h-12 flex items-center justify-center px-4">
          <motion.p
            key={`login-quote-${quoteIndex}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            className="text-xs text-neutral-400 italic font-serif leading-relaxed max-w-sm"
          >
            {loveQuotes[quoteIndex]}
          </motion.p>
        </div>

      </div>
    </main>
  );
};
