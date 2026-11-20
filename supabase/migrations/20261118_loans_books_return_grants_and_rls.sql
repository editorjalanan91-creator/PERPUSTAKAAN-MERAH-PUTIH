-- ============================================================================
-- Migrasi Final (Hasil Audit Keamanan): Penyelarasan GRANT, RLS & Integritas
-- Aplikasi: PERPUSTAKAAN MERAH PUTIH
-- Target:
--   1. Mengatasi SQLSTATE 42501 ("permission denied for table loans") pada
--      backend service_role (POST /api/loans/:id/return, approve, reject)
--   2. Mencabut GRANT UPDATE & DELETE pada public.loans dari authenticated & anon
--   3. Memasang policy AS RESTRICTIVE agar policy lama yang terlalu luas
--      tidak bisa membocorkan data / mengizinkan manipulasi tanpa menghapus
--      policy Production sebelum diaudit
--   4. Mengamankan public.is_admin() & guard_profiles_sensitive_columns()
--      (SECURITY INVOKER) agar role admin tidak dapat dimanipulasi user
--   5. Memastikan pengembalian tidak dapat diproses dua kali & data aman
--
-- Ketentuan Wajib:
--   - Idempotent & aman untuk database Production yang sudah berisi data
--   - TIDAK menonaktifkan RLS pada tabel mana pun
--   - TIDAK menghapus atau mereset data apa pun
--   - TIDAK menghapus policy lama sebelum diaudit (dibatasi dengan AS RESTRICTIVE)
-- ============================================================================

-- ============================================================================
-- PRA-AUDIT (READ-ONLY): Jalankan query di bawah secara terpisah di SQL Editor
-- jika ingin melihat daftar seluruh policy RLS & GRANT lama sebelum migrasi:
--
--   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('loans', 'books', 'categories', 'profiles', 'activity_logs')
--   ORDER BY tablename, policyname;
--
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE table_schema = 'public'
--     AND table_name IN ('loans', 'books', 'categories', 'profiles', 'activity_logs')
--   ORDER BY table_name, grantee, privilege_type;
-- ============================================================================

BEGIN;

-- 0. Audit Non-Destruktif di Log Migrasi (menampilkan policy aktif yang ada
--    tanpa menghapus policy Production yang belum diaudit)
DO $$
DECLARE
  v_pol RECORD;
BEGIN
  FOR v_pol IN
    SELECT tablename, policyname, permissive, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('loans', 'books', 'categories', 'profiles', 'activity_logs')
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE '[RLS_AUDIT] table=%, policy=%, type=%, roles=%, cmd=%',
      v_pol.tablename, v_pol.policyname, v_pol.permissive, v_pol.roles, v_pol.cmd;
  END LOOP;

  FOR v_pol IN
    SELECT policyname, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'books'
      AND (COALESCE(qual, '') ILIKE '%loans%' OR COALESCE(with_check, '') ILIKE '%loans%')
      AND policyname NOT IN ('books_select_published_or_admin', 'books_restrict_select_published_or_admin')
  LOOP
    RAISE WARNING '[RLS_BOOKS_LOANS_REF] Legacy policy "%" (cmd=%, roles=%) pada public.books mereferensikan tabel loans secara langsung dan dapat memicu 42501 bagi anon. Audit & hapus policy lama tersebut jika katalog publik memunculkan 42501.',
      v_pol.policyname, v_pol.cmd, v_pol.roles;
  END LOOP;
END;
$$;

-- 1. Pastikan Row Level Security tetap AKTIF pada seluruh tabel terkait
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 2. Pengamanan public.is_admin() & public.guard_profiles_sensitive_columns()
--    a) public.is_admin():
--       - SECURITY DEFINER + SET search_path = '' (mencegah search_path hijacking
--         dan mencegah rekursi RLS pada public.profiles)
--       - Wajib auth.uid() IS NOT NULL dan menolak role 'anon'
--       - Sumber otoritas tunggal dari tabel public.profiles (bukan user_metadata JWT)
--       - Menolak akun admin yang berstatus arsip / non-aktif
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), ''),
      ''
    ) <> 'anon'
    AND EXISTS (
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

--    a2) public.has_user_loan_for_book(UUID):
--        - SECURITY DEFINER + SET search_path = '' agar policy SELECT pada public.books
--          tidak mengevaluasi subquery langsung ke public.loans dengan hak akses 'anon'
--          (yang akan memicu SQLSTATE 42501 permission denied for table loans saat
--          pengunjung belum login membuka katalog buku).
--        - Hanya mengembalikan BOOLEAN untuk auth.uid() yang sedang login.
CREATE OR REPLACE FUNCTION public.has_user_loan_for_book(p_book_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), ''),
      ''
    ) <> 'anon'
    AND EXISTS (
      SELECT 1
      FROM public.loans l
      WHERE l.book_id = p_book_id
        AND l.user_id = auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_user_loan_for_book(UUID) TO authenticated, anon, service_role;

--    b) public.guard_profiles_sensitive_columns():
--       - PENTING: Gunakan SECURITY INVOKER (default, BUKAN SECURITY DEFINER!)
--         agar current_user benar-benar mencerminkan role pemanggil ('authenticated',
--         'anon', 'service_role', atau 'postgres'), bukan selalu 'postgres'.
--       - Mencegah pengunjung mengubah role, is_super_admin, is_active,
--         archived_at, atau archived_by pada public.profiles untuk memanipulasi is_admin().
CREATE OR REPLACE FUNCTION public.guard_profiles_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT := '';
  v_is_privileged_context BOOLEAN := false;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE
      WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      ELSE ''
    END,
    ''
  );

  v_is_privileged_context := (
    current_user IN ('service_role', 'supabase_admin', 'supabase_auth_admin')
    OR v_jwt_role = 'service_role'
    OR (current_user = 'postgres' AND v_jwt_role = '')
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

-- 3. Penyelarasan Privilege Tingkat Tabel (GRANT / REVOKE) - Least Privilege
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;

--    a) Bersihkan privilege bawaan berlebihan dari PUBLIC, anon, dan authenticated
--       pada seluruh tabel inti (termasuk REFERENCES, TRIGGER, TRUNCATE, dan DML).
REVOKE ALL ON TABLE
  public.loans,
  public.books,
  public.categories,
  public.profiles,
  public.activity_logs
