import React from 'react';
import { Book, Category } from '../types';
import { BookCard } from '../components/BookCard';
import {
  BookOpen,
  Sparkles,
  Search,
  Layers,
  CheckCircle2,
  ArrowRight,
  Bookmark,
  ShieldCheck,
  Clock,
  Compass,
} from 'lucide-react';

interface UserHomeViewProps {
  books: Book[];
  categories: Category[];
  onSelectBook: (book: Book) => void;
  onNavigateToCatalog: (category?: string, query?: string) => void;
  onQuickBorrow: (book: Book) => void;
}

export const UserHomeView: React.FC<UserHomeViewProps> = ({
  books,
  categories,
  onSelectBook,
  onNavigateToCatalog,
  onQuickBorrow,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigateToCatalog(undefined, searchQuery);
  };

  // Derive stats
  const totalBooks = books.length;
  const availableCopies = books.reduce((acc, b) => acc + b.stock, 0);
  const totalCategories = categories.length;

  // Newest books (sort by createdAt or id desc)
  const newestBooks = [...books]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  // Recommendations (e.g. books with high stock or curated list)
  const recommendedBooks = [...books]
    .sort((a, b) => b.pages - a.pages)
    .slice(0, 4);

  return (
    <div className="space-y-12 pb-16">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white p-8 sm:p-12 lg:p-16 border border-slate-800 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-900/50 border border-amber-400/30 text-amber-300 text-xs font-semibold backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Katalog Perpustakaan Digital 2026</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight font-serif-title">
            Temukan Pengetahuan, Inspirasi, dan Karya Klasik Nusantara.
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
            Akses ribuan judul buku fisik dan digital dengan kemudahan peminjaman real-time. Cari literatur berdasarkan judul, penulis, maupun kategori favorit Anda.
          </p>

          {/* Quick Search Bar */}
          <form onSubmit={handleHeroSearch} className="flex flex-col sm:flex-row gap-2 pt-2 max-w-xl">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul buku, nama penulis, atau ISBN..."
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white/15 transition-all"
              />
            </div>
            <button
              type="submit"
              className="py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              <span>Cari Buku</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Counter Badges */}
          <div className="grid grid-cols-3 gap-3 pt-6 border-t border-slate-800/80 max-w-lg">
            <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <p className="text-xl sm:text-2xl font-black text-amber-400">{totalBooks}</p>
              <p className="text-[11px] text-slate-400 font-medium">Judul Buku</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <p className="text-xl sm:text-2xl font-black text-white">{availableCopies}</p>
              <p className="text-[11px] text-slate-400 font-medium">Eksemplar Siap</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <p className="text-xl sm:text-2xl font-black text-blue-400">{totalCategories}</p>
              <p className="text-[11px] text-slate-400 font-medium">Kategori</p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Bar */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-900" />
              <span>Jelajahi Kategori Buku</span>
            </h2>
            <p className="text-xs text-slate-500">Pilih kategori untuk melihat koleksi terkait</p>
          </div>
          <button
            onClick={() => onNavigateToCatalog()}
            className="text-xs font-bold text-blue-900 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat Semua</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onNavigateToCatalog(cat.name)}
              className="p-4 rounded-2xl bg-white border border-slate-200/90 hover:border-amber-400 hover:shadow-md transition-all text-left group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-xl bg-blue-50 group-hover:bg-amber-400/20 text-blue-900 group-hover:text-amber-700 flex items-center justify-center transition-colors mb-2.5">
                <BookOpen className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-slate-800 group-hover:text-blue-950 truncate">
                {cat.name}
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {cat.bookCount || 0} koleksi buku
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Newest Books Collection */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-900" />
              <span>Koleksi Buku Terbaru</span>
            </h2>
            <p className="text-xs text-slate-500">Buku-buku mutakhir yang baru saja ditambahkan</p>
          </div>
          <button
            onClick={() => onNavigateToCatalog()}
            className="text-xs font-bold text-blue-900 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
          >
            <span>Buka Katalog Lengkap</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {newestBooks.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {newestBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onSelect={onSelectBook}
                onQuickBorrow={onQuickBorrow}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center text-slate-500 text-xs">
            <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">Belum ada buku terbaru</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Administrator sedang mempersiapkan koleksi buku baru.</p>
          </div>
        )}
      </section>

      {/* Recommended Books Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              <span>Rekomendasi Pilihan Kurator</span>
            </h2>
            <p className="text-xs text-slate-500">Buku berbobot yang paling diminati pembaca</p>
          </div>
        </div>

        {recommendedBooks.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {recommendedBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onSelect={onSelectBook}
                onQuickBorrow={onQuickBorrow}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-white border border-slate-200 text-center text-slate-500 text-xs">
            <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">Belum ada rekomendasi buku</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Rekomendasi kurator akan muncul setelah buku ditambahkan.</p>
          </div>
        )}
      </section>

      {/* Information & Library Rules Banner */}
      <section className="p-8 rounded-3xl bg-slate-900 text-white border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-blue-950 text-amber-400 shrink-0 border border-amber-400/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-100">Peminjaman Aman &amp; Tercatat</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Setiap peminjaman buku tercatat rapi di sistem perpustakaan dengan bukti peminjaman digital resmi.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-blue-950 text-amber-400 shrink-0 border border-amber-400/20">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-100">Batas Waktu Fleksibel</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Durasi peminjaman dapat dipilih antara 3 hingga 14 hari dengan notifikasi pengembalian sebelum jatuh tempo.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-blue-950 text-amber-400 shrink-0 border border-amber-400/20">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-100">Lokasi Rak Akurat</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Memudahkan Anda menemukan posisi fisik buku secara langsung di ruang perpustakaan berdasarkan kode rak.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
