import { createClient } from '@supabase/supabase-js';

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

export const isSupabaseUrlValid =
  /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(supabaseUrl) &&
  !supabaseUrl.includes('your-project-ref') &&
  !supabaseUrl.includes('placeholder');

export const isSupabaseKeyValid =
  supabasePublishableKey.length > 20 &&
  !supabasePublishableKey.includes('your-anon-or-publishable-key') &&
  !supabasePublishableKey.includes('your-supabase-publishable');

export const isSupabaseConfigured = isSupabaseUrlValid && isSupabaseKeyValid;

export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl) {
    return 'Konfigurasi VITE_SUPABASE_URL belum diatur. Tambahkan pada Environment Variables (Vercel / .env) lalu build ulang aplikasi.';
  }
  if (!isSupabaseUrlValid) {
    return 'Format VITE_SUPABASE_URL tidak valid. Pastikan menggunakan URL project Supabase yang benar (contoh: https://xxxx.supabase.co) tanpa tanda kutip.';
  }
  if (!supabasePublishableKey || !isSupabaseKeyValid) {
    return 'Konfigurasi VITE_SUPABASE_PUBLISHABLE_KEY belum diatur atau masih menggunakan nilai contoh. Salin Publishable / Anon Key dari Supabase Dashboard > Project Settings > API.';
  }
  return null;
}

if (!isSupabaseConfigured) {
  console.warn(
    '[PERPUSTAKAAN MERAH PUTIH] Konfigurasi Supabase belum lengkap:',
    getSupabaseConfigError()
  );
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
 * Mendapatkan Signed URL untuk file buku privat dari bucket book-files
 * Hanya dapat diakses dengan masa berlaku tertentu (misal: 60 menit)
 */
export async function getBookFileSignedUrl(
  filePath: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!filePath) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET_FILES)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    console.error('Gagal membuat signed URL untuk file buku:', error);
    return null;
  }
  return data.signedUrl;
}

/**
 * Unggah foto sampul buku ke bucket public 'book-covers'
 */
export async function uploadBookCover(file: File): Promise<string> {
  const fileExt = file.name.split('.').pop();
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
  const ext = file.name.split('.').pop()?.toLowerCase();
  const fileType: 'pdf' | 'epub' = ext === 'epub' ? 'epub' : 'pdf';
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
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
