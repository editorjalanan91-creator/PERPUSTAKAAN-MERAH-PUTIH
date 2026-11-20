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
function computeBookStockAfterApprove(input) {
  const safeTotal = Math.max(0, Math.floor(Number(input.totalCopies) || 0));
  const safeBefore = Math.max(0, Math.floor(Number(input.beforeAvailable) || 0));
  const safeAfter = Math.max(0, Math.floor(Number(input.afterAvailable) || 0));
  if (safeAfter < safeBefore) {
    const clampedTarget = safeTotal > 0 ? Math.min(safeTotal, Math.max(0, safeAfter)) : Math.max(0, safeAfter);
    return {
      targetAvailable: clampedTarget,
      safeBefore,
      safeAfter,
      safeTotal,
      needsUpdate: clampedTarget !== safeAfter,
      decrementedBy: "trigger"
    };
  }
  const decremented = Math.max(0, safeBefore - 1);
  const targetAvailable = safeTotal > 0 ? Math.min(safeTotal, decremented) : decremented;
  const needsUpdate = targetAvailable !== safeAfter;
  return {
    targetAvailable,
    safeBefore,
    safeAfter,
    safeTotal,
    needsUpdate,
    decrementedBy: needsUpdate ? "application" : "floored_at_zero"
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
    serviceRoleKey: "",
    hasSupabaseUrl: true,
    hasServiceRoleKey: true,
    isServiceRoleKeyValid: false,
    keyStatus: "unrecognized_format",
    hasUrlMismatch,
    error: "Format SUPABASE_SERVICE_ROLE_KEY di server tidak dikenali. Pastikan menggunakan Secret Key (sb_secret_...) atau Service Role JWT yang valid dari Supabase Dashboard."
  };
}
function isValidHttpUrlStrict(raw) {
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(raw) && !raw.includes("your-project-ref") && !raw.includes("placeholder") && !raw.includes("MY_APP_URL");
}
function inspectVercelEnvChecklist(env = process.env) {
  const serverInspection = inspectServerSupabaseEnv(env);
  const rawServerUrl = sanitizeEnv(env.SUPABASE_URL).replace(/\/+$/, "");
  const rawViteUrl = sanitizeEnv(env.VITE_SUPABASE_URL).replace(/\/+$/, "");
  const rawPubKey = sanitizeEnv(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);
  const rawAppUrl = sanitizeEnv(env.VITE_APP_URL).replace(/\/+$/, "");
  const rawAdminEmail = sanitizeEnv(env.VITE_ADMIN_EMAIL);
  const superAdminUids = getSuperAdminUids(env);
  const hasServerSupabaseUrl = Boolean(rawServerUrl && isValidHttpUrlStrict(rawServerUrl));
  const hasViteSupabaseUrl = Boolean(rawViteUrl && isValidHttpUrlStrict(rawViteUrl));
  let supabaseUrlHost = null;
  const candidateUrl = rawServerUrl || rawViteUrl;
  if (candidateUrl && isValidHttpUrlStrict(candidateUrl)) {
    try {
      supabaseUrlHost = new URL(candidateUrl).hostname;
    } catch {
      supabaseUrlHost = null;
    }
  }
  let vitePublishableKeyStatus = "missing";
  if (rawPubKey) {
    if (rawPubKey.startsWith("sb_secret_") || decodeJwtRoleClaim(rawPubKey) === "service_role") {
      vitePublishableKeyStatus = "invalid_secret_key_exposed";
    } else if (rawPubKey.length <= 20 || rawPubKey.includes("your-anon-or-publishable-key") || rawPubKey.includes("your-supabase-publishable")) {
      vitePublishableKeyStatus = "invalid_placeholder";
    } else {
      vitePublishableKeyStatus = "valid_publishable_or_anon";
    }
  }
  const hasVitePublishableKey = Boolean(rawPubKey);
  const isVitePublishableKeySafe = vitePublishableKeyStatus === "valid_publishable_or_anon";
  const hasViteAppUrl = Boolean(rawAppUrl);
  const viteAppUrlValid = Boolean(rawAppUrl && isValidHttpUrlStrict(rawAppUrl));
  const hasViteAdminEmail = Boolean(
    rawAdminEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawAdminEmail)
  );
  const allRequiredPresentAndValid = hasServerSupabaseUrl && hasViteSupabaseUrl && !serverInspection.hasUrlMismatch && isVitePublishableKeySafe && viteAppUrlValid && serverInspection.isServiceRoleKeyValid;
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
    allRequiredPresentAndValid
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
async function probeAdminReturnTablesAccess(getAdminClient = () => defaultCreateSupabaseAdminClient(), envInspection = inspectServerSupabaseEnv()) {
  const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      statusCode: 500,
      profilesOk: false,
      loansOk: false,
      booksOk: false,
      keyStatus: envInspection.keyStatus,
      errorCode: "ADMIN_CLIENT_NOT_CONFIGURED",
      errorMessage: adminClientError || "Konfigurasi Admin Supabase tidak lengkap."
    };
  }
  const [profilesRes, loansRes, booksRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("id").limit(0),
    supabaseAdmin.from("loans").select("id").limit(0),
    supabaseAdmin.from("books").select("id").limit(0)
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
      errorCode: firstErr.code || "TABLE_ACCESS_ERROR",
      errorMessage: firstErr.message
    };
  }
  return {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    loansOk: true,
    booksOk: true,
    keyStatus: envInspection.keyStatus
  };
}
async function probeAdminStorageAndCatalogAccess(getAdminClient = () => defaultCreateSupabaseAdminClient()) {
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
      errorMessage: adminClientError || "Konfigurasi Admin Supabase tidak lengkap."
    };
  }
  const [catRes, logRes] = await Promise.all([
    supabaseAdmin.from("categories").select("id").limit(0),
    supabaseAdmin.from("activity_logs").select("id").limit(0)
  ]);
  let storageOk = false;
  let bookCoversBucketExists = false;
  let bookCoversPublic = null;
  let bookFilesBucketExists = false;
  let bookFilesPublic = null;
  let storageErrorMsg;
  if (typeof supabaseAdmin?.storage?.listBuckets === "function") {
    const { data: buckets, error: bucketsError } = await supabaseAdmin.storage.listBuckets();
    if (bucketsError) {
      storageErrorMsg = bucketsError.message;
    } else if (Array.isArray(buckets)) {
      storageOk = true;
      const coversBucket = buckets.find((b) => b?.id === "book-covers" || b?.name === "book-covers");
      const filesBucket = buckets.find((b) => b?.id === "book-files" || b?.name === "book-files");
      bookCoversBucketExists = Boolean(coversBucket);
      bookCoversPublic = coversBucket ? Boolean(coversBucket.public) : null;
      bookFilesBucketExists = Boolean(filesBucket);
      bookFilesPublic = filesBucket ? Boolean(filesBucket.public) : null;
    }
  } else {
    storageErrorMsg = "API listBuckets belum tersedia pada Storage client.";
  }
  const categoriesOk = !catRes.error;
  const activityLogsOk = !logRes.error;
  const firstErrMsg = catRes.error?.message || logRes.error?.message || storageErrorMsg;
  return {
    ok: categoriesOk && activityLogsOk && storageOk,
    categoriesOk,
    ...catRes.error?.code ? { categoriesErrorCode: catRes.error.code } : {},
    activityLogsOk,
    storageOk,
    bookCoversBucketExists,
    bookCoversPublic,
    bookFilesBucketExists,
    bookFilesPublic,
    ...firstErrMsg ? { errorMessage: firstErrMsg } : {}
  };
}
function defaultCreateSupabaseAnonProbeClient(env = process.env) {
  const inspection = inspectServerSupabaseEnv(env);
  if (!inspection.hasSupabaseUrl || inspection.hasUrlMismatch) {
    return { client: null, error: inspection.error };
  }
  const anonKey = sanitizeEnv(
    env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  );
  if (!anonKey || anonKey === inspection.serviceRoleKey || anonKey.startsWith("sb_secret_") || decodeJwtRoleClaim(anonKey) === "service_role") {
    return { client: null, error: "Publishable/Anon key tidak tersedia untuk probe anon." };
  }
  const client = createClient(inspection.url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  return { client };
}
async function probeDatabaseMigrations(getAdminClient = () => defaultCreateSupabaseAdminClient(), getAnonProbeClient = () => defaultCreateSupabaseAnonProbeClient()) {
  const hasDirectDbUrl = Boolean(
    process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim()
  );
  const hasSupabaseAccessToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN?.trim());
  const { client: supabaseAdmin } = getAdminClient();
  const { client: supabaseAnon } = getAnonProbeClient();
  if (!supabaseAdmin) {
    return {
      profilesArchiveColumnsOk: false,
      profilesArchiveColumnsError: "ADMIN_CLIENT_NOT_CONFIGURED",
      hasUserLoanRpcOk: null,
      isAdminRpcOk: null,
      anonLoansDenied: null,
      anonProfilesDenied: null,
      anonActivityLogsDenied: null,
      anonBooksReadable: null,
      anonCategoriesReadable: null,
      hasDirectDbUrl,
      hasSupabaseAccessToken
    };
  }
  const colRes = await supabaseAdmin.from("profiles").select("is_active, archived_at, archived_by, is_super_admin").limit(0);
  let hasUserLoanRpcOk = null;
  let hasUserLoanRpcError;
  let isAdminRpcOk = null;
  let isAdminRpcError;
  if (typeof supabaseAdmin.rpc === "function") {
    try {
      const [loanRpcRes, adminRpcRes] = await Promise.all([
        supabaseAdmin.rpc("has_user_loan_for_book", {
          p_book_id: "00000000-0000-0000-0000-000000000000"
        }),
        supabaseAdmin.rpc("is_admin")
      ]);
      hasUserLoanRpcOk = !loanRpcRes?.error;
      if (loanRpcRes?.error) {
        hasUserLoanRpcError = loanRpcRes.error.code || loanRpcRes.error.message;
      }
      isAdminRpcOk = !adminRpcRes?.error;
      if (adminRpcRes?.error) {
        isAdminRpcError = adminRpcRes.error.code || adminRpcRes.error.message;
      }
    } catch (rpcErr) {
      hasUserLoanRpcOk = false;
      hasUserLoanRpcError = rpcErr?.message || "RPC_PROBE_ERROR";
    }
  }
  let anonLoansDenied = null;
  let anonLoansErrorCode;
  let anonProfilesDenied = null;
  let anonProfilesErrorCode;
  let anonActivityLogsDenied = null;
  let anonActivityLogsErrorCode;
  let anonBooksReadable = null;
  let anonBooksErrorCode;
  let anonCategoriesReadable = null;
  let anonCategoriesErrorCode;
  if (supabaseAnon && supabaseAnon !== supabaseAdmin && typeof supabaseAnon.from === "function") {
    try {
      const [anonLoans, anonProfiles, anonLogs, anonBooks, anonCats] = await Promise.all([
        supabaseAnon.from("loans").select("id").limit(0),
        supabaseAnon.from("profiles").select("id").limit(0),
        supabaseAnon.from("activity_logs").select("id").limit(0),
        supabaseAnon.from("books").select("id").limit(0),
        supabaseAnon.from("categories").select("id").limit(0)
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
    } catch (anonErr) {
      anonLoansErrorCode = anonErr?.message || "ANON_PROBE_ERROR";
    }
  }
  return {
    profilesArchiveColumnsOk: !colRes.error,
    ...colRes.error ? { profilesArchiveColumnsError: colRes.error.code || colRes.error.message } : {},
    hasUserLoanRpcOk,
    ...hasUserLoanRpcError ? { hasUserLoanRpcError } : {},
    isAdminRpcOk,
    ...isAdminRpcError ? { isAdminRpcError } : {},
    anonLoansDenied,
    ...anonLoansErrorCode ? { anonLoansErrorCode } : {},
    anonProfilesDenied,
    ...anonProfilesErrorCode ? { anonProfilesErrorCode } : {},
    anonActivityLogsDenied,
    ...anonActivityLogsErrorCode ? { anonActivityLogsErrorCode } : {},
    anonBooksReadable,
    ...anonBooksErrorCode ? { anonBooksErrorCode } : {},
    anonCategoriesReadable,
    ...anonCategoriesErrorCode ? { anonCategoriesErrorCode } : {},
    hasDirectDbUrl,
    hasSupabaseAccessToken
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
async function verifyAuthenticatedUser(req, supabaseAuth, supabaseAdmin, actionLabel = "mengonfirmasi pengembalian buku") {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: `Autentikasi diperlukan untuk ${actionLabel}.`
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
function isDbPermissionDeniedError(err) {
  if (!err) return false;
  return String(err.code || "").trim() === "42501" || String(err.message || "").toLowerCase().includes("permission denied");
}
function isMissingRpcFunctionError(err, functionName) {
  if (!err) return false;
  const code = String(err.code || "").trim().toUpperCase();
  const msg = String(err.message || "").toLowerCase();
  if (code === "PGRST202" || code === "42883") return true;
  return msg.includes(functionName.toLowerCase()) && (msg.includes("could not find the function") || msg.includes("does not exist") || msg.includes("schema cache"));
}
async function countVisitorLoans(supabaseAdmin, targetId) {
  const { count: totalCount, error: totalErr } = await supabaseAdmin.from("loans").select("id", { count: "exact", head: true }).eq("user_id", targetId);
  if (totalErr) {
    const permDenied = isDbPermissionDeniedError(totalErr);
    if (permDenied) {
      console.error("[VISITOR_LOANS_COUNT_PERMISSION_DENIED]", {
        targetId,
        table: "loans",
        code: totalErr.code || "42501",
        keyStatus: inspectServerSupabaseEnv().keyStatus
      });
    }
    return {
      totalLoansCount: 0,
      activeLoansCount: 0,
      error: permDenied ? `Izin database server untuk memeriksa riwayat peminjaman (loans) belum aktif (kode 42501): ${totalErr.message}` : `Gagal memeriksa riwayat peminjaman pengunjung: ${totalErr.message}`,
      code: permDenied ? "DB_PERMISSION_DENIED" : totalErr.code || "LOANS_CHECK_FAILED"
    };
  }
  const { count: activeCount, error: activeErr } = await supabaseAdmin.from("loans").select("id", { count: "exact", head: true }).eq("user_id", targetId).in("status", ["pending", "approved", "borrowed"]);
  if (activeErr) {
    const permDenied = isDbPermissionDeniedError(activeErr);
    if (permDenied) {
      console.error("[VISITOR_LOANS_COUNT_PERMISSION_DENIED]", {
        targetId,
        table: "loans",
        code: activeErr.code || "42501",
        keyStatus: inspectServerSupabaseEnv().keyStatus
      });
    }
    return {
      totalLoansCount: totalCount ?? 0,
      activeLoansCount: 0,
      error: permDenied ? `Izin database server untuk memeriksa pinjaman aktif (loans) belum aktif (kode 42501): ${activeErr.message}` : `Gagal memeriksa pinjaman aktif pengunjung: ${activeErr.message}`,
      code: permDenied ? "DB_PERMISSION_DENIED" : activeErr.code || "LOANS_CHECK_FAILED"
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
  app2.set("etag", false);
  const getAdminClient = options.getAdminClient ?? defaultCreateSupabaseAdminClient;
  const getAuthClient = options.getAuthClient ?? (options.getAdminClient ? options.getAdminClient : defaultCreateSupabaseAuthClient);
  const getAnonProbeClient = options.getAnonProbeClient ?? (options.getAdminClient || options.getAuthClient ? () => ({ client: null }) : () => defaultCreateSupabaseAnonProbeClient());
  const resolvedSuperAdminUids = options.superAdminUids ?? getSuperAdminUids();
  const bookStockLocks = /* @__PURE__ */ new Map();
  async function withBookStockLock(bookId, fn) {
    const key = String(bookId || "").trim();
    if (!key) return fn();
    const prev = bookStockLocks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = prev.then(() => gate, () => gate);
    bookStockLocks.set(key, queued);
    try {
      await prev.catch(() => void 0);
      return await fn();
    } finally {
      release();
      if (bookStockLocks.get(key) === queued) {
        bookStockLocks.delete(key);
      }
    }
  }
  app2.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.removeHeader("ETag");
    next();
  });
  app2.use(express.json());
  app2.use((err, _req, res, next) => {
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({
        error: "Format JSON pada isi permintaan tidak valid.",
        code: "INVALID_JSON"
      });
    }
    return next(err);
  });
  app2.get("/api/health", async (req, res) => {
    const envInspection = inspectServerSupabaseEnv();
    const envAudit = inspectVercelEnvChecklist();
    const probeParam = String(req.query.probe || "").trim().toLowerCase();
    const shouldProbeProfiles = probeParam === "profiles";
    const shouldProbeReturn = probeParam === "return" || probeParam === "all";
    const shouldProbeStorage = probeParam === "storage" || probeParam === "all";
    const shouldProbeMigrations = probeParam === "migrations" || probeParam === "all";
    const profilesProbe = shouldProbeProfiles ? await probeAdminProfilesAccess(() => getAdminClient()) : void 0;
    const returnTablesProbe = shouldProbeReturn ? await probeAdminReturnTablesAccess(() => getAdminClient(), envInspection) : void 0;
    const catalogAndStorageProbe = shouldProbeStorage ? await probeAdminStorageAndCatalogAccess(() => getAdminClient()) : void 0;
    const migrationProbe = shouldProbeMigrations ? await probeDatabaseMigrations(() => getAdminClient(), () => getAnonProbeClient()) : void 0;
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
      envAudit,
      ...profilesProbe ? { profilesProbe } : {},
      ...returnTablesProbe ? { returnTablesProbe } : {},
      ...catalogAndStorageProbe ? { catalogAndStorageProbe } : {},
      ...migrationProbe ? { migrationProbe } : {},
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
        const perPage = 1e3;
        const maxPages = 20;
        for (let page = 1; page <= maxPages; page += 1) {
          const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
          });
          if (listError || !listData?.users || listData.users.length === 0) {
            break;
          }
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
          if (listData.users.length < perPage) {
            break;
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
      const { data: authTarget, error: authTargetErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
      if (authTargetErr) {
        const lowerAuthErr = String(authTargetErr.message || "").toLowerCase();
        const isNotFound = authTargetErr?.status === 404 || lowerAuthErr.includes("not found") || lowerAuthErr.includes("no user");
        if (!isNotFound) {
          return res.status(500).json({
            error: `Gagal memverifikasi akun target pada Supabase Authentication sebelum penghapusan: ${authTargetErr.message}`,
            code: "AUTH_LOOKUP_FAILED"
          });
        }
      } else if (authTarget?.user) {
        authTargetUser = authTarget.user;
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
        return res.status(500).json({
          error: loanStats.error,
          code: loanStats.code || "LOANS_CHECK_FAILED"
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
      const { data: logsSnapshot, error: logsSnapErr } = await supabaseAdmin.from("activity_logs").select("*").eq("actor_id", targetId);
      if (logsSnapErr) {
        const permDenied = isDbPermissionDeniedError(logsSnapErr);
        console.error("[VISITOR_DELETE_SNAPSHOT_ERROR]", {
          targetId,
          table: "activity_logs",
          code: logsSnapErr.code,
          keyStatus: inspectServerSupabaseEnv().keyStatus
        });
        return res.status(500).json({
          error: `Gagal mengambil snapshot activity_logs sebelum penghapusan: ${logsSnapErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : "SNAPSHOT_FAILED"
        });
      }
      const { data: booksSnapshot, error: booksSnapErr } = await supabaseAdmin.from("books").select("id").eq("created_by", targetId);
      if (booksSnapErr) {
        const permDenied = isDbPermissionDeniedError(booksSnapErr);
        console.error("[VISITOR_DELETE_SNAPSHOT_ERROR]", {
          targetId,
          table: "books",
          code: booksSnapErr.code,
          keyStatus: inspectServerSupabaseEnv().keyStatus
        });
        return res.status(500).json({
          error: `Gagal mengambil snapshot books sebelum penghapusan: ${booksSnapErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : "SNAPSHOT_FAILED"
        });
      }
      const bookIdsToRestore = Array.isArray(booksSnapshot) ? booksSnapshot.map((b) => b.id).filter(Boolean) : [];
      const logRowsToRestore = Array.isArray(logsSnapshot) ? logsSnapshot : [];
      const logIdsToRestore = logRowsToRestore.map((l) => l.id).filter(Boolean);
      let logsClearMode = "none";
      let booksCleared = false;
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
        if (logsClearMode === "nullified") {
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
        } else if (logsClearMode === "deleted" && logRowsToRestore.length > 0) {
          for (const logRow of logRowsToRestore) {
            try {
              const { error: reinsertLogErr } = await supabaseAdmin.from("activity_logs").insert(logRow);
              if (reinsertLogErr) {
                failures.push({
                  step: "restore_activity_log_row",
                  table: "activity_logs",
                  recordId: String(logRow?.id || targetId),
                  message: reinsertLogErr.message || "Gagal memulihkan baris activity_logs setelah gagal penghapusan."
                });
              }
            } catch (err) {
              failures.push({
                step: "restore_activity_log_row",
                table: "activity_logs",
                recordId: String(logRow?.id || targetId),
                message: err?.message || "Pengecualian saat memulihkan baris activity_logs setelah gagal penghapusan."
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
      if (logRowsToRestore.length > 0) {
        const { error: clearLogsErr } = await supabaseAdmin.from("activity_logs").update({ actor_id: null }).eq("actor_id", targetId);
        if (clearLogsErr) {
          const logErrCode = String(clearLogsErr.code || "").trim();
          const logErrMsg = String(clearLogsErr.message || "").toLowerCase();
          const isNotNullViolation = logErrCode === "23502" || logErrMsg.includes('null value in column "actor_id"') || logErrMsg.includes("violates not-null constraint");
          if (isNotNullViolation) {
            const { error: deleteLogsErr } = await supabaseAdmin.from("activity_logs").delete().eq("actor_id", targetId);
            if (deleteLogsErr) {
              return res.status(500).json({
                error: `Gagal membersihkan referensi actor_id pada activity_logs sebelum penghapusan: ${deleteLogsErr.message}`
              });
            }
            logsClearMode = "deleted";
          } else {
            return res.status(500).json({
              error: `Gagal melepaskan referensi actor_id pada activity_logs sebelum penghapusan (pastikan migrasi ON DELETE SET NULL sudah dijalankan): ${clearLogsErr.message}`
            });
          }
        } else {
          logsClearMode = "nullified";
        }
      }
      if (bookIdsToRestore.length > 0) {
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
      }
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
          const lowerProfileErr = (deleteProfileError.message || "").toLowerCase();
          if (lowerProfileErr.includes("super admin")) {
            return res.status(403).json({
              error: deleteProfileError.message,
              code: "SUPER_ADMIN_PROTECTED",
              rollbackComplete: true
            });
          }
          if (String(deleteProfileError.code || "").trim() === "23503" || lowerProfileErr.includes("foreign key") || lowerProfileErr.includes("still referenced")) {
            return res.status(409).json({
              error: "Akun pengunjung tidak dapat dihapus permanen karena masih memiliki data terkait di tabel lain (perubahan referensi telah dibatalkan). Gunakan fitur Arsipkan Pengunjung agar histori tetap aman.",
              code: "VISITOR_DELETE_CONFLICT",
              rollbackComplete: true
            });
          }
          if (isDbPermissionDeniedError(deleteProfileError)) {
            return res.status(500).json({
              error: `Izin database server untuk menghapus baris public.profiles belum aktif (kode 42501, seluruh referensi telah dipulihkan): ${deleteProfileError.message}`,
              code: "DB_PERMISSION_DENIED",
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
  const handleArchiveVisitorRequest = async (req, res) => {
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
  };
  const handleRestoreVisitorRequest = async (req, res) => {
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
  };
  const handleCreateVisitorRequest = async (req, res) => {
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
      const body = req.body || {};
      const cleanFullName = String(body.full_name ?? body.fullName ?? "").trim();
      const cleanUsername = String(body.username ?? "").trim();
      const cleanEmail = String(body.email ?? "").trim().toLowerCase();
      const cleanPassword = String(body.password ?? "");
      if (cleanFullName.length < 3) {
        return res.status(400).json({
          error: "Nama lengkap pengunjung minimal 3 karakter.",
          code: "INVALID_FULL_NAME"
        });
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({
          error: "Username harus 3-20 karakter alfanumerik (huruf, angka, garis bawah).",
          code: "INVALID_USERNAME"
        });
      }
      const lowerUsername = cleanUsername.toLowerCase();
      if (lowerUsername === "admin" || lowerUsername === "super_admin" || lowerUsername === "superadmin") {
        return res.status(400).json({
          error: "Username tersebut dicadangkan untuk akun sistem.",
          code: "RESERVED_USERNAME"
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({
          error: "Format alamat email pengunjung tidak valid.",
          code: "INVALID_EMAIL"
        });
      }
      if (cleanPassword.length < 6) {
        return res.status(400).json({
          error: "Kata sandi awal pengunjung minimal 6 karakter.",
          code: "INVALID_PASSWORD"
        });
      }
      const { data: existingUsernames, error: usernameCheckErr } = await supabaseAdmin.from("profiles").select("id, username").ilike("username", cleanUsername).limit(1);
      if (usernameCheckErr) {
        return res.status(500).json({
          error: `Gagal memverifikasi ketersediaan username: ${usernameCheckErr.message}`
        });
      }
      if (existingUsernames && existingUsernames.length > 0) {
        return res.status(409).json({
          error: `Username "@${cleanUsername}" sudah digunakan oleh anggota lain.`,
          code: "USERNAME_TAKEN"
        });
      }
      const { data: createdAuthData, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: {
          full_name: cleanFullName,
          username: cleanUsername,
          role: "visitor",
          is_active: true
        }
      });
      if (createAuthErr || !createdAuthData?.user?.id) {
        const msg = createAuthErr?.message || "Gagal membuat akun di Supabase Authentication.";
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes("already registered") || lowerMsg.includes("already exists")) {
          return res.status(409).json({
            error: `Alamat email "${cleanEmail}" sudah terdaftar.`,
            code: "EMAIL_TAKEN"
          });
        }
        return res.status(500).json({
          error: `Gagal membuat akun pengunjung di Supabase Authentication: ${msg}`
        });
      }
      const newUserId = createdAuthData.user.id;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { data: triggerProfile } = await supabaseAdmin.from("profiles").select("*").eq("id", newUserId).maybeSingle();
      let savedProfile = null;
      let profileSyncError = null;
      if (triggerProfile) {
        const updateFull = await supabaseAdmin.from("profiles").update({
          full_name: cleanFullName,
          username: cleanUsername,
          role: "visitor",
          is_active: true,
          archived_at: null,
          archived_by: null,
          updated_at: nowIso
        }).eq("id", newUserId).select("*");
        if (updateFull.error && isMissingColumnError(updateFull.error)) {
          const updateBasic = await supabaseAdmin.from("profiles").update({
            full_name: cleanFullName,
            username: cleanUsername,
            role: "visitor",
            updated_at: nowIso
          }).eq("id", newUserId).select("*");
          savedProfile = updateBasic.data?.[0] ?? null;
          profileSyncError = updateBasic.error;
        } else {
          savedProfile = updateFull.data?.[0] ?? null;
          profileSyncError = updateFull.error;
        }
      } else {
        const insertFull = await supabaseAdmin.from("profiles").insert({
          id: newUserId,
          full_name: cleanFullName,
          username: cleanUsername,
          role: "visitor",
          is_active: true,
          archived_at: null,
          archived_by: null,
          created_at: nowIso,
          updated_at: nowIso
        }).select("*");
        if (insertFull.error && isMissingColumnError(insertFull.error)) {
          const insertBasic = await supabaseAdmin.from("profiles").insert({
            id: newUserId,
            full_name: cleanFullName,
            username: cleanUsername,
            role: "visitor",
            created_at: nowIso,
            updated_at: nowIso
          }).select("*");
          savedProfile = insertBasic.data?.[0] ?? null;
          profileSyncError = insertBasic.error;
        } else {
          savedProfile = insertFull.data?.[0] ?? null;
          profileSyncError = insertFull.error;
        }
      }
      if (profileSyncError) {
        let authCleanupError = null;
        try {
          const { error: cleanupErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
          if (cleanupErr) {
            authCleanupError = cleanupErr.message || "Gagal menghapus akun Auth sementara.";
          }
        } catch (err) {
          authCleanupError = err?.message || "Pengecualian saat membatalkan akun Auth sementara.";
        }
        if (authCleanupError) {
          console.error("[VISITOR_CREATE_ROLLBACK_INCOMPLETE]", {
            newUserId,
            message: authCleanupError
          });
          return res.status(500).json({
            error: `Gagal menyimpan profil pengunjung (${profileSyncError.message}), dan pembersihan akun Auth sementara gagal (${authCleanupError}).`,
            code: "ROLLBACK_INCOMPLETE",
            rollbackComplete: false
          });
        }
        return res.status(500).json({
          error: `Gagal menyimpan profil pengunjung ke database (akun Auth sementara dibatalkan): ${profileSyncError.message}`,
          rollbackComplete: true
        });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "create_visitor",
          entity_type: "profiles",
          entity_id: newUserId,
          details: JSON.stringify({
            full_name: cleanFullName,
            username: cleanUsername,
            email: cleanEmail
          }),
          created_at: nowIso
        });
      } catch {
      }
      return res.status(201).json({
        success: true,
        visitor: {
          ...savedProfile || {
            id: newUserId,
            full_name: cleanFullName,
            username: cleanUsername,
            role: "visitor",
            is_active: true,
            archived_at: null,
            created_at: nowIso,
            updated_at: nowIso
          },
          email: createdAuthData.user.email || cleanEmail,
          is_active: true,
          archived_at: null
        },
        message: `Akun pengunjung "${cleanFullName}" berhasil dibuat dan siap digunakan.`
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat menambahkan akun pengunjung."
      });
    }
  };
  const handleUpdateVisitorRequest = async (req, res) => {
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
      if (targetId === authCheck.adminProfile.id) {
        return res.status(400).json({
          error: "Gunakan halaman profil pribadi untuk mengubah data akun Anda sendiri.",
          code: "SELF_EDIT_FORBIDDEN"
        });
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
      let authTargetUser = null;
      try {
        const { data: authTargetData, error: authTargetErr } = await supabaseAdmin.auth.admin.getUserById(targetId);
        if (!authTargetErr && authTargetData?.user) {
          authTargetUser = authTargetData.user;
        }
      } catch {
      }
      const targetIsSuperAdmin = Boolean(
        targetProfile.is_super_admin === true || targetProfile.role === "super_admin" || resolvedSuperAdminUids.includes(targetId) || isTargetAuthSuperAdmin(authTargetUser)
      );
      if (targetIsSuperAdmin) {
        return res.status(403).json({
          error: "Akun Super Admin dilindungi oleh sistem dan tidak dapat diubah melalui menu pengunjung.",
          code: "SUPER_ADMIN_PROTECTED"
        });
      }
      if (targetProfile.role === "admin") {
        return res.status(403).json({
          error: "Akun administrator tidak dapat diubah melalui menu daftar pengunjung.",
          code: "ADMIN_EDIT_FORBIDDEN"
        });
      }
      const body = req.body || {};
      const hasFullName = body.full_name !== void 0 || body.fullName !== void 0;
      const hasUsername = body.username !== void 0;
      if (!hasFullName && !hasUsername) {
        return res.status(400).json({
          error: "Minimal isi perubahan nama lengkap atau username pengunjung.",
          code: "NO_FIELDS_TO_UPDATE"
        });
      }
      const nextFullName = hasFullName ? String(body.full_name ?? body.fullName ?? "").trim() : String(targetProfile.full_name || "").trim();
      const nextUsername = hasUsername ? String(body.username ?? "").trim() : String(targetProfile.username || "").trim();
      if (nextFullName.length < 3) {
        return res.status(400).json({
          error: "Nama lengkap pengunjung minimal 3 karakter.",
          code: "INVALID_FULL_NAME"
        });
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(nextUsername)) {
        return res.status(400).json({
          error: "Username harus 3-20 karakter alfanumerik (huruf, angka, garis bawah).",
          code: "INVALID_USERNAME"
        });
      }
      const lowerUsername = nextUsername.toLowerCase();
      if (lowerUsername === "admin" || lowerUsername === "super_admin" || lowerUsername === "superadmin") {
        return res.status(400).json({
          error: "Username tersebut dicadangkan untuk akun sistem.",
          code: "RESERVED_USERNAME"
        });
      }
      if (hasUsername && nextUsername.toLowerCase() !== String(targetProfile.username || "").toLowerCase()) {
        const { data: dupUsernames, error: dupErr } = await supabaseAdmin.from("profiles").select("id, username").ilike("username", nextUsername).neq("id", targetId).limit(1);
        if (dupErr) {
          return res.status(500).json({
            error: `Gagal memeriksa keunikan username: ${dupErr.message}`
          });
        }
        if (dupUsernames && dupUsernames.length > 0) {
          return res.status(409).json({
            error: `Username "@${nextUsername}" sudah digunakan oleh anggota lain.`,
            code: "USERNAME_TAKEN"
          });
        }
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { error: updateProfileErr } = await supabaseAdmin.from("profiles").update({
        full_name: nextFullName,
        username: nextUsername,
        updated_at: nowIso
      }).eq("id", targetId);
      if (updateProfileErr) {
        return res.status(500).json({
          error: `Gagal memperbarui data profil pengunjung: ${updateProfileErr.message}`
        });
      }
      if (authTargetUser) {
        const existingMeta = authTargetUser.user_metadata || {};
        const { error: authMetaErr } = await supabaseAdmin.auth.admin.updateUserById(targetId, {
          user_metadata: {
            ...existingMeta,
            full_name: nextFullName,
            username: nextUsername
          }
        });
        if (authMetaErr) {
          const { error: rollbackProfileErr } = await supabaseAdmin.from("profiles").update({
            full_name: targetProfile.full_name,
            username: targetProfile.username,
            updated_at: targetProfile.updated_at || nowIso
          }).eq("id", targetId);
          if (rollbackProfileErr) {
            return res.status(500).json({
              error: `Gagal menyinkronkan metadata Supabase Auth (${authMetaErr.message}) dan rollback profil gagal (${rollbackProfileErr.message}).`,
              code: "ROLLBACK_INCOMPLETE",
              rollbackComplete: false
            });
          }
          return res.status(500).json({
            error: `Gagal menyinkronkan metadata Supabase Auth (perubahan profil dibatalkan): ${authMetaErr.message}`,
            rollbackComplete: true
          });
        }
      }
      const { data: latestProfile } = await supabaseAdmin.from("profiles").select("*").eq("id", targetId).maybeSingle();
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "update_visitor",
          entity_type: "profiles",
          entity_id: targetId,
          details: JSON.stringify({
            full_name: nextFullName,
            username: nextUsername
          }),
          created_at: nowIso
        });
      } catch {
      }
      return res.json({
        success: true,
        visitor: {
          ...latestProfile || {
            ...targetProfile,
            full_name: nextFullName,
            username: nextUsername,
            updated_at: nowIso
          },
          email: authTargetUser?.email ?? targetProfile.email
        },
        message: `Data pengunjung "${nextFullName}" berhasil diperbarui.`
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memperbarui data pengunjung."
      });
    }
  };
  app2.post("/api/admin/visitors", handleCreateVisitorRequest);
  app2.patch("/api/admin/visitors/:id", handleUpdateVisitorRequest);
  app2.put("/api/admin/visitors/:id", handleUpdateVisitorRequest);
  app2.post("/api/admin/visitors/:id/delete", handleDeleteVisitorRequest);
  app2.post("/api/admin/visitors/:id/archive", handleArchiveVisitorRequest);
  app2.post("/api/admin/visitors/:id/restore", handleRestoreVisitorRequest);
  app2.delete("/api/admin/visitors/:id", handleDeleteVisitorRequest);
  app2.post("/api/admin/visitors/:id", async (req, res) => {
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "";
    if (action === "archive") {
      return handleArchiveVisitorRequest(req, res);
    }
    if (action === "restore") {
      return handleRestoreVisitorRequest(req, res);
    }
    if (action === "update" || action === "edit") {
      return handleUpdateVisitorRequest(req, res);
    }
    if (!action || action === "delete") {
      return handleDeleteVisitorRequest(req, res);
    }
    return res.status(400).json({
      error: `Aksi "${action}" tidak dikenali untuk endpoint pengunjung.`,
      code: "INVALID_VISITOR_ACTION"
    });
  });
  const loadCategoryMapSafe = async (supabaseAdmin) => {
    const map = /* @__PURE__ */ new Map();
    try {
      const { data: catRows, error: catErr } = await supabaseAdmin.from("categories").select("id, name, slug");
      if (!catErr && Array.isArray(catRows)) {
        for (const cat of catRows) {
          if (cat?.id) map.set(cat.id, cat);
        }
      }
    } catch {
    }
    return map;
  };
  app2.get("/api/books", async (req, res) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "memuat katalog buku"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      let query = supabaseAdmin.from("books").select("*").order("created_at", { ascending: false });
      if (!isActorAdmin) {
        query = query.eq("is_published", true).eq("is_archived", false);
      }
      const { data: bookRows, error: booksErr } = await query;
      if (booksErr) {
        const permDenied = isDbPermissionDeniedError(booksErr);
        return res.status(500).json({
          error: `Gagal memuat daftar buku: ${booksErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : booksErr.code || "BOOKS_FETCH_FAILED"
        });
      }
      const catMap = await loadCategoryMapSafe(supabaseAdmin);
      const enrichedBooks = (bookRows || []).map((b) => {
        const cat = b.category_id ? catMap.get(b.category_id) : void 0;
        return {
          ...b,
          ...cat ? { category: cat, category_name: cat.name } : {}
        };
      });
      return res.json({ books: enrichedBooks });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memuat katalog buku."
      });
    }
  });
  app2.post("/api/admin/books", async (req, res) => {
    try {
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
      const body = req.body || {};
      const cleanTitle = String(body.title || "").trim();
      const cleanCategoryId = String(body.category_id || "").trim();
      if (cleanTitle.length < 2) {
        return res.status(400).json({ error: "Judul buku wajib diisi minimal 2 karakter." });
      }
      if (!cleanCategoryId) {
        return res.status(400).json({
          error: "Kategori buku wajib dipilih sebelum menyimpan data buku."
        });
      }
      const totalCopies = Math.max(
        1,
        Math.floor(Number(body.total_copies || body.stock || 1) || 1)
      );
      const rawAvailable = body.available_copies !== void 0 ? Number(body.available_copies) : totalCopies;
      const availableCopies = Math.max(
        0,
        Math.min(totalCopies, Number.isFinite(rawAvailable) ? Math.floor(rawAvailable) : totalCopies)
      );
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { data: insertedRows, error: insertErr } = await supabaseAdmin.from("books").insert({
        title: cleanTitle,
        author: String(body.author || "Penulis Mandiri").trim(),
        publisher: String(body.publisher || "Penerbit Mandiri").trim(),
        publication_year: Number(body.publication_year || body.year || (/* @__PURE__ */ new Date()).getFullYear()),
        isbn: String(body.isbn || "ISBN-978-000-000").trim(),
        category_id: cleanCategoryId,
        description: body.description ? String(body.description).trim() : null,
        cover_path: body.cover_path || body.coverUrl || null,
        file_path: body.file_path || null,
        file_type: body.file_type || null,
        total_copies: totalCopies,
        available_copies: availableCopies,
        is_published: body.is_published !== void 0 ? Boolean(body.is_published) : true,
        is_archived: false,
        created_by: authCheck.adminProfile.id,
        created_at: nowIso,
        updated_at: nowIso
      }).select("*");
      if (insertErr) {
        const permDenied = isDbPermissionDeniedError(insertErr);
        return res.status(500).json({
          error: `Gagal menyimpan buku baru: ${insertErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : insertErr.code || "BOOK_INSERT_FAILED"
        });
      }
      const book = insertedRows?.[0];
      if (!book) {
        return res.status(500).json({ error: "Buku gagal ditambahkan ke database." });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "create_book",
          entity_type: "books",
          entity_id: book.id,
          details: JSON.stringify({ title: cleanTitle }),
          created_at: nowIso
        });
      } catch {
      }
      const catMap = await loadCategoryMapSafe(supabaseAdmin);
      const cat = book.category_id ? catMap.get(book.category_id) : void 0;
      return res.status(201).json({
        success: true,
        book: {
          ...book,
          ...cat ? { category: cat, category_name: cat.name } : {}
        }
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat menambahkan buku."
      });
    }
  });
  app2.patch("/api/admin/books/:id", async (req, res) => {
    try {
      const bookId = String(req.params.id || "").trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({ error: "ID buku tidak valid." });
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
      const rawUpdates = req.body || {};
      const { category: _c, category_name: _cn, id: _id, created_at: _ca, created_by: _cb, ...cleanUpdates } = rawUpdates;
      cleanUpdates.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      const { data: updatedRows, error: updateErr } = await supabaseAdmin.from("books").update(cleanUpdates).eq("id", bookId).select("*");
      if (updateErr) {
        const permDenied = isDbPermissionDeniedError(updateErr);
        return res.status(500).json({
          error: `Gagal memperbarui buku: ${updateErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : updateErr.code || "BOOK_UPDATE_FAILED"
        });
      }
      const book = updatedRows?.[0];
      if (!book) {
        return res.status(404).json({ error: "Data buku tidak ditemukan." });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "update_book",
          entity_type: "books",
          entity_id: bookId,
          details: JSON.stringify({ title: book.title }),
          created_at: cleanUpdates.updated_at
        });
      } catch {
      }
      const catMap = await loadCategoryMapSafe(supabaseAdmin);
      const cat = book.category_id ? catMap.get(book.category_id) : void 0;
      return res.json({
        success: true,
        book: {
          ...book,
          ...cat ? { category: cat, category_name: cat.name } : {}
        }
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memperbarui buku."
      });
    }
  });
  app2.delete("/api/admin/books/:id", async (req, res) => {
    try {
      const bookId = String(req.params.id || "").trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({ error: "ID buku tidak valid." });
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
      const { data: activeLoans, error: loansErr } = await supabaseAdmin.from("loans").select("id").eq("book_id", bookId).in("status", ["pending", "approved", "borrowed"]).limit(1);
      if (loansErr) {
        const permDenied = isDbPermissionDeniedError(loansErr);
        return res.status(500).json({
          error: `Gagal memeriksa status peminjaman buku: ${loansErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : loansErr.code || "LOANS_CHECK_FAILED"
        });
      }
      if (activeLoans && activeLoans.length > 0) {
        return res.status(409).json({
          error: "Buku ini tidak dapat dihapus karena masih memiliki transaksi peminjaman aktif.",
          code: "BOOK_HAS_ACTIVE_LOANS"
        });
      }
      const { error: deleteErr } = await supabaseAdmin.from("books").delete().eq("id", bookId);
      if (deleteErr) {
        const permDenied = isDbPermissionDeniedError(deleteErr);
        return res.status(500).json({
          error: `Gagal menghapus buku: ${deleteErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : deleteErr.code || "BOOK_DELETE_FAILED"
        });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: authCheck.adminProfile.id,
          action: "delete_book",
          entity_type: "books",
          entity_id: bookId,
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch {
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat menghapus buku."
      });
    }
  });
  app2.get("/api/admin/activity-logs", async (req, res) => {
    try {
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
      const rawLimit = Number(req.query.limit ?? 25);
      const safeLimit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 25));
      const { data: logs, error: logsErr } = await supabaseAdmin.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(safeLimit);
      if (logsErr) {
        const permDenied = isDbPermissionDeniedError(logsErr);
        return res.status(500).json({
          error: `Gagal memuat log aktivitas: ${logsErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : logsErr.code || "ACTIVITY_LOGS_FETCH_FAILED"
        });
      }
      return res.json({ logs: logs || [] });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memuat log aktivitas."
      });
    }
  });
  const enrichLoanRows = async (supabaseAdmin, loanRows) => {
    if (!Array.isArray(loanRows) || loanRows.length === 0) return [];
    const bookIds = Array.from(new Set(loanRows.map((l) => l.book_id).filter(Boolean)));
    const userIds = Array.from(new Set(loanRows.map((l) => l.user_id).filter(Boolean)));
    const [booksRes, profilesRes, catMap] = await Promise.all([
      bookIds.length > 0 ? supabaseAdmin.from("books").select(
        "id, title, author, publisher, publication_year, cover_path, file_path, file_type, available_copies, total_copies, category_id"
      ).in("id", bookIds) : Promise.resolve({ data: [], error: null }),
      userIds.length > 0 ? supabaseAdmin.from("profiles").select("id, full_name, username, role").in("id", userIds) : Promise.resolve({ data: [], error: null }),
      loadCategoryMapSafe(supabaseAdmin)
    ]);
    const bookMap = /* @__PURE__ */ new Map();
    for (const b of booksRes.data || []) {
      const cat = b.category_id ? catMap.get(b.category_id) : void 0;
      bookMap.set(b.id, {
        ...b,
        ...cat ? { category: cat, category_name: cat.name } : {}
      });
    }
    const profileMap = /* @__PURE__ */ new Map();
    for (const p of profilesRes.data || []) {
      profileMap.set(p.id, p);
    }
    return loanRows.map((loan) => ({
      ...loan,
      book: bookMap.get(loan.book_id) ?? void 0,
      profile: profileMap.get(loan.user_id) ?? void 0
    }));
  };
  app2.get("/api/loans", async (req, res) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "memuat daftar peminjaman"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      let query = supabaseAdmin.from("loans").select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      ).order("requested_at", { ascending: false });
      if (!isActorAdmin) {
        query = query.eq("user_id", actor.id);
      }
      const { data: loanRows, error: loansErr } = await query;
      if (loansErr) {
        const isPermDenied = isDbPermissionDeniedError(loansErr);
        if (isPermDenied) {
          console.error("[LOANS_LIST_PERMISSION_DENIED]", {
            actorId: actor.id,
            code: loansErr.code,
            message: loansErr.message
          });
          return res.status(500).json({
            error: "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang.",
            code: "DB_PERMISSION_DENIED"
          });
        }
        return res.status(500).json({
          error: `Gagal memuat data peminjaman: ${loansErr.message}`,
          code: loansErr.code || "LOANS_FETCH_FAILED"
        });
      }
      const enriched = await enrichLoanRows(supabaseAdmin, loanRows || []);
      return res.json({ loans: enriched });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat memuat daftar peminjaman."
      });
    }
  });
  app2.post("/api/loans", async (req, res) => {
    try {
      const { client: supabaseAuth, error: authClientError } = getAuthClient();
      const { client: supabaseAdmin, error: adminClientError } = getAdminClient();
      if (!supabaseAuth || !supabaseAdmin) {
        return res.status(500).json({
          error: adminClientError || authClientError || "Konfigurasi server belum lengkap."
        });
      }
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "mengajukan peminjaman buku"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const body = req.body || {};
      const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: "ID buku yang dipilih tidak valid.",
          code: "INVALID_BOOK_ID"
        });
      }
      const { data: bookRows, error: bookErr } = await supabaseAdmin.from("books").select(
        "id, title, author, publisher, publication_year, cover_path, file_path, file_type, available_copies, total_copies, is_published, is_archived, category_id"
      ).eq("id", bookId).limit(2);
      if (bookErr) {
        const permDenied = isDbPermissionDeniedError(bookErr);
        return res.status(500).json({
          error: `Gagal memeriksa data buku: ${bookErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : bookErr.code || "BOOK_FETCH_FAILED"
        });
      }
      const book = bookRows?.[0];
      if (!book) {
        return res.status(404).json({
          error: "Buku tidak ditemukan.",
          code: "BOOK_NOT_FOUND"
        });
      }
      if (book.is_published === false || book.is_archived) {
        return res.status(409).json({
          error: "Maaf, buku ini sedang diarsipkan atau belum dipublikasikan untuk dipinjam.",
          code: "BOOK_UNAVAILABLE"
        });
      }
      if (Number(book.available_copies ?? 0) <= 0) {
        return res.status(409).json({
          error: "Maaf, eksemplar buku ini sedang tidak tersedia.",
          code: "BOOK_OUT_OF_STOCK"
        });
      }
      const { data: existingLoans, error: existingErr } = await supabaseAdmin.from("loans").select("id, status").eq("user_id", actor.id).eq("book_id", bookId).in("status", ["pending", "approved", "borrowed"]).limit(1);
      if (existingErr) {
        const isPermDenied = isDbPermissionDeniedError(existingErr);
        return res.status(500).json({
          error: isPermDenied ? "Izin database server untuk memeriksa tabel peminjaman (loans) belum aktif (kode 42501)." : `Gagal memeriksa status peminjaman sebelumnya: ${existingErr.message}`,
          code: isPermDenied ? "DB_PERMISSION_DENIED" : existingErr.code || "LOAN_CHECK_FAILED"
        });
      }
      if (existingLoans && existingLoans.length > 0) {
        return res.status(409).json({
          error: "Anda sudah memiliki permintaan atau peminjaman aktif untuk buku ini.",
          code: "DUPLICATE_ACTIVE_LOAN"
        });
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const rawNotes = typeof body.notes === "string" ? body.notes.trim() : "";
      const cleanNote = rawNotes ? `Catatan peminjam: ${rawNotes.slice(0, 450)}` : null;
      const { data: insertedRows, error: insertErr } = await supabaseAdmin.from("loans").insert({
        user_id: actor.id,
        book_id: bookId,
        status: "pending",
        requested_at: requestedAt,
        approved_at: null,
        due_at: null,
        returned_at: null,
        admin_note: cleanNote
      }).select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      );
      if (insertErr) {
        const isPermDenied = isDbPermissionDeniedError(insertErr);
        return res.status(500).json({
          error: isPermDenied ? "Izin database server untuk membuat pengajuan peminjaman (loans) belum aktif (kode 42501)." : `Gagal mengajukan peminjaman: ${insertErr.message}`,
          code: isPermDenied ? "DB_PERMISSION_DENIED" : insertErr.code || "LOAN_INSERT_FAILED"
        });
      }
      const createdLoan = insertedRows?.[0];
      if (!createdLoan) {
        return res.status(500).json({
          error: "Pengajuan peminjaman gagal dikonfirmasi oleh database.",
          code: "LOAN_INSERT_EMPTY"
        });
      }
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: actor.id,
          action: "request_loan",
          entity_type: "loans",
          entity_id: createdLoan.id,
          details: JSON.stringify({ book_title: book.title }),
          created_at: requestedAt
        });
      } catch {
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
            role: actor.role
          }
        }
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan server saat mengajukan peminjaman buku.",
        code: "INTERNAL_LOAN_REQUEST_ERROR"
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
      const isPermissionDenied = isDbPermissionDeniedError;
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
      if (typeof supabaseAdmin.rpc === "function") {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
          "return_loan_atomic",
          {
            p_loan_id: loanId,
            p_actor_id: actor.id,
            p_is_admin: isActorAdmin
          }
        );
        if (rpcError) {
          if (!isMissingRpcFunctionError(rpcError, "return_loan_atomic")) {
            if (isPermissionDenied(rpcError)) {
              const envStatus = inspectServerSupabaseEnv();
              console.error("[RETURN_BOOK_PERMISSION_DENIED]", {
                loanId,
                actorId: actor.id,
                table: "loans",
                operation: "rpc:return_loan_atomic",
                code: rpcError.code || "42501",
                message: rpcError.message,
                keyStatus: envStatus.keyStatus
              });
              return res.status(500).json({
                error: "Izin database server untuk memproses pengembalian buku (loans) belum aktif (kode 42501). Pastikan migrasi GRANT & fungsi return_loan_atomic sudah dijalankan.",
                code: "DB_PERMISSION_DENIED"
              });
            }
            console.error("[RETURN_BOOK_ATOMIC_RPC_ERROR]", {
              loanId,
              actorId: actor.id,
              code: rpcError.code,
              message: rpcError.message
            });
            return res.status(500).json({
              error: formatBookReturnErrorMessage(rpcError),
              code: rpcError.code || "ATOMIC_RETURN_FAILED"
            });
          }
        } else if (rpcResult && typeof rpcResult === "object") {
          if (rpcResult.ok === false) {
            return res.status(Number(rpcResult.http_status) || 409).json({
              error: rpcResult.error || "Pengembalian buku belum dapat diproses.",
              code: rpcResult.code || "RETURN_REJECTED",
              ...rpcResult.current_status ? { currentStatus: rpcResult.current_status } : {}
            });
          }
          if (rpcResult.ok === true && rpcResult.loan) {
            const enriched = await buildEnrichedLoan(rpcResult.loan);
            return res.json({
              success: true,
              atomicRpc: true,
              alreadyReturned: Boolean(rpcResult.already_returned),
              stockAdjusted: Boolean(rpcResult.stock_adjusted),
              stockSource: rpcResult.stock_source || "none",
              loan: enriched,
              ...rpcResult.message ? { message: rpcResult.message } : {}
            });
          }
        }
      }
      const { data: peekLoanRows, error: peekLoanError } = await supabaseAdmin.from("loans").select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      ).eq("id", loanId).limit(2);
      if (peekLoanError) {
        if (isPermissionDenied(peekLoanError)) {
          const envStatus = inspectServerSupabaseEnv();
          console.error("[RETURN_BOOK_PERMISSION_DENIED]", {
            loanId,
            actorId: actor.id,
            table: "loans",
            operation: "select",
            code: peekLoanError.code,
            message: peekLoanError.message,
            keyStatus: envStatus.keyStatus
          });
          return res.status(500).json({
            error: "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY di Vercel sudah terpasang dengan benar.",
            code: "DB_PERMISSION_DENIED"
          });
        }
        console.error("[RETURN_BOOK_FETCH_ERROR]", {
          loanId,
          actorId: actor.id,
          code: peekLoanError.code,
          message: peekLoanError.message
        });
        return res.status(500).json({
          error: formatBookReturnErrorMessage(peekLoanError),
          code: peekLoanError.code || "LOAN_FETCH_FAILED"
        });
      }
      if (!peekLoanRows || peekLoanRows.length === 0) {
        return res.status(404).json({
          error: "Data transaksi peminjaman tidak ditemukan.",
          code: "LOAN_NOT_FOUND"
        });
      }
      if (peekLoanRows.length > 1) {
        console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
          query: "loans_select_by_pk",
          loanId,
          rowCount: peekLoanRows.length
        });
        return res.status(409).json({
          error: "Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator.",
          code: "DUPLICATE_LOAN_TRANSACTION"
        });
      }
      const peekLoan = peekLoanRows[0];
      if (!isActorAdmin && peekLoan.user_id !== actor.id) {
        return res.status(403).json({
          error: "Anda tidak memiliki izin untuk mengembalikan transaksi peminjaman milik anggota lain.",
          code: "FORBIDDEN"
        });
      }
      return await withBookStockLock(peekLoan.book_id, async () => {
        const { data: loanRows, error: fetchLoanError } = await supabaseAdmin.from("loans").select(
          "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
        ).eq("id", loanId).limit(2);
        if (fetchLoanError) {
          if (isPermissionDenied(fetchLoanError)) {
            return res.status(500).json({
              error: "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501).",
              code: "DB_PERMISSION_DENIED"
            });
          }
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
          if (isPermissionDenied(beforeBookError)) {
            const envStatus = inspectServerSupabaseEnv();
            console.error("[RETURN_BOOK_PERMISSION_DENIED]", {
              loanId,
              actorId: actor.id,
              table: "books",
              operation: "select",
              code: beforeBookError.code,
              message: beforeBookError.message,
              keyStatus: envStatus.keyStatus
            });
            return res.status(500).json({
              error: "Izin database server untuk membaca tabel buku (books) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.books sudah dijalankan.",
              code: "DB_PERMISSION_DENIED"
            });
          }
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
        const previousLoanStatus = String(existingLoan.status || "approved");
        const previousReturnedAt = existingLoan.returned_at ?? null;
        const returnedAt = (/* @__PURE__ */ new Date()).toISOString();
        const { data: updatedRows, error: updateLoanError } = await supabaseAdmin.from("loans").update({
          status: "returned",
          returned_at: returnedAt,
          updated_at: returnedAt
        }).eq("id", loanId).in("status", ["approved", "borrowed"]).select(
          "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
        );
        if (updateLoanError) {
          if (isPermissionDenied(updateLoanError)) {
            const envStatus = inspectServerSupabaseEnv();
            console.error("[RETURN_BOOK_PERMISSION_DENIED]", {
              loanId,
              actorId: actor.id,
              table: "loans",
              operation: "update",
              code: updateLoanError.code,
              message: updateLoanError.message,
              keyStatus: envStatus.keyStatus
            });
            return res.status(500).json({
              error: "Izin database server untuk memperbarui tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY di Vercel sudah terpasang dengan benar.",
              code: "DB_PERMISSION_DENIED"
            });
          }
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
        const rollbackReturnLoanStatus = async () => {
          try {
            await supabaseAdmin.from("loans").update({
              status: previousLoanStatus,
              returned_at: previousReturnedAt,
              updated_at: (/* @__PURE__ */ new Date()).toISOString()
            }).eq("id", loanId).eq("status", "returned");
          } catch (rollbackErr) {
            console.error("[RETURN_BOOK_ROLLBACK_ERROR]", {
              loanId,
              bookId: existingLoan.book_id,
              message: rollbackErr?.message
            });
          }
        };
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
            await rollbackReturnLoanStatus();
            return res.status(500).json({
              error: `Gagal memverifikasi pembaruan stok buku saat pengembalian; transaksi dibatalkan secara otomatis: ${afterBookErr.message}`,
              code: isPermissionDenied(afterBookErr) ? "DB_PERMISSION_DENIED" : "BOOK_STOCK_SYNC_FAILED",
              rolledBack: true
            });
          }
          if (afterBookRows && afterBookRows.length > 1) {
            console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
              query: "afterBook.books_by_id",
              loanId,
              bookId: existingLoan.book_id,
              rowCount: afterBookRows.length
            });
            await rollbackReturnLoanStatus();
            return res.status(409).json({
              error: "Terdeteksi duplikasi data buku saat sinkronisasi stok. Transaksi dibatalkan otomatis.",
              code: "DUPLICATE_BOOK_RECORD",
              rolledBack: true
            });
          }
          const afterBook = afterBookRows?.[0] ?? beforeBook;
          const afterAvailableNum = Number(afterBook.available_copies ?? beforeAvailable);
          if (afterAvailableNum - beforeAvailable > 1) {
            await rollbackReturnLoanStatus();
            return res.status(500).json({
              error: "Terdeteksi penambahan stok lebih dari satu eksemplar untuk satu pengembalian. Transaksi dibatalkan otomatis.",
              code: "DOUBLE_STOCK_INCREMENT",
              rolledBack: true
            });
          }
          const stockPlan = computeBookStockAfterReturn({
            beforeAvailable,
            afterAvailable: afterAvailableNum,
            totalCopies: Number(afterBook.total_copies ?? totalCopies)
          });
          stockSource = stockPlan.incrementedBy;
          if (stockPlan.needsUpdate) {
            const { data: updatedBookRows, error: stockUpdateErr } = await supabaseAdmin.from("books").update({
              available_copies: stockPlan.targetAvailable,
              updated_at: returnedAt
            }).eq("id", existingLoan.book_id).eq("available_copies", stockPlan.safeAfter).select("id, available_copies");
            if (stockUpdateErr) {
              await rollbackReturnLoanStatus();
              if (isPermissionDenied(stockUpdateErr)) {
                const envStatus = inspectServerSupabaseEnv();
                console.error("[RETURN_BOOK_PERMISSION_DENIED]", {
                  loanId,
                  actorId: actor.id,
                  table: "books",
                  operation: "update",
                  code: stockUpdateErr.code,
                  message: stockUpdateErr.message,
                  keyStatus: envStatus.keyStatus
                });
                return res.status(500).json({
                  error: "Izin database server untuk memperbarui stok buku (books) belum aktif (kode 42501). Perubahan status peminjaman dibatalkan otomatis.",
                  code: "DB_PERMISSION_DENIED",
                  rolledBack: true
                });
              }
              console.error("[RETURN_BOOK_STOCK_SYNC_ERROR]", {
                loanId,
                bookId: existingLoan.book_id,
                message: stockUpdateErr.message
              });
              return res.status(500).json({
                error: `Gagal memperbarui stok buku saat pengembalian; transaksi dibatalkan otomatis: ${stockUpdateErr.message}`,
                code: "BOOK_STOCK_UPDATE_FAILED",
                rolledBack: true
              });
            }
            if (!updatedBookRows || updatedBookRows.length === 0) {
              await rollbackReturnLoanStatus();
              return res.status(409).json({
                error: "Stok buku berubah secara bersamaan sebelum pengembalian selesai. Transaksi dibatalkan otomatis; silakan coba lagi.",
                code: "CONCURRENT_BOOK_STOCK_MODIFICATION",
                rolledBack: true
              });
            }
            if (updatedBookRows.length > 1) {
              console.error("[RETURN_BOOK_MULTIPLE_RECORDS]", {
                query: "books_stock_update_by_id",
                loanId,
                bookId: existingLoan.book_id,
                rowCount: updatedBookRows.length
              });
              await rollbackReturnLoanStatus();
              return res.status(409).json({
                error: "Terdeteksi lebih dari satu baris buku saat pembaruan stok. Transaksi dibatalkan otomatis.",
                code: "DUPLICATE_BOOK_RECORD",
                rolledBack: true
              });
            }
            stockAdjusted = stockPlan.incrementedBy === "application";
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
  app2.post("/api/loans/:id/approve", async (req, res) => {
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
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "menyetujui peminjaman buku"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      if (!isActorAdmin) {
        return res.status(403).json({
          error: "Hanya administrator aktif yang berwenang menyetujui peminjaman buku.",
          code: "FORBIDDEN"
        });
      }
      const body = req.body || {};
      const adminNote = typeof body.adminNote === "string" && body.adminNote.trim() ? body.adminNote.trim().slice(0, 500) : "Peminjaman telah disetujui administrator perpustakaan.";
      if (typeof supabaseAdmin.rpc === "function") {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
          "approve_loan_atomic",
          {
            p_loan_id: loanId,
            p_actor_id: actor.id,
            p_admin_note: adminNote
          }
        );
        if (rpcError) {
          if (!isMissingRpcFunctionError(rpcError, "approve_loan_atomic")) {
            const permDenied = isDbPermissionDeniedError(rpcError);
            if (permDenied) {
              console.error("[LOAN_APPROVE_PERMISSION_DENIED]", {
                loanId,
                actorId: actor.id,
                table: "loans",
                operation: "rpc:approve_loan_atomic",
                code: rpcError.code || "42501",
                keyStatus: inspectServerSupabaseEnv().keyStatus
              });
            }
            return res.status(500).json({
              error: permDenied ? "Izin database server untuk menyetujui peminjaman (approve_loan_atomic) belum aktif (kode 42501)." : `Gagal menyetujui peminjaman: ${rpcError.message}`,
              code: permDenied ? "DB_PERMISSION_DENIED" : rpcError.code || "ATOMIC_APPROVE_FAILED"
            });
          }
        } else if (rpcResult && typeof rpcResult === "object") {
          if (rpcResult.ok === false) {
            return res.status(Number(rpcResult.http_status) || 409).json({
              error: rpcResult.error || "Persetujuan peminjaman ditolak.",
              code: rpcResult.code || "APPROVE_REJECTED"
            });
          }
          if (rpcResult.ok === true && rpcResult.loan) {
            const approvedLoanRow = rpcResult.loan;
            const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
              supabaseAdmin.from("books").select("id, title, author, cover_path, file_path, available_copies, total_copies").eq("id", approvedLoanRow.book_id).limit(2),
              supabaseAdmin.from("profiles").select("id, full_name, username").eq("id", approvedLoanRow.user_id).limit(2)
            ]);
            return res.json({
              success: true,
              atomicRpc: true,
              stockAdjusted: Boolean(rpcResult.stock_adjusted),
              stockSource: rpcResult.stock_source || "none",
              loan: {
                ...approvedLoanRow,
                due_at: null,
                book: enrichedBookRows?.[0] ?? void 0,
                profile: enrichedProfileRows?.[0] ?? void 0
              }
            });
          }
        }
      }
      const { data: peekLoanRows, error: peekLoanError } = await supabaseAdmin.from("loans").select("id, user_id, book_id, status, admin_note").eq("id", loanId).limit(2);
      if (peekLoanError) {
        const permDenied = isDbPermissionDeniedError(peekLoanError);
        if (permDenied) {
          console.error("[LOAN_APPROVE_PERMISSION_DENIED]", {
            loanId,
            actorId: actor.id,
            table: "loans",
            operation: "select",
            code: peekLoanError.code || "42501",
            keyStatus: inspectServerSupabaseEnv().keyStatus
          });
        }
        return res.status(500).json({
          error: permDenied ? "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang." : `Gagal memeriksa transaksi peminjaman: ${peekLoanError.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : peekLoanError.code || "LOAN_FETCH_FAILED"
        });
      }
      if (!peekLoanRows || peekLoanRows.length === 0) {
        return res.status(404).json({
          error: "Data transaksi peminjaman tidak ditemukan.",
          code: "LOAN_NOT_FOUND"
        });
      }
      if (peekLoanRows.length > 1) {
        return res.status(409).json({
          error: "Terdeteksi duplikasi data pada transaksi peminjaman ini.",
          code: "DUPLICATE_LOAN_TRANSACTION"
        });
      }
      const peekLoan = peekLoanRows[0];
      return await withBookStockLock(peekLoan.book_id, async () => {
        const { data: loanRows, error: fetchLoanError } = await supabaseAdmin.from("loans").select("id, user_id, book_id, status, admin_note").eq("id", loanId).limit(2);
        if (fetchLoanError) {
          const permDenied = isDbPermissionDeniedError(fetchLoanError);
          return res.status(500).json({
            error: permDenied ? "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501)." : `Gagal memeriksa transaksi peminjaman: ${fetchLoanError.message}`,
            code: permDenied ? "DB_PERMISSION_DENIED" : fetchLoanError.code || "LOAN_FETCH_FAILED"
          });
        }
        if (!loanRows || loanRows.length === 0) {
          return res.status(404).json({
            error: "Data transaksi peminjaman tidak ditemukan.",
            code: "LOAN_NOT_FOUND"
          });
        }
        if (loanRows.length > 1) {
          return res.status(409).json({
            error: "Terdeteksi duplikasi data pada transaksi peminjaman ini.",
            code: "DUPLICATE_LOAN_TRANSACTION"
          });
        }
        const existingLoan = loanRows[0];
        if (existingLoan.status !== "pending") {
          return res.status(409).json({
            error: "Permintaan peminjaman ini sudah diproses sebelumnya dan tidak dapat disetujui ulang.",
            code: "INVALID_LOAN_STATUS"
          });
        }
        const { data: bookRows, error: bookErr } = await supabaseAdmin.from("books").select("id, available_copies, total_copies, is_archived").eq("id", existingLoan.book_id).limit(2);
        if (bookErr) {
          const permDenied = isDbPermissionDeniedError(bookErr);
          if (permDenied) {
            console.error("[LOAN_APPROVE_PERMISSION_DENIED]", {
              loanId,
              actorId: actor.id,
              table: "books",
              operation: "select",
              code: bookErr.code || "42501",
              keyStatus: inspectServerSupabaseEnv().keyStatus
            });
          }
          return res.status(500).json({
            error: `Gagal memeriksa stok buku: ${bookErr.message}`,
            code: permDenied ? "DB_PERMISSION_DENIED" : bookErr.code || "BOOK_FETCH_FAILED"
          });
        }
        const targetBook = bookRows?.[0];
        if (!targetBook || targetBook.is_archived || Number(targetBook.available_copies ?? 0) <= 0) {
          return res.status(409).json({
            error: "Stok eksemplar buku sudah habis atau buku diarsipkan sehingga peminjaman tidak dapat disetujui.",
            code: "BOOK_UNAVAILABLE"
          });
        }
        const beforeAvailableCopies = Number(targetBook.available_copies ?? 0);
        const totalCopies = Number(targetBook.total_copies ?? beforeAvailableCopies);
        const previousAdminNote = existingLoan.admin_note ?? null;
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const { data: updatedRows, error: updateError } = await supabaseAdmin.from("loans").update({
          status: "approved",
          approved_at: nowIso,
          due_at: null,
          admin_note: adminNote,
          updated_at: nowIso
        }).eq("id", loanId).eq("status", "pending").select(
          "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
        );
        if (updateError) {
          const permDenied = isDbPermissionDeniedError(updateError);
          if (permDenied) {
            console.error("[LOAN_APPROVE_PERMISSION_DENIED]", {
              loanId,
              actorId: actor.id,
              table: "loans",
              operation: "update",
              code: updateError.code || "42501",
              keyStatus: inspectServerSupabaseEnv().keyStatus
            });
          }
          return res.status(500).json({
            error: permDenied ? "Izin database server untuk menyetujui peminjaman pada tabel loans belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans sudah dijalankan." : `Gagal menyetujui peminjaman: ${updateError.message}`,
            code: permDenied ? "DB_PERMISSION_DENIED" : updateError.code || "LOAN_APPROVE_FAILED"
          });
        }
        if (!updatedRows || updatedRows.length === 0) {
          return res.status(409).json({
            error: "Permintaan peminjaman ini sudah diproses oleh admin lain.",
            code: "CONCURRENT_LOAN_MODIFICATION"
          });
        }
        const updatedLoan = updatedRows[0];
        const rollbackApproveLoanStatus = async () => {
          try {
            await supabaseAdmin.from("loans").update({
              status: "pending",
              approved_at: null,
              due_at: null,
              admin_note: previousAdminNote,
              updated_at: (/* @__PURE__ */ new Date()).toISOString()
            }).eq("id", loanId).eq("status", "approved");
          } catch (rollbackErr) {
            console.error("[LOAN_APPROVE_ROLLBACK_ERROR]", {
              loanId,
              bookId: updatedLoan.book_id,
              message: rollbackErr?.message
            });
          }
        };
        let stockAdjusted = false;
        let stockSource = "none";
        const { data: afterBookRows, error: afterBookErr } = await supabaseAdmin.from("books").select("id, available_copies, total_copies").eq("id", updatedLoan.book_id).limit(2);
        if (afterBookErr || !afterBookRows?.[0]) {
          await rollbackApproveLoanStatus();
          return res.status(500).json({
            error: "Gagal memverifikasi stok buku setelah persetujuan. Persetujuan dibatalkan otomatis.",
            code: isDbPermissionDeniedError(afterBookErr) ? "DB_PERMISSION_DENIED" : "BOOK_STOCK_SYNC_FAILED",
            rolledBack: true
          });
        }
        const afterBook = afterBookRows[0];
        const rawAfterAvailable = Number(afterBook.available_copies ?? 0);
        if (rawAfterAvailable < 0 || beforeAvailableCopies - rawAfterAvailable > 1) {
          await rollbackApproveLoanStatus();
          return res.status(409).json({
            error: "Integritas stok buku tidak terpenuhi (stok negatif / pengurangan ganda). Persetujuan dibatalkan otomatis.",
            code: "BOOK_STOCK_INTEGRITY_ERROR",
            rolledBack: true
          });
        }
        const stockPlan = computeBookStockAfterApprove({
          beforeAvailable: beforeAvailableCopies,
          afterAvailable: rawAfterAvailable,
          totalCopies: Number(afterBook.total_copies ?? totalCopies)
        });
        stockSource = stockPlan.decrementedBy === "trigger" ? "trigger" : stockPlan.decrementedBy === "application" ? "application" : "none";
        if (stockPlan.needsUpdate) {
          if (stockPlan.targetAvailable < 0 || stockPlan.safeAfter <= 0) {
            await rollbackApproveLoanStatus();
            return res.status(409).json({
              error: "Stok eksemplar buku sudah habis sehingga persetujuan dibatalkan otomatis.",
              code: "BOOK_UNAVAILABLE",
              rolledBack: true
            });
          }
          const { data: updatedBookRows, error: stockUpdateErr } = await supabaseAdmin.from("books").update({
            available_copies: stockPlan.targetAvailable,
            updated_at: nowIso
          }).eq("id", updatedLoan.book_id).eq("available_copies", stockPlan.safeAfter).select("id, available_copies");
          if (stockUpdateErr) {
            await rollbackApproveLoanStatus();
            const permDenied = isDbPermissionDeniedError(stockUpdateErr);
            if (permDenied) {
              console.error("[LOAN_APPROVE_PERMISSION_DENIED]", {
                loanId,
                actorId: actor.id,
                table: "books",
                operation: "update",
                code: stockUpdateErr.code || "42501",
                keyStatus: inspectServerSupabaseEnv().keyStatus
              });
            }
            return res.status(500).json({
              error: permDenied ? "Izin database server untuk memperbarui stok buku (books) belum aktif (kode 42501). Persetujuan dibatalkan otomatis." : `Gagal memperbarui stok buku saat persetujuan; transaksi dibatalkan otomatis: ${stockUpdateErr.message}`,
              code: permDenied ? "DB_PERMISSION_DENIED" : "BOOK_STOCK_UPDATE_FAILED",
              rolledBack: true
            });
          }
          if (!updatedBookRows || updatedBookRows.length === 0) {
            await rollbackApproveLoanStatus();
            return res.status(409).json({
              error: "Stok buku berubah secara bersamaan saat persetujuan berlangsung. Transaksi dibatalkan otomatis.",
              code: "CONCURRENT_BOOK_STOCK_MODIFICATION",
              rolledBack: true
            });
          }
          stockAdjusted = stockPlan.decrementedBy === "application";
        } else if (stockPlan.decrementedBy === "trigger") {
          stockAdjusted = true;
        }
        const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
          supabaseAdmin.from("books").select("id, title, author, cover_path, file_path, available_copies, total_copies").eq("id", updatedLoan.book_id).limit(2),
          supabaseAdmin.from("profiles").select("id, full_name, username").eq("id", updatedLoan.user_id).limit(2)
        ]);
        try {
          await supabaseAdmin.from("activity_logs").insert({
            actor_id: actor.id,
            action: "approve_loan",
            entity_type: "loans",
            entity_id: loanId,
            details: JSON.stringify({
              stock_source: stockSource
            }),
            created_at: nowIso
          });
        } catch {
        }
        return res.json({
          success: true,
          stockAdjusted,
          stockSource,
          loan: {
            ...updatedLoan,
            book: enrichedBookRows?.[0] ?? void 0,
            profile: enrichedProfileRows?.[0] ?? void 0
          }
        });
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Gagal menyetujui peminjaman.",
        code: "INTERNAL_APPROVE_ERROR"
      });
    }
  });
  app2.post("/api/loans/:id/reject", async (req, res) => {
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
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "menolak peminjaman buku"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      if (!isActorAdmin) {
        return res.status(403).json({
          error: "Hanya administrator aktif yang berwenang menolak peminjaman buku.",
          code: "FORBIDDEN"
        });
      }
      const { data: loanRows, error: fetchLoanError } = await supabaseAdmin.from("loans").select("id, user_id, book_id, status").eq("id", loanId).limit(2);
      if (fetchLoanError) {
        const permDenied = isDbPermissionDeniedError(fetchLoanError);
        if (permDenied) {
          console.error("[LOAN_REJECT_PERMISSION_DENIED]", {
            loanId,
            actorId: actor.id,
            table: "loans",
            operation: "select",
            code: fetchLoanError.code || "42501",
            keyStatus: inspectServerSupabaseEnv().keyStatus
          });
        }
        return res.status(500).json({
          error: permDenied ? "Izin database server untuk membaca tabel peminjaman (loans) belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans dan SUPABASE_SERVICE_ROLE_KEY sudah terpasang." : `Gagal memeriksa transaksi peminjaman: ${fetchLoanError.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : fetchLoanError.code || "LOAN_FETCH_FAILED"
        });
      }
      if (!loanRows || loanRows.length === 0) {
        return res.status(404).json({
          error: "Data transaksi peminjaman tidak ditemukan.",
          code: "LOAN_NOT_FOUND"
        });
      }
      if (loanRows.length > 1) {
        return res.status(409).json({
          error: "Terdeteksi duplikasi data pada transaksi peminjaman ini.",
          code: "DUPLICATE_LOAN_TRANSACTION"
        });
      }
      const existingLoan = loanRows[0];
      if (existingLoan.status !== "pending") {
        return res.status(409).json({
          error: "Permintaan peminjaman ini sudah diproses sebelumnya.",
          code: "INVALID_LOAN_STATUS"
        });
      }
      const body = req.body || {};
      const cleanReason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "Permintaan peminjaman belum dapat disetujui saat ini.";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { data: updatedRows, error: updateError } = await supabaseAdmin.from("loans").update({
        status: "rejected",
        admin_note: cleanReason,
        updated_at: nowIso
      }).eq("id", loanId).eq("status", "pending").select(
        "id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at"
      );
      if (updateError) {
        const permDenied = isDbPermissionDeniedError(updateError);
        if (permDenied) {
          console.error("[LOAN_REJECT_PERMISSION_DENIED]", {
            loanId,
            actorId: actor.id,
            table: "loans",
            operation: "update",
            code: updateError.code || "42501",
            keyStatus: inspectServerSupabaseEnv().keyStatus
          });
        }
        return res.status(500).json({
          error: permDenied ? "Izin database server untuk menolak peminjaman pada tabel loans belum aktif (kode 42501). Pastikan migrasi GRANT service_role pada public.loans sudah dijalankan." : `Gagal menolak peminjaman: ${updateError.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : updateError.code || "LOAN_REJECT_FAILED"
        });
      }
      if (!updatedRows || updatedRows.length === 0) {
        return res.status(409).json({
          error: "Permintaan peminjaman ini sudah diproses oleh admin lain.",
          code: "CONCURRENT_LOAN_MODIFICATION"
        });
      }
      const updatedLoan = updatedRows[0];
      const [{ data: enrichedBookRows }, { data: enrichedProfileRows }] = await Promise.all([
        supabaseAdmin.from("books").select("id, title, author, cover_path").eq("id", updatedLoan.book_id).limit(2),
        supabaseAdmin.from("profiles").select("id, full_name, username").eq("id", updatedLoan.user_id).limit(2)
      ]);
      try {
        await supabaseAdmin.from("activity_logs").insert({
          actor_id: actor.id,
          action: "reject_loan",
          entity_type: "loans",
          entity_id: loanId,
          details: JSON.stringify({ reason: cleanReason }),
          created_at: nowIso
        });
      } catch {
      }
      return res.json({
        success: true,
        loan: {
          ...updatedLoan,
          book: enrichedBookRows?.[0] ?? void 0,
          profile: enrichedProfileRows?.[0] ?? void 0
        }
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Gagal menolak peminjaman.",
        code: "INTERNAL_REJECT_ERROR"
      });
    }
  });
  app2.post("/api/books/:id/read-url", async (req, res) => {
    try {
      const bookId = String(req.params.id || "").trim();
      if (!isValidUuid(bookId)) {
        return res.status(400).json({
          error: "ID buku tidak valid.",
          code: "INVALID_BOOK_ID"
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
      const authCheck = await verifyAuthenticatedUser(
        req,
        supabaseAuth,
        supabaseAdmin,
        "mengakses dokumen digital buku"
      );
      if (!authCheck.ok) {
        return res.status(authCheck.status).json({ error: authCheck.error });
      }
      const actor = authCheck.userProfile;
      const isActorAdmin = isAdminOrSuperAdminRole(actor.role) || actor.is_super_admin === true;
      const { data: bookRows, error: bookErr } = await supabaseAdmin.from("books").select("id, title, file_path, file_type, is_archived").eq("id", bookId).limit(2);
      if (bookErr) {
        const permDenied = isDbPermissionDeniedError(bookErr);
        return res.status(500).json({
          error: `Gagal memeriksa dokumen buku: ${bookErr.message}`,
          code: permDenied ? "DB_PERMISSION_DENIED" : bookErr.code || "BOOK_FETCH_FAILED"
        });
      }
      if (!bookRows || bookRows.length === 0) {
        return res.status(404).json({
          error: "Data buku tidak ditemukan.",
          code: "BOOK_NOT_FOUND"
        });
      }
      const book = bookRows[0];
      if (!book.file_path) {
        return res.status(404).json({
          error: "Buku ini tidak memiliki lampiran dokumen digital (koleksi fisik).",
          code: "NO_DIGITAL_FILE"
        });
      }
      if (!isActorAdmin) {
        const { data: activeLoanRows, error: loanErr } = await supabaseAdmin.from("loans").select("id, status, due_at").eq("user_id", actor.id).eq("book_id", bookId).in("status", ["approved", "borrowed"]).limit(10);
        if (loanErr) {
          const permDenied = isDbPermissionDeniedError(loanErr);
          return res.status(500).json({
            error: `Gagal memverifikasi hak akses peminjaman: ${loanErr.message}`,
            code: permDenied ? "DB_PERMISSION_DENIED" : loanErr.code || "LOAN_CHECK_FAILED"
          });
        }
        if (!activeLoanRows || activeLoanRows.length === 0) {
          return res.status(403).json({
            error: "Anda belum memiliki peminjaman aktif yang disetujui untuk membaca dokumen digital buku ini.",
            code: "FORBIDDEN"
          });
        }
        const nowMs = Date.now();
        const hasValidUnexpiredLoan = activeLoanRows.some((loan) => {
          if (!loan.due_at) return true;
          const dueMs = new Date(loan.due_at).getTime();
          return Number.isNaN(dueMs) || dueMs >= nowMs;
        });
        if (!hasValidUnexpiredLoan) {
          return res.status(403).json({
            error: "Masa peminjaman untuk membaca dokumen digital ini telah berakhir. Silakan kembalikan buku atau ajukan peminjaman ulang.",
            code: "LOAN_EXPIRED"
          });
        }
      }
      const { data: signedData, error: signedErr } = await supabaseAdmin.storage.from("book-files").createSignedUrl(book.file_path, 7200);
      if (signedErr || !signedData?.signedUrl) {
        return res.status(500).json({
          error: signedErr?.message || "Gagal membuat tautan baca dokumen digital.",
          code: "SIGNED_URL_FAILED"
        });
      }
      return res.json({
        success: true,
        url: signedData.signedUrl,
        fileType: book.file_type || "pdf"
      });
    } catch (err) {
      return res.status(500).json({
        error: err?.message || "Terjadi kesalahan saat menyiapkan dokumen digital.",
        code: "INTERNAL_READ_URL_ERROR"
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
