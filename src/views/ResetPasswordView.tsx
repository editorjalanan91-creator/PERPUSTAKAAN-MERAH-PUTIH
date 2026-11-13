import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  shouldShowNewPasswordForm,
  validateNewPasswordInput,
} from '../utils/authRecovery';
import {
  BookOpen,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
  Mail,
  Send,
  ShieldCheck,
} from 'lucide-react';

interface ResetPasswordViewProps {
  onBackToLogin: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({ onBackToLogin }) => {
  const {
    isPasswordRecovery,
    hasRecoverySession,
    recoveryEmail,
    recoveryLinkError,
    clearRecoveryLinkError,
    user,
    confirmPasswordReset,
    requestPasswordReset,
  } = useAuth();

  // Form update password baru (Kondisi 2: saat event PASSWORD_RECOVERY aktif)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Form kirim tautan pemulihan (Kondisi 1: belum ada sesi recovery)
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPasswordUpdated, setIsPasswordUpdated] = useState(false);

  const displayedError = errorMessage || recoveryLinkError;
  const activeEmail = recoveryEmail || user?.email || null;

  const hasActiveRecoveryForm = shouldShowNewPasswordForm({
    isPasswordRecovery,
    hasRecoverySession,
    hasUrlError: Boolean(recoveryLinkError),
  });

  useEffect(() => {
    // Bersihkan hash error dari URL setelah dibaca oleh AuthContext agar URL bersih
    if (typeof window !== 'undefined' && window.location.hash.includes('error=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Setelah password berhasil diperbarui, arahkan pengguna ke halaman login secara otomatis
  useEffect(() => {
    if (!isPasswordUpdated) return;
    const timer = window.setTimeout(() => {
      onBackToLogin();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [isPasswordUpdated, onBackToLogin]);

  const handleUpdatePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearRecoveryLinkError();

    const validation = validateNewPasswordInput(newPassword, confirmPassword);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Password baru tidak valid.');
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset(newPassword);
      setIsPasswordUpdated(true);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memperbarui kata sandi. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearRecoveryLinkError();

    if (!recoveryIdentifier.trim()) {
      setErrorMessage('Masukkan username Admin atau alamat email terdaftar.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await requestPasswordReset(recoveryIdentifier);
      setSentToEmail(res.email);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mengirim email pemulihan password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Background ambient lighting in Navy & Gold */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-900/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="relative w-full max-w-lg z-10">
        {/* Header Emblem */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-900 via-slate-900 to-amber-600/40 p-0.5 shadow-2xl shadow-blue-950/80 mb-4 ring-1 ring-amber-400/30">
            <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center">
              <BookOpen className="w-10 h-10 text-amber-400 drop-shadow-[0_2px_8px_rgba(251,191,36,0.5)]" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-brand">
            PERPUSTAKAAN MERAH PUTIH
          </h1>
          <p className="text-sm text-slate-400 max-w-sm mx-auto">
            Pemulihan kata sandi akun untuk mengakses layanan Perpustakaan Merah Putih.
          </p>
        </div>

        {/* Card Box */}
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden ring-1 ring-slate-700/50">
          {isPasswordUpdated ? (
            /* Layar Berhasil Reset Password */
            <div key="reset-success" className="p-8 text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-white mb-1.5 font-brand">
                  Password Berhasil Diperbarui
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                  Kata sandi akun Anda telah diperbarui dengan aman. Mengalihkan ke halaman masuk...
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs text-slate-400 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Silakan masuk kembali menggunakan username <strong className="text-amber-400">Admin</strong> (atau email terdaftar Anda) dan kata sandi baru yang telah ditetapkan.
                </span>
              </div>

              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Masuk ke Halaman Login</span>
              </button>
            </div>
          ) : hasActiveRecoveryForm ? (
            /* Kondisi 2: Form Buat Password Baru (Event PASSWORD_RECOVERY) */
            <div key="reset-new-password" className="p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
                <div className="w-10 h-10 rounded-xl bg-blue-950 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Tetapkan Kata Sandi Baru</h2>
                  <p className="text-xs text-slate-400">
                    {activeEmail
                      ? `Pemulihan untuk akun: ${activeEmail}`
                      : 'Masukkan kata sandi baru untuk akun Anda.'}
                  </p>
                </div>
              </div>

              {displayedError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-sm flex items-start gap-3"
                >
                  <span className="shrink-0 mt-0.5 font-bold">⚠️</span>
                  <div className="flex-1">{displayedError}</div>
                </div>
              )}

              <form onSubmit={handleUpdatePasswordSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="reset-new-password"
                    className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5"
                  >
                    Password Baru
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="reset-new-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 6 karakter"
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5"
                  >
                    Konfirmasi Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="reset-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ulangi password baru"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 transition-all"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>Menyimpan Password...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Simpan Password</span>
                    </>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors pt-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Batal &amp; Kembali ke Halaman Masuk</span>
              </button>
            </div>
          ) : sentToEmail ? (
            /* Notifikasi Email Reset Terkirim */
            <div key="reset-email-sent" className="p-8 text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <Mail className="w-9 h-9" />
              </div>

              <div>
                <h2 className="text-lg font-bold text-white mb-1.5 font-brand">
                  Tautan Pemulihan Terkirim
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                  Tautan pemulihan kata sandi telah dikirimkan ke alamat email terdaftar:
                </p>
                <p className="text-sm font-semibold text-amber-400 mt-1 font-mono">
                  {sentToEmail}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs text-slate-400 space-y-1.5">
                <p className="font-semibold text-slate-300">Langkah selanjutnya:</p>
                <ol className="list-decimal list-inside space-y-1 text-[11px]">
                  <li>Buka kotak masuk atau folder spam email Anda.</li>
                  <li>Klik tautan reset password untuk diarahkan ke halaman pemulihan.</li>
                  <li>Masukkan password baru dan konfirmasi password Anda.</li>
                </ol>
              </div>

              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Kembali ke Halaman Masuk</span>
              </button>
            </div>
          ) : (
            /* Kondisi 1: Form Kirim Tautan Reset Password (jika dibuka tanpa sesi recovery aktif) */
            <div key="reset-request-form" className="p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
                <div className="w-10 h-10 rounded-xl bg-blue-950 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Kirim Tautan Pemulihan Password</h2>
                  <p className="text-xs text-slate-400">
                    Masukkan username <strong className="text-amber-400">Admin</strong> atau email akun terdaftar.
                  </p>
                </div>
              </div>

              {displayedError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-sm flex items-start gap-3"
                >
                  <span className="shrink-0 mt-0.5 font-bold">⚠️</span>
                  <div className="flex-1">{displayedError}</div>
                </div>
              )}

              <form onSubmit={handleRequestResetSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="recovery-identifier"
                    className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2"
                  >
                    Username Admin atau Email Terdaftar
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      id="recovery-identifier"
                      type="text"
                      required
                      value={recoveryIdentifier}
                      onChange={(e) => setRecoveryIdentifier(e.target.value)}
                      placeholder="Ketik 'Admin' atau email terdaftar"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 transition-all"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>Mengirim Tautan Pemulihan...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Kirim Tautan Reset Password</span>
                    </>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors pt-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Halaman Masuk</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>© 2026 PERPUSTAKAAN MERAH PUTIH • Sistem Informasi Perpustakaan Digital</p>
        </div>
      </div>
    </div>
  );
};
