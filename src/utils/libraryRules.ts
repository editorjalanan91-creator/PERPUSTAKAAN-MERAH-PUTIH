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
        (b.title || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.publisher || '').toLowerCase().includes(q) ||
        (b.isbn || '').toLowerCase().includes(q) ||
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

export const BOOK_RETURN_NOTIFICATIONS = {
  SUCCESS: {
    type: 'success' as const,
    title: 'Buku Berhasil Dikembalikan',
    message: 'Buku berhasil dikembalikan. Terima kasih!',
  },
  UNCONFIRMED: {
    type: 'error' as const,
    title: 'Pengembalian Buku Belum Dapat Dikonfirmasi',
    message:
      'Permintaan pengembalian buku belum dapat dikonfirmasi oleh sistem. Silakan periksa status peminjaman Anda atau hubungi administrator perpustakaan apabila kendala masih terjadi.',
  },
};

export function resolveBookReturnNotification(loanStatus?: LoanStatus | string | null) {
  if (loanStatus === 'returned') {
    return BOOK_RETURN_NOTIFICATIONS.SUCCESS;
  }
  return BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED;
}

export function formatLoanStatusIndo(status?: LoanStatus | string | null): string {
  switch (status) {
    case 'pending':
      return 'Menunggu Persetujuan';
    case 'approved':
    case 'borrowed':
      return 'Disetujui / Aktif';
    case 'returned':
      return 'Sudah Dikembalikan';
    case 'rejected':
      return 'Ditolak';
    case 'expired':
      return 'Kedaluwarsa';
    default:
      return String(status || '-');
  }
}

export function getLocalYearMonth(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getAvailableReportMonths(
  loans: Pick<Loan, 'requested_at' | 'created_at'>[],
  referenceDate: Date = new Date()
): Array<{ value: string; label: string }> {
  const monthsIndo = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  const periodSet = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
    periodSet.add(getLocalYearMonth(d));
  }

  for (const loan of loans) {
    const raw = (loan.requested_at || loan.created_at || '').trim();
    if (/^\d{4}-\d{2}/.test(raw)) {
      periodSet.add(raw.slice(0, 7));
    }
  }

  return Array.from(periodSet)
    .sort((a, b) => b.localeCompare(a))
    .map((val) => {
      const [yearStr, monthStr] = val.split('-');
      const monthIdx = parseInt(monthStr, 10) - 1;
      const monthLabel = monthsIndo[monthIdx] || 'Bulan';
      return {
        value: val,
        label: `${monthLabel} ${yearStr}`,
      };
    });
}

export function recalculateBookStockOnEdit(
  oldTotalCopies: number,
  oldAvailableCopies: number,
  newTotalCopies: number
):
  | { valid: true; totalCopies: number; availableCopies: number; borrowedCount: number }
  | { valid: false; error: string } {
  if (!Number.isInteger(newTotalCopies) || newTotalCopies < 1) {
    return {
      valid: false,
      error: 'Total eksemplar buku minimal harus 1 dan berupa bilangan bulat.',
    };
  }

  const safeOldTotal = Math.max(0, Math.floor(Number(oldTotalCopies) || 0));
  const safeOldAvailable = Math.max(0, Math.min(safeOldTotal, Math.floor(Number(oldAvailableCopies) || 0)));
  const borrowedCount = Math.max(0, safeOldTotal - safeOldAvailable);

  if (newTotalCopies < borrowedCount) {
    return {
      valid: false,
      error: `Total eksemplar (${newTotalCopies}) tidak boleh lebih kecil dari jumlah buku yang sedang dipinjam (${borrowedCount} eksemplar).`,
    };
  }

  const availableCopies = Math.max(0, Math.min(newTotalCopies, newTotalCopies - borrowedCount));
  return {
    valid: true,
    totalCopies: newTotalCopies,
    availableCopies,
    borrowedCount,
  };
}

export function validateBookFormInput(data: {
  title?: string;
  author?: string;
  category_id?: string;
  publication_year?: number | string;
  isbn?: string;
  total_copies?: number | string;
  currentYear?: number;
}): { valid: boolean; error?: string } {
  const title = (data.title || '').trim();
  if (title.length < 2) {
    return { valid: false, error: 'Judul buku wajib diisi minimal 2 karakter.' };
  }

  const author = (data.author || '').trim();
  if (author.length < 2) {
    return { valid: false, error: 'Nama penulis wajib diisi minimal 2 karakter.' };
  }

  if (!data.category_id || !data.category_id.trim()) {
    return {
      valid: false,
      error: 'Kategori buku wajib dipilih. Tambahkan kategori terlebih dahulu apabila daftar masih kosong.',
    };
  }

  const maxYear = (data.currentYear ?? new Date().getFullYear()) + 1;
  const pubYear = Number(data.publication_year);
  if (!Number.isInteger(pubYear) || pubYear < 1800 || pubYear > maxYear) {
    return {
      valid: false,
      error: `Tahun terbit harus berupa angka antara 1800 hingga ${maxYear}.`,
    };
  }

  const totalCopies = Number(data.total_copies);
  if (!Number.isInteger(totalCopies) || totalCopies < 1) {
    return {
      valid: false,
      error: 'Total eksemplar / stok buku minimal harus 1.',
    };
  }

  const isbn = (data.isbn || '').trim();
  if (isbn.length > 0 && !/^[0-9Xx\-\s]{4,32}$/.test(isbn)) {
    return {
      valid: false,
      error: 'Format nomor ISBN tidak valid (gunakan 4–32 karakter angka, tanda hubung "-", atau huruf X).',
    };
  }

  return { valid: true };
}

