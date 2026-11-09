import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRegistration,
  evaluateLoanStatus,
  filterAndSortBooks,
  aggregateMonthlyReport,
  formatDateIndo,
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

test('evaluateLoanStatus - handles active, overdue, and returned states', () => {
  // Returned overrides dates
  assert.equal(
    evaluateLoanStatus('2026-11-01', '2026-11-05', '2026-11-10'),
    'returned'
  );

  // Active if today is before or on dueDate
  assert.equal(
    evaluateLoanStatus('2026-11-15', undefined, '2026-11-09'),
    'active'
  );

  // Overdue if today is after dueDate
  assert.equal(
    evaluateLoanStatus('2026-11-05', undefined, '2026-11-09'),
    'overdue'
  );
});

test('filterAndSortBooks - filters by query, category, availability and sorts', () => {
  const mockBooks: Book[] = [
    {
      id: 'b1',
      title: 'Laskar Pelangi',
      author: 'Andrea Hirata',
      publisher: 'Bentang Pustaka',
      year: 2005,
      isbn: '978-979-3062-79-2',
      category: 'Fiksi & Sastra',
      pages: 529,
      description: 'Kisah tentang anak-anak di Belitung.',
      coverUrl: 'https://example.com/cover1.jpg',
      stock: 3,
      shelfLocation: 'Rak A-01',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'b2',
      title: 'Sapiens: Riwayat Singkat Umat Manusia',
      author: 'Yuval Noah Harari',
      publisher: 'KPG',
      year: 2014,
      isbn: '978-602-424-416-3',
      category: 'Sains & Teknologi',
      pages: 512,
      description: 'Sejarah evolusi manusia.',
      coverUrl: 'https://example.com/cover2.jpg',
      stock: 0,
      shelfLocation: 'Rak B-02',
      createdAt: '2026-02-01T00:00:00Z',
    },
    {
      id: 'b3',
      title: 'Bumi Manusia',
      author: 'Pramoedya Ananta Toer',
      publisher: 'Lentera Dipantara',
      year: 1980,
      isbn: '978-979-97312-3-4',
      category: 'Fiksi & Sastra',
      pages: 535,
      description: 'Kisah Minke di awal abad ke-20.',
      coverUrl: 'https://example.com/cover3.jpg',
      stock: 5,
      shelfLocation: 'Rak A-02',
      createdAt: '2026-03-01T00:00:00Z',
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
  assert.ok(availableOnly.every((b) => b.stock > 0));

  // Sort by year desc
  const sortedYear = filterAndSortBooks(mockBooks, { sortBy: 'year-desc' });
  assert.equal(sortedYear[0].id, 'b2'); // 2014
  assert.equal(sortedYear[2].id, 'b3'); // 1980
});

test('aggregateMonthlyReport - calculates statistics correctly', () => {
  const sampleLoans: Loan[] = [
    {
      id: 'l1',
      bookId: 'b1',
      bookTitle: 'Laskar Pelangi',
      bookAuthor: 'Andrea Hirata',
      bookCover: '',
      userId: 'u1',
      userName: 'Ahmad',
      userEmail: 'ahmad@test.com',
      borrowDate: '2026-11-01',
      dueDate: '2026-11-08',
      returnDate: '2026-11-07',
      status: 'returned',
    },
    {
      id: 'l2',
      bookId: 'b1',
      bookTitle: 'Laskar Pelangi',
      bookAuthor: 'Andrea Hirata',
      bookCover: '',
      userId: 'u2',
      userName: 'Siti',
      userEmail: 'siti@test.com',
      borrowDate: '2026-11-03',
      dueDate: '2026-11-10',
      status: 'active',
    },
    {
      id: 'l3',
      bookId: 'b3',
      bookTitle: 'Bumi Manusia',
      bookAuthor: 'Pramoedya',
      bookCover: '',
      userId: 'u1',
      userName: 'Ahmad',
      userEmail: 'ahmad@test.com',
      borrowDate: '2026-11-02',
      dueDate: '2026-11-05',
      status: 'overdue',
    },
  ];

  const report = aggregateMonthlyReport(sampleLoans, '2026-11');
  assert.equal(report.period, '2026-11');
  assert.equal(report.totalLoans, 3);
  assert.equal(report.returnedLoans, 1);
  assert.equal(report.activeLoans, 1);
  assert.equal(report.overdueLoans, 1);
  assert.equal(report.onTimeReturnRate, 100); // 1 returned on time
  assert.equal(report.topBooks[0].bookId, 'b1');
  assert.equal(report.topBooks[0].borrowCount, 2);
});

test('formatDateIndo - formats date to Indonesian readable string', () => {
  const str = formatDateIndo('2026-11-09');
  assert.ok(str.includes('November') && str.includes('2026'));
});
