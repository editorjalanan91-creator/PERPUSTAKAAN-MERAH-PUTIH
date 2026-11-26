-- ============================================================================
-- Migrasi Pengamanan Streaming EPUB/PDF & Bucket Privat book-files
-- Aplikasi: PERPUSTAKAAN MERAH PUTIH
-- Tanggal : 2026-11-25 (Revisi Akhir Pra-Peluncuran: Multi-Bucket Safe Replacement)
--
-- Prinsip & Ketentuan Ketat:
--   1. JANGAN menghapus policy yang melayani bucket lain (`book-covers`, dll.).
--   2. JANGAN menghapus policy hanya karena tidak memiliki filter `bucket_id`.
--   3. Periksa isi lengkap ekspresi policy (`qual`, `with_check`, `cmd`, `roles`,
--      `permissive`) sebelum menentukan tindakan.
--   4. Jika policy lama (seperti `files_select_authorized` atau policy gabungan)
--      melayani beberapa bucket sekaligus, buat PENGGANTIAN policy yang tetap
--      mempertahankan akses bucket lain (`bucket_id <> 'book-files'`) dan menutup
--      akses langsung Pengunjung ke `book-files`.
--   5. Hanya hapus `files_select_authorized` apabila isi lengkap ekspresinya
--      terbukti khusus membuka bucket `book-files` tanpa melayani bucket lain.
--   6. Perketat `pmp_storage_book_files_select` khusus Admin (`public.is_admin()`).
--   7. Pertahankan RLS `storage.objects` aktif, bucket `book-files` privat
--      (`public = false`), dan TIDAK menyentuh data/file Production maupun
--      privilege tabel `public.books`.
--   8. Idempotent & aman dijalankan ulang pada database Production.
-- ============================================================================

BEGIN;

-- 1. Pastikan bucket privat 'book-files' tetap private (public = false)
--    dan mendukung MIME type PDF serta EPUB jika allowed_mime_types dibatasi.
--    (Tidak mengubah konfigurasi bucket 'book-covers' maupun bucket lainnya.)
DO $$
DECLARE
  v_bucket RECORD;
  v_updated_mimes TEXT[];
BEGIN
  SELECT id, public, allowed_mime_types
  INTO v_bucket
  FROM storage.buckets
  WHERE id = 'book-files' OR name = 'book-files'
  LIMIT 1;

  IF FOUND THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id = v_bucket.id
      AND public IS DISTINCT FROM false;

    IF v_bucket.allowed_mime_types IS NOT NULL THEN
      v_updated_mimes := v_bucket.allowed_mime_types;
      IF NOT ('application/pdf' = ANY(v_updated_mimes)) THEN
        v_updated_mimes := array_append(v_updated_mimes, 'application/pdf');
      END IF;
      IF NOT ('application/epub+zip' = ANY(v_updated_mimes)) THEN
        v_updated_mimes := array_append(v_updated_mimes, 'application/epub+zip');
      END IF;
      IF NOT ('application/octet-stream' = ANY(v_updated_mimes)) THEN
        v_updated_mimes := array_append(v_updated_mimes, 'application/octet-stream');
      END IF;

      UPDATE storage.buckets
      SET allowed_mime_types = v_updated_mimes
      WHERE id = v_bucket.id;
    END IF;
  END IF;
END;
$$;

-- 2. Evaluasi Penuh Policy `storage.objects` (PERMISSIVE SELECT / ALL)
--    Sebelum Menentukan Tindakan:
--    - Policy lain yang khusus melayani `book-covers` / bucket lain dibiarkan utuh.
--    - Policy tidak pernah dihapus hanya karena tidak memiliki filter `bucket_id`.
--    - Jika policy lama melayani beberapa bucket (termasuk `files_select_authorized`
--      gabungan atau policy lintas-bucket), lakukan PENGGANTIAN policy dengan
--      menambahkan guard `(bucket_id <> 'book-files') AND (<ekspresi_lama>)`
--      agar akses bucket lain tetap terjaga dan `book-files` tertutup bagi Pengunjung.
--    - Hanya `files_select_authorized` yang terbukti eksklusif untuk `book-files`
--      yang dihapus.
--    - Jika ditemukan policy tambahan non-admin yang hanya membuka `book-files`
--      tanpa melayani bucket lain, batalkan migrasi dan laporkan nama policy-nya.
DO $$
DECLARE
  v_pol RECORD;
  v_qual TEXT;
  v_with_check TEXT;
  v_expr TEXT;
  v_already_guarded BOOLEAN;
  v_admin_only BOOLEAN;
  v_mentions_book_files BOOLEAN;
  v_excludes_book_files BOOLEAN;
  v_wildcard_bucket BOOLEAN;
  v_no_bucket_filter BOOLEAN;
  v_affects_book_files BOOLEAN;
  v_serves_other_buckets BOOLEAN;
  v_roles_sql TEXT;
  v_new_qual TEXT;
  v_new_check TEXT;
  v_unhandled_book_files_only TEXT := '';
