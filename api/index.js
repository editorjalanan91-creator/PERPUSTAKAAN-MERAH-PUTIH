// src/server/app.ts
import express from "express";
import { createClient } from "@supabase/supabase-js";

// src/utils/visitorDeletion.ts
function isAdminOrSuperAdminRole(role) {
  return role === "admin" || role === "super_admin";
}
function isProtectedSuperAdmin(input) {
  if (input.targetRole === "super_admin") return true;
  if (input.targetIsSuperAdmin === true) return true;
  if (input.targetId && Array.isArray(input.superAdminUids)) {
    return input.superAdminUids.includes(input.targetId);
  }
  return false;
}
function evaluateVisitorRemovalEligibility(input) {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
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
  if (isProtectedSuperAdmin(input)) {
    return {
      allowed: false,
      action: "super_admin_protected",
      statusCode: 403,
      code: "SUPER_ADMIN_PROTECTED",
      error: "Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan."
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
  const activeLoansCount = input.activeLoansCount ?? 0;
  if (activeLoansCount > 0) {
    return {
      allowed: false,
      action: "active_loans_block",
      statusCode: 409,
      code: "HAS_ACTIVE_LOANS",
      error: `Akun pengunjung ini masih memiliki ${activeLoansCount} peminjaman aktif atau menunggu persetujuan. Selesaikan seluruh transaksi peminjaman terlebih dahulu sebelum menghapus atau mengarsipkan akun.`
    };
  }
  if (input.totalLoansCount > 0) {
    return {
      allowed: false,
      action: "archive_required",
      statusCode: 409,
      code: "HAS_LOAN_HISTORY",
      error: `Akun pengunjung ini memiliki ${input.totalLoansCount} riwayat peminjaman sehingga tidak dapat dihapus permanen. Gunakan opsi Arsipkan Pengunjung untuk menjaga keutuhan data laporan dan transaksi.`
    };
  }
  return {
    allowed: true,
    action: "permanent_delete",
    statusCode: 200
  };
}
function evaluateVisitorArchiveEligibility(input) {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
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
  if (isProtectedSuperAdmin(input)) {
    return {
      allowed: false,
      action: "super_admin_protected",
      statusCode: 403,
      code: "SUPER_ADMIN_PROTECTED",
      error: "Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan."
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
  const activeLoansCount = input.activeLoansCount ?? 0;
  if (activeLoansCount > 0) {
    return {
      allowed: false,
      action: "active_loans_block",
      statusCode: 409,
      code: "HAS_ACTIVE_LOANS",
      error: `Pengarsipan ditolak: akun pengunjung masih memiliki ${activeLoansCount} transaksi peminjaman yang masih aktif atau belum selesai. Selesaikan peminjaman terlebih dahulu.`
    };
  }
  return {
    allowed: true,
    action: "archive_required",
    statusCode: 200
  };
}
function evaluateVisitorRestoreEligibility(input) {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
    return {
      allowed: false,
      action: "forbidden",
      statusCode: 403,
      code: "ADMIN_ONLY",
      error: "Akses ditolak. Hanya administrator perpustakaan yang berhak mengaktifkan kembali akun pengunjung."
    };
  }
  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: "self_delete_forbidden",
      statusCode: 400,
      code: "SELF_ACTION_FORBIDDEN",
      error: "Operasi ini tidak berlaku untuk akun Anda sendiri."
    };
  }
  if (isProtectedSuperAdmin(input) || input.targetRole === "admin") {
    return {
      allowed: false,
      action: isProtectedSuperAdmin(input) ? "super_admin_protected" : "admin_delete_forbidden",
      statusCode: 403,
      code: isProtectedSuperAdmin(input) ? "SUPER_ADMIN_PROTECTED" : "ADMIN_PROTECTED",
      error: "Akun administrator / Super Admin tidak dikelola melalui menu pengunjung."
    };
  }
  return {
    allowed: true,
    action: "restore",
    statusCode: 200
  };
}
function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || "").trim()
  );
}

