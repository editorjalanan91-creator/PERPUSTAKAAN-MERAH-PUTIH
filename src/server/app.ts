import express, { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  evaluateVisitorArchiveEligibility,
  evaluateVisitorRemovalEligibility,
  isValidUuid,
} from '../utils/visitorDeletion';

function sanitizeEnv(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
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
  const hasUrlMismatch = Boolean(rawServerUrl && rawViteUrl && rawServerUrl !== rawViteUrl);
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
  if (!inspection.hasSupabaseUrl) {
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
}

async function verifyAdminRequest(
  req: Request,
  supabaseAuth: SupabaseClient,
  supabaseAdmin: SupabaseClient
): Promise<
  | {
      ok: true;
      adminProfile: { id: string; role: string; full_name?: string; username?: string };
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
  const { data: actorProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, username')
    .eq('id', authData.user.id)
    .maybeSingle();

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

  if (!actorProfile || actorProfile.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'Akses ditolak. Hanya administrator dengan role admin yang dapat melakukan aksi ini.',
    };
  }

  return {
    ok: true,
    adminProfile: actorProfile,
  };
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
        .order('created_at', { ascending: false });

      if (profilesError) {
        return res.status(500).json({
          error: `Gagal memuat daftar pengunjung: ${profilesError.message}`,
        });
      }

      const authUsersById = new Map<
        string,
        { email?: string; is_active?: boolean; archived_at?: string | null }
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
            });
          }
        }
      } catch (listErr) {
        console.warn('Gagal mengambil metadata Auth pengguna:', listErr);
      }

      const enrichedVisitors = (profiles || []).map((profile: any) => {
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

  // Menghapus akun pengunjung secara permanen (hanya jika tidak memiliki riwayat peminjaman)
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
        .select('id, full_name, username, role')
        .eq('id', targetId)
        .maybeSingle();

      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`,
        });
      }

      let resolvedRole = targetProfile?.role;
      let resolvedName = targetProfile?.full_name || 'Pengunjung';
      let resolvedUsername = targetProfile?.username || '';

      if (!targetProfile) {
        const { data: authTarget, error: authTargetErr } =
          await supabaseAdmin.auth.admin.getUserById(targetId);
        if (authTargetErr || !authTarget?.user) {
          return res.status(404).json({
            error: 'Akun pengunjung tidak ditemukan di database.',
          });
        }
        resolvedRole = (authTarget.user.user_metadata?.role as string) || 'visitor';
        resolvedName = (authTarget.user.user_metadata?.full_name as string) || 'Pengunjung';
        resolvedUsername = (authTarget.user.user_metadata?.username as string) || '';
      }

      // Periksa riwayat peminjaman di tabel loans
      const { count: loansCount, error: loansCountError } = await supabaseAdmin
        .from('loans')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetId);

      if (loansCountError) {
        return res.status(500).json({
          error: `Gagal memeriksa riwayat peminjaman pengunjung: ${loansCountError.message}`,
        });
      }

      const totalLoansCount = loansCount ?? 0;
      const evaluation = evaluateVisitorRemovalEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: resolvedRole,
        totalLoansCount,
      });

      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          totalLoans: totalLoansCount,
        });
      }

      // Bersihkan referensi non-pinjaman agar foreign key tidak menggagalkan penghapusan
      await supabaseAdmin.from('activity_logs').delete().eq('actor_id', targetId);
      await supabaseAdmin.from('books').update({ created_by: null }).eq('created_by', targetId);
      await supabaseAdmin.from('categories').update({ created_by: null }).eq('created_by', targetId);

      // Hapus user dari Supabase Auth (otomatis cascade ke profiles bila FK ON DELETE CASCADE aktif)
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (
        deleteAuthError &&
        !deleteAuthError.message.toLowerCase().includes('not found')
      ) {
        const lowerMsg = deleteAuthError.message.toLowerCase();
        if (lowerMsg.includes('storage') || lowerMsg.includes('object')) {
          return res.status(409).json({
            error:
              'Akun tidak dapat dihapus karena masih memiliki file objek terkait di Supabase Storage.',
          });
        }
        return res.status(500).json({
          error: `Gagal menghapus akun dari Supabase Authentication: ${deleteAuthError.message}`,
        });
      }

      // Pastikan baris pada public.profiles juga terhapus bila tidak menggunakan ON DELETE CASCADE
      const { data: leftoverProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', targetId)
        .maybeSingle();

      if (leftoverProfile) {
        const { error: deleteProfileError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', targetId);

        if (deleteProfileError) {
          return res.status(500).json({
            error: `Akun Auth berhasil dihapus, namun gagal menghapus baris public.profiles: ${deleteProfileError.message}`,
          });
        }
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

  // Mengarsipkan / menonaktifkan akun pengunjung yang memiliki riwayat peminjaman
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
        .select('id, full_name, username, role')
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

      const evaluation = evaluateVisitorArchiveEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: targetProfile.role,
      });

      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
        });
      }

      const nowIso = new Date().toISOString();

      const { data: authTargetData, error: authLookupError } =
        await supabaseAdmin.auth.admin.getUserById(targetId);

      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: 'Akun autentikasi pengunjung tidak ditemukan di Supabase Auth.',
        });
      }

      const existingMeta = (authTargetData.user.user_metadata || {}) as Record<string, any>;
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

      // Sinkronkan status nonaktif ke public.profiles apabila kolom is_active / archived_at tersedia
      const { error: profileArchiveError } = await supabaseAdmin
        .from('profiles')
        .update({
          is_active: false,
          archived_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', targetId);

      if (profileArchiveError) {
        try {
          await supabaseAdmin
            .from('profiles')
            .update({ updated_at: nowIso })
            .eq('id', targetId);
        } catch {
          // Abaikan fallback error
        }
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

  return app;
}
