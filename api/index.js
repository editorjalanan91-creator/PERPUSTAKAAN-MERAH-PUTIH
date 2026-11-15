// src/server/app.ts
import express from "express";
import { createClient } from "@supabase/supabase-js";

// src/utils/visitorDeletion.ts
function evaluateVisitorRemovalEligibility(input) {
  if (input.actorRole !== "admin") {
    return {
      allowed: false,
      action: "forbidden",
      statusCode: 403,
      code: "ADMIN_ONLY",
      error: "Akses ditolak. Hanya administrator perpustakaan yang berhak menghapus akun pengunjung."
    };
  }
  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: "self_delete_forbidden",
      statusCode: 400,
      code: "SELF_DELETE_FORBIDDEN",
      error: "Administrator tidak diperbolehkan menghapus akunnya sendiri."
    };
  }
  if (input.targetRole === "admin") {
    return {
      allowed: false,
      action: "admin_delete_forbidden",
      statusCode: 403,
      code: "ADMIN_DELETE_FORBIDDEN",
      error: "Akun dengan role administrator tidak dapat dihapus melalui menu daftar pengunjung."
    };
  }
  if (input.totalLoansCount > 0) {
    return {
      allowed: false,
      action: "archive_required",
      statusCode: 409,
      code: "HAS_LOAN_HISTORY",
      error: `Akun pengunjung ini memiliki ${input.totalLoansCount} riwayat peminjaman sehingga tidak dapat dihapus permanen. Gunakan opsi Arsipkan / Nonaktifkan Akun untuk menjaga keutuhan data laporan dan transaksi.`
    };
  }
  return {
    allowed: true,
    action: "permanent_delete",
    statusCode: 200
  };
}
function evaluateVisitorArchiveEligibility(input) {
  if (input.actorRole !== "admin") {
    return {
      allowed: false,
      action: "forbidden",
      statusCode: 403,
      code: "ADMIN_ONLY",
      error: "Akses ditolak. Hanya administrator perpustakaan yang berhak mengarsipkan akun pengunjung."
    };
  }
  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: "self_delete_forbidden",
      statusCode: 400,
      code: "SELF_DELETE_FORBIDDEN",
      error: "Administrator tidak diperbolehkan menonaktifkan akunnya sendiri."
    };
  }
  if (input.targetRole === "admin") {
    return {
      allowed: false,
      action: "admin_delete_forbidden",
      statusCode: 403,
      code: "ADMIN_DELETE_FORBIDDEN",
      error: "Akun administrator tidak dapat diarsipkan melalui menu daftar pengunjung."
    };
  }
  return {
    allowed: true,
    action: "permanent_delete",
    statusCode: 200
  };
}
function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || "").trim()
  );
}

