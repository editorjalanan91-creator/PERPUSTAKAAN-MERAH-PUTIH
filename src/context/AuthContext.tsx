import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Profile, UserRole } from '../types';
import {
  supabase,
  ADMIN_EMAIL,
  getSupabaseConfigError,
  recordActivityLog,
} from '../services/supabaseClient';
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
  login: (identifier: string, password: string) => Promise<User>;
  register: (payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<{ requiresVerification: boolean; email: string }>;
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
    return 'Terlalu banyak permintaan pendaftaran atau email verifikasi. Harap tunggu beberapa menit lalu coba kembali.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Email Anda belum dikonfirmasi. Harap periksa kotak masuk/spam email Anda dan klik tautan verifikasi sebelum masuk.';
  }

  if (lower.includes('invalid login credentials')) {
    return 'Username / email atau kata sandi tidak sesuai.';
  }

  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return 'Format alamat email tidak valid.';
  }

  if (lower.includes('password should be at least')) {
    return 'Kata sandi minimal harus 6 karakter.';
  }

  if (lower.includes('signup is disabled') || lower.includes('signups not allowed')) {
    return 'Pendaftaran akun baru saat ini dinonaktifkan pada pengaturan Supabase Auth.';
  }

  return msg || 'Terjadi kesalahan pada layanan autentikasi Supabase.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  // Bootstrap & Listen to Supabase Auth State Changes
  useEffect(() => {
    let isMounted = true;

    const resolveSessionUser = async (
      authUser: { id: string; email?: string | null; email_confirmed_at?: string | null } | null
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

      // Pengunjung wajib sudah memverifikasi email
      if (profile.role !== 'admin' && !authUser.email_confirmed_at) {
        await supabase.auth.signOut().catch(() => undefined);
        if (isMounted) setUser(null);
        return;
      }

      if (isMounted) setUser(profile);
    };

    const initAuth = async () => {
      try {
        if (getSupabaseConfigError()) {
          if (isMounted) setUser(null);
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        await resolveSessionUser(session?.user ?? null);
      } catch (err) {
        console.error('Error saat inisialisasi Supabase auth session:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await resolveSessionUser(session?.user ?? null);
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
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

    // Pengunjung wajib terverifikasi sebelum masuk
    if (profile.role !== 'admin' && !data.user.email_confirmed_at) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new Error('Email Anda belum diverifikasi. Harap buka tautan verifikasi yang dikirimkan ke email Anda terlebih dahulu.');
    }

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
        login,
        register,
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
