import express, { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateVisitorArchiveEligibility,
  evaluateVisitorRemovalEligibility,
  evaluateVisitorRestoreEligibility,
  isAdminOrSuperAdminRole,
  isValidUuid,
} from '../utils/visitorDeletion';
import {
  computeBookStockAfterReturn,
  evaluateLoanReturnEligibility,
  formatBookReturnErrorMessage,
} from '../utils/libraryRules';

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
    serviceRoleKey,
    hasSupabaseUrl: true,
    hasServiceRoleKey: true,
    isServiceRoleKeyValid: true,
    keyStatus: 'unrecognized_format',
    hasUrlMismatch,
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

export interface ServerAppOptions {
  getAuthClient?: () => { client: SupabaseClient | null; error?: string };
  getAdminClient?: () => { client: SupabaseClient | null; error?: string };
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

  if (!actorProfile || !isAdminOrSuperAdminRole(actorProfile.role)) {
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
  supabaseAdmin: SupabaseClient
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
      error: 'Autentikasi diperlukan untuk mengonfirmasi pengembalian buku.',
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

async function countVisitorLoans(
  supabaseAdmin: SupabaseClient,
  targetId: string
): Promise<{ totalLoansCount: number; activeLoansCount: number; error?: string }> {
  const { count: totalCount, error: totalErr } = await supabaseAdmin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetId);

  if (totalErr) {
    return {
      totalLoansCount: 0,
      activeLoansCount: 0,
      error: `Gagal memeriksa riwayat peminjaman pengunjung: ${totalErr.message}`,
    };
  }

  const { count: activeCount, error: activeErr } = await supabaseAdmin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetId)
    .in('status', ['pending', 'approved', 'borrowed']);