export const MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_BOOK_DOC_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function validateCoverFile(file: {
  name: string;
  size: number;
  type?: string;
}): { valid: boolean; error?: string } {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
  if (!allowedExts.includes(ext)) {
    return {
      valid: false,
      error: 'Format sampul harus berupa gambar JPG, JPEG, PNG, atau WEBP.',
    };
  }

  if (file.type && !file.type.toLowerCase().startsWith('image/')) {
    return {
      valid: false,
      error: 'Tipe berkas sampul tidak valid. Pilih berkas gambar yang sah.',
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      valid: false,
      error: 'Berkas gambar sampul kosong atau rusak.',
    };
  }

  if (file.size > MAX_COVER_SIZE_BYTES) {
    return {
      valid: false,
      error: 'Ukuran foto sampul maksimal 5 MB.',
    };
  }

  return { valid: true };
}

export function validateBookDocumentFile(file: {
  name: string;
  size: number;
  type?: string;
}): { valid: boolean; fileType?: 'pdf' | 'epub'; error?: string } {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext !== 'pdf' && ext !== 'epub') {
    return {
      valid: false,
      error: 'Format dokumen buku hanya mendukung berkas PDF (.pdf) atau EPUB (.epub).',
    };
  }

  const mime = (file.type || '').toLowerCase().split(';')[0].trim();
  if (mime) {
    const validPdfMime = ext === 'pdf' && (mime === 'application/pdf' || mime === 'application/x-pdf');
    const validEpubMime =
      ext === 'epub' &&
      (mime === 'application/epub+zip' ||
        mime === 'application/x-epub+zip' ||
        mime === 'application/octet-stream' ||
        mime === 'application/zip' ||
        mime === 'application/x-zip-compressed');
    if (!validPdfMime && !validEpubMime) {
      return {
        valid: false,
        error: `Tipe MIME berkas (${mime}) tidak sesuai dengan ekstensi .${ext}.`,
      };
    }
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      valid: false,
      error: 'Berkas dokumen buku kosong atau rusak.',
    };
  }

  if (file.size > MAX_BOOK_DOC_SIZE_BYTES) {
    return {
      valid: false,
      error: 'Ukuran dokumen PDF/EPUB maksimal 50 MB.',
    };
  }

  return { valid: true, fileType: ext };
}

export function evaluateLoanReturnEligibility(
  status?: LoanStatus | string | null
):
  | { eligible: true }
  | { eligible: false; reason: 'already_returned' | 'invalid_status'; message: string } {
  if (status === 'approved' || status === 'borrowed') {
    return { eligible: true };
  }

  if (status === 'returned') {
    return {
      eligible: false,
      reason: 'already_returned',
      message: 'Buku untuk transaksi peminjaman ini sudah dikembalikan sebelumnya.',
    };
  }

  if (status === 'pending') {
    return {
      eligible: false,
      reason: 'invalid_status',
      message: 'Pengajuan peminjaman yang masih menunggu persetujuan admin belum dapat dikembalikan.',
    };
  }

  if (status === 'rejected') {
    return {
      eligible: false,
      reason: 'invalid_status',
      message: 'Transaksi peminjaman yang telah ditolak tidak dapat dikembalikan.',
    };
  }

  if (status === 'expired') {
    return {
      eligible: false,
      reason: 'invalid_status',
      message: 'Transaksi peminjaman ini berstatus kedaluwarsa. Hubungi administrator perpustakaan untuk penyesuaian.',
    };
  }

  return {
    eligible: false,
    reason: 'invalid_status',
    message: 'Status transaksi peminjaman tidak memenuhi syarat untuk proses pengembalian.',
  };
}

