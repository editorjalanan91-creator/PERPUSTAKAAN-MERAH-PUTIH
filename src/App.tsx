import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { libraryService } from './services/libraryService';
import { Book, Category, Loan, Profile, ActivityLog } from './types';
import { AuthView } from './views/AuthView';
import { ResetPasswordView } from './views/ResetPasswordView';
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
import { AdminLoansView } from './views/admin/AdminLoansView';
import { AdminUsersView } from './views/admin/AdminUsersView';
import { AdminReportsView } from './views/admin/AdminReportsView';
import { shouldRenderResetPasswordView } from './utils/authRecovery';

function LibraryApp() {
  const { user, profile, isLoading, isAdmin, isPasswordRecovery, clearPasswordRecovery, showToast } = useAuth();
  const [isResetPasswordRoute, setIsResetPasswordRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname === '/reset-password';
  });

  useEffect(() => {
    const handlePopState = () => {
      setIsResetPasswordRoute(window.location.pathname === '/reset-password');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Jika Supabase mengarahkan callback recovery ke root (/), sinkronkan path ke /reset-password setelah inisialisasi selesai
  useEffect(() => {
    if (!isLoading && isPasswordRecovery && typeof window !== 'undefined' && window.location.pathname !== '/reset-password') {
      window.history.replaceState({}, '', '/reset-password');
      setIsResetPasswordRoute(true);
    }
  }, [isLoading, isPasswordRecovery]);

  const navigateToResetPassword = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/reset-password') {
      window.history.pushState({}, '', '/reset-password');
    }
    setIsResetPasswordRoute(true);
  };

  const handleBackToLogin = async () => {
    await clearPasswordRecovery();
    if (typeof window !== 'undefined' && window.location.pathname === '/reset-password') {
      window.history.replaceState({}, '', '/');
    }
    setIsResetPasswordRoute(false);
  };

  // App Data State (Backed by Supabase)
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [visitors, setVisitors] = useState<Profile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
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

  // Load all data from Supabase
  const loadData = useCallback(async (showLoadingSpinner = true) => {
    if (!user) return;
    if (showLoadingSpinner) setIsDataLoading(true);

    try {
      const [booksData, catsData, loansData] = await Promise.all([
        libraryService.getBooks(),
        libraryService.getCategories(),
        libraryService.getLoans(user.id, profile?.role === 'admin'),
      ]);

      setBooks(booksData);
      setCategories(catsData);
      setLoans(loansData);

      if (profile?.role === 'admin') {
        const [visitorsData, logsData] = await Promise.all([
          libraryService.getVisitors().catch(() => []),
          libraryService.getActivityLogs().catch(() => []),
        ]);
        setVisitors(visitorsData);
        setActivityLogs(logsData);
      }
    } catch (err: any) {
      console.error('Error loading Supabase library data:', err);
      showToast(err?.message || 'Gagal memuat data dari Supabase.', 'error');
    } finally {
      if (showLoadingSpinner) setIsDataLoading(false);
    }
  }, [user, profile?.role, showToast]);

  // Initial load and Realtime Subscriptions
  useEffect(() => {
    if (!user || isPasswordRecovery) return;

    loadData(true);

    // Subscribe to Realtime Postgres Changes
    const unsubscribe = libraryService.subscribeToChanges(
      () => loadData(false),
      () => loadData(false),
      () => loadData(false)
    );

    return () => {
      unsubscribe();
    };
  }, [user, isPasswordRecovery, loadData]);

  // Handle Book Loan Request (Status: pending)
  const handleBorrowBook = async (bookId: string, durationDays: number, notes?: string) => {
    if (!user) return;
    setIsBorrowingBook(true);
    try {
      await libraryService.requestLoan(user.id, bookId, durationDays, notes);
      showToast(
        'Permintaan peminjaman berhasil dikirim. Menunggu persetujuan admin perpustakaan.',
        'success',
        'Pengajuan Terkirim'
      );
      setSelectedBook(null);
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengajukan peminjaman buku.', 'error', 'Pengajuan Gagal');
    } finally {
      setIsBorrowingBook(false);
    }
  };

  // Handle Book Return (Visitor or Admin)
  const handleReturnBook = async (loanId: string) => {
    setIsReturningBook(true);
    try {
      await libraryService.returnLoan(loanId, user?.id);
      showToast('Buku berhasil dikembalikan. Terima kasih!', 'success', 'Buku Dikembalikan');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memproses pengembalian buku.', 'error', 'Pengembalian Gagal');
    } finally {
      setIsReturningBook(false);
    }
  };

  // --- Admin Loan Management Handlers ---
  const handleApproveLoan = async (loanId: string, durationDays = 7, adminNote?: string) => {
    try {
      await libraryService.approveLoan(loanId, durationDays, adminNote, user?.id);
      showToast('Peminjaman buku telah disetujui. Pengunjung kini dapat membaca buku.', 'success', 'Disetujui');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyetujui peminjaman.', 'error');
    }
  };

  const handleRejectLoan = async (loanId: string, reason?: string) => {
    try {
      await libraryService.rejectLoan(loanId, reason || 'Permintaan ditolak oleh admin', user?.id);
      showToast('Permintaan peminjaman telah ditolak.', 'info', 'Ditolak');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menolak peminjaman.', 'error');
    }
  };

  // --- Admin Books CRUD Handlers ---
  const handleAddBook = async (bookData: Partial<Book>) => {
    try {
      await libraryService.addBook(
        {
          ...bookData,
          title: bookData.title || 'Judul Buku Baru',
        },
        user?.id
      );
      showToast('Buku baru berhasil ditambahkan ke inventaris perpustakaan.', 'success', 'Buku Ditambahkan');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menambahkan buku.', 'error');
      throw err;
    }
  };

  const handleUpdateBook = async (id: string, bookData: Partial<Book>) => {
    try {
      await libraryService.updateBook(id, bookData, user?.id);
      showToast('Data buku berhasil diperbarui di database.', 'success', 'Buku Diperbarui');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memperbarui buku.', 'error');
      throw err;
    }
  };

  const handleDeleteBook = async (id: string) => {
    try {
      await libraryService.deleteBook(id, user?.id);
      showToast('Buku telah dihapus dari sistem perpustakaan.', 'success', 'Buku Dihapus');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus buku.', 'error');
      throw err;
    }
  };

  // --- Admin Categories CRUD Handlers ---
  const handleAddCategory = async (data: { name: string; description?: string }) => {
    try {
      await libraryService.addCategory(data.name, data.description, user?.id);
      showToast('Kategori baru berhasil ditambahkan.', 'success', 'Kategori Ditambahkan');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menambahkan kategori.', 'error');
      throw err;
    }
  };

  const handleUpdateCategory = async (id: string, data: { name: string; description?: string }) => {
    try {
      await libraryService.updateCategory(id, { name: data.name, description: data.description }, user?.id);
      showToast('Kategori berhasil diperbarui.', 'success', 'Kategori Diperbarui');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal memperbarui kategori.', 'error');
      throw err;
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await libraryService.deleteCategory(id, user?.id);
      showToast('Kategori berhasil dihapus.', 'success', 'Kategori Dihapus');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus kategori.', 'error');
      throw err;
    }
  };

  const handleDeleteVisitor = async (id: string) => {
    try {
      await libraryService.deleteVisitor(id, user?.id);
      showToast('Data profil pengunjung berhasil dihapus.', 'success', 'Profil Dihapus');
      await loadData(false);
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus profil pengunjung.', 'error');
      throw err;
    }
  };

  // Loading Screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold tracking-wide">PERPUSTAKAAN MERAH PUTIH</h2>
        <p className="text-xs text-slate-400 mt-1">Menghubungkan ke Supabase Auth...</p>
      </div>
    );
  }

  // PASSWORD RECOVERY & /reset-password ROUTE
  if (shouldRenderResetPasswordView({ isPasswordRecovery, isResetPasswordRoute })) {
    return (
      <>
        <ResetPasswordView onBackToLogin={handleBackToLogin} />
        <ToastContainer />
      </>
    );
  }

  // STRICT ACCESS CONTROL: Unauthenticated users MUST see the Login/Register gateway
  if (!user) {
    return (
      <>
        <AuthView onOpenForgotPassword={navigateToResetPassword} />
        <ToastContainer />
      </>
    );
  }

  const pendingLoansCount = loans.filter((l) => l.status === 'pending').length;

  // --- ADMIN ROLE ---
  if (isAdmin && !isAdminPreviewingVisitor) {
    return (
      <>
        <AdminLayout
          currentTab={adminTab}
          onSelectTab={setAdminTab}
          onPreviewVisitorCatalog={() => setIsAdminPreviewingVisitor(true)}
          onOpenAddBookModal={() => setIsAddBookModalOpen(true)}
          pendingLoansCount={pendingLoansCount}
        >
          {adminTab === 'dashboard' && (
            <AdminDashboardView
              books={books}
              categories={categories}
              visitors={visitors}
              loans={loans}
              activityLogs={activityLogs}
              onNavigateTab={setAdminTab}
              onOpenAddBookModal={() => setIsAddBookModalOpen(true)}
              onApproveLoan={handleApproveLoan}
              onRejectLoan={handleRejectLoan}
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

          {adminTab === 'loans' && (
            <AdminLoansView
              loans={loans}
              onApproveLoan={handleApproveLoan}
              onRejectLoan={handleRejectLoan}
              onReturnLoan={handleReturnBook}
            />
          )}

          {adminTab === 'users' && (
            <AdminUsersView
              users={visitors.map((v) => ({
                ...v,
                totalLoans: loans.filter((l) => l.user_id === v.id).length,
                activeLoans: loans.filter(
                  (l) => l.user_id === v.id && (l.status === 'pending' || l.status === 'approved' || l.status === 'borrowed')
                ).length,
              }))}
              onDeleteUser={handleDeleteVisitor}
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
  const activeLoansCount = loans.filter(
    (l) => l.status === 'pending' || l.status === 'approved' || l.status === 'borrowed'
  ).length;

  // Find active loan for the currently selected book (if any)
  const currentBookUserLoan = selectedBook
    ? loans.find(
        (l) =>
          l.book_id === selectedBook.id &&
          (l.status === 'pending' || l.status === 'approved' || l.status === 'borrowed')
      )
    : undefined;

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
        userLoan={currentBookUserLoan}
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
