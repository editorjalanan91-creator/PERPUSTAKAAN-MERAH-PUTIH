import { Book, Category, Loan, MonthlyReportSummary, User } from '../types';

const TOKEN_KEY = 'perpustakaan_auth_token';

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  remove: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data.error || `Terjadi kesalahan (Status ${res.status})`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  // Auth
  async login(username: string, password: string): Promise<{ token: string; user: User }> {
    const data = await request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    tokenStorage.set(data.token);
    return data;
  },

  async register(payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ token: string; user: User }> {
    const data = await request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    tokenStorage.set(data.token);
    return data;
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/me');
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network error on logout
    } finally {
      tokenStorage.remove();
    }
  },

  async updateProfile(payload: { fullName: string; email: string }): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async changePassword(payload: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/api/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // Books
  async getBooks(): Promise<{ books: Book[] }> {
    return request<{ books: Book[] }>('/api/books');
  },

  async addBook(bookData: Partial<Book>): Promise<{ book: Book; message: string }> {
    return request<{ book: Book; message: string }>('/api/books', {
      method: 'POST',
      body: JSON.stringify(bookData),
    });
  },

  async updateBook(id: string, bookData: Partial<Book>): Promise<{ book: Book; message: string }> {
    return request<{ book: Book; message: string }>(`/api/books/${id}`, {
      method: 'PUT',
      body: JSON.stringify(bookData),
    });
  },

  async deleteBook(id: string): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>(`/api/books/${id}`, {
      method: 'DELETE',
    });
  },

  // Categories
  async getCategories(): Promise<{ categories: Category[] }> {
    return request<{ categories: Category[] }>('/api/categories');
  },

  async addCategory(payload: { name: string; description?: string }): Promise<{ category: Category; message: string }> {
    return request<{ category: Category; message: string }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateCategory(
    id: string,
    payload: { name: string; description?: string }
  ): Promise<{ category: Category; message: string }> {
    return request<{ category: Category; message: string }>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteCategory(id: string): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>(`/api/categories/${id}`, {
      method: 'DELETE',
    });
  },

  // Users (Admin only)
  async getUsers(): Promise<{ users: Array<User & { totalLoans: number; activeLoans: number }> }> {
    return request<{ users: Array<User & { totalLoans: number; activeLoans: number }> }>('/api/users');
  },

  async deleteUser(id: string): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    });
  },

  // Loans
  async getLoans(): Promise<{ loans: Loan[] }> {
    return request<{ loans: Loan[] }>('/api/loans');
  },

  async borrowBook(bookId: string, durationDays: number, notes?: string): Promise<{ loan: Loan; message: string }> {
    return request<{ loan: Loan; message: string }>('/api/loans', {
      method: 'POST',
      body: JSON.stringify({ bookId, durationDays, notes }),
    });
  },

  async returnBook(loanId: string): Promise<{ loan: Loan; message: string }> {
    return request<{ loan: Loan; message: string }>(`/api/loans/${loanId}/return`, {
      method: 'POST',
    });
  },

  // Reports (Admin only)
  async getMonthlyReport(period: string): Promise<{ report: MonthlyReportSummary }> {
    return request<{ report: MonthlyReportSummary }>(`/api/reports/monthly?period=${encodeURIComponent(period)}`);
  },
};
