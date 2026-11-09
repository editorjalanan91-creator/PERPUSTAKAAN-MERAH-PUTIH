import { Book, Loan, MonthlyReportSummary } from '../types';

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
 * Compute current loan status: 'active' | 'returned' | 'overdue'
 */
export function evaluateLoanStatus(
  dueDateStr: string,
  returnDateStr?: string,
  referenceDateStr?: string
): 'active' | 'returned' | 'overdue' {
  if (returnDateStr) {
    return 'returned';
  }
  const today = referenceDateStr ? new Date(referenceDateStr) : new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  if (today.getTime() > due.getTime()) {
    return 'overdue';
  }
  return 'active';
}

/**
 * Filter and sort books based on query, category, availability, and sort order.
 */
export function filterAndSortBooks(
  books: Book[],
  options: {
    query?: string;
    category?: string;
    availability?: 'all' | 'available' | 'unavailable';
    sortBy?: 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'year-desc' | 'year-asc';
  }
): Book[] {
  let result = [...books];

  // Category filter
  if (options.category && options.category !== 'Semua') {
    result = result.filter(
      (b) => b.category.toLowerCase() === options.category?.toLowerCase()
    );
  }

  // Availability filter
  if (options.availability === 'available') {
    result = result.filter((b) => b.stock > 0);
  } else if (options.availability === 'unavailable') {
    result = result.filter((b) => b.stock <= 0);
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
        b.category.toLowerCase().includes(q)
    );
  }

  // Sorting
  switch (options.sortBy) {
    case 'newest':
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case 'oldest':
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'title-asc':
      result.sort((a, b) => a.title.localeCompare(b.title, 'id'));
      break;
    case 'title-desc':
      result.sort((a, b) => b.title.localeCompare(a.title, 'id'));
      break;
    case 'year-desc':
      result.sort((a, b) => b.year - a.year);
      break;
    case 'year-asc':
      result.sort((a, b) => a.year - b.year);
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
  // Period label in Indonesian
  const [yearStr, monthStr] = period.split('-');
  const monthNum = parseInt(monthStr, 10);
  const monthsIndo = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const periodLabel = `${monthsIndo[monthNum - 1] || 'Bulan'} ${yearStr}`;

  // Filter loans that fall into this month (either borrowDate or dueDate in this month)
  const monthLoans = loans.filter((loan) => loan.borrowDate.startsWith(period));

  const totalLoans = monthLoans.length;
  const returnedLoans = monthLoans.filter((l) => l.status === 'returned').length;
  const overdueLoans = monthLoans.filter((l) => l.status === 'overdue').length;
  const activeLoans = monthLoans.filter((l) => l.status === 'active').length;

  const onTimeReturns = monthLoans.filter((l) => {
    if (l.status === 'returned' && l.returnDate && l.dueDate) {
      return new Date(l.returnDate) <= new Date(l.dueDate);
    }
    return false;
  }).length;

  const onTimeReturnRate = returnedLoans > 0
    ? Math.round((onTimeReturns / returnedLoans) * 100)
    : 100;

  // Book frequency
  const bookCountMap: Record<string, { title: string; author: string; coverUrl: string; count: number }> = {};
  for (const l of monthLoans) {
    if (!bookCountMap[l.bookId]) {
      bookCountMap[l.bookId] = {
        title: l.bookTitle,
        author: l.bookAuthor,
        coverUrl: l.bookCover,
        count: 0,
      };
    }
    bookCountMap[l.bookId].count++;
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

  // Daily distribution
  const dayMap: Record<string, number> = {};
  for (const l of monthLoans) {
    const day = l.borrowDate;
    dayMap[day] = (dayMap[day] || 0) + 1;
  }
  const dailyTrend = Object.entries(dayMap)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    period,
    periodLabel,
    totalLoans,
    activeLoans,
    returnedLoans,
    overdueLoans,
    onTimeReturnRate,
    topBooks,
    categoryDistribution: [],
    dailyTrend,
  };
}

/**
 * Format date in Indonesian locale (e.g. "9 November 2026")
 */
export function formatDateIndo(dateStr: string): string {
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
