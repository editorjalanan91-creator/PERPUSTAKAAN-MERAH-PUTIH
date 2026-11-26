import express, { NextFunction, Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateVisitorArchiveEligibility,
  evaluateVisitorRemovalEligibility,
  evaluateVisitorRestoreEligibility,
  isAdminOrSuperAdminRole,
  isValidUuid,
} from '../utils/visitorDeletion';
import {
  computeBookStockAfterApprove,
  computeBookStockAfterReturn,
  evaluateActiveLoansReadAccess,
  evaluateLoanReturnEligibility,
  formatBookReturnErrorMessage,
  recalculateBookStockOnEdit,
} from '../utils/libraryRules';
import {
  hasPdfMagicBytes,
  hasZipMagicBytes,
  resolveDocumentFileType,
  sanitizeDownloadFilename,
} from '../utils/epubUtils';

function sanitizeEnv(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function getSuperAdminUids(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = sanitizeEnv(env.SUPABASE_SUPER_ADMIN_UIDS);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTargetAuthSuperAdmin(authUser: any): boolean {
  if (!authUser) return false;
  const appMeta = (authUser.app_metadata || {}) as Record<string, any>;
  return appMeta.is_super_admin === true || appMeta.role === 'super_admin';
}

function isMissingColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
}

export type ServiceRoleKeyStatus =
  | 'valid_service_role_jwt'
  | 'valid_secret_key'
  | 'invalid_publishable_key'
  | 'invalid_anon_jwt'
  | 'invalid_placeholder'
  | 'missing'
  | 'unrecognized_format';

export interface ServerSupabaseEnvInspection {
  url: string;
  authApiKey: string;
  serviceRoleKey: string;
  hasSupabaseUrl: boolean;
  hasServiceRoleKey: boolean;
  isServiceRoleKeyValid: boolean;
  keyStatus: ServiceRoleKeyStatus;
  hasUrlMismatch: boolean;
  error?: string;
}

function decodeJwtRoleClaim(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function inspectServerSupabaseEnv(
  env: Record<string, string | undefined> = process.env
): ServerSupabaseEnvInspection {
  const rawServerUrl = sanitizeEnv(env.SUPABASE_URL).replace(/\/+$/, '');
  const rawViteUrl = sanitizeEnv(env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  const url = rawServerUrl || rawViteUrl;
  const hasUrlMismatch = Boolean(
    rawServerUrl &&
      rawViteUrl &&
      rawServerUrl.toLowerCase() !== rawViteUrl.toLowerCase()
  );
  const serviceRoleKey = sanitizeEnv(env.SUPABASE_SERVICE_ROLE_KEY);
  const authApiKey =
    sanitizeEnv(
      env.SUPABASE_ANON_KEY ||
        env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        env.VITE_SUPABASE_ANON_KEY
    ) || serviceRoleKey;

  const hasSupabaseUrl = Boolean(
    url &&
      /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(url) &&
      !url.includes('your-project-ref') &&
      !url.includes('placeholder')
  );

  if (!hasSupabaseUrl) {
    return {
      url: '',
      authApiKey: '',
      serviceRoleKey: '',
      hasSupabaseUrl: false,
      hasServiceRoleKey: Boolean(serviceRoleKey),
      isServiceRoleKeyValid: false,
      keyStatus: serviceRoleKey ? 'unrecognized_format' : 'missing',
      hasUrlMismatch,
      error:
        'Konfigurasi server SUPABASE_URL / VITE_SUPABASE_URL belum diatur atau belum valid pada Environment Variables server.',
    };
  }

  if (hasUrlMismatch) {
    return {
      url,
      authApiKey,
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: Boolean(serviceRoleKey),
      isServiceRoleKeyValid: false,
      keyStatus: serviceRoleKey.startsWith('sb_secret_')
        ? 'valid_secret_key'
        : 'unrecognized_format',
      hasUrlMismatch: true,
      error:
        'Konfigurasi SUPABASE_URL dan VITE_SUPABASE_URL menunjuk Project Supabase yang berbeda. Samakan kedua URL pada Environment Variables agar verifikasi token dan akses database konsisten.',
    };
  }

  if (!serviceRoleKey) {
    return {
      url,
      authApiKey,
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: false,
      isServiceRoleKeyValid: false,
      keyStatus: 'missing',
      hasUrlMismatch,
      error:
        'Konfigurasi server SUPABASE_SERVICE_ROLE_KEY belum diatur pada Environment Variables server (Vercel / .env). Kunci rahasia ini hanya boleh dipasang di server, bukan di frontend.',
    };
  }

  if (serviceRoleKey.includes('your-supabase-service-role-key')) {
    return {
      url,
      authApiKey,
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: false,
      isServiceRoleKeyValid: false,
      keyStatus: 'invalid_placeholder',
      hasUrlMismatch,
      error:
        'Konfigurasi server SUPABASE_SERVICE_ROLE_KEY masih menggunakan nilai contoh. Isi dengan Secret / Service Role Key asli dari Supabase Dashboard.',
    };
  }

  if (serviceRoleKey.startsWith('sb_publishable_')) {
    return {
      url,
      authApiKey,
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: false,
      keyStatus: 'invalid_publishable_key',
      hasUrlMismatch,
      error:
        'Konfigurasi SUPABASE_SERVICE_ROLE_KEY di server terdeteksi menggunakan Publishable Key (sb_publishable_...), bukan Secret Key (sb_secret_... / service_role). Perbarui Environment Variable SUPABASE_SERVICE_ROLE_KEY di Vercel.',
    };
  }

  if (serviceRoleKey.startsWith('sb_secret_')) {
    return {
      url,
      authApiKey,
      serviceRoleKey,
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: true,
      keyStatus: 'valid_secret_key',
      hasUrlMismatch,
    };
  }

  const jwtRole = decodeJwtRoleClaim(serviceRoleKey);
  if (jwtRole === 'anon' || jwtRole === 'authenticated') {
    return {
      url,
      authApiKey,
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: false,
      keyStatus: 'invalid_anon_jwt',
      hasUrlMismatch,
      error: `Konfigurasi SUPABASE_SERVICE_ROLE_KEY di server terdeteksi menggunakan kunci ber-role "${jwtRole}", bukan "service_role". Perbarui Environment Variable SUPABASE_SERVICE_ROLE_KEY di Vercel dengan Service Role Key Supabase.`,
    };
  }

  if (jwtRole === 'service_role') {
    return {
      url,
      authApiKey,
      serviceRoleKey,
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: true,
      keyStatus: 'valid_service_role_jwt',
      hasUrlMismatch,
    };
  }

  return {
    url,
    authApiKey,
    serviceRoleKey: '',
    hasSupabaseUrl: true,
    hasServiceRoleKey: true,
    isServiceRoleKeyValid: false,
    keyStatus: 'unrecognized_format',
    hasUrlMismatch,
    error:
      'Format SUPABASE_SERVICE_ROLE_KEY di server tidak dikenali. Pastikan menggunakan Secret Key (sb_secret_...) atau Service Role JWT yang valid dari Supabase Dashboard.',
  };
}

export type PublishableKeyStatus =
  | 'valid_publishable_or_anon'
  | 'invalid_secret_key_exposed'
  | 'invalid_placeholder'
  | 'missing';

export interface VercelEnvChecklistResult {
  hasServerSupabaseUrl: boolean;
  hasViteSupabaseUrl: boolean;
  supabaseUrlHost: string | null;
  hasUrlMismatch: boolean;
  hasVitePublishableKey: boolean;
  isVitePublishableKeySafe: boolean;
  vitePublishableKeyStatus: PublishableKeyStatus;
  hasViteAppUrl: boolean;
  viteAppUrlValid: boolean;
  viteAppUrl: string | null;
  hasViteAdminEmail: boolean;
  hasServiceRoleKey: boolean;
  serviceRoleKeyValid: boolean;
  serviceRoleKeyStatus: ServiceRoleKeyStatus;
  hasSuperAdminUids: boolean;
  superAdminUidsCount: number;
  allRequiredPresentAndValid: boolean;
}

function isValidHttpUrlStrict(raw: string): boolean {
  return (
    /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(raw) &&
    !raw.includes('your-project-ref') &&
    !raw.includes('placeholder') &&
    !raw.includes('MY_APP_URL')
  );
}

/**
 * Mengaudit kelengkapan seluruh Environment Variables Vercel (frontend & server)
 * secara aman: HANYA mengembalikan status boolean, hostname, & URL publik —
 * TIDAK PERNAH mengembalikan nilai secret key atau token.
 */
export function inspectVercelEnvChecklist(
  env: Record<string, string | undefined> = process.env
): VercelEnvChecklistResult {
  const serverInspection = inspectServerSupabaseEnv(env);
  const rawServerUrl = sanitizeEnv(env.SUPABASE_URL).replace(/\/+$/, '');
  const rawViteUrl = sanitizeEnv(env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  const rawPubKey = sanitizeEnv(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);
  const rawAppUrl = sanitizeEnv(env.VITE_APP_URL).replace(/\/+$/, '');
  const rawAdminEmail = sanitizeEnv(env.VITE_ADMIN_EMAIL);
  const superAdminUids = getSuperAdminUids(env);

  const hasServerSupabaseUrl = Boolean(rawServerUrl && isValidHttpUrlStrict(rawServerUrl));
  const hasViteSupabaseUrl = Boolean(rawViteUrl && isValidHttpUrlStrict(rawViteUrl));

  let supabaseUrlHost: string | null = null;
  const candidateUrl = rawServerUrl || rawViteUrl;
  if (candidateUrl && isValidHttpUrlStrict(candidateUrl)) {
    try {
      supabaseUrlHost = new URL(candidateUrl).hostname;
    } catch {
      supabaseUrlHost = null;
    }
  }

  let vitePublishableKeyStatus: PublishableKeyStatus = 'missing';
  if (rawPubKey) {
    if (
      rawPubKey.startsWith('sb_secret_') ||
      decodeJwtRoleClaim(rawPubKey) === 'service_role'
    ) {
      vitePublishableKeyStatus = 'invalid_secret_key_exposed';
    } else if (
      rawPubKey.length <= 20 ||
      rawPubKey.includes('your-anon-or-publishable-key') ||
      rawPubKey.includes('your-supabase-publishable')
    ) {
      vitePublishableKeyStatus = 'invalid_placeholder';
    } else {
      vitePublishableKeyStatus = 'valid_publishable_or_anon';
    }
  }

  const hasVitePublishableKey = Boolean(rawPubKey);
  const isVitePublishableKeySafe = vitePublishableKeyStatus === 'valid_publishable_or_anon';
  const hasViteAppUrl = Boolean(rawAppUrl);
  const viteAppUrlValid = Boolean(rawAppUrl && isValidHttpUrlStrict(rawAppUrl));
  const hasViteAdminEmail = Boolean(
    rawAdminEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawAdminEmail)
  );

  const allRequiredPresentAndValid =
    hasServerSupabaseUrl &&
    hasViteSupabaseUrl &&
    !serverInspection.hasUrlMismatch &&
    isVitePublishableKeySafe &&
    viteAppUrlValid &&
    serverInspection.isServiceRoleKeyValid;

  return {
    hasServerSupabaseUrl,
    hasViteSupabaseUrl,
    supabaseUrlHost,
    hasUrlMismatch: serverInspection.hasUrlMismatch,
    hasVitePublishableKey,
    isVitePublishableKeySafe,
    vitePublishableKeyStatus,
    hasViteAppUrl,
    viteAppUrlValid,
    viteAppUrl: viteAppUrlValid ? rawAppUrl : null,
    hasViteAdminEmail,
    hasServiceRoleKey: serverInspection.hasServiceRoleKey,
    serviceRoleKeyValid: serverInspection.isServiceRoleKeyValid,
    serviceRoleKeyStatus: serverInspection.keyStatus,
    hasSuperAdminUids: superAdminUids.length > 0,
    superAdminUidsCount: superAdminUids.length,
    allRequiredPresentAndValid,
  };
}

/**
 * Auth Client khusus untuk memverifikasi access token JWT pengguna (`auth.getUser(token)`).
 * Terpisah sepenuhnya dari Admin Client agar kredensial Admin tidak pernah tertimpa token user.
 */
function defaultCreateSupabaseAuthClient(): {
  client: SupabaseClient | null;
  error?: string;
} {
  const inspection = inspectServerSupabaseEnv();
  if (!inspection.hasSupabaseUrl || inspection.hasUrlMismatch) {
    return { client: null, error: inspection.error };
  }

  const keyForAuth = inspection.authApiKey || inspection.serviceRoleKey;
  if (!keyForAuth) {
    return {
      client: null,
      error:
        inspection.error ||
        'Kunci API Supabase untuk verifikasi autentikasi server belum tersedia.',
    };
  }

  const client = createClient(inspection.url, keyForAuth, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { client };
}

export interface AdminClientFetchFactoryOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

/**
 * Membuat wrapper fetch khusus Admin Client:
 * - Untuk Secret Key baru (`sb_secret_...`), memastikan key HANYA dikirim lewat header `apikey`
 *   dan menghapus header `Authorization` (karena @supabase/supabase-js v2.119+ masih menyisipkan
 *   `Authorization: Bearer sb_secret_...` pada PostgrestClient & AuthClient yang bukan JWT).
 * - Untuk Service Role JWT legacy, memaksa `apikey` + `Authorization: Bearer <service_role_jwt>`
 *   agar tidak pernah tertimpa token user/cookie.
 */
export function createAdminClientFetch(
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  const isNewSecretKey = serviceRoleKey.startsWith('sb_secret_');
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('apikey', serviceRoleKey);
    if (isNewSecretKey) {
      headers.delete('Authorization');
    } else {
      headers.set('Authorization', `Bearer ${serviceRoleKey}`);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

/**
 * Admin Client khusus server menggunakan SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Tidak pernah menerima Authorization header, cookie, atau sesi milik user yang sedang login.
 */
export function defaultCreateSupabaseAdminClient(
  options: AdminClientFetchFactoryOptions = {}
): {
  client: SupabaseClient | null;
  error?: string;
} {
  const inspection = inspectServerSupabaseEnv(options.env);
  if (inspection.error || !inspection.serviceRoleKey) {
    return { client: null, error: inspection.error || 'Konfigurasi Admin Supabase tidak lengkap.' };
  }

  const isNewSecretKey = inspection.serviceRoleKey.startsWith('sb_secret_');
  const adminFetch = createAdminClientFetch(
    inspection.serviceRoleKey,
    options.fetchImpl ?? fetch
  );

  const client = createClient(inspection.url, inspection.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: adminFetch,
      headers: isNewSecretKey
        ? {
            apikey: inspection.serviceRoleKey,
          }
        : {
            apikey: inspection.serviceRoleKey,
            Authorization: `Bearer ${inspection.serviceRoleKey}`,
          },
    },
  });

  return { client };
}

export interface AdminProfilesProbeResult {
  ok: boolean;
  statusCode: number;
  profilesOk: boolean;
  authAdminOk: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Pengujian server-side non-PII untuk memverifikasi akses SELECT Admin Client pada public.profiles
 * dan akses Auth Admin API tanpa menampilkan data pribadi pengguna maupun nilai Secret Key.
 */
export async function probeAdminProfilesAccess(
  getAdminClient: () => { client: SupabaseClient | null; error?: string } = () =>
    defaultCreateSupabaseAdminClient()
): Promise<AdminProfilesProbeResult> {
  const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      authAdminOk: false,
      errorCode: 'ADMIN_CLIENT_NOT_CONFIGURED',
      errorMessage: adminClientError || 'Konfigurasi Admin Supabase tidak lengkap.',
    };
  }

  const { error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id', { head: true })
    .limit(1);

  if (profilesError) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      authAdminOk: false,
      errorCode: profilesError.code || 'PROFILES_QUERY_ERROR',
      errorMessage: profilesError.message,
    };
  }

  let authAdminOk = true;
  if (supabaseAdmin.auth?.admin?.listUsers) {
    const { error: authAdminError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (authAdminError) {
      return {
        ok: false,
        statusCode: 500,
        profilesOk: true,
        authAdminOk: false,
        errorCode: (authAdminError as any).code || 'AUTH_ADMIN_ERROR',
        errorMessage: authAdminError.message,
      };
    }
  } else {
    authAdminOk = false;
  }

  return {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    authAdminOk,
  };
}

export interface AdminReturnTablesProbeResult {
  ok: boolean;
  statusCode: number;
  profilesOk: boolean;
  loansOk: boolean;
  booksOk: boolean;
  keyStatus: ServiceRoleKeyStatus;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Pengujian server-side non-PII untuk memverifikasi hak akses SELECT Admin Client
 * pada public.profiles, public.loans, dan public.books (mendeteksi 42501 sebelum return).
 */
export async function probeAdminReturnTablesAccess(
  getAdminClient: () => { client: SupabaseClient | null; error?: string } = () =>
    defaultCreateSupabaseAdminClient(),
  envInspection: ServerSupabaseEnvInspection = inspectServerSupabaseEnv()
): Promise<AdminReturnTablesProbeResult> {
  const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      loansOk: false,
      booksOk: false,
      keyStatus: envInspection.keyStatus,
      errorCode: 'ADMIN_CLIENT_NOT_CONFIGURED',
      errorMessage: adminClientError || 'Konfigurasi Admin Supabase tidak lengkap.',
    };
  }

  const [profilesRes, loansRes, booksRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('id').limit(0),
    supabaseAdmin.from('loans').select('id').limit(0),
    supabaseAdmin.from('books').select('id').limit(0),
  ]);

  const firstErr = loansRes.error || booksRes.error || profilesRes.error;
  if (firstErr) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: !profilesRes.error,
      loansOk: !loansRes.error,
      booksOk: !booksRes.error,
      keyStatus: envInspection.keyStatus,
      errorCode: firstErr.code || 'TABLE_ACCESS_ERROR',
      errorMessage: firstErr.message,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    loansOk: true,
    booksOk: true,
    keyStatus: envInspection.keyStatus,
  };
}

export interface AdminStorageAndCatalogProbeResult {
  ok: boolean;
  categoriesOk: boolean;
  categoriesErrorCode?: string;
  activityLogsOk: boolean;
  storageOk: boolean;
  bookCoversBucketExists: boolean;
  bookCoversPublic: boolean | null;
  bookFilesBucketExists: boolean;
  bookFilesPublic: boolean | null;
  errorMessage?: string;
}

/**
 * Pengujian server-side non-PII untuk memverifikasi tabel tambahan (categories, activity_logs)
 * dan konfigurasi bucket Supabase Storage ('book-covers' publik & 'book-files' privat).
 */
export async function probeAdminStorageAndCatalogAccess(
  getAdminClient: () => { client: SupabaseClient | null; error?: string } = () =>
    defaultCreateSupabaseAdminClient()
): Promise<AdminStorageAndCatalogProbeResult> {
  const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      categoriesOk: false,
      activityLogsOk: false,
      storageOk: false,
      bookCoversBucketExists: false,
      bookCoversPublic: null,
      bookFilesBucketExists: false,
      bookFilesPublic: null,
      errorMessage: adminClientError || 'Konfigurasi Admin Supabase tidak lengkap.',
    };
  }

  const [catRes, logRes] = await Promise.all([
    supabaseAdmin.from('categories').select('id').limit(0),
    supabaseAdmin.from('activity_logs').select('id').limit(0),
  ]);

  let storageOk = false;
  let bookCoversBucketExists = false;
  let bookCoversPublic: boolean | null = null;
  let bookFilesBucketExists = false;
  let bookFilesPublic: boolean | null = null;
  let storageErrorMsg: string | undefined;

  if (typeof (supabaseAdmin as any)?.storage?.listBuckets === 'function') {
    const { data: buckets, error: bucketsError } = await (supabaseAdmin as any).storage.listBuckets();
    if (bucketsError) {
      storageErrorMsg = bucketsError.message;
    } else if (Array.isArray(buckets)) {
      storageOk = true;
      const coversBucket = buckets.find((b: any) => b?.id === 'book-covers' || b?.name === 'book-covers');
      const filesBucket = buckets.find((b: any) => b?.id === 'book-files' || b?.name === 'book-files');
      bookCoversBucketExists = Boolean(coversBucket);
      bookCoversPublic = coversBucket ? Boolean(coversBucket.public) : null;
      bookFilesBucketExists = Boolean(filesBucket);
      bookFilesPublic = filesBucket ? Boolean(filesBucket.public) : null;
    }
  } else {
    storageErrorMsg = 'API listBuckets belum tersedia pada Storage client.';
  }

  const categoriesOk = !catRes.error;
  const activityLogsOk = !logRes.error;
  const firstErrMsg = catRes.error?.message || logRes.error?.message || storageErrorMsg;

  return {
    ok: categoriesOk && activityLogsOk && storageOk,
    categoriesOk,
    ...(catRes.error?.code ? { categoriesErrorCode: catRes.error.code } : {}),
    activityLogsOk,
    storageOk,
    bookCoversBucketExists,
    bookCoversPublic,
    bookFilesBucketExists,
    bookFilesPublic,
    ...(firstErrMsg ? { errorMessage: firstErrMsg } : {}),
  };
}