FROM PUBLIC, anon, authenticated;

--    b) service_role (hanya dipakai oleh backend server / Vercel Functions):
--       Catatan PostgreSQL: BYPASSRLS pada service_role TIDAK melewati table-level GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.books TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_logs TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

--    c) anon (pengunjung belum login):
--       HANYA boleh SELECT pada public.books dan public.categories.
--       Tidak memiliki akses apa pun (termasuk REFERENCES, TRIGGER, TRUNCATE, DML)
--       pada loans, profiles, & activity_logs, maupun hak selain SELECT pada books & categories.
GRANT SELECT ON TABLE public.books TO anon;
GRANT SELECT ON TABLE public.categories TO anon;

--    d) authenticated (user login di browser):
--       - TIDAK memiliki REFERENCES, TRIGGER, atau TRUNCATE pada tabel inti mana pun.
--       - public.loans: HANYA SELECT & INSERT kolom pengajuan awal; TIDAK boleh UPDATE/DELETE.
--         Seluruh pengembalian (/api/loans/:id/return), persetujuan, dan
--         penolakan berjalan eksklusif di backend via SUPABASE_SERVICE_ROLE_KEY.
GRANT SELECT ON TABLE public.loans TO authenticated;
GRANT INSERT (user_id, book_id, status, requested_at, admin_note) ON TABLE public.loans TO authenticated;

--       - public.books & public.categories: hak DML dipertahankan karena Admin UI
--         (libraryService.ts) masih menggunakannya secara langsung (categories CRUD &
--         fallback books CRUD), dan dikunci ketat oleh policy AS RESTRICTIVE
--         (public.is_admin()) sehingga visitor non-admin selalu ditolak.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.books TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO authenticated;

--       - public.profiles: authenticated hanya boleh SELECT (dibatasi RLS milik
--         sendiri / admin) dan UPDATE kolom non-sensitif (full_name, username, updated_at).
--         Tidak boleh INSERT maupun DELETE; arsip & hapus pengunjung via backend service_role.
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, username, updated_at) ON TABLE public.profiles TO authenticated;

--       - public.activity_logs: hanya boleh SELECT (admin) & INSERT (own/admin).
GRANT SELECT, INSERT ON TABLE public.activity_logs TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 4. Penyelarasan Policy RLS (Hasil Audit DROP POLICY IF EXISTS):
--    - Audit menyeluruh DROP POLICY IF EXISTS pada migrasi ini:
--      1) `loans_visitor_return_own_active`: draft policy lama milik versi awal
--         migrasi 20261118 (pengembalian sekarang eksklusif via backend service_role).
--      2) Seluruh `DROP POLICY IF EXISTS` lainnya selalu berpasangan 1:1 dengan
--         `CREATE POLICY` bernama identik tepat di bawahnya sebagai bagian penyelarasan.
--    - Policy legacy Production yang belum diaudit (termasuk policy seperti
--      `loans_admin_manage_all` atau policy bawaan lainnya) TIDAK dihapus;
--      sebagai gantinya, dipasang policy AS RESTRICTIVE (operator AND) sehingga
--      policy lama yang terlalu luas otomatis ternetralisasi oleh PostgreSQL.
DROP POLICY IF EXISTS loans_visitor_return_own_active ON public.loans;

--    a) Policy dasar PERMISSIVE pada public.loans
DROP POLICY IF EXISTS loans_select_own_or_admin ON public.loans;
CREATE POLICY loans_select_own_or_admin
  ON public.loans
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS loans_insert_own_pending_or_admin ON public.loans;
CREATE POLICY loans_insert_own_pending_or_admin
  ON public.loans
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      auth.uid() = user_id
      AND status = 'pending'
      AND approved_at IS NULL
      AND due_at IS NULL
      AND returned_at IS NULL
    )
    OR public.is_admin()
  );