// src/utils/libraryRules.ts
var BOOK_RETURN_NOTIFICATIONS = {
  SUCCESS: {
    type: "success",
    title: "Buku Berhasil Dikembalikan",
    message: "Buku berhasil dikembalikan. Terima kasih!"
  },
  UNCONFIRMED: {
    type: "error",
    title: "Pengembalian Buku Belum Dapat Dikonfirmasi",
    message: "Permintaan pengembalian buku belum dapat dikonfirmasi oleh sistem. Silakan periksa status peminjaman Anda atau hubungi administrator perpustakaan apabila kendala masih terjadi."
  }
};
var MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024;
var MAX_BOOK_DOC_SIZE_BYTES = 50 * 1024 * 1024;
function evaluateLoanReturnEligibility(status) {
  if (status === "approved" || status === "borrowed") {
    return { eligible: true };
  }
  if (status === "returned") {
    return {
      eligible: false,
      reason: "already_returned",
      message: "Buku untuk transaksi peminjaman ini sudah dikembalikan sebelumnya."
    };
  }
  if (status === "pending") {
    return {
      eligible: false,
      reason: "invalid_status",
      message: "Pengajuan peminjaman yang masih menunggu persetujuan admin belum dapat dikembalikan."
    };
  }
  if (status === "rejected") {
    return {
      eligible: false,
      reason: "invalid_status",
      message: "Transaksi peminjaman yang telah ditolak tidak dapat dikembalikan."
    };
  }
  if (status === "expired") {
    return {
      eligible: false,
      reason: "invalid_status",
      message: "Transaksi peminjaman ini berstatus kedaluwarsa. Hubungi administrator perpustakaan untuk penyesuaian."
    };
  }
  return {
    eligible: false,
    reason: "invalid_status",
    message: "Status transaksi peminjaman tidak memenuhi syarat untuk proses pengembalian."
  };
}
function computeBookStockAfterReturn(input) {
  const safeTotal = Math.max(0, Math.floor(Number(input.totalCopies) || 0));
  const safeBefore = Math.max(0, Math.floor(Number(input.beforeAvailable) || 0));
  const safeAfter = Math.max(0, Math.floor(Number(input.afterAvailable) || 0));
  if (safeAfter > safeBefore) {
    const clampedTarget = safeTotal > 0 ? Math.min(safeTotal, safeAfter) : safeAfter;
    return {
      targetAvailable: clampedTarget,
      safeBefore,
      safeAfter,
      safeTotal,
      needsUpdate: clampedTarget !== safeAfter,
      incrementedBy: "trigger"
    };
  }
  const incremented = safeBefore + 1;
  const targetAvailable = safeTotal > 0 ? Math.min(safeTotal, incremented) : incremented;
  const needsUpdate = targetAvailable !== safeAfter;
  return {
    targetAvailable,
    safeBefore,
    safeAfter,
    safeTotal,
    needsUpdate,
    incrementedBy: needsUpdate ? "application" : "capped_at_total"
  };
}
function formatBookReturnErrorMessage(err) {
  const code = String(err?.code || "").trim();
  const rawMessage = String(err?.message || "").trim();
  const lower = rawMessage.toLowerCase();
  if (code === "PGRST116" || lower.includes("cannot coerce the result to a single json object") || lower.includes("0 rows")) {
    return BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message;
  }
  if (code === "42501" || lower.includes("permission denied") || lower.includes("row-level security")) {
    return "Anda tidak memiliki izin akses untuk memperbarui pengembalian buku ini. Silakan hubungi administrator perpustakaan.";
  }
  return rawMessage || BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message;
}