BEGIN
  FOR v_pol IN
    SELECT
      p.policyname,
      p.cmd,
      p.roles,
      p.permissive,
      NULLIF(btrim(COALESCE(p.qual, '')), '') AS qual_expr,
      NULLIF(btrim(COALESCE(p.with_check, '')), '') AS check_expr
    FROM pg_policies p
    WHERE p.schemaname = 'storage'
      AND p.tablename = 'objects'
      AND p.permissive = 'PERMISSIVE'
      AND p.cmd IN ('SELECT', 'ALL')
      AND p.policyname NOT IN (
        'pmp_storage_book_files_select',
        'pmp_storage_book_files_insert',
        'pmp_storage_book_files_update',
        'pmp_storage_book_files_delete'
      )
    ORDER BY p.policyname
  LOOP
    v_qual := v_pol.qual_expr;
    v_with_check := v_pol.check_expr;
    v_expr := COALESCE(v_qual, '') || ' ' || COALESCE(v_with_check, '');

    -- Periksa apakah policy sudah memiliki guard teratas yang menutup 'book-files'
    v_already_guarded := (
      COALESCE(v_qual, '') ~* '^\s*\(+\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)\s+AND\b'
      OR COALESCE(v_qual, '') ~* '^\s*\(*\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)*\s*$'
    );
    IF v_pol.cmd = 'ALL' AND v_with_check IS NOT NULL THEN
      v_already_guarded := v_already_guarded AND (
        v_with_check ~* '^\s*\(+\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)\s+AND\b'
        OR v_with_check ~* '^\s*\(*\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)*\s*$'
      );
    END IF;

    IF v_already_guarded THEN
      CONTINUE;
    END IF;

    -- Periksa apakah policy secara ketat hanya mengizinkan Admin
    v_admin_only := (
      v_expr ILIKE '%is_admin()%'
      AND v_expr !~* '\bOR\b'
    );
    IF v_admin_only THEN
      CONTINUE;
    END IF;

    v_mentions_book_files := (v_expr ILIKE '%''book-files''%');
    v_excludes_book_files := (
      v_expr ~* 'bucket_id\s*(<>|!=|IS\s+DISTINCT\s+FROM)\s*''book-files'''
      AND v_expr !~* 'bucket_id\s*(=|IN\s*\(|=\s*ANY)'
    );
    v_wildcard_bucket := (v_expr ~* 'bucket_id\s*(I?LIKE|~~\*?|~\*?)');
    v_no_bucket_filter := (v_expr !~* '\bbucket_id\b');

    v_affects_book_files := (
      (v_mentions_book_files AND NOT v_excludes_book_files)
      OR v_wildcard_bucket
      OR v_no_bucket_filter
    );

    IF NOT v_affects_book_files THEN
      -- Policy ini tidak membuka akses bucket book-files (mis. khusus book-covers)
      CONTINUE;
    END IF;

    -- Periksa apakah isi lengkap ekspresi juga melayani bucket lain (multi-bucket)
    v_serves_other_buckets := (
      v_expr ILIKE '%''book-covers''%'
      OR EXISTS (
        SELECT 1
        FROM storage.buckets b
        WHERE b.id <> 'book-files'
          AND (
            strpos(lower(v_expr), '''' || lower(b.id) || '''') > 0
            OR strpos(lower(v_expr), '''' || lower(b.name) || '''') > 0
          )
      )
      OR EXISTS (
        SELECT 1
        FROM regexp_matches(v_expr, 'bucket_id\s*=\s*''([^'']+)''', 'gi') AS m
        WHERE lower(m[1]) <> 'book-files'
      )
      OR v_expr ~* 'bucket_id\s*(=\s*ANY\s*\(\s*ARRAY\[[^\]]*,|IN\s*\([^)]*,)'
      OR v_wildcard_bucket
      OR v_no_bucket_filter
    );

    IF v_serves_other_buckets THEN
      -- Policy melayani beberapa bucket / lintas-bucket:
      -- JANGAN dihapus; buat penggantian policy yang mempertahankan akses bucket lain
      -- sambil menutup akses langsung ke bucket 'book-files'.
      SELECT string_agg(
        CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r::text) END,
        ', '
      )
      INTO v_roles_sql
      FROM unnest(v_pol.roles) AS r;

      IF v_roles_sql IS NULL OR v_roles_sql = '' THEN
        v_roles_sql := 'PUBLIC';
      END IF;

      v_new_qual := format(
        '(bucket_id <> %L) AND (%s)',
        'book-files',
        COALESCE(v_qual, 'true')
      );

      EXECUTE format('DROP POLICY %I ON storage.objects', v_pol.policyname);

      IF v_pol.cmd = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR SELECT TO %s USING (%s)',
          v_pol.policyname,
          v_roles_sql,
          v_new_qual
        );
      ELSE
        v_new_check := format(
          '(bucket_id <> %L) AND (%s)',
          'book-files',
          COALESCE(v_with_check, v_qual, 'true')
        );
        EXECUTE format(
          'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR ALL TO %s USING (%s) WITH CHECK (%s)',
          v_pol.policyname,
          v_roles_sql,
          v_new_qual,
          v_new_check
        );
      END IF;

      RAISE NOTICE 'Policy multi-bucket % (%) diganti agar akses bucket lain tetap utuh dan akses langsung ke book-files ditutup.',
        v_pol.policyname, v_pol.cmd;
    ELSIF v_pol.policyname = 'files_select_authorized' THEN
      -- Terbukti eksklusif hanya membuka bucket 'book-files' (tidak melayani bucket lain)
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_pol.policyname);
      RAISE NOTICE 'Policy files_select_authorized yang terbukti khusus membuka bucket book-files telah dihapus.';
    ELSE
      -- Policy tambahan selain files_select_authorized yang khusus membuka 'book-files':
      -- jangan dihapus otomatis, kumpulkan untuk membatalkan migrasi dan dilaporkan.
      v_unhandled_book_files_only := CASE
        WHEN v_unhandled_book_files_only = '' THEN format('%I (cmd=%s)', v_pol.policyname, v_pol.cmd)
        ELSE v_unhandled_book_files_only || ', ' || format('%I (cmd=%s)', v_pol.policyname, v_pol.cmd)
      END;
    END IF;
  END LOOP;

  IF v_unhandled_book_files_only <> '' THEN
    RAISE EXCEPTION
      'MIGRATION DIBATALKAN: Ditemukan policy tambahan yang khusus membuka akses bucket book-files (tidak dihapus otomatis): %. Tinjau dan tangani policy tersebut secara manual sebelum menjalankan ulang migrasi.',
      v_unhandled_book_files_only;
  END IF;
