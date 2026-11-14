import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, KeyRound, AlertCircle, ArrowLeft, LifeBuoy, Clock, CheckCircle2, Lock } from 'lucide-react';
import { getRemainingTOTPSeconds } from '../lib/totp';

interface TwoFactorAuthStepProps {
  username: string;
  onVerifyTOTP: (code: string) => Promise<{ success: boolean; message?: string }>;
  onVerifyBackupCode: (code: string) => Promise<{ success: boolean; message?: string }>;
  onCancel: () => void;
  remainingAttempts?: number;
}

export const TwoFactorAuthStep: React.FC<TwoFactorAuthStepProps> = ({
  username,
  onVerifyTOTP,
  onVerifyBackupCode,
  onCancel,
  remainingAttempts
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(getRemainingTOTPSeconds());
  const [isShaking, setIsShaking] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 30-second live cycle countdown
  useEffect(() => {
    const updateCountdown = () => {
      setSecondsRemaining(getRemainingTOTPSeconds());
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-focus first input on mount
  useEffect(() => {
    if (!useBackupCode && inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, [useBackupCode]);

  // Handle individual digit input
  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned) {
      const nextDigits = [...digits];
      nextDigits[index] = '';
      setDigits(nextDigits);
      return;
    }

    const lastChar = cleaned[cleaned.length - 1];
    const nextDigits = [...digits];
    nextDigits[index] = lastChar;
    setDigits(nextDigits);

    // Auto advance focus
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto submit if all 6 digits entered
    if (index === 5 || nextDigits.every(d => d !== '')) {
      const fullCode = nextDigits.join('');
      if (fullCode.length === 6) {
        triggerVerifyTOTP(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim().replace(/\D/g, '');
    if (pastedData.length >= 6) {
      const code6 = pastedData.slice(0, 6).split('');
      setDigits(code6);
      inputRefs.current[5]?.focus();
      triggerVerifyTOTP(pastedData.slice(0, 6));
    }
  };

  const triggerVerifyTOTP = async (code: string) => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorMessage(null);

    const result = await onVerifyTOTP(code);
    setIsVerifying(false);

    if (!result.success) {
      setErrorMessage(result.message || 'Invalid 6-digit authenticator code. Please check your app.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      // Clear inputs and re-focus first
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    }
  };

  const handleBackupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupCodeInput.trim() || isVerifying) return;

    setIsVerifying(true);
    setErrorMessage(null);

    const result = await onVerifyBackupCode(backupCodeInput.trim());
    setIsVerifying(false);

    if (!result.success) {
      setErrorMessage(result.message || 'Invalid or already consumed backup code.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  // Percentage of 30-second window
  const cyclePercent = ((30 - secondsRemaining) / 30) * 100;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="text-center space-y-2">
        <div className="inline-flex p-3 bg-indigo-500/15 border border-indigo-500/25 rounded-2xl text-indigo-400 mb-1 shadow-lg shadow-indigo-950/40">
          <ShieldCheck className="w-8 h-8 animate-pulse text-indigo-400" />
        </div>
        <h2 className="text-xl sm:text-2xl font-serif font-bold text-white tracking-wide">
          Two-Factor Authentication
        </h2>
        <p className="text-xs text-neutral-400 font-sans max-w-sm mx-auto">
          {useBackupCode ? (
            <span>Enter one of your 8-character single-use emergency backup recovery codes.</span>
          ) : (
            <span>
              Enter the 6-digit security code generated by your Google Authenticator or TOTP app for{' '}
              <strong className="text-rose-300 font-mono font-semibold">{username}</strong>.
            </span>
          )}
        </p>
      </div>

      {/* ERROR ALERT */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3.5 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-xs text-rose-300 flex items-start gap-2.5 font-sans"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold block">{errorMessage}</span>
              {remainingAttempts !== undefined && (
                <span className="text-[11px] text-rose-400/80 font-mono block">
                  Remaining attempts before lockout: {remainingAttempts}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!useBackupCode ? (
        /* 6-DIGIT TOTP INPUT */
        <div className="space-y-5">
          <motion.div
            animate={isShaking ? { x: [-10, 10, -8, 8, -4, 4, 0] } : {}}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-center gap-2 sm:gap-3"
          >
            {digits.map((digit, idx) => (
              <input
                key={`2fa-digit-input-${idx}`}
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={handlePaste}
                disabled={isVerifying}
                className="w-11 h-14 sm:w-12 sm:h-16 text-center text-xl sm:text-2xl font-mono font-bold text-white bg-neutral-950/80 border border-white/15 rounded-2xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 transition-all shadow-inner disabled:opacity-50"
                placeholder="•"
                autoComplete="one-time-code"
              />
            ))}
          </motion.div>

          {/* 30-SECOND COUNTDOWN PROGRESS BAR */}
          <div className="space-y-1.5 px-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Code refresh:</span>
              </span>
              <span className={`font-bold ${secondsRemaining <= 5 ? 'text-rose-400 animate-pulse' : 'text-indigo-300'}`}>
                {secondsRemaining}s remaining
              </span>
            </div>
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className={`h-full transition-all duration-300 rounded-full ${
                  secondsRemaining <= 5
                    ? 'bg-rose-500'
                    : 'bg-gradient-to-r from-indigo-500 to-pink-500'
                }`}
                style={{ width: `${100 - cyclePercent}%` }}
              />
            </div>
          </div>

          {/* VERIFY BUTTON */}
          <button
            type="button"
            onClick={() => triggerVerifyTOTP(digits.join(''))}
            disabled={digits.some(d => d === '') || isVerifying}
            className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-600 hover:opacity-95 text-white font-semibold text-sm py-3.5 px-4 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/40 disabled:opacity-40"
          >
            {isVerifying ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Verify & Enter Space</span>
                <ShieldCheck className="w-4 h-4 text-white" />
              </>
            )}
          </button>
        </div>
      ) : (
        /* EMERGENCY BACKUP CODE INPUT */
        <form onSubmit={handleBackupSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-rose-200/80 tracking-wide uppercase block font-mono">
              Emergency Backup Recovery Code
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                <LifeBuoy className="w-4 h-4 text-amber-400" />
              </div>
              <input
                type="text"
                value={backupCodeInput}
                onChange={(e) => setBackupCodeInput(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                disabled={isVerifying}
                className="w-full bg-neutral-950/80 border border-white/15 rounded-2xl pl-10 pr-4 py-3 text-white font-mono text-sm uppercase placeholder-neutral-500 focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20 transition-all tracking-widest text-center"
                autoFocus
              />
            </div>
            <p className="text-[10px] text-neutral-400 font-mono">
              Note: Each emergency backup recovery code can only be used once and is burned upon entry.
            </p>
          </div>

          <button
            type="submit"
            disabled={!backupCodeInput.trim() || isVerifying}
            className="w-full bg-gradient-to-r from-amber-600 to-rose-600 hover:opacity-95 text-white font-semibold text-sm py-3.5 px-4 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 disabled:opacity-40"
          >
            {isVerifying ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Consume Backup Code & Enter</span>
                <KeyRound className="w-4 h-4 text-white" />
              </>
            )}
          </button>
        </form>
      )}

      {/* FOOTER ACTIONS */}
      <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={onCancel}
          disabled={isVerifying}
          className="text-neutral-400 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Password</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setUseBackupCode(!useBackupCode);
            setErrorMessage(null);
          }}
          disabled={isVerifying}
          className="text-indigo-300 hover:text-indigo-200 transition-colors font-medium cursor-pointer flex items-center gap-1"
        >
          {useBackupCode ? (
            <span>Use Authenticator App Code</span>
          ) : (
            <span>Use Emergency Backup Code</span>
          )}
        </button>
      </div>
    </div>
  );
};