// src/server/app.ts
function sanitizeEnv(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}
function getSuperAdminUids(env = process.env) {
  const raw = sanitizeEnv(env.SUPABASE_SUPER_ADMIN_UIDS);
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
function isTargetAuthSuperAdmin(authUser) {
  if (!authUser) return false;
  const appMeta = authUser.app_metadata || {};
  return appMeta.is_super_admin === true || appMeta.role === "super_admin";
}
function isMissingColumnError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || "").toLowerCase();
  return code === "42703" || msg.includes("column") && msg.includes("does not exist");
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
  const hasUrlMismatch = Boolean(
    rawServerUrl && rawViteUrl && rawServerUrl.toLowerCase() !== rawViteUrl.toLowerCase()
  );
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
  if (hasUrlMismatch) {
    return {
      url,
      authApiKey,
      serviceRoleKey: "",
      hasSupabaseUrl: true,
      hasServiceRoleKey: Boolean(serviceRoleKey),
      isServiceRoleKeyValid: false,
      keyStatus: serviceRoleKey.startsWith("sb_secret_") ? "valid_secret_key" : "unrecognized_format",
      hasUrlMismatch: true,
      error: "Konfigurasi SUPABASE_URL dan VITE_SUPABASE_URL menunjuk Project Supabase yang berbeda. Samakan kedua URL pada Environment Variables agar verifikasi token dan akses database konsisten."
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
  if (!inspection.hasSupabaseUrl || inspection.hasUrlMismatch) {
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
  let { data: actorProfile, error: profileError } = await supabaseAdmin.from("profiles").select("id, role, full_name, username, is_super_admin, is_active, archived_at").eq("id", authData.user.id).maybeSingle();
  if (profileError && isMissingColumnError(profileError)) {
    const fallbackResult = await supabaseAdmin.from("profiles").select("id, role, full_name, username").eq("id", authData.user.id).maybeSingle();
    actorProfile = fallbackResult.data;
    profileError = fallbackResult.error;
  }
  if (profileError) {
    const isPermDenied = profileError.message.toLowerCase().includes("permission denied");
    return {
      ok: false,
      status: 500,
      error: isPermDenied ? `Gagal memverifikasi role administrator: ${profileError.message}. Pastikan SUPABASE_SERVICE_ROLE_KEY di Environment Variables Vercel benar-benar menggunakan Service Role / Secret Key Supabase (bukan Publishable/Anon Key) dan hak akses service_role pada tabel public.profiles aktif.` : `Gagal memverifikasi role administrator: ${profileError.message}`
    };
  }
  if (!actorProfile || !isAdminOrSuperAdminRole(actorProfile.role)) {
    return {
      ok: false,
      status: 403,
      error: "Akses ditolak. Hanya administrator dengan role admin yang dapat melakukan aksi ini."
    };
  }
  if (actorProfile.is_active === false || Boolean(actorProfile.archived_at)) {
    return {
      ok: false,
      status: 403,
      error: "Akses ditolak. Akun administrator ini sedang dinonaktifkan / diarsipkan."
    };
  }
  return {
    ok: true,
    adminProfile: actorProfile
  };
}
async function verifyAuthenticatedUser(req, supabaseAuth, supabaseAdmin) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "Autentikasi diperlukan untuk mengonfirmasi pengembalian buku."
    };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Token sesi pengguna kosong atau tidak valid."
    };
  }
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      ok: false,
      status: 401,
      error: "Sesi pengguna tidak valid atau sudah berakhir. Silakan login kembali."
    };
  }
  let profileQueryResult = await supabaseAdmin.from("profiles").select("id, role, full_name, username, is_super_admin, is_active, archived_at").eq("id", authData.user.id).limit(2);
  if (profileQueryResult.error && isMissingColumnError(profileQueryResult.error)) {
    profileQueryResult = await supabaseAdmin.from("profiles").select("id, role, full_name, username").eq("id", authData.user.id).limit(2);
  }
  const profileError = profileQueryResult.error;
  const profileRows = profileQueryResult.data;
  if (profileError) {
    return {
      ok: false,
      status: 500,
      error: `Gagal memverifikasi profil pengguna: ${profileError.message}`
    };
  }
  if (profileRows && profileRows.length > 1) {
    console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
      query: "verifyAuthenticatedUser.profiles_by_id",
      userId: authData.user.id,
      rowCount: profileRows.length
    });
    return {
      ok: false,
      status: 409,
      error: "Terdeteksi duplikasi profil pengguna pada database. Hubungi administrator."
    };
  }
  const actorProfile = profileRows?.[0] ?? null;
  if (!actorProfile) {
    return {
      ok: false,
      status: 403,
      error: "Profil pengguna tidak ditemukan di database."
    };
  }
  if (actorProfile.is_active === false || Boolean(actorProfile.archived_at)) {
    return {
      ok: false,
      status: 403,
      error: "Akun Anda sedang dinonaktifkan / diarsipkan sehingga tidak dapat memproses transaksi."
    };
  }
  return {
    ok: true,
    userProfile: actorProfile
  };
}
async function countVisitorLoans(supabaseAdmin, targetId) {
  const { count: totalCount, error: totalErr } = await supabaseAdmin.from("loans").select("id", { count: "exact", head: true }).eq("user_id", targetId);
  if (totalErr) {
    return {
      totalLoansCount: 0,
      activeLoansCount: 0,
      error: `Gagal memeriksa riwayat peminjaman pengunjung: ${totalErr.message}`
    };
  }
  const { count: activeCount, error: activeErr } = await supabaseAdmin.from("loans").select("id", { count: "exact", head: true }).eq("user_id", targetId).in("status", ["pending", "approved", "borrowed"]);
  if (activeErr) {
    return {
      totalLoansCount: totalCount ?? 0,
      activeLoansCount: 0,
      error: `Gagal memeriksa pinjaman aktif pengunjung: ${activeErr.message}`
    };
  }
  return {
    totalLoansCount: totalCount ?? 0,
    activeLoansCount: activeCount ?? 0
  };
}
async function syncProfileArchiveFields(supabaseAdmin, targetId, payload) {
  const fullAttempt = await supabaseAdmin.from("profiles").update(payload).eq("id", targetId);
  if (!fullAttempt.error) return { error: null };
  if (!isMissingColumnError(fullAttempt.error)) {
    return { error: fullAttempt.error };
  }
  const basicAttempt = await supabaseAdmin.from("profiles").update({
    is_active: payload.is_active,
    archived_at: payload.archived_at,
    updated_at: payload.updated_at
  }).eq("id", targetId);
  if (!basicAttempt.error) return { error: null };
  if (!isMissingColumnError(basicAttempt.error)) {
    return { error: basicAttempt.error };
  }
  const minimalAttempt = await supabaseAdmin.from("profiles").update({ updated_at: payload.updated_at }).eq("id", targetId);
  if (!minimalAttempt.error || isMissingColumnError(minimalAttempt.error)) {
    return { error: null };
  }
  return { error: minimalAttempt.error };
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
  const resolvedSuperAdminUids = options.superAdminUids ?? getSuperAdminUids();
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
      const { data: profiles, error: profilesError } = await supabaseAdmin.from("profiles").select("*").neq("role", "admin").neq("role", "super_admin").order("created_at", { ascending: false });
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
              archived_at: meta.archived_at ?? null,
              is_super_admin: isTargetAuthSuperAdmin(authUser)
            });
          }
        }
      } catch (listErr) {
        console.warn("Gagal mengambil metadata Auth pengguna:", listErr);
      }
      const enrichedVisitors = (profiles || []).filter((profile) => {
        const authMeta = authUsersById.get(profile.id);
        return !isAdminOrSuperAdminRole(profile.role) && profile.is_super_admin !== true && !authMeta?.is_super_admin && !resolvedSuperAdminUids.includes(profile.id);
      }).map((profile) => {
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
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).maybeSingle();
      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`
        });
      }
      let authTargetUser = null;
      try {
        const { data: authTarget, error: authTargetErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
        if (!authTargetErr && authTarget?.user) {
          authTargetUser = authTarget.user;
        }
      } catch {
      }
      if (!targetProfile && !authTargetUser) {
        return res.status(404).json({
          error: "Akun pengunjung tidak ditemukan di database."
        });
      }
      const resolvedRole = targetProfile?.role || authTargetUser?.user_metadata?.role || "visitor";
      const resolvedName = targetProfile?.full_name || authTargetUser?.user_metadata?.full_name || "Pengunjung";
      const resolvedUsername = targetProfile?.username || authTargetUser?.user_metadata?.username || "";
      const targetIsSuperAdmin = Boolean(
        targetProfile?.is_super_admin === true || isTargetAuthSuperAdmin(authTargetUser)
      );
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
        activeLoansCount: loanStats.activeLoansCount
      });
      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          totalLoans: loanStats.totalLoansCount,
          activeLoans: loanStats.activeLoansCount
        });
      }
      const { data: logsSnapshot, error: logsSnapErr } = await supabaseAdmin.from("activity_logs").select("id").eq("actor_id", targetId);
      if (logsSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot activity_logs sebelum penghapusan: ${logsSnapErr.message}`
        });
      }
      const { data: booksSnapshot, error: booksSnapErr } = await supabaseAdmin.from("books").select("id").eq("created_by", targetId);
      if (booksSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot books sebelum penghapusan: ${booksSnapErr.message}`
        });
      }
      const { data: categoriesSnapshot, error: catsSnapErr } = await supabaseAdmin.from("categories").select("id").eq("created_by", targetId);
      if (catsSnapErr) {
        return res.status(500).json({
          error: `Gagal mengambil snapshot categories sebelum penghapusan: ${catsSnapErr.message}`
        });
      }
      const bookIdsToRestore = Array.isArray(booksSnapshot) ? booksSnapshot.map((b) => b.id).filter(Boolean) : [];
      const categoryIdsToRestore = Array.isArray(categoriesSnapshot) ? categoriesSnapshot.map((c) => c.id).filter(Boolean) : [];
      const logIdsToRestore = Array.isArray(logsSnapshot) ? logsSnapshot.map((l) => l.id).filter(Boolean) : [];
      let logsCleared = false;
      let booksCleared = false;
      let catsCleared = false;
      const rollbackReferencesAndProfile = async (restoreProfileRow) => {
        const failures = [];
        if (restoreProfileRow && targetProfile) {
          try {
            const { error: restoreProfileErr } = await supabaseAdmin.from("profiles").insert(targetProfile);
            if (restoreProfileErr) {
              failures.push({
                step: "restore_profile",
                table: "profiles",
                recordId: targetId,
                message: restoreProfileErr.message || "Gagal memulihkan baris public.profiles."
              });
            }
          } catch (err) {
            failures.push({
              step: "restore_profile",
              table: "profiles",
              recordId: targetId,
              message: err?.message || "Pengecualian saat memulihkan baris public.profiles."
            });
          }
        }
        if (booksCleared) {
          for (const bookId of bookIdsToRestore) {
            try {
              const { error: restoreBookErr } = await supabaseAdmin.from("books").update({ created_by: targetId }).eq("id", bookId);
              if (restoreBookErr) {
                failures.push({
                  step: "restore_book_creator",
                  table: "books",
                  recordId: String(bookId),
                  message: restoreBookErr.message || "Gagal memulihkan kolom created_by pada tabel books."
                });
              }
            } catch (err) {
              failures.push({
                step: "restore_book_creator",
                table: "books",
                recordId: String(bookId),
                message: err?.message || "Pengecualian saat memulihkan kolom created_by pada tabel books."
              });
            }
          }
        }
        if (catsCleared) {
          for (const catId of categoryIdsToRestore) {
            try {
              const { error: restoreCatErr } = await supabaseAdmin.from("categories").update({ created_by: targetId }).eq("id", catId);
              if (restoreCatErr) {
                failures.push({
                  step: "restore_category_creator",
                  table: "categories",
                  recordId: String(catId),
                  message: restoreCatErr.message || "Gagal memulihkan kolom created_by pada tabel categories."
                });
              }
            } catch (err) {
              failures.push({
                step: "restore_category_creator",
                table: "categories",
                recordId: String(catId),
                message: err?.message || "Pengecualian saat memulihkan kolom created_by pada tabel categories."
              });
            }
          }
        }
        if (logsCleared) {
          for (const logId of logIdsToRestore) {
            try {
              const { error: restoreLogErr } = await supabaseAdmin.from("activity_logs").update({ actor_id: targetId }).eq("id", logId);
              if (restoreLogErr) {
                failures.push({
                  step: "restore_activity_log_actor",
                  table: "activity_logs",
                  recordId: String(logId),
                  message: restoreLogErr.message || "Gagal memulihkan kolom actor_id pada tabel activity_logs."
                });
              }
            } catch (err) {
              failures.push({
                step: "restore_activity_log_actor",
                table: "activity_logs",
                recordId: String(logId),
                message: err?.message || "Pengecualian saat memulihkan kolom actor_id pada tabel activity_logs."
              });
            }
          }
        }
        if (failures.length > 0) {
          console.error("[VISITOR_DELETE_ROLLBACK_INCOMPLETE]", {
            targetId,
            failureCount: failures.length,
            failures
          });
        }
        return {
          complete: failures.length === 0,
          failures
        };
      };
      const { error: clearLogsErr } = await supabaseAdmin.from("activity_logs").update({ actor_id: null }).eq("actor_id", targetId);
      if (clearLogsErr) {
        return res.status(500).json({
          error: `Gagal melepaskan referensi actor_id pada activity_logs sebelum penghapusan (pastikan migrasi ON DELETE SET NULL sudah dijalankan): ${clearLogsErr.message}`
        });
      }
      logsCleared = true;
      const { error: clearBooksErr } = await supabaseAdmin.from("books").update({ created_by: null }).eq("created_by", targetId);
      if (clearBooksErr) {
        const rollback = await rollbackReferencesAndProfile(false);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Gagal melepaskan referensi buku (${clearBooksErr.message}), dan pemulihan rollback tidak lengkap (${rollback.failures.length} kegagalan). Data referensi mungkin tidak konsisten.`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false,
            rollbackFailures: rollback.failures
          });
        }
        return res.status(500).json({
          error: `Gagal melepaskan referensi buku sebelum penghapusan (referensi log aktivitas telah dipulihkan): ${clearBooksErr.message}`,
          rollbackComplete: true
        });
      }
      booksCleared = true;
      const { error: clearCatsErr } = await supabaseAdmin.from("categories").update({ created_by: null }).eq("created_by", targetId);
      if (clearCatsErr) {
        const rollback = await rollbackReferencesAndProfile(false);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Gagal melepaskan referensi kategori (${clearCatsErr.message}), dan pemulihan rollback tidak lengkap (${rollback.failures.length} kegagalan). Data referensi mungkin tidak konsisten.`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false,
            rollbackFailures: rollback.failures
          });
        }
        return res.status(500).json({
          error: `Gagal melepaskan referensi kategori sebelum penghapusan (referensi sebelumnya telah dipulihkan): ${clearCatsErr.message}`,
          rollbackComplete: true
        });
      }
      catsCleared = true;
      let profileDeletedFirst = false;
      if (targetProfile) {
        const { error: deleteProfileError } = await supabaseAdmin.from("profiles").delete().eq("id", targetId);
        if (deleteProfileError) {
          const rollback = await rollbackReferencesAndProfile(false);
          if (!rollback.complete) {
            return res.status(500).json({
              error: `Gagal menghapus baris public.profiles (${deleteProfileError.message}), dan pemulihan rollback referensi TIDAK LENGKAP (${rollback.failures.length} kegagalan). Data referensi database mungkin tidak konsisten \u2014 periksa server log.`,
              code: "ROLLBACK_INCOMPLETE",
              rollbackComplete: false,
              rollbackFailures: rollback.failures
            });
          }
          const lowerProfileErr = deleteProfileError.message.toLowerCase();
          if (lowerProfileErr.includes("super admin")) {
            return res.status(403).json({
              error: deleteProfileError.message,
              code: "SUPER_ADMIN_PROTECTED",
              rollbackComplete: true
            });
          }
          return res.status(500).json({
            error: `Gagal menghapus baris public.profiles (seluruh referensi database telah dipulihkan): ${deleteProfileError.message}`,
            rollbackComplete: true
          });
        }
        profileDeletedFirst = true;
      }
      if (resolvedSuperAdminUids.includes(targetId) || targetIsSuperAdmin || resolvedRole === "super_admin") {
        const rollback = await rollbackReferencesAndProfile(profileDeletedFirst);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Operasi ditolak karena target adalah Super Admin, dan pemulihan rollback referensi tidak lengkap (${rollback.failures.length} kegagalan).`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false,
            rollbackFailures: rollback.failures
          });
        }
        return res.status(403).json({
          error: "Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.",
          code: "SUPER_ADMIN_PROTECTED",
          rollbackComplete: true
        });
      }
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (deleteAuthError && !deleteAuthError.message.toLowerCase().includes("not found")) {
        const rollback = await rollbackReferencesAndProfile(profileDeletedFirst);
        if (!rollback.complete) {
          return res.status(500).json({
            error: `Gagal menghapus akun dari Supabase Authentication (${deleteAuthError.message}), dan pemulihan (rollback) profil/referensi TIDAK LENGKAP (${rollback.failures.length} kegagalan). Profil atau referensi database mungkin tidak konsisten \u2014 periksa server log.`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false,
            rollbackFailures: rollback.failures
          });
        }
        const lowerMsg = deleteAuthError.message.toLowerCase();
        if (lowerMsg.includes("storage") || lowerMsg.includes("object")) {
          return res.status(409).json({
            error: "Akun tidak dapat dihapus karena masih memiliki file objek terkait di Supabase Storage (perubahan profil telah dibatalkan).",
            rollbackComplete: true
          });
        }
        if (lowerMsg.includes("super admin")) {
          return res.status(403).json({
            error: deleteAuthError.message,
            code: "SUPER_ADMIN_PROTECTED",
            rollbackComplete: true
          });
        }
        return res.status(500).json({
          error: `Gagal menghapus akun dari Supabase Authentication (perubahan profil dan referensi telah dibatalkan): ${deleteAuthError.message}`,
          rollbackComplete: true
        });
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
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).maybeSingle();
      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`
        });
      }
      if (!targetProfile) {
        return res.status(404).json({ error: "Akun pengunjung tidak ditemukan di database." });
      }
      const { data: authTargetData, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(targetId);
      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: "Akun autentikasi pengunjung tidak ditemukan di Supabase Auth."
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
        activeLoansCount: loanStats.activeLoansCount
      });
      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code,
          activeLoans: loanStats.activeLoansCount
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const existingMeta = authTargetData.user.user_metadata || {};
      const previousBannedUntil = authTargetData.user.banned_until ?? null;
      if (resolvedSuperAdminUids.includes(targetId) || targetIsSuperAdmin || targetProfile.role === "super_admin") {
        return res.status(403).json({
          error: "Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.",
          code: "SUPER_ADMIN_PROTECTED"
        });
      }
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
      const { error: profileSyncError } = await syncProfileArchiveFields(supabaseAdmin, targetId, {
        is_active: false,
        archived_at: nowIso,
        archived_by: authCheck.adminProfile.id,
        updated_at: nowIso
      });
      if (profileSyncError) {
        let authRollbackErrorMessage = null;
        try {
          const { error: rollbackAuthErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
            ban_duration: isUserCurrentlyBanned(previousBannedUntil) ? "876000h" : "none",
            user_metadata: existingMeta
          });
          if (rollbackAuthErr) {
            authRollbackErrorMessage = rollbackAuthErr.message || "Gagal memulihkan status Auth setelah gagal sync profil.";
          }
        } catch (err) {
          authRollbackErrorMessage = err?.message || "Pengecualian saat memulihkan status Auth setelah gagal sync profil.";
        }
        if (authRollbackErrorMessage) {
          console.error("[VISITOR_ARCHIVE_ROLLBACK_INCOMPLETE]", {
            targetId,
            message: authRollbackErrorMessage
          });
          return res.status(500).json({
            error: `Gagal memperbarui status arsip di tabel profiles (${profileSyncError.message}), dan rollback status Supabase Auth juga gagal (${authRollbackErrorMessage}). Status Auth & DB mungkin tidak konsisten.`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false
          });
        }
        return res.status(500).json({
          error: `Gagal memperbarui status arsip di tabel profiles (status Supabase Auth telah dipulihkan): ${profileSyncError.message}`,
          rollbackComplete: true
        });
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
  app2.post("/api/admin/visitors/:id/restore", async (req, res) => {
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
      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).maybeSingle();
      if (targetProfileError) {
        return res.status(500).json({
          error: `Gagal memeriksa profil pengunjung: ${targetProfileError.message}`
        });
      }
      if (!targetProfile) {
        return res.status(404).json({ error: "Akun pengunjung tidak ditemukan di database." });
      }
      const { data: authTargetData, error: authLookupError } = await supabaseAdmin.auth.admin.getUserById(targetId);
      if (authLookupError || !authTargetData?.user) {
        return res.status(404).json({
          error: "Akun autentikasi pengunjung tidak ditemukan di Supabase Auth."
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
        superAdminUids: resolvedSuperAdminUids
      });
      if (!evaluation.allowed) {
        return res.status(evaluation.statusCode).json({
          error: evaluation.error,
          code: evaluation.code
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const existingMeta = authTargetData.user.user_metadata || {};
      const previousBannedUntil = authTargetData.user.banned_until ?? null;
      if (resolvedSuperAdminUids.includes(targetId) || targetIsSuperAdmin || targetProfile.role === "super_admin") {
        return res.status(403).json({
          error: "Akun administrator / Super Admin tidak dikelola melalui menu pengunjung.",
          code: "SUPER_ADMIN_PROTECTED"
        });
      }
      const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
        ban_duration: "none",
        user_metadata: {
          ...existingMeta,
          is_active: true,
          archived_at: null,
          archived_by: null,
          restored_at: nowIso,
          restored_by: authCheck.adminProfile.id
        }
      });
      if (unbanError) {
        return res.status(500).json({
          error: `Gagal mengaktifkan kembali akun di Supabase Authentication: ${unbanError.message}`
        });
      }
      const { error: profileSyncError } = await syncProfileArchiveFields(supabaseAdmin, targetId, {
        is_active: true,
        archived_at: null,
        archived_by: null,
        updated_at: nowIso
      });
      if (profileSyncError) {
        let authRollbackErrorMessage = null;
        try {
          const { error: rollbackAuthErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
            ban_duration: isUserCurrentlyBanned(previousBannedUntil) ? "876000h" : "none",
            user_metadata: existingMeta
          });
          if (rollbackAuthErr) {
            authRollbackErrorMessage = rollbackAuthErr.message || "Gagal memulihkan status ban Auth setelah gagal sync profil.";
          }
        } catch (err) {
          authRollbackErrorMessage = err?.message || "Pengecualian saat memulihkan status ban Auth setelah gagal sync profil.";
        }
        if (authRollbackErrorMessage) {
          console.error("[VISITOR_RESTORE_ROLLBACK_INCOMPLETE]", {
            targetId,
            message: authRollbackErrorMessage
          });
          return res.status(500).json({
            error: `Gagal memperbarui status aktif di tabel profiles (${profileSyncError.message}), dan rollback status Supabase Auth juga gagal (${authRollbackErrorMessage}). Status Auth & DB mungkin tidak konsisten.`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false
          });
        }
        return res.status(500).json({
          error: `Gagal memperbarui status aktif di tabel profiles (status Supabase Auth telah dipulihkan): ${profileSyncError.message}`,
          rollbackComplete: true
        });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "restore_visitor",
          entity_type: "profiles",
          entity_id: targetId,
          details: JSON.stringify({
            full_name: targetProfile.full_name,
            username: targetProfile.username,
            restored_at: nowIso
          }),
          created_at: nowIso
        });
      } catch {
      }
      return res.json({
        success: true,
        mode: "restored",
        restoredUserId: targetId,
        restoredAt: nowIso,
        message: `Akun pengunjung "${targetProfile.full_name}" berhasil diaktifkan kembali dan dapat login seperti semula.`
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat mengaktifkan kembali akun pengunjung."
      });
    }
  });
  app2.post("/api/loans/:id/return", async (req, res) => {
    try {
      const loanId = String(req.params.id || "").trim();
      if (!isValidUuid(loanId)) {
        return res.status(400).json({
          error: "ID transaksi peminjaman tidak valid.",
          code: "INVALID_LOAN_ID"
        });
      }
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || "Konfigurasi autentikasi server belum lengkap."
        });
      }
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || "Konfigurasi admin server belum lengkap."
        });
      }
      const authCheck = await verifyAuthenticatedUser(req, supabaseAuth, supabaseAdmin);
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      const { data: loanRows, error: fetchLoanError } = await supabaseAdmin.from("loans").select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      ).eq("id", loanId).limit(2);
      if (fetchLoanError) {
        console.error("[RETURN_BOOK_FETCH_ERROR]", {
          loanId,
          actorId: actor.id,
          code: fetchLoanError.code,
          message: fetchLoanError.message
        });
        return res.status(500).json({
          error: formatBookReturnErrorMessage(fetchLoanError),
          code: fetchLoanError.code || "LOAN_FETCH_FAILED"
        });
      }
      if (!loanRows || loanRows.length === 0) {
        return res.status(404).json({
          error: "Data transaksi peminjaman tidak ditemukan.",
          code: "LOAN_NOT_FOUND"
        });
      }
      if (loanRows.length > 1) {
        console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
          query: "loans_select_by_pk",
          loanId,
          rowCount: loanRows.length
        });
        return res.status(409).json({
          error: "Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.",
          code: "DUPLICATE_LOAN_TRANSACTION"
        });
      }
      const existingLoan = loanRows[0];
      if (!isActorAdmin && existingLoan.user_id !== actor.id) {
        return res.status(403).json({
          error: "Anda tidak memiliki izin untuk mengembalikan transaksi peminjaman milik anggota lain.",
          code: "FORBIDDEN"
        });
      }
      const buildEnrichedLoan = async (loanRow) => {
        const [{ data: bookRows }, { data: profileRows }] = await Promise.all([
          supabaseAdmin.from("books").select("id, title, author, cover_path, file_path, file_type, total_copies, available_copies").eq("id", loanRow.book_id).limit(2),
          supabaseAdmin.from("profiles").select("id, full_name, username").eq("id", loanRow.user_id).limit(2)
        ]);
        if (bookRows && bookRows.length > 1) {
          console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
            query: "buildEnrichedLoan.books_by_id",
            loanId,
            bookId: loanRow.book_id,
            rowCount: bookRows.length
          });
        }
        if (profileRows && profileRows.length > 1) {
          console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
            query: "buildEnrichedLoan.profiles_by_id",
            loanId,
            userId: loanRow.user_id,
            rowCount: profileRows.length
          });
        }
        return {
          ...loanRow,
          book: bookRows?.[0] ?? void 0,
          profile: profileRows?.[0] ?? void 0
        };
      };
      const eligibility = evaluateLoanReturnEligibility(existingLoan.status);
      if (!eligibility.eligible) {
        if (eligibility.reason === "already_returned") {
          const enriched2 = await buildEnrichedLoan(existingLoan);
          return res.json({
            success: true,
            alreadyReturned: true,
            stockAdjusted: false,
            loan: enriched2,
            message: eligibility.message
          });
        }
        return res.status(409).json({
          error: eligibility.message,
          code: "INVALID_LOAN_STATUS",
          currentStatus: existingLoan.status
        });
      }
      const { data: beforeBookRows, error: beforeBookError } = await supabaseAdmin.from("books").select("id, title, author, cover_path, total_copies, available_copies").eq("id", existingLoan.book_id).limit(2);
      if (beforeBookError) {
        return res.status(500).json({
          error: `Gagal memeriksa data stok buku: ${beforeBookError.message}`,
          code: beforeBookError.code || "BOOK_FETCH_FAILED"
        });
      }
      if (beforeBookRows && beforeBookRows.length > 1) {
        console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
          query: "beforeBook.books_by_id",
          loanId,
          bookId: existingLoan.book_id,
          rowCount: beforeBookRows.length
        });
        return res.status(409).json({
          error: "Terdeteksi duplikasi data buku untuk transaksi ini. Hubungi administrator.",
          code: "DUPLICATE_BOOK_RECORD"
        });
      }
      const beforeBook = beforeBookRows?.[0] ?? null;
      const beforeAvailable = Number(beforeBook?.available_copies ?? 0);
      const totalCopies = Number(beforeBook?.total_copies ?? 0);
      const returnedAt = (/* @__PURE__ */ new Date()).toISOString();
      const { data: updatedRows, error: updateLoanError } = await supabaseAdmin.from("loans").update({
        status: "returned",
        returned_at: returnedAt,
        updated_at: returnedAt
      }).eq("id", loanId).in("status", ["approved", "borrowed"]).select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      );
      if (updateLoanError) {
        console.error("[RETURN_BOOK_UPDATE_ERROR]", {
          loanId,
          actorId: actor.id,
          code: updateLoanError.code,
          message: updateLoanError.message
        });
        return res.status(500).json({
          error: formatBookReturnErrorMessage(updateLoanError),
          code: updateLoanError.code || "LOAN_UPDATE_FAILED"
        });
      }
      if (!updatedRows || updatedRows.length === 0) {
        const { data: recheckRows } = await supabaseAdmin.from("loans").select(
          "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
        ).eq("id", loanId).limit(2);
        if (recheckRows && recheckRows.length > 1) {
          console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
            query: "recheck.loans_by_pk",
            loanId,
            rowCount: recheckRows.length
          });
          return res.status(409).json({
            error: "Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.",
            code: "DUPLICATE_LOAN_TRANSACTION"
          });
        }
        const latestLoan = recheckRows?.[0];
        if (latestLoan?.status === "returned") {
          const enriched2 = await buildEnrichedLoan(latestLoan);
          return res.json({
            success: true,
            alreadyReturned: true,
            stockAdjusted: false,
            loan: enriched2,
            message: "Buku untuk transaksi peminjaman ini sudah dikembalikan."
          });
        }
        return res.status(409).json({
          error: "Status transaksi peminjaman berubah sebelum pengembalian dikonfirmasi. Muat ulang halaman dan coba lagi.",
          code: "CONCURRENT_LOAN_MODIFICATION"
        });
      }
      if (updatedRows.length > 1) {
        console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
          query: "loans_update_by_pk",
          loanId,
          rowCount: updatedRows.length
        });
        return res.status(409).json({
          error: "Terdeteksi lebih dari satu baris transaksi saat pembaruan pengembalian. Hubungi administrator.",
          code: "DUPLICATE_LOAN_TRANSACTION"
        });
      }
      const updatedLoan = updatedRows[0];
      let stockAdjusted = false;
      let stockSource = "none";
      if (beforeBook) {
        const { data: afterBookRows, error: afterBookErr } = await supabaseAdmin.from("books").select("id, available_copies, total_copies").eq("id", existingLoan.book_id).limit(2);
        if (afterBookErr) {
          console.error("[RETURN_BOOK_AFTER_BOOK_FETCH_ERROR]", {
            loanId,
            bookId: existingLoan.book_id,
            code: afterBookErr.code,
            message: afterBookErr.message
          });
        }
        if (afterBookRows && afterBookRows.length > 1) {
          console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
            query: "afterBook.books_by_id",
            loanId,
            bookId: existingLoan.book_id,
            rowCount: afterBookRows.length
          });
          return res.status(409).json({
            error: "Terdeteksi duplikasi data buku saat sinkronisasi stok. Hubungi administrator.",
            code: "DUPLICATE_BOOK_RECORD"
          });
        }
        const afterBook = afterBookRows?.[0] ?? beforeBook;
        const stockPlan = computeBookStockAfterReturn({
          beforeAvailable,
          afterAvailable: Number(afterBook.available_copies ?? beforeAvailable),
          totalCopies: Number(afterBook.total_copies ?? totalCopies)
        });
        stockSource = stockPlan.incrementedBy;
        if (stockPlan.needsUpdate) {
          const { data: updatedBookRows, error: stockUpdateErr } = await supabaseAdmin.from("books").update({
            available_copies: stockPlan.targetAvailable,
            updated_at: returnedAt
          }).eq("id", existingLoan.book_id).eq("available_copies", stockPlan.safeAfter).select("id, available_copies");
          if (stockUpdateErr) {
            console.error("[RETURN_BOOK_STOCK_SYNC_ERROR]", {
              loanId,
              bookId: existingLoan.book_id,
              message: stockUpdateErr.message
            });
          } else {
            if (updatedBookRows && updatedBookRows.length > 1) {
              console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
                query: "books_stock_update_by_id",
                loanId,
                bookId: existingLoan.book_id,
                rowCount: updatedBookRows.length
              });
            }
            stockAdjusted = stockPlan.incrementedBy === "application";
          }
        } else if (stockPlan.incrementedBy === "trigger") {
          stockAdjusted = true;
        }
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: actor.id,
          action: "return_loan",
          entity_type: "loans",
          entity_id: loanId,
          details: JSON.stringify({
            book_id: existingLoan.book_id,
            returned_at: returnedAt,
            stock_source: stockSource
          }),
          created_at: returnedAt
        });
      } catch {
      }
      console.info("[RETURN_BOOK_QUERY_TRACE]", {
        loanId,
        bookId: existingLoan.book_id,
        previousStatus: existingLoan.status,
        newStatus: updatedLoan.status,
        loanRowsMatched: loanRows.length,
        updatedLoanRows: updatedRows.length,
        stockSource,
        stockAdjusted
      });
      const enriched = await buildEnrichedLoan(updatedLoan);
      return res.json({
        success: true,
        alreadyReturned: false,
        stockAdjusted,
        stockSource,
        loan: enriched
      });
    } catch (err) {
      console.error("[RETURN_BOOK_ENDPOINT_ERROR]", {
        loanId: req.params?.id,
        message: err?.message
      });
      return res.status(500).json({
        error: formatBookReturnErrorMessage(err),
        code: "INTERNAL_RETURN_ERROR"
      });
    }
  });
  app2.post("/api/loans/return-error-log", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      if (!authHeader.startsWith("Bearer ") || !authHeader.slice("Bearer ".length).trim()) {
        return res.status(401).json({
          error: "Autentikasi diperlukan untuk mencatat log teknis pengembalian."
        });
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      if (!supabaseAuth) {
        return res.status(500).json({
          error: authClientError || "Konfigurasi autentikasi server belum lengkap."
        });
      }
      const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !authData?.user) {
        return res.status(401).json({
          error: "Sesi pengguna tidak valid."
        });
      }
      const body = req.body || {};
      const rawLoanId = typeof body.loanId === "string" ? body.loanId.trim().slice(0, 64) : "";
      const rawCode = typeof body.code === "string" ? body.code.trim().slice(0, 64) : void 0;
      const rawMessage = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "Unknown error";
      const rawDetails = typeof body.details === "string" ? body.details.trim().slice(0, 500) : void 0;
      console.error("[RETURN_BOOK_SERVER_LOG]", {
        actorId: authData.user.id,
        loanId: isValidUuid(rawLoanId) ? rawLoanId : rawLoanId || void 0,
        code: rawCode,
        message: rawMessage,
        details: rawDetails,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return res.json({ logged: true });
    } catch (err) {
      console.error("[RETURN_BOOK_SERVER_LOG_FALLBACK]", {
        message: err?.message || "Gagal mencatat error teknis pengembalian."
      });
      return res.status(500).json({ logged: false });
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