--    b) Policy AS RESTRICTIVE (operator AND) pada public.loans:
--       Mengunci SELECT, INSERT, UPDATE, DELETE sekalipun ada policy lama yang longgar
--       tanpa menghapus policy Production yang belum diaudit.
DROP POLICY IF EXISTS loans_restrict_select_own_or_admin ON public.loans;
CREATE POLICY loans_restrict_select_own_or_admin
  ON public.loans
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (
    auth.uid() = user_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS loans_restrict_insert_own_pending_strict ON public.loans;
CREATE POLICY loans_restrict_insert_own_pending_strict
  ON public.loans
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    (
      auth.uid() = user_id
      AND status = 'pending'
      AND approved_at IS NULL
      AND due_at IS NULL
      AND returned_at IS NULL
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS loans_restrict_deny_client_update ON public.loans;
CREATE POLICY loans_restrict_deny_client_update
  ON public.loans
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS loans_restrict_deny_client_delete ON public.loans;
CREATE POLICY loans_restrict_deny_client_delete
  ON public.loans
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

--    c) Policy dasar + AS RESTRICTIVE pada public.books
DROP POLICY IF EXISTS books_select_published_or_admin ON public.books;
CREATE POLICY books_select_published_or_admin
  ON public.books
  FOR SELECT
  TO authenticated, anon
  USING (
    (COALESCE(is_published, true) = true AND COALESCE(is_archived, false) = false)
    OR public.is_admin()
    OR public.has_user_loan_for_book(id)
  );

DROP POLICY IF EXISTS books_admin_manage_all ON public.books;
CREATE POLICY books_admin_manage_all
  ON public.books
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS books_restrict_select_published_or_admin ON public.books;
CREATE POLICY books_restrict_select_published_or_admin
  ON public.books
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (
    (COALESCE(is_published, true) = true AND COALESCE(is_archived, false) = false)
    OR public.is_admin()
    OR public.has_user_loan_for_book(id)
  );

DROP POLICY IF EXISTS books_restrict_insert_admin ON public.books;
CREATE POLICY books_restrict_insert_admin
  ON public.books
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS books_restrict_update_admin ON public.books;
CREATE POLICY books_restrict_update_admin
  ON public.books
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS books_restrict_delete_admin ON public.books;
CREATE POLICY books_restrict_delete_admin
  ON public.books
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (public.is_admin());

--    d) Policy dasar + AS RESTRICTIVE pada public.activity_logs
DROP POLICY IF EXISTS activity_logs_insert_own_or_admin ON public.activity_logs;
CREATE POLICY activity_logs_insert_own_or_admin
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = actor_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS activity_logs_select_admin ON public.activity_logs;
CREATE POLICY activity_logs_select_admin
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS activity_logs_restrict_insert_own ON public.activity_logs;
CREATE POLICY activity_logs_restrict_insert_own
  ON public.activity_logs
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    auth.uid() = actor_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS activity_logs_restrict_select_admin ON public.activity_logs;
CREATE POLICY activity_logs_restrict_select_admin
  ON public.activity_logs
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (public.is_admin());

--    e) Policy dasar + AS RESTRICTIVE pada public.categories
DROP POLICY IF EXISTS categories_select_active_or_admin ON public.categories;
CREATE POLICY categories_select_active_or_admin
  ON public.categories
  FOR SELECT
  TO authenticated, anon
  USING (
    COALESCE(is_active, true) = true
    OR public.is_admin()
  );

DROP POLICY IF EXISTS categories_admin_manage_all ON public.categories;
CREATE POLICY categories_admin_manage_all
  ON public.categories
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS categories_restrict_select_active_or_admin ON public.categories;
CREATE POLICY categories_restrict_select_active_or_admin
  ON public.categories
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (
    COALESCE(is_active, true) = true
    OR public.is_admin()
  );

DROP POLICY IF EXISTS categories_restrict_insert_admin ON public.categories;
CREATE POLICY categories_restrict_insert_admin
  ON public.categories
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS categories_restrict_update_admin ON public.categories;
CREATE POLICY categories_restrict_update_admin
  ON public.categories
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS categories_restrict_delete_admin ON public.categories;
CREATE POLICY categories_restrict_delete_admin
  ON public.categories
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (public.is_admin());

--    f) Policy dasar + AS RESTRICTIVE pada public.profiles
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_admin()
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_restrict_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_restrict_select_own_or_admin
  ON public.profiles
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated, anon
  USING (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_restrict_insert_deny_client ON public.profiles;
CREATE POLICY profiles_restrict_insert_deny_client
  ON public.profiles
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS profiles_restrict_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_restrict_update_own_or_admin
  ON public.profiles
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (
    auth.uid() = id
    OR public.is_admin()
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_restrict_delete_deny_client ON public.profiles;
CREATE POLICY profiles_restrict_delete_deny_client
  ON public.profiles
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

--    g) Policy Storage Buckets ('book-covers' publik baca, 'book-files' privat)
DROP POLICY IF EXISTS pmp_storage_book_covers_select ON storage.objects;
CREATE POLICY pmp_storage_book_covers_select
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'book-covers');

DROP POLICY IF EXISTS pmp_storage_book_covers_insert ON storage.objects;
CREATE POLICY pmp_storage_book_covers_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'book-covers' AND public.is_admin());

DROP POLICY IF EXISTS pmp_storage_book_covers_update ON storage.objects;
CREATE POLICY pmp_storage_book_covers_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'book-covers' AND public.is_admin())
  WITH CHECK (bucket_id = 'book-covers' AND public.is_admin());

DROP POLICY IF EXISTS pmp_storage_book_covers_delete ON storage.objects;
CREATE POLICY pmp_storage_book_covers_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'book-covers' AND public.is_admin());

DROP POLICY IF EXISTS pmp_storage_book_files_select ON storage.objects;
CREATE POLICY pmp_storage_book_files_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'book-files'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1
        FROM public.loans l
        JOIN public.books b ON b.id = l.book_id
        WHERE l.user_id = auth.uid()
          AND l.status IN ('approved', 'borrowed')
          AND (l.due_at IS NULL OR l.due_at >= NOW())
          AND b.file_path = name
      )
    )
  );

DROP POLICY IF EXISTS pmp_storage_book_files_insert ON storage.objects;
CREATE POLICY pmp_storage_book_files_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'book-files' AND public.is_admin());

DROP POLICY IF EXISTS pmp_storage_book_files_update ON storage.objects;
CREATE POLICY pmp_storage_book_files_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'book-files' AND public.is_admin())
  WITH CHECK (bucket_id = 'book-files' AND public.is_admin());

DROP POLICY IF EXISTS pmp_storage_book_files_delete ON storage.objects;
CREATE POLICY pmp_storage_book_files_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'book-files' AND public.is_admin());

