import { supabase, recordActivityLog, getBookFileSignedUrl } from './supabaseClient';
import { Book, Category, Loan, Profile, ActivityLog } from '../types';

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function readJsonResponse(response: Response): Promise<{ isJson: boolean; payload: any }> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};
  return { isJson, payload };
}

function buildApiError(message: string, payload: any, status: number): Error {
  const err: any = new Error(payload?.error || message);
  err.code = payload?.code;
  err.status = status;
  return err;
}

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

    // Hitung jumlah buku per kategori secara non-blocking agar kendala RLS pada tabel lain tidak menggagalkan daftar kategori
    let books: Array<{ category_id?: string | null }> | null = null;
    try {
      const { data } = await supabase
        .from('books')
        .select('category_id')
        .eq('is_archived', false);
      books = data;
    } catch {
      books = null;
    }

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

    const cleanName = (name || '').trim();
    if (cleanName.length < 2) {
      throw new Error('Nama kategori wajib diisi minimal 2 karakter.');
    }

    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    if (!slug) {
      throw new Error('Nama kategori harus mengandung huruf atau angka yang valid.');
    }

    const { data: existingCats } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .limit(1);

    if (existingCats && existingCats.length > 0) {
      throw new Error(`Kategori dengan nama "${cleanName}" sudah terdaftar.`);
    }

    const { data: insertedRows, error } = await supabase
      .from('categories')
      .insert({
        name: cleanName,
        slug,
        description: description ? description.trim() : null,
        is_active: true,
        created_by: creatorId || null,
      })
      .select();

    if (error) throw error;
    const data = insertedRows?.[0];
    if (!data) {
      throw new Error('Kategori gagal disimpan atau tidak dikembalikan oleh server.');
    }

    if (creatorId) {
      await recordActivityLog(creatorId, 'create_category', 'categories', data.id, { name: cleanName });
    }

    return data;
  },

  async updateCategory(
    id: string,
    updates: { name?: string; description?: string; is_active?: boolean },
    userId?: string
  ): Promise<Category> {
    const payload: any = { ...updates };
    if (updates.name !== undefined) {
      const cleanName = updates.name.trim();
      if (cleanName.length < 2) {
        throw new Error('Nama kategori wajib diisi minimal 2 karakter.');
      }
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      if (!slug) {
        throw new Error('Nama kategori harus mengandung huruf atau angka yang valid.');
      }
      payload.name = cleanName;
      payload.slug = slug;
    }
    if (updates.description !== undefined) {
      payload.description = updates.description ? updates.description.trim() : null;
    }

    const { data: updatedRows, error } = await supabase
      .from('categories')
      .update(payload)
      .eq('id', id)
      .select();

    if (error) throw error;
    const data = updatedRows?.[0];
    if (!data) {
      throw new Error('Kategori tidak ditemukan atau gagal diperbarui.');
    }

    if (userId) {
      await recordActivityLog(userId, 'update_category', 'categories', id, payload);
    }

    return data;
  },

  async deleteCategory(id: string, userId?: string): Promise<void> {
    // Periksa buku terkait melalui backend terverifikasi terlebih dahulu
    const booksFromApi = await this.getBooks(true).catch(() => null);
    if (booksFromApi) {
      const usedCount = booksFromApi.filter((b) => b.category_id === id && !b.is_archived).length;
      if (usedCount > 0) {
        throw new Error(
          `Kategori ini masih digunakan oleh ${usedCount} buku. Pindahkan kategori buku tersebut terlebih dahulu.`
        );
      }
    } else {
      const { data: books } = await supabase
        .from('books')
        .select('id')
        .eq('category_id', id)
        .eq('is_archived', false);

      if (books && books.length > 0) {
        throw new Error(
          `Kategori ini masih digunakan oleh ${books.length} buku. Pindahkan kategori buku tersebut terlebih dahulu.`
        );
      }
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
    const token = await getAccessToken();
    if (token) {
      const response = await fetch('/api/books', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const { isJson, payload } = await readJsonResponse(response);
      if (response.ok && Array.isArray(payload?.books)) {
        const list = (payload.books as Book[]).filter((b) =>
          isAdmin ? true : b.is_published !== false && !b.is_archived
        );
        return list.map((b) => ({
          ...b,
          category_name: b.category?.name || b.category_name || 'Tanpa Kategori',
        }));
      }
      if (response.status !== 404 || isJson) {
        throw buildApiError(
          `Gagal memuat daftar buku (HTTP ${response.status}).`,
          payload,
          response.status
        );
      }
    }

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

    const cleanCategoryId = String(bookData.category_id || '').trim();
    if (!cleanCategoryId) {
      throw new Error('Kategori buku wajib dipilih sebelum menyimpan data buku.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan masuk kembali.');
    }

    const response = await fetch('/api/admin/books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...bookData,
        title: bookData.title.trim(),
        category_id: cleanCategoryId,
        total_copies: totalCopies,
        available_copies: availableCopies,
      }),
    });

    const { isJson, payload } = await readJsonResponse(response);
    if (response.ok && payload?.book) {
      const saved = payload.book as Book;
      return {
        ...saved,
        category_name: saved.category?.name || saved.category_name || 'Tanpa Kategori',
      };
    }
    if (response.status !== 404 || isJson) {
      throw buildApiError(
        `Gagal menambahkan buku baru (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    const { data: insertedRows, error } = await supabase
      .from('books')
      .insert({
        title: bookData.title.trim(),
        author: (bookData.author || 'Penulis Mandiri').trim(),
        publisher: (bookData.publisher || 'Penerbit Mandiri').trim(),
        publication_year: bookData.publication_year || bookData.year || new Date().getFullYear(),
        isbn: (bookData.isbn || 'ISBN-978-000-000').trim(),
        category_id: cleanCategoryId,
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
      `);

    if (error) throw error;
    const data = insertedRows?.[0];
    if (!data) {
      throw new Error('Buku gagal ditambahkan ke database.');
    }

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
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      throw new Error('ID buku tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan masuk kembali.');
    }

    const response = await fetch(`/api/admin/books/${encodeURIComponent(cleanId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });

    const { isJson, payload } = await readJsonResponse(response);
    if (response.ok && payload?.book) {
      const updated = payload.book as Book;
      return {
        ...updated,
        category_name: updated.category?.name || updated.category_name || 'Tanpa Kategori',
      };
    }
    if (response.status !== 404 || isJson) {
      throw buildApiError(
        `Gagal memperbarui data buku (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    const { category, category_name, ...cleanUpdates } = updates as any;
    cleanUpdates.updated_at = new Date().toISOString();

    const { data: updatedRows, error } = await supabase
      .from('books')
      .update(cleanUpdates)
      .eq('id', cleanId)
      .select(`
        *,
        category:categories (
          id,
          name,
          slug
        )
      `);

    if (error) throw error;
    const data = updatedRows?.[0];
    if (!data) {
      throw new Error('Data buku tidak ditemukan atau tidak memiliki izin untuk memperbarui.');
    }

    if (userId) {
      await recordActivityLog(userId, 'update_book', 'books', cleanId, { title: data.title });
    }

    return {
      ...data,
      category_name: data.category?.name || 'Tanpa Kategori',
    };
  },

  async deleteBook(id: string, userId?: string): Promise<void> {
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      throw new Error('ID buku tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan masuk kembali.');
    }

    const response = await fetch(`/api/admin/books/${encodeURIComponent(cleanId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const { isJson, payload } = await readJsonResponse(response);
    if (response.ok) {
      return;
    }
    if (response.status !== 404 || isJson) {
      throw buildApiError(
        `Gagal menghapus buku (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    // Fallback statis tanpa backend
    const { data: activeLoans } = await supabase
      .from('loans')
      .select('id')
      .eq('book_id', cleanId)
      .in('status', ['pending', 'approved', 'borrowed']);

    if (activeLoans && activeLoans.length > 0) {
      throw new Error('Buku ini tidak dapat dihapus karena masih memiliki transaksi peminjaman aktif.');
    }

    const { error } = await supabase.from('books').delete().eq('id', cleanId);
    if (error) throw error;

    if (userId) {
      await recordActivityLog(userId, 'delete_book', 'books', cleanId);
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
    const token = await getAccessToken();
    if (!token) {
      return [];
    }

    const response = await fetch('/api/loans', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const { isJson, payload } = await readJsonResponse(response);
    if (response.ok && Array.isArray(payload?.loans)) {
      const list = payload.loans as Loan[];
      if (!isAdmin && userId) {
        return list.filter((l) => l.user_id === userId);
      }
      return list;
    }
    if (response.status !== 404 || isJson) {
      throw buildApiError(
        `Gagal memuat daftar peminjaman (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

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

    if (!isAdmin) {
      if (!userId) return [];
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
   * Pengunjung mengajukan peminjaman buku melalui backend terverifikasi (/api/loans)
   * Status awal wajib 'pending' hingga disetujui oleh administrator.
   */
  async requestLoan(
    userId: string,
    bookId: string,
    notes?: string
  ): Promise<Loan> {
    const cleanBookId = String(bookId || '').trim();
    if (!cleanBookId) {
      throw new Error('ID buku tidak valid.');
    }

    const cleanNotes = typeof notes === 'string' ? notes : undefined;

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali untuk mengajukan peminjaman.');
    }

    const response = await fetch('/api/loans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        bookId: cleanBookId,
        notes: cleanNotes,
      }),
    });

    const { isJson, payload } = await readJsonResponse(response);
    if (response.ok && payload?.loan) {
      return payload.loan as Loan;
    }
    if (response.status !== 404 || isJson) {
      throw buildApiError(
        `Gagal mengajukan peminjaman buku (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    // Fallback statis tanpa backend
    const finalNotes = cleanNotes;
    const { data: bookRows, error: bookError } = await supabase
      .from('books')
      .select('id, title, available_copies, is_published, is_archived')
      .eq('id', cleanBookId)
      .limit(2);

    if (bookError || !bookRows || bookRows.length === 0) {
      throw new Error('Buku tidak ditemukan.');
    }

    const book = bookRows[0];
    if (!book.is_published || book.is_archived) {
      throw new Error('Maaf, buku ini sedang diarsipkan atau belum dipublikasikan untuk dipinjam.');
    }
    if (book.available_copies <= 0) {
      throw new Error('Maaf, eksemplar buku ini sedang tidak tersedia.');
    }

    const { data: existingLoans, error: existingErr } = await supabase
      .from('loans')
      .select('id, status')
      .eq('user_id', userId)
      .eq('book_id', cleanBookId)
      .in('status', ['pending', 'approved', 'borrowed'])
      .limit(1);

    if (existingErr) {
      throw new Error('Gagal memeriksa status peminjaman sebelumnya. Silakan coba kembali.');
    }
    if (existingLoans && existingLoans.length > 0) {
      throw new Error('Anda sudah memiliki permintaan atau peminjaman aktif untuk buku ini.');
    }

    const requestedAt = new Date().toISOString();
    const { data: insertedLoans, error } = await supabase
      .from('loans')
      .insert({
        user_id: userId,
        book_id: cleanBookId,
        status: 'pending',
        requested_at: requestedAt,
        due_at: null,
        admin_note: finalNotes && finalNotes.trim() ? `Catatan peminjam: ${finalNotes.trim()}` : null,
      })
      .select(`
        *,
        book:books (id, title, author, cover_path, file_path)
      `);

    if (error) throw error;
    const data = insertedLoans?.[0];
    if (!data) {
      throw new Error('Pengajuan peminjaman gagal dikonfirmasi oleh database.');
    }

    await recordActivityLog(userId, 'request_loan', 'loans', data.id, { book_title: book.title });
    return data;
  },

  /**
   * Mendapatkan tautan baca buku digital privat terverifikasi melalui backend (/api/books/:id/read-url)
   */
  async getBookDigitalReadUrl(
    bookId: string,
    fallbackFilePath?: string | null
  ): Promise<string> {
    const cleanBookId = String(bookId || '').trim();
    if (!cleanBookId) {
      throw new Error('ID buku tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali untuk membaca dokumen.');
    }

    const response = await fetch(`/api/books/${encodeURIComponent(cleanBookId)}/read-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const { payload } = await readJsonResponse(response);
    if (response.ok && payload?.url) {
      return payload.url as string;
    }

    if (!payload?.code && response.status === 404 && fallbackFilePath) {
      const signed = await getBookFileSignedUrl(fallbackFilePath, 7200);
      if (signed) return signed;
    }

    throw buildApiError(
      `Gagal menyiapkan tautan baca dokumen digital (HTTP ${response.status}).`,
      payload,
      response.status
    );
  },

  /**
   * Admin menyetujui peminjaman melalui endpoint backend resmi (/api/loans/:id/approve)
   * menggunakan SUPABASE_SERVICE_ROLE_KEY setelah validasi sesi & role Admin.
   */
  async approveLoan(
    loanId: string,
    adminNote?: string,
    _adminId?: string
  ): Promise<Loan> {
    const cleanLoanId = String(loanId || '').trim();
    if (!cleanLoanId) {
      throw new Error('ID transaksi peminjaman tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan masuk kembali.');
    }

    const response = await fetch(`/api/loans/${encodeURIComponent(cleanLoanId)}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ adminNote }),
    });

    const { payload } = await readJsonResponse(response);
    if (!response.ok || !payload?.loan) {
      throw buildApiError(
        `Gagal menyetujui peminjaman buku (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    return payload.loan as Loan;
  },

  /**
   * Admin menolak peminjaman melalui endpoint backend resmi (/api/loans/:id/reject)
   * menggunakan SUPABASE_SERVICE_ROLE_KEY setelah validasi sesi & role Admin.
   */
  async rejectLoan(
    loanId: string,
    reason = 'Permintaan peminjaman belum dapat disetujui saat ini.',
    _adminId?: string
  ): Promise<Loan> {
    const cleanLoanId = String(loanId || '').trim();
    if (!cleanLoanId) {
      throw new Error('ID transaksi peminjaman tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan masuk kembali.');
    }

    const response = await fetch(`/api/loans/${encodeURIComponent(cleanLoanId)}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    });

    const { payload } = await readJsonResponse(response);
    if (!response.ok || !payload?.loan) {
      throw buildApiError(
        `Gagal menolak permintaan peminjaman (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    return payload.loan as Loan;
  },

  /**
   * Konfirmasi pengembalian buku:
   * - Eksklusif memanggil backend resmi (/api/loans/:id/return) dengan token sesi terverifikasi
   * - Backend memproses transaksi via SUPABASE_SERVICE_ROLE_KEY (tanpa akses UPDATE langsung dari browser)
   * - Menggunakan primary key transaksi (loans.id), idempoten terhadap 'returned', & menjaga stok tepat +1
   */
  async returnLoan(loanId: string, _actorId?: string): Promise<Loan> {
    const cleanLoanId = String(loanId || '').trim();
    if (!cleanLoanId) {
      throw new Error('ID transaksi peminjaman tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali untuk mengembalikan buku.');
    }

    const response = await fetch(`/api/loans/${encodeURIComponent(cleanLoanId)}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const { payload } = await readJsonResponse(response);
    if (response.ok && payload?.loan) {
      return payload.loan as Loan;
    }

    throw buildApiError(
      `Gagal mengonfirmasi pengembalian buku (HTTP ${response.status}).`,
      payload,
      response.status
    );
  },

  // ==========================================
  // PENGUNJUNG (profiles & server admin API)
  // ==========================================
  async getVisitors(): Promise<Profile[]> {
    const token = await getAccessToken();
    if (token) {
      const response = await fetch('/api/admin/visitors', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const { isJson, payload } = await readJsonResponse(response);
      if (response.ok && Array.isArray(payload?.visitors)) {
        return payload.visitors as Profile[];
      }
      if (response.status !== 404 || isJson) {
        throw buildApiError(
          `Gagal memuat daftar pengunjung (HTTP ${response.status}).`,
          payload,
          response.status
        );
      }
    }

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

    return (profilesData || []).filter(
      (p: any) => p.role !== 'admin' && p.role !== 'super_admin' && p.is_super_admin !== true
    );
  },

  async deleteVisitor(id: string): Promise<{ mode: 'deleted'; message: string }> {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

  async createVisitor(payloadInput: {
    full_name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<{ visitor: Profile; message: string }> {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch('/api/admin/visitors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payloadInput),
    });

    const { payload } = await readJsonResponse(response);
    if (!response.ok || !payload?.visitor) {
      throw buildApiError(
        `Gagal menambahkan akun pengunjung (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    return {
      visitor: payload.visitor as Profile,
      message: payload?.message || 'Akun pengunjung baru berhasil dibuat.',
    };
  },

  async updateVisitor(
    id: string,
    updates: { full_name: string; username: string }
  ): Promise<{ visitor: Profile; message: string }> {
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      throw new Error('ID akun pengunjung tidak valid.');
    }

    const token = await getAccessToken();
    if (!token) {
      throw new Error('Sesi administrator tidak ditemukan. Silakan login kembali.');
    }

    const response = await fetch(`/api/admin/visitors/${encodeURIComponent(cleanId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });

    const { payload } = await readJsonResponse(response);
    if (!response.ok || !payload?.visitor) {
      throw buildApiError(
        `Gagal memperbarui data pengunjung (HTTP ${response.status}).`,
        payload,
        response.status
      );
    }

    return {
      visitor: payload.visitor as Profile,
      message: payload?.message || 'Data pengunjung berhasil diperbarui.',
    };
  },

  // ==========================================
  // RIWAYAT AKTIVITAS (activity_logs)
  // ==========================================
  async getActivityLogs(limit = 25): Promise<ActivityLog[]> {
    const token = await getAccessToken();
    if (token) {
      const response = await fetch(
        `/api/admin/activity-logs?limit=${encodeURIComponent(String(limit))}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const { isJson, payload } = await readJsonResponse(response);
      if (response.ok && Array.isArray(payload?.logs)) {
        return payload.logs as ActivityLog[];
      }
      if (response.status !== 404 || isJson) {
        return [];
      }
    }

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
