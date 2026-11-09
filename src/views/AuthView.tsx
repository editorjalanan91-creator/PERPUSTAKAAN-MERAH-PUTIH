import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BookOpen, User, Lock, Mail, UserPlus, LogIn, Eye, EyeOff } from 'lucide-react';

interface AuthViewProps {
  initialMode?: 'login' | 'register';
}

export const AuthView: React.FC<AuthViewProps> = ({ initialMode = 'login' }) => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [regFullName, setRegFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Status
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!loginUsername.trim() || !loginPassword) {
      setErrorMessage('Harap masukkan username dan password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(loginUsername.trim(), loginPassword);
    } catch (err: any) {
      setErrorMessage(err.message || 'Login gagal. Periksa kembali username dan password Anda.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (regPassword !== regConfirmPassword) {
      setErrorMessage('Konfirmasi password tidak cocok.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        fullName: regFullName,
        username: regUsername,
        email: regEmail,
        password: regPassword,
        confirmPassword: regConfirmPassword,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Pendaftaran gagal. Silakan periksa kembali data Anda.');
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

      {/* Main Container */}
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
            Sistem Informasi Perpustakaan Terpadu. Akses koleksi literatur berbobot dan kelola peminjaman secara digital.
          </p>
        </div>

        {/* Card Box */}
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden ring-1 ring-slate-700/50">
          {/* Tabs */}
          <div className="grid grid-cols-2 p-1.5 bg-slate-950/60 border-b border-slate-800 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-200 ${
                mode === 'login'
                  ? 'bg-blue-950 text-amber-400 shadow-md border border-amber-500/20 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Masuk (Login)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl transition-all duration-200 ${
                mode === 'register'
                  ? 'bg-blue-950 text-amber-400 shadow-md border border-amber-500/20 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Daftar Pengunjung</span>
            </button>
          </div>

          <div className="p-6 sm:p-8">
            {/* Error Notification Banner */}
            {errorMessage && (
              <div className="mb-6 p-4 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-200 text-sm flex items-start gap-3">
                <span className="shrink-0 mt-0.5 font-bold">⚠️</span>
                <div className="flex-1">{errorMessage}</div>
              </div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Username atau Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="Masukkan username Anda"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Masukkan password Anda"
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                      aria-label="Toggle password visibility"
                    >
                      {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      <span>Masuk ke Perpustakaan</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Nama Lengkap
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      placeholder="Contoh: Budi Santoso"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="budisantoso"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="budi@email.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Password (Minimal 6 karakter)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Buat password aman"
                      className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200"
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Konfirmasi Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Ketik ulang password"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 leading-relaxed">
                  💡 Dengan mendaftar, Anda akan mendapatkan akun anggota resmi perpustakaan dan dapat meminjam koleksi buku yang tersedia secara digital.
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Daftar Akun Pengunjung</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>© 2026 PERPUSTAKAAN MERAH PUTIH • Dilindungi Enkripsi &amp; Otorisasi RBAC</p>
        </div>
      </div>
    </div>
  );
};
