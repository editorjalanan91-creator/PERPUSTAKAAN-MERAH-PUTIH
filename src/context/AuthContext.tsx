import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Profile, UserRole } from '../types';
import {
  supabase,
  ADMIN_EMAIL,
  RESET_PASSWORD_REDIRECT_URL,
  getSupabaseConfigError,
  recordActivityLog,
  initialAuthCallback,
  isPasswordRecoveryActive,
  setPasswordRecoveryFlag,
  subscribeToAuthEvents,
} from '../services/supabaseClient';
import { formatRecoveryUrlError } from '../utils/authRecovery';
import { validateRegistration } from '../utils/libraryRules';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isAdmin: boolean;
  isUser: boolean;
  isPasswordRecovery: boolean;
  hasRecoverySession: boolean;
  recoveryEmail: string | null;
  recoveryLinkError: string | null;
  clearRecoveryLinkError: () => void;
  login: (identifier: string, password: string) => Promise<User>;
  register: (payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<{ requiresVerification: boolean; email: string }>;
  requestPasswordReset: (identifier: string) => Promise<{ email: string }>;
  confirmPasswordReset: (newPassword: string) => Promise<void>;
  clearPasswordRecovery: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: { full_name?: string; username?: string }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  // Notifications
  toasts: ToastMessage[];
  showToast: (message: string, type?: 'success' | 'error' | 'info', title?: string) => void;
  dismissToast: (id: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VALID_ROLES: UserRole[] = ['admin', 'visitor', 'user'];

function formatSupabaseAuthError(rawMessage: string): string {
  const msg = (rawMessage || '').trim();
  const lower = msg.toLowerCase();

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed')
  ) {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      return configErr;
    }
    return 'Gagal terhubung ke server Supabase (Failed to fetch). Pastikan URL Supabase benar, project Supabase aktif (tidak paused), dan koneksi internet/CORS tidak terblokir.';
  }

  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Alamat email tersebut sudah terdaftar. Silakan masuk atau gunakan email lain.';
  }

  if (lower.includes('email rate limit exceeded') || lower.includes('over_email_send_rate_limit')) {
    return 'Terlalu banyak permintaan ke server email. Harap tunggu beberapa menit lalu coba kembali.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Email Anda belum dikonfirmasi. Harap periksa kotak masuk/spam email Anda dan klik tautan verifikasi sebelum masuk.';
  }

  if (lower.includes('invalid login credentials')) {
    return 'Username / email atau kata sandi tidak sesuai.';
  }

  if (lower.includes('user is banned') || lower.includes('banned')) {
    return 'Akun pengunjung ini telah dinonaktifkan / diarsipkan oleh administrator perpustakaan.';
  }

  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return 'Format alamat email tidak valid.';
  }

  if (lower.includes('password should be at least') || lower.includes('new password should be different')) {
    if (lower.includes('different')) {
      return 'Kata sandi baru tidak boleh sama dengan kata sandi lama Anda.';
    }
    return 'Kata sandi minimal harus 6 karakter.';
  }

  if (lower.includes('signup is disabled') || lower.includes('signups not allowed')) {
    return 'Pendaftaran akun baru saat ini dinonaktifkan pada pengaturan Supabase Auth.';
  }

  if (lower.includes('auth session missing')) {
    return 'Sesi pemulihan password tidak ditemukan atau sudah kedaluwarsa. Silakan ajukan tautan pemulihan password baru.';
  }

  if (lower.includes('expired') || lower.includes('otp_expired') || lower.includes('token has expired')) {
    return 'Tautan pemulihan password sudah kedaluwarsa atau pernah digunakan. Silakan ajukan tautan pemulihan baru.';
  }

  return msg || 'Terjadi kesalahan pada layanan autentikasi Supabase.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(() => isPasswordRecoveryActive());
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean>(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [recoveryLinkError, setRecoveryLinkError] = useState<string | null>(() =>
    formatRecoveryUrlError(initialAuthCallback)
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const clearRecoveryLinkError = () => setRecoveryLinkError(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success', title?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { id, message, type, title };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      dismissToast(id);
    }, 5000);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  /**
   * Mengambil data profil dari tabel profiles berdasarkan UUID akun Supabase Auth.
   * Role wajib berasal dari tabel profiles di database.
   */
  const fetchUserProfile = async (authUserId: string, authEmail: string): Promise<User | null> => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUserId)
        .maybeSingle();

      if (error) {
        console.warn('Gagal mengambil data profil dari tabel profiles:', error.message);
        return null;
      }

      if (!profile || !VALID_ROLES.includes(profile.role as UserRole)) {
        return null;
      }

      return {
        id: profile.id,
        full_name: profile.full_name || 'Pengguna Perpustakaan',
        fullName: profile.full_name || 'Pengguna Perpustakaan',
        username: profile.username || authEmail.split('@')[0],
        role: profile.role as UserRole,
        is_active: profile.is_active,
        archived_at: profile.archived_at ?? null,
        created_at: profile.created_at,
        createdAt: profile.created_at,
        updated_at: profile.updated_at,
        email: authEmail,
      };
    } catch (err) {
      console.error('Error fetching user profile:', err);
      return null;
    }
  };

  // Bootstrap & Dengarkan perubahan state auth Supabase (termasuk PASSWORD_RECOVERY)
  useEffect(() => {
    let isMounted = true;
    let initCompleted = false;

    const resolveSessionUser = async (
      authUser: {
        id: string;
        email?: string | null;
        email_confirmed_at?: string | null;
        user_metadata?: Record<string, any>;
      } | null,
      inRecoveryFlow: boolean
    ) => {
      if (!authUser) {
        if (isMounted) setUser(null);
        return;
      }

      const profile = await fetchUserProfile(authUser.id, authUser.email || '');
      if (!profile) {
        if (isMounted) setUser(null);
        return;
      }

      const isArchivedAccount =
        profile.is_active === false ||
        Boolean(profile.archived_at) ||
        authUser.user_metadata?.is_active === false;

      if (!inRecoveryFlow && isArchivedAccount && profile.role !== 'admin') {
        await supabase.auth.signOut().catch(() => undefined);
        if (isMounted) setUser(null);
        return;
      }

      // Pengunjung wajib sudah memverifikasi email (jangan batalkan sesi saat proses recovery)
      if (!inRecoveryFlow && profile.role !== 'admin' && !authUser.email_confirmed_at) {
        await supabase.auth.signOut().catch(() => undefined);
        if (isMounted) setUser(null);
        return;
      }

      if (isMounted) setUser(profile);
    };

    const unsubscribe = subscribeToAuthEvents(async (event, session) => {
      if (!isMounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryFlag(true);
        setIsPasswordRecovery(true);
        setHasRecoverySession(Boolean(session?.user));
        setRecoveryEmail(session?.user?.email ?? null);
        setRecoveryLinkError(null);
        await resolveSessionUser(session?.user ?? null, true);
        if (isMounted && initCompleted) setIsLoading(false);
        return;
      }

      if (event === 'SIGNED_OUT') {
        setPasswordRecoveryFlag(false);
        setIsPasswordRecovery(false);
        setHasRecoverySession(false);
        setRecoveryEmail(null);
        setUser(null);
        if (isMounted && initCompleted) setIsLoading(false);
        return;
      }

      const recoveryActive = isPasswordRecoveryActive();
      if (recoveryActive && session?.user) {
        setIsPasswordRecovery(true);
        setHasRecoverySession(true);
        setRecoveryEmail(session.user.email ?? null);
      }

      await resolveSessionUser(session?.user ?? null, recoveryActive);
      if (isMounted && initCompleted) setIsLoading(false);
    });

    const initAuth = async () => {
      try {
        if (getSupabaseConfigError()) {
          if (isMounted) setUser(null);
          return;
        }

        // Tangani link recovery berbasis token_hash (jika template email mengirim ?token_hash=...&type=recovery)
        if (initialAuthCallback.isOtpRecovery && initialAuthCallback.tokenHash) {
          const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
            token_hash: initialAuthCallback.tokenHash,
            type: 'recovery',
          });

          // Bersihkan parameter token_hash dari URL setelah diverifikasi tanpa memicu reload
          if (typeof window !== 'undefined') {
            const cleanedUrl = new URL(window.location.href);
            cleanedUrl.searchParams.delete('token_hash');
            cleanedUrl.searchParams.delete('token');
            cleanedUrl.searchParams.delete('type');
            window.history.replaceState({}, '', `${cleanedUrl.pathname}${cleanedUrl.search}`);
          }

          if (otpError || !otpData.session?.user) {
            setPasswordRecoveryFlag(false);
            if (isMounted) {
              setIsPasswordRecovery(false);
              setHasRecoverySession(false);
              setRecoveryEmail(null);
              setRecoveryLinkError(
                formatSupabaseAuthError(
                  otpError?.message ||
                    'Tautan pemulihan password tidak valid atau sudah kedaluwarsa.'
                )
              );
            }
            return;
          }

          setPasswordRecoveryFlag(true);
          if (isMounted) {
            setIsPasswordRecovery(true);
            setHasRecoverySession(true);
            setRecoveryEmail(otpData.session.user.email ?? null);
            setRecoveryLinkError(null);
          }
          await resolveSessionUser(otpData.session.user, true);
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (initialAuthCallback.hasAuthError) {
          setPasswordRecoveryFlag(false);
          setIsPasswordRecovery(false);
          setHasRecoverySession(false);
          setRecoveryEmail(null);
          setRecoveryLinkError(formatRecoveryUrlError(initialAuthCallback));
          await resolveSessionUser(session?.user ?? null, false);
          return;
        }

        const recoveryActive = isPasswordRecoveryActive() || initialAuthCallback.isImplicitRecovery;

        if (recoveryActive && session?.user) {
          setPasswordRecoveryFlag(true);
          setIsPasswordRecovery(true);
          setHasRecoverySession(true);
          setRecoveryEmail(session.user.email ?? null);
          setRecoveryLinkError(null);
          await resolveSessionUser(session.user, true);
        } else if (initialAuthCallback.hasRecoveryIntent && !session?.user) {
          // URL membawa parameter recovery namun Supabase gagal membentuk sesi (kedaluwarsa / sudah dipakai)
          setPasswordRecoveryFlag(false);
          setIsPasswordRecovery(false);
          setHasRecoverySession(false);
          setRecoveryEmail(null);
          setRecoveryLinkError(
            'Tautan pemulihan password sudah kedaluwarsa atau pernah digunakan. Silakan ajukan tautan pemulihan baru.'
          );
          await resolveSessionUser(null, false);
        } else {
          if (!session?.user) {
            setPasswordRecoveryFlag(false);
            setIsPasswordRecovery(false);
            setHasRecoverySession(false);
            setRecoveryEmail(null);
          }
          await resolveSessionUser(session?.user ?? null, false);
        }
      } catch (err) {
        console.error('Error saat inisialisasi Supabase auth session:', err);
      } finally {
        initCompleted = true;
        if (isMounted) setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  /**
   * Login dengan Supabase Auth:
   * - Mendukung email pengunjung atau username 'Admin'
   * - Pemetaan username Admin -> VITE_ADMIN_EMAIL
   * - Validasi profil & role dari tabel profiles
   * - Validasi konfirmasi email untuk pengunjung
   */
  const login = async (identifier: string, password: string): Promise<User> => {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      throw new Error(configErr);
    }

    const trimmed = identifier.trim();
    let emailToUse = trimmed;

    // Jika user mengetik 'Admin' atau 'admin', petakan ke email admin resmi
    if (trimmed.toLowerCase() === 'admin') {
      emailToUse = ADMIN_EMAIL;
    }

    let authResult;
    try {
      authResult = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
    } catch (networkErr: any) {
      throw new Error(formatSupabaseAuthError(networkErr?.message || 'Failed to fetch'));
    }

    const { data, error } = authResult;

    if (error) {
      throw new Error(formatSupabaseAuthError(error.message));
    }

    if (!data.user) {
      throw new Error('Sesi autentikasi tidak ditemukan.');
    }

    // Ambil profil dari tabel profiles
    const profile = await fetchUserProfile(data.user.id, data.user.email || emailToUse);
    if (!profile) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new Error('Profil pengguna tidak ditemukan di database atau tidak memiliki role yang sah.');
    }

    if (
      profile.role !== 'admin' &&
      (profile.is_active === false ||
        Boolean(profile.archived_at) ||
        data.user.user_metadata?.is_active === false)
    ) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new Error('Akun pengunjung ini telah dinonaktifkan / diarsipkan oleh administrator perpustakaan.');
    }

    // Pengunjung wajib terverifikasi sebelum masuk
    if (profile.role !== 'admin' && !data.user.email_confirmed_at) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new Error('Email Anda belum diverifikasi. Harap buka tautan verifikasi yang dikirimkan ke email Anda terlebih dahulu.');
    }

    setPasswordRecoveryFlag(false);
    setIsPasswordRecovery(false);
    setHasRecoverySession(false);
    setRecoveryEmail(null);
    setUser(profile);

    // Catat log aktivitas login
    recordActivityLog(profile.id, 'login', 'profiles', profile.id, {
      role: profile.role,
      login_at: new Date().toISOString(),
    });

    showToast(
      profile.role === 'admin'
        ? 'Selamat datang di Panel Admin Perpustakaan Merah Putih!'
        : `Selamat datang kembali, ${profile.full_name}!`,
      'success',
      'Login Berhasil'
    );

    return profile;
  };

  /**
   * Registrasi Pengunjung dengan Supabase Auth
   * - Hanya menerima data pengunjung (tidak pernah mengirim role admin)
   * - Wajib verifikasi email sebelum login
   * - Tidak pernah mencatat password ke log
   */
  const register = async (payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ requiresVerification: boolean; email: string }> => {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      throw new Error(configErr);
    }

    const validation = validateRegistration(payload);
    if (!validation.valid) {
      throw new Error(Object.values(validation.errors)[0] || 'Data pendaftaran tidak valid.');
    }

    const cleanFullName = payload.fullName.trim();
    const cleanUsername = payload.username.trim();
    const cleanEmail = payload.email.trim().toLowerCase();

    // Mencegah pengunjung mendaftar dengan username atau email admin
    if (cleanUsername.toLowerCase() === 'admin' || cleanEmail === ADMIN_EMAIL.toLowerCase()) {
      throw new Error('Username atau email tersebut dikhususkan untuk administrator.');
    }

    const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;

    let signUpResult;
    try {
      signUpResult = await supabase.auth.signUp({
        email: cleanEmail,
        password: payload.password,
        options: {
          emailRedirectTo,
          data: {
            full_name: cleanFullName,
            username: cleanUsername,
          },
        },
      });
    } catch (networkErr: any) {
      throw new Error(formatSupabaseAuthError(networkErr?.message || 'Failed to fetch'));
    }

    const { data, error } = signUpResult;

    if (error) {
      throw new Error(formatSupabaseAuthError(error.message));
    }

    // Supabase mengembalikan identities kosong jika email sudah terdaftar dan proteksi enumerasi aktif
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Alamat email tersebut sudah terdaftar. Silakan periksa email verifikasi Anda atau gunakan menu Masuk.');
    }

    // Pastikan tidak ada sesi aktif sebelum email terverifikasi
    const requiresVerification = !data.user?.email_confirmed_at;
    if (data.session && requiresVerification) {
      await supabase.auth.signOut().catch(() => undefined);
    }

    showToast(
      'Pendaftaran berhasil! Tautan verifikasi telah dikirim ke email Anda. Harap verifikasi sebelum login.',
      'info',
      'Pendaftaran Akun Berhasil'
    );

    return {
      requiresVerification: true,
      email: cleanEmail,
    };
  };

  /**
   * Mengirim tautan pemulihan password menggunakan Supabase Auth resetPasswordForEmail().
   * - Mendukung username "Admin" (dipetakan ke VITE_ADMIN_EMAIL) atau email terdaftar langsung.
   * - Mengarahkan callback ke https://perpustakaan-merah-putih.vercel.app/reset-password.
   * - Tidak pernah membuat akun administrator baru maupun mengubah role.
   */
  const requestPasswordReset = async (identifier: string): Promise<{ email: string }> => {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      throw new Error(configErr);
    }

    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new Error('Harap masukkan username Admin atau alamat email terdaftar.');
    }

    let emailToUse = trimmed.toLowerCase();
    if (trimmed.toLowerCase() === 'admin') {
      emailToUse = ADMIN_EMAIL.trim().toLowerCase();
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailToUse)) {
      throw new Error('Format alamat email tidak valid. Masukkan username "Admin" atau email yang valid.');
    }

    let resetResult;
    try {
      resetResult = await supabase.auth.resetPasswordForEmail(emailToUse, {
        redirectTo: RESET_PASSWORD_REDIRECT_URL,
      });
    } catch (networkErr: any) {
      throw new Error(formatSupabaseAuthError(networkErr?.message || 'Failed to fetch'));
    }

    if (resetResult.error) {
      throw new Error(formatSupabaseAuthError(resetResult.error.message));
    }

    showToast(
      'Tautan pemulihan password telah dikirim ke email Anda. Periksa kotak masuk atau folder spam.',
      'info',
      'Email Pemulihan Terkirim'
    );

    return { email: emailToUse };
  };

  /**
   * Memperbarui kata sandi melalui sesi PASSWORD_RECOVERY menggunakan supabase.auth.updateUser({ password }).
   * - Tidak mengubah role pada tabel profiles.
   * - Tidak pernah mencatat password ke log.
   */
  const confirmPasswordReset = async (newPassword: string): Promise<void> => {
    const configErr = getSupabaseConfigError();
    if (configErr) {
      throw new Error(configErr);
    }

    if (!newPassword || newPassword.trim().length === 0 || newPassword.length < 6) {
      throw new Error('Kata sandi baru minimal harus 6 karakter.');
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      throw new Error('Sesi pemulihan password tidak ditemukan atau sudah kedaluwarsa. Silakan minta tautan pemulihan baru.');
    }

    let updateResult;
    try {
      updateResult = await supabase.auth.updateUser({
        password: newPassword,
      });
    } catch (networkErr: any) {
      throw new Error(formatSupabaseAuthError(networkErr?.message || 'Failed to fetch'));
    }

    if (updateResult.error) {
      throw new Error(formatSupabaseAuthError(updateResult.error.message));
    }

    // Catat log aktivitas pembaruan password tanpa menyertakan nilai password
    if (updateResult.data?.user?.id) {
      recordActivityLog(updateResult.data.user.id, 'password_recovery_completed', 'profiles', updateResult.data.user.id, {
        updated_at: new Date().toISOString(),
      });
    }

    // Keluarkan sesi sementara agar pengguna dapat masuk kembali dengan kata sandi baru secara eksplisit
    setPasswordRecoveryFlag(false);
    setIsPasswordRecovery(false);
    setHasRecoverySession(false);
    setRecoveryEmail(null);
    await supabase.auth.signOut().catch(() => undefined);
    setUser(null);

    showToast(
      'Password berhasil diperbarui! Silakan masuk menggunakan kata sandi baru Anda.',
      'success',
      'Password Diperbarui'
    );
  };

  const clearPasswordRecovery = async () => {
    const wasInRecovery = isPasswordRecovery || hasRecoverySession || isPasswordRecoveryActive();
    setPasswordRecoveryFlag(false);
    setIsPasswordRecovery(false);
    setHasRecoverySession(false);
    setRecoveryEmail(null);
    setRecoveryLinkError(null);
    if (wasInRecovery) {
      await supabase.auth.signOut().catch(() => undefined);
      setUser(null);
    }
    if (typeof window !== 'undefined' && window.location.pathname === '/reset-password') {
      window.history.replaceState({}, '', '/');
    }
  };

  /**
   * Logout dari Supabase Auth
   */
  const logout = async () => {
    try {
      if (user) {
        recordActivityLog(user.id, 'logout', 'profiles', user.id);
      }
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Error saat logout:', err);
    } finally {
      setPasswordRecoveryFlag(false);
      setIsPasswordRecovery(false);
      setHasRecoverySession(false);
      setRecoveryEmail(null);
      setUser(null);
      showToast('Anda telah keluar dari sistem.', 'info');
    }
  };

  /**
   * Perbarui informasi profil di tabel profiles (hanya nama lengkap / username, tidak pernah role)
   */
  const updateProfile = async (updates: { full_name?: string; username?: string }) => {
    if (!user) throw new Error('Harap login terlebih dahulu.');

    const safeUpdates: { full_name?: string; username?: string; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (updates.full_name !== undefined) {
      safeUpdates.full_name = updates.full_name.trim();
    }
    if (updates.username !== undefined && updates.username.trim().toLowerCase() !== 'admin') {
      safeUpdates.username = updates.username.trim();
    }

    const { error } = await supabase
      .from('profiles')
      .update(safeUpdates)
      .eq('id', user.id);

    if (error) {
      throw new Error(`Gagal memperbarui profil: ${error.message}`);
    }

    setUser((prev) =>
      prev
        ? {
            ...prev,
            full_name: safeUpdates.full_name ?? prev.full_name,
            fullName: safeUpdates.full_name ?? prev.fullName,
            username: safeUpdates.username ?? prev.username,
          }
        : null
    );
    showToast('Profil Anda berhasil diperbarui!', 'success');
  };

  const refreshProfile = async () => {
    if (!user) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const p = await fetchUserProfile(session.user.id, session.user.email || '');
      if (p) setUser(p);
    }
  };

  const isAdmin = user?.role === 'admin';
  const isUser = !!user && user.role !== 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user,
        isLoading,
        isAdmin,
        isUser,
        isPasswordRecovery,
        hasRecoverySession,
        recoveryEmail,
        recoveryLinkError,
        clearRecoveryLinkError,
        login,
        register,
        requestPasswordReset,
        confirmPasswordReset,
        clearPasswordRecovery,
        logout,
        updateProfile,
        refreshProfile,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
