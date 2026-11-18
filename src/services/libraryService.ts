import { supabase, recordActivityLog } from './supabaseClient';
import { Book, Category, Loan, Profile, ActivityLog } from '../types';
import {
  computeBookStockAfterReturn,
  evaluateLoanReturnEligibility,
  formatBookReturnErrorMessage,
} from '../utils/libraryRules';

/**
 * Service Layer untuk seluruh interaksi Supabase Database, Storage, dan Realtime
 */
export const libraryService = {
  // ==========================================
  // KATEGORI BUKU (categories)
  // ==========================================
  async getCategories(): Promise<Category[]> {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }

    // Hitung jumlah buku per kategori
    const { data: books } = await supabase
      .from('books')
      .select('category_id')
      .eq('is_archived', false);

    const countMap: Record<string, number> = {};
    if (books) {
      for (const b of books) {
        if (b.category_id) {
          countMap[b.category_id] = (countMap[b.category_id] || 0) + 1;
        }
      }
    }

    return (categories || []).map((cat) => ({
      ...cat,
      bookCount: countMap[cat.id] || 0,
    }));
  },

  async addCategory(
    categoryInput: string | { name: string; description?: string },
    descriptionOrUserId?: string,
    userId?: string
  ): Promise<Category> {
    const name = typeof categoryInput === 'string' ? categoryInput : categoryInput.name;
    const description = typeof categoryInput === 'string' ? descriptionOrUserId : categoryInput.description;
    const creatorId = typeof categoryInput === 'string' ? userId : descriptionOrUserId;

    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { data, error } = await supabase
      .from('categories')
      .insert({
        name: name.trim(),
        slug,
        description: description ? description.trim() : null,
        is_active: true,
        created_by: creatorId || null,
      })
      .select()
      .single();

    if (error) throw error;

    if (creatorId) {
      await recordActivityLog(creatorId, 'create_category', 'categories', data.id, { name });
    }

    return data;
  },

  async updateCategory(
    id: string,
    updates: { name?: string; description?: string; is_active?: boolean },
    userId?: string
  ): Promise<Category> {
    const payload: any = { ...updates };
    if (updates.name) {
      payload.slug = updates.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    const { data, error } = await supabase
      .from('categories')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'update_category', 'categories', id, updates);
    }

    return data;
  },

  async deleteCategory(id: string, userId?: string): Promise<void> {
    // Pastikan tidak ada buku yang terhubung
    const { data: books } = await supabase
      .from('books')
      .select('id')
      .eq('category_id', id)
      .eq('is_archived', false);

    if (books && books.length > 0) {
      throw new Error(`Kategori ini masih digunakan oleh ${books.length} buku. Pindahkan kategori buku tersebut terlebih dahulu.`);
    }

    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'delete_category', 'categories', id);
    }
  },

  // ==========================================
  // BUKU (books)
  // ==========================================
  async getBooks(isAdmin = false): Promise<Book[]> {
    let query = supabase
      .from('books')
      .select(`
        *,
        category:categories (
          id,
          name,
          slug
        )
      `)
      .order('created_at', { ascending: false });

    // Jika pengunjung, hanya tampilkan buku yang dipublikasikan dan tidak diarsipkan
    if (!isAdmin) {
      query = query.eq('is_published', true).eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching books:', error);
      throw error;
    }

    return (data || []).map((b) => ({
      ...b,
      category_name: b.category?.name || 'Tanpa Kategori',
    }));
  },

  async addBook(
    bookData: Partial<Book> & { title: string },
    userId?: string
  ): Promise<Book> {
    const totalCopies = Math.max(1, Math.floor(Number(bookData.total_copies || bookData.stock || 1) || 1));
    const rawAvailable =
      bookData.available_copies !== undefined ? Number(bookData.available_copies) : totalCopies;
    const availableCopies = Math.max(
      0,
      Math.min(totalCopies, Number.isFinite(rawAvailable) ? Math.floor(rawAvailable) : totalCopies)
    );

    const { data, error } = await supabase
      .from('books')
      .insert({
        title: bookData.title.trim(),
        author: (bookData.author || 'Penulis Mandiri').trim(),
        publisher: (bookData.publisher || 'Penerbit Mandiri').trim(),
        publication_year: bookData.publication_year || bookData.year || new Date().getFullYear(),
        isbn: (bookData.isbn || 'ISBN-978-000-000').trim(),
        category_id: bookData.category_id || '',
        description: bookData.description ? bookData.description.trim() : null,
        cover_path: bookData.cover_path || bookData.coverUrl || null,
        file_path: bookData.file_path || null,
        file_type: bookData.file_type || null,
        total_copies: totalCopies,
        available_copies: availableCopies,
        is_published: bookData.is_published !== undefined ? bookData.is_published : true,
        is_archived: false,
        created_by: userId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(`
        *,
        category:categories (
          id,
          name,
          slug
        )
      `)
      .single();

    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'create_book', 'books', data.id, { title: bookData.title });
    }

    return {
      ...data,
      category_name: data.category?.name || 'Tanpa Kategori',
    };
  },

  async updateBook(
    id: string,
    updates: Partial<Book>,
    userId?: string
  ): Promise<Book> {
    const { category, category_name, ...cleanUpdates } = updates as any;
    cleanUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('books')
      .update(cleanUpdates)
      .eq('id', id)
      .select(`
        *,
        category:categories (
          id,
          name,
          slug
        )
      `)
      .single();

    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'update_book', 'books', id, { title: data.title });
    }

    return {
      ...data,
      category_name: data.category?.name || 'Tanpa Kategori',
    };
  },

  async deleteBook(id: string, userId?: string): Promise<void> {
    // Periksa apakah ada pinjaman aktif untuk buku ini
    const { data: activeLoans } = await supabase
      .from('loans')
      .select('id')
      .eq('book_id', id)
      .in('status', ['pending', 'approved', 'borrowed']);

    if (activeLoans && activeLoans.length > 0) {
      throw new Error('Buku ini tidak dapat dihapus karena masih memiliki transaksi peminjaman aktif.');
    }

    const { error } = await supabase.from('books').delete().eq('id', id);
    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'delete_book', 'books', id);
    }
  },

  async toggleArchiveBook(id: string, isArchived: boolean, userId?: string): Promise<Book> {
    return this.updateBook(id, { is_archived: isArchived }, userId);
  },

  // ==========================================
  // PEMINJAMAN (loans)
  // Status: pending, approved, rejected, borrowed, returned, expired
  // ==========================================
  async getLoans(userId?: string, isAdmin = false): Promise<Loan[]> {
    let query = supabase
      .from('loans')
      .select(`
        *,
        book:books (
          id,
          title,
          author,
          publisher,
          publication_year,
          cover_path,
          file_path,
          file_type,
          available_copies,
          total_copies
        ),
        profile:profiles (
          id,
          full_name,
          username,
          role
        )
      `)
      .order('requested_at', { ascending: false });

    // Pengunjung hanya dapat melihat peminjaman miliknya
    if (!isAdmin && userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching loans:', error);
      throw error;
    }

    return data || [];
  },

  /**
   * Pengunjung mengajukan peminjaman buku:
   * Status awal wajib 'pending'
   */
  async requestLoan(
    userId: string,
    bookId: string,
    durationDaysOrNotes?: number | string,
    notes?: string
  ): Promise<Loan> {
    const finalNotes = typeof durationDaysOrNotes === 'string' ? durationDaysOrNotes : notes;
    const { data: book, error: bookError } = await supabase
      .from('books')
      .select('id, title, available_copies, is_published, is_archived')
      .eq('id', bookId)
      .single();

    if (bookError || !book) {
      throw new Error('Buku tidak ditemukan.');
    }

    if (!book.is_published || book.is_archived) {
      throw new Error('Maaf, buku ini sedang diarsipkan atau belum dipublikasikan untuk dipinjam.');
    }

    if (book.available_copies <= 0) {
      throw new Error('Maaf, eksemplar buku ini sedang tidak tersedia.');
    }

    // 2. Periksa apakah pengunjung sudah memiliki pinjaman aktif / pending untuk buku yang sama
    const { data: existingLoans, error: existingErr } = await supabase
      .from('loans')
      .select('id, status')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .in('status', ['pending', 'approved', 'borrowed'])
      .limit(1);

    if (existingErr) {
      throw new Error('Gagal memeriksa status peminjaman sebelumnya. Silakan coba kembali.');
    }

    if (existingLoans && existingLoans.length > 0) {
      throw new Error('Anda sudah memiliki permintaan atau peminjaman aktif untuk buku ini.');
    }

    const requestedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('loans')
      .insert({
        user_id: userId,
        book_id: bookId,
        status: 'pending',
        requested_at: requestedAt,
        admin_note: finalNotes && finalNotes.trim() ? `Catatan peminjam: ${finalNotes.trim()}` : null,
      })
      .select(`
        *,
        book:books (id, title, author, cover_path, file_path)
      `)
      .single();

    if (error) throw error;

    await recordActivityLog(userId, 'request_loan', 'loans', data.id, { book_title: book.title });

    return data;
  },

  /**
   * Admin menyetujui peminjaman:
   * Status -> 'approved', set approved_at dan due_at
   */
  async approveLoan(
    loanId: string,
    durationDays = 7,
    adminNote?: string,
    adminId?: string
  ): Promise<Loan> {
    const { data: existingLoan, error: checkErr } = await supabase
      .from('loans')
      .select('id, status, book_id')
      .eq('id', loanId)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (!existingLoan) {
      throw new Error('Data transaksi peminjaman tidak ditemukan.');
    }
    if (existingLoan.status !== 'pending') {
      throw new Error('Permintaan peminjaman ini sudah diproses sebelumnya dan tidak dapat disetujui ulang.');
    }

    const { data: targetBook, error: bookErr } = await supabase
      .from('books')
      .select('id, available_copies, is_archived')
      .eq('id', existingLoan.book_id)
      .maybeSingle();

    if (bookErr) throw bookErr;
    if (!targetBook || targetBook.is_archived || (targetBook.available_copies ?? 0) <= 0) {
      throw new Error('Stok eksemplar buku sudah habis atau buku diarsipkan sehingga peminjaman tidak dapat disetujui.');
    }

    const safeDurationDays = Math.max(1, Math.min(90, Math.floor(Number(durationDays) || 7)));
    const approvedAt = new Date();
    const dueAt = new Date(approvedAt.getTime() + safeDurationDays * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('loans')
      .update({
        status: 'approved',
        approved_at: approvedAt.toISOString(),
        due_at: dueAt.toISOString(),
        admin_note: (adminNote || '').trim() || 'Peminjaman telah disetujui administrator perpustakaan.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', loanId)
      .eq('status', 'pending')
      .select(`
        *,
        book:books (id, title, author, cover_path, file_path),
        profile:profiles (id, full_name, username)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Permintaan peminjaman ini sudah diproses oleh admin lain.');
      }
      throw error;
    }

    if (adminId) {
      await recordActivityLog(adminId, 'approve_loan', 'loans', loanId, {
        duration_days: safeDurationDays,
        due_at: dueAt.toISOString(),
      });
    }

    return data;
  },

  /**
   * Admin menolak peminjaman:
   * Status -> 'rejected'
   */
  async rejectLoan(loanId: string, reason = 'Permintaan peminjaman belum dapat disetujui saat ini.', adminId?: string): Promise<Loan> {
    const { data: existingLoan, error: checkErr } = await supabase
      .from('loans')
      .select('id, status')
      .eq('id', loanId)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (!existingLoan) {
      throw new Error('Data transaksi peminjaman tidak ditemukan.');
    }
    if (existingLoan.status !== 'pending') {
      throw new Error('Permintaan peminjaman ini sudah diproses sebelumnya.');
    }

    const cleanReason = reason.trim() || 'Permintaan peminjaman belum dapat disetujui saat ini.';
    const { data, error } = await supabase
      .from('loans')
      .update({
        status: 'rejected',
        admin_note: cleanReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loanId)
      .eq('status', 'pending')
      .select(`
        *,
        book:books (id, title, author, cover_path),
        profile:profiles (id, full_name, username)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Permintaan peminjaman ini sudah diproses oleh admin lain.');
      }
      throw error;
    }

    if (adminId) {
      await recordActivityLog(adminId, 'reject_loan', 'loans', loanId, { reason: cleanReason });
    }

    return data;
  },

  /**
   * Konfirmasi pengembalian buku:
   * - Menggunakan primary key transaksi (loans.id)
   * - Mengutamakan endpoint server terverifikasi /api/loans/:id/return agar bebas bug RLS .single() ("Cannot coerce...")
   * - Fallback client-side tidak memakai .single() pada UPDATE, memvalidasi status, & mencegah penggandaan stok
   */
  async returnLoan(loanId: string, actorId?: string): Promise<Loan> {
    const cleanLoanId = String(loanId || '').trim();
    if (!cleanLoanId) {
      throw new Error('ID transaksi peminjaman tidak valid.');
    }

    // 1. Jalur utama: backend resmi (/api/loans/:id/return) dengan token sesi terverifikasi
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        const response = await fetch(`/api/loans/${encodeURIComponent(cleanLoanId)}/return`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const payload = await response.json().catch(() => ({}));
          if (response.ok && payload?.loan) {
            return payload.loan as Loan;
          }

          // Jika API resmi tersedia dan mengembalikan error bisnis/otorisasi/DB (kecuali 404 route tidak ada),
          // lempar error informatif tanpa melakukan update ganda.
          const err: any = new Error(
            payload?.error || `Gagal mengonfirmasi pengembalian buku (HTTP ${response.status}).`
          );
          err.code = payload?.code;
          err.status = response.status;
          throw err;
        }
      }
    } catch (apiErr: any) {
      // Jika error berasal dari respons JSON resmi endpoint /api/loans/:id/return, teruskan ke pemanggil.
      if (apiErr?.status !== undefined || apiErr?.code !== undefined) {
        throw apiErr;
      }
      // Jika jaringan/endpoint tidak tersedia (misal mode statis lokal), lanjutkan ke fallback client yang aman.
    }

    // 2. Fallback client-side aman (tanpa .single() pada UPDATE agar tidak memicu PGRST116)
    console.warn('[RETURN_BOOK_CLIENT_FALLBACK]', { loanId: cleanLoanId });

    const { data: existingRows, error: fetchError } = await supabase
      .from('loans')
      .select(
        'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
      )
      .eq('id', cleanLoanId)
      .limit(2);

    if (fetchError) {
      throw new Error(formatBookReturnErrorMessage(fetchError));
    }

    if (existingRows && existingRows.length > 1) {
      console.error('[RETURN_BOOK_CLIENT_MULTIPLE_RECORDS]', {
        query: 'fallback.loans_select_by_pk',
        loanId: cleanLoanId,
        rowCount: existingRows.length,
      });
      throw new Error('Terdeteksi duplikasi data pada transaksi peminjaman ini. Hubungi administrator perpustakaan.');
    }

    const existingLoan = existingRows?.[0];
    if (!existingLoan) {
      throw new Error('Data transaksi peminjaman tidak ditemukan atau Anda tidak memiliki akses.');
    }

    const fetchRelations = async (loanRow: any): Promise<Loan> => {
      const [{ data: bookRows }, { data: profileRows }] = await Promise.all([
        supabase
          .from('books')
          .select('id, title, author, cover_path, file_path, file_type, total_copies, available_copies')
          .eq('id', loanRow.book_id)
          .limit(2),
        supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', loanRow.user_id)
          .limit(2),
      ]);

      if (bookRows && bookRows.length > 1) {
        console.error('[RETURN_BOOK_CLIENT_MULTIPLE_RECORDS]', {
          query: 'fallback.fetchRelations.books',
          loanId: cleanLoanId,
          rowCount: bookRows.length,
        });
      }
      if (profileRows && profileRows.length > 1) {
        console.error('[RETURN_BOOK_CLIENT_MULTIPLE_RECORDS]', {
          query: 'fallback.fetchRelations.profiles',
          loanId: cleanLoanId,
          rowCount: profileRows.length,
        });
      }

      return {
        ...loanRow,
        book: bookRows?.[0] ?? undefined,
        profile: profileRows?.[0] ?? undefined,
      } as Loan;
    };

    const eligibility = evaluateLoanReturnEligibility(existingLoan.status);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'already_returned') {
        return fetchRelations(existingLoan);
      }
      const statusErr: any = new Error(eligibility.message);
      statusErr.code = 'INVALID_LOAN_STATUS';
      throw statusErr;
    }

    const { data: beforeBookRows } = await supabase
      .from('books')
      .select('id, available_copies, total_copies')
      .eq('id', existingLoan.book_id)
      .limit(2);

    if (beforeBookRows && beforeBookRows.length > 1) {
      console.error('[RETURN_BOOK_CLIENT_MULTIPLE_RECORDS]', {
        query: 'fallback.beforeBook',
        loanId: cleanLoanId,
        rowCount: beforeBookRows.length,
      });
      throw new Error('Terdeteksi duplikasi data buku pada transaksi ini. Hubungi administrator perpustakaan.');
    }

    const beforeBook = beforeBookRows?.[0] ?? null;
    const beforeAvailable = Number(beforeBook?.available_copies ?? 0);
    const totalCopies = Number(beforeBook?.total_copies ?? 0);

    const returnedAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from('loans')
      .update({
        status: 'returned',
        returned_at: returnedAt,
        updated_at: returnedAt,
      })
      .eq('id', cleanLoanId)
      .in('status', ['approved', 'borrowed'])
      .select(
        'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
      );

    if (updateError) {
      const wrappedErr: any = new Error(formatBookReturnErrorMessage(updateError));
      wrappedErr.code = updateError.code;
      wrappedErr.details = updateError.details;
      throw wrappedErr;
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { data: recheckRows } = await supabase
        .from('loans')
        .select(
          'id, user_id, book_id, status, requested_at, approved_at, due_at, returned_at, admin_note, created_at, updated_at'
        )
        .eq('id', cleanLoanId)
        .limit(2);

      const latestLoan = recheckRows?.[0];
      if (latestLoan?.status === 'returned') {
        return fetchRelations(latestLoan);
      }

      const rlsErr: any = new Error(
        'Permintaan pengembalian belum dapat diterapkan oleh database. Periksa izin akun atau hubungi administrator perpustakaan.'
      );
      rlsErr.code = 'ZERO_ROWS_UPDATED';
      throw rlsErr;
    }

    if (updatedRows.length > 1) {
      console.error('[RETURN_BOOK_CLIENT_MULTIPLE_RECORDS]', {
        query: 'fallback.loans_update_by_pk',
        loanId: cleanLoanId,
        rowCount: updatedRows.length,
      });
      throw new Error('Terdeteksi duplikasi transaksi saat menyimpan pengembalian. Hubungi administrator perpustakaan.');
    }

    const updatedLoan = updatedRows[0];

    if (beforeBook) {
      const { data: afterBookRows } = await supabase
        .from('books')
        .select('id, available_copies, total_copies')
        .eq('id', existingLoan.book_id)
        .limit(2);
      const afterBook = afterBookRows?.[0] ?? beforeBook;
      const stockPlan = computeBookStockAfterReturn({
        beforeAvailable,
        afterAvailable: Number(afterBook.available_copies ?? beforeAvailable),
        totalCopies: Number(afterBook.total_copies ?? totalCopies),
      });

      if (stockPlan.needsUpdate) {
        await supabase
          .from('books')
          .update({
            available_copies: stockPlan.targetAvailable,
            updated_at: returnedAt,
          })
          .eq('id', existingLoan.book_id)
          .eq('available_copies', stockPlan.safeAfter);
      }
    }

    if (actorId) {
      await recordActivityLog(actorId, 'return_loan', 'loans', cleanLoanId);
    }

    return fetchRelations(updatedLoan);
  },

  // ==========================================
  // PENGUNJUNG (profiles & server admin API)
  // ==========================================
  async getVisitors(): Promise<Profile[]> {
    const { data: profilesData, error } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'admin')
      .neq('role', 'super_admin')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching visitors:', error);
      throw error;
    }

    const baseVisitors: Profile[] = (profilesData || []).filter(
      (p: any) => p.role !== 'admin' && p.role !== 'super_admin' && p.is_super_admin !== true
    );

    // Coba perkaya data dengan email & status arsip dari endpoint admin server-side
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        const res = await fetch('/api/admin/visitors', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (res.ok) {
          const payload = await res.json();
          if (Array.isArray(payload?.visitors)) {
            return payload.visitors;
          }
        }
      }
    } catch {
      // Fallback ke data public.profiles apabila endpoint admin tidak tersedia
    }

    return baseVisitors;
  },

  async deleteVisitor(id: string): Promise<{ mode: 'deleted'; message: string }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(
        payload?.error || `Gagal menghapus akun pengunjung (HTTP ${response.status}).`
      );
      err.code = payload?.code;
      err.totalLoans = payload?.totalLoans;
      err.activeLoans = payload?.activeLoans;
      err.status = response.status;
      throw err;
    }

    return {
      mode: 'deleted',
      message: payload?.message || 'Akun pengunjung berhasil dihapus permanen.',
    };
  },

  async archiveVisitor(id: string): Promise<{ mode: 'archived'; archivedAt?: string; message: string }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(
        payload?.error || `Gagal mengarsipkan akun pengunjung (HTTP ${response.status}).`
      );
      err.code = payload?.code;
      err.activeLoans = payload?.activeLoans;
      err.status = response.status;
      throw err;
    }

    return {
      mode: 'archived',
      archivedAt: payload?.archivedAt,
      message: payload?.message || 'Akun pengunjung berhasil diarsipkan dan dinonaktifkan.',
    };
  },

  async restoreVisitor(id: string): Promise<{ mode: 'restored'; restoredAt?: string; message: string }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(
        payload?.error || `Gagal mengaktifkan kembali akun pengunjung (HTTP ${response.status}).`
      );
      err.code = payload?.code;
      err.status = response.status;
      throw err;
    }

    return {
      mode: 'restored',
      restoredAt: payload?.restoredAt,
      message: payload?.message || 'Akun pengunjung berhasil diaktifkan kembali.',
    };
  },

  // ==========================================
  // RIWAYAT AKTIVITAS (activity_logs)
  // ==========================================
  async getActivityLogs(limit = 25): Promise<ActivityLog[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching activity logs:', error);
      return [];
    }

    return data || [];
  },

  // ==========================================
  // REALTIME SUBSCRIPTIONS
  // ==========================================
  subscribeToChanges(
    onBooksChange: () => void,
    onLoansChange: () => void,
    onCategoriesChange: () => void
  ) {
    const channel = supabase
      .channel('perpustakaan-merah-putih-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books' },
        () => onBooksChange()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans' },
        () => onLoansChange()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories' },
        () => onCategoriesChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
