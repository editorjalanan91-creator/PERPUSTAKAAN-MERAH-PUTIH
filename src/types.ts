export type UserRole = 'admin' | 'visitor' | 'user';

export interface Profile {
  id: string;
  full_name: string;
  username: string;
  role: UserRole;
  created_at?: string;
  updated_at?: string;
}

// User interface backwards-compatible with context & views
export interface User extends Profile {
  email: string;
  fullName?: string;
  createdAt?: string;
  avatarUrl?: string;
}

export interface Category {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  is_active?: boolean;
  created_by?: string | null;
  created_at?: string;
  bookCount?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher: string;
  publication_year: number;
  isbn: string;
  category_id: string;
  description?: string | null;
  cover_path?: string | null;
  file_path?: string | null;
  file_type?: string | null; // 'pdf' | 'epub'
  total_copies: number;
  available_copies: number;
  is_published: boolean;
  is_archived: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  // Computed / joined fields
  category?: any;
  category_name?: string;
  // Backward compatibility aliases
  stock?: number;
  coverUrl?: string;
  year?: number;
  pages?: number;
  shelfLocation?: string;
  createdAt?: string;
}

/**
 * PENTING: Status peminjaman wajib sesuai enum database:
 * - pending
 * - approved
 * - rejected
 * - borrowed
 * - returned
 * - expired
 */
export type LoanStatus = 'pending' | 'approved' | 'rejected' | 'borrowed' | 'returned' | 'expired';

export interface Loan {
  id: string;
  user_id: string;
  book_id: string;
  status: LoanStatus;
  requested_at: string;
  approved_at?: string | null;
  due_at?: string | null;
  returned_at?: string | null;
  admin_note?: string | null;
  created_at?: string;
  updated_at?: string;
  // Relasi join untuk kemudahan tampilan di antarmuka
  book?: Book;
  profile?: Profile;
  // Backward compatibility aliases
  userId?: string;
  bookId?: string;
  userName?: string;
  userEmail?: string;
  bookTitle?: string;
  bookAuthor?: string;
  bookCover?: string;
  borrowDate?: string;
  dueDate?: string;
  returnDate?: string;
}

export interface ActivityLog {
  id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: any;
  created_at: string;
  actor_name?: string;
}

export interface MonthlyReportSummary {
  period: string; // "YYYY-MM"
  periodLabel: string;
  totalLoans: number;
  activeLoans: number;
  returnedLoans: number;
  pendingLoans: number;
  topBooks: Array<{
    bookId: string;
    title: string;
    author: string;
    coverUrl: string;
    borrowCount: number;
  }>;
  categoryDistribution: Array<{
    category: string;
    count: number;
  }>;
}
