import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAuthCallbackUrl,
  formatRecoveryUrlError,
  validateNewPasswordInput,
  shouldRenderResetPasswordView,
  shouldShowNewPasswordForm,
} from './authRecovery';

test('parseAuthCallbackUrl - detects implicit recovery hash on /reset-password', () => {
  const parsed = parseAuthCallbackUrl(
    'https://perpustakaan-merah-putih.vercel.app/reset-password#access_token=abc123&expires_in=3600&refresh_token=ref456&token_type=bearer&type=recovery'
  );
  assert.equal(parsed.pathname, '/reset-password');
  assert.equal(parsed.hasAuthError, false);
  assert.equal(parsed.type, 'recovery');
  assert.equal(parsed.accessToken, 'abc123');
  assert.equal(parsed.isImplicitRecovery, true);
  assert.equal(parsed.isOtpRecovery, false);
  assert.equal(parsed.hasRecoveryIntent, true);
});

test('parseAuthCallbackUrl - detects implicit recovery hash even when redirected to root /', () => {
  const parsed = parseAuthCallbackUrl(
    'https://perpustakaan-merah-putih.vercel.app/#access_token=tok999&type=recovery'
  );
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.isImplicitRecovery, true);
  assert.equal(parsed.hasRecoveryIntent, true);
});

test('parseAuthCallbackUrl - detects OTP token_hash recovery query parameters', () => {
  const parsed = parseAuthCallbackUrl(
    'https://perpustakaan-merah-putih.vercel.app/reset-password?token_hash=pkce_hash_123&type=recovery'
  );
  assert.equal(parsed.isOtpRecovery, true);
  assert.equal(parsed.tokenHash, 'pkce_hash_123');
  assert.equal(parsed.hasRecoveryIntent, true);
});

test('parseAuthCallbackUrl - ignores recovery intent when callback contains error', () => {
  const parsed = parseAuthCallbackUrl(
    'https://perpustakaan-merah-putih.vercel.app/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
  );
  assert.equal(parsed.hasAuthError, true);
  assert.equal(parsed.errorCode, 'otp_expired');
  assert.equal(parsed.isImplicitRecovery, false);
  assert.equal(parsed.hasRecoveryIntent, false);

  const errMsg = formatRecoveryUrlError(parsed);
  assert.ok(errMsg && errMsg.includes('kedaluwarsa'));
});

test('validateNewPasswordInput - validates length, whitespace, and confirmation match', () => {
  assert.equal(validateNewPasswordInput('', '').valid, false);
  assert.equal(validateNewPasswordInput('      ', '      ').valid, false);
  assert.equal(validateNewPasswordInput('12345', '12345').valid, false);
  assert.equal(validateNewPasswordInput('Rahasia123', 'Rahasia456').valid, false);
  assert.deepEqual(validateNewPasswordInput('Rahasia123', 'Rahasia123'), {
    valid: true,
    error: null,
  });
});

test('shouldRenderResetPasswordView & shouldShowNewPasswordForm - enforces Condition 1 vs Condition 2', () => {
  // User opened /reset-password manually (Condition 1)
  assert.equal(
    shouldRenderResetPasswordView({ isPasswordRecovery: false, isResetPasswordRoute: true }),
    true
  );
  assert.equal(
    shouldShowNewPasswordForm({
      isPasswordRecovery: false,
      hasRecoverySession: false,
      hasUrlError: false,
    }),
    false
  );

  // Supabase emitted PASSWORD_RECOVERY with valid session (Condition 2)
  assert.equal(
    shouldRenderResetPasswordView({ isPasswordRecovery: true, isResetPasswordRoute: false }),
    true
  );
  assert.equal(
    shouldShowNewPasswordForm({
      isPasswordRecovery: true,
      hasRecoverySession: true,
      hasUrlError: false,
    }),
    true
  );

  // Link expired -> stays in Condition 1 with error even if stale flag was present
  assert.equal(
    shouldShowNewPasswordForm({
      isPasswordRecovery: true,
      hasRecoverySession: false,
      hasUrlError: true,
    }),
    false
  );
});
