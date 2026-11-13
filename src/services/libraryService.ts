import { supabase, recordActivityLog } from './supabaseClient';
import { Book, Category, Loan, Profile, ActivityLog } from '../types';

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

    if (userId) {
      await recordActivityLog(userId, 'create_category', 'categories', data.id, { name });
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
    const totalCopies = Math.max(1, bookData.total_copies || bookData.stock || 1);
    const availableCopies = bookData.available_copies !== undefined ? bookData.available_copies : totalCopies;

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

    if (book.available_copies <= 0) {
      throw new Error('Maaf, eksemplar buku ini sedang tidak tersedia.');
    }

    // 2. Periksa apakah pengunjung sudah memiliki pinjaman aktif / pending untuk buku yang sama
    const { data: existingLoan } = await supabase
      .from('loans')
      .select('id, status')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .in('status', ['pending', 'approved', 'borrowed'])
      .maybeSingle();

    if (existingLoan) {
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
        admin_note: notes ? `Catatan peminjam: ${notes}` : null,
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
    const approvedAt = new Date();
    const dueAt = new Date(approvedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('loans')
      .update({
        status: 'approved',
        approved_at: approvedAt.toISOString(),
        due_at: dueAt.toISOString(),
        admin_note: adminNote || 'Peminjaman telah disetujui administrator perpustakaan.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', loanId)
      .select(`
        *,
        book:books (id, title, author, cover_path, file_path),
        profile:profiles (id, full_name, username)
      `)
      .single();

    if (error) throw error;

    if (adminId) {
      await recordActivityLog(adminId, 'approve_loan', 'loans', loanId, {
        duration_days: durationDays,
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
    const { data, error } = await supabase
      .from('loans')
      .update({
        status: 'rejected',
        admin_note: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loanId)
      .select(`
        *,
        book:books (id, title, author, cover_path),
        profile:profiles (id, full_name, username)
      `)
      .single();

    if (error) throw error;

    if (adminId) {
      await recordActivityLog(adminId, 'reject_loan', 'loans', loanId, { reason });
    }

    return data;
  },

  /**
   * Konfirmasi pengembalian buku:
   * Status -> 'returned', set returned_at
   */
  async returnLoan(loanId: string, actorId?: string): Promise<Loan> {
    const returnedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('loans')
      .update({
        status: 'returned',
        returned_at: returnedAt,
        updated_at: returnedAt,
      })
      .eq('id', loanId)
      .select(`
        *,
        book:books (id, title, author, cover_path),
        profile:profiles (id, full_name, username)
      `)
      .single();

    if (error) throw error;

    if (actorId) {
      await recordActivityLog(actorId, 'return_loan', 'loans', loanId);
    }

    return data;
  },

  // ==========================================
  // PENGUNJUNG (profiles)
  // ==========================================
  async getVisitors(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .neq('role', 'admin')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching visitors:', error);
      throw error;
    }

    return data || [];
  },

  async deleteVisitor(id: string, adminId?: string): Promise<boolean> {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    if (adminId) {
      await recordActivityLog(adminId, 'delete_visitor', 'profiles', id);
    }
    return true;
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