// src/server/app.ts
function sanitizeEnv(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}
function decodeJwtRoleClaim(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
function inspectServerSupabaseEnv(env = process.env) {
  const rawServerUrl = sanitizeEnv(env.SUPABASE_URL).replace(/\/+$/, "");
  const rawViteUrl = sanitizeEnv(env.VITE_SUPABASE_URL).replace(/\/+$/, "");
  const url = rawServerUrl || rawViteUrl;
  const hasUrlMismatch = Boolean(rawServerUrl && rawViteUrl && rawServerUrl !== rawViteUrl);
  const serviceRoleKey = sanitizeEnv(env.SUPABASE_SERVICE_ROLE_KEY);
  const authApiKey = sanitizeEnv(
    env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  ) || serviceRoleKey;
  const hasSupabaseUrl = Boolean(
    url && /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(url) && !url.includes("your-project-ref") && !url.includes("placeholder")
  );
  if (!hasSupabaseUrl) {
    return {
      url: "",
      authApiKey: "",
      serviceRoleKey: "",
      hasSupabaseUrl: false,
      hasServiceRoleKey: Boolean(serviceRoleKey),
      isServiceRoleKeyValid: false,
      keyStatus: serviceRoleKey ? "unrecognized_format" : "missing",
      hasUrlMismatch,
      error: "Konfigurasi server SUPABASE_URL / VITE_SUPABASE_URL belum diatur atau belum valid pada Environment Variables server."
    };
  }
  if (!serviceRoleKey) {
    return {
      url,
      authApiKey,
      serviceRoleKey: "",
      hasSupabaseUrl: true,
      hasServiceRoleKey: false,
      isServiceRoleKeyValid: false,
      keyStatus: "missing",
      hasUrlMismatch,
      error: "Konfigurasi server SUPABASE_SERVICE_ROLE_KEY belum diatur pada Environment Variables server (Vercel / .env). Kunci rahasia ini hanya boleh dipasang di server, bukan di frontend."
    };
  }
  if (serviceRoleKey.includes("your-supabase-service-role-key")) {
    return {
      url,
      authApiKey,
      serviceRoleKey: "",
      hasSupabaseUrl: true,
      hasServiceRoleKey: false,
      isServiceRoleKeyValid: false,
      keyStatus: "invalid_placeholder",
      hasUrlMismatch,
      error: "Konfigurasi server SUPABASE_SERVICE_ROLE_KEY masih menggunakan nilai contoh. Isi dengan Secret / Service Role Key asli dari Supabase Dashboard."
    };
  }
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    return {
      url,
      authApiKey,
      serviceRoleKey: "",
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: false,
      keyStatus: "invalid_publishable_key",
      hasUrlMismatch,
      error: "Konfigurasi SUPABASE_SERVICE_ROLE_KEY di server terdeteksi menggunakan Publishable Key (sb_publishable_...), bukan Secret Key (sb_secret_... / service_role). Perbarui Environment Variable SUPABASE_SERVICE_ROLE_KEY di Vercel."
    };
  }
  if (serviceRoleKey.startsWith("sb_secret_")) {
    return {
      url,
      authApiKey,
      serviceRoleKey,
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: true,
      keyStatus: "valid_secret_key",
      hasUrlMismatch
    };
  }
  const jwtRole = decodeJwtRoleClaim(serviceRoleKey);
  if (jwtRole === "anon" || jwtRole === "authenticated") {
    return {
      url,
      authApiKey,
      serviceRoleKey: "",
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: false,
      keyStatus: "invalid_anon_jwt",
      hasUrlMismatch,
      error: `Konfigurasi SUPABASE_SERVICE_ROLE_KEY di server terdeteksi menggunakan kunci ber-role "${jwtRole}", bukan "service_role". Perbarui Environment Variable SUPABASE_SERVICE_ROLE_KEY di Vercel dengan Service Role Key Supabase.`
    };
  }
  if (jwtRole === "service_role") {
    return {
      url,
      authApiKey,
      serviceRoleKey,
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: true,
      keyStatus: "valid_service_role_jwt",
      hasUrlMismatch
    };
  }
  return {
    url,
    authApiKey,
    serviceRoleKey,
    hasSupabaseUrl: true,
    hasServiceRoleKey: true,
    isServiceRoleKeyValid: true,
    keyStatus: "unrecognized_format",
    hasUrlMismatch
  };
}
function defaultCreateSupabaseAuthClient() {
  const inspection = inspectServerSupabaseEnv();
  if (!inspection.hasSupabaseUrl) {
    return { client: null, error: inspection.error };
  }
  const keyForAuth = inspection.authApiKey || inspection.serviceRoleKey;
  if (!keyForAuth) {
    return {
      client: null,
      error: inspection.error || "Kunci API Supabase untuk verifikasi autentikasi server belum tersedia."
    };
  }
  const client = createClient(inspection.url, keyForAuth, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  return { client };
}
function createAdminClientFetch(serviceRoleKey, fetchImpl = fetch) {
  const isNewSecretKey = serviceRoleKey.startsWith("sb_secret_");
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("apikey", serviceRoleKey);
    if (isNewSecretKey) {
      headers.delete("Authorization");
    } else {
      headers.set("Authorization", `Bearer ${serviceRoleKey}`);
    }
    return fetchImpl(input, { ...init, headers });
  };
}
function defaultCreateSupabaseAdminClient(options = {}) {
  const inspection = inspectServerSupabaseEnv(options.env);
  if (inspection.error || !inspection.serviceRoleKey) {
    return { client: null, error: inspection.error || "Konfigurasi Admin Supabase tidak lengkap." };
  }
  const isNewSecretKey = inspection.serviceRoleKey.startsWith("sb_secret_");
  const adminFetch = createAdminClientFetch(
    inspection.serviceRoleKey,
    options.fetchImpl ?? fetch
  );
  const client = createClient(inspection.url, inspection.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      fetch: adminFetch,
      headers: isNewSecretKey ? {
        apikey: inspection.serviceRoleKey
      } : {
        apikey: inspection.serviceRoleKey,
        Authorization: `Bearer ${inspection.serviceRoleKey}`
      }
    }
  });
  return { client };
}
async function probeAdminProfilesAccess(getAdminClient = () => defaultCreateSupabaseAdminClient()) {
  const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      authAdminOk: false,
      errorCode: "ADMIN_CLIENT_NOT_CONFIGURED",
      errorMessage: adminClientError || "Konfigurasi Admin Supabase tidak lengkap."
    };
  }
  const { error: profilesError } = await supabaseAdmin.from("profiles").select("id", { head: true }).limit(1);
  if (profilesError) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      authAdminOk: false,
      errorCode: profilesError.code || "PROFILES_QUERY_ERROR",
      errorMessage: profilesError.message
    };
  }
  let authAdminOk = true;
  if (supabaseAdmin.auth?.admin?.listUsers) {
    const { error: authAdminError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });
    if (authAdminError) {
      return {
        ok: false,
        statusCode: 500,
        profilesOk: true,
        authAdminOk: false,
        errorCode: authAdminError.code || "AUTH_ADMIN_ERROR",
        errorMessage: authAdminError.message
      };
    }
  } else {
    authAdminOk = false;
  }
  return {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    authAdminOk
  };
}
async function verifyAdminRequest(req, supabaseAuth, supabaseAdmin) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "Autentikasi diperlukan. Token sesi administrator tidak ditemukan."
    };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Token sesi administrator kosong atau tidak valid."
    };
  }
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      ok: false,
      status: 401,
      error: "Sesi administrator tidak valid atau sudah berakhir. Silakan login kembali."
    };
  }
  const { data: actorProfile, error: profileError } = await supabaseAdmin.from("profiles").select("id, role, full_name, username").eq("id", authData.user.id).maybeSingle();
  if (profileError) {
    const isPermDenied = profileError.message.toLowerCase().includes("permission denied");
    return {
      ok: false,
      status: 500,
      error: isPermDenied ? `Gagal memverifikasi role administrator: ${profileError.message}. Pastikan SUPABASE_SERVICE_ROLE_KEY di Environment Variables Vercel benar-benar menggunakan Service Role / Secret Key Supabase (bukan Publishable/Anon Key) dan hak akses service_role pada tabel public.profiles aktif.` : `Gagal memverifikasi role administrator: ${profileError.message}`
    };
  }
  if (!actorProfile || actorProfile.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Akses ditolak. Hanya administrator dengan role admin yang dapat melakukan aksi ini."
    };
  }
  return {
    ok: true,
    adminProfile: actorProfile
  };
}
function isUserCurrentlyBanned(bannedUntil) {
  if (!bannedUntil) return false;
  const ts = new Date(bannedUntil).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}
