import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  evaluateLoanStatus,
  filterAndSortBooks,
  aggregateMonthlyReport,
  formatDateIndo,
  BOOK_RETURN_NOTIFICATIONS,
  resolveBookReturnNotification,
  formatLoanStatusIndo,
  getLocalYearMonth,
  getAvailableReportMonths,
  recalculateBookStockOnEdit,
  validateBookFormInput,
  validateCoverFile,
  validateBookDocumentFile,
  evaluateLoanReturnEligibility,
  computeBookStockAfterReturn,
  computeBookStockAfterApprove,
  DEFAULT_DAILY_FINE_RP,
  formatCurrencyIdr,
  evaluateLoanOverdue,
  formatBookReturnErrorMessage,
  evaluateDigitalBookReadAccess,
  evaluateActiveLoansReadAccess,
} from './libraryRules';
import { Book, Loan } from '../types';

test('validateRegistration - succeeds on valid data', () => {
  const result = validateRegistration({
    fullName: 'Budi Santoso',
    username: 'budisantoso',
    email: 'budi@example.com',
    password: 'Password123',
    confirmPassword: 'Password123',
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
});

test('validateRegistration - fails on mismatched password and invalid email', () => {
  const result = validateRegistration({
    fullName: 'Bu',
    username: 'bu',
    email: 'budi-invalid',
    password: '123',
    confirmPassword: '456',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.fullName);
  assert.ok(result.errors.username);
  assert.ok(result.errors.email);
  assert.ok(result.errors.password);
  assert.ok(result.errors.confirmPassword);
});

test('evaluateLoanStatus - handles pending, approved, expired, and returned states', () => {
  // Returned if returnedAt is present or status is returned
  assert.equal(
    evaluateLoanStatus('2026-11-01', '2026-11-05', 'returned'),
    'returned'
  );

  // Pending remains pending
  assert.equal(
    evaluateLoanStatus(undefined, undefined, 'pending'),
    'pending'
  );

  // Approved and before dueAt
  assert.equal(
    evaluateLoanStatus('2026-11-20', undefined, 'approved', '2026-11-12'),
    'approved'
  );

  // Expired if today is after dueAt
  assert.equal(
    evaluateLoanStatus('2026-11-05', undefined, 'approved', '2026-11-12'),
    'expired'
  );
});

test('filterAndSortBooks - filters by query, category, availability and sorts', () => {
  const mockBooks: Book[] = [
    {
      id: 'b1',
      title: 'Laskar Pelangi',
      author: 'Andrea Hirata',
      publisher: 'Bentang Pustaka',
      publication_year: 2005,
      isbn: '978-979-3062-79-2',
      category_id: 'cat_1',
      category_name: 'Fiksi & Sastra',
      total_copies: 3,
      available_copies: 3,
      is_published: true,
      is_archived: false,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b2',
      title: 'Sapiens: Riwayat Singkat Umat Manusia',
      author: 'Yuval Noah Harari',
      publisher: 'KPG',
      publication_year: 2014,
      isbn: '978-602-424-416-3',
      category_id: 'cat_2',
      category_name: 'Sains & Teknologi',
      total_copies: 2,
      available_copies: 0,
      is_published: true,
      is_archived: false,
      created_at: '2026-02-01T00:00:00Z',
    },
    {
      id: 'b3',
      title: 'Bumi Manusia',
      author: 'Pramoedya Ananta Toer',
      publisher: 'Lentera Dipantara',
      publication_year: 1980,
      isbn: '978-979-97312-3-4',
      category_id: 'cat_1',
      category_name: 'Fiksi & Sastra',
      total_copies: 5,
      available_copies: 5,
      is_published: true,
      is_archived: false,
      created_at: '2026-03-01T00:00:00Z',
    },
  ];

  // Search by author
  const searchAuthor = filterAndSortBooks(mockBooks, { query: 'Andrea' });
  assert.equal(searchAuthor.length, 1);
  assert.equal(searchAuthor[0].id, 'b1');

  // Filter by category
  const fiksiOnly = filterAndSortBooks(mockBooks, { category: 'Fiksi & Sastra' });
  assert.equal(fiksiOnly.length, 2);

  // Filter by availability: only available
  const availableOnly = filterAndSortBooks(mockBooks, { availability: 'available' });
  assert.equal(availableOnly.length, 2);
  assert.ok(availableOnly.every((b) => b.available_copies > 0));

  // Sort by year desc
  const sortedYear = filterAndSortBooks(mockBooks, { sortBy: 'year-desc' });
  assert.equal(sortedYear[0].id, 'b2'); // 2014
  assert.equal(sortedYear[2].id, 'b3'); // 1980

  // Null-safe search on legacy rows missing publisher/isbn
  const legacyBooks = [
    {
      ...mockBooks[0],
      id: 'b-legacy',
      publisher: null as unknown as string,
      isbn: null as unknown as string,
      author: null as unknown as string,
    },
  ];
  const nullSafeRes = filterAndSortBooks(legacyBooks, { query: 'Laskar' });
  assert.equal(nullSafeRes.length, 1);
  assert.equal(nullSafeRes[0].id, 'b-legacy');
});

test('aggregateMonthlyReport - calculates statistics correctly', () => {
  const sampleLoans: Loan[] = [
    {
      id: 'l1',
      user_id: 'u1',
      book_id: 'b1',
      status: 'returned',
      requested_at: '2026-11-01T00:00:00Z',
      due_at: '2026-11-08T00:00:00Z',
      returned_at: '2026-11-07T00:00:00Z',
      book: {
        id: 'b1',
        title: 'Laskar Pelangi',
        author: 'Andrea Hirata',
        publisher: 'Bentang',
        publication_year: 2005,
        isbn: '123',
        category_id: 'c1',
        total_copies: 3,
        available_copies: 2,
        is_published: true,
        is_archived: false,
      },
    },
    {
      id: 'l2',
      user_id: 'u2',
      book_id: 'b1',
      status: 'approved',
      requested_at: '2026-11-03T00:00:00Z',
      due_at: '2026-11-10T00:00:00Z',
      book: {
        id: 'b1',
        title: 'Laskar Pelangi',
        author: 'Andrea Hirata',
        publisher: 'Bentang',
        publication_year: 2005,
        isbn: '123',
        category_id: 'c1',
        total_copies: 3,
        available_copies: 2,
        is_published: true,
        is_archived: false,
      },
    },
    {
      id: 'l3',
      user_id: 'u3',
      book_id: 'b3',
      status: 'pending',
      requested_at: '2026-11-05T00:00:00Z',
    },
  ];

  const report = aggregateMonthlyReport(sampleLoans, '2026-11');
  assert.equal(report.period, '2026-11');
  assert.equal(report.totalLoans, 3);
  assert.equal(report.returnedLoans, 1);
  assert.equal(report.activeLoans, 1);
  assert.equal(report.pendingLoans, 1);
  assert.equal(report.topBooks[0].bookId, 'b1');
  assert.equal(report.topBooks[0].borrowCount, 2);
});

test('formatDateIndo - formats date to Indonesian readable string', () => {
  const str = formatDateIndo('2026-11-09');
  assert.ok(str.includes('November') && str.includes('2026'));
});

test('resolveBookReturnNotification - returns success when transaction status is returned and safe Indonesian message when unconfirmed', () => {
  const successNotice = resolveBookReturnNotification('returned');
  assert.equal(successNotice.type, 'success');
  assert.equal(successNotice.title, 'Buku Berhasil Dikembalikan');
  assert.equal(successNotice.message, BOOK_RETURN_NOTIFICATIONS.SUCCESS.message);

  for (const status of ['approved', 'borrowed', 'pending', null, undefined]) {
    const failNotice = resolveBookReturnNotification(status);
    assert.equal(failNotice.type, 'error');
    assert.equal(failNotice.title, 'Pengembalian Buku Belum Dapat Dikonfirmasi');
    assert.equal(
      failNotice.message,
      'Permintaan pengembalian buku belum dapat dikonfirmasi oleh sistem. Silakan periksa status peminjaman Anda atau hubungi administrator perpustakaan apabila kendala masih terjadi.'
    );
    assert.equal(failNotice.message.includes('Cannot coerce'), false);
    assert.equal(failNotice.message.includes('PGRST'), false);
  }
});

test('recalculateBookStockOnEdit - preserves borrowed copies invariant and rejects invalid reductions', () => {
  // Total 5, available 3 -> 2 borrowed. Raising total to 8 -> available 6
  const raised = recalculateBookStockOnEdit(5, 3, 8);
  assert.equal(raised.valid, true);
  if (raised.valid) {
    assert.equal(raised.totalCopies, 8);
    assert.equal(raised.availableCopies, 6);
    assert.equal(raised.borrowedCount, 2);
  }

  // Reducing total from 5 to 4 when 2 are borrowed -> available 2
  const reduced = recalculateBookStockOnEdit(5, 3, 4);
  assert.equal(reduced.valid, true);
  if (reduced.valid) {
    assert.equal(reduced.availableCopies, 2);
  }

  // Reject reducing total below active borrowed count (1 < 2)
  const invalid = recalculateBookStockOnEdit(5, 3, 1);
  assert.equal(invalid.valid, false);
});

test('validateBookFormInput, validateCoverFile, and validateBookDocumentFile enforce strict book and PDF rules', () => {
  assert.equal(
    validateBookFormInput({
      title: 'Bumi Manusia',
      author: 'Pramoedya Ananta Toer',
      category_id: 'cat-1',
      publication_year: 2020,
      isbn: '978-979-97312-3-4',
      total_copies: 3,
      currentYear: 2026,
    }).valid,
    true
  );

  assert.equal(
    validateBookFormInput({
      title: 'A',
      author: 'Author',
      category_id: 'cat-1',
      publication_year: 2020,
      total_copies: 1,
    }).valid,
    false
  );

  assert.equal(
    validateBookFormInput({
      title: 'Judul Valid',
      author: 'Penulis Valid',
      category_id: '',
      publication_year: 2020,
      total_copies: 1,
    }).valid,
    false
  );

  assert.equal(
    validateCoverFile({ name: 'sampul.jpg', size: 1024 * 500, type: 'image/jpeg' }).valid,
    true
  );
  assert.equal(
    validateCoverFile({ name: 'script.exe', size: 1024, type: 'application/octet-stream' }).valid,
    false
  );

  const validPdf = validateBookDocumentFile({
    name: 'modul.pdf',
    size: 1024 * 1024,
    type: 'application/pdf',
  });
  assert.equal(validPdf.valid, true);
  assert.equal(validPdf.fileType, 'pdf');

  assert.equal(
    validateBookDocumentFile({
      name: 'dokumen.docx',
      size: 1024,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }).valid,
    false
  );
  assert.equal(
    validateBookDocumentFile({ name: 'kosong.pdf', size: 0, type: 'application/pdf' }).valid,
    false
  );
  assert.equal(
    validateBookDocumentFile({
      name: 'terlalu-besar.pdf',
      size: 60 * 1024 * 1024,
      type: 'application/pdf',
    }).valid,
    false
  );
});

test('getLocalYearMonth, getAvailableReportMonths, and formatLoanStatusIndo work accurately without UTC shift', () => {
  const localNov = new Date(2026, 10, 1, 0, 15, 0); // 1 Nov 2026 00:15 local time
  assert.equal(getLocalYearMonth(localNov), '2026-11');

  const months = getAvailableReportMonths(
    [{ requested_at: '2025-02-10T10:00:00Z' }],
    localNov
  );
  assert.equal(months[0].value, '2026-11');
  assert.ok(months.some((m) => m.value === '2025-02'));
  assert.equal(formatLoanStatusIndo('approved'), 'Disetujui / Aktif');
  assert.equal(formatLoanStatusIndo('returned'), 'Sudah Dikembalikan');
});

test('evaluateLoanReturnEligibility allows approved/borrowed, marks returned as already_returned, and rejects non-active statuses', () => {
  assert.deepEqual(evaluateLoanReturnEligibility('approved'), { eligible: true });
  assert.deepEqual(evaluateLoanReturnEligibility('borrowed'), { eligible: true });

  const alreadyReturned = evaluateLoanReturnEligibility('returned');
  assert.equal(alreadyReturned.eligible, false);
  if (!alreadyReturned.eligible) {
    assert.equal(alreadyReturned.reason, 'already_returned');
  }

  for (const status of ['pending', 'rejected', 'expired', 'unknown_status', null] as const) {
    const res = evaluateLoanReturnEligibility(status);
    assert.equal(res.eligible, false);
    if (!res.eligible) {
      assert.equal(res.reason, 'invalid_status');
      assert.ok(res.message.length > 10);
    }
  }
});

test('computeBookStockAfterReturn increments stock exactly once and prevents double-increment when a DB trigger is active', () => {
  // Tanpa trigger database: before=2, after=2, total=5 => aplikasi naikkan tepat +1 ke 3
  const appIncrement = computeBookStockAfterReturn({
    beforeAvailable: 2,
    afterAvailable: 2,
    totalCopies: 5,
  });
  assert.equal(appIncrement.targetAvailable, 3);
  assert.equal(appIncrement.needsUpdate, true);
  assert.equal(appIncrement.incrementedBy, 'application');

  // Dengan trigger database: before=2, after=3, total=5 => tidak update lagi (hindari stok jadi 4)
  const triggerIncrement = computeBookStockAfterReturn({
    beforeAvailable: 2,
    afterAvailable: 3,
    totalCopies: 5,
  });
  assert.equal(triggerIncrement.targetAvailable, 3);
  assert.equal(triggerIncrement.needsUpdate, false);
  assert.equal(triggerIncrement.incrementedBy, 'trigger');

  // Tidak pernah melebihi total_copies
  const capped = computeBookStockAfterReturn({
    beforeAvailable: 5,
    afterAvailable: 5,
    totalCopies: 5,
  });
  assert.equal(capped.targetAvailable, 5);
  assert.equal(capped.needsUpdate, false);
  assert.equal(capped.incrementedBy, 'capped_at_total');

  // Trigger melebihi total_copies => clamp turun ke total_copies
  const clampedTrigger = computeBookStockAfterReturn({
    beforeAvailable: 4,
    afterAvailable: 6,
    totalCopies: 5,
  });
  assert.equal(clampedTrigger.targetAvailable, 5);
  assert.equal(clampedTrigger.needsUpdate, true);
  assert.equal(clampedTrigger.incrementedBy, 'trigger');
});

test('formatBookReturnErrorMessage hides PostgREST PGRST116 / RLS technical errors behind clear Indonesian copy', () => {
  assert.equal(
    formatBookReturnErrorMessage({
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    }),
    BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message
  );

  assert.equal(
    formatBookReturnErrorMessage({
      message: 'JSON object requested, multiple (or no) rows returned (0 rows)',
    }),
    BOOK_RETURN_NOTIFICATIONS.UNCONFIRMED.message
  );

  assert.match(
    formatBookReturnErrorMessage({
      code: '42501',
      message: 'new row violates row-level security policy for table "loans"',
    }),
    /izin akses/i
  );
});

test('computeBookStockAfterApprove decrements stock once and avoids double-decrement when DB trigger already reduced available_copies', () => {
  // Tanpa trigger database: before=3, after=3, total=5 => turun tepat -1 ke 2
  const appDec = computeBookStockAfterApprove({
    beforeAvailable: 3,
    afterAvailable: 3,
    totalCopies: 5,
  });
  assert.equal(appDec.targetAvailable, 2);
  assert.equal(appDec.needsUpdate, true);
  assert.equal(appDec.decrementedBy, 'application');

  // Dengan trigger database: before=3, after=2, total=5 => tidak update lagi
  const triggerDec = computeBookStockAfterApprove({
    beforeAvailable: 3,
    afterAvailable: 2,
    totalCopies: 5,
  });
  assert.equal(triggerDec.targetAvailable, 2);
  assert.equal(triggerDec.needsUpdate, false);
  assert.equal(triggerDec.decrementedBy, 'trigger');

  // Tidak pernah turun di bawah 0
  const floored = computeBookStockAfterApprove({
    beforeAvailable: 0,
    afterAvailable: 0,
    totalCopies: 5,
  });
  assert.equal(floored.targetAvailable, 0);
  assert.equal(floored.needsUpdate, false);
  assert.equal(floored.decrementedBy, 'floored_at_zero');
});

test('evaluateLoanOverdue and formatCurrencyIdr calculate overdue days and fines accurately for active and returned loans', () => {
  assert.equal(formatCurrencyIdr(3000), 'Rp 3.000');
  assert.equal(DEFAULT_DAILY_FINE_RP, 1000);

  // Active loan overdue by 4 days
  const activeOverdue = evaluateLoanOverdue(
    '2026-11-10T09:00:00Z',
    null,
    'approved',
    '2026-11-14T15:00:00Z',
    1000
  );
  assert.equal(activeOverdue.isOverdue, true);
  assert.equal(activeOverdue.overdueDays, 4);
  assert.equal(activeOverdue.estimatedFineRp, 4000);
  assert.equal(activeOverdue.daysRemaining, -4);

  // Active loan still within deadline (3 days left)
  const activeOnTime = evaluateLoanOverdue(
    '2026-11-20T09:00:00Z',
    null,
    'approved',
    '2026-11-17T10:00:00Z'
  );
  assert.equal(activeOnTime.isOverdue, false);
  assert.equal(activeOnTime.overdueDays, 0);
  assert.equal(activeOnTime.estimatedFineRp, 0);
  assert.equal(activeOnTime.daysRemaining, 3);

  // Returned 2 days late -> preserves historical overdue metrics
  const lateReturned = evaluateLoanOverdue(
    '2026-11-10T09:00:00Z',
    '2026-11-12T12:00:00Z',
    'returned',
    '2026-11-20T00:00:00Z',
    1500
  );
  assert.equal(lateReturned.isOverdue, true);
  assert.equal(lateReturned.overdueDays, 2);
  assert.equal(lateReturned.estimatedFineRp, 3000);
  assert.equal(lateReturned.daysRemaining, null);

  // Pending loan never counts as overdue
  const pending = evaluateLoanOverdue('2026-11-01T00:00:00Z', null, 'pending', '2026-11-18T00:00:00Z');
  assert.equal(pending.isOverdue, false);
  assert.equal(pending.overdueDays, 0);
});

test('evaluateLoanStatus & evaluateLoanOverdue treat due_at=null loans as active without automatic expiration or fines', () => {
  assert.equal(evaluateLoanStatus(null, null, 'approved', '2026-12-31'), 'approved');
  assert.equal(evaluateLoanStatus(undefined, undefined, 'borrowed', '2026-12-31'), 'borrowed');

  const noDueInfo = evaluateLoanOverdue(null, null, 'approved', '2026-12-31');
  assert.deepEqual(noDueInfo, {
    isOverdue: false,
    overdueDays: 0,
    estimatedFineRp: 0,
    daysRemaining: null,
  });
});

test('evaluateDigitalBookReadAccess & evaluateActiveLoansReadAccess enforce approved/borrowed status and valid unexpired due_at', () => {
  const nowMs = Date.parse('2026-11-26T10:00:00.000Z');
  const futureDue = '2026-12-03T10:00:00.000Z';
  const pastDue = '2026-11-25T10:00:00.000Z';

  // Approved / borrowed with valid future due_at -> allowed
  assert.equal(
    evaluateDigitalBookReadAccess({ status: 'approved', due_at: futureDue, returned_at: null }, nowMs).allowed,
    true
  );
  assert.equal(
    evaluateDigitalBookReadAccess({ status: 'borrowed', due_at: futureDue, returned_at: null }, nowMs).allowed,
    true
  );

  // Empty / null / whitespace due_at -> rejected
  for (const emptyDue of [null, undefined, '', '   ']) {
    const res = evaluateDigitalBookReadAccess(
      { status: 'approved', due_at: emptyDue, returned_at: null },
      nowMs
    );
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'LOAN_DUE_DATE_REQUIRED');
  }

  // Invalid due_at -> rejected
  for (const badDue of ['not-a-date', '2026-99-99', 'invalid']) {
    const res = evaluateDigitalBookReadAccess(
      { status: 'borrowed', due_at: badDue, returned_at: null },
      nowMs
    );
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'LOAN_DUE_DATE_INVALID');
  }

  // Expired due_at -> rejected
  const expiredRes = evaluateDigitalBookReadAccess(
    { status: 'approved', due_at: pastDue, returned_at: null },
    nowMs
  );
  assert.equal(expiredRes.allowed, false);
  assert.equal(expiredRes.code, 'LOAN_EXPIRED');

  // Pending / returned / rejected -> FORBIDDEN
  for (const status of ['pending', 'returned', 'rejected', 'expired'] as const) {
    const res = evaluateDigitalBookReadAccess(
      { status, due_at: futureDue, returned_at: null },
      nowMs
    );
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'FORBIDDEN');
  }

  // evaluateActiveLoansReadAccess picks the valid loan if user has an old invalid loan + a valid loan
  const multiRes = evaluateActiveLoansReadAccess(
    [
      { status: 'approved', due_at: null, returned_at: null },
      { status: 'borrowed', due_at: futureDue, returned_at: null },
    ],
    nowMs
  );
  assert.equal(multiRes.allowed, true);
});