export function computeBookStockAfterReturn(input: {
  beforeAvailable: number;
  afterAvailable: number;
  totalCopies: number;
}): {
  targetAvailable: number;
  safeBefore: number;
  safeAfter: number;
  safeTotal: number;
  needsUpdate: boolean;
  incrementedBy: 'trigger' | 'application' | 'capped_at_total';
} {
  const safeTotal = Math.max(0, Math.floor(Number(input.totalCopies) || 0));
  const safeBefore = Math.max(0, Math.floor(Number(input.beforeAvailable) || 0));
  const safeAfter = Math.max(0, Math.floor(Number(input.afterAvailable) || 0));

  // Jika trigger database sudah menaikkan available_copies secara otomatis saat status menjadi 'returned',
  // jangan tambahkan stok lagi dari aplikasi agar tidak terjadi penggandaan stok.
  if (safeAfter > safeBefore) {
    const clampedTarget = safeTotal > 0 ? Math.min(safeTotal, safeAfter) : safeAfter;
    return {
      targetAvailable: clampedTarget,
      safeBefore,
      safeAfter,
      safeTotal,
      needsUpdate: clampedTarget !== safeAfter,
      incrementedBy: 'trigger',
    };
  }

  // Jika trigger database tidak mengubah stok, naikkan tepat +1 (maksimal sebesar total_copies).
  const incremented = safeBefore + 1;
  const targetAvailable = safeTotal > 0 ? Math.min(safeTotal, incremented) : incremented;
  const needsUpdate = targetAvailable !== safeAfter;

  return {
    targetAvailable,
    safeBefore,
    safeAfter,
    safeTotal,
    needsUpdate,
    incrementedBy: needsUpdate ? 'application' : 'capped_at_total',
  };
}

export function computeBookStockAfterApprove(input: {
  beforeAvailable: number;
  afterAvailable: number;
  totalCopies: number;
}): {
  targetAvailable: number;
  safeBefore: number;
  safeAfter: number;
  safeTotal: number;
  needsUpdate: boolean;
  decrementedBy: 'trigger' | 'application' | 'floored_at_zero';
} {
  const safeTotal = Math.max(0, Math.floor(Number(input.totalCopies) || 0));
  const safeBefore = Math.max(0, Math.floor(Number(input.beforeAvailable) || 0));
  const safeAfter = Math.max(0, Math.floor(Number(input.afterAvailable) || 0));

  // Jika trigger database sudah menurunkan available_copies saat status menjadi 'approved',
  // jangan kurangi stok lagi dari aplikasi agar tidak terjadi pengurangan ganda.
  if (safeAfter < safeBefore) {
    const clampedTarget = safeTotal > 0 ? Math.min(safeTotal, Math.max(0, safeAfter)) : Math.max(0, safeAfter);
    return {
      targetAvailable: clampedTarget,
      safeBefore,
      safeAfter,
      safeTotal,
      needsUpdate: clampedTarget !== safeAfter,
      decrementedBy: 'trigger',
    };
  }

  // Jika trigger database tidak mengubah stok, turunkan tepat -1 (minimal 0).
  const decremented = Math.max(0, safeBefore - 1);
  const targetAvailable = safeTotal > 0 ? Math.min(safeTotal, decremented) : decremented;
  const needsUpdate = targetAvailable !== safeAfter;

  return {
    targetAvailable,
    safeBefore,
    safeAfter,
    safeTotal,
    needsUpdate,
    decrementedBy: needsUpdate ? 'application' : 'floored_at_zero',
  };
}

export const DEFAULT_DAILY_FINE_RP = 1000;

export function formatCurrencyIdr(amount: number): string {
  const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
  return `Rp ${new Intl.NumberFormat('id-ID').format(safeAmount)}`;
}

export function evaluateLoanOverdue(
  dueAtStr?: string | null,
  returnedAtStr?: string | null,
  status: LoanStatus | string = 'pending',
  referenceDateStr?: string,
  dailyFineRp: number = DEFAULT_DAILY_FINE_RP
): {
  isOverdue: boolean;
  overdueDays: number;
  estimatedFineRp: number;
  daysRemaining: number | null;
} {
  if (!dueAtStr || status === 'pending' || status === 'rejected') {
    return {
      isOverdue: false,
      overdueDays: 0,
      estimatedFineRp: 0,
      daysRemaining: null,
    };
  }

  const due = new Date(dueAtStr);
  if (Number.isNaN(due.getTime())) {
    return {
      isOverdue: false,
      overdueDays: 0,
      estimatedFineRp: 0,
      daysRemaining: null,
    };
  }
  due.setHours(0, 0, 0, 0);

  const safeDailyFine = Math.max(0, Math.floor(Number(dailyFineRp) || 0));
  const DAY_MS = 1000 * 60 * 60 * 24;

  if (status === 'returned' || returnedAtStr) {
    if (!returnedAtStr) {
      return {
        isOverdue: false,
        overdueDays: 0,
        estimatedFineRp: 0,
        daysRemaining: null,
      };
    }
    const returned = new Date(returnedAtStr);
    if (Number.isNaN(returned.getTime())) {
      return {
        isOverdue: false,
        overdueDays: 0,
        estimatedFineRp: 0,
        daysRemaining: null,
      };
    }
    returned.setHours(0, 0, 0, 0);
    const diffDays = Math.round((returned.getTime() - due.getTime()) / DAY_MS);
    const overdueDays = Math.max(0, diffDays);
    return {
      isOverdue: overdueDays > 0,
      overdueDays,
      estimatedFineRp: overdueDays * safeDailyFine,
      daysRemaining: null,
    };
  }

  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  if (Number.isNaN(refDate.getTime())) {
    return {
      isOverdue: false,
      overdueDays: 0,
      estimatedFineRp: 0,
      daysRemaining: null,
    };
  }
  refDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - refDate.getTime()) / DAY_MS);
  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      isOverdue: true,
      overdueDays,
      estimatedFineRp: overdueDays * safeDailyFine,
      daysRemaining: diffDays,
    };
  }

  return {
    isOverdue: false,
    overdueDays: 0,
    estimatedFineRp: 0,
    daysRemaining: diffDays,
  };
}