END;
$$;

-- 3. Perketat policy SELECT `book-files` khusus Admin (`public.is_admin()`).
--    Backend `/api/books/:id/content` & `/api/admin/books/:id/download`
--    menggunakan `SUPABASE_SERVICE_ROLE_KEY` di server.
DROP POLICY IF EXISTS pmp_storage_book_files_select ON storage.objects;
CREATE POLICY pmp_storage_book_files_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'book-files'
    AND public.is_admin()
  );

-- Pastikan policy tulis Admin khusus pada bucket 'book-files' tetap terjaga
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

-- 4. Verifikasi Pasca-Migrasi (FAIL-CLOSED)
DO $$
DECLARE
  v_storage_rls_enabled BOOLEAN := false;
  v_bucket_public BOOLEAN := NULL;
  v_select_qual TEXT := '';
  v_select_roles NAME[] := ARRAY[]::NAME[];
  v_exposed_policies TEXT;
  v_write_policies_count INTEGER := 0;
BEGIN
  SELECT c.relrowsecurity
  INTO v_storage_rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects';

  IF v_storage_rls_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL-CLOSED: RLS pada storage.objects wajib tetap aktif.';
  END IF;

  SELECT public INTO v_bucket_public
  FROM storage.buckets
  WHERE id = 'book-files' OR name = 'book-files'
  LIMIT 1;

  IF NOT FOUND OR v_bucket_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Bucket book-files wajib ada dan bersifat privat (public = false).';
  END IF;

  -- Pastikan tidak ada policy PERMISSIVE SELECT/ALL selain pmp_storage_book_files_select
  -- yang masih membuka akses langsung non-admin ke bucket 'book-files'
  SELECT string_agg(format('%I (cmd=%s)', p.policyname, p.cmd), ', ' ORDER BY p.policyname)
  INTO v_exposed_policies
  FROM pg_policies p
  WHERE p.schemaname = 'storage'
    AND p.tablename = 'objects'
    AND p.permissive = 'PERMISSIVE'
    AND p.cmd IN ('SELECT', 'ALL')
    AND p.policyname NOT IN (
      'pmp_storage_book_files_select',
      'pmp_storage_book_files_insert',
      'pmp_storage_book_files_update',
      'pmp_storage_book_files_delete'
    )
    AND NOT (
      (
        COALESCE(p.qual, '') ~* '^\s*\(+\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)\s+AND\b'
        OR COALESCE(p.qual, '') ~* '^\s*\(*\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)*\s*$'
      )
      AND (
        p.cmd <> 'ALL'
        OR p.with_check IS NULL
        OR p.with_check ~* '^\s*\(+\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)\s+AND\b'
        OR p.with_check ~* '^\s*\(*\s*bucket_id\s+(<>|!=|IS\s+DISTINCT\s+FROM)\s+''book-files''(::text)?\s*\)*\s*$'
      )
    )
    AND NOT (
      (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ILIKE '%is_admin()%'
      AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~* '\bOR\b'
    )
    AND (
      (
        (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ILIKE '%''book-files''%'
        AND NOT (
          (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~* 'bucket_id\s*(<>|!=|IS\s+DISTINCT\s+FROM)\s*''book-files'''
          AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~* 'bucket_id\s*(=|IN\s*\(|=\s*ANY)'
        )
      )
      OR (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~* 'bucket_id\s*(I?LIKE|~~\*?|~\*?)'
      OR (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~* '\bbucket_id\b'
    );

  IF v_exposed_policies IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL-CLOSED: Masih terdapat policy yang membuka akses bucket book-files: %.',
      v_exposed_policies;
  END IF;

  SELECT COALESCE(qual, ''), roles
  INTO v_select_qual, v_select_roles
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND cmd = 'SELECT'
    AND policyname = 'pmp_storage_book_files_select';

  IF v_select_qual = ''
     OR v_select_qual NOT ILIKE '%book-files%'
     OR v_select_qual NOT ILIKE '%is_admin%'
     OR v_select_qual ILIKE '%loans%'
     OR 'anon' = ANY(v_select_roles)
     OR 'public' = ANY(v_select_roles)
  THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Policy pmp_storage_book_files_select wajib membatasi akses langsung hanya kepada Admin terautentikasi (public.is_admin()).';
  END IF;

  SELECT COUNT(*)
  INTO v_write_policies_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'pmp_storage_book_files_insert',
      'pmp_storage_book_files_update',
      'pmp_storage_book_files_delete'
    )
    AND COALESCE(qual, '') || ' ' || COALESCE(with_check, '') ILIKE '%''book-files''%'
    AND COALESCE(qual, '') || ' ' || COALESCE(with_check, '') ILIKE '%is_admin%';

  IF v_write_policies_count <> 3 THEN
    RAISE EXCEPTION 'FAIL-CLOSED: Policy INSERT/UPDATE/DELETE Admin untuk bucket book-files belum lengkap (ditemukan %, wajib 3).', v_write_policies_count;
  END IF;
END;
$$;

COMMIT;
