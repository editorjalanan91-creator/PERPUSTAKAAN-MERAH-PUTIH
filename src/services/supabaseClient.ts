import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { parseAuthCallbackUrl, type AuthCallbackParseResult } from '../utils/authRecovery';
import { validateBookDocumentFile, validateCoverFile } from '../utils/libraryRules';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const rawSupabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  '';
const rawAdminEmail = import.meta.env.VITE_ADMIN_EMAIL ?? 'admin@perpustakaan.go.id';

function sanitizeEnvValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export const supabaseUrl = sanitizeEnvValue(rawSupabaseUrl).replace(/\/+$/, '');
export const supabasePublishableKey = sanitizeEnvValue(rawSupabaseKey);
export const ADMIN_EMAIL = sanitizeEnvValue(rawAdminEmail) || 'admin@perpustakaan.go.id';

export const PRODUCTION_APP_URL = 'https://perpustakaan-merah-putih.vercel.app';
const configuredAppUrl = sanitizeEnvValue(import.meta.env.VITE_APP_URL ?? '').replace(/\/+$/, '');
export const RESET_PASSWORD_REDIRECT_URL = `${configuredAppUrl || PRODUCTION_APP_URL}/reset-password`;

function isServiceRoleKeyAccidentallyExposed(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const decoded =
        typeof atob === 'function'
          ? atob(padded)
          : typeof Buffer !== 'undefined'
            ? Buffer.from(padded, 'base64').toString('utf8')
            : '';
      if (!decoded) return false;
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export const isSupabaseUrlValid =
  /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(supabaseUrl) &&
  !supabaseUrl.includes('your-project-ref') &&
  !supabaseUrl.includes('placeholder');

export const isFrontendKeyMisconfiguredSecret = isServiceRoleKeyAccidentallyExposed(
  supabasePublishableKey
);

export const isSupabaseKeyValid =
  supabasePublishableKey.length > 20 &&
  !supabasePublishableKey.includes('your-anon-or-publishable-key') &&
  !supabasePublishableKey.includes('your-supabase-publishable') &&
  !isFrontendKeyMisconfiguredSecret;

export const isSupabaseConfigured = isSupabaseUrlValid && isSupabaseKeyValid;

export function getSupabaseHostLabel(): string | null {
  if (!isSupabaseUrlValid) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl) {
    return 'Konfigurasi VITE_SUPABASE_URL belum diatur. Tambahkan pada Environment Variables (Vercel / .env) lalu build ulang aplikasi.';
  }
  if (!supabaseUrlValidSafe(supabaseUrl)) {
    return 'Format VITE_SUPABASE_URL tidak valid. Pastikan menggunakan URL project Supabase yang benar (contoh: https://xxxx.supabase.co) tanpa tanda kutip.';
  }
  if (isFrontendKeyMisconfiguredSecret) {
    return 'Konfigurasi keamanan tidak valid: VITE_SUPABASE_PUBLISHABLE_KEY terdeteksi menggunakan Secret / Service Role Key. Kunci rahasia hanya boleh dipasang di SUPABASE_SERVICE_ROLE_KEY (server).';
  }
  if (!supabasePublishableKey || !isSupabaseKeyValid) {
    return 'Konfigurasi VITE_SUPABASE_PUBLISHABLE_KEY belum diatur atau masih menggunakan nilai contoh. Salin Publishable / Anon Key dari Supabase Dashboard > Project Settings > API.';
  }
  return null;
}

export interface BrowserSupabaseProbeResult {
  ok: boolean;
  kind: 'ok' | 'config' | 'auth_key' | 'network' | 'http_error';
  status?: number;
  host: string | null;
  error: string | null;
}

/**
 * Menguji koneksi aktual dari browser ke endpoint Supabase Auth (/auth/v1/settings)
 * tanpa membaca cache/localStorage agar status koneksi selalu real-time.
 */
export async function probeBrowserSupabaseConnection(
  timeoutMs = 8000
): Promise<BrowserSupabaseProbeResult> {
  const host = getSupabaseHostLabel();
  const configErr = getSupabaseConfigError();
  if (configErr) {
    return {
      ok: false,
      kind: 'config',
      host,
      error: configErr,
    };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof setTimeout === 'function'
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        apikey: supabasePublishableKey,
      },
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        kind: 'auth_key',
        status: response.status,
        host,
        error: `Publishable / Anon Key pada VITE_SUPABASE_PUBLISHABLE_KEY ditolak oleh server Supabase${host ? ` (${host})` : ''} (HTTP ${response.status}). Pastikan key berasal dari project Supabase yang sama.`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: 'http_error',
        status: response.status,
        host,
        error: `Server Supabase${host ? ` (${host})` : ''} merespons dengan status HTTP ${response.status}. Periksa status project di Supabase Dashboard.`,
      };
    }

    return {
      ok: true,
      kind: 'ok',
      status: response.status,
      host,
      error: null,
    };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    const targetInfo = host ? ` ke host "${host}"` : '';
    const offlineHint =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? ' Browser terdeteksi sedang offline.'
        : '';

    return {
      ok: false,
      kind: 'network',
      host,
      error: isAbort
        ? `Koneksi browser ke server Supabase${targetInfo} melebihi batas waktu (timeout). Periksa jaringan atau status project Supabase.`
        : `Gagal terhubung ke server Supabase${targetInfo} (Failed to fetch).${offlineHint} Periksa URL VITE_SUPABASE_URL, resolusi DNS, CORS/CSP, dan pastikan build terbaru sudah terpasang.`,
    };
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function supabaseUrlValidSafe(url: string): boolean {
  return (
    /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(url) &&
    !url.includes('your-project-ref') &&
    !url.includes('placeholder')
  );
}

