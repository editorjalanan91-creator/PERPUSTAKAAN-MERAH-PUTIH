-- ============================================================================
-- Migrasi Pengamanan & Konsistensi Manajemen Koleksi Buku
-- Aplikasi: PERPUSTAKAAN MERAH PUTIH
-- Tanggal : 2026-11-21
-- Tujuan  :
--   1. Menormalisasi kolom books.is_published (NOT NULL DEFAULT true) dan
--      books.is_archived (NOT NULL DEFAULT false) agar tidak ada baris NULL
--      yang terlihat hilang bagi Pengunjung namun muncul di halaman Admin.
--   2. Menjamin Foreign Key public.loans(book_id) -> public.books(id)
--      menggunakan ON DELETE RESTRICT (mencegah CASCADE menghapus riwayat loans).
--   3. Memasang trigger guard_books_integrity() (SECURITY INVOKER) untuk
--      mencegah penghapusan buku dari role client non-privileged dan menolak
--      penghapusan buku yang masih dirujuk transaksi peminjaman (loans).
--   4. Menegakkan prinsip server-only mutation pada public.books:
--      anon & authenticated hanya SELECT; mutasi eksklusif via service_role.
--   5. Memastikan public.books terdaftar di publikasi supabase_realtime jika ada.
--
-- Ketentuan Wajib:
--   - Idempotent & aman untuk database Production yang sudah memiliki data.
--   - TIDAK menghapus atau mereset data Production.
--   - TIDAK menonaktifkan RLS atau menghapus policy Production tanpa audit.
-- ============================================================================

BEGIN;

-- 1. Pastikan Row Level Security tetap AKTIF pada public.books & public.loans
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

-- 2. Normalisasi kolom visibilitas/arsip pada public.books tanpa mengubah flag valid
UPDATE public.books
SET is_published = true
WHERE is_published IS NULL;

UPDATE public.books
SET is_archived = false
WHERE is_archived IS NULL;

ALTER TABLE public.books
  ALTER COLUMN is_published SET DEFAULT true,
  ALTER COLUMN is_published SET NOT NULL,
  ALTER COLUMN is_archived SET DEFAULT false,
  ALTER COLUMN is_archived SET NOT NULL;

-- 3. Jamin Foreign Key public.loans(book_id) -> public.books(id) aman (ON DELETE RESTRICT)
--    Mencegah penghapusan buku secara diam-diam ikut menghapus riwayat public.loans.
DO $$
DECLARE
  v_fk RECORD;
  v_has_safe_fk BOOLEAN := false;
BEGIN
  FOR v_fk IN
    SELECT
      c.oid,
      c.conname,
      c.confdeltype
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class rel ON rel.oid = c.conrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_catalog.pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'loans'
      AND c.contype = 'f'
      AND c.confrelid = 'public.books'::regclass
      AND array_length(c.conkey, 1) = 1
      AND att.attname = 'book_id'
  LOOP
    IF v_fk.confdeltype IN ('c', 'n', 'd') THEN
      EXECUTE format('ALTER TABLE public.loans DROP CONSTRAINT %I', v_fk.conname);
      RAISE NOTICE '[BOOKS_FK_AUDIT] Dropped unsafe FK % (confdeltype=%) on public.loans(book_id).',
        v_fk.conname, v_fk.confdeltype;
    ELSE
      v_has_safe_fk := true;
    END IF;
  END LOOP;

  IF NOT v_has_safe_fk THEN
    ALTER TABLE public.loans
      ADD CONSTRAINT loans_book_id_fkey
      FOREIGN KEY (book_id)
      REFERENCES public.books(id)
      ON DELETE RESTRICT;
    RAISE NOTICE '[BOOKS_FK_AUDIT] Created safe ON DELETE RESTRICT FK loans_book_id_fkey on public.loans(book_id).';
  END IF;
END;
$$;

-- 4. Penyelarasan Privilege Tingkat Tabel pada public.books (Server-Only Mutation)
--    Seluruh tambah/edit/arsip/hapus buku berjalan melalui backend /api/admin/books*
--    menggunakan SUPABASE_SERVICE_ROLE_KEY setelah verifikasi role admin.
REVOKE ALL ON TABLE public.books FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.books TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.books TO service_role;

-- 5. Pastikan policy RLS public.books konsisten & tetap aman (tanpa menghapus policy Production)
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
  WITH CHECK (false);

DROP POLICY IF EXISTS books_restrict_update_admin ON public.books;
CREATE POLICY books_restrict_update_admin
  ON public.books
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS books_restrict_delete_admin ON public.books;
CREATE POLICY books_restrict_delete_admin
  ON public.books
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

