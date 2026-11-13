import { Book, Loan, LoanStatus, MonthlyReportSummary } from '../types';

/**
 * Validate registration input fields.
 */
export function validateRegistration(data: {
  fullName?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!data.fullName || data.fullName.trim().length < 3) {
    errors.fullName = 'Nama lengkap minimal 3 karakter.';
  }

  if (!data.username || !/^[a-zA-Z0-9_]{3,20}$/.test(data.username)) {
    errors.username = 'Username harus 3-20 karakter alfanumerik (huruf, angka, garis bawah).';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email || !emailRegex.test(data.email)) {
    errors.email = 'Format alamat email tidak valid.';
  }

  if (!data.password || data.password.length < 6) {
    errors.password = 'Password minimal 6 karakter.';
  }

  if (data.confirmPassword !== undefined && data.password !== data.confirmPassword) {
    errors.confirmPassword = 'Konfirmasi password tidak cocok.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Compute current loan status:
 * Menangani status database Supabase: pending, approved, rejected, borrowed, returned, expired
 */
export function evaluateLoanStatus(
  dueAtStr?: string | null,
  returnedAtStr?: string | null,
  currentStatus: LoanStatus = 'pending',
  referenceDateStr?: string
): LoanStatus {
  if (returnedAtStr || currentStatus === 'returned') {
    return 'returned';
  }
  if (currentStatus === 'rejected') {
    return 'rejected';
  }
  if (currentStatus === 'pending') {
    return 'pending';
  }

  // Jika approved atau borrowed, periksa apakah sudah expired
  if (dueAtStr) {
    const today = referenceDateStr ? new Date(referenceDateStr) : new Date();
    today.setHours(0, 0, 0, 0);

    const due = new Date(dueAtStr);
    due.setHours(0, 0, 0, 0);

    if (today.getTime() > due.getTime()) {
      return 'expired';
    }
  }

  return currentStatus;
}

/**
 * Filter and sort books based on query, category, availability, and sort order.
 */
export function filterAndSortBooks(
  books: Book[],
  options: {
    query?: string;
    category?: string; // category name or category_id
    availability?: 'all' | 'available' | 'unavailable';
    sortBy?: 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'year-desc' | 'year-asc';
  }
): Book[] {
  let result = [...books];

  // Category filter
  if (options.category && options.category !== 'Semua') {
    const catSearch = options.category.toLowerCase().trim();
    result = result.filter((b) => {
      const catName = (b.category_name || b.category?.name || '').toLowerCase();
      const catId = b.category_id || '';
      return catName === catSearch || catId === options.category;
    });
  }

  // Availability filter (based on available_copies)
  if (options.availability === 'available') {
    result = result.filter((b) => (b.available_copies ?? 0) > 0);
  } else if (options.availability === 'unavailable') {
    result = result.filter((b) => (b.available_copies ?? 0) <= 0);
  }

  // Search query (title, author, publisher, isbn, description)
  if (options.query && options.query.trim().length > 0) {
    const q = options.query.toLowerCase().trim();
    result = result.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.publisher.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q) ||
        (b.category_name || b.category?.name || '').toLowerCase().includes(q)
    );
  }

  // Sorting
  switch (options.sortBy) {
    case 'newest':
      result.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
      break;
    case 'oldest':
      result.sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime());
      break;
    case 'title-asc':
      result.sort((a, b) => a.title.localeCompare(b.title, 'id'));
      break;
    case 'title-desc':
      result.sort((a, b) => b.title.localeCompare(a.title, 'id'));
      break;
    case 'year-desc':
      result.sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
      break;
    case 'year-asc':
      result.sort((a, b) => (a.publication_year || 0) - (b.publication_year || 0));
      break;
    default:
      break;
  }

  return result;
}

/**
 * Generate monthly report summary from loan records.
 */
export function aggregateMonthlyReport(
  loans: Loan[],
  period: string // YYYY-MM
): MonthlyReportSummary {
  const [yearStr, monthStr] = period.split('-');
  const monthNum = parseInt(monthStr, 10);
  const monthsIndo = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const periodLabel = `${monthsIndo[monthNum - 1] || 'Bulan'} ${yearStr}`;

  const monthLoans = loans.filter((loan) => (loan.requested_at || loan.created_at || '').startsWith(period));

  const totalLoans = monthLoans.length;
  const returnedLoans = monthLoans.filter((l) => l.status === 'returned').length;
  const pendingLoans = monthLoans.filter((l) => l.status === 'pending').length;
  const activeLoans = monthLoans.filter((l) => l.status === 'approved' || l.status === 'borrowed').length;

  const bookCountMap: Record<string, { title: string; author: string; coverUrl: string; count: number }> = {};
  for (const l of monthLoans) {
    if (!bookCountMap[l.book_id]) {
      bookCountMap[l.book_id] = {
        title: l.book?.title || 'Buku',
        author: l.book?.author || 'Penulis',
        coverUrl: l.book?.cover_path || '',
        count: 0,
      };
    }
    bookCountMap[l.book_id].count++;
  }

  const topBooks = Object.entries(bookCountMap)
    .map(([bookId, data]) => ({
      bookId,
      title: data.title,
      author: data.author,
      coverUrl: data.coverUrl,
      borrowCount: data.count,
    }))
    .sort((a, b) => b.borrowCount - a.borrowCount)
    .slice(0, 5);

  return {
    period,
    periodLabel,
    totalLoans,
    activeLoans,
    returnedLoans,
    pendingLoans,
    topBooks,
    categoryDistribution: [],
  };
}

/**
 * Format date in Indonesian locale (e.g. "12 November 2026")
 */
export function formatDateIndo(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
}