-- 5. Trigger Penjaga Integritas Transaksi Peminjaman (Defense-in-Depth)
--    - SECURITY INVOKER agar current_user mencerminkan role pemanggil sebenarnya.
--    - Melarang UPDATE / DELETE langsung dari role non-privileged (authenticated/anon).
--    - Melarang pengunjung memalsukan status/user_id/tanggal pada INSERT.
--    - Memastikan buku tersedia, terbit, tidak diarsipkan, peminjam aktif,
--      dan tidak ada pinjaman aktif/pending ganda pada buku yang sama.
--    - Melarang pemrosesan ulang transaksi yang sudah berstatus 'returned'
--      (bahkan oleh backend sekalipun) sehingga pengembalian tidak bisa 2x.
CREATE OR REPLACE FUNCTION public.guard_loans_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT := '';
  v_is_privileged_context BOOLEAN := false;
  v_book_published BOOLEAN := false;
  v_book_archived BOOLEAN := false;
  v_book_available INT := 0;
  v_borrower_active BOOLEAN := false;
  v_has_duplicate_active BOOLEAN := false;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE
      WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      ELSE ''
    END,
    ''
  );

  v_is_privileged_context := (
    current_user IN ('service_role', 'supabase_admin', 'supabase_auth_admin')
    OR v_jwt_role = 'service_role'
    OR (current_user = 'postgres' AND v_jwt_role = '')
    OR NULLIF(current_setting('app.atomic_loan_rpc', true), '') = 'true'
  );

  IF TG_OP = 'DELETE' THEN
    IF NOT v_is_privileged_context THEN
      RAISE EXCEPTION 'Pengunjung/client tidak diizinkan menghapus riwayat peminjaman.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_privileged_context THEN
      IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Pengunjung hanya dapat mengajukan peminjaman atas nama akun sendiri.';
      END IF;
      IF NEW.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Pengajuan peminjaman baru wajib berstatus pending.';
      END IF;
      IF NEW.approved_at IS NOT NULL OR NEW.due_at IS NOT NULL OR NEW.returned_at IS NOT NULL THEN
        RAISE EXCEPTION 'Tanggal persetujuan, jatuh tempo, atau pengembalian tidak boleh diisi oleh pengunjung.';
      END IF;
    END IF;

    SELECT
      COALESCE(b.is_published, true),
      COALESCE(b.is_archived, false),
      COALESCE(b.available_copies, 0)
    INTO v_book_published, v_book_archived, v_book_available
    FROM public.books b
    WHERE b.id = NEW.book_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Buku target peminjaman tidak ditemukan di database.';
    END IF;

    IF NOT v_book_published OR v_book_archived THEN
      RAISE EXCEPTION 'Buku yang diarsipkan atau belum dipublikasikan tidak dapat dipinjam.';
    END IF;

    IF NEW.status IN ('pending', 'approved', 'borrowed') AND v_book_available <= 0 THEN
      RAISE EXCEPTION 'Stok eksemplar buku saat ini habis dan tidak dapat dipinjam.';
    END IF;

    SELECT (COALESCE(p.is_active, true) = true AND p.archived_at IS NULL)
    INTO v_borrower_active
    FROM public.profiles p
    WHERE p.id = NEW.user_id;

    IF NOT COALESCE(v_borrower_active, false) THEN
      RAISE EXCEPTION 'Akun peminjam berstatus arsip/non-aktif dan tidak dapat mengajukan peminjaman.';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.loans l
      WHERE l.user_id = NEW.user_id
        AND l.book_id = NEW.book_id
        AND l.status IN ('pending', 'approved', 'borrowed')
    )
    INTO v_has_duplicate_active;

    IF v_has_duplicate_active AND NEW.status IN ('pending', 'approved', 'borrowed') THEN
      RAISE EXCEPTION 'Anda masih memiliki pengajuan atau peminjaman aktif untuk buku yang sama.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT v_is_privileged_context THEN
      RAISE EXCEPTION 'Perubahan status transaksi peminjaman hanya boleh diproses melalui endpoint backend resmi.';
    END IF;

    -- Cegah mutasi ulang terhadap transaksi yang sudah selesai dikembalikan ('returned')
    IF OLD.status = 'returned' THEN
      IF NEW.status IS DISTINCT FROM 'returned'
         OR NEW.returned_at IS DISTINCT FROM OLD.returned_at
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.book_id IS DISTINCT FROM OLD.book_id
         OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
        RAISE EXCEPTION 'Transaksi peminjaman yang sudah berstatus returned tidak dapat diubah atau diproses ulang.';
      END IF;
    END IF;

    -- Saat transisi menuju 'returned', kunci field identitas & tanggal asli transaksi
    IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
      IF OLD.status NOT IN ('approved', 'borrowed') THEN
        RAISE EXCEPTION 'Hanya transaksi aktif (approved/borrowed) yang dapat dikembalikan.';
      END IF;
      IF NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.book_id IS DISTINCT FROM OLD.book_id
         OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
        RAISE EXCEPTION 'Identitas peminjam, buku, dan tanggal pengajuan tidak boleh diubah saat pengembalian.';
      END IF;
      NEW.returned_at := COALESCE(NEW.returned_at, NOW());
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_loans_integrity ON public.loans;
CREATE TRIGGER trg_guard_loans_integrity
  BEFORE INSERT OR UPDATE OR DELETE ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_loans_integrity();