  if (activeErr) {
    return {
      totalLoansCount: totalCount ?? 0,
      activeLoansCount: 0,
      error: `Gagal memeriksa pinjaman aktif pengunjung: ${activeErr.message}`,
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
  const getAdminClient = options.getAdminClient ?? defaultCreateSupabaseAdminClient;
  const getAuthClient =
    options.getAuthClient ??
    (options.getAdminClient ? options.getAdminClient : defaultCreateSupabaseAuthClient);
  const resolvedSuperAdminUids = options.superAdminUids ?? getSuperAdminUids();

  app.use(express.json());

  // Health and status endpoint (memeriksa keberadaan env server tanpa mencetak nilai rahasia)
  app.get('/api/health', async (req: Request, res: Response) => {
    const envInspection = inspectServerSupabaseEnv();
    const shouldProbeProfiles = req.query.probe === 'profiles';
    const profilesProbe = shouldProbeProfiles
      ? await probeAdminProfilesAccess(() => getAdminClient())
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
      ...(profilesProbe ? { profilesProbe } : {}),
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
        const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (!listError && listData?.users) {
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
      try {
        const { data: authTarget, error: authTargetErr } =
          await supabaseAdmin.auth.admin.getUserById(targetId);
        if (!authTargetErr && authTarget?.user) {
          authTargetUser = authTarget.user;
        }
      } catch {
        // Lanjutkan pemeriksaan berdasarkan profil apabila lookup Auth gagal sementara
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
        return res.status(500).json({ error: loanStats.error });
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

      // Snapshot profil & referensi non-pinjaman sebelum mutasi agar dapat di-rollback bila salah satu tahap gagal
      const { data: logsSnapshot, error: logsSnapErr } = await supabaseAdmin
        .from('activity_logs')
        .select('id')
        .eq('actor_id', targetId);
      if (logsSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot activity_logs sebelum penghapusan: ${logsSnapErr.message}`,
        });
      }

      const { data: booksSnapshot, error: booksSnapErr } = await supabaseAdmin
        .from('books')
        .select('id')
        .eq('created_by', targetId);
      if (booksSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot books sebelum penghapusan: ${booksSnapErr.message}`,
        });
      }

      const { data: categoriesSnapshot, error: catsSnapErr } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('created_by', targetId);
      if (catsSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot categories sebelum penghapusan: ${catsSnapErr.message}`,
        });
      }

      const bookIdsToRestore = Array.isArray(booksSnapshot)
        ? booksSnapshot.map((b: any) => b.id).filter(Boolean)
        : [];
      const categoryIdsToRestore = Array.isArray(categoriesSnapshot)
        ? categoriesSnapshot.map((c: any) => c.id).filter(Boolean)
        : [];
      const logIdsToRestore = Array.isArray(logsSnapshot)
        ? logsSnapshot.map((l: any) => l.id).filter(Boolean)
        : [];

      let logsCleared = false;
      let booksCleared = false;
      let catsCleared = false;

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

        if (catsCleared) {
          for (const catId of categoryIdsToRestore) {
            try {
              const { error: restoreCatErr } = await supabaseAdmin
                .from('categories')
                .update({ created_by: targetId })
                .eq('id', catId);
              if (restoreCatErr) {
                failures.push({
                  step: 'restore_category_creator',
                  table: 'categories',
                  recordId: String(catId),
                  message:
                    restoreCatErr.message ||
                    'Gagal memulihkan kolom created_by pada tabel categories.',
                });
              }
            } catch (err: any) {
              failures.push({
                step: 'restore_category_creator',
                table: 'categories',
                recordId: String(catId),
                message:
                  err?.message ||
                  'Pengecualian saat memulihkan kolom created_by pada tabel categories.',
              });
            }
          }
        }

        if (logsCleared) {
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

      // 1. Lepaskan referensi non-pinjaman tanpa menghapus baris histori activity_logs
      const { error: clearLogsErr } = await supabaseAdmin
        .from('activity_logs')
        .update({ actor_id: null })
        .eq('actor_id', targetId);
      if (clearLogsErr) {
        return res.status(500).json({
          error: `Gagal melepaskan referensi actor_id pada activity_logs sebelum penghapusan (pastikan migrasi ON DELETE SET NULL sudah dijalankan): ${clearLogsErr.message}`,
        });
      }
      logsCleared = true;

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

      const { error: clearCatsErr } = await supabaseAdmin
        .from('categories')
        .update({ created_by: null })
        .eq('created_by', targetId);
      if (clearCatsErr) {
        const rollback = await rollbackReferencesAndProfile(false);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Gagal melepaskan referensi kategori (${clearCatsErr.message}), dan pemulihan rollback tidak lengkap (${rollback.failures.length} kegagalan). Data referensi mungkin tidak konsisten.`,
            code: 'ROLLBACK_INCOMPLETE',
            rollbackComplete: false,
            rollbackFailures: rollback.failures,
          });
        }
        return res.status(500).json({
          error: `Gagal melepaskan referensi kategori sebelum penghapusan (referensi sebelumnya telah dipulihkan): ${clearCatsErr.message}`,
          rollbackComplete: true,
        });
      }
      catsCleared = true;

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

          const lowerProfileErr = deleteProfileError.message.toLowerCase();
          if (lowerProfileErr.includes('super admin')) {
            return res.status(403).json({
              error: deleteProfileError.message,
              code: 'SUPER_ADMIN_PROTECTED',
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

  app.post('/api/admin/visitors/:id/delete', handleDeleteVisitorRequest);
  app.delete('/api/admin/visitors/:id', handleDeleteVisitorRequest);

  // Mengarsipkan / menonaktifkan akun pengunjung yang memiliki riwayat peminjaman (ditolak bila masih punya pinjaman aktif)
  app.post('/api/admin/visitors/:id/archive', async (req: Request, res: Response) => {
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
  });

  // Mengaktifkan kembali akun pengunjung yang sebelumnya diarsipkan
  app.post('/api/admin/visitors/:id/restore', async (req: Request, res: Response) => {
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
  });

  // Endpoint resmi & aman untuk pengembalian buku berdasarkan primary key transaksi (loans.id)
  // - Tidak pernah menggunakan .single() yang memicu PGRST116 ("Cannot coerce the result to a single JSON object")
  // - Hanya memperbarui tepat 1 baris transaksi berstatus aktif ('approved' | 'borrowed')
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

      // 1. Ambil tepat 1 transaksi berdasarkan primary key id (tanpa .single())
      const { data: loanRows, error: fetchLoanError } = await supabaseAdmin
        .from('loans')
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        )
        .eq('id', loanId)
        .limit(2);

      if (fetchLoanError) {
        console.error('[RETURN_BOOK_FETCH_ERROR]', {
          loanId,
          actorId: actor.id,
          code: fetchLoanError.code,
          message: fetchLoanError.message,
        });
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

      // 2. Pastikan hanya pemilik transaksi atau Admin aktif yang berhak mengembalikan
      if (!isActorAdmin && existingLoan.user_id !== actor.id) {
        return res.status(403).json({
          error: 'Anda tidak memiliki izin untuk mengembalikan transaksi peminjaman milik anggota lain.',
          code: 'FORBIDDEN',
        });
      }

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

      // 6. Rekonsiliasi stok buku: pastikan available_copies bertambah tepat +1 dan tidak tergandakan oleh trigger
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
        }

        if (afterBookRows && afterBookRows.length > 1) {
          console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
            query: 'afterBook.books_by_id',
            loanId,
            bookId: existingLoan.book_id,
            rowCount: afterBookRows.length,
          });
          return res.status(409).json({
            error: 'Terdeteksi duplikasi data buku saat sinkronisasi stok. Hubungi administrator.',
            code: 'DUPLICATE_BOOK_RECORD',
          });
        }

        const afterBook = afterBookRows?.[0] ?? beforeBook;
        const stockPlan = computeBookStockAfterReturn({
          beforeAvailable,
          afterAvailable: Number(afterBook.available_copies ?? beforeAvailable),
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
            console.error('[RETURN_BOOK_STOCK_SYNC_ERROR]', {
              loanId,
              bookId: existingLoan.book_id,
              message: stockUpdateErr.message,
            });
          } else {
            if (updatedBookRows && updatedBookRows.length > 1) {
              console.error('[RETURN_BOOK_MULTIPLE_RECORDS]', {
                query: 'books_stock_update_by_id',
                loanId,
                bookId: existingLoan.book_id,
                rowCount: updatedBookRows.length,
              });
            }
            stockAdjusted = stockPlan.incrementedBy === 'application';
          }
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

  return app;
}


