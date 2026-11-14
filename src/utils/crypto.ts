/**
 * Cryptographic security utility for password hashing, verification,
 * and tamper-proof session tokens using the browser's native Web Crypto API.
 */

const SESSION_SALT = "OurHome_Security_Salt_2026_SecureSessionToken";
const HASH_PREFIX = "sha256_v1:";

/**
 * Computes a SHA-256 hexadecimal hash with a secure salt
 */
export async function hashPassword(plainText: string, salt: string = "OurHome_Secret_Salt"): Promise<string> {
  if (!plainText) return "";
  // If it's already hashed, don't re-hash
  if (plainText.startsWith(HASH_PREFIX)) return plainText;

  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${plainText}:${salt}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return `${HASH_PREFIX}${hex}`;
}

/**
 * Synchronous hash fallback using string transformation when async cannot be awaited immediately
 */
export function isHashedPassword(password: string): boolean {
  if (!password) return false;
  return password.startsWith(HASH_PREFIX);
}

/**
 * Verifies if an input plain text password matches a stored password.
 * Supports both modern hashed passwords and legacy plain text passwords (for seamless upgrade).
 */
export async function verifyPassword(inputPlain: string, storedPassword: string, salt: string = "OurHome_Secret_Salt"): Promise<boolean> {
  if (!storedPassword) return false;
  
  // If stored password is in hash format
  if (storedPassword.startsWith(HASH_PREFIX)) {
    const computedHash = await hashPassword(inputPlain, salt);
    return computedHash === storedPassword;
  }
  
  // Backward-compatible fallback for existing plaintext passwords
  return inputPlain === storedPassword;
}

/**
 * Structure of a tamper-proof session token
 */
export interface SecureSessionToken {
  username: string;
  createdAt: number;
  expiresAt: number;
  signature: string;
}

/**
 * Generates a signed session token that cannot be faked via simple localStorage.setItem('love_app_is_logged_in', 'true')
 */
export async function createSessionToken(username: string, durationDays: number = 7): Promise<string> {
  const now = Date.now();
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;
  
  const payloadToSign = `${username.toLowerCase().trim()}:${now}:${expiresAt}:${SESSION_SALT}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(payloadToSign));
  const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  const tokenObj: SecureSessionToken = {
    username: username.trim(),
    createdAt: now,
    expiresAt,
    signature
  };

  return btoa(JSON.stringify(tokenObj));
}

/**
 * Verifies if a session token is authentic, untampered, and unexpired.
 */
export async function verifySessionToken(tokenString: string | null): Promise<{ valid: boolean; username?: string; reason?: string }> {
  if (!tokenString) {
    return { valid: false, reason: "No session token provided" };
  }

  try {
    const decodedStr = atob(tokenString);
    const tokenObj: SecureSessionToken = JSON.parse(decodedStr);

    if (!tokenObj.username || !tokenObj.createdAt || !tokenObj.expiresAt || !tokenObj.signature) {
      return { valid: false, reason: "Malformed session payload" };
    }

    // Check expiration
    if (Date.now() > tokenObj.expiresAt) {
      return { valid: false, reason: "Session expired" };
    }

    // Recompute signature to detect tampering in DevTools
    const expectedPayload = `${tokenObj.username.toLowerCase().trim()}:${tokenObj.createdAt}:${tokenObj.expiresAt}:${SESSION_SALT}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(expectedPayload));
    const expectedSig = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    if (tokenObj.signature !== expectedSig) {
      return { valid: false, reason: "Tampered or invalid session signature" };
    }

    return { valid: true, username: tokenObj.username };
  } catch {
    return { valid: false, reason: "Invalid token format" };
  }
}

let cachedClientIp: string | null = null;

/**
 * Retrieves public client IP address for security logging and threat detection
 */
export async function getClientIp(): Promise<string> {
  if (cachedClientIp) return cachedClientIp;
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ip) {
        cachedClientIp = data.ip;
        return data.ip;
      }
    }
  } catch {
    // Offline or network timeout fallback
  }
  cachedClientIp = typeof window !== 'undefined' ? (window.location.hostname || 'client-local') : 'client-local';
  return cachedClientIp;
}

/**
 * Checks if a given timestamp represents an unusual access time (e.g. late night between 1:00 AM and 5:00 AM)
 */
export function isUnusualAccessHour(date: Date = new Date()): { isUnusual: boolean; hour: number; label: string } {
  const hour = date.getHours();
  // Off-hours / graveyard window: 1:00 AM - 4:59 AM
  const isUnusual = hour >= 1 && hour < 5;
  return {
    isUnusual,
    hour,
    label: isUnusual ? `Late-night / Unusual Hour (${hour.toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')})` : `Normal Access Hour (${hour.toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')})`
  };
}

