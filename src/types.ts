export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt: string;
  avatarUrl?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher: string;
  year: number;
  isbn: string;
  category: string;
  pages: number;
  description: string;
  coverUrl: string;
  stock: number;
  shelfLocation: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  bookCount?: number;
}

export type LoanStatus = 'active' | 'returned' | 'overdue';

export interface Loan {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookCover: string;
  userId: string;
  userName: string;
  userEmail: string;
  borrowDate: string; // YYYY-MM-DD
  dueDate: string;    // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  status: LoanStatus;
  notes?: string;
}

export interface MonthlyReportSummary {
  period: string; // e.g. "2026-11"
  periodLabel: string; // e.g. "November 2026"
  totalLoans: number;
  activeLoans: number;
  returnedLoans: number;
  overdueLoans: number;
  onTimeReturnRate: number; // percentage
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
  dailyTrend: Array<{
    day: string;
    count: number;
  }>;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
  details?: string;
}