function createApp(options = {}) {
  const app2 = express();
  const getAdminClient = options.getAdminClient ?? defaultCreateSupabaseAdminClient;
  const getAuthClient = options.getAuthClient ?? (options.getAdminClient ? options.getAdminClient : defaultCreateSupabaseAuthClient);
  app2.use(express.json());
  app2.get("/api/health", async (req, res) => {
    const envInspection = inspectServerSupabaseEnv();
    const shouldProbeProfiles = req.query.probe === "profiles";
    const profilesProbe = shouldProbeProfiles ? await probeAdminProfilesAccess(() => getAdminClient()) : void 0;
    res.json({
      status: "ok",
      service: "PERPUSTAKAAN MERAH PUTIH",
      database: "Supabase PostgreSQL",
      envStatus: {
        hasSupabaseUrl: envInspection.hasSupabaseUrl,
        hasServiceRoleKey: envInspection.hasServiceRoleKey,
        serviceRoleKeyValid: envInspection.isServiceRoleKeyValid,
        serviceRoleKeyStatus: envInspection.keyStatus,
        hasUrlMismatch: envInspection.hasUrlMismatch
      },
      ...profilesProbe ? { profilesProbe } : {},
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app2.get("/api/admin/visitors", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ") || !authHeader.slice("Bearer ".length).trim()) {
        return res.status(401).json({
          error: "Autentikasi diperlukan. Token sesi administrator tidak ditemukan."
        });
      }
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const { data: profiles, error: profilesError } = await supabaseAdmin.from("profiles").select("*").neq("role", "admin").order("created_at", { ascending: false });
      if (profilesError) {
        return res.status(500).json({
          error: `Gagal memuat daftar pengunjung: ${profilesError.message}`
        });
      }
      const authUsersById = /* @__PURE__ */ new Map();
      try {
        const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1e3
        });
        if (!listError && listData?.users) {
          for (const authUser of listData.users) {
            const meta = authUser.user_metadata || {};
            const banned = isUserCurrentlyBanned(authUser.banned_until);
            const inactive = meta.is_active === false || banned;
            authUsersById.set(authUser.id, {
              email: authUser.email,
              is_active: !inactive,
              archived_at: meta.archived_at ?? null
            });
          }
        }
      } catch (listErr) {
        console.warn("Gagal mengambil metadata Auth pengguna:", listErr);
      }
      const enrichedVisitors = (profiles || []).map((profile) => {
        const authMeta = authUsersById.get(profile.id);
        const isActive = profile.is_active === false || authMeta?.is_active === false ? false : true;
        const archivedAt = profile.archived_at ?? authMeta?.archived_at ?? null;
        return {
          ...profile,
          email: authMeta?.email ?? profile.email,
          is_active: isActive,
          archived_at: archivedAt
        };
      });
      return res.json({ visitors: enrichedVisitors });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memuat data pengunjung."
      });
    }
  });
  const handleDeleteVisitorRequest = async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ") || !authHeader.slice("Bearer ".length).trim()) {
        return res.status(401).json({
          error: "Autentikasi diperlukan. Token sesi administrator tidak ditemukan."
        });
      }
      const targetId = String(req.params.id || "").trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: "ID akun pengunjung tidak valid." });
      }
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin.from("profiles").select("id, full_name, username, role").eq("id", targetId).maybeSingle();
      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`
        });
      }
      let resolvedRole = targetProfile?.role;
      let resolvedName = targetProfile?.full_name || "Pengunjung";
      let resolvedUsername = targetProfile?.username || "";
      if (!targetProfile) {
        const { data: authTarget, error: authTargetErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
        if (authTargetErr || !authTarget?.user) {
          return res.status(404).json({
            error: "Akun pengunjung tidak ditemukan di database."
          });
        }
        resolvedRole = authTarget.user.user_metadata?.role || "visitor";
        resolvedName = authTarget.user.user_metadata?.full_name || "Pengunjung";
        resolvedUsername = authTarget.user.user_metadata?.username || "";
      }
      const { count: loansCount, error: loansCountError } = await supabaseAdmin.from("loans").select("id", { count: "exact", head: true }).eq("user_id", targetId);
      if (loansCountError) {
        return res.status(500).json({
          error: `Gagal memeriksa riwayat peminjaman pengunjung: ${loansCountError.message}`
        });
      }
      const totalLoansCount = loansCount ?? 0;
      const evaluation = evaluateVisitorRemovalEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: resolvedRole,
        totalLoansCount
      });
      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          totalLoans: totalLoansCount
        });
      }
      await supabaseAdmin.from("activity_logs").delete().eq("actor_id", targetId);
      await supabaseAdmin.from("books").update({ created_by: null }).eq("created_by", targetId);
      await supabaseAdmin.from("categories").update({ created_by: null }).eq("created_by", targetId);
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (deleteAuthError && !deleteAuthError.message.toLowerCase().includes("not found")) {
        const lowerMsg = deleteAuthError.message.toLowerCase();
        if (lowerMsg.includes("storage") || lowerMsg.includes("object")) {
          return res.status(409).json({
            error: "Akun tidak dapat dihapus karena masih memiliki file objek terkait di Supabase Storage."
          });
        }
        return res.status(500).json({
          error: `Gagal menghapus akun dari Supabase Authentication: ${deleteAuthError.message}`
        });
      }
      const { data: leftoverProfile } = await supabaseAdmin.from("profiles").select("id").eq("id", targetId).maybeSingle();
      if (leftoverProfile) {
        const { error: deleteProfileError } = await supabaseAdmin.from("profiles").delete().eq("id", targetId);
        if (deleteProfileError) {
          return res.status(500).json({
            error: `Akun Auth berhasil dihapus, namun gagal menghapus baris public.profiles: ${deleteProfileError.message}`
          });
        }
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "delete_visitor",
          entity_type: "profiles",
          entity_id: targetId,
          details: JSON.stringify({
            full_name: resolvedName,
            username: resolvedUsername
          }),
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch {
      }
      return res.json({
        success: true,
        mode: "deleted",
        deletedUserId: targetId,
        message: `Akun pengunjung "${resolvedName}" berhasil dihapus permanen dari Supabase Authentication dan tabel profiles.`
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat menghapus akun pengunjung."
      });
    }
  };
  app2.post("/api/admin/visitors/:id/delete", handleDeleteVisitorRequest);
  app2.delete("/api/admin/visitors/:id", handleDeleteVisitorRequest);
  app2.post("/api/admin/visitors/:id/archive", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ") || !authHeader.slice("Bearer ".length).trim()) {
        return res.status(401).json({
          error: "Autentikasi diperlukan. Token sesi administrator tidak ditemukan."
        });
      }
      const targetId = String(req.params.id || "").trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAdminRequest(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      if (!isValidUuid(targetId)) {
        return res.status(400).json({ error: "ID akun pengunjung tidak valid." });
      }
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin.from("profiles").select("id, full_name, username, role").eq("id", targetId).maybeSingle();
      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`
        });
      }
      if (!targetProfile) {
        return res.status(404).json({ error: "Akun pengunjung tidak ditemukan di database." });
      }
      const evaluation = evaluateVisitorArchiveEligibility({
        actorId: authCheck.adminProfile.id,
        actorRole: authCheck.adminProfile.role,
        targetId,
        targetRole: targetProfile.role
      });
      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { data: authTargetData, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(targetId);
      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: "Akun autentikasi pengunjung tidak ditemukan di Supabase Auth."
        });
      }
      const existingMeta = authTargetData.user.user_metadata || {};
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
        ban_duration: "876000h",
        user_metadata: {
          ...existingMeta,
          is_active: false,
          archived_at: nowIso,
          archived_by: authCheck.adminProfile.id
        }
      });
      if (banError) {
        return res.status(500).json({
          error: `Gagal menonaktifkan akun di Supabase Authentication: ${banError.message}`
        });
      }
      const { error: profileArchiveError } = await supabaseAdmin.from("profiles").update({
        is_active: false,
        archived_at: nowIso,
        updated_at: nowIso
      }).eq("id", targetId);
      if (profileArchiveError) {
        try {
          await supabaseAdmin.from("profiles").update({ updated_at: nowIso }).eq("id", targetId);
        } catch {
        }
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "archive_visitor",
          entity_type: "profiles",
          entity_id: targetId,
          details: JSON.stringify({
            full_name: targetProfile.full_name,
            username: targetProfile.username,
            archived_at: nowIso
          }),
          created_at: nowIso
        });
      } catch {
      }
      return res.json({
        success: true,
        mode: "archived",
        archivedUserId: targetId,
        archivedAt: nowIso,
        message: `Akun pengunjung "${targetProfile.full_name}" berhasil diarsipkan dan dinonaktifkan. Seluruh riwayat peminjaman tetap terjaga.`
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat mengarsipkan akun pengunjung."
      });
    }
  });
  return app2;
}

// src/server/vercel.ts
var app = createApp();
var vercel_default = app;
export {
  vercel_default as default
};
