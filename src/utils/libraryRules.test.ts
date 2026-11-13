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
