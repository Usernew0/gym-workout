/**
 * RFC 6238 TOTP (Time-based One-Time Password) & RFC 4226 HOTP Engine
 * Native Web Crypto API implementation for Google Authenticator & TOTP apps.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a Uint8Array buffer into an RFC 4648 Base32 string (without padding)
 */
export function uint8ArrayToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Uint8Array
 */
export function base32ToUint8Array(base32: string): Uint8Array {
  const clean = base32.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue; // Skip invalid characters
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Generates a cryptographically strong random Base32 secret (default: 20 bytes / 160 bits)
 */
export function generateTOTPSecret(byteLength: number = 20): string {
  const buffer = new Uint8Array(byteLength);
  crypto.getRandomValues(buffer);
  return uint8ArrayToBase32(buffer);
}

/**
 * Formats a Base32 secret for human reading with spaces every 4 characters
 */
export function formatSecretForDisplay(secret: string): string {
  const clean = secret.replace(/[\s-]/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join(" ") || clean;
}

/**
 * Generates a 6-digit TOTP code for a given timestamp and secret using HMAC-SHA1
 */
export async function generateTOTP(
  secret: string,
  timestampMs: number = Date.now(),
  stepSeconds: number = 30,
  digits: number = 6
): Promise<string> {
  const keyBytes = base32ToUint8Array(secret);
  if (keyBytes.length === 0) {
    throw new Error("Invalid Base32 secret key");
  }

  // Calculate 8-byte big-endian counter
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuffer = new ArrayBuffer(8);
  const dataView = new DataView(counterBuffer);
  // High 32 bits and Low 32 bits
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  dataView.setUint32(0, high, false);
  dataView.setUint32(4, low, false);

  // Compute HMAC-SHA1
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, counterBuffer);
  const hmac = new Uint8Array(signature);

  // RFC 4226 Dynamic Truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = Math.pow(10, digits);
  const otp = (binaryCode % mod).toString().padStart(digits, "0");
  return otp;
}

/**
 * Verifies an entered TOTP code against a secret with window drift tolerance (default: ±1 step / 30s)
 */
export async function verifyTOTP(
  token: string,
  secret: string,
  windowSteps: number = 1,
  timestampMs: number = Date.now(),
  stepSeconds: number = 30
): Promise<{ valid: boolean; delta: number }> {
  const cleanToken = token.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanToken)) {
    return { valid: false, delta: 0 };
  }

  const currentStep = Math.floor(timestampMs / 1000 / stepSeconds);

  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const checkTime = (currentStep + delta) * stepSeconds * 1000;
    try {
      const expectedToken = await generateTOTP(secret, checkTime, stepSeconds, 6);
      if (expectedToken === cleanToken) {
        return { valid: true, delta };
      }
    } catch {
      // Continue checking
    }
  }

  return { valid: false, delta: 0 };
}

/**
 * Returns the remaining seconds in the current 30-second TOTP window
 */
export function getRemainingTOTPSeconds(stepSeconds: number = 30): number {
  const epochSeconds = Math.floor(Date.now() / 1000);
  return stepSeconds - (epochSeconds % stepSeconds);
}

/**
 * Generates an standard otpauth:// URL for QR code generation
 */
export function generateKeyUri(
  accountName: string,
  issuer: string,
  secret: string
): string {
  const cleanAccount = encodeURIComponent(accountName.trim());
  const cleanIssuer = encodeURIComponent(issuer.trim());
  const cleanSecret = secret.replace(/[\s-]/g, "").toUpperCase();

  return `otpauth://totp/${cleanIssuer}:${cleanAccount}?secret=${cleanSecret}&issuer=${cleanIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates single-use emergency backup recovery codes (e.g. 6 codes formatted as 'XXXX-XXXX')
 */
export function generateBackupCodes(count: number = 6): string[] {
  const charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // Unambiguous characters
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += charset[randomBytes[j] % charset.length];
      if (j === 3) code += "-";
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Normalizes a backup recovery code by removing hyphens/spaces and uppercasing
 */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase().trim();
}

/**
 * Verifies and consumes a backup code from an array of stored codes.
 * Returns valid = true and the updated array with the matched code removed (burned).
 */
export function verifyAndConsumeBackupCode(
  inputCode: string,
  storedCodes: string[] = []
): { valid: boolean; remainingCodes: string[]; matchedCode?: string } {
  const normalizedInput = normalizeBackupCode(inputCode);
  if (!normalizedInput || normalizedInput.length < 6) {
    return { valid: false, remainingCodes: storedCodes };
  }

  const matchIndex = storedCodes.findIndex(
    (code) => normalizeBackupCode(code) === normalizedInput
  );

  if (matchIndex === -1) {
    return { valid: false, remainingCodes: storedCodes };
  }

  const matchedCode = storedCodes[matchIndex];
  const remainingCodes = storedCodes.filter((_, idx) => idx !== matchIndex);

  return {
    valid: true,
    remainingCodes,
    matchedCode,
  };
}
