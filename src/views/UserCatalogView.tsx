import React, { useState, useMemo } from 'react';
import { Book, Category } from '../types';
import { BookCard } from '../components/BookCard';
import { filterAndSortBooks } from '../utils/libraryRules';
import {
  Search,
  Filter,
  SlidersHorizontal,
  Grid,
  List,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Calendar,
} from 'lucide-react';

interface UserCatalogViewProps {
  books: Book[];
  categories: Category[];
  initialCategory?: string;
  initialQuery?: string;
  onSelectBook: (book: Book) => void;
  onQuickBorrow: (book: Book) => void;
}

export const UserCatalogView: React.FC<UserCatalogViewProps> = ({
  books,
  categories,
  initialCategory,
  initialQuery = '',
  onSelectBook,
  onQuickBorrow,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || 'Semua');
  const [availability, setAvailability] = useState<'all' | 'available' | 'unavailable'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'year-desc' | 'year-asc'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  React.useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
  }, [initialCategory]);

  React.useEffect(() => {
    if (initialQuery !== undefined) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery]);

  const filteredBooks = useMemo(() => {
    return filterAndSortBooks(books, {
      query: searchQuery,
      category: selectedCategory === 'Semua' ? undefined : selectedCategory,
      availability,
      sortBy,
    });
  }, [books, searchQuery, selectedCategory, availability, sortBy]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('Semua');
    setAvailability('all');
    setSortBy('newest');
  };

  const isFiltered = searchQuery !== '' || selectedCategory !== 'Semua' || availability !== 'all' || sortBy !== 'newest';

  return (
    <div className="space-y-8 pb-16">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-serif-title">
            Katalog Seluruh Buku Perpustakaan
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Menampilkan {filteredBooks.length} dari total {books.length} koleksi literatur perpustakaan
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white text-blue-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Tampilan Grid"
              aria-label="Tampilan Grid"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-blue-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Tampilan List"
              aria-label="Tampilan List"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors border border-rose-200 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter Bar Controls */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
        {/* Top: Search bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari berdasarkan judul buku, nama penulis, penerbit, atau ISBN..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/30 focus:border-blue-900 focus:bg-white transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-slate-600"
            >
              Hapus
            </button>
          )}
        </div>

        {/* Filter Row: Categories, Availability, Sorting */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {/* Category Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Kategori:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900/20 cursor-pointer"
            >
              <option value="Semua">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Availability Pills */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Status:</span>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setAvailability('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  availability === 'all' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
                }`}
              >
                Semua
              </button>
              <button
                type="button"
                onClick={() => setAvailability('available')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  availability === 'available' ? 'bg-emerald-600 text-white shadow-sm font-semibold' : 'text-slate-600'
                }`}
              >
                Tersedia
              </button>
              <button
                type="button"
                onClick={() => setAvailability('unavailable')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  availability === 'unavailable' ? 'bg-rose-600 text-white shadow-sm font-semibold' : 'text-slate-600'
                }`}
              >
                Kosong
              </button>
            </div>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-semibold text-slate-500 shrink-0">Urutkan:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900/20 cursor-pointer"
            >
              <option value="newest">Paling Baru Ditambahkan</option>
              <option value="oldest">Paling Lama</option>
              <option value="title-asc">Judul (A - Z)</option>
              <option value="title-desc">Judul (Z - A)</option>
              <option value="year-desc">Tahun Terbit (Terbaru)</option>
              <option value="year-asc">Tahun Terbit (Terlama)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Catalog Results */}
      {filteredBooks.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onSelect={onSelectBook}
                onQuickBorrow={onQuickBorrow}
              />
            ))}
          </div>
        ) : (
          /* List View Mode */
          <div className="space-y-4">
            {filteredBooks.map((book) => {
              const isAvailable = book.stock > 0;
              return (
                <div
                  key={book.id}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row gap-5 items-start sm:items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="w-16 h-22 object-cover rounded-xl shadow-md shrink-0 bg-slate-900"
                    />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-900 border border-blue-200">
                          {book.category}
                        </span>
                        <span className="text-xs text-slate-400">Tahun {book.year}</span>
                      </div>
                      <h3
                        onClick={() => onSelectBook(book)}
                        className="font-bold text-slate-900 text-base hover:text-blue-900 cursor-pointer transition-colors"
                      >
                        {book.title}
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Penulis: <span className="font-semibold text-slate-800">{book.author}</span> • Penerbit: {book.publisher}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1 font-medium text-amber-700">
                          <MapPin className="w-3.5 h-3.5 text-amber-600" />
                          {book.shelfLocation}
                        </span>
                        <span>{book.pages} Hal.</span>
                        <span className="font-mono text-[11px]">ISBN: {book.isbn}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div>
                      {isAvailable ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Tersedia ({book.stock} eks)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                          <AlertCircle className="w-3 h-3" />
                          Sedang Dipinjam
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelectBook(book)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer"
                      >
                        Lihat Detail
                      </button>
                      <button
                        disabled={!isAvailable}
                        onClick={() => onQuickBorrow(book)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                          isAvailable
                            ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        Pinjam Buku
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Empty State */
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-lg text-slate-900 mb-1">
            Tidak Ditemukan Koleksi Buku
          </h3>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Tidak ada buku yang sesuai dengan kata kunci atau filter pencarian Anda. Coba periksa ejaan atau ubah pilihan kategori.
          </p>
          <button
            onClick={resetFilters}
            className="px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Bersihkan Filter &amp; Tampilkan Semua
          </button>
        </div>
      )}
    </div>
  );
};
