import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './services/api';
import { Book, Category, Loan, User } from './types';
import { AuthView } from './views/AuthView';
import { ToastContainer } from './components/ToastContainer';
import { UserNavbar } from './components/UserNavbar';
import { UserHomeView } from './views/UserHomeView';
import { UserCatalogView } from './views/UserCatalogView';
import { UserLoansView } from './views/UserLoansView';
import { UserProfileView } from './views/UserProfileView';
import { BookDetailModal } from './components/BookDetailModal';
import { AdminLayout, AdminTab } from './views/admin/AdminLayout';
import { AdminDashboardView } from './views/admin/AdminDashboardView';
import { AdminBooksView } from './views/admin/AdminBooksView';
import { AdminCategoriesView } from './views/admin/AdminCategoriesView';
import { AdminUsersView } from './views/admin/AdminUsersView';
import { AdminReportsView } from './views/admin/AdminReportsView';

function LibraryApp() {
  const { user, isLoading, isAdmin, isUser, showToast } = useAuth();

  // App Data State
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<Array<User & { totalLoans: number; activeLoans: number }>>([]);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(true);

  // Visitor Navigation State
  const [visitorTab, setVisitorTab] = useState<'home' | 'catalog' | 'loans' | 'profile'>('home');
  const [catalogInitialCategory, setCatalogInitialCategory] = useState<string | undefined>(undefined);
  const [catalogInitialQuery, setCatalogInitialQuery] = useState<string>('');

  // Admin Navigation State
  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [isAdminPreviewingVisitor, setIsAdminPreviewingVisitor] = useState<boolean>(false);
  const [isAddBookModalOpen, setIsAddBookModalOpen] = useState<boolean>(false);

  // Selected Book for Detail Modal
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [isBorrowingBook, setIsBorrowingBook] = useState<boolean>(false);
  const [isReturningBook, setIsReturningBook] = useState<boolean>(false);

  // Load all data when user is authenticated
  const loadData = async () => {
    if (!user) return;
    setIsDataLoading(true);
    try {
      const [booksRes, catsRes, loansRes] = await Promise.all([
        api.getBooks(),
        api.getCategories(),
        api.getLoans(),
      ]);
      setBooks(booksRes.books || []);
      setCategories(catsRes.categories || []);
      setLoans(loansRes.loans || []);

      if (user.role === 'admin') {
        const usersRes = await api.getUsers().catch(() => ({ users: [] }));
        setRegisteredUsers(usersRes.users || []);
      }
    } catch (err: any) {
      console.error('Error loading library data:', err);
      showToast(err.message || 'Gagal memuat data perpustakaan.', 'error');
    } finally {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  // Handle Book Borrowing
  const handleBorrowBook = async (bookId: string, durationDays: number, notes?: string) => {
    setIsBorrowingBook(true);
    try {
      const res = await api.borrowBook(bookId, durationDays, notes);
      showToast(res.message, 'success', 'Peminjaman Berhasil');

      // Update state
      setLoans((prev) => [res.loan, ...prev]);
      setBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, stock: Math.max(0, b.stock - 1) } : b))
      );
      setSelectedBook(null);
    } catch (err: any) {
      showToast(err.message || 'Gagal memproses peminjaman buku.', 'error', 'Peminjaman Gagal');
    } finally {
      setIsBorrowingBook(false);
    }
  };

  // Handle Book Returning
  const handleReturnBook = async (loanId: string) => {
    setIsReturningBook(true);
    try {
      const res = await api.returnBook(loanId);
      showToast(res.message, 'success', 'Buku Dikembalikan');

      // Update loans state
      setLoans((prev) =>
        prev.map((l) => (l.id === loanId ? { ...l, status: 'returned', returnDate: new Date().toISOString().split('T')[0] } : l))
      );

      // Increment book stock
      if (res.loan) {
        setBooks((prev) =>
          prev.map((b) => (b.id === res.loan.bookId ? { ...b, stock: b.stock + 1 } : b))
        );
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal memproses pengembalian buku.', 'error', 'Pengembalian Gagal');
    } finally {
      setIsReturningBook(false);
    }
  };

  // --- Admin Handlers ---
  const handleAddBook = async (bookData: Partial<Book>) => {
    try {
      const res = await api.addBook(bookData);
      showToast(res.message, 'success', 'Buku Ditambahkan');
      setBooks((prev) => [res.book, ...prev]);
      // Update category count
      setCategories((prev) =>
        prev.map((c) =>
          c.name === res.book.category ? { ...c, bookCount: (c.bookCount || 0) + 1 } : c
        )
      );
    } catch (err: any) {
      showToast(err.message || 'Gagal menambahkan buku.', 'error');
      throw err;
    }
  };

  const handleUpdateBook = async (id: string, bookData: Partial<Book>) => {
    try {
      const res = await api.updateBook(id, bookData);
      showToast(res.message, 'success', 'Buku Diperbarui');
      setBooks((prev) => prev.map((b) => (b.id === id ? res.book : b)));
    } catch (err: any) {
      showToast(err.message || 'Gagal memperbarui buku.', 'error');
      throw err;
    }
  };

  const handleDeleteBook = async (id: string) => {
    try {
      const res = await api.deleteBook(id);
      showToast(res.message, 'success', 'Buku Dihapus');
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus buku.', 'error');
      throw err;
    }
  };

  const handleAddCategory = async (data: { name: string; description?: string }) => {
    try {
      const res = await api.addCategory(data);
      showToast(res.message, 'success', 'Kategori Ditambahkan');
      setCategories((prev) => [...prev, { ...res.category, bookCount: 0 }]);
    } catch (err: any) {
      showToast(err.message || 'Gagal menambahkan kategori.', 'error');
      throw err;
    }
  };

  const handleUpdateCategory = async (id: string, data: { name: string; description?: string }) => {
    try {
      const res = await api.updateCategory(id, data);
      showToast(res.message, 'success', 'Kategori Diperbarui');
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...res.category } : c)));
      const booksRes = await api.getBooks();
      setBooks(booksRes.books || []);
    } catch (err: any) {
      showToast(err.message || 'Gagal memperbarui kategori.', 'error');
      throw err;
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      const res = await api.deleteCategory(id);
      showToast(res.message, 'success', 'Kategori Dihapus');
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus kategori.', 'error');
      throw err;
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await api.deleteUser(id);
      showToast(res.message, 'success', 'Akun Pengunjung Dihapus');
      setRegisteredUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Gagal menghapus akun pengunjung.', 'error');
      throw err;
    }
  };

  // Loading Screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold tracking-wide">PERPUSTAKAAN MERAH PUTIH</h2>
        <p className="text-xs text-slate-400 mt-1">Memverifikasi otorisasi sesi...</p>
      </div>
    );
  }

  // STRICT ACCESS CONTROL: Unauthenticated users MUST see the Login/Register gateway
  if (!user) {
    return (
      <>
        <AuthView />
        <ToastContainer />
      </>
    );
  }

  // --- ADMIN ROLE ---
  if (isAdmin && !isAdminPreviewingVisitor) {
    return (
      <>
        <AdminLayout
          currentTab={adminTab}
          onSelectTab={setAdminTab}
          onPreviewVisitorCatalog={() => setIsAdminPreviewingVisitor(true)}
          onOpenAddBookModal={() => setIsAddBookModalOpen(true)}
        >
          {adminTab === 'dashboard' && (
            <AdminDashboardView
              books={books}
              categories={categories}
              users={registeredUsers}
              loans={loans}
              onNavigateTab={setAdminTab}
              onOpenAddBookModal={() => setIsAddBookModalOpen(true)}
            />
          )}

          {adminTab === 'books' && (
            <AdminBooksView
              books={books}
              categories={categories}
              onAddBook={handleAddBook}
              onUpdateBook={handleUpdateBook}
              onDeleteBook={handleDeleteBook}
              isAddModalOpen={isAddBookModalOpen}
              setIsAddModalOpen={setIsAddBookModalOpen}
            />
          )}

          {adminTab === 'categories' && (
            <AdminCategoriesView
              categories={categories}
              onAddCategory={handleAddCategory}
              onUpdateCategory={handleUpdateCategory}
              onDeleteCategory={handleDeleteCategory}
            />
          )}

          {adminTab === 'users' && (
            <AdminUsersView
              users={registeredUsers}
              onDeleteUser={handleDeleteUser}
            />
          )}

          {adminTab === 'reports' && (
            <AdminReportsView loans={loans} />
          )}
        </AdminLayout>

        <ToastContainer />
      </>
    );
  }

  // --- VISITOR (USER) ROLE (or Admin in Preview Mode) ---
  const activeLoansCount = loans.filter((l) => l.status === 'active' || l.status === 'overdue').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* If Admin is previewing visitor mode, show helper bar */}
      {isAdmin && isAdminPreviewingVisitor && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-between sticky top-0 z-50">
          <span>👀 Anda sedang melihat tampilan sebagai Pengunjung Perpustakaan (Katalog Live).</span>
          <button
            onClick={() => setIsAdminPreviewingVisitor(false)}
            className="px-3 py-1 rounded-lg bg-slate-950 text-amber-300 text-xs hover:bg-slate-900 transition-colors cursor-pointer"
          >
            Kembali ke Dashboard Admin
          </button>
        </div>
      )}

      {/* Visitor Navbar */}
      <UserNavbar
        activeTab={visitorTab}
        setActiveTab={setVisitorTab}
        activeLoanCount={activeLoansCount}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {visitorTab === 'home' && (
          <UserHomeView
            books={books}
            categories={categories}
            onSelectBook={(book) => setSelectedBook(book)}
            onQuickBorrow={(book) => setSelectedBook(book)}
            onNavigateToCatalog={(cat, q) => {
              setCatalogInitialCategory(cat);
              setCatalogInitialQuery(q || '');
              setVisitorTab('catalog');
            }}
          />
        )}

        {visitorTab === 'catalog' && (
          <UserCatalogView
            books={books}
            categories={categories}
            initialCategory={catalogInitialCategory}
            initialQuery={catalogInitialQuery}
            onSelectBook={(book) => setSelectedBook(book)}
            onQuickBorrow={(book) => setSelectedBook(book)}
          />
        )}

        {visitorTab === 'loans' && (
          <UserLoansView
            loans={loans}
            onReturnBook={handleReturnBook}
            onNavigateToCatalog={() => setVisitorTab('catalog')}
            isReturning={isReturningBook}
          />
        )}

        {visitorTab === 'profile' && <UserProfileView />}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white border-t border-slate-800 py-10 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-brand font-bold text-sm text-white">PERPUSTAKAAN MERAH PUTIH</span>
            <span>•</span>
            <span>Sistem Informasi Koleksi &amp; Peminjaman Buku Digital</span>
          </div>
          <p>© 2026 Perpustakaan Merah Putih. Dilindungi Hak Cipta.</p>
        </div>
      </footer>

      {/* Book Detail & Borrow Modal */}
      <BookDetailModal
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
        onBorrow={handleBorrowBook}
        isBorrowing={isBorrowingBook}
      />

      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LibraryApp />
    </AuthProvider>
  );
}