if (!isSupabaseConfigured) {
  console.warn(
    '[PERPUSTAKAAN MERAH PUTIH] Konfigurasi Supabase belum lengkap:',
    getSupabaseConfigError()
  );
}

/**
 * Snapshot URL callback secara sinkron SEBELUM createClient() berjalan,
 * karena GoTrueClient akan langsung membersihkan window.location.hash saat inisialisasi.
 */
export const initialAuthCallback: AuthCallbackParseResult =
  typeof window !== 'undefined'
    ? parseAuthCallbackUrl(window.location.href)
    : parseAuthCallbackUrl('/');

const RECOVERY_STORAGE_KEY = 'pmp_password_recovery_active';

function readStoredRecoveryFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(RECOVERY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let passwordRecoveryActive = false;

if (initialAuthCallback.hasAuthError) {
  passwordRecoveryActive = false;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
} else if (initialAuthCallback.isImplicitRecovery || initialAuthCallback.isOtpRecovery) {
  passwordRecoveryActive = true;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  }
} else {
  passwordRecoveryActive = readStoredRecoveryFlag();
}

export function setPasswordRecoveryFlag(active: boolean): void {
  passwordRecoveryActive = active;
  if (typeof window !== 'undefined') {
    try {
      if (active) {
        window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, '1');
      } else {
        window.sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }
}

export function isPasswordRecoveryActive(): boolean {
  return passwordRecoveryActive || readStoredRecoveryFlag();
}

export const supabase = createClient(
  isSupabaseUrlValid ? supabaseUrl : 'https://placeholder-not-configured.supabase.co',
  supabasePublishableKey || 'placeholder-publishable-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

type AuthEventSubscriber = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>;
const authEventSubscribers = new Set<AuthEventSubscriber>();

/**
 * Satu listener onAuthStateChange tunggal di level modul agar event PASSWORD_RECOVERY
 * selalu tertangkap sejak detik pertama inisialisasi client tanpa duplikasi listener.
 */
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    setPasswordRecoveryFlag(true);
  } else if (event === 'SIGNED_OUT') {
    setPasswordRecoveryFlag(false);
  }

  for (const subscriber of authEventSubscribers) {
    try {
      await subscriber(event, session);
    } catch (err) {
      console.error('Error pada subscriber auth state:', err);
    }
  }
});

export function subscribeToAuthEvents(subscriber: AuthEventSubscriber): () => void {
  authEventSubscribers.add(subscriber);
  return () => {
    authEventSubscribers.delete(subscriber);
  };
}

/**
 * Storage Bucket Constants
 */
export const BUCKET_COVERS = 'book-covers'; // Public bucket
export const BUCKET_FILES = 'book-files';   // Private bucket (PDF & EPUB)

/**
 * Mendapatkan Public URL untuk sampul buku dari bucket public book-covers
 */
export function getBookCoverUrl(coverPath: string | null | undefined): string {
  if (!coverPath) {
    return 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80';
  }
  // Jika sudah URL lengkap (http/https), gunakan langsung
  if (coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
    return coverPath;
  }
  const { data } = supabase.storage.from(BUCKET_COVERS).getPublicUrl(coverPath);
  return data.publicUrl;
}

/**
 * Unggah foto sampul buku ke bucket public 'book-covers'
 */
export async function uploadBookCover(file: File): Promise<string> {
  const validation = validateCoverFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Berkas foto sampul tidak valid.');
  }

  const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
  const filePath = `covers/${fileName}`;

  const { error } = await supabase.storage
    .from(BUCKET_COVERS)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw new Error(`Gagal mengunggah sampul buku: ${error.message}`);
  }

  return filePath;
}

/**
 * Unggah file buku (PDF / EPUB) ke bucket private 'book-files'
 */
export async function uploadBookFile(file: File): Promise<{ filePath: string; fileType: 'pdf' | 'epub' }> {
  const validation = validateBookDocumentFile(file);
  if (!validation.valid || !validation.fileType) {
    throw new Error(validation.error || 'Berkas dokumen buku tidak valid.');
  }

  const fileType = validation.fileType;
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileType}`;
  const filePath = `documents/${fileName}`;

  const { error } = await supabase.storage
    .from(BUCKET_FILES)
    .upload(filePath, file, {
      contentType: fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip',
      upsert: false,
    });

  if (error) {
    throw new Error(`Gagal mengunggah dokumen buku: ${error.message}`);
  }

  return { filePath, fileType };
}

/**
 * Pencatatan Riwayat Aktivitas ke tabel activity_logs
 */
export async function recordActivityLog(
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string,
  details?: any
) {
  try {
    await supabase.from('activity_logs').insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details ? JSON.stringify(details) : null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Gagal mencatat log aktivitas:', err);
  }
}