export interface DatabaseMigrationProbeResult {
  profilesArchiveColumnsOk: boolean;
  profilesArchiveColumnsError?: string;
  hasUserLoanRpcOk: boolean | null;
  hasUserLoanRpcError?: string;
  isAdminRpcOk: boolean | null;
  isAdminRpcError?: string;
  anonLoansDenied: boolean | null;
  anonLoansErrorCode?: string;
  anonProfilesDenied: boolean | null;
  anonProfilesErrorCode?: string;
  anonActivityLogsDenied: boolean | null;
  anonActivityLogsErrorCode?: string;
  anonBooksReadable: boolean | null;
  anonBooksErrorCode?: string;
  anonCategoriesReadable: boolean | null;
  anonCategoriesErrorCode?: string;
  hasDirectDbUrl: boolean;
  hasSupabaseAccessToken: boolean;
}

function defaultCreateSupabaseAnonProbeClient(
  env: Record<string, string | undefined> = process.env
): { client: SupabaseClient | null; error?: string } {
  const inspection = inspectServerSupabaseEnv(env);
  if (!inspection.hasSupabaseUrl || inspection.hasUrlMismatch) {
    return { client: null, error: inspection.error };
  }
  const anonKey = sanitizeEnv(
    env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  );
  if (
    !anonKey ||
    anonKey === inspection.serviceRoleKey ||
    anonKey.startsWith('sb_secret_') ||
    decodeJwtRoleClaim(anonKey) === 'service_role'
  ) {
    return { client: null, error: 'Publishable/Anon key tidak tersedia untuk probe anon.' };
  }
  const client = createClient(inspection.url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return { client };
}

export async function probeDatabaseMigrations(
  getAdminClient: () => { client: SupabaseClient | null; error?: string } = () =>
    defaultCreateSupabaseAdminClient(),
  getAnonProbeClient: () => { client: SupabaseClient | null; error?: string } = () =>
    defaultCreateSupabaseAnonProbeClient()
): Promise<DatabaseMigrationProbeResult> {
  const hasDirectDbUrl = Boolean(
    process.env.SUPABASE_DB_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim()
  );
  const hasSupabaseAccessToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN?.trim());

  const { client: supabaseAdmin } = getAdminClient();
  const { client: supabaseAnon } = getAnonProbeClient();

  if (!supabaseAdmin) {
    return {
      profilesArchiveColumnsOk: false,
      profilesArchiveColumnsError: 'ADMIN_CLIENT_NOT_CONFIGURED',
      hasUserLoanRpcOk: null,
      isAdminRpcOk: null,
      anonLoansDenied: null,
      anonProfilesDenied: null,
      anonActivityLogsDenied: null,
      anonBooksReadable: null,
      anonCategoriesReadable: null,
      hasDirectDbUrl,
      hasSupabaseAccessToken,
    };
  }

  const colRes = await supabaseAdmin
    .from('profiles')
    .select('is_active, archived_at, archived_by, is_super_admin')
    .limit(0);

  let hasUserLoanRpcOk: boolean | null = null;
  let hasUserLoanRpcError: string | undefined;
  let isAdminRpcOk: boolean | null = null;
  let isAdminRpcError: string | undefined;

  if (typeof (supabaseAdmin as any).rpc === 'function') {
    try {
      const [loanRpcRes, adminRpcRes] = await Promise.all([
        (supabaseAdmin as any).rpc('has_user_loan_for_book', {
          p_book_id: '00000000-0000-0000-0000-000000000000',
        }),
        (supabaseAdmin as any).rpc('is_admin'),
      ]);
      hasUserLoanRpcOk = !loanRpcRes?.error;
      if (loanRpcRes?.error) {
        hasUserLoanRpcError = loanRpcRes.error.code || loanRpcRes.error.message;
      }
      isAdminRpcOk = !adminRpcRes?.error;
      if (adminRpcRes?.error) {
        isAdminRpcError = adminRpcRes.error.code || adminRpcRes.error.message;
      }
    } catch (rpcErr: any) {
      hasUserLoanRpcOk = false;
      hasUserLoanRpcError = rpcErr?.message || 'RPC_PROBE_ERROR';
    }
  }

  let anonLoansDenied: boolean | null = null;
  let anonLoansErrorCode: string | undefined;
  let anonProfilesDenied: boolean | null = null;
  let anonProfilesErrorCode: string | undefined;
  let anonActivityLogsDenied: boolean | null = null;
  let anonActivityLogsErrorCode: string | undefined;
  let anonBooksReadable: boolean | null = null;
  let anonBooksErrorCode: string | undefined;
  let anonCategoriesReadable: boolean | null = null;
  let anonCategoriesErrorCode: string | undefined;

  if (supabaseAnon && supabaseAnon !== supabaseAdmin && typeof supabaseAnon.from === 'function') {
    try {
      const [anonLoans, anonProfiles, anonLogs, anonBooks, anonCats] = await Promise.all([
        supabaseAnon.from('loans').select('id').limit(0),
        supabaseAnon.from('profiles').select('id').limit(0),
        supabaseAnon.from('activity_logs').select('id').limit(0),
        supabaseAnon.from('books').select('id').limit(0),
        supabaseAnon.from('categories').select('id').limit(0),
      ]);
      anonLoansDenied = Boolean(anonLoans.error);
      anonLoansErrorCode = anonLoans.error?.code;
      anonProfilesDenied = Boolean(anonProfiles.error);
      anonProfilesErrorCode = anonProfiles.error?.code;
      anonActivityLogsDenied = Boolean(anonLogs.error);
      anonActivityLogsErrorCode = anonLogs.error?.code;
      anonBooksReadable = !anonBooks.error;
      anonBooksErrorCode = anonBooks.error?.code;
      anonCategoriesReadable = !anonCats.error;
      anonCategoriesErrorCode = anonCats.error?.code;
    } catch (anonErr: any) {
      anonLoansErrorCode = anonErr?.message || 'ANON_PROBE_ERROR';
    }
  }

  return {
    profilesArchiveColumnsOk: !colRes.error,
    ...(colRes.error ? { profilesArchiveColumnsError: colRes.error.code || colRes.error.message } : {}),
    hasUserLoanRpcOk,
    ...(hasUserLoanRpcError ? { hasUserLoanRpcError } : {}),
    isAdminRpcOk,
    ...(isAdminRpcError ? { isAdminRpcError } : {}),
    anonLoansDenied,
    ...(anonLoansErrorCode ? { anonLoansErrorCode } : {}),
    anonProfilesDenied,
    ...(anonProfilesErrorCode ? { anonProfilesErrorCode } : {}),
    anonActivityLogsDenied,
    ...(anonActivityLogsErrorCode ? { anonActivityLogsErrorCode } : {}),
    anonBooksReadable,
    ...(anonBooksErrorCode ? { anonBooksErrorCode } : {}),
    anonCategoriesReadable,
    ...(anonCategoriesErrorCode ? { anonCategoriesErrorCode } : {}),
    hasDirectDbUrl,
    hasSupabaseAccessToken,
  };
}

export interface ServerAppOptions {
  getAuthClient?: () => { client: SupabaseClient | null; error?: string };
  getAdminClient?: () => { client: SupabaseClient | null; error?: string };
  getAnonProbeClient?: () => { client: SupabaseClient | null; error?: string };
  superAdminUids?: string[];
}

async function verifyAdminRequest(
  req: Request,
  supabaseAuth: SupabaseClient,
  supabaseAdmin: SupabaseClient
): Promise<
  | {
      ok: true;
      adminProfile: {
        id: string;
        role: string;
        full_name?: string;
        username?: string;
        is_super_admin?: boolean;
        is_active?: boolean;
        archived_at?: string | null;
      };
    }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
    };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Token sesi administrator kosong atau tidak valid.',
    };
  }

  // 1. Verifikasi access token pengguna menggunakan Auth client (terpisah dari Admin client)
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      ok: false,
      status: 401,
      error: 'Sesi administrator tidak valid atau sudah berakhir. Silakan login kembali.',
    };
  }

  // 2. Baca public.profiles menggunakan Admin client (SUPABASE_SERVICE_ROLE_KEY, tanpa token user)
  let { data: actorProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, username, is_super_admin, is_active, archived_at')
    .eq('id', authData.user.id)
    .maybeSingle();

  // Fallback jika skema database belum menambahkan kolom is_super_admin/is_active/archived_at
  if (profileError && isMissingColumnError(profileError)) {
    const fallbackResult = await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name, username')
      .eq('id', authData.user.id)
      .maybeSingle();
    actorProfile = fallbackResult.data as any;
    profileError = fallbackResult.error;
  }

  if (profileError) {
    const isPermDenied = profileError.message.toLowerCase().includes('permission denied');
    return {
      ok: false,
      status: 500,
      error: isPermDenied
        ? `Gagal memverifikasi role administrator: ${profileError.message}. Pastikan SUPABASE_SERVICE_ROLE_KEY di Environment Variables Vercel benar-benar menggunakan Service Role / Secret Key Supabase (bukan Publishable/Anon Key) dan hak akses service_role pada tabel public.profiles aktif.`
        : `Gagal memverifikasi role administrator: ${profileError.message}`,
    };
  }

  if (
    !actorProfile ||
    (!isAdminOrSuperAdminRole(actorProfile.role) && actorProfile.is_super_admin !== true)
  ) {
    return {
      ok: false,
      status: 403,
      error: 'Akses ditolak. Hanya administrator dengan role admin yang dapat melakukan aksi ini.',
    };
  }

  if (actorProfile.is_active === false || Boolean(actorProfile.archived_at)) {
    return {
      ok: false,
      status: 403,
      error: 'Akses ditolak. Akun administrator ini sedang dinonaktifkan / diarsipkan.',
    };
  }

  return {
    ok: true,
    adminProfile: actorProfile,
  };
}

async function verifyAuthenticatedUser(
  req: Request,
  supabaseAuth: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  actionLabel = 'mengonfirmasi pengembalian buku'
): Promise<
  | {
      ok: true;
      userProfile: {
        id: string;
        role: string;
        full_name?: string;
        username?: string;
        is_super_admin?: boolean;
        is_active?: boolean;
        archived_at?: string | null;
      };
    }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: `Autentikasi diperlukan untuk ${actionLabel}.`,
    };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Token sesi pengguna kosong atau tidak valid.',
    };
  }

  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      ok: false,
      status: 401,
      error: 'Sesi pengguna tidak valid atau sudah berakhir. Silakan login kembali.',
    };
  }

  let profileQueryResult = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, username, is_super_admin, is_active, archived_at')
    .eq('id', authData.user.id)
    .limit(2);

  if (profileQueryResult.error && isMissingColumnError(profileQueryResult.error)) {
    profileQueryResult = (await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name, username')
      .eq('id', authData.user.id)
      .limit(2)) as any;
  }

  const profileError = profileQueryResult.error;
  const profileRows = profileQueryResult.data as any[] | null;

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: `Gagal memverifikasi profil pengguna: ${profileError.message}`,
    };
  }

  if (profileRows && profileRows.length > 1) {
    console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
      query: 'verifyAuthenticatedUser.profiles_by_id',
      userId: authData.user.id,
      rowCount: profileRows.length,
    });
    return {
      ok: false,
      status: 409,
      error: 'Terdeteksi duplikasi profil pengguna pada database. Hubungi administrator.',
    };
  }

  const actorProfile = profileRows?.[0] ?? null;

  if (!actorProfile) {
    return {
      ok: false,
      status: 403,
      error: 'Profil pengguna tidak ditemukan di database.',
    };
  }

  if (actorProfile.is_active === false || Boolean(actorProfile.archived_at)) {
    return {
      ok: false,
      status: 403,
      error: 'Akun Anda sedang dinonaktifkan / diarsipkan sehingga tidak dapat memproses transaksi.',
    };
  }

  return {
    ok: true,
    userProfile: actorProfile,
  };
}

function isDbPermissionDeniedError(err: any): boolean {
  if (!err) return false;
  return (
    String(err.code || '').trim() === '42501' ||
    String(err.message || '').toLowerCase().includes('permission denied')
  );
}

function isMissingRpcFunctionError(err: any, functionName: string): boolean {
  if (!err) return false;
  const code = String(err.code || '').trim().toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  if (code === 'PGRST202' || code === '42883') return true;
  return (
    msg.includes(functionName.toLowerCase()) &&
    (msg.includes('could not find the function') ||
      msg.includes('does not exist') ||
      msg.includes('schema cache'))
  );
}

async function countVisitorLoans(
  supabaseAdmin: SupabaseClient,
  targetId: string
): Promise<{
  totalLoansCount: number;
  activeLoansCount: number;
  error?: string;
  code?: string;
}> {
  const { count: totalCount, error: totalErr } = await supabaseAdmin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetId);

  if (totalErr) {
    const permDenied = isDbPermissionDeniedError(totalErr);
    if (permDenied) {
      console.error('[VISITOR_LOANS_COUNT_PERMISSION_DENIED]', {
        targetId,
        table: 'loans',
        code: totalErr.code || '42501',
        keyStatus: inspectServerSupabaseEnv().keyStatus,
      });
    }
    return {
      totalLoansCount: 0,
      activeLoansCount: 0,
      error: permDenied
        ? `Izin database server untuk memeriksa riwayat peminjaman (loans) belum aktif (kode 42501): ${totalErr.message}`
        : `Gagal memeriksa riwayat peminjaman pengunjung: ${totalErr.message}`,
      code: permDenied ? 'DB_PERMISSION_DENIED' : totalErr.code || 'LOANS_CHECK_FAILED',
    };
  }

  const { count: activeCount, error: activeErr } = await supabaseAdmin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetId)
    .in('status', ['pending', 'approved', 'borrowed']);

  if (activeErr) {
    const permDenied = isDbPermissionDeniedError(activeErr);
    if (permDenied) {
      console.error('[VISITOR_LOANS_COUNT_PERMISSION_DENIED]', {
        targetId,
        table: 'loans',
        code: activeErr.code || '42501',
        keyStatus: inspectServerSupabaseEnv().keyStatus,
      });
    }
    return {
      totalLoansCount: totalCount ?? 0,
      activeLoansCount: 0,
      error: permDenied
        ? `Izin database server untuk memeriksa pinjaman aktif (loans) belum aktif (kode 42501): ${activeErr.message}`
        : `Gagal memeriksa pinjaman aktif pengunjung: ${activeErr.message}`,
      code: permDenied ? 'DB_PERMISSION_DENIED' : activeErr.code || 'LOANS_CHECK_FAILED',
    };
  }

  return {
    totalLoansCount: totalCount ?? 0,
    activeLoansCount: activeCount ?? 0,
  };
}

async function syncProfileArchiveFields(
  supabaseAdmin: SupabaseClient,
  targetId: string,
  payload: {
    is_active: boolean;
    archived_at: string | null;
    archived_by: string | null;
    updated_at: string;
  }
): Promise<{ error: any | null }> {
  const fullAttempt = await supabaseAdmin.from('profiles').update(payload).eq('id', targetId);
  if (!fullAttempt.error) return { error: null };
  if (!isMissingColumnError(fullAttempt.error)) {
    return { error: fullAttempt.error };
  }

  const basicAttempt = await supabaseAdmin
    .from('profiles')
    .update({
      is_active: payload.is_active,
      archived_at: payload.archived_at,
      updated_at: payload.updated_at,
    })
    .eq('id', targetId);
  if (!basicAttempt.error) return { error: null };
  if (!isMissingColumnError(basicAttempt.error)) {
    return { error: basicAttempt.error };
  }

  const minimalAttempt = await supabaseAdmin
    .from('profiles')
    .update({ updated_at: payload.updated_at })
    .eq('id', targetId);
  if (!minimalAttempt.error || isMissingColumnError(minimalAttempt.error)) {
    return { error: null };
  }
  return { error: minimalAttempt.error };
}

interface RollbackFailureItem {
  step: string;
  table: string;
  recordId?: string;
  message: string;
}

interface RollbackExecutionResult {
  complete: boolean;
  failures: RollbackFailureItem[];
}

