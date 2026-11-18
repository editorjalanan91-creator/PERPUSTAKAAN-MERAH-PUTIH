-- ============================================================================
-- Skrip Rollback Aman: Migrasi 20261116_visitor_archive_and_super_admin
-- Aplikasi: PERPUSTAKAAN MERAH PUTIH
-- Ketentuan Wajib:
--   1. Idempotent (aman dijalankan ulang apabila sebagian objek belum ada).
--   2. TIDAK menghapus akun Admin, 5 akun Pengunjung, koleksi buku, maupun
--      riwayat peminjaman (loans) dan activity_logs.
--   3. TIDAK mengubah atau menghapus 7 policy RLS Production yang berjalan.
--   4. Mengembalikan schema/fungsi ke kondisi sebelum migrasi tanpa kehilangan data.
-- ============================================================================

BEGIN;

-- 1. Hapus trigger dan fungsi perlindungan Super Admin serta guard profil
DROP TRIGGER IF EXISTS trg_protect_super_admin_auth_users ON auth.users;
DROP FUNCTION IF EXISTS public.prevent_super_admin_auth_deletion();

DROP TRIGGER IF EXISTS trg_protect_super_admin_profiles ON public.profiles;
DROP FUNCTION IF EXISTS public.prevent_super_admin_deletion_or_archive();

DROP TRIGGER IF EXISTS trg_guard_profiles_sensitive_columns ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profiles_sensitive_columns();

-- 2. Kembalikan public.is_admin() ke definisi dasar yang tetap menjaga 7 policy RLS
--    tetap valid dan hanya mengenali role 'admin'.
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
      AND p.role = 'admin'
  );
$$;

-- 3. Hapus indeks tambahan yang dibuat oleh migrasi 20261116
DROP INDEX IF EXISTS public.idx_profiles_role_active;
DROP INDEX IF EXISTS public.idx_loans_user_status;
DROP INDEX IF EXISTS public.idx_activity_logs_actor_created;

-- 4. Catatan mengenai Foreign Key activity_logs.actor_id:
--    Constraint FK ON DELETE SET NULL tetap kompatibel dengan seluruh data lama.
--    Tidak perlu mengembalikan NOT NULL agar tidak gagal jika ada log historis
--    dari akun pengunjung yang telah dihapus secara sah sebelum rollback.

-- 5. Catatan Kolom Baru pada public.profiles (Opsional / Tidak Destruktif):
--    Kolom is_active, archived_at, archived_by, dan is_super_admin sengaja TIDAK
--    di-DROP secara default agar status arsip pengunjung yang sudah tercatat
--    tidak hilang secara tidak sengaja saat rollback darurat.
--    Jika Anda benar-benar ingin menghapus 4 kolom tersebut setelah memastikan
--    tidak ada pengguna terarsip yang perlu dipulihkan, jalankan manual:
--
--    ALTER TABLE public.profiles
--      DROP COLUMN IF EXISTS is_super_admin,
--      DROP COLUMN IF EXISTS archived_by,
--      DROP COLUMN IF EXISTS archived_at,
--      DROP COLUMN IF EXISTS is_active;

COMMIT;
