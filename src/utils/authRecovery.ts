export interface AuthCallbackParseResult {
  pathname: string;
  hasAuthError: boolean;
  errorCode: string | null;
  errorDescription: string | null;
  type: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenHash: string | null;
  code: string | null;
  isImplicitRecovery: boolean;
  isOtpRecovery: boolean;
  hasRecoveryIntent: boolean;
}

/**
 * Mem-parsing URL callback Supabase Auth (fragment hash dan query search)
 * secara murni tanpa mengubah URL browser.
 */
export function parseAuthCallbackUrl(href: string): AuthCallbackParseResult {
  let pathname = '/';
  let hashStr = '';
  let searchStr = '';

  try {
    const parsed = new URL(href, 'https://perpustakaan-merah-putih.vercel.app');
    pathname = parsed.pathname || '/';
    hashStr = parsed.hash.replace(/^#/, '');
    searchStr = parsed.search.replace(/^\?/, '');
  } catch {
    // Fallback parsing bila URL tidak lengkap
    const [beforeHash, afterHash = ''] = href.split('#');
    const [pathPart, afterSearch = ''] = beforeHash.split('?');
    pathname = pathPart || '/';
    hashStr = afterHash;
    searchStr = afterSearch;
  }

  const hashParams = new URLSearchParams(hashStr);
  const searchParams = new URLSearchParams(searchStr);

  const error = hashParams.get('error') || searchParams.get('error');
  const errorCode = hashParams.get('error_code') || searchParams.get('error_code');
  const errorDescription =
    hashParams.get('error_description') || searchParams.get('error_description');

  const hasAuthError = Boolean(error || errorCode || errorDescription);

  const type = hashParams.get('type') || searchParams.get('type');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const tokenHash = searchParams.get('token_hash') || searchParams.get('token');
  const code = searchParams.get('code');

  const isRecoveryType = type === 'recovery';
  const isImplicitRecovery = !hasAuthError && isRecoveryType && Boolean(accessToken);
  const isOtpRecovery = !hasAuthError && isRecoveryType && Boolean(tokenHash);
  const hasRecoveryIntent = !hasAuthError && (isImplicitRecovery || isOtpRecovery || isRecoveryType);

  return {
    pathname,
    hasAuthError,
    errorCode,
    errorDescription,
    type,
    accessToken,
    refreshToken,
    tokenHash,
    code,
    isImplicitRecovery,
    isOtpRecovery,
    hasRecoveryIntent,
  };
}

/**
 * Mengubah parameter error URL Supabase menjadi pesan berbahasa Indonesia yang jelas.
 */
export function formatRecoveryUrlError(
  parsed: Pick<AuthCallbackParseResult, 'hasAuthError' | 'errorCode' | 'errorDescription'>
): string | null {
  if (!parsed.hasAuthError) return null;

  const descLower = (parsed.errorDescription || '').toLowerCase();
  if (
    parsed.errorCode === 'otp_expired' ||
    descLower.includes('expired') ||
    descLower.includes('invalid')
  ) {
    return 'Tautan pemulihan password sudah kedaluwarsa atau pernah digunakan. Silakan ajukan tautan pemulihan baru di bawah ini.';
  }

  if (parsed.errorDescription) {
    try {
      return decodeURIComponent(parsed.errorDescription.replace(/\+/g, ' '));
    } catch {
      return parsed.errorDescription;
    }
  }

  return 'Tautan pemulihan password tidak valid. Silakan ajukan tautan pemulihan baru.';
}

/**
 * Validasi password baru & konfirmasi password sebelum dikirim ke Supabase.
 */
export function validateNewPasswordInput(
  newPassword: string,
  confirmPassword: string
): { valid: boolean; error: string | null } {
  if (!newPassword || newPassword.trim().length === 0) {
    return { valid: false, error: 'Password baru wajib diisi.' };
  }

  if (newPassword.length < 6) {
    return { valid: false, error: 'Password baru minimal harus 6 karakter.' };
  }

  if (newPassword !== confirmPassword) {
    return { valid: false, error: 'Konfirmasi password tidak cocok dengan password baru.' };
  }

  return { valid: true, error: null };
}

/**
 * Menentukan apakah tampilan root harus masuk ke ResetPasswordView.
 */
export function shouldRenderResetPasswordView(params: {
  isPasswordRecovery: boolean;
  isResetPasswordRoute: boolean;
  hasRecoveryError?: boolean;
}): boolean {
  return params.isPasswordRecovery || params.isResetPasswordRoute || Boolean(params.hasRecoveryError);
}

/**
 * Menentukan apakah halaman /reset-password menampilkan Kondisi 2 (form password baru)
 * atau Kondisi 1 (form permintaan tautan reset password).
 */
export function shouldShowNewPasswordForm(params: {
  isPasswordRecovery: boolean;
  hasRecoverySession: boolean;
  hasUrlError: boolean;
}): boolean {
  if (params.hasUrlError) return false;
  return params.isPasswordRecovery && params.hasRecoverySession;
}
