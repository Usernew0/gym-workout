import { AdminAccount, AdminSetting, UserAccount } from '../types';

export interface UsernameValidationResult {
  valid: boolean;
  cleanUsername: string;
  reason?: 'empty' | 'too_short' | 'too_long' | 'reserved_admin' | 'duplicate_user' | 'duplicate_admin';
  message?: string;
}

export function getUserBgSettingIdForUsername(username: string): string {
  const clean = (username || 'member').trim().toLowerCase();
  const slug = clean.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash * 31) + clean.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(36);
  const raw = `userBg_${slug}_${suffix}`;
  return raw.slice(0, 128);
}

/**
 * Validates username formatting and checks case-insensitive uniqueness
 * across member accounts AND admin accounts.
 */
export function validateUsernameAvailability(params: {
  candidateUsername: string;
  mode: 'user' | 'admin';
  excludeUserId?: string;
  excludeAdminId?: string;
  userAccounts?: UserAccount[];
  adminSettings?: AdminSetting[];
  adminAccounts?: AdminAccount[];
  extraAdminUsernames?: string[];
}): UsernameValidationResult {
  const cleanUsername = (params.candidateUsername || '').trim();
  const lower = cleanUsername.toLowerCase();

  if (!cleanUsername) {
    return {
      valid: false,
      cleanUsername,
      reason: 'empty',
      message: 'Username cannot be empty.',
    };
  }

  if (cleanUsername.length < 2) {
    return {
      valid: false,
      cleanUsername,
      reason: 'too_short',
      message: 'Username must be at least 2 characters.',
    };
  }

  if (cleanUsername.length > 128) {
    return {
      valid: false,
      cleanUsername,
      reason: 'too_long',
      message: 'Username cannot exceed 128 characters.',
    };
  }

  if (params.mode === 'user' && lower === 'admin') {
    return {
      valid: false,
      cleanUsername,
      reason: 'reserved_admin',
      message: `"${cleanUsername}" is reserved for the Admin Panel. Please choose a different username.`,
    };
  }

  // Gather admin accounts from explicit list + adminSettings
  const settingsAdminAccounts =
    params.adminSettings?.find(s => s.id === 'adminAccounts')?.adminAccounts || [];
  const allAdmins = params.adminAccounts && params.adminAccounts.length > 0
    ? params.adminAccounts
    : settingsAdminAccounts;

  const adminConflict = allAdmins.some(a => {
    if (params.mode === 'admin' && params.excludeAdminId && a.id === params.excludeAdminId) {
      return false;
    }
    return (a.username || '').trim().toLowerCase() === lower;
  });

  const legacyCredsUsername = (
    params.adminSettings?.find(s => s.id === 'credentials')?.username || ''
  ).trim().toLowerCase();

  const extraAdminMatch = (params.extraAdminUsernames || []).some(
    u => (u || '').trim().toLowerCase() === lower
  );

  // For member accounts, collide with ANY admin credential.
  // For admin accounts, avoid conflicting with legacy/extra admin names unless editing that exact admin.
  const isEditingOwnLegacyAdmin =
    params.mode === 'admin' &&
    params.excludeAdminId &&
    allAdmins.some(
      a => a.id === params.excludeAdminId && (a.username || '').trim().toLowerCase() === lower
    );

  if (
    adminConflict ||
    (params.mode === 'user' && (legacyCredsUsername === lower || extraAdminMatch)) ||
    (params.mode === 'admin' && !isEditingOwnLegacyAdmin && extraAdminMatch && !allAdmins.some(a => a.id === params.excludeAdminId))
  ) {
    return {
      valid: false,
      cleanUsername,
      reason: 'duplicate_admin',
      message: `Username "${cleanUsername}" already exists! Please change it because it is already in use.`,
    };
  }

  const userConflict = (params.userAccounts || []).some(u => {
    if (params.mode === 'user' && params.excludeUserId && u.id === params.excludeUserId) {
      return false;
    }
    return (u.username || '').trim().toLowerCase() === lower;
  });

  if (userConflict) {
    return {
      valid: false,
      cleanUsername,
      reason: 'duplicate_user',
      message: `Username "${cleanUsername}" already exists! Please change it because it is already in use.`,
    };
  }

  return { valid: true, cleanUsername };
}