export function formatBookReturnErrorMessage(err: any): string {
  const code = String(err?.code || '').trim();
  const rawMessage = String(err?.message || '').trim();
  const lower = rawMessage.toLowerCase();

  if (
    code === 'PGRST116' ||
    lower.includes('cannot coerce the result to a single json object') ||
    lower.includes('0 rows')
  ) {
    return BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message;
  }

  if (
    code === '42501' ||
    lower.includes('permission denied') ||
    lower.includes('row-level security')
  ) {
    return 'Anda tidak memiliki izin akses untuk memperbarui pengembalian buku ini. Silakan hubungi administrator perpustakaan.';
  }

  return rawMessage || BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message;
}

export type DigitalReadAccessCode =
  | 'OK'
  | 'FORBIDDEN'
  | 'LOAN_DUE_DATE_REQUIRED'
  | 'LOAN_DUE_DATE_INVALID'
  | 'LOAN_EXPIRED';

export interface DigitalReadAccessResult {
  allowed: boolean;
  code: DigitalReadAccessCode;
  message: string;
}

export function evaluateDigitalBookReadAccess(
  loan: Pick<Loan, 'status' | 'due_at' | 'returned_at'> | null | undefined,
  nowMs: number = Date.now()
): DigitalReadAccessResult {
  if (!loan || loan.returned_at || (loan.status !== 'approved' && loan.status !== 'borrowed')) {
    return {
      allowed: false,
      code: 'FORBIDDEN',
      message:
        'Anda belum memiliki peminjaman aktif yang disetujui untuk membaca dokumen digital buku ini.',
    };
  }

  const rawDueAt = typeof loan.due_at === 'string' ? loan.due_at.trim() : '';
  if (!rawDueAt) {
    return {
      allowed: false,
      code: 'LOAN_DUE_DATE_REQUIRED',
      message:
        'Akses baca dokumen digital ditolak karena tanggal jatuh tempo peminjaman belum tersedia.',
    };
  }

  const dueMs = new Date(rawDueAt).getTime();
  if (!Number.isFinite(dueMs)) {
    return {
      allowed: false,
      code: 'LOAN_DUE_DATE_INVALID',
      message:
        'Akses baca dokumen digital ditolak karena tanggal jatuh tempo peminjaman tidak valid.',
    };
  }

  if (dueMs < nowMs) {
    return {
      allowed: false,
      code: 'LOAN_EXPIRED',
      message:
        'Masa peminjaman untuk membaca dokumen digital ini telah berakhir. Silakan kembalikan buku atau ajukan peminjaman ulang.',
    };
  }

  return {
    allowed: true,
    code: 'OK',
    message: 'Akses baca dokumen digital diizinkan.',
  };
}

export function evaluateActiveLoansReadAccess(
  loans: Array<Pick<Loan, 'status' | 'due_at' | 'returned_at'>> | null | undefined,
  nowMs: number = Date.now()
): DigitalReadAccessResult {
  if (!Array.isArray(loans) || loans.length === 0) {
    return evaluateDigitalBookReadAccess(null, nowMs);
  }

  let firstFailure: DigitalReadAccessResult | null = null;
  for (const loan of loans) {
    const check = evaluateDigitalBookReadAccess(loan, nowMs);
    if (check.allowed) {
      return check;
    }
    if (
      !firstFailure ||
      (firstFailure.code === 'FORBIDDEN' && check.code !== 'FORBIDDEN') ||
      (firstFailure.code !== 'LOAN_EXPIRED' && check.code === 'LOAN_EXPIRED')
    ) {
      firstFailure = check;
    }
  }

  return firstFailure || evaluateDigitalBookReadAccess(null, nowMs);
}