function isUserCurrentlyBanned(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const ts = new Date(bannedUntil).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

export function createApp(options: ServerAppOptions = {}) {
  const app = express();
  app.set('etag', false);

  const getAdminClient = options.getAdminClient ?? defaultCreateSupabaseAdminClient;
  const getAuthClient =
    options.getAuthClient ??
    (options.getAdminClient ? options.getAdminClient : defaultCreateSupabaseAuthClient);
  const getAnonProbeClient =
    options.getAnonProbeClient ??
    (options.getAdminClient || options.getAuthClient
      ? () => ({ client: null })
      : () => defaultCreateSupabaseAnonProbeClient());
  const resolvedSuperAdminUids = options.superAdminUids ?? getSuperAdminUids();

  const bookStockLocks = new Map<string, Promise<void>>();
  async function withBookStockLock<T>(
    bookId: string | null | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = String(bookId || '').trim();
    if (!key) return fn();
    const prev = bookStockLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prev.then(() => gate, () => gate);
    bookStockLocks.set(key, queued);
    try {
      await prev.catch(() => undefined);
      return await fn();
    } finally {
      release();
      if (bookStockLocks.get(key) === queued) {
        bookStockLocks.delete(key);
      }
    }
  }

  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader('ETag');
    next();
  });

  app.use(express.json());
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        error: 'Format JSON pada isi permintaan tidak valid.',
        code: 'INVALID_JSON',
      });
    }
    return next(err);
  });

  // Health and status endpoint (memeriksa keberadaan env server tanpa mencetak nilai rahasia)
  app.get('/api/health', async (req: Request, res: Response) => {
    const envInspection = inspectServerSupabaseEnv();
    const envAudit = inspectVercelEnvChecklist();
    const probeParam = String(req.query.probe || '').trim().toLowerCase();
    const shouldProbeProfiles = probeParam === 'profiles';
    const shouldProbeReturn = probeParam === 'return' || probeParam === 'all';
    const shouldProbeStorage = probeParam === 'storage' || probeParam === 'all';
    const shouldProbeMigrations = probeParam === 'migrations' || probeParam === 'all';
    const profilesProbe = shouldProbeProfiles
      ? await probeAdminProfilesAccess(() => getAdminClient())
      : undefined;
    const returnTablesProbe = shouldProbeReturn
      ? await probeAdminReturnTablesAccess(() => getAdminClient(), envInspection)
      : undefined;
    const catalogAndStorageProbe = shouldProbeStorage
      ? await probeAdminStorageAndCatalogAccess(() => getAdminClient())
      : undefined;
    const migrationProbe = shouldProbeMigrations
      ? await probeDatabaseMigrations(() => getAdminClient(), () => getAnonProbeClient())
      : undefined;

    res.json({
      status: 'ok',
      service: 'PERPUSTAKAAN MERAH PUTIH',
      database: 'Supabase PostgreSQL',
      envStatus: {
        hasSupabaseUrl: envInspection.hasSupabaseUrl,
        hasServiceRoleKey: envInspection.hasServiceRoleKey,
        serviceRoleKeyValid: envInspection.isServiceRoleKeyValid,
        serviceRoleKeyStatus: envInspection.keyStatus,
        hasUrlMismatch: envInspection.hasUrlMismatch,
      },
      envAudit,
      ...(profilesProbe ? { profilesProbe } : {}),
      ...(returnTablesProbe ? { returnTablesProbe } : {}),
      ...(catalogAndStorageProbe ? { catalogAndStorageProbe } : {}),
      ...(migrationProbe ? { migrationProbe } : {}),
      timestamp: new Date().toISOString(),
    });
  });

  // Mengambil daftar pengunjung dengan metadata email & status aktif dari Supabase Auth Admin (khusus Admin)
  app.get('/api/admin/visitors', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .neq('role', 'admin')
        .neq('role', 'super_admin')
        .order('created_at', { ascending: false });

      if (profilesError) {
        return res.status(500).json({
          error: `Gagal memuat daftar pengunjung: ${profilesError.message}`,
        });
      }

      const authUsersById = new Map<
        string,
        { email?: string; is_active?: boolean; archived_at?: string | null; is_super_admin?: boolean }
      >();

      try {
        const perPage = 1000;
        const maxPages = 20;
        for (let page = 1; page <= maxPages; page += 1) {
          const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage,
          });
          if (listError || !listData?.users || listData.users.length === 0) {
            break;
          }
          for (const authUser of listData.users) {
            const meta = (authUser.user_metadata || {}) as Record<string, any>;
            const banned = isUserCurrentlyBanned((authUser as any).banned_until);
            const inactive = meta.is_active === false || banned;
            authUsersById.set(authUser.id, {
              email: authUser.email,
              is_active: !inactive,
              archived_at: (meta.archived_at as string | undefined) ?? null,
              is_super_admin: isTargetAuthSuperAdmin(authUser),
            });
          }
          if (listData.users.length < perPage) {
            break;
          }
        }
      } catch (listErr) {
        console.warn('Gagal mengambil metadata Auth pengguna:', listErr);
      }

      const enrichedVisitors = (profiles || [])
        .filter((profile: any) => {
          const authMeta = authUsersById.get(profile.id);
          return (
            !isAdminOrSuperAdminRole(profile.role) &&
            profile.is_super_admin !== true &&
            !authMeta?.is_super_admin &&
            !resolvedSuperAdminUids.includes(profile.id)
          );
        })
        .map((profile: any) => {
          const authMeta = authUsersById.get(profile.id);
          const isActive =
            profile.is_active === false || authMeta?.is_active === false ? false : true;
          const archivedAt = profile.archived_at ?? authMeta?.archived_at ?? null;
          return {
            ...profile,
            email: authMeta?.email ?? profile.email,
            is_active: isActive,
            archived_at: archivedAt,
          };
        });

      return res.json({ visitors: enrichedVisitors });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memuat data pengunjung.',
      });
    }
  });

  // Menghapus akun pengunjung secara permanen (hanya jika tidak memiliki riwayat peminjaman maupun pinjaman aktif)
  const handleDeleteVisitorRequest = async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const targetId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: 'ID akun pengunjung tidak valid.' });
      }

      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`,
        });
      }

      let authTargetUser: any = null;
      const { data: authTarget, error: authTargetErr } =
        await supabaseAdmin.auth.admin.getUserById(targetId);
      if (authTargetErr) {
        const lowerAuthErr = String(authTargetErr.message || '').toLowerCase();
        const isNotFound =
          (authTargetErr as any)?.status === 404 ||
          lowerAuthErr.includes('not found') ||
          lowerAuthErr.includes('no user');
        if (!isNotFound) {
          return res.status(500).json({
            error: `Gagal memverifikasi akun target pada Supabase Authentication sebelum penghapusan: ${authTargetErr.message}`,
            code: 'AUTH_LOOKUP_FAILED',
          });
        }
      } else if (authTarget?.user) {
        authTargetUser = authTarget.user;
      }

      if (!targetProfile && !authTargetUser) {
        return res.status(404).json({
          error: 'Akun pengunjung tidak ditemukan di database.',
        });
      }

      const resolvedRole =
        targetProfile?.role || (authTargetUser?.user_metadata?.role as string) || 'visitor';
      const resolvedName =
        targetProfile?.full_name ||
        (authTargetUser?.user_metadata?.full_name as string) ||
        'Pengunjung';
      const resolvedUsername =
        targetProfile?.username || (authTargetUser?.user_metadata?.username as string) || '';
      const targetIsSuperAdmin = Boolean(
        targetProfile?.is_super_admin === true || isTargetAuthSuperAdmin(authTargetUser)
      );

      // Periksa jumlah riwayat peminjaman dan pinjaman aktif pada tabel loans
      const loanStats = await countVisitorLoans(supabaseAdmin, targetId);
      if (loanStats.error) {
        return res.status(500).json({
          error: loanStats.error,
          code: loanStats.code || 'LOANS_CHECK_FAILED',
        });
      }

      const evaluation = evaluateVisitorRemovalEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: resolvedRole,
        targetIsSuperAdmin,
        superAdminUids: resolvedSuperAdminUids,
        totalLoansCount: loanStats.totalLoansCount,
        activeLoansCount: loanStats.activeLoansCount,
      });

      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          totalLoans: loanStats.totalLoansCount,
          activeLoans: loanStats.activeLoansCount,
        });
      }

      // Snapshot referensi non-pinjaman yang relevan sebelum mutasi (fail-closed: hentikan seluruh penghapusan bila snapshot gagal).
      // Catatan: tabel categories adalah tabel katalog Admin-only dan TIDAK disentuh/disnapshot saat menghapus pengunjung.
      const { data: logsSnapshot, error: logsSnapErr } = await supabaseAdmin
        .from('activity_logs')
        .select('*')
        .eq('actor_id', targetId);
      if (logsSnapErr) {
        const permDenied = isDbPermissionDeniedError(logsSnapErr);
        console.error('[VISITOR_DELETE_SNAPSHOT_ERROR]', {
          targetId,
          table: 'activity_logs',
          code: logsSnapErr.code,
          keyStatus: inspectServerSupabaseEnv().keyStatus,
        });
        return res.status(500).json({
          error: `Gagal mengambil snapshot activity_logs sebelum penghapusan: ${logsSnapErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : 'SNAPSHOT_FAILED',
        });
      }

      const { data: booksSnapshot, error: booksSnapErr } = await supabaseAdmin
        .from('books')
        .select('id')
        .eq('created_by', targetId);
      if (booksSnapErr) {
        const permDenied = isDbPermissionDeniedError(booksSnapErr);
        console.error('[VISITOR_DELETE_SNAPSHOT_ERROR]', {
          targetId,
          table: 'books',
          code: booksSnapErr.code,
          keyStatus: inspectServerSupabaseEnv().keyStatus,
        });
        return res.status(500).json({
          error: `Gagal mengambil snapshot books sebelum penghapusan: ${booksSnapErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : 'SNAPSHOT_FAILED',
        });
      }

      const bookIdsToRestore = Array.isArray(booksSnapshot)
        ? booksSnapshot.map((b: any) => b.id).filter(Boolean)
        : [];
      const logRowsToRestore = Array.isArray(logsSnapshot) ? logsSnapshot : [];
      const logIdsToRestore = logRowsToRestore.map((l: any) => l.id).filter(Boolean);

      let logsClearMode: 'none' | 'nullified' | 'deleted' = 'none';
      let booksCleared = false;

      const rollbackReferencesAndProfile = async (
        restoreProfileRow: boolean
      ): Promise<RollbackExecutionResult> => {
        const failures: RollbackFailureItem[] = [];

        if (restoreProfileRow && targetProfile) {
          try {
            const { error: restoreProfileErr } = await supabaseAdmin
              .from('profiles')
              .insert(targetProfile);
            if (restoreProfileErr) {
              failures.push({
                step: 'restore_profile',
                table: 'profiles',
                recordId: targetId,
                message: restoreProfileErr.message || 'Gagal memulihkan baris public.profiles.',
              });
            }
          } catch (err: any) {
            failures.push({
              step: 'restore_profile',
              table: 'profiles',
              recordId: targetId,
              message: err?.message || 'Pengecualian saat memulihkan baris public.profiles.',
            });
          }
        }

        if (booksCleared) {
          for (const bookId of bookIdsToRestore) {
            try {
              const { error: restoreBookErr } = await supabaseAdmin
                .from('books')
                .update({ created_by: targetId })
                .eq('id', bookId);
              if (restoreBookErr) {
                failures.push({
                  step: 'restore_book_creator',
                  table: 'books',
                  recordId: String(bookId),
                  message:
                    restoreBookErr.message || 'Gagal memulihkan kolom created_by pada tabel books.',
                });
              }
            } catch (err: any) {
              failures.push({
                step: 'restore_book_creator',
                table: 'books',
                recordId: String(bookId),
                message:
                  err?.message || 'Pengecualian saat memulihkan kolom created_by pada tabel books.',
              });
            }
          }
        }

        if (logsClearMode === 'nullified') {
          for (const logId of logIdsToRestore) {
            try {
              const { error: restoreLogErr } = await supabaseAdmin
                .from('activity_logs')
                .update({ actor_id: targetId })
                .eq('id', logId);
              if (restoreLogErr) {
                failures.push({
                  step: 'restore_activity_log_actor',
                  table: 'activity_logs',
                  recordId: String(logId),
                  message:
                    restoreLogErr.message ||
                    'Gagal memulihkan kolom actor_id pada tabel activity_logs.',
                });
              }
            } catch (err: any) {
              failures.push({
                step: 'restore_activity_log_actor',
                table: 'activity_logs',
                recordId: String(logId),
                message:
                  err?.message ||
                  'Pengecualian saat memulihkan kolom actor_id pada tabel activity_logs.',
              });
            }
          }
        } else if (logsClearMode === 'deleted' && logRowsToRestore.length > 0) {
          for (const logRow of logRowsToRestore) {
            try {
              const { error: reinsertLogErr } = await supabaseAdmin
                .from('activity_logs')
                .insert(logRow);
              if (reinsertLogErr) {
                failures.push({
                  step: 'restore_activity_log_row',
                  table: 'activity_logs',
                  recordId: String(logRow?.id || targetId),
                  message:
                    reinsertLogErr.message ||
                    'Gagal memulihkan baris activity_logs setelah gagal penghapusan.',
                });
              }
            } catch (err: any) {
              failures.push({
                step: 'restore_activity_log_row',
                table: 'activity_logs',
                recordId: String(logRow?.id || targetId),
                message:
                  err?.message ||
                  'Pengecualian saat memulihkan baris activity_logs setelah gagal penghapusan.',
              });
            }
          }
        }

        if (failures.length > 0) {
          console.error('[VISITOR_DELETE_ROLLBACK_INCOMPLETE]', {
            targetId,
            failureCount: failures.length,
            failures,
          });
        }

        return {
          complete: failures.length === 0,
          failures,
        };
      };

      // 1. Lepaskan referensi non-pinjaman yang relevan tanpa menghapus baris histori activity_logs;
      //    fallback hapus log pengunjung hanya bila kolom actor_id di database masih NOT NULL (SQLSTATE 23502).
      if (logRowsToRestore.length > 0) {
        const { error: clearLogsErr } = await supabaseAdmin
          .from('activity_logs')
          .update({ actor_id: null })
          .eq('actor_id', targetId);
        if (clearLogsErr) {
          const logErrCode = String(clearLogsErr.code || '').trim();
          const logErrMsg = String(clearLogsErr.message || '').toLowerCase();
          const isNotNullViolation =
            logErrCode === '23502' ||
            logErrMsg.includes('null value in column "actor_id"') ||
            logErrMsg.includes('violates not-null constraint');

          if (isNotNullViolation) {
            const { error: deleteLogsErr } = await supabaseAdmin
              .from('activity_logs')
              .delete()
              .eq('actor_id', targetId);
            if (deleteLogsErr) {
              return res.status(500).json({
                error: `Gagal membersihkan referensi actor_id pada activity_logs sebelum penghapusan: ${deleteLogsErr.message}`,
              });
            }
            logsClearMode = 'deleted';
          } else {
            return res.status(500).json({
              error: `Gagal melepaskan referensi actor_id pada activity_logs sebelum penghapusan (pastikan migrasi ON DELETE SET NULL sudah dijalankan): ${clearLogsErr.message}`,
            });
          }
        } else {
          logsClearMode = 'nullified';
        }
      }

      if (bookIdsToRestore.length > 0) {
        const { error: clearBooksErr } = await supabaseAdmin
          .from('books')
          .update({ created_by: null })
          .eq('created_by', targetId);
        if (clearBooksErr) {
          const rollback = await rollbackReferencesAndProfile(false);
          if (!rollback.complete) {
            return res.status(500).json({
              error: `Gagal melepaskan referensi buku (${clearBooksErr.message}), dan pemulihan rollback tidak lengkap (${rollback.failures.length} kegagalan). Data referensi mungkin tidak konsisten.`,
              code: 'ROLLBACK_INCOMPLETE',
              rollbackComplete: false,
              rollbackFailures: rollback.failures,
            });
          }
          return res.status(500).json({
            error: `Gagal melepaskan referensi buku sebelum penghapusan (referensi log aktivitas telah dipulihkan): ${clearBooksErr.message}`,
            rollbackComplete: true,
          });
        }
        booksCleared = true;
      }

      // 2. Hapus baris public.profiles terlebih dahulu (sebelum Auth dihapus).
      //    Bila trigger DB atau FK pinjaman menolak, Auth belum tersentuh dan referensi bisa langsung di-rollback.
      let profileDeletedFirst = false;
      if (targetProfile) {
        const { error: deleteProfileError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', targetId);

        if (deleteProfileError) {
          const rollback = await rollbackReferencesAndProfile(false);
          if (!rollback.complete) {
            return res.status(500).json({
              error: `Gagal menghapus baris public.profiles (${deleteProfileError.message}), dan pemulihan rollback referensi TIDAK LENGKAP (${rollback.failures.length} kegagalan). Data referensi database mungkin tidak konsisten — periksa server log.`,
              code: 'ROLLBACK_INCOMPLETE',
              rollbackComplete: false,
              rollbackFailures: rollback.failures,
            });
          }

          const lowerProfileErr = (deleteProfileError.message || '').toLowerCase();
          if (lowerProfileErr.includes('super admin')) {
            return res.status(403).json({
              error: deleteProfileError.message,
              code: 'SUPER_ADMIN_PROTECTED',
              rollbackComplete: true,
            });
          }
          if (
            String(deleteProfileError.code || '').trim() === '23503' ||
            lowerProfileErr.includes('foreign key') ||
            lowerProfileErr.includes('still referenced')
          ) {
            return res.status(409).json({
              error:
                'Akun pengunjung tidak dapat dihapus permanen karena masih memiliki data terkait di tabel lain (perubahan referensi telah dibatalkan). Gunakan fitur Arsipkan Pengunjung agar histori tetap aman.',
              code: 'VISITOR_DELETE_CONFLICT',
              rollbackComplete: true,
            });
          }
          if (isDbPermissionDeniedError(deleteProfileError)) {
            return res.status(500).json({
              error: `Izin database server untuk menghapus baris public.profiles belum aktif (kode 42501, seluruh referensi telah dipulihkan): ${deleteProfileError.message}`,
              code: 'DB_PERMISSION_DENIED',
              rollbackComplete: true,
            });
          }
          return res.status(500).json({
            error: `Gagal menghapus baris public.profiles (seluruh referensi database telah dipulihkan): ${deleteProfileError.message}`,
            rollbackComplete: true,
          });
        }
        profileDeletedFirst = true;
      }

      // 3. Hapus user dari Supabase Auth; pastikan sekali lagi UID target bukan Super Admin sebelum mutasi
      if (
        resolvedSuperAdminUids.includes(targetId) ||
        targetIsSuperAdmin ||
        resolvedRole === 'super_admin'
      ) {
        const rollback = await rollbackReferencesAndProfile(profileDeletedFirst);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Operasi ditolak karena target adalah Super Admin, dan pemulihan rollback referensi tidak lengkap (${rollback.failures.length} kegagalan).`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
            rollbackFailures: rollback.failures,
          });
        }
        return res.status(403).json({
          error: 'Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.',
          code: 'SUPER_ADMIN_PROTECTED',
          rollbackComplete: true,
        });
      }

      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (
        deleteAuthError &&
        !deleteAuthError.message.toLowerCase().includes('not found')
      ) {
        const rollback = await rollbackReferencesAndProfile(profileDeletedFirst);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Gagal menghapus akun dari Supabase Authentication (${deleteAuthError.message}), dan pemulihan (rollback) profil/referensi TIDAK LENGKAP (${rollback.failures.length} kegagalan). Profil atau referensi database mungkin tidak konsisten — periksa server log.`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
            rollbackFailures: rollback.failures,
          });
        }

        const lowerMsg = deleteAuthError.message.toLowerCase();
        if (lowerMsg.includes('storage') || lowerMsg.includes('object')) {
          return res.status(409).json({
            error:
              'Akun tidak dapat dihapus karena masih memiliki file objek terkait di Supabase Storage (perubahan profil telah dibatalkan).',
            rollbackComplete: true,
          });
        }
        if (lowerMsg.includes('super admin')) {
          return res.status(403).json({
            error: deleteAuthError.message,
            code: 'SUPER_ADMIN_PROTECTED',
            rollbackComplete: true,
          });
        }
        return res.status(500).json({
          error: `Gagal menghapus akun dari Supabase Authentication (perubahan profil dan referensi telah dibatalkan): ${deleteAuthError.message}`,
          rollbackComplete: true,
        });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'delete_visitor',
          entity_type: 'profiles',
          entity_id: targetId,
          details: JSON.stringify({
            full_name: resolvedName,
            username: resolvedUsername,
          }),
          created_at: new Date().toISOString(),
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.json({
        success: true,
        mode: 'deleted',
        deletedUserId: targetId,
        message: `Akun pengunjung "${resolvedName}" berhasil dihapus permanen dari Supabase Authentication dan tabel profiles.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat menghapus akun pengunjung.',
      });
    }
  };

  // Mengarsipkan / menonaktifkan akun pengunjung yang memiliki riwayat peminjaman (ditolak bila masih punya pinjaman aktif)
  const handleArchiveVisitorRequest = async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const targetId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: 'ID akun pengunjung tidak valid.' });
      }

      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`,
        });
      }

      if (!targetProfile) {
        return res.status(404).json({ error: 'Akun pengunjung tidak ditemukan di database.' });
      }

      const { data: authTargetData, error: authLookupError } =
        await supabaseAdmin.auth.admin.getUserById(targetId);

      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: 'Akun autentikasi pengunjung tidak ditemukan di Supabase Auth.',
        });
      }

      const targetIsSuperAdmin = Boolean(
        targetProfile.is_super_admin === true || isTargetAuthSuperAdmin(authTargetData.user)
      );

      const loanStats = await countVisitorLoans(supabaseAdmin, targetId);
      if (loanStats.error) {
        return res.status(500).json({ error: loanStats.error });
      }

      const evaluation = evaluateVisitorArchiveEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: targetProfile.role,
        targetIsSuperAdmin,
        superAdminUids: resolvedSuperAdminUids,
        activeLoansCount: loanStats.activeLoansCount,
      });

      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          activeLoans: loanStats.activeLoansCount,
        });
      }

      const nowIso = new Date().toISOString();
      const existingMeta = (authTargetData.user.user_metadata || {}) as Record<string, any>;
      const previousBannedUntil = (authTargetData.user as any).banned_until ?? null;

      if (
        resolvedSuperAdminUids.includes(targetId) ||
        targetIsSuperAdmin ||
        targetProfile.role === 'super_admin'
      ) {
        return res.status(403).json({
          error: 'Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.',
          code: 'SUPER_ADMIN_PROTECTED',
        });
      }

      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
        ban_duration: '876000h',
        user_metadata: {
          ...existingMeta,
          is_active: false,
          archived_at: nowIso,
          archived_by: authCheck.adminProfile.id,
        },
      });

      if (banError) {
        return res.status(500).json({
          error: `Gagal menonaktifkan akun di Supabase Authentication: ${banError.message}`,
        });
      }

      const { error: profileSyncError } = await syncProfileArchiveFields(supabaseAdmin, targetId, {
        is_active: false,
        archived_at: nowIso,
        archived_by: authCheck.adminProfile.id,
        updated_at: nowIso,
      });

      if (profileSyncError) {
        // Rollback perubahan Auth apabila update profil gagal agar status Auth & DB tetap konsisten
        let authRollbackErrorMessage: string | null = null;
        try {
          const { error: rollbackAuthErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
            ban_duration: isUserCurrentlyBanned(previousBannedUntil) ? '876000h' : 'none',
            user_metadata: existingMeta,
          });
          if (rollbackAuthErr) {
            authRollbackErrorMessage =
              rollbackAuthErr.message || 'Gagal memulihkan status Auth setelah gagal sync profil.';
          }
        } catch (err: any) {
          authRollbackErrorMessage =
            err?.message || 'Pengecualian saat memulihkan status Auth setelah gagal sync profil.';
        }

        if (authRollbackErrorMessage) {
          console.error('[VISITOR_ARCHIVE_ROLLBACK_INCOMPLETE]', {
            targetId,
            message: authRollbackErrorMessage,
          });
          return res.status(500).json({
            error: `Gagal memperbarui status arsip di tabel profiles (${profileSyncError.message}), dan rollback status Supabase Auth juga gagal (${authRollbackErrorMessage}). Status Auth & DB mungkin tidak konsisten.`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
          });
        }

        return res.status(500).json({
          error: `Gagal memperbarui status arsip di tabel profiles (status Supabase Auth telah dipulihkan): ${profileSyncError.message}`,
          rollbackComplete: true,
        });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'archive_visitor',
          entity_type: 'profiles',
          entity_id: targetId,
          details: JSON.stringify({
            full_name: targetProfile.full_name,
            username: targetProfile.username,
            archived_at: nowIso,
          }),
          created_at: nowIso,
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.json({
        success: true,
        mode: 'archived',
        archivedUserId: targetId,
        archivedAt: nowIso,
        message: `Akun pengunjung "${targetProfile.full_name}" berhasil diarsipkan dan dinonaktifkan. Seluruh riwayat peminjaman tetap terjaga.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat mengarsipkan akun pengunjung.',
      });
    }
  };

  // Mengaktifkan kembali akun pengunjung yang sebelumnya diarsipkan
  const handleRestoreVisitorRequest = async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const targetId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: 'ID akun pengunjung tidak valid.' });
      }

      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`,
        });
      }

      if (!targetProfile) {
        return res.status(404).json({ error: 'Akun pengunjung tidak ditemukan di database.' });
      }

      const { data: authTargetData, error: authLookupError } =
        await supabaseAdmin.auth.admin.getUserById(targetId);

      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: 'Akun autentikasi pengunjung tidak ditemukan di Supabase Auth.',
        });
      }

      const targetIsSuperAdmin = Boolean(
        targetProfile.is_super_admin === true || isTargetAuthSuperAdmin(authTargetData.user)
      );

      const evaluation = evaluateVisitorRestoreEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: targetProfile.role,
        targetIsSuperAdmin,
        superAdminUids: resolvedSuperAdminUids,
      });

      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
        });
      }

      const nowIso = new Date().toISOString();
      const existingMeta = (authTargetData.user.user_metadata || {}) as Record<string, any>;
      const previousBannedUntil = (authTargetData.user as any).banned_until ?? null;

      if (
        resolvedSuperAdminUids.includes(targetId) ||
        targetIsSuperAdmin ||
        targetProfile.role === 'super_admin'
      ) {
        return res.status(403).json({
          error: 'Akun administrator / Super Admin tidak dikelola melalui menu pengunjung.',
          code: 'SUPER_ADMIN_PROTECTED',
        });
      }

      const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
        ban_duration: 'none',
        user_metadata: {
          ...existingMeta,
          is_active: true,
          archived_at: null,
          archived_by: null,
          restored_at: nowIso,
          restored_by: authCheck.adminProfile.id,
        },
      });

      if (unbanError) {
        return res.status(500).json({
          error: `Gagal mengaktifkan kembali akun di Supabase Authentication: ${unbanError.message}`,
        });
      }

      const { error: profileSyncError } = await syncProfileArchiveFields(supabaseAdmin, targetId, {
        is_active: true,
        archived_at: null,
        archived_by: null,
        updated_at: nowIso,
      });

      if (profileSyncError) {
        let authRollbackErrorMessage: string | null = null;
        try {
          const { error: rollbackAuthErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
            ban_duration: isUserCurrentlyBanned(previousBannedUntil) ? '876000h' : 'none',
            user_metadata: existingMeta,
          });
          if (rollbackAuthErr) {
            authRollbackErrorMessage =
              rollbackAuthErr.message || 'Gagal memulihkan status ban Auth setelah gagal sync profil.';
          }
        } catch (err: any) {
          authRollbackErrorMessage =
            err?.message || 'Pengecualian saat memulihkan status ban Auth setelah gagal sync profil.';
        }

        if (authRollbackErrorMessage) {
          console.error('[VISITOR_RESTORE_ROLLBACK_INCOMPLETE]', {
            targetId,
            message: authRollbackErrorMessage,
          });
          return res.status(500).json({
            error: `Gagal memperbarui status aktif di tabel profiles (${profileSyncError.message}), dan rollback status Supabase Auth juga gagal (${authRollbackErrorMessage}). Status Auth & DB mungkin tidak konsisten.`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
          });
        }

        return res.status(500).json({
          error: `Gagal memperbarui status aktif di tabel profiles (status Supabase Auth telah dipulihkan): ${profileSyncError.message}`,
          rollbackComplete: true,
        });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'restore_visitor',
          entity_type: 'profiles',
          entity_id: targetId,
          details: JSON.stringify({
            full_name: targetProfile.full_name,
            username: targetProfile.username,
            restored_at: nowIso,
          }),
          created_at: nowIso,
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.json({
        success: true,
        mode: 'restored',
        restoredUserId: targetId,
        restoredAt: nowIso,
        message: `Akun pengunjung "${targetProfile.full_name}" berhasil diaktifkan kembali dan dapat login seperti semula.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat mengaktifkan kembali akun pengunjung.',
      });
    }
  };

  // Menambahkan akun pengunjung baru oleh Admin (membuat akun Supabase Auth + baris public.profiles)
  const handleCreateVisitorRequest = async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const cleanFullName = String(body.full_name ?? body.fullName ?? '').trim();
      const cleanUsername = String(body.username ?? '').trim();
      const cleanEmail = String(body.email ?? '').trim().toLowerCase();
      const cleanPassword = String(body.password ?? '');

      if (cleanFullName.length < 3) {
        return res.status(400).json({
          error: 'Nama lengkap pengunjung minimal 3 karakter.',
          code: 'INVALID_FULL_NAME',
        });
      }

      if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({
          error: 'Username harus 3-20 karakter alfanumerik (huruf, angka, garis bawah).',
          code: 'INVALID_USERNAME',
        });
      }

      const lowerUsername = cleanUsername.toLowerCase();
      if (
        lowerUsername === 'admin' ||
        lowerUsername === 'super_admin' ||
        lowerUsername === 'superadmin'
      ) {
        return res.status(400).json({
          error: 'Username tersebut dicadangkan untuk akun sistem.',
          code: 'RESERVED_USERNAME',
        });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({
          error: 'Format alamat email pengunjung tidak valid.',
          code: 'INVALID_EMAIL',
        });
      }

      if (cleanPassword.length < 6) {
        return res.status(400).json({
          error: 'Kata sandi awal pengunjung minimal 6 karakter.',
          code: 'INVALID_PASSWORD',
        });
      }

      const { data: existingUsernames, error: usernameCheckErr } = await supabaseAdmin
        .from('profiles')
        .select('id, username')
        .ilike('username', cleanUsername)
        .limit(1);

      if (usernameCheckErr) {
        return res.status(500).json({
          error: `Gagal memverifikasi ketersediaan username: ${usernameCheckErr.message}`,
        });
      }

      if (existingUsernames && existingUsernames.length > 0) {
        return res.status(409).json({
          error: `Username "@${cleanUsername}" sudah digunakan oleh anggota lain.`,
          code: 'USERNAME_TAKEN',
        });
      }

      const { data: createdAuthData, error: createAuthErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: cleanEmail,
          password: cleanPassword,
          email_confirm: true,
          user_metadata: {
            full_name: cleanFullName,
            username: cleanUsername,
            role: 'visitor',
            is_active: true,
          },
        });

      if (createAuthErr || !createdAuthData?.user?.id) {
        const msg = createAuthErr?.message || 'Gagal membuat akun di Supabase Authentication.';
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('already registered') || lowerMsg.includes('already exists')) {
          return res.status(409).json({
            error: `Alamat email "${cleanEmail}" sudah terdaftar.`,
            code: 'EMAIL_TAKEN',
          });
        }
        return res.status(500).json({
          error: `Gagal membuat akun pengunjung di Supabase Authentication: ${msg}`,
        });
      }

      const newUserId = createdAuthData.user.id;
      const nowIso = new Date().toISOString();

      const { data: triggerProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', newUserId)
        .maybeSingle();

      let savedProfile: any = null;
      let profileSyncError: any = null;

      if (triggerProfile) {
        const updateFull = await supabaseAdmin
          .from('profiles')
          .update({
            full_name: cleanFullName,
            username: cleanUsername,
            role: 'visitor',
            is_active: true,
            archived_at: null,
            archived_by: null,
            updated_at: nowIso,
          })
          .eq('id', newUserId)
          .select('*');

        if (updateFull.error && isMissingColumnError(updateFull.error)) {
          const updateBasic = await supabaseAdmin
            .from('profiles')
            .update({
              full_name: cleanFullName,
              username: cleanUsername,
              role: 'visitor',
              updated_at: nowIso,
            })
            .eq('id', newUserId)
            .select('*');
          savedProfile = updateBasic.data?.[0] ?? null;
          profileSyncError = updateBasic.error;
        } else {
          savedProfile = updateFull.data?.[0] ?? null;
          profileSyncError = updateFull.error;
        }
      } else {
        const insertFull = await supabaseAdmin
          .from('profiles')
          .insert({
            id: newUserId,
            full_name: cleanFullName,
            username: cleanUsername,
            role: 'visitor',
            is_active: true,
            archived_at: null,
            archived_by: null,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select('*');

        if (insertFull.error && isMissingColumnError(insertFull.error)) {
          const insertBasic = await supabaseAdmin
            .from('profiles')
            .insert({
              id: newUserId,
              full_name: cleanFullName,
              username: cleanUsername,
              role: 'visitor',
              created_at: nowIso,
              updated_at: nowIso,
            })
            .select('*');
          savedProfile = insertBasic.data?.[0] ?? null;
          profileSyncError = insertBasic.error;
        } else {
          savedProfile = insertFull.data?.[0] ?? null;
          profileSyncError = insertFull.error;
        }
      }

      if (profileSyncError) {
        let authCleanupError: string | null = null;
        try {
          const { error: cleanupErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
          if (cleanupErr) {
            authCleanupError = cleanupErr.message || 'Gagal menghapus akun Auth sementara.';
          }
        } catch (err: any) {
          authCleanupError = err?.message || 'Pengecualian saat membatalkan akun Auth sementara.';
        }

        if (authCleanupError) {
          console.error('[VISITOR_CREATE_ROLLBACK_INCOMPLETE]', {
            newUserId,
            message: authCleanupError,
          });
          return res.status(500).json({
            error: `Gagal menyimpan profil pengunjung (${profileSyncError.message}), dan pembersihan akun Auth sementara gagal (${authCleanupError}).`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
          });
        }

        return res.status(500).json({
          error: `Gagal menyimpan profil pengunjung ke database (akun Auth sementara dibatalkan): ${profileSyncError.message}`,
          rollbackComplete: true,
        });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'create_visitor',
          entity_type: 'profiles',
          entity_id: newUserId,
          details: JSON.stringify({
            full_name: cleanFullName,
            username: cleanUsername,
            email: cleanEmail,
          }),
          created_at: nowIso,
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.status(201).json({
        success: true,
        visitor: {
          ...(savedProfile || {
            id: newUserId,
            full_name: cleanFullName,
            username: cleanUsername,
            role: 'visitor',
            is_active: true,
            archived_at: null,
            created_at: nowIso,
            updated_at: nowIso,
          }),
          email: createdAuthData.user.email || cleanEmail,
          is_active: true,
          archived_at: null,
        },
        message: `Akun pengunjung "${cleanFullName}" berhasil dibuat dan siap digunakan.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat menambahkan akun pengunjung.',
      });
    }
  };

  // Memperbarui data nama lengkap / username akun pengunjung (khusus Admin)
  const handleUpdateVisitorRequest = async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const targetId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: 'ID akun pengunjung tidak valid.' });
      }

      if (targetId === authCheck.adminProfile.id) {
        return res.status(400).json({
          error: 'Gunakan halaman profil pribadi untuk mengubah data akun Anda sendiri.',
          code: 'SELF_EDIT_FORBIDDEN',
        });
      }

      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`,
        });
      }

      if (!targetProfile) {
        return res.status(404).json({ error: 'Akun pengunjung tidak ditemukan di database.' });
      }

      let authTargetUser: any = null;
      try {
        const { data: authTargetData, error: authTargetErr } =
          await supabaseAdmin.auth.admin.getUserById(targetId);
        if (!authTargetErr && authTargetData?.user) {
          authTargetUser = authTargetData.user;
        }
      } catch {
        // Lanjutkan berdasarkan data profil bila Auth lookup tidak tersedia
      }

      const targetIsSuperAdmin = Boolean(
        targetProfile.is_super_admin === true ||
          targetProfile.role === 'super_admin' ||
          resolvedSuperAdminUids.includes(targetId) ||
          isTargetAuthSuperAdmin(authTargetUser)
      );

      if (targetIsSuperAdmin) {
        return res.status(403).json({
          error: 'Akun Super Admin dilindungi oleh sistem dan tidak dapat diubah melalui menu pengunjung.',
          code: 'SUPER_ADMIN_PROTECTED',
        });
      }

      if (targetProfile.role === 'admin') {
        return res.status(403).json({
          error: 'Akun administrator tidak dapat diubah melalui menu daftar pengunjung.',
          code: 'ADMIN_EDIT_FORBIDDEN',
        });
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const hasFullName = body.full_name !== undefined || body.fullName !== undefined;
      const hasUsername = body.username !== undefined;

      if (!hasFullName && !hasUsername) {
        return res.status(400).json({
          error: 'Minimal isi perubahan nama lengkap atau username pengunjung.',
          code: 'NO_FIELDS_TO_UPDATE',
        });
      }

      const nextFullName = hasFullName
        ? String(body.full_name ?? body.fullName ?? '').trim()
        : String(targetProfile.full_name || '').trim();
      const nextUsername = hasUsername
        ? String(body.username ?? '').trim()
        : String(targetProfile.username || '').trim();

      if (nextFullName.length < 3) {
        return res.status(400).json({
          error: 'Nama lengkap pengunjung minimal 3 karakter.',
          code: 'INVALID_FULL_NAME',
        });
      }

      if (!/^[a-zA-Z0-9_]{3,20}$/.test(nextUsername)) {
        return res.status(400).json({
          error: 'Username harus 3-20 karakter alfanumerik (huruf, angka, garis bawah).',
          code: 'INVALID_USERNAME',
        });
      }

      const lowerUsername = nextUsername.toLowerCase();
      if (
        lowerUsername === 'admin' ||
        lowerUsername === 'super_admin' ||
        lowerUsername === 'superadmin'
      ) {
        return res.status(400).json({
          error: 'Username tersebut dicadangkan untuk akun sistem.',
          code: 'RESERVED_USERNAME',
        });
      }

      if (
        hasUsername &&
        nextUsername.toLowerCase() !== String(targetProfile.username || '').toLowerCase()
      ) {
        const { data: dupUsernames, error: dupErr } = await supabaseAdmin
          .from('profiles')
          .select('id, username')
          .ilike('username', nextUsername)
          .neq('id', targetId)
          .limit(1);

        if (dupErr) {
          return res.status(500).json({
            error: `Gagal memeriksa keunikan username: ${dupErr.message}`,
          });
        }

        if (dupUsernames && dupUsernames.length > 0) {
          return res.status(409).json({
            error: `Username "@${nextUsername}" sudah digunakan oleh anggota lain.`,
            code: 'USERNAME_TAKEN',
          });
        }
      }

      const nowIso = new Date().toISOString();
      const { error: updateProfileErr } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: nextFullName,
          username: nextUsername,
          updated_at: nowIso,
        })
        .eq('id', targetId);

      if (updateProfileErr) {
        return res.status(500).json({
          error: `Gagal memperbarui data profil pengunjung: ${updateProfileErr.message}`,
        });
      }

      if (authTargetUser) {
        const existingMeta = (authTargetUser.user_metadata || {}) as Record<string, any>;
        const { error: authMetaErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
          user_metadata: {
            ...existingMeta,
            full_name: nextFullName,
            username: nextUsername,
          },
        });

        if (authMetaErr) {
          const { error: rollbackProfileErr } = await supabaseAdmin
            .from('profiles')
            .update({
              full_name: targetProfile.full_name,
              username: targetProfile.username,
              updated_at: targetProfile.updated_at || nowIso,
            })
            .eq('id', targetId);

          if (rollbackProfileErr) {
            return res.status(500).json({
              error: `Gagal menyinkronkan metadata Supabase Auth (${authMetaErr.message}) dan rollback profil gagal (${rollbackProfileErr.message}).`,
              code: 'ROLLBACK_INCOMPLETE',
              rollbackComplete: false,
            });
          }

          return res.status(500).json({
            error: `Gagal menyinkronkan metadata Supabase Auth (perubahan profil dibatalkan): ${authMetaErr.message}`,
            rollbackComplete: true,
          });
        }
      }

      const { data: latestProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'update_visitor',
          entity_type: 'profiles',
          entity_id: targetId,
          details: JSON.stringify({
            full_name: nextFullName,
            username: nextUsername,
          }),
          created_at: nowIso,
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.json({
        success: true,
        visitor: {
          ...(latestProfile || {
            ...targetProfile,
            full_name: nextFullName,
            username: nextUsername,
            updated_at: nowIso,
          }),
          email: authTargetUser?.email ?? targetProfile.email,
        },
        message: `Data pengunjung "${nextFullName}" berhasil diperbarui.`,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memperbarui data pengunjung.',
      });
    }
  };

  app.post('/api/admin/visitors', handleCreateVisitorRequest);
  app.patch('/api/admin/visitors/:id', handleUpdateVisitorRequest);
  app.put('/api/admin/visitors/:id', handleUpdateVisitorRequest);
  app.post('/api/admin/visitors/:id/delete', handleDeleteVisitorRequest);
  app.post('/api/admin/visitors/:id/archive', handleArchiveVisitorRequest);
  app.post('/api/admin/visitors/:id/restore', handleRestoreVisitorRequest);
  app.delete('/api/admin/visitors/:id', handleDeleteVisitorRequest);
  app.post('/api/admin/visitors/:id', async (req: Request, res: Response) => {
    const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : '';
    if (action === 'archive') {
      return handleArchiveVisitorRequest(req, res);
    }
    if (action === 'restore') {
      return handleRestoreVisitorRequest(req, res);
    }
    if (action === 'update' || action === 'edit') {
      return handleUpdateVisitorRequest(req, res);
    }
    if (!action || action === 'delete') {
      return handleDeleteVisitorRequest(req, res);
    }
    return res.status(400).json({
      error: `Aksi "${action}" tidak dikenali untuk endpoint pengunjung.`,
      code: 'INVALID_VISITOR_ACTION',
    });
  });

  // Helper untuk membaca kategori secara best-effort tanpa menggagalkan query buku/peminjaman
  const loadCategoryMapSafe = async (supabaseAdmin: SupabaseClient) => {
    const map = new Map<string, { id: string; name: string; slug?: string }>();
    try {
      const { data: catRows, error: catErr } = await supabaseAdmin
        .from('categories')
        .select('id, name, slug');
      if (!catErr && Array.isArray(catRows)) {
        for (const cat of catRows) {
          if (cat?.id) map.set(cat.id, cat);
        }
      }
    } catch {
      // Abaikan jika izin service_role pada categories belum aktif
    }
    return map;
  };

  // Endpoint daftar buku terverifikasi via SUPABASE_SERVICE_ROLE_KEY (menghindari 42501 RLS subquery browser)
  app.get('/api/books', async (req: Request, res: Response) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        'memuat katalog buku'
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;

      const { data: bookRows, error: booksErr } = await supabaseAdmin
        .from('books')
        .select('*')
        .order('created_at', { ascending: false });

      if (booksErr) {
        const permDenied = isDbPermissionDeniedError(booksErr);
        return res.status(500).json({
          error: `Gagal memuat daftar buku: ${booksErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : booksErr.code || 'BOOKS_FETCH_FAILED',
        });
      }

      // Selaraskan dengan aturan katalog & RLS: NULL is_published dianggap true, NULL is_archived dianggap false
      const visibleBookRows = (bookRows || []).filter((b: any) =>
        isActorAdmin ? true : b.is_published !== false && !b.is_archived
      );

      const catMap = await loadCategoryMapSafe(supabaseAdmin);
      const enrichedBooks = visibleBookRows.map((b: any) => {
        const cat = b.category_id ? catMap.get(b.category_id) : undefined;
        return {
          ...b,
          is_published: b.is_published !== false,
          is_archived: Boolean(b.is_archived),
          ...(cat ? { category: cat, category_name: cat.name } : {}),
        };
      });

      return res.json({ books: enrichedBooks });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memuat katalog buku.',
      });
    }
  });

  // Endpoint tambah buku oleh Admin/Super Admin via SUPABASE_SERVICE_ROLE_KEY
  app.post('/api/admin/books', async (req: Request, res: Response) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const body = (req.body || {}) as Record<string, any>;
      const cleanTitle = String(body.title || '').trim();
      const cleanAuthor = String(body.author || 'Penulis Mandiri').trim();
      const cleanCategoryId = String(body.category_id || '').trim();
      if (cleanTitle.length < 2) {
        return res.status(400).json({ error: 'Judul buku wajib diisi minimal 2 karakter.' });
      }
      if (cleanAuthor.length < 2) {
        return res.status(400).json({ error: 'Nama penulis wajib diisi minimal 2 karakter.' });
      }
      if (!cleanCategoryId) {
        return res.status(400).json({
          error: 'Kategori buku wajib dipilih sebelum menyimpan data buku.',
        });
      }

      const parsedYear = Number(body.publication_year ?? body.year ?? new Date().getFullYear());
      const maxYear = new Date().getFullYear() + 1;
      if (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > maxYear) {
        return res.status(400).json({
          error: `Tahun terbit harus berupa angka antara 1800 hingga ${maxYear}.`,
        });
      }

      const totalCopies = Math.max(
        1,
        Math.floor(Number(body.total_copies ?? body.stock ?? 1) || 1)
      );
      const rawAvailable =
        body.available_copies !== undefined ? Number(body.available_copies) : totalCopies;
      const availableCopies = Math.max(
        0,
        Math.min(totalCopies, Number.isFinite(rawAvailable) ? Math.floor(rawAvailable) : totalCopies)
      );
      const nowIso = new Date().toISOString();

      const { data: insertedRows, error: insertErr } = await supabaseAdmin
        .from('books')
        .insert({
          title: cleanTitle,
          author: cleanAuthor,
          publisher: String(body.publisher || 'Penerbit Mandiri').trim() || 'Penerbit Mandiri',
          publication_year: parsedYear,
          isbn: String(body.isbn || 'ISBN-978-000-000').trim() || 'ISBN-978-000-000',
          category_id: cleanCategoryId,
          description: body.description ? String(body.description).trim() : null,
          cover_path: body.cover_path || body.coverUrl || null,
          file_path: body.file_path || null,
          file_type: body.file_type || null,
          total_copies: totalCopies,
          available_copies: availableCopies,
          is_published: body.is_published !== undefined ? Boolean(body.is_published) : true,
          is_archived: false,
          created_by: authCheck.adminProfile.id,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('*');

      if (insertErr) {
        const permDenied = isDbPermissionDeniedError(insertErr);
        const isFk = String(insertErr.code || '') === '23503';
        return res.status(isFk ? 400 : 500).json({
          error: isFk
            ? 'Kategori buku tidak ditemukan atau tidak valid.'
            : `Gagal menyimpan buku baru: ${insertErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : insertErr.code || 'BOOK_INSERT_FAILED',
        });
      }

      const book = insertedRows?.[0];
      if (!book) {
        return res.status(500).json({ error: 'Buku gagal ditambahkan ke database.' });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: authCheck.adminProfile.id,
          action: 'create_book',
          entity_type: 'books',
          entity_id: book.id,
          details: JSON.stringify({ title: cleanTitle }),
          created_at: nowIso,
        });
      } catch {
        // Non-kritikal
      }

      const catMap = await loadCategoryMapSafe(supabaseAdmin);
      const cat = book.category_id ? catMap.get(book.category_id) : undefined;
      return res.status(201).json({
        success: true,
        book: {
          ...book,
          is_published: book.is_published !== false,
          is_archived: Boolean(book.is_archived),
          ...(cat ? { category: cat, category_name: cat.name } : {}),
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat menambahkan buku.',
      });
    }
  });

  // Endpoint perbarui / arsipkan buku oleh Admin/Super Admin via SUPABASE_SERVICE_ROLE_KEY
  app.patch('/api/admin/books/:id', async (req: Request, res: Response) => {
    try {
      const bookId = String(req.params.id || '').trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({ error: 'ID buku tidak valid.' });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const rawUpdates = ((req.body || {}) as Record<string, any>) || {};
      const result = await withBookStockLock(bookId, async () => {
        const { data: existingRows, error: fetchErr } = await supabaseAdmin
          .from('books')
          .select('*')
          .eq('id', bookId);

        if (fetchErr) {
          const permDenied = isDbPermissionDeniedError(fetchErr);
          return {
            status: 500,
            payload: {
              error: `Gagal memeriksa data buku: ${fetchErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : fetchErr.code || 'BOOK_FETCH_FAILED',
            },
          };
        }

        const existingBook = existingRows?.[0];
        if (!existingBook) {
          return {
            status: 404,
            payload: {
              error: 'Data buku tidak ditemukan di database.',
              code: 'BOOK_NOT_FOUND',
            },
          };
        }

        const cleanUpdates: Record<string, any> = {};

        if (rawUpdates.title !== undefined) {
          const title = String(rawUpdates.title || '').trim();
          if (title.length < 2) {
            return {
              status: 400,
              payload: { error: 'Judul buku wajib diisi minimal 2 karakter.', code: 'INVALID_INPUT' },
            };
          }
          cleanUpdates.title = title;
        }

        if (rawUpdates.author !== undefined) {
          const author = String(rawUpdates.author || '').trim();
          if (author.length < 2) {
            return {
              status: 400,
              payload: { error: 'Nama penulis wajib diisi minimal 2 karakter.', code: 'INVALID_INPUT' },
            };
          }
          cleanUpdates.author = author;
        }

        if (rawUpdates.publisher !== undefined) {
          cleanUpdates.publisher = String(rawUpdates.publisher || '').trim() || 'Penerbit Mandiri';
        }

        if (rawUpdates.publication_year !== undefined || rawUpdates.year !== undefined) {
          const pubYear = Number(rawUpdates.publication_year ?? rawUpdates.year);
          const maxYear = new Date().getFullYear() + 1;
          if (!Number.isInteger(pubYear) || pubYear < 1800 || pubYear > maxYear) {
            return {
              status: 400,
              payload: {
                error: `Tahun terbit harus berupa angka antara 1800 hingga ${maxYear}.`,
                code: 'INVALID_INPUT',
              },
            };
          }
          cleanUpdates.publication_year = pubYear;
        }

        if (rawUpdates.isbn !== undefined) {
          const isbn = String(rawUpdates.isbn || '').trim();
          if (isbn.length > 0 && !/^[0-9Xx\-\s]{4,32}$/.test(isbn)) {
            return {
              status: 400,
              payload: {
                error: 'Format nomor ISBN tidak valid.',
                code: 'INVALID_INPUT',
              },
            };
          }
          cleanUpdates.isbn = isbn || 'ISBN-978-000-000';
        }

        if (rawUpdates.category_id !== undefined) {
          const catId = String(rawUpdates.category_id || '').trim();
          if (!catId) {
            return {
              status: 400,
              payload: { error: 'Kategori buku wajib dipilih.', code: 'INVALID_INPUT' },
            };
          }
          cleanUpdates.category_id = catId;
        }

        if (rawUpdates.description !== undefined) {
          cleanUpdates.description = rawUpdates.description
            ? String(rawUpdates.description).trim()
            : null;
        }

        if (rawUpdates.cover_path !== undefined || rawUpdates.coverUrl !== undefined) {
          const cov = rawUpdates.cover_path !== undefined ? rawUpdates.cover_path : rawUpdates.coverUrl;
          cleanUpdates.cover_path = cov ? String(cov).trim() : null;
        }

        if (rawUpdates.file_path !== undefined) {
          cleanUpdates.file_path = rawUpdates.file_path ? String(rawUpdates.file_path).trim() : null;
        }

        if (rawUpdates.file_type !== undefined) {
          cleanUpdates.file_type = rawUpdates.file_type ? String(rawUpdates.file_type).trim() : null;
        }

        if (rawUpdates.is_published !== undefined) {
          cleanUpdates.is_published = Boolean(rawUpdates.is_published);
        }

        if (rawUpdates.is_archived !== undefined) {
          cleanUpdates.is_archived = Boolean(rawUpdates.is_archived);
        }

        if (rawUpdates.total_copies !== undefined || rawUpdates.stock !== undefined) {
          const requestedTotal = Number(rawUpdates.total_copies ?? rawUpdates.stock);
          const stockCalc = recalculateBookStockOnEdit(
            existingBook.total_copies,
            existingBook.available_copies,
            requestedTotal
          );
          if (!stockCalc.valid) {
            return {
              status: 400,
              payload: {
                error: stockCalc.error,
                code: 'INVALID_BOOK_STOCK',
              },
            };
          }

          // Validasi tambahan terhadap jumlah pinjaman aktif (approved/borrowed) di database
          const { data: activeIssuedLoans, error: activeErr } = await supabaseAdmin
            .from('loans')
            .select('id')
            .eq('book_id', bookId)
            .in('status', ['approved', 'borrowed']);

          if (!activeErr && Array.isArray(activeIssuedLoans)) {
            if (stockCalc.totalCopies < activeIssuedLoans.length) {
              return {
                status: 409,
                payload: {
                  error: `Total eksemplar (${stockCalc.totalCopies}) tidak boleh lebih kecil dari jumlah pinjaman aktif (${activeIssuedLoans.length} eksemplar).`,
                  code: 'BOOK_STOCK_BELOW_ACTIVE_LOANS',
                },
              };
            }
            cleanUpdates.total_copies = stockCalc.totalCopies;
            cleanUpdates.available_copies = Math.max(
              0,
              Math.min(stockCalc.availableCopies, stockCalc.totalCopies - activeIssuedLoans.length)
            );
          } else {
            cleanUpdates.total_copies = stockCalc.totalCopies;
            cleanUpdates.available_copies = stockCalc.availableCopies;
          }
        }

        cleanUpdates.updated_at = new Date().toISOString();

        const { data: updatedRows, error: updateErr } = await supabaseAdmin
          .from('books')
          .update(cleanUpdates)
          .eq('id', bookId)
          .select('*');

        if (updateErr) {
          const permDenied = isDbPermissionDeniedError(updateErr);
          const isFk = String(updateErr.code || '') === '23503';
          return {
            status: isFk ? 400 : 500,
            payload: {
              error: isFk
                ? 'Kategori buku tidak ditemukan atau tidak valid.'
                : `Gagal memperbarui buku: ${updateErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : updateErr.code || 'BOOK_UPDATE_FAILED',
            },
          };
        }

        const book = updatedRows?.[0];
        if (!book) {
          return {
            status: 404,
            payload: { error: 'Data buku tidak ditemukan.', code: 'BOOK_NOT_FOUND' },
          };
        }

        const actionName =
          rawUpdates.is_archived === true
            ? 'archive_book'
            : rawUpdates.is_archived === false
              ? 'restore_book'
              : 'update_book';

        try {
          await supabaseAdmin.from('activity_logs').insert({
            actor_id: authCheck.adminProfile.id,
            action: actionName,
            entity_type: 'books',
            entity_id: bookId,
            details: JSON.stringify({ title: book.title, is_archived: Boolean(book.is_archived) }),
            created_at: cleanUpdates.updated_at,
          });
        } catch {
          // Non-kritikal
        }

        const catMap = await loadCategoryMapSafe(supabaseAdmin);
        const cat = book.category_id ? catMap.get(book.category_id) : undefined;
        return {
          status: 200,
          payload: {
            success: true,
            book: {
              ...book,
              is_published: book.is_published !== false,
              is_archived: Boolean(book.is_archived),
              ...(cat ? { category: cat, category_name: cat.name } : {}),
            },
          },
        };
      });

      return res.status(result.status).json(result.payload);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memperbarui buku.',
      });
    }
  });

  // Endpoint hapus buku permanen oleh Admin/Super Admin via SUPABASE_SERVICE_ROLE_KEY
  app.delete('/api/admin/books/:id', async (req: Request, res: Response) => {
    try {
      const bookId = String(req.params.id || '').trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({ error: 'ID buku tidak valid.' });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const result = await withBookStockLock(bookId, async () => {
        // 1. Pastikan buku benar-benar ada di database
        const { data: existingRows, error: fetchErr } = await supabaseAdmin
          .from('books')
          .select('id, title, cover_path, file_path')
          .eq('id', bookId);

        if (fetchErr) {
          const permDenied = isDbPermissionDeniedError(fetchErr);
          return {
            status: 500,
            payload: {
              error: `Gagal memeriksa data buku: ${fetchErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : fetchErr.code || 'BOOK_FETCH_FAILED',
            },
          };
        }

        const existingBook = existingRows?.[0];
        if (!existingBook) {
          return {
            status: 404,
            payload: {
              error: 'Buku tidak ditemukan atau sudah dihapus sebelumnya.',
              code: 'BOOK_NOT_FOUND',
            },
          };
        }

        // 2. Tolak penghapusan jika masih memiliki peminjaman aktif/menunggu persetujuan
        const { data: activeLoans, error: activeLoansErr } = await supabaseAdmin
          .from('loans')
          .select('id')
          .eq('book_id', bookId)
          .in('status', ['pending', 'approved', 'borrowed'])
          .limit(1);

        if (activeLoansErr) {
          const permDenied = isDbPermissionDeniedError(activeLoansErr);
          return {
            status: 500,
            payload: {
              error: `Gagal memeriksa status peminjaman aktif buku: ${activeLoansErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : activeLoansErr.code || 'LOANS_CHECK_FAILED',
            },
          };
        }

        if (activeLoans && activeLoans.length > 0) {
          return {
            status: 409,
            payload: {
              error:
                'Buku ini tidak dapat dihapus permanen karena masih memiliki transaksi peminjaman aktif atau menunggu persetujuan. Selesaikan peminjaman terlebih dahulu atau gunakan fitur Arsipkan Buku.',
              code: 'BOOK_HAS_ACTIVE_LOANS',
              canArchive: true,
            },
          };
        }

        // 3. Tolak penghapusan permanen jika memiliki riwayat peminjaman (returned/rejected/expired)
        //    agar data historis tabel loans tidak rusak atau terhapus.
        const { data: anyLoans, error: historyErr } = await supabaseAdmin
          .from('loans')
          .select('id, status')
          .eq('book_id', bookId)
          .limit(1);

        if (historyErr) {
          const permDenied = isDbPermissionDeniedError(historyErr);
          return {
            status: 500,
            payload: {
              error: `Gagal memeriksa riwayat peminjaman buku: ${historyErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : historyErr.code || 'LOANS_CHECK_FAILED',
            },
          };
        }

        if (anyLoans && anyLoans.length > 0) {
          return {
            status: 409,
            payload: {
              error:
                'Buku ini memiliki riwayat transaksi peminjaman sehingga tidak dapat dihapus permanen demi menjaga keutuhan data laporan dan riwayat anggota. Gunakan fitur Arsipkan Buku untuk menyembunyikannya dari katalog pengunjung.',
              code: 'BOOK_HAS_LOAN_HISTORY',
              canArchive: true,
            },
          };
        }

        // 4. Hapus buku secara atomik di PostgreSQL dan verifikasi 1 baris terhapus
        const { data: deletedRows, error: deleteErr } = await supabaseAdmin
          .from('books')
          .delete()
          .eq('id', bookId)
          .select('id');

        if (deleteErr) {
          const permDenied = isDbPermissionDeniedError(deleteErr);
          if (String(deleteErr.code || '') === '23503') {
            return {
              status: 409,
              payload: {
                error:
                  'Buku ini masih dirujuk oleh data transaksi peminjaman sehingga tidak dapat dihapus permanen. Gunakan fitur Arsipkan Buku agar riwayat peminjaman tetap terjaga.',
                code: 'BOOK_HAS_LOAN_HISTORY',
                canArchive: true,
              },
            };
          }
          return {
            status: 500,
            payload: {
              error: `Gagal menghapus buku: ${deleteErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : deleteErr.code || 'BOOK_DELETE_FAILED',
            },
          };
        }

        if (!deletedRows || deletedRows.length === 0) {
          return {
            status: 404,
            payload: {
              error: 'Buku tidak ditemukan atau gagal dihapus dari database.',
              code: 'BOOK_NOT_FOUND',
            },
          };
        }

        // Catatan keamanan Storage: file sampul/PDF di bucket tidak dihapus otomatis
        // tanpa memastikan tidak direferensikan baris buku atau arsip lain.
        try {
          await supabaseAdmin.from('activity_logs').insert({
            actor_id: authCheck.adminProfile.id,
            action: 'delete_book',
            entity_type: 'books',
            entity_id: bookId,
            details: JSON.stringify({ title: existingBook.title }),
            created_at: new Date().toISOString(),
          });
        } catch {
          // Non-kritikal
        }

        return {
          status: 200,
          payload: {
            success: true,
            deletedBookId: bookId,
            storageFilesPreserved: Boolean(existingBook.cover_path || existingBook.file_path),
          },
        };
      });

      return res.status(result.status).json(result.payload);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat menghapus buku.',
      });
    }
  });

  // Endpoint log aktivitas sistem untuk Admin via SUPABASE_SERVICE_ROLE_KEY
  app.get('/api/admin/activity-logs', async (req: Request, res: Response) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const rawLimit = Number(req.query.limit ?? 25);
      const safeLimit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 25));

      const { data: logs, error: logsErr } = await supabaseAdmin
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(safeLimit);

      if (logsErr) {
        const permDenied = isDbPermissionDeniedError(logsErr);
        return res.status(500).json({
          error: `Gagal memuat log aktivitas: ${logsErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : logsErr.code || 'ACTIVITY_LOGS_FETCH_FAILED',
        });
      }

      return res.json({ logs: logs || [] });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memuat log aktivitas.',
      });
    }
  });

  // Helper untuk melengkapi data transaksi peminjaman dengan data buku & profil peminjam
  const enrichLoanRows = async (supabaseAdmin: SupabaseClient, loanRows: any[]) => {
    if (!Array.isArray(loanRows) || loanRows.length === 0) return [];
    const bookIds = Array.from(new Set(loanRows.map((l) => l.book_id).filter(Boolean)));
    const userIds = Array.from(new Set(loanRows.map((l) => l.user_id).filter(Boolean)));

    const [booksRes, profilesRes, catMap] = await Promise.all([
      bookIds.length > 0
        ? supabaseAdmin
            .from('books')
            .select(
              'id, title, author, publisher, publication_year, cover_path, file_path, file_type, available_copies, total_copies, category_id'
            )
            .in('id', bookIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      userIds.length > 0
        ? supabaseAdmin
            .from('profiles')
            .select('id, full_name, username, role')
            .in('id', userIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      loadCategoryMapSafe(supabaseAdmin),
    ]);

    const bookMap = new Map<string, any>();
    for (const b of booksRes.data || []) {
      const cat = b.category_id ? catMap.get(b.category_id) : undefined;
      bookMap.set(b.id, {
        ...b,
        ...(cat ? { category: cat, category_name: cat.name } : {}),
      });
    }

    const profileMap = new Map<string, any>();
    for (const p of profilesRes.data || []) {
      profileMap.set(p.id, p);
    }

    return loanRows.map((loan) => ({
      ...loan,
      book: bookMap.get(loan.book_id) ?? undefined,
      profile: profileMap.get(loan.user_id) ?? undefined,
    }));
  };

  // Endpoint daftar peminjaman terverifikasi (Admin melihat semua; Pengunjung hanya melihat miliknya)
  app.get('/api/loans', async (req: Request, res: Response) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        'memuat daftar peminjaman'
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;

      let query = supabaseAdmin
        .from('loans')
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        )
        .order('requested_at', { ascending: false });

      if (!isActorAdmin) {
        query = query.eq('user_id', actor.id);
      }

      const { data: loanRows, error: loansErr } = await query;
      if (loansErr) {
        const isPermDenied = isDbPermissionDeniedError(loansErr);
        if (isPermDenied) {
          console.error('[LOANS_LIST_PERMISSION_DENIED]', {
            actorId: actor.id,
            code: loansErr.code,
            message: loansErr.message,
          });
          return res.status(500).json({
            error:
              'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang.',
            code: 'DB_PERMISSION_DENIED',
          });
        }
        return res.status(500).json({
          error: `Gagal memuat data peminjaman: ${loansErr.message}`,
          code: loansErr.code || 'LOANS_FETCH_FAILED',
        });
      }

      const enriched = await enrichLoanRows(supabaseAdmin, loanRows || []);
      return res.json({ loans: enriched });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat memuat daftar peminjaman.',
      });
    }
  });

  // Endpoint pengajuan peminjaman buku oleh pengunjung/anggota terautentikasi (tanpa durasi hari)
  app.post('/api/loans', async (req: Request, res: Response) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        'mengajukan peminjaman buku'
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const body = (req.body || {}) as Record<string, unknown>;
      const bookId = typeof body.bookId === 'string' ? body.bookId.trim() : '';
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: 'ID buku yang dipilih tidak valid.',
          code: 'INVALID_BOOK_ID',
        });
      }

      const { data: bookRows, error: bookErr } = await supabaseAdmin
        .from('books')
        .select(
          'id, title, author, publisher, publication_year, cover_path, file_path, file_type, available_copies, total_copies, is_published, is_archived, category_id'
        )
        .eq('id', bookId)
        .limit(2);

      if (bookErr) {
        const permDenied = isDbPermissionDeniedError(bookErr);
        return res.status(500).json({
          error: `Gagal memeriksa data buku: ${bookErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : bookErr.code || 'BOOK_FETCH_FAILED',
        });
      }

      const book = bookRows?.[0];
      if (!book) {
        return res.status(404).json({
          error: 'Buku tidak ditemukan.',
          code: 'BOOK_NOT_FOUND',
        });
      }

      if (book.is_published === false || book.is_archived) {
        return res.status(409).json({
          error: 'Maaf, buku ini sedang diarsipkan atau belum dipublikasikan untuk dipinjam.',
          code: 'BOOK_UNAVAILABLE',
        });
      }

      if (Number(book.available_copies ?? 0) <= 0) {
        return res.status(409).json({
          error: 'Maaf, eksemplar buku ini sedang tidak tersedia.',
          code: 'BOOK_OUT_OF_STOCK',
        });
      }

      const { data: existingLoans, error: existingErr } = await supabaseAdmin
        .from('loans')
        .select('id, status')
        .eq('user_id', actor.id)
        .eq('book_id', bookId)
        .in('status', ['pending', 'approved', 'borrowed'])
        .limit(1);

      if (existingErr) {
        const isPermDenied = isDbPermissionDeniedError(existingErr);
        return res.status(500).json({
          error: isPermDenied
            ? 'Izin database server untuk memeriksa tabel peminjaman (loans) belum aktif (kode 42501).'
            : `Gagal memeriksa status peminjaman sebelumnya: ${existingErr.message}`,
          code: isPermDenied ? 'DB_PERMISSION_DENIED' : existingErr.code || 'LOAN_CHECK_FAILED',
        });
      }

      if (existingLoans && existingLoans.length > 0) {
        return res.status(409).json({
          error: 'Anda sudah memiliki permintaan atau peminjaman aktif untuk buku ini.',
          code: 'DUPLICATE_ACTIVE_LOAN',
        });
      }

      const requestedAt = new Date().toISOString();
      const rawNotes = typeof body.notes === 'string' ? body.notes.trim() : '';
      const cleanNote = rawNotes ? `Catatan peminjam: ${rawNotes.slice(0, 450)}` : null;

      const { data: insertedRows, error: insertErr } = await supabaseAdmin
        .from('loans')
        .insert({
          user_id: actor.id,
          book_id: bookId,
          status: 'pending',
          requested_at: requestedAt,
          approved_at: null,
          due_at: null,
          returned_at: null,
          admin_note: cleanNote,
        })
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        );

      if (insertErr) {
        const isPermDenied = isDbPermissionDeniedError(insertErr);
        return res.status(500).json({
          error: isPermDenied
            ? 'Izin database server untuk membuat pengajuan peminjaman (loans) belum aktif (kode 42501).'
            : `Gagal mengajukan peminjaman: ${insertErr.message}`,
          code: isPermDenied ? 'DB_PERMISSION_DENIED' : insertErr.code || 'LOAN_INSERT_FAILED',
        });
      }

      const createdLoan = insertedRows?.[0];
      if (!createdLoan) {
        return res.status(500).json({
          error: 'Pengajuan peminjaman gagal dikonfirmasi oleh database.',
          code: 'LOAN_INSERT_EMPTY',
        });
      }

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: actor.id,
          action: 'request_loan',
          entity_type: 'loans',
          entity_id: createdLoan.id,
          details: JSON.stringify({ book_title: book.title }),
          created_at: requestedAt,
        });
      } catch {
        // Non-kritikal
      }

      const [enriched] = await enrichLoanRows(supabaseAdmin, [createdLoan]);
      return res.status(201).json({
        success: true,
        loan: enriched || {
          ...createdLoan,
          book,
          profile: {
            id: actor.id,
            full_name: actor.full_name,
            username: actor.username,
            role: actor.role,
          },
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan server saat mengajukan peminjaman buku.',
        code: 'INTERNAL_LOAN_REQUEST_ERROR',
      });
    }
  });

  // Endpoint resmi & aman untuk pengembalian buku berdasarkan primary key transaksi (loans.id)
  // - Memprioritaskan fungsi PostgreSQL atomik `return_loan_atomic` (row locking FOR UPDATE dalam 1 transaksi)
  // - Jika RPC belum terpasang, menjalankan serialisasi per buku + rollback kompensasi penuh jika update stok gagal
  // - Tidak pernah menggunakan .single() yang memicu PGRST116
  // - Mengembalikan stok buku tepat 1 kali (mendeteksi trigger database agar tidak terjadi penggandaan stok)
  // - Menjaga keutuhan riwayat peminjaman (tidak pernah menghapus baris loans)
  app.post('/api/loans/:id/return', async (req: Request, res: Response) => {
    try {
      const loanId = String(req.params.id || '').trim();
      if (!isValidUuid(loanId)) {
        return res.status(400).json({
          error: 'ID transaksi peminjaman tidak valid.',
          code: 'INVALID_LOAN_ID',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || 'Konfigurasi admin server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;

      const isPermissionDenied = isDbPermissionDeniedError;

      // Helper untuk menyusun objek Loan lengkap beserta data book & profile
      const buildEnrichedLoan = async (loanRow: any) => {
        const [{ data: bookRows }, { data: profileRows }] = await Promise.all([
          supabaseAdmin
            .from('books')
            .select('id, title, author, cover_path, file_path, file_type, total_copies, available_copies')
            .eq('id', loanRow.book_id)
            .limit(2),
          supabaseAdmin
            .from('profiles')
            .select('id, full_name, username')
            .eq('id', loanRow.user_id)
            .limit(2),
        ]);

        if (bookRows && bookRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'buildEnrichedLoan.books_by_id',
            loanId,
            bookId: loanRow.book_id,
            rowCount: bookRows.length,
          });
        }
        if (profileRows && profileRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'buildEnrichedLoan.profiles_by_id',
            loanId,
            userId: loanRow.user_id,
            rowCount: profileRows.length,
          });
        }

        return {
          ...loanRow,
          book: bookRows?.[0] ?? undefined,
          profile: profileRows?.[0] ?? undefined,
        };
      };

      // 0. Jalur Transaksi Atomik PostgreSQL (return_loan_atomic dengan FOR UPDATE)
      if (typeof (supabaseAdmin as any).rpc === 'function') {
        const { data: rpcResult, error: rpcError } = await (supabaseAdmin as any).rpc(
          'return_loan_atomic',
          {
            p_loan_id: loanId,
            p_actor_id: actor.id,
            p_is_admin: isActorAdmin,
          }
        );

        if (rpcError) {
          if (!isMissingRpcFunctionError(rpcError, 'return_loan_atomic')) {
            if (isPermissionDenied(rpcError)) {
              const envStatus = inspectServerSupabaseEnv();
              console.error('[RETURN_BOOK_PERMISSION_DENIED]', {
                loanId,
                actorId: actor.id,
                table: 'loans',
                operation: 'rpc:return_loan_atomic',
                code: rpcError.code || '42501',
                message: rpcError.message,
                keyStatus: envStatus.keyStatus,
              });
              return res.status(500).json({
                error:
                  'Izin database server untuk memproses pengembalian buku (loans) belum aktif (kode 42501). Pastikan migrasi GRANT & fungsi return_loan_atomic sudah dijalankan.',
                code: 'DB_PERMISSION_DENIED',
              });
            }
            console.error('[RETURN_BOOK_ATOMIC_RPC_ERROR]', {
              loanId,
              actorId: actor.id,
              code: rpcError.code,
              message: rpcError.message,
            });
            return res.status(500).json({
              error: formatBookReturnErrorMessage(rpcError),
              code: rpcError.code || 'ATOMIC_RETURN_FAILED',
            });
          }
        } else if (rpcResult && typeof rpcResult === 'object') {
          if (rpcResult.ok === false) {
            return res.status(Number(rpcResult.http_status) || 409).json({
              error: rpcResult.error || 'Pengembalian buku belum dapat diproses.',
              code: rpcResult.code || 'RETURN_REJECTED',
              ...(rpcResult.current_status ? { currentStatus: rpcResult.current_status } : {}),
            });
          }
          if (rpcResult.ok === true && rpcResult.loan) {
            const enriched = await buildEnrichedLoan(rpcResult.loan);
            return res.json({
              success: true,
              atomicRpc: true,
              alreadyReturned: Boolean(rpcResult.already_returned),
              stockAdjusted: Boolean(rpcResult.stock_adjusted),
              stockSource: rpcResult.stock_source || 'none',
              loan: enriched,
              ...(rpcResult.message ? { message: rpcResult.message } : {}),
            });
          }
        }
      }

      // 1. Baca awal transaksi berdasarkan primary key id untuk menentukan book_id & otorisasi
      const { data: peekLoanRows, error: peekLoanError } = await supabaseAdmin
        .from('loans')
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        )
        .eq('id', loanId)
        .limit(2);

      if (peekLoanError) {
        if (isPermissionDenied(peekLoanError)) {
          const envStatus = inspectServerSupabaseEnv();
          console.error('[RETURN_BOOK_PERMISSION_DENIED]', {
            loanId,
            actorId: actor.id,
            table: 'loans',
            operation: 'select',
            code: peekLoanError.code,
            message: peekLoanError.message,
            keyStatus: envStatus.keyStatus,
          });
          return res.status(500).json({
            error:
              'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY di Vercel sudah terpasang dengan benar.',
            code: 'DB_PERMISSION_DENIED',
          });
        }

        console.error('[RETURN_BOOK_FETCH_ERROR]', {
          loanId,
          actorId: actor.id,
          code: peekLoanError.code,
          message: peekLoanError.message,
        });
        return res.status(500).json({
          error: formatBookReturnErrorMessage(peekLoanError),
          code: peekLoanError.code || 'LOAN_FETCH_FAILED',
        });
      }

      if (!peekLoanRows || peekLoanRows.length === 0) {
        return res.status(404).json({
          error: 'Data transaksi peminjaman tidak ditemukan.',
          code: 'LOAN_NOT_FOUND',
        });
      }

      if (peekLoanRows.length > 1) {
        console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
          query: 'loans_select_by_pk',
          loanId,
          rowCount: peekLoanRows.length,
        });
        return res.status(409).json({
          error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.',
          code: 'DUPLICATE_LOAN_TRANSACTION',
        });
      }

      const peekLoan = peekLoanRows[0];

      // 2. Pastikan hanya pemilik transaksi atau Admin aktif yang berhak mengembalikan
      if (!isActorAdmin && peekLoan.user_id !== actor.id) {
        return res.status(403).json({
          error: 'Anda tidak memiliki izin untuk mengembalikan transaksi peminjaman milik anggota lain.',
          code: 'FORBIDDEN',
        });
      }

      return await withBookStockLock(peekLoan.book_id, async () => {
        const { data: loanRows, error: fetchLoanError } = await supabaseAdmin
          .from('loans')
          .select(
            'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
          )
          .eq('id', loanId)
          .limit(2);

        if (fetchLoanError) {
          if (isPermissionDenied(fetchLoanError)) {
            return res.status(500).json({
              error:
                'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501).',
              code: 'DB_PERMISSION_DENIED',
            });
          }
          return res.status(500).json({
            error: formatBookReturnErrorMessage(fetchLoanError),
            code: fetchLoanError.code || 'LOAN_FETCH_FAILED',
          });
        }

        if (!loanRows || loanRows.length === 0) {
          return res.status(404).json({
            error: 'Data transaksi peminjaman tidak ditemukan.',
            code: 'LOAN_NOT_FOUND',
          });
        }

        if (loanRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'loans_select_by_pk',
            loanId,
            rowCount: loanRows.length,
          });
          return res.status(409).json({
            error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.',
            code: 'DUPLICATE_LOAN_TRANSACTION',
          });
        }

        const existingLoan = loanRows[0];

        // 3. Periksa kelayakan status transaksi (idempoten untuk 'returned', tolak selain active; tidak melarang pengembalian sebelum due_at)
        const eligibility = evaluateLoanReturnEligibility(existingLoan.status);
        if (!eligibility.eligible) {
          if (eligibility.reason === 'already_returned') {
            const enriched = await buildEnrichedLoan(existingLoan);
            return res.json({
              success: true,
              alreadyReturned: true,
              stockAdjusted: false,
              loan: enriched,
              message: eligibility.message,
            });
          }

          return res.status(409).json({
            error: eligibility.message,
            code: 'INVALID_LOAN_STATUS',
            currentStatus: existingLoan.status,
          });
        }

        // 4. Catat stok buku SEBELUM update status peminjaman (untuk deteksi trigger DB)
        const { data: beforeBookRows, error: beforeBookError } = await supabaseAdmin
          .from('books')
          .select('id, title, author, cover_path, total_copies, available_copies')
          .eq('id', existingLoan.book_id)
          .limit(2);

        if (beforeBookError) {
          if (isPermissionDenied(beforeBookError)) {
            const envStatus = inspectServerSupabaseEnv();
            console.error('[RETURN_BOOK_PERMISSION_DENIED]', {
              loanId,
              actorId: actor.id,
              table: 'books',
              operation: 'select',
              code: beforeBookError.code,
              message: beforeBookError.message,
              keyStatus: envStatus.keyStatus,
            });
            return res.status(500).json({
              error:
                'Izin database server untuk membaca tabel buku (books) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.books sudah dijalankan.',
              code: 'DB_PERMISSION_DENIED',
            });
          }
          return res.status(500).json({
            error: `Gagal memeriksa data stok buku: ${beforeBookError.message}`,
            code: beforeBookError.code || 'BOOK_FETCH_FAILED',
          });
        }

        if (beforeBookRows && beforeBookRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'beforeBook.books_by_id',
            loanId,
            bookId: existingLoan.book_id,
            rowCount: beforeBookRows.length,
          });
          return res.status(409).json({
            error: 'Terdeteksi duplikasi data buku untuk transaksi ini. Hubungi administrator.',
            code: 'DUPLICATE_BOOK_RECORD',
          });
        }

        const beforeBook = beforeBookRows?.[0] ?? null;
        const beforeAvailable = Number(beforeBook?.available_copies ?? 0);
        const totalCopies = Number(beforeBook?.total_copies ?? 0);
        const previousLoanStatus = String(existingLoan.status || 'approved');
        const previousReturnedAt = existingLoan.returned_at ?? null;

        // 5. Update tepat 1 transaksi berdasarkan primary key + syarat status aktif (TANPA .single())
        const returnedAt = new Date().toISOString();
        const { data: updatedRows, error: updateLoanError } = await supabaseAdmin
          .from('loans')
          .update({
            status: 'returned',
            returned_at: returnedAt,
            updated_at: returnedAt,
          })
          .eq('id', loanId)
          .in('status', ['approved', 'borrowed'])
          .select(
            'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
          );

        if (updateLoanError) {
          if (isPermissionDenied(updateLoanError)) {
            const envStatus = inspectServerSupabaseEnv();
            console.error('[RETURN_BOOK_PERMISSION_DENIED]', {
              loanId,
              actorId: actor.id,
              table: 'loans',
              operation: 'update',
              code: updateLoanError.code,
              message: updateLoanError.message,
              keyStatus: envStatus.keyStatus,
            });
            return res.status(500).json({
              error:
                'Izin database server untuk memperbarui tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY di Vercel sudah terpasang dengan benar.',
              code: 'DB_PERMISSION_DENIED',
            });
          }

          console.error('[RETURN_BOOK_UPDATE_ERROR]', {
            loanId,
            actorId: actor.id,
            code: updateLoanError.code,
            message: updateLoanError.message,
          });
          return res.status(500).json({
            error: formatBookReturnErrorMessage(updateLoanError),
            code: updateLoanError.code || 'LOAN_UPDATE_FAILED',
          });
        }

        // Tangani kondisi 0 baris terupdate (mis. permintaan paralel baru saja menyelesaikan return)
        if (!updatedRows || updatedRows.length === 0) {
          const { data: recheckRows } = await supabaseAdmin
            .from('loans')
            .select(
              'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
            )
            .eq('id', loanId)
            .limit(2);

          if (recheckRows && recheckRows.length > 1) {
            console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
              query: 'recheck.loans_by_pk',
              loanId,
              rowCount: recheckRows.length,
            });
            return res.status(409).json({
              error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.',
              code: 'DUPLICATE_LOAN_TRANSACTION',
            });
          }

          const latestLoan = recheckRows?.[0];
          if (latestLoan?.status === 'returned') {
            const enriched = await buildEnrichedLoan(latestLoan);
            return res.json({
              success: true,
              alreadyReturned: true,
              stockAdjusted: false,
              loan: enriched,
              message: 'Buku untuk transaksi peminjaman ini sudah dikembalikan.',
            });
          }

          return res.status(409).json({
            error: 'Status transaksi peminjaman berubah sebelum pengembalian dikonfirmasi. Muat ulang halaman dan coba lagi.',
            code: 'CONCURRENT_LOAN_MODIFICATION',
          });
        }

        if (updatedRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'loans_update_by_pk',
            loanId,
            rowCount: updatedRows.length,
          });
          return res.status(409).json({
            error: 'Terdeteksi lebih dari satu baris transaksi saat pembaruan pengembalian. Hubungi administrator.',
            code: 'DUPLICATE_LOAN_TRANSACTION',
          });
        }

        const updatedLoan = updatedRows[0];

        const rollbackReturnLoanStatus = async () => {
          try {
            await supabaseAdmin
              .from('loans')
              .update({
                status: previousLoanStatus,
                returned_at: previousReturnedAt,
                updated_at: new Date().toISOString(),
              })
              .eq('id', loanId)
              .eq('status', 'returned');
          } catch (rollbackErr: any) {
            console.error('[RETURN_BOOK_ROLLBACK_ERROR]', {
              loanId,
              bookId: existingLoan.book_id,
              message: rollbackErr?.message,
            });
          }
        };

        // 6. Rekonsiliasi stok buku: pastikan available_copies bertambah tepat +1 atau rollback penuh jika gagal
        let stockAdjusted = false;
        let stockSource: 'trigger' | 'application' | 'capped_at_total' | 'none' = 'none';

        if (beforeBook) {
          const { data: afterBookRows, error: afterBookErr } = await supabaseAdmin
            .from('books')
            .select('id, available_copies, total_copies')
            .eq('id', existingLoan.book_id)
            .limit(2);

          if (afterBookErr) {
            console.error('[RETURN_BOOK_AFTER_BOOK_FETCH_ERROR]', {
              loanId,
              bookId: existingLoan.book_id,
              code: afterBookErr.code,
              message: afterBookErr.message,
            });
            await rollbackReturnLoanStatus();
            return res.status(500).json({
              error: `Gagal memverifikasi pembaruan stok buku saat pengembalian; transaksi dibatalkan secara otomatis: ${afterBookErr.message}`,
              code: isPermissionDenied(afterBookErr) ? 'DB_PERMISSION_DENIED' : 'BOOK_STOCK_SYNC_FAILED',
              rolledBack: true,
            });
          }

          if (afterBookRows && afterBookRows.length > 1) {
            console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
              query: 'afterBook.books_by_id',
              loanId,
              bookId: existingLoan.book_id,
              rowCount: afterBookRows.length,
            });
            await rollbackReturnLoanStatus();
            return res.status(409).json({
              error: 'Terdeteksi duplikasi data buku saat sinkronisasi stok. Transaksi dibatalkan otomatis.',
              code: 'DUPLICATE_BOOK_RECORD',
              rolledBack: true,
            });
          }

          const afterBook = afterBookRows?.[0] ?? beforeBook;
          const afterAvailableNum = Number(afterBook.available_copies ?? beforeAvailable);
          if (afterAvailableNum - beforeAvailable > 1) {
            await rollbackReturnLoanStatus();
            return res.status(500).json({
              error: 'Terdeteksi penambahan stok lebih dari satu eksemplar untuk satu pengembalian. Transaksi dibatalkan otomatis.',
              code: 'DOUBLE_STOCK_INCREMENT',
              rolledBack: true,
            });
          }

          const stockPlan = computeBookStockAfterReturn({
            beforeAvailable,
            afterAvailable: afterAvailableNum,
            totalCopies: Number(afterBook.total_copies ?? totalCopies),
          });
          stockSource = stockPlan.incrementedBy;

          if (stockPlan.needsUpdate) {
            const { data: updatedBookRows, error: stockUpdateErr } = await supabaseAdmin
              .from('books')
              .update({
                available_copies: stockPlan.targetAvailable,
                updated_at: returnedAt,
              })
              .eq('id', existingLoan.book_id)
              .eq('available_copies', stockPlan.safeAfter)
              .select('id, available_copies');

            if (stockUpdateErr) {
              await rollbackReturnLoanStatus();
              if (isPermissionDenied(stockUpdateErr)) {
                const envStatus = inspectServerSupabaseEnv();
                console.error('[RETURN_BOOK_PERMISSION_DENIED]', {
                  loanId,
                  actorId: actor.id,
                  table: 'books',
                  operation: 'update',
                  code: stockUpdateErr.code,
                  message: stockUpdateErr.message,
                  keyStatus: envStatus.keyStatus,
                });
                return res.status(500).json({
                  error:
                    'Izin database server untuk memperbarui stok buku (books) belum aktif (kode 42501). Perubahan status peminjaman dibatalkan otomatis.',
                  code: 'DB_PERMISSION_DENIED',
                  rolledBack: true,
                });
              }
              console.error('[RETURN_BOOK_STOCK_SYNC_ERROR]', {
                loanId,
                bookId: existingLoan.book_id,
                message: stockUpdateErr.message,
              });
              return res.status(500).json({
                error: `Gagal memperbarui stok buku saat pengembalian; transaksi dibatalkan otomatis: ${stockUpdateErr.message}`,
                code: 'BOOK_STOCK_UPDATE_FAILED',
                rolledBack: true,
              });
            }

            if (!updatedBookRows || updatedBookRows.length === 0) {
              await rollbackReturnLoanStatus();
              return res.status(409).json({
                error: 'Stok buku berubah secara bersamaan sebelum pengembalian selesai. Transaksi dibatalkan otomatis; silakan coba lagi.',
                code: 'CONCURRENT_BOOK_STOCK_MODIFICATION',
                rolledBack: true,
              });
            }

            if (updatedBookRows.length > 1) {
              console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
                query: 'books_stock_update_by_id',
                loanId,
                bookId: existingLoan.book_id,
                rowCount: updatedBookRows.length,
              });
              await rollbackReturnLoanStatus();
              return res.status(409).json({
                error: 'Terdeteksi lebih dari satu baris buku saat pembaruan stok. Transaksi dibatalkan otomatis.',
                code: 'DUPLICATE_BOOK_RECORD',
                rolledBack: true,
              });
            }

            stockAdjusted = stockPlan.incrementedBy === 'application';
          } else if (stockPlan.incrementedBy === 'trigger') {
            stockAdjusted = true;
          }
        }

        // 7. Catat log aktivitas tanpa menghapus riwayat pinjaman
        try {
          await supabaseAdmin.from('activity_logs').insert({
            actor_id: actor.id,
            action: 'return_loan',
            entity_type: 'loans',
            entity_id: loanId,
            details: JSON.stringify({
              book_id: existingLoan.book_id,
              returned_at: returnedAt,
              stock_source: stockSource,
            }),
            created_at: returnedAt,
          });
        } catch {
          // Abaikan error logging non-kritikal agar konfirmasi pengembalian tetap sukses
        }

        console.info('[RETURN_BOOK_QUERY_TRACE]', {
          loanId,
          bookId: existingLoan.book_id,
          previousStatus: existingLoan.status,
          newStatus: updatedLoan.status,
          loanRowsMatched: loanRows.length,
          updatedLoanRows: updatedRows.length,
          stockSource,
          stockAdjusted,
        });

        const enriched = await buildEnrichedLoan(updatedLoan);
        return res.json({
          success: true,
          alreadyReturned: false,
          stockAdjusted,
          stockSource,
          loan: enriched,
        });
      });
    } catch (err: any) {
      console.error('[RETURN_BOOK_ENDPOINT_ERROR]', {
        loanId: req.params?.id,
        message: err?.message,
      });
      return res.status(500).json({
        error: formatBookReturnErrorMessage(err),
        code: 'INTERNAL_RETURN_ERROR',
      });
    }
  });

  // Endpoint log-only untuk mencatat detail teknis kegagalan konfirmasi pengembalian buku ke server log
  // (tanpa menyentuh tabel loans, stok buku, ataupun struktur database)
  app.post('/api/loans/return-error-log', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan untuk mencatat log teknis pengembalian.',
        });
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !authData?.user) {
        return res.status(401).json({
          error: 'Sesi pengguna tidak valid.',
        });
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const rawLoanId = typeof body.loanId === 'string' ? body.loanId.trim().slice(0, 64) : '';
      const rawCode = typeof body.code === 'string' ? body.code.trim().slice(0, 64) : undefined;
      const rawMessage =
        typeof body.message === 'string' ? body.message.trim().slice(0, 500) : 'Unknown error';
      const rawDetails =
        typeof body.details === 'string' ? body.details.trim().slice(0, 500) : undefined;

      console.error('[RETURN_BOOK_SERVER_LOG]', {
        actorId: authData.user.id,
        loanId: isValidUuid(rawLoanId) ? rawLoanId : rawLoanId || undefined,
        code: rawCode,
        message: rawMessage,
        details: rawDetails,
        timestamp: new Date().toISOString(),
      });

      return res.json({ logged: true });
    } catch (err: any) {
      console.error('[RETURN_BOOK_SERVER_LOG_FALLBACK]', {
        message: err?.message || 'Gagal mencatat error teknis pengembalian.',
      });
      return res.status(500).json({ logged: false });
    }
  });

  // Endpoint persetujuan peminjaman buku oleh Admin/Super Admin via SUPABASE_SERVICE_ROLE_KEY
  // - Memprioritaskan fungsi PostgreSQL atomik `approve_loan_atomic` (row locking FOR UPDATE pada loans & books)
  // - Jika RPC belum terpasang, memakai per-book mutex + optimistic lock + rollback kompensasi penuh jika update stok gagal
  app.post('/api/loans/:id/approve', async (req: Request, res: Response) => {
    try {
      const loanId = String(req.params.id || '').trim();
      if (!isValidUuid(loanId)) {
        return res.status(400).json({
          error: 'ID transaksi peminjaman tidak valid.',
          code: 'INVALID_LOAN_ID',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || 'Konfigurasi admin server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        'menyetujui peminjaman buku'
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      if (!isActorAdmin) {
        return res.status(403).json({
          error: 'Hanya administrator aktif yang berwenang menyetujui peminjaman buku.',
          code: 'FORBIDDEN',
        });
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const adminNote =
        typeof body.adminNote === 'string' && body.adminNote.trim()
          ? body.adminNote.trim().slice(0, 500)
          : 'Peminjaman telah disetujui administrator perpustakaan.';

      // 0. Jalur Transaksi Atomik PostgreSQL (approve_loan_atomic dengan FOR UPDATE)
      if (typeof (supabaseAdmin as any).rpc === 'function') {
        const { data: rpcResult, error: rpcError } = await (supabaseAdmin as any).rpc(
          'approve_loan_atomic',
          {
            p_loan_id: loanId,
            p_actor_id: actor.id,
            p_admin_note: adminNote,
          }
        );

        if (rpcError) {
          if (!isMissingRpcFunctionError(rpcError, 'approve_loan_atomic')) {
            const permDenied = isDbPermissionDeniedError(rpcError);
            if (permDenied) {
              console.error('[LOAN_APPROVE_PERMISSION_DENIED]', {
                loanId,
                actorId: actor.id,
                table: 'loans',
                operation: 'rpc:approve_loan_atomic',
                code: rpcError.code || '42501',
                keyStatus: inspectServerSupabaseEnv().keyStatus,
              });
            }
            return res.status(500).json({
              error: permDenied
                ? 'Izin database server untuk menyetujui peminjaman (approve_loan_atomic) belum aktif (kode 42501).'
                : `Gagal menyetujui peminjaman: ${rpcError.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : rpcError.code || 'ATOMIC_APPROVE_FAILED',
            });
          }
        } else if (rpcResult && typeof rpcResult === 'object') {
          if (rpcResult.ok === false) {
            return res.status(Number(rpcResult.http_status) || 409).json({
              error: rpcResult.error || 'Persetujuan peminjaman ditolak.',
              code: rpcResult.code || 'APPROVE_REJECTED',
            });
          }
          if (rpcResult.ok === true && rpcResult.loan) {
            const approvedLoanRow = rpcResult.loan;
            const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
              supabaseAdmin
                .from('books')
                .select('id, title, author, cover_path, file_path, available_copies, total_copies')
                .eq('id', approvedLoanRow.book_id)
                .limit(2),
              supabaseAdmin
                .from('profiles')
                .select('id, full_name, username')
                .eq('id', approvedLoanRow.user_id)
                .limit(2),
            ]);

            return res.json({
              success: true,
              atomicRpc: true,
              stockAdjusted: Boolean(rpcResult.stock_adjusted),
              stockSource: rpcResult.stock_source || 'none',
              loan: {
                ...approvedLoanRow,
                due_at: null,
                book: enrichedBookRows?.[0] ?? undefined,
                profile: enrichedProfileRows?.[0] ?? undefined,
              },
            });
          }
        }
      }

      // 1. Baca awal transaksi untuk mengetahui book_id sebelum mengunci antrean per buku
      const { data: peekLoanRows, error: peekLoanError } = await supabaseAdmin
        .from('loans')
        .select('id, user_id, book_id, status, admin_note')
        .eq('id', loanId)
        .limit(2);

      if (peekLoanError) {
        const permDenied = isDbPermissionDeniedError(peekLoanError);
        if (permDenied) {
          console.error('[LOAN_APPROVE_PERMISSION_DENIED]', {
            loanId,
            actorId: actor.id,
            table: 'loans',
            operation: 'select',
            code: peekLoanError.code || '42501',
            keyStatus: inspectServerSupabaseEnv().keyStatus,
          });
        }
        return res.status(500).json({
          error: permDenied
            ? 'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang.'
            : `Gagal memeriksa transaksi peminjaman: ${peekLoanError.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : peekLoanError.code || 'LOAN_FETCH_FAILED',
        });
      }

      if (!peekLoanRows || peekLoanRows.length === 0) {
        return res.status(404).json({
          error: 'Data transaksi peminjaman tidak ditemukan.',
          code: 'LOAN_NOT_FOUND',
        });
      }

      if (peekLoanRows.length > 1) {
        return res.status(409).json({
          error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini.',
          code: 'DUPLICATE_LOAN_TRANSACTION',
        });
      }

      const peekLoan = peekLoanRows[0];

      return await withBookStockLock(peekLoan.book_id, async () => {
        const { data: loanRows, error: fetchLoanError } = await supabaseAdmin
          .from('loans')
          .select('id, user_id, book_id, status, admin_note')
          .eq('id', loanId)
          .limit(2);

        if (fetchLoanError) {
          const permDenied = isDbPermissionDeniedError(fetchLoanError);
          return res.status(500).json({
            error: permDenied
              ? 'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501).'
              : `Gagal memeriksa transaksi peminjaman: ${fetchLoanError.message}`,
            code: permDenied ? 'DB_PERMISSION_DENIED' : fetchLoanError.code || 'LOAN_FETCH_FAILED',
          });
        }

        if (!loanRows || loanRows.length === 0) {
          return res.status(404).json({
            error: 'Data transaksi peminjaman tidak ditemukan.',
            code: 'LOAN_NOT_FOUND',
          });
        }

        if (loanRows.length > 1) {
          return res.status(409).json({
            error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini.',
            code: 'DUPLICATE_LOAN_TRANSACTION',
          });
        }

        const existingLoan = loanRows[0];
        if (existingLoan.status !== 'pending') {
          return res.status(409).json({
            error: 'Permintaan peminjaman ini sudah diproses sebelumnya dan tidak dapat disetujui ulang.',
            code: 'INVALID_LOAN_STATUS',
          });
        }

        const { data: bookRows, error: bookErr } = await supabaseAdmin
          .from('books')
          .select('id, available_copies, total_copies, is_archived')
          .eq('id', existingLoan.book_id)
          .limit(2);

        if (bookErr) {
          const permDenied = isDbPermissionDeniedError(bookErr);
          if (permDenied) {
            console.error('[LOAN_APPROVE_PERMISSION_DENIED]', {
              loanId,
              actorId: actor.id,
              table: 'books',
              operation: 'select',
              code: bookErr.code || '42501',
              keyStatus: inspectServerSupabaseEnv().keyStatus,
            });
          }
          return res.status(500).json({
            error: `Gagal memeriksa stok buku: ${bookErr.message}`,
            code: permDenied ? 'DB_PERMISSION_DENIED' : bookErr.code || 'BOOK_FETCH_FAILED',
          });
        }

        const targetBook = bookRows?.[0];
        if (!targetBook || targetBook.is_archived || Number(targetBook.available_copies ?? 0) <= 0) {
          return res.status(409).json({
            error: 'Stok eksemplar buku sudah habis atau buku diarsipkan sehingga peminjaman tidak dapat disetujui.',
            code: 'BOOK_UNAVAILABLE',
          });
        }

        const beforeAvailableCopies = Number(targetBook.available_copies ?? 0);
        const totalCopies = Number(targetBook.total_copies ?? beforeAvailableCopies);
        const previousAdminNote = existingLoan.admin_note ?? null;
        const nowIso = new Date().toISOString();

        const { data: updatedRows, error: updateError } = await supabaseAdmin
          .from('loans')
          .update({
            status: 'approved',
            approved_at: nowIso,
            due_at: null,
            admin_note: adminNote,
            updated_at: nowIso,
          })
          .eq('id', loanId)
          .eq('status', 'pending')
          .select(
            'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
          );

        if (updateError) {
          const permDenied = isDbPermissionDeniedError(updateError);
          if (permDenied) {
            console.error('[LOAN_APPROVE_PERMISSION_DENIED]', {
              loanId,
              actorId: actor.id,
              table: 'loans',
              operation: 'update',
              code: updateError.code || '42501',
              keyStatus: inspectServerSupabaseEnv().keyStatus,
            });
          }
          return res.status(500).json({
            error: permDenied
              ? 'Izin database server untuk menyetujui peminjaman pada tabel loans belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans sudah dijalankan.'
              : `Gagal menyetujui peminjaman: ${updateError.message}`,
            code: permDenied ? 'DB_PERMISSION_DENIED' : updateError.code || 'LOAN_APPROVE_FAILED',
          });
        }

        if (!updatedRows || updatedRows.length === 0) {
          return res.status(409).json({
            error: 'Permintaan peminjaman ini sudah diproses oleh admin lain.',
            code: 'CONCURRENT_LOAN_MODIFICATION',
          });
        }

        const updatedLoan = updatedRows[0];

        const rollbackApproveLoanStatus = async () => {
          try {
            await supabaseAdmin
              .from('loans')
              .update({
                status: 'pending',
                approved_at: null,
                due_at: null,
                admin_note: previousAdminNote,
                updated_at: new Date().toISOString(),
              })
              .eq('id', loanId)
              .eq('status', 'approved');
          } catch (rollbackErr: any) {
            console.error('[LOAN_APPROVE_ROLLBACK_ERROR]', {
              loanId,
              bookId: updatedLoan.book_id,
              message: rollbackErr?.message,
            });
          }
        };

        // Rekonsiliasi stok tersedia saat persetujuan: wajib sukses atau rollback status loan secara penuh
        let stockAdjusted = false;
        let stockSource: 'trigger' | 'application' | 'none' = 'none';
        const { data: afterBookRows, error: afterBookErr } = await supabaseAdmin
          .from('books')
          .select('id, available_copies, total_copies')
          .eq('id', updatedLoan.book_id)
          .limit(2);

        if (afterBookErr || !afterBookRows?.[0]) {
          await rollbackApproveLoanStatus();
          return res.status(500).json({
            error: 'Gagal memverifikasi stok buku setelah persetujuan. Persetujuan dibatalkan otomatis.',
            code: isDbPermissionDeniedError(afterBookErr) ? 'DB_PERMISSION_DENIED' : 'BOOK_STOCK_SYNC_FAILED',
            rolledBack: true,
          });
        }

        const afterBook = afterBookRows[0];
        const rawAfterAvailable = Number(afterBook.available_copies ?? 0);
        if (rawAfterAvailable < 0 || beforeAvailableCopies - rawAfterAvailable > 1) {
          await rollbackApproveLoanStatus();
          return res.status(409).json({
            error: 'Integritas stok buku tidak terpenuhi (stok negatif / pengurangan ganda). Persetujuan dibatalkan otomatis.',
            code: 'BOOK_STOCK_INTEGRITY_ERROR',
            rolledBack: true,
          });
        }

        const stockPlan = computeBookStockAfterApprove({
          beforeAvailable: beforeAvailableCopies,
          afterAvailable: rawAfterAvailable,
          totalCopies: Number(afterBook.total_copies ?? totalCopies),
        });
        stockSource =
          stockPlan.decrementedBy === 'trigger'
            ? 'trigger'
            : stockPlan.decrementedBy === 'application'
              ? 'application'
              : 'none';

        if (stockPlan.needsUpdate) {
          if (stockPlan.targetAvailable < 0 || stockPlan.safeAfter <= 0) {
            await rollbackApproveLoanStatus();
            return res.status(409).json({
              error: 'Stok eksemplar buku sudah habis sehingga persetujuan dibatalkan otomatis.',
              code: 'BOOK_UNAVAILABLE',
              rolledBack: true,
            });
          }

          const { data: updatedBookRows, error: stockUpdateErr } = await supabaseAdmin
            .from('books')
            .update({
              available_copies: stockPlan.targetAvailable,
              updated_at: nowIso,
            })
            .eq('id', updatedLoan.book_id)
            .eq('available_copies', stockPlan.safeAfter)
            .select('id, available_copies');

          if (stockUpdateErr) {
            await rollbackApproveLoanStatus();
            const permDenied = isDbPermissionDeniedError(stockUpdateErr);
            if (permDenied) {
              console.error('[LOAN_APPROVE_PERMISSION_DENIED]', {
                loanId,
                actorId: actor.id,
                table: 'books',
                operation: 'update',
                code: stockUpdateErr.code || '42501',
                keyStatus: inspectServerSupabaseEnv().keyStatus,
              });
            }
            return res.status(500).json({
              error: permDenied
                ? 'Izin database server untuk memperbarui stok buku (books) belum aktif (kode 42501). Persetujuan dibatalkan otomatis.'
                : `Gagal memperbarui stok buku saat persetujuan; transaksi dibatalkan otomatis: ${stockUpdateErr.message}`,
              code: permDenied ? 'DB_PERMISSION_DENIED' : 'BOOK_STOCK_UPDATE_FAILED',
              rolledBack: true,
            });
          }

          if (!updatedBookRows || updatedBookRows.length === 0) {
            await rollbackApproveLoanStatus();
            return res.status(409).json({
              error: 'Stok buku berubah secara bersamaan saat persetujuan berlangsung. Transaksi dibatalkan otomatis.',
              code: 'CONCURRENT_BOOK_STOCK_MODIFICATION',
              rolledBack: true,
            });
          }

          stockAdjusted = stockPlan.decrementedBy === 'application';
        } else if (stockPlan.decrementedBy === 'trigger') {
          stockAdjusted = true;
        }

        const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
          supabaseAdmin
            .from('books')
            .select('id, title, author, cover_path, file_path, available_copies, total_copies')
            .eq('id', updatedLoan.book_id)
            .limit(2),
          supabaseAdmin
            .from('profiles')
            .select('id, full_name, username')
            .eq('id', updatedLoan.user_id)
            .limit(2),
        ]);

        try {
          await supabaseAdmin.from('activity_logs').insert({
            actor_id: actor.id,
            action: 'approve_loan',
            entity_type: 'loans',
            entity_id: loanId,
            details: JSON.stringify({
              stock_source: stockSource,
            }),
            created_at: nowIso,
          });
        } catch {
          // Abaikan error logging non-kritikal
        }

        return res.json({
          success: true,
          stockAdjusted,
          stockSource,
          loan: {
            ...updatedLoan,
            book: enrichedBookRows?.[0] ?? undefined,
            profile: enrichedProfileRows?.[0] ?? undefined,
          },
        });
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Gagal menyetujui peminjaman.',
        code: 'INTERNAL_APPROVE_ERROR',
      });
    }
  });

  // Endpoint penolakan peminjaman buku oleh Admin/Super Admin via SUPABASE_SERVICE_ROLE_KEY
  app.post('/api/loans/:id/reject', async (req: Request, res: Response) => {
    try {
      const loanId = String(req.params.id || '').trim();
      if (!isValidUuid(loanId)) {
        return res.status(400).json({
          error: 'ID transaksi peminjaman tidak valid.',
          code: 'INVALID_LOAN_ID',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || 'Konfigurasi admin server belum lengkap.',
        });
      }

      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        'menolak peminjaman buku'
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      if (!isActorAdmin) {
        return res.status(403).json({
          error: 'Hanya administrator aktif yang berwenang menolak peminjaman buku.',
          code: 'FORBIDDEN',
        });
      }

      const { data: loanRows, error: fetchLoanError } = await supabaseAdmin
        .from('loans')
        .select('id, user_id, book_id, status')
        .eq('id', loanId)
        .limit(2);

      if (fetchLoanError) {
        const permDenied = isDbPermissionDeniedError(fetchLoanError);
        if (permDenied) {
          console.error('[LOAN_REJECT_PERMISSION_DENIED]', {
            loanId,
            actorId: actor.id,
            table: 'loans',
            operation: 'select',
            code: fetchLoanError.code || '42501',
            keyStatus: inspectServerSupabaseEnv().keyStatus,
          });
        }
        return res.status(500).json({
          error: permDenied
            ? 'Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang.'
            : `Gagal memeriksa transaksi peminjaman: ${fetchLoanError.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : fetchLoanError.code || 'LOAN_FETCH_FAILED',
        });
      }

      if (!loanRows || loanRows.length === 0) {
        return res.status(404).json({
          error: 'Data transaksi peminjaman tidak ditemukan.',
          code: 'LOAN_NOT_FOUND',
        });
      }

      if (loanRows.length > 1) {
        return res.status(409).json({
          error: 'Terdeteksi duplikasi data pada transaksi peminjaman ini.',
          code: 'DUPLICATE_LOAN_TRANSACTION',
        });
      }

      const existingLoan = loanRows[0];
      if (existingLoan.status !== 'pending') {
        return res.status(409).json({
          error: 'Permintaan peminjaman ini sudah diproses sebelumnya.',
          code: 'INVALID_LOAN_STATUS',
        });
      }

      const body = (req.body || {}) as Record<string, unknown>;
      const cleanReason =
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : 'Permintaan peminjaman belum dapat disetujui saat ini.';
      const nowIso = new Date().toISOString();

      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from('loans')
        .update({
          status: 'rejected',
          admin_note: cleanReason,
          updated_at: nowIso,
        })
        .eq('id', loanId)
        .eq('status', 'pending')
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        );

      if (updateError) {
        const permDenied = isDbPermissionDeniedError(updateError);
        if (permDenied) {
          console.error('[LOAN_REJECT_PERMISSION_DENIED]', {
            loanId,
            actorId: actor.id,
            table: 'loans',
            operation: 'update',
            code: updateError.code || '42501',
            keyStatus: inspectServerSupabaseEnv().keyStatus,
          });
        }
        return res.status(500).json({
          error: permDenied
            ? 'Izin database server untuk menolak peminjaman pada tabel loans belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans sudah dijalankan.'
            : `Gagal menolak peminjaman: ${updateError.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : updateError.code || 'LOAN_REJECT_FAILED',
        });
      }

      if (!updatedRows || updatedRows.length === 0) {
        return res.status(409).json({
          error: 'Permintaan peminjaman ini sudah diproses oleh admin lain.',
          code: 'CONCURRENT_LOAN_MODIFICATION',
        });
      }

      const updatedLoan = updatedRows[0];
      const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
        supabaseAdmin
          .from('books')
          .select('id, title, author, cover_path')
          .eq('id', updatedLoan.book_id)
          .limit(2),
        supabaseAdmin
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', updatedLoan.user_id)
          .limit(2),
      ]);

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: actor.id,
          action: 'reject_loan',
          entity_type: 'loans',
          entity_id: loanId,
          details: JSON.stringify({ reason: cleanReason }),
          created_at: nowIso,
        });
      } catch {
        // Abaikan error logging non-kritikal
      }

      return res.json({
        success: true,
        loan: {
          ...updatedLoan,
          book: enrichedBookRows?.[0] ?? undefined,
          profile: enrichedProfileRows?.[0] ?? undefined,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Gagal menolak peminjaman.',
        code: 'INTERNAL_REJECT_ERROR',
      });
    }
  });

  // Helper verifikasi hak baca dokumen digital (Admin aktif atau peminjam dengan transaksi 'approved'/'borrowed' yang sah)
  const verifyBookDocumentReadAccess = async (
    req: Request,
    bookId: string,
    supabaseAuth: SupabaseClient,
    supabaseAdmin: SupabaseClient
  ): Promise<
    | { ok: false; status: number; error: string; code: string }
    | { ok: true; actor: any; isActorAdmin: boolean; book: any; fileType: 'epub' | 'pdf' }
  > => {
    if (!isValidUuid(bookId)) {
      return { ok: false, status: 400, error: 'ID buku tidak valid.', code: 'INVALID_BOOK_ID' };
    }

    const authCheck = await verifyAuthenticatedUser(
      req,
      supabaseAuth,
      supabaseAdmin,
      'mengakses dokumen digital buku'
    );
    if (!authCheck.ok) {
      return {
        ok: false,
        status: authCheck.status,
        error: authCheck.error,
        code: authCheck.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
      };
    }

    const actor = authCheck.userProfile;
    const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;

    const { data: bookRows, error: bookErr } = await supabaseAdmin
      .from('books')
      .select('id, title, author, publisher, publication_year, cover_path, file_path, file_type, is_archived')
      .eq('id', bookId)
      .limit(2);

    if (bookErr) {
      const permDenied = isDbPermissionDeniedError(bookErr);
      return {
        ok: false,
        status: 500,
        error: `Gagal memeriksa dokumen buku: ${bookErr.message}`,
        code: permDenied ? 'DB_PERMISSION_DENIED' : bookErr.code || 'BOOK_FETCH_FAILED',
      };
    }

    if (!bookRows || bookRows.length === 0) {
      return {
        ok: false,
        status: 404,
        error: 'Data buku tidak ditemukan.',
        code: 'BOOK_NOT_FOUND',
      };
    }

    const book = bookRows[0];
    if (!book.file_path) {
      return {
        ok: false,
        status: 404,
        error: 'Buku ini tidak memiliki lampiran dokumen digital (koleksi fisik).',
        code: 'NO_DIGITAL_FILE',
      };
    }

    if (!isActorAdmin) {
      const { data: activeLoanRows, error: loanErr } = await supabaseAdmin
        .from('loans')
        .select('id, status, due_at, returned_at')
        .eq('user_id', actor.id)
        .eq('book_id', bookId)
        .in('status', ['approved', 'borrowed'])
        .limit(10);

      if (loanErr) {
        const permDenied = isDbPermissionDeniedError(loanErr);
        return {
          ok: false,
          status: 500,
          error: `Gagal memverifikasi hak akses peminjaman: ${loanErr.message}`,
          code: permDenied ? 'DB_PERMISSION_DENIED' : loanErr.code || 'LOAN_CHECK_FAILED',
        };
      }

      const accessCheck = evaluateActiveLoansReadAccess(activeLoanRows, Date.now());
      if (!accessCheck.allowed) {
        return {
          ok: false,
          status: 403,
          error: accessCheck.message,
          code: accessCheck.code,
        };
      }
    }

    const fileType = resolveDocumentFileType(book.file_type, book.file_path);
    return {
      ok: true,
      actor,
      isActorAdmin,
      book,
      fileType,
    };
  };

  // Helper mengunduh byte file dari bucket privat 'book-files' menggunakan service_role (server-only)
  const downloadPrivateBookStorageBuffer = async (
    supabaseAdmin: SupabaseClient,
    filePath: string
  ): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: number; error: string; code: string }> => {
    const cleanPath = String(filePath || '').trim().replace(/^\/+/, '');
    if (!cleanPath || cleanPath.includes('..')) {
      return {
        ok: false,
        status: 400,
        error: 'Path berkas dokumen di penyimpanan tidak valid.',
        code: 'INVALID_FILE_PATH',
      };
    }

    const storageBucket = (supabaseAdmin as any)?.storage?.from?.('book-files');
    if (storageBucket && typeof storageBucket.download === 'function') {
      const { data: fileData, error: downloadErr } = await storageBucket.download(cleanPath);
      if (downloadErr || !fileData) {
        const msg = downloadErr?.message || 'Berkas dokumen digital tidak ditemukan di penyimpanan privat.';
        const isNotFound = /not found|404|object not found/i.test(msg);
        return {
          ok: false,
          status: isNotFound ? 404 : 502,
          error: isNotFound
            ? 'Berkas dokumen digital buku ini tidak ditemukan di Supabase Storage (book-files).'
            : `Gagal mengambil berkas dokumen dari penyimpanan privat: ${msg}`,
          code: isNotFound ? 'STORAGE_FILE_NOT_FOUND' : 'STORAGE_DOWNLOAD_FAILED',
        };
      }

      let buffer: Buffer;
      if (Buffer.isBuffer(fileData)) {
        buffer = fileData;
      } else if (fileData instanceof Uint8Array) {
        buffer = Buffer.from(fileData);
      } else if (fileData instanceof ArrayBuffer) {
        buffer = Buffer.from(fileData);
      } else if (typeof (fileData as Blob).arrayBuffer === 'function') {
        const ab = await (fileData as Blob).arrayBuffer();
        buffer = Buffer.from(ab);
      } else {
        return {
          ok: false,
          status: 500,
          error: 'Format respons berkas dari Supabase Storage tidak dikenali.',
          code: 'INVALID_STORAGE_PAYLOAD',
        };
      }

      if (buffer.length === 0) {
        return {
          ok: false,
          status: 422,
          error: 'Berkas dokumen digital kosong (0 byte) atau rusak.',
          code: 'EMPTY_DOCUMENT_FILE',
        };
      }

      return { ok: true, buffer };
    }

    return {
      ok: false,
      status: 500,
      error: 'Klien penyimpanan privat server belum siap mengunduh dokumen.',
      code: 'STORAGE_CLIENT_UNAVAILABLE',
    };
  };

  // Endpoint verifikasi akses baca & metadata pembaca internal (tanpa membocorkan URL Storage asli ke Pengunjung)
  app.post('/api/books/:id/read-url', async (req: Request, res: Response) => {
    try {
      const bookId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || 'Konfigurasi admin server belum lengkap.',
        });
      }

      const access = await verifyBookDocumentReadAccess(req, bookId, supabaseAuth, supabaseAdmin);
      if (!access.ok) {
        return res.status(access.status).json({ error: access.error, code: access.code });
      }

      const readerPath = `/read/${access.book.id}`;
      const streamUrl = `/api/books/${access.book.id}/content`;

      return res.json({
        success: true,
        url: readerPath,
        readerPath,
        streamUrl,
        fileType: access.fileType,
        book: {
          id: access.book.id,
          title: access.book.title,
          author: access.book.author,
          publisher: access.book.publisher,
          publication_year: access.book.publication_year,
          cover_path: access.book.cover_path,
          file_type: access.fileType,
        },
      });
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan saat menyiapkan dokumen digital.',
        code: 'INTERNAL_READ_URL_ERROR',
      });
    }
  });

  // Endpoint streaming konten dokumen privat (EPUB / PDF) via backend tanpa mengekspos Signed URL Storage
  app.get('/api/books/:id/content', async (req: Request, res: Response) => {
    try {
      const bookId = String(req.params.id || '').trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || 'Konfigurasi autentikasi server belum lengkap.',
        });
      }

      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || 'Konfigurasi admin server belum lengkap.',
        });
      }

      const access = await verifyBookDocumentReadAccess(req, bookId, supabaseAuth, supabaseAdmin);
      if (!access.ok) {
        return res.status(access.status).json({ error: access.error, code: access.code });
      }

      const downloadRes = await downloadPrivateBookStorageBuffer(supabaseAdmin, access.book.file_path);
      if (!downloadRes.ok) {
        return res.status(downloadRes.status).json({
          error: downloadRes.error,
          code: downloadRes.code,
        });
      }

      const buffer = downloadRes.buffer;
      const detectedType = resolveDocumentFileType(access.fileType, access.book.file_path, buffer);

      if (detectedType === 'epub' && !hasZipMagicBytes(buffer)) {
        return res.status(422).json({
          error: 'Berkas EPUB di penyimpanan rusak atau bukan arsip EPUB yang valid.',
          code: 'INVALID_EPUB_FILE',
        });
      }

      if (detectedType === 'pdf' && !hasPdfMagicBytes(buffer)) {
        return res.status(422).json({
          error: 'Berkas PDF di penyimpanan rusak atau tidak valid.',
          code: 'INVALID_PDF_FILE',
        });
      }

      const contentType = detectedType === 'epub' ? 'application/epub+zip' : 'application/pdf';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-Document-Format', detectedType);
      res.setHeader('Content-Length', String(buffer.length));

      return res.status(200).send(buffer);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan saat mengalirkan konten dokumen digital.',
        code: 'INTERNAL_CONTENT_STREAM_ERROR',
      });
    }
  });

  // Endpoint khusus Admin untuk mengunduh berkas asli EPUB / PDF dari bucket privat 'book-files'
  app.get('/api/admin/books/:id/download', async (req: Request, res: Response) => {
    try {
      const bookId = String(req.params.id || '').trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: 'ID buku tidak valid.',
          code: 'INVALID_BOOK_ID',
        });
      }

      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || 'Konfigurasi server belum lengkap.',
        });
      }

      const adminCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!adminCheck.ok) {
        return res.status(adminCheck.status).json({
          error: adminCheck.error,
          code: adminCheck.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        });
      }

      const { data: bookRows, error: bookErr } = await supabaseAdmin
        .from('books')
        .select('id, title, file_path, file_type')
        .eq('id', bookId)
        .limit(2);

      if (bookErr) {
        return res.status(500).json({
          error: `Gagal memeriksa dokumen buku: ${bookErr.message}`,
          code: bookErr.code || 'BOOK_FETCH_FAILED',
        });
      }

      if (!bookRows || bookRows.length === 0) {
        return res.status(404).json({
          error: 'Data buku tidak ditemukan.',
          code: 'BOOK_NOT_FOUND',
        });
      }

      const book = bookRows[0];
      if (!book.file_path) {
        return res.status(404).json({
          error: 'Buku ini belum memiliki file dokumen digital (PDF/EPUB).',
          code: 'NO_DIGITAL_FILE',
        });
      }

      const downloadRes = await downloadPrivateBookStorageBuffer(supabaseAdmin, book.file_path);
      if (!downloadRes.ok) {
        return res.status(downloadRes.status).json({
          error: downloadRes.error,
          code: downloadRes.code,
        });
      }

      const buffer = downloadRes.buffer;
      const detectedType = resolveDocumentFileType(book.file_type, book.file_path, buffer);
      const filename = sanitizeDownloadFilename(book.title, detectedType);
      const contentType = detectedType === 'epub' ? 'application/epub+zip' : 'application/pdf';

      try {
        await supabaseAdmin.from('activity_logs').insert({
          actor_id: adminCheck.adminProfile.id,
          action: 'download_book_file',
          entity_type: 'books',
          entity_id: book.id,
          details: JSON.stringify({
            title: book.title,
            file_type: detectedType,
            filename,
          }),
          created_at: new Date().toISOString(),
        });
      } catch {
        // Non-blocking audit log
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(buffer.length));

      return res.status(200).send(buffer);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Terjadi kesalahan saat mengunduh dokumen asli.',
        code: 'INTERNAL_ADMIN_DOWNLOAD_ERROR',
      });
    }
  });

  return app;
}


