import React from 'react';
import { Book, Category, Loan, User } from '../../types';
import { formatDateIndo } from '../../utils/libraryRules';
import {
  BookOpen,
  Users,
  Layers,
  BookMarked,
  Plus,
  ArrowRight,
  TrendingUp,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface AdminDashboardViewProps {
  books: Book[];
  categories: Category[];
  users: Array<User & { totalLoans: number; activeLoans: number }>;
  loans: Loan[];
  onNavigateTab: (tab: 'books' | 'categories' | 'users' | 'reports') => void;
  onOpenAddBookModal: () => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  books,
  categories,
  users,
  loans,
  onNavigateTab,
  onOpenAddBookModal,
}) => {
  const totalBooks = books.length;
  const totalUsers = users.length;
  const totalCategories = categories.length;
  const activeLoans = loans.filter((l) => l.status === 'active' || l.status === 'overdue').length;

  const newestBooks = [...books]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const recentLoans = [...loans].slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="relative rounded-3xl bg-gradient-to-r from-slate-900 via-blue-950 to-slate-950 text-white p-6 sm:p-8 border border-slate-800 shadow-xl overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-400/15 text-amber-300 border border-amber-400/30 mb-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Sistem Manajemen Perpustakaan Terpadu</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Dashboard Administrator
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
              Pantau seluruh sirkulasi buku, pengunjung terdaftar, inventaris rak, dan laporan peminjaman secara realtime.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenAddBookModal}
              className="py-2.5 px-4 rounded-xl font-bold text-xs bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-md transition-all flex items-center gap-2 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Buku Baru</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Buku */}
        <div
          onClick={() => onNavigateTab('books')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-blue-900/30 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Seluruh Buku
            </span>
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-900 group-hover:bg-blue-900 group-hover:text-white transition-colors">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-900">{totalBooks}</span>
            <span className="text-xs text-slate-500 ml-2">Judul</span>
          </div>
          <p className="text-xs text-blue-900 font-medium mt-3 flex items-center gap-1">
            <span>Buka Manajemen Buku</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </div>

        {/* Total Pengunjung */}
        <div
          onClick={() => onNavigateTab('users')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-amber-400/50 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Akun Pengunjung
            </span>
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-900">{totalUsers}</span>
            <span className="text-xs text-slate-500 ml-2">Anggota Terdaftar</span>
          </div>
          <p className="text-xs text-amber-700 font-medium mt-3 flex items-center gap-1">
            <span>Lihat Daftar Pengunjung</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </div>

        {/* Total Kategori */}
        <div
          onClick={() => onNavigateTab('categories')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-slate-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Kategori Buku
            </span>
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700 group-hover:bg-purple-900 group-hover:text-white transition-colors">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-900">{totalCategories}</span>
            <span className="text-xs text-slate-500 ml-2">Klasifikasi</span>
          </div>
          <p className="text-xs text-purple-800 font-medium mt-3 flex items-center gap-1">
            <span>Kelola Kategori</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </div>

        {/* Peminjaman Aktif */}
        <div
          onClick={() => onNavigateTab('reports')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-emerald-500/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Peminjaman Aktif
            </span>
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
              <BookMarked className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-900">{activeLoans}</span>
            <span className="text-xs text-slate-500 ml-2">Buku Sedang Dipinjam</span>
          </div>
          <p className="text-xs text-emerald-700 font-medium mt-3 flex items-center gap-1">
            <span>Laporan Sirkulasi</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </p>
        </div>
      </div>

      {/* Main Grid: Newest Books & Recent Circulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Newest Books Table */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-900" />
                <span>Daftar Buku Terbaru</span>
              </h2>
              <p className="text-xs text-slate-500">Buku yang baru ditambahkan ke koleksi perpustakaan</p>
            </div>
            <button
              onClick={() => onNavigateTab('books')}
              className="text-xs font-semibold text-blue-900 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              <span>Kelola Semua ({totalBooks})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider border-y border-slate-100">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Buku</th>
                  <th className="py-2.5 px-3 font-semibold">Kategori</th>
                  <th className="py-2.5 px-3 font-semibold">Lokasi Rak</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Stok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {newestBooks.length > 0 ? (
                  newestBooks.map((book) => (
                    <tr key={book.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={book.coverUrl}
                            alt={book.title}
                            className="w-9 h-12 object-cover rounded shadow-sm bg-slate-900 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate max-w-[200px]" title={book.title}>
                              {book.title}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate max-w-[180px]">
                              {book.author} ({book.year})
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-900 border border-blue-200">
                          {book.category}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-700">
                        <span className="flex items-center gap-1 text-[11px]">
                          <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                          {book.shelfLocation}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full font-bold text-[11px] ${
                            book.stock > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {book.stock} eks
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <BookOpen className="w-8 h-8 text-slate-300" />
                        <p className="font-bold text-xs text-slate-700">Daftar Koleksi Buku Masih Kosong</p>
                        <p className="text-[11px] text-slate-400 max-w-xs">
                          Belum ada buku yang ditambahkan. Silakan gunakan tombol "Tambah Buku Baru" di atas untuk mulai memasukkan koleksi.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Recent Loans Activity */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Peminjaman Terakhir</span>
              </h2>
              <p className="text-xs text-slate-500">Aktivitas sirkulasi buku oleh pengunjung</p>
            </div>
            <button
              onClick={() => onNavigateTab('reports')}
              className="text-xs font-semibold text-blue-900 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              <span>Laporan Lengkap</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentLoans.length > 0 ? (
            <div className="space-y-3">
              {recentLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-150 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{loan.bookTitle}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      Peminjam: <strong className="text-slate-700">{loan.userName}</strong> • {formatDateIndo(loan.borrowDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {loan.status === 'returned' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Kembali
                      </span>
                    ) : loan.status === 'overdue' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        Terlambat
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900">
                        Aktif
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-100">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-600">Belum ada aktivitas peminjaman</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Pengunjung yang mendaftar dan meminjam buku akan tercatat di sini.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