-- 6. Trigger Penjaga Integritas Penghapusan Buku (Defense-in-Depth)
--    - SECURITY INVOKER agar current_user mencerminkan role pemanggil sebenarnya.
--    - Menolak DELETE langsung dari client role (authenticated / anon).
--    - Menolak DELETE buku apabila masih memiliki baris transaksi di public.loans.
CREATE OR REPLACE FUNCTION public.guard_books_integrity()
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

  IF TG_OP = 'DELETE' THEN
    IF NOT v_is_privileged_context THEN
      RAISE EXCEPTION 'Penghapusan buku hanya diizinkan melalui endpoint backend administrator yang terverifikasi.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.loans l
      WHERE l.book_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Buku (%) masih memiliki riwayat peminjaman di public.loans dan harus diarsipkan, bukan dihapus permanen.', OLD.id
        USING ERRCODE = '23503';
    END IF;

    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_books_integrity ON public.books;
CREATE TRIGGER trg_guard_books_integrity
  BEFORE DELETE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_books_integrity();

-- 7. Pastikan public.books termasuk dalam publikasi supabase_realtime jika tersedia
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'books'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.books;
    END IF;
  END IF;
END;
$$;

-- 8. Verifikasi Pasca-Migrasi (FAIL-CLOSED)
DO $$
DECLARE
  v_rls_enabled BOOLEAN := false;
  v_null_flags_count INT := 0;
  v_not_null_cols INT := 0;
  v_safe_fk_exists BOOLEAN := false;
  v_unsafe_fk_exists BOOLEAN := false;
  v_guard_books_secdef BOOLEAN := true;
  v_books_trigger_active BOOLEAN := false;
BEGIN
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class
  WHERE oid = 'public.books'::regclass;

  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: RLS wajib aktif pada public.books.';
  END IF;

  SELECT COUNT(*) INTO v_null_flags_count
  FROM public.books
  WHERE is_published IS NULL OR is_archived IS NULL;

  IF v_null_flags_count > 0 THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Masih terdapat % baris public.books dengan is_published/is_archived bernilai NULL.', v_null_flags_count;
  END IF;

  SELECT COUNT(*) INTO v_not_null_cols
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.books'::regclass
    AND a.attname IN ('is_published', 'is_archived')
    AND a.attnotnull = true
    AND NOT a.attisdropped;

  IF v_not_null_cols <> 2 THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Kolom is_published dan is_archived pada public.books wajib NOT NULL.';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'public.loans'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.books'::regclass
        AND a.attname = 'book_id'
        AND c.confdeltype IN ('r', 'a')
    ),
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'public.loans'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.books'::regclass
        AND a.attname = 'book_id'
        AND c.confdeltype IN ('c', 'n', 'd')
    )
  INTO v_safe_fk_exists, v_unsafe_fk_exists;

  IF NOT v_safe_fk_exists OR v_unsafe_fk_exists THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Foreign key public.loans(book_id) -> public.books(id) wajib RESTRICT/NO ACTION dan tidak boleh CASCADE/SET NULL.';
  END IF;

  IF NOT (
    has_table_privilege('service_role', 'public.books', 'SELECT')
    AND has_table_privilege('service_role', 'public.books', 'INSERT')
    AND has_table_privilege('service_role', 'public.books', 'UPDATE')
    AND has_table_privilege('service_role', 'public.books', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: service_role wajib memiliki privilege penuh pada public.books.';
  END IF;

  IF NOT (
    has_table_privilege('anon', 'public.books', 'SELECT')
    AND has_table_privilege('authenticated', 'public.books', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: anon dan authenticated wajib memiliki privilege SELECT pada public.books.';
  END IF;

  IF has_any_column_privilege('anon', 'public.books', 'INSERT')
     OR has_any_column_privilege('anon', 'public.books', 'UPDATE')
     OR has_table_privilege('anon', 'public.books', 'DELETE')
     OR has_table_privilege('anon', 'public.books', 'REFERENCES')
     OR has_table_privilege('anon', 'public.books', 'TRIGGER')
     OR has_table_privilege('anon', 'public.books', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role anon tidak boleh memiliki privilege mutasi/DDL pada public.books.';
  END IF;

  IF has_any_column_privilege('authenticated', 'public.books', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.books', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.books', 'DELETE')
     OR has_table_privilege('authenticated', 'public.books', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.books', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.books', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Role authenticated tidak boleh memiliki privilege mutasi/DDL pada public.books.';
  END IF;

  SELECT p.prosecdef INTO v_guard_books_secdef
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_books_integrity';

  IF COALESCE(v_guard_books_secdef, true) THEN
    RAISE EXCEPTION 'FAIL-CLOSED: guard_books_integrity() wajib menggunakan SECURITY INVOKER.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'books'
      AND t.tgname = 'trg_guard_books_integrity'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A', 'R')
  ) INTO v_books_trigger_active;

  IF NOT v_books_trigger_active THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Trigger trg_guard_books_integrity pada public.books belum aktif.';
  END IF;
END;
$$;

COMMIT;
