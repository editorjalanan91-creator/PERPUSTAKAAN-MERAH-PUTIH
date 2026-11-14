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

function getServerSupabaseConfig(): {
  url: string;
  serviceRoleKey: string;
  error?: string;
} {
  const url = sanitizeEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(
    /\/+$/,
    ''
  );
  const serviceRoleKey = sanitizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || url.includes('your-project-ref') || url.includes('placeholder')) {
    return {
      url: '',
      serviceRoleKey: '',
      error:
        'Konfigurasi server SUPABASE_URL / VITE_SUPABASE_URL belum diatur pada Environment Variables server.',
    };
  }

  if (!serviceRoleKey || serviceRoleKey.includes('your-supabase-service-role-key')) {
    return {
      url,
      serviceRoleKey: '',
      error:
        'Konfigurasi server SUPABASE_SERVICE_ROLE_KEY belum diatur pada Environment Variables server (Vercel / .env). Kunci rahasia ini hanya boleh dipasang di server, bukan di frontend.',
    };
  }

  return { url, serviceRoleKey };
}

function defaultCreateSupabaseAdminClient(): {
  client: SupabaseClient | null;
  error?: string;
} {
  const config = getServerSupabaseConfig();
  if (config.error) {
    return { client: null, error: config.error };
  }

  const client = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { client };
}

export interface ServerAppOptions {
  getAdminClient?: () => { client: SupabaseClient | null; error?: string };
}

async function verifyAdminRequest(
  req: Request,
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

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      ok: false,
      status: 401,
      error: 'Sesi administrator tidak valid atau sudah berakhir. Silakan login kembali.',
    };
  }

  const { data: actorProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, username')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: `Gagal memverifikasi role administrator: ${profileError.message}`,
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

  app.use(express.json());

  // Health and status endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'PERPUSTAKAAN MERAH PUTIH',
      database: 'Supabase PostgreSQL',
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

      const { client: supabaseAdmin, error: configError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({ error: configError || 'Konfigurasi server belum lengkap.' });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }

      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .neq('role', 'admin')
        .order('created_at', { ascending: false });

      if (profilesError) {
        return res.status(500).json({ error: `Gagal memuat daftar pengunjung: ${profilesError.message}` });
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
  app.post('/api/admin/visitors/:id/delete', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ') || !authHeader.slice('Bearer '.length).trim()) {
        return res.status(401).json({
          error: 'Autentikasi diperlukan. Token sesi administrator tidak ditemukan.',
        });
      }

      const targetId = String(req.params.id || '').trim();
      const { client: supabaseAdmin, error: configError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({ error: configError || 'Konfigurasi server belum lengkap.' });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAdmin);
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
  });

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
      const { client: supabaseAdmin, error: configError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({ error: configError || 'Konfigurasi server belum lengkap.' });
      }

      const authCheck = await verifyAdminRequest(req, supabaseAdmin);
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
