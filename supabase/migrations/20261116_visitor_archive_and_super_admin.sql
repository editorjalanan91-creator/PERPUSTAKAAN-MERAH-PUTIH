-- ============================================================================
-- Migrasi Final Penyelarasan: Status Arsip Pengunjung, is_admin(), & Super Admin
-- Aplikasi: PERPUSTAKAAN MERAH PUTIH
-- Ketentuan Wajib:
--   1. Idempotent & aman untuk database Production yang sudah berisi data
--   2. TIDAK mengubah role atau menghapus 1 akun admin & 5 akun visitor yang ada
--   3. TIDAK menghapus atau menonaktifkan 7 policy RLS yang sudah berjalan
--   4. TIDAK menetapkan Super Admin otomatis sebelum verifikasi UID
--   5. Menjaga keutuhan riwayat peminjaman (loans) & activity_logs
-- ============================================================================

-- 1. Tambahkan kolom status arsip dan flag Super Admin pada public.profiles
--    is_super_admin bernilai default false sehingga tidak ada asumsi otomatis.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_by UUID NULL,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Pastikan profil lama yang is_active-nya NULL tersinkronisasi aman ke true
UPDATE public.profiles
SET is_active = true
WHERE is_active IS NULL AND archived_at IS NULL;

-- 2. Indeks pendukung performa query manajemen pengunjung & cek pinjaman aktif
CREATE INDEX IF NOT EXISTS idx_profiles_role_active
  ON public.profiles (role, is_active);

CREATE INDEX IF NOT EXISTS idx_loans_user_status
  ON public.loans (user_id, status);

CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_created
  ON public.activity_logs (actor_id, created_at DESC);

-- 3. Jaga keutuhan histori activity_logs apabila pengunjung tanpa riwayat pinjaman dihapus permanen
ALTER TABLE public.activity_logs
  ALTER COLUMN actor_id DROP NOT NULL;

DO $$
DECLARE
  v_con RECORD;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.activity_logs'::regclass
      AND confrelid = 'public.profiles'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE public.activity_logs DROP CONSTRAINT %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.activity_logs
    ADD CONSTRAINT activity_logs_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
END;
$$;

-- 4. Selaraskan public.is_admin() secara in-place (tanpa parameter, cocok dengan 7 policy RLS)
--    - Menggunakan SET search_path = '' (paling ketat untuk SECURITY DEFINER)
--    - Memakai referensi schema lengkap public.profiles dan auth.uid()
--    - Mengenali role IN ('admin', 'super_admin') maupun is_super_admin = true
--    - Tetap menolak akun visitor dan akun admin yang berstatus arsip / non-aktif
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'super_admin')
        OR COALESCE(p.is_super_admin, false) = true
      )
      AND COALESCE(p.is_active, true) = true
      AND p.archived_at IS NULL
  );
$$;