-- 5b. Fungsi Transaksi Atomik Persetujuan & Pengembalian Buku (Row Locking FOR UPDATE)
--     - Mengunci baris loans lalu baris books (urutan deterministik mencegah deadlock)
--     - Menjamin pembaruan status transaksi & stok buku berjalan dalam 1 transaksi atomik
--     - Mencegah persetujuan bersamaan menghasilkan stok negatif atau pengurangan/penambahan ganda
--     - Hanya dapat dieksekusi oleh service_role / backend server
CREATE OR REPLACE FUNCTION public.approve_loan_atomic(
  p_loan_id UUID,
  p_actor_id UUID,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_updated_loan public.loans%ROWTYPE;
  v_book RECORD;
  v_actor_is_admin BOOLEAN := false;
  v_now TIMESTAMPTZ := NOW();
  v_note TEXT;
  v_before_available INT := 0;
  v_after_available INT := 0;
  v_stock_source TEXT := 'none';
  v_stock_adjusted BOOLEAN := false;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 403,
      'code', 'FORBIDDEN',
      'error', 'Identitas administrator wajib disertakan untuk menyetujui peminjaman.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_id
      AND (
        p.role IN ('admin', 'super_admin')
        OR COALESCE(p.is_super_admin, false) = true
      )
      AND COALESCE(p.is_active, true) = true
      AND p.archived_at IS NULL
  )
  INTO v_actor_is_admin;

  IF NOT COALESCE(v_actor_is_admin, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 403,
      'code', 'FORBIDDEN',
      'error', 'Hanya administrator aktif yang berwenang menyetujui peminjaman buku.'
    );
  END IF;

  -- 1. Kunci baris transaksi peminjaman secara eksklusif (mencegah double-approve)
  SELECT l.*
  INTO v_loan
  FROM public.loans l
  WHERE l.id = p_loan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 404,
      'code', 'LOAN_NOT_FOUND',
      'error', 'Data transaksi peminjaman tidak ditemukan.'
    );
  END IF;

  IF v_loan.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 409,
      'code', 'INVALID_LOAN_STATUS',
      'error', 'Permintaan peminjaman ini sudah diproses sebelumnya dan tidak dapat disetujui ulang.'
    );
  END IF;

  -- 2. Kunci baris buku target secara eksklusif (urutan deterministik loans -> books)
  SELECT b.id, b.available_copies, b.total_copies, COALESCE(b.is_archived, false) AS is_archived
  INTO v_book
  FROM public.books b
  WHERE b.id = v_loan.book_id
  FOR UPDATE;

  IF NOT FOUND OR v_book.is_archived OR COALESCE(v_book.available_copies, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 409,
      'code', 'BOOK_UNAVAILABLE',
      'error', 'Stok eksemplar buku sudah habis atau buku diarsipkan sehingga peminjaman tidak dapat disetujui.'
    );
  END IF;

  v_before_available := COALESCE(v_book.available_copies, 0);
  v_note := COALESCE(
    NULLIF(LEFT(BTRIM(COALESCE(p_admin_note, '')), 500), ''),
    'Peminjaman telah disetujui administrator perpustakaan.'
  );

  -- 3. Perbarui status pinjaman ke 'approved' tanpa jatuh tempo otomatis (due_at = NULL)
  PERFORM set_config('app.atomic_loan_rpc', 'true', true);

  UPDATE public.loans
  SET
    status = 'approved',
    approved_at = v_now,
    due_at = NULL,
    admin_note = v_note,
    updated_at = v_now
  WHERE id = p_loan_id
    AND status = 'pending'
  RETURNING * INTO v_updated_loan;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENT_LOAN_MODIFICATION: Status transaksi peminjaman berubah sebelum persetujuan selesai.';
  END IF;

  -- 4. Sinkronisasi stok buku tepat -1 dalam transaksi yang sama (menghormati trigger jika ada)
  SELECT COALESCE(b.available_copies, 0)
  INTO v_after_available
  FROM public.books b
  WHERE b.id = v_loan.book_id;

  IF v_after_available < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_BOOK_STOCK: Stok buku tidak boleh bernilai negatif.';
  END IF;

  IF v_after_available < v_before_available THEN
    IF v_after_available < v_before_available - 1 THEN
      RAISE EXCEPTION 'DOUBLE_STOCK_DECREMENT: Pengurangan stok melebihi 1 eksemplar pada satu transaksi.';
    END IF;
    v_stock_source := 'trigger';
    v_stock_adjusted := true;
  ELSE
    UPDATE public.books
    SET
      available_copies = available_copies - 1,
      updated_at = v_now
    WHERE id = v_loan.book_id
      AND available_copies = v_before_available
      AND available_copies > 0
    RETURNING available_copies INTO v_after_available;

    IF NOT FOUND OR v_after_available < 0 THEN
      RAISE EXCEPTION 'BOOK_STOCK_UPDATE_FAILED: Gagal memperbarui stok buku secara atomik saat persetujuan.';
    END IF;

    v_stock_source := 'application';
    v_stock_adjusted := true;
  END IF;

  PERFORM set_config('app.atomic_loan_rpc', '', true);

  -- 5. Log aktivitas non-kritikal (tidak menggagalkan transaksi utama)
  BEGIN
    INSERT INTO public.activity_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      p_actor_id,
      'approve_loan',
      'loans',
      p_loan_id::text,
      jsonb_build_object('stock_source', v_stock_source, 'atomic_rpc', true)::text,
      v_now
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'http_status', 200,
    'stock_adjusted', v_stock_adjusted,
    'stock_source', v_stock_source,
    'loan', to_jsonb(v_updated_loan)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.return_loan_atomic(
  p_loan_id UUID,
  p_actor_id UUID,
  p_is_admin BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_updated_loan public.loans%ROWTYPE;
  v_book RECORD;
  v_has_book BOOLEAN := false;
  v_actor_is_admin BOOLEAN := false;
  v_now TIMESTAMPTZ := NOW();
  v_before_available INT := 0;
  v_after_available INT := 0;
  v_total_copies INT := 0;
  v_target_available INT := 0;
  v_stock_source TEXT := 'none';
  v_stock_adjusted BOOLEAN := false;
BEGIN
  -- 1. Kunci baris transaksi peminjaman secara eksklusif (mencegah return paralel ganda)
  SELECT l.*
  INTO v_loan
  FROM public.loans l
  WHERE l.id = p_loan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 404,
      'code', 'LOAN_NOT_FOUND',
      'error', 'Data transaksi peminjaman tidak ditemukan.'
    );
  END IF;

  IF COALESCE(p_is_admin, false) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = p_actor_id
        AND (
          p.role IN ('admin', 'super_admin')
          OR COALESCE(p.is_super_admin, false) = true
        )
        AND COALESCE(p.is_active, true) = true
        AND p.archived_at IS NULL
    )
    INTO v_actor_is_admin;

    IF NOT COALESCE(v_actor_is_admin, false) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'http_status', 403,
        'code', 'FORBIDDEN',
        'error', 'Hanya administrator aktif yang berwenang memproses pengembalian atas nama pengguna lain.'
      );
    END IF;
  ELSIF p_actor_id IS NULL OR v_loan.user_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 403,
      'code', 'FORBIDDEN',
      'error', 'Anda tidak memiliki izin untuk mengembalikan transaksi peminjaman milik anggota lain.'
    );
  END IF;

  -- 2. Idempotensi: transaksi yang sudah returned langsung dikembalikan sukses tanpa menambah stok lagi
  IF v_loan.status = 'returned' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'http_status', 200,
      'already_returned', true,
      'stock_adjusted', false,
      'stock_source', 'none',
      'loan', to_jsonb(v_loan),
      'message', 'Buku untuk transaksi peminjaman ini sudah dikembalikan sebelumnya.'
    );
  END IF;

  IF v_loan.status NOT IN ('approved', 'borrowed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'http_status', 409,
      'code', 'INVALID_LOAN_STATUS',
      'current_status', v_loan.status,
      'error',
        CASE v_loan.status
          WHEN 'pending' THEN 'Pengajuan peminjaman yang masih menunggu persetujuan admin belum dapat dikembalikan.'
          WHEN 'rejected' THEN 'Transaksi peminjaman yang telah ditolak tidak dapat dikembalikan.'
          WHEN 'expired' THEN 'Transaksi peminjaman ini berstatus kedaluwarsa. Hubungi administrator perpustakaan untuk penyesuaian.'
          ELSE 'Status transaksi peminjaman tidak memenuhi syarat untuk proses pengembalian.'
        END
    );
  END IF;

  -- 3. Kunci baris buku terkait (urutan deterministik loans -> books)
  SELECT b.id, COALESCE(b.available_copies, 0) AS available_copies, COALESCE(b.total_copies, 0) AS total_copies
  INTO v_book
  FROM public.books b
  WHERE b.id = v_loan.book_id
  FOR UPDATE;

  v_has_book := FOUND;
  IF v_has_book THEN
    v_before_available := GREATEST(0, v_book.available_copies);
    v_total_copies := GREATEST(0, v_book.total_copies);
  END IF;

  -- 4. Perbarui status pinjaman ke 'returned' dalam transaksi yang sama
  PERFORM set_config('app.atomic_loan_rpc', 'true', true);

  UPDATE public.loans
  SET
    status = 'returned',
    returned_at = v_now,
    updated_at = v_now
  WHERE id = p_loan_id
    AND status IN ('approved', 'borrowed')
  RETURNING * INTO v_updated_loan;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENT_LOAN_MODIFICATION: Status transaksi peminjaman berubah sebelum pengembalian dikonfirmasi.';
  END IF;

  -- 5. Sinkronisasi stok buku tepat +1 (menghormati trigger DB & batas total_copies)
  IF v_has_book THEN
    SELECT COALESCE(b.available_copies, 0), COALESCE(b.total_copies, 0)
    INTO v_after_available, v_total_copies
    FROM public.books b
    WHERE b.id = v_loan.book_id;

    v_after_available := GREATEST(0, v_after_available);
    v_total_copies := GREATEST(0, v_total_copies);

    IF v_after_available > v_before_available THEN
      IF v_after_available > v_before_available + 1 THEN
        RAISE EXCEPTION 'DOUBLE_STOCK_INCREMENT: Penambahan stok melebihi 1 eksemplar pada satu transaksi pengembalian.';
      END IF;
      v_target_available := CASE
        WHEN v_total_copies > 0 THEN LEAST(v_total_copies, v_after_available)
        ELSE v_after_available
      END;
      IF v_target_available <> v_after_available THEN
        UPDATE public.books
        SET
          available_copies = v_target_available,
          updated_at = v_now
        WHERE id = v_loan.book_id
          AND available_copies = v_after_available;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'BOOK_STOCK_UPDATE_FAILED: Gagal menyelaraskan batas maksimal stok buku saat pengembalian.';
        END IF;
      END IF;
      v_stock_source := 'trigger';
      v_stock_adjusted := true;
    ELSE
      v_target_available := CASE
        WHEN v_total_copies > 0 THEN LEAST(v_total_copies, v_before_available + 1)
        ELSE v_before_available + 1
      END;
      IF v_target_available <> v_after_available THEN
        UPDATE public.books
        SET
          available_copies = v_target_available,
          updated_at = v_now
        WHERE id = v_loan.book_id
          AND available_copies = v_after_available;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'BOOK_STOCK_UPDATE_FAILED: Gagal memperbarui stok buku secara atomik saat pengembalian.';
        END IF;

        v_stock_source := 'application';
        v_stock_adjusted := true;
      ELSE
        v_stock_source := 'capped_at_total';
        v_stock_adjusted := false;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.atomic_loan_rpc', '', true);

  -- 6. Log aktivitas non-kritikal
  BEGIN
    INSERT INTO public.activity_logs (actor_id, action, entity_type, entity_id, details, created_at)
    VALUES (
      p_actor_id,
      'return_loan',
      'loans',
      p_loan_id::text,
      jsonb_build_object(
        'book_id', v_loan.book_id,
        'returned_at', v_now,
        'stock_source', v_stock_source,
        'atomic_rpc', true
      )::text,
      v_now
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'http_status', 200,
    'already_returned', false,
    'stock_adjusted', v_stock_adjusted,
    'stock_source', v_stock_source,
    'loan', to_jsonb(v_updated_loan)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_loan_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_loan_atomic(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.return_loan_atomic(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_loan_atomic(UUID, UUID, BOOLEAN) TO service_role;

-- 6. Verifikasi Pasca-Migrasi (FAIL-CLOSED)
DO $$
DECLARE
  v_core_tables TEXT[] := ARRAY[
    'public.loans',
    'public.books',
    'public.categories',
    'public.profiles',
    'public.activity_logs'
  ];
  v_tbl TEXT;
  v_rls_enabled BOOLEAN := false;
  v_anon_books_select BOOLEAN := false;
  v_anon_categories_select BOOLEAN := false;
  v_auth_loans_select BOOLEAN := false;
  v_auth_loans_insert_user BOOLEAN := false;
  v_auth_profiles_select BOOLEAN := false;
  v_auth_profiles_update_name BOOLEAN := false;
  v_auth_logs_select BOOLEAN := false;
  v_auth_logs_insert BOOLEAN := false;
  v_restrictive_dml_count INT := 0;
  v_guard_profiles_secdef BOOLEAN := true;
  v_loans_trigger_active BOOLEAN := false;
  v_approve_rpc_secdef BOOLEAN := false;
  v_return_rpc_secdef BOOLEAN := false;
  v_srv_approve_rpc BOOLEAN := false;
  v_srv_return_rpc BOOLEAN := false;
  v_auth_approve_rpc BOOLEAN := true;
  v_auth_return_rpc BOOLEAN := true;
  v_anon_approve_rpc BOOLEAN := true;
  v_anon_return_rpc BOOLEAN := true;
BEGIN
  -- 6.1 RLS wajib aktif & service_role wajib memiliki penuh SELECT/INSERT/UPDATE/DELETE
  --     serta anon & authenticated tidak boleh memiliki REFERENCES, TRIGGER, atau TRUNCATE
  FOREACH v_tbl IN ARRAY v_core_tables LOOP
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_catalog.pg_class
    WHERE oid = v_tbl::regclass;

    IF NOT COALESCE(v_rls_enabled, false) THEN
      RAISE EXCEPTION 'FAIL-CLOSED: RLS wajib aktif pada tabel %.', v_tbl;
    END IF;

    IF NOT (
      has_table_privilege('service_role', v_tbl, 'SELECT')
      AND has_table_privilege('service_role', v_tbl, 'INSERT')
      AND has_table_privilege('service_role', v_tbl, 'UPDATE')
      AND has_table_privilege('service_role', v_tbl, 'DELETE')
    ) THEN
      RAISE EXCEPTION 'FAIL-CLOSED: Privilege service_role (SELECT/INSERT/UPDATE/DELETE) pada % belum lengkap.', v_tbl;
    END IF;

    IF has_table_privilege('anon', v_tbl, 'REFERENCES')
       OR has_any_column_privilege('anon', v_tbl, 'REFERENCES')
       OR has_table_privilege('anon', v_tbl, 'TRIGGER')
       OR has_table_privilege('anon', v_tbl, 'TRUNCATE') THEN
      RAISE EXCEPTION 'FAIL-CLOSED: Role anon masih memiliki privilege terlarang (REFERENCES/TRIGGER/TRUNCATE) pada %.', v_tbl;
    END IF;

    IF has_any_column_privilege('anon', v_tbl, 'INSERT')
       OR has_any_column_privilege('anon', v_tbl, 'UPDATE')
       OR has_table_privilege('anon', v_tbl, 'DELETE') THEN
      RAISE EXCEPTION 'FAIL-CLOSED: Role anon masih memiliki privilege tulis (INSERT/UPDATE/DELETE) pada %.', v_tbl;
    END IF;

    IF has_table_privilege('authenticated', v_tbl, 'REFERENCES')
       OR has_any_column_privilege('authenticated', v_tbl, 'REFERENCES')
       OR has_table_privilege('authenticated', v_tbl, 'TRIGGER')
       OR has_table_privilege('authenticated', v_tbl, 'TRUNCATE') THEN
      RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated masih memiliki privilege terlarang (REFERENCES/TRIGGER/TRUNCATE) pada %.', v_tbl;
    END IF;
  END LOOP;

  -- 6.1b Verifikasi eksplisit has_table_privilege untuk REFERENCES dan TRIGGER
  --      bagi role anon dan authenticated pada seluruh 5 tabel inti
  IF has_table_privilege('anon', 'public.loans', 'REFERENCES')
     OR has_table_privilege('anon', 'public.loans', 'TRIGGER')
     OR has_table_privilege('anon', 'public.books', 'REFERENCES')
     OR has_table_privilege('anon', 'public.books', 'TRIGGER')
     OR has_table_privilege('anon', 'public.categories', 'REFERENCES')
     OR has_table_privilege('anon', 'public.categories', 'TRIGGER')
     OR has_table_privilege('anon', 'public.profiles', 'REFERENCES')
     OR has_table_privilege('anon', 'public.profiles', 'TRIGGER')
     OR has_table_privilege('anon', 'public.activity_logs', 'REFERENCES')
     OR has_table_privilege('anon', 'public.activity_logs', 'TRIGGER') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role anon masih memiliki privilege REFERENCES atau TRIGGER pada tabel inti.';
  END IF;

  IF has_table_privilege('authenticated', 'public.loans', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.loans', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.books', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.books', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.categories', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.categories', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.activity_logs', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.activity_logs', 'TRIGGER') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated masih memiliki privilege REFERENCES atau TRIGGER pada tabel inti.';
  END IF;

  -- 6.2 Role anon hanya boleh SELECT pada books dan categories (tidak pada loans/profiles/activity_logs)
  SELECT
    has_table_privilege('anon', 'public.books', 'SELECT'),
    has_table_privilege('anon', 'public.categories', 'SELECT')
  INTO v_anon_books_select, v_anon_categories_select;

  IF NOT (v_anon_books_select AND v_anon_categories_select) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role anon wajib memiliki SELECT pada books dan categories untuk katalog publik.';
  END IF;

  IF has_any_column_privilege('anon', 'public.loans', 'SELECT')
     OR has_any_column_privilege('anon', 'public.profiles', 'SELECT')
     OR has_any_column_privilege('anon', 'public.activity_logs', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role anon tidak boleh memiliki akses SELECT ke loans, profiles, atau activity_logs.';
  END IF;

  -- 6.3 Role authenticated least privilege per tabel
  IF has_any_column_privilege('authenticated', 'public.loans', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.loans', 'DELETE')
     OR has_column_privilege('authenticated', 'public.loans', 'approved_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.loans', 'due_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.loans', 'returned_at', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated memiliki privilege ilegal pada public.loans (UPDATE/DELETE/kolom persetujuan).';
  END IF;

  IF has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_super_admin', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'archived_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'archived_by', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated memiliki privilege ilegal pada public.profiles (INSERT/DELETE/kolom sensitif).';
  END IF;

  IF has_any_column_privilege('authenticated', 'public.activity_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.activity_logs', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated tidak boleh memiliki UPDATE atau DELETE pada public.activity_logs.';
  END IF;

  SELECT
    has_table_privilege('authenticated', 'public.loans', 'SELECT'),
    has_column_privilege('authenticated', 'public.loans', 'user_id', 'INSERT'),
    has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
    has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
    has_table_privilege('authenticated', 'public.activity_logs', 'SELECT'),
    has_table_privilege('authenticated', 'public.activity_logs', 'INSERT')
  INTO
    v_auth_loans_select,
    v_auth_loans_insert_user,
    v_auth_profiles_select,
    v_auth_profiles_update_name,
    v_auth_logs_select,
    v_auth_logs_insert;

  IF NOT (
    v_auth_loans_select
    AND v_auth_loans_insert_user
    AND v_auth_profiles_select
    AND v_auth_profiles_update_name
    AND v_auth_logs_select
    AND v_auth_logs_insert
  ) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Privilege minimal authenticated (SELECT/INSERT loans, SELECT/UPDATE profil non-sensitif, SELECT/INSERT activity_logs) tidak lengkap.';
  END IF;

  -- 6.4 Pastikan policy AS RESTRICTIVE (admin-only) pada books & categories aktif
  SELECT COUNT(*)
  INTO v_restrictive_dml_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'RESTRICTIVE'
    AND (
      (tablename = 'books' AND policyname IN ('books_restrict_insert_admin', 'books_restrict_update_admin', 'books_restrict_delete_admin'))
      OR (tablename = 'categories' AND policyname IN ('categories_restrict_insert_admin', 'categories_restrict_update_admin', 'categories_restrict_delete_admin'))
    );

  IF v_restrictive_dml_count <> 6 THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Policy AS RESTRICTIVE admin-only pada public.books & public.categories belum lengkap (ditemukan %, wajib 6).', v_restrictive_dml_count;
  END IF;

  -- 6.5 Verifikasi fungsi & trigger keamanan
  SELECT p.prosecdef INTO v_guard_profiles_secdef
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_profiles_sensitive_columns';

  SELECT p.prosecdef INTO v_approve_rpc_secdef
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'approve_loan_atomic';

  SELECT p.prosecdef INTO v_return_rpc_secdef
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'return_loan_atomic';

  SELECT
    has_function_privilege('service_role', 'public.approve_loan_atomic(uuid, uuid, text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.return_loan_atomic(uuid, uuid, boolean)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.approve_loan_atomic(uuid, uuid, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.return_loan_atomic(uuid, uuid, boolean)', 'EXECUTE'),
    has_function_privilege('anon', 'public.approve_loan_atomic(uuid, uuid, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.return_loan_atomic(uuid, uuid, boolean)', 'EXECUTE')
  INTO
    v_srv_approve_rpc,
    v_srv_return_rpc,
    v_auth_approve_rpc,
    v_auth_return_rpc,
    v_anon_approve_rpc,
    v_anon_return_rpc;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'loans'
      AND t.tgname = 'trg_guard_loans_integrity'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A', 'R')
  ) INTO v_loans_trigger_active;

  IF COALESCE(v_guard_profiles_secdef, true) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: guard_profiles_sensitive_columns() harus SECURITY INVOKER.';
  END IF;

  IF NOT COALESCE(v_approve_rpc_secdef, false) OR NOT COALESCE(v_return_rpc_secdef, false) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Fungsi transaksi atomik approve_loan_atomic / return_loan_atomic belum terpasang dengan benar.';
  END IF;

  IF NOT (v_srv_approve_rpc AND v_srv_return_rpc) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: service_role wajib memiliki EXECUTE pada approve_loan_atomic dan return_loan_atomic.';
  END IF;

  IF v_auth_approve_rpc OR v_auth_return_rpc OR v_anon_approve_rpc OR v_anon_return_rpc THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role anon/authenticated tidak boleh memiliki EXECUTE pada fungsi transaksi atomik.';
  END IF;

  IF NOT v_loans_trigger_active THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Trigger trg_guard_loans_integrity pada public.loans belum aktif.';
  END IF;
END;
$$;

COMMIT;
