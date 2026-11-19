import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, ShieldAlert, QrCode, Copy, Check, Download, 
  RefreshCw, KeyRound, AlertTriangle, X, CheckCircle2, Lock, ArrowRight
} from 'lucide-react';
import QRCode from 'qrcode';
import { 
  generateTOTPSecret, 
  generateKeyUri, 
  generateBackupCodes, 
  formatSecretForDisplay, 
  verifyTOTP 
} from '../lib/totp';

interface TwoFactorSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  isAlreadyEnabled?: boolean;
  currentSecret?: string;
  currentBackupCodes?: string[];
  onSave2FA: (secret: string, backupCodes: string[]) => Promise<void>;
  onDisable2FA: () => Promise<void>;
}

export const TwoFactorSetupModal: React.FC<TwoFactorSetupModalProps> = ({
  isOpen,
  onClose,
  username,
  isAlreadyEnabled = false,
  currentSecret = '',
  currentBackupCodes = [],
  onSave2FA,
  onDisable2FA
}) => {
  const [step, setStep] = useState<'overview' | 'enroll' | 'backup_codes' | 'disable_confirm'>('overview');
  const [secret, setSecret] = useState<string>('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [testCode, setTestCode] = useState<string>('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initialize secret and backup codes when modal opens or step changes
  useEffect(() => {
    if (!isOpen) return;

    if (isAlreadyEnabled) {
      setStep('overview');
      setSecret(currentSecret);
      setBackupCodes(currentBackupCodes);
    } else {
      startNewEnrollment();
    }
  }, [isOpen, isAlreadyEnabled]);

  const startNewEnrollment = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setTestCode('');
    const newSecret = generateTOTPSecret(20);
    const newCodes = generateBackupCodes(6);
    setSecret(newSecret);
    setBackupCodes(newCodes);

    const otpauthUri = generateKeyUri(username || 'User', 'Gym Workout', newSecret);
    try {
      const qrUrl = await QRCode.toDataURL(otpauthUri, {
        width: 240,
        margin: 2,
        color: {
          dark: '#0a0a0a',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrUrl);
      setStep('enroll');
    } catch (err) {
      setErrorMsg('Failed to generate QR Code.');
    }
  };

  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2500);
  };

  const handleCopyCodes = () => {
    const text = `Gym Workout — 2FA Emergency Backup Recovery Codes for ${username}:\n\n` +
      backupCodes.map((code, idx) => `${idx + 1}. ${code}`).join('\n') +
      `\n\nGenerated on: ${new Date().toISOString()}\nNote: Each code can only be used once.`;
    navigator.clipboard.writeText(text);
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2500);
  };

  const handleDownloadCodes = () => {
    const text = `Gym Workout — 2FA Emergency Backup Recovery Codes\n` +
      `====================================================\n` +
      `Account: ${username}\n` +
      `Generated: ${new Date().toLocaleString()}\n\n` +
      `Single-Use Emergency Recovery Codes:\n` +
      backupCodes.map((code, idx) => `  [${idx + 1}]  ${code}`).join('\n') +
      `\n\nSECURITY WARNING:\n` +
      `- Keep these codes in a safe, secure place (e.g. password manager).\n` +
      `- Each code can only be used once to log in if you lose your phone.\n` +
      `- Once consumed, a backup code is permanently burned.\n`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GymWorkout_2FA_Backup_Codes_${username.toLowerCase().replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVerifyAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!testCode.trim()) {
      setErrorMsg('Please enter the 6-digit code shown in your authenticator app.');
      return;
    }

    setIsSaving(true);
    try {
      const verifyResult = await verifyTOTP(testCode.trim(), secret, 1);
      if (!verifyResult.valid) {
        setErrorMsg('Invalid code. Please make sure your device clock is synced and re-enter the 6-digit code.');
        setIsSaving(false);
        return;
      }

      await onSave2FA(secret, backupCodes);
      setSuccessMsg('Two-Factor Authentication successfully enabled and secured!');
      setStep('backup_codes');
    } catch (err) {
      setErrorMsg('Failed to save 2FA configuration to database.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisableConfirm = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onDisable2FA();
      onClose();
    } catch (err) {
      setErrorMsg('Failed to disable 2FA.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-neutral-900 border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 relative max-h-[92vh] flex flex-col my-auto"
      >
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/30 rounded-2xl text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-serif font-bold text-white">
                Google Authenticator / 2FA Setup
              </h3>
              <p className="text-[11px] text-neutral-400 font-mono">
                RFC 6238 TOTP Protection for <strong className="text-rose-300">{username}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ERROR / SUCCESS ALERTS */}
        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="space-y-5 overflow-y-auto flex-1 pr-1">
          {/* STEP: OVERVIEW (When already enabled) */}
          {step === 'overview' && isAlreadyEnabled && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-emerald-200">2FA Protection is Active</h4>
                  <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                    This account is currently guarded by RFC 6238 Time-based One-Time Passwords (TOTP). Sign-ins require both password and authenticator code.
                  </p>
                </div>
              </div>

              {/* BACKUP CODES SUMMARY */}
              <div className="p-4 bg-neutral-950/60 border border-white/10 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-neutral-300">Remaining Backup Codes:</span>
                  <span className="font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                    {currentBackupCodes.length} available
                  </span>
                </div>
                {currentBackupCodes.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs text-neutral-300">
                    {currentBackupCodes.map((c, i) => (
                      <div key={`curr-backup-${c}-${i}`} className="p-1.5 bg-white/5 rounded-lg border border-white/5 text-center">
                        {c}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-rose-300 font-mono">
                    ⚠️ All backup codes have been consumed! Regenerate your 2FA configuration to get fresh codes.
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={startNewEnrollment}
                  className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconfigure / New Secret</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('disable_confirm')}
                  className="py-2.5 px-4 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Disable 2FA</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP: ENROLL (Scan QR & Verify) */}
          {step === 'enroll' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider font-mono block">
                  Step 1: Scan with Authenticator App
                </span>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Open Google Authenticator, Authy, Apple Passwords, or 1Password on your mobile phone and scan this QR code:
                </p>
              </div>

              {/* QR CODE CARD */}
              <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shadow-xl w-fit mx-auto border-4 border-indigo-500/20">
                {qrCodeDataUrl ? (
                  <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48 block" />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-neutral-400 font-mono text-xs">
                    Generating QR...
                  </div>
                )}
              </div>

              {/* MANUAL SECRET KEY */}
              <div className="space-y-1.5 p-3.5 bg-neutral-950/80 border border-white/10 rounded-2xl">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span>Can't scan? Enter key manually:</span>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-mono"
                  >
                    {copiedSecret ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="font-mono text-xs font-bold text-indigo-200 tracking-wider break-all select-all">
                  {formatSecretForDisplay(secret)}
                </div>
              </div>

              {/* STEP 2: TEST VERIFICATION */}
              <form onSubmit={handleVerifyAndSave} className="space-y-3 pt-2 border-t border-white/10">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-indigo-300 uppercase tracking-wider font-mono block">
                    Step 2: Verify 6-Digit Code
                  </label>
                  <p className="text-xs text-neutral-400">
                    Enter the 6-digit code currently shown on your app to verify setup and activate 2FA:
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={testCode}
                    onChange={(e) => setTestCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="flex-1 bg-neutral-950/80 border border-white/15 rounded-xl px-4 py-2.5 text-center font-mono text-lg font-bold text-white tracking-widest focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    disabled={isSaving}
                  />
                  <button
                    type="submit"
                    disabled={testCode.length !== 6 || isSaving}
                    className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-rose-600 hover:opacity-95 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow disabled:opacity-40"
                  >
                    {isSaving ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span>Activate 2FA</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP: BACKUP CODES DISPLAY */}
          {step === 'backup_codes' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs text-amber-300 space-y-1">
                <strong className="block font-bold">⚠️ Save Your Emergency Recovery Codes!</strong>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  If you ever lose access to your phone or authenticator app, these emergency backup codes are the ONLY way to access your account. Store them in a safe location.
                </p>
              </div>

              <div className="p-4 bg-neutral-950/90 border border-white/10 rounded-2xl">
                <div className="grid grid-cols-2 gap-2 font-mono text-xs text-neutral-200">
                  {backupCodes.map((code, idx) => (
                    <div key={`setup-backup-${code}-${idx}`} className="p-2 bg-white/5 rounded-lg border border-white/5 text-center font-bold tracking-widest">
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCodes}
                  className="flex-1 py-2.5 px-3 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-xl border border-white/10 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedCodes ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCodes ? 'Copied Codes' : 'Copy Codes'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCodes}
                  className="flex-1 py-2.5 px-3 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-300" />
                  <span>Download .TXT</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I Have Saved My Backup Codes</span>
              </button>
            </div>
          )}

          {/* STEP: DISABLE CONFIRM */}
          {step === 'disable_confirm' && (
            <div className="space-y-4">
              <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-xs text-rose-300 space-y-1">
                <strong className="block font-bold">Disable Two-Factor Authentication?</strong>
                <p className="text-[11px] text-rose-200/80 leading-relaxed">
                  Disabling 2FA will remove the extra layer of security on this account. Anyone with your password will be able to sign in without an authenticator code.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('overview')}
                  className="flex-1 py-2.5 px-3 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisableConfirm}
                  disabled={isSaving}
                  className="flex-1 py-2.5 px-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isSaving ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span>Confirm Disable</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