-- 5. Guard kolom sensitif public.profiles (defense-in-depth tanpa mengubah 7 policy RLS lama)
--    - Mencegah pengunjung mengubah role, is_super_admin, atau status arsip sendiri
--    - Mencegah admin biasa mengubah status perlindungan is_super_admin
CREATE OR REPLACE FUNCTION public.guard_profiles_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_privileged_context BOOLEAN := false;
BEGIN
  v_is_privileged_context := (
    current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF v_is_privileged_context THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'visitor' AND NEW.role IS DISTINCT FROM 'user' THEN
      RAISE EXCEPTION 'Pengguna biasa tidak diizinkan menetapkan role administrator.';
    END IF;
    IF COALESCE(NEW.is_super_admin, false) = true THEN
      RAISE EXCEPTION 'Pengguna biasa tidak diizinkan menetapkan status Super Admin.';
    END IF;
    IF COALESCE(NEW.is_active, true) = false OR NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'Pengguna biasa tidak diizinkan mengatur status arsip secara langsung.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(NEW.is_super_admin, false) IS DISTINCT FROM COALESCE(OLD.is_super_admin, false) THEN
      RAISE EXCEPTION 'Status perlindungan Super Admin tidak boleh diubah dari sisi aplikasi.';
    END IF;

    IF NOT public.is_admin() THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Pengunjung tidak diperbolehkan mengubah role akun.';
      END IF;
      IF COALESCE(NEW.is_active, true) IS DISTINCT FROM COALESCE(OLD.is_active, true)
         OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
         OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
        RAISE EXCEPTION 'Pengunjung tidak diperbolehkan mengubah status arsip akun.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_guard_profiles_sensitive_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_sensitive_columns();

-- 6. Proteksi tingkat database pada public.profiles untuk Super Admin
--    - Mencegah DELETE pada akun Super Admin (sekaligus membatalkan cascade dari auth.users)
--    - Mencegah pengarsipan (is_active = false / archived_at IS NOT NULL) pada Super Admin
--    - Mencegah penurunan role / flag is_super_admin pada Super Admin
--    - Mendukung penandaan via role='super_admin', is_super_admin=true, maupun setting app.super_admin_uids
CREATE OR REPLACE FUNCTION public.prevent_super_admin_deletion_or_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_uid_listed BOOLEAN := false;
BEGIN
  v_uid_listed := OLD.id::text = ANY(
    string_to_array(
      replace(COALESCE(current_setting('app.super_admin_uids', true), ''), ' ', ''),
      ','
    )
  );

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' OR COALESCE(OLD.is_super_admin, false) = true OR COALESCE(v_uid_listed, false) = true THEN
      RAISE EXCEPTION 'Akun Super Admin dilindungi dan tidak boleh dihapus.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_admin' AND NEW.role IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Role akun Super Admin dilindungi dan tidak boleh diturunkan.';
    END IF;

    IF (COALESCE(OLD.is_super_admin, false) = true OR COALESCE(v_uid_listed, false) = true)
       AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Role akun Super Admin dilindungi dan tidak boleh diubah.';
    END IF;

    IF COALESCE(OLD.is_super_admin, false) = true AND COALESCE(NEW.is_super_admin, false) = false THEN
      RAISE EXCEPTION 'Status perlindungan Super Admin tidak boleh dinonaktifkan.';
    END IF;

    IF (OLD.role = 'super_admin' OR COALESCE(OLD.is_super_admin, false) = true OR COALESCE(v_uid_listed, false) = true)
       AND (NEW.is_active = false OR NEW.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Akun Super Admin dilindungi dan tidak boleh diarsipkan.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_super_admin_profiles ON public.profiles;
CREATE TRIGGER trg_protect_super_admin_profiles
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_super_admin_deletion_or_archive();

-- 7. Proteksi tingkat database pada auth.users (Supabase Authentication)
--    Mencegah DELETE maupun pemblokiran (banned_until) terhadap akun Super Admin
--    langsung di skema auth, baik jika profiles memiliki CASCADE maupun tidak.
CREATE OR REPLACE FUNCTION public.prevent_super_admin_auth_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_super_admin BOOLEAN := false;
BEGIN
  SELECT (
    COALESCE((OLD.raw_app_meta_data->>'is_super_admin')::boolean, false)
    OR OLD.raw_app_meta_data->>'role' = 'super_admin'
    OR OLD.id::text = ANY(
      string_to_array(
        replace(COALESCE(current_setting('app.super_admin_uids', true), ''), ' ', ''),
        ','
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = OLD.id
        AND (p.role = 'super_admin' OR COALESCE(p.is_super_admin, false) = true)
    )
  )
  INTO v_is_super_admin;

  IF NOT COALESCE(v_is_super_admin, false) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Akun Super Admin dilindungi di Supabase Authentication dan tidak boleh dihapus.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.banned_until IS NOT NULL
       AND NEW.banned_until > NOW()
       AND (OLD.banned_until IS NULL OR OLD.banned_until <= NOW()) THEN
      RAISE EXCEPTION 'Akun Super Admin dilindungi di Supabase Authentication dan tidak boleh diblokir/diarsipkan.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- FAIL-CLOSED: Tanpa EXCEPTION WHEN insufficient_privilege.
-- Jika role eksekutor tidak berhak memasang trigger pada auth.users,
-- seluruh transaksi migrasi wajib dibatalkan dan dinyatakan gagal secara eksplisit.
DROP TRIGGER IF EXISTS trg_protect_super_admin_auth_users ON auth.users;
CREATE TRIGGER trg_protect_super_admin_auth_users
  BEFORE UPDATE OR DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_super_admin_auth_deletion();

-- 8. Verifikasi eksplisit pasca-pembuatan trigger (FAIL-CLOSED)
--    Memastikan kedua trigger perlindungan Super Admin benar-benar terpasang dan aktif.
DO $$
DECLARE
  v_auth_trigger_active BOOLEAN := false;
  v_profiles_trigger_active BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'trg_protect_super_admin_auth_users'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  )
  INTO v_auth_trigger_active;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'trg_protect_super_admin_profiles'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  )
  INTO v_profiles_trigger_active;

  IF NOT v_auth_trigger_active THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Trigger perlindungan Super Admin trg_protect_super_admin_auth_users pada auth.users tidak terpasang atau non-aktif. Migrasi dibatalkan.';
  END IF;

  IF NOT v_profiles_trigger_active THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Trigger perlindungan Super Admin trg_protect_super_admin_profiles pada public.profiles tidak terpasang atau non-aktif. Migrasi dibatalkan.';
  END IF;
END;
$$;

-- ============================================================================
-- CATATAN VERIFIKASI UID SUPER ADMIN (TIDAK OTOMATIS):
-- File migrasi ini TIDAK otomatis menandai akun admin sebagai Super Admin.
-- Setelah migrasi dijalankan dan Anda memverifikasi UID resmi yang cocok dengan
-- secret SUPABASE_SUPER_ADMIN_UIDS via:
--   SELECT p.id, u.email, p.username, p.role FROM public.profiles p
--   JOIN auth.users u ON u.id = p.id WHERE p.role IN ('admin', 'super_admin');
-- baru jalankan blok terpisah dengan mengganti <VERIFIED_SUPER_ADMIN_UID>:
--
-- DO $$
-- DECLARE
--   v_verified_uid UUID := '<VERIFIED_SUPER_ADMIN_UID>'::uuid;
--   v_updated INT := 0;
-- BEGIN
--   UPDATE public.profiles
--   SET is_super_admin = true, is_active = true, updated_at = NOW()
--   WHERE id = v_verified_uid AND role IN ('admin', 'super_admin');
--   GET DIAGNOSTICS v_updated = ROW_COUNT;
--   IF v_updated <> 1 THEN
--     RAISE EXCEPTION 'Verifikasi UID Super Admin gagal untuk %', v_verified_uid;
--   END IF;
-- END;
-- $$;
--
-- CATATAN RLS:
-- Skrip migrasi ini sengaja TIDAK menjalankan ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY
-- maupun DROP/CREATE POLICY sehingga seluruh 7 policy RLS Production tetap utuh.
-- ============================================================================
