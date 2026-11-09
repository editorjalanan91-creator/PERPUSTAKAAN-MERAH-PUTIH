import React, { useState } from 'react';
import { Book } from '../types';
import {
  X,
  BookOpen,
  Calendar,
  Building2,
  Bookmark,
  FileText,
  Layers,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  Hash,
} from 'lucide-react';

interface BookDetailModalProps {
  book: Book | null;
  onClose: () => void;
  onBorrow: (bookId: string, durationDays: number, notes?: string) => Promise<void>;
  isBorrowing?: boolean;
}

export const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  onClose,
  onBorrow,
  isBorrowing = false,
}) => {
  if (!book) return null;

  const [duration, setDuration] = useState<number>(7);
  const [notes, setNotes] = useState<string>('');
  const [imageError, setImageError] = useState<boolean>(false);

  const isAvailable = book.stock > 0;

  // Calculate return date preview
  const estimatedReturnDate = new Date();
  estimatedReturnDate.setDate(estimatedReturnDate.getDate() + duration);
  const formattedReturnDate = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(estimatedReturnDate);

  const handleSubmitBorrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAvailable || isBorrowing) return;
    await onBorrow(book.id, duration, notes);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <h2 className="font-bold text-base sm:text-lg">Detail Informasi Buku</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Tutup modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-6 sm:p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8">
            {/* Left: Cover & Quick specs */}
            <div className="md:col-span-5 flex flex-col items-center">
              <div className="relative w-full max-w-[240px] aspect-[3/4] rounded-2xl overflow-hidden shadow-xl border border-slate-200 bg-slate-900">
                {!imageError && book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.title}
                    onError={() => setImageError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-white bg-slate-900">
                    <BookOpen className="w-16 h-16 text-amber-400 mb-3" />
                    <p className="text-sm font-semibold">{book.title}</p>
                  </div>
                )}
                {/* Stock Tag on Image */}
                <div className="absolute top-3 right-3">
                  {isAvailable ? (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white shadow-lg flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Tersedia ({book.stock})
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-lg flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Stok Habis
                    </span>
                  )}
                </div>
              </div>

              {/* Shelf & Location Callout */}
              <div className="mt-5 w-full p-4 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-center">
                <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider mb-1 flex items-center justify-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-amber-600" />
                  Lokasi Rak Buku
                </p>
                <p className="text-base font-extrabold text-slate-900">
                  {book.shelfLocation}
                </p>
                <p className="text-xs text-amber-700/80 mt-0.5">
                  Tersedia {book.stock} eksemplar fisik di perpustakaan
                </p>
              </div>
            </div>

            {/* Right: Detailed Metadata & Synopsis */}
            <div className="md:col-span-7 flex flex-col justify-between">
              <div>
                <div className="inline-block px-3 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-900 border border-blue-200 mb-3">
                  {book.category}
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                  {book.title}
                </h1>
                <p className="text-sm font-semibold text-slate-600 mt-2">
                  Oleh <span className="text-slate-900 underline decoration-amber-400 decoration-2">{book.author}</span>
                </p>

                {/* Specs Grid */}
                <div className="grid grid-cols-2 gap-3 mt-6 p-4 rounded-2xl bg-slate-50 border border-slate-150">
                  <div className="flex items-start gap-2.5">
                    <Building2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-slate-500 font-medium">Penerbit</p>
                      <p className="text-xs font-semibold text-slate-800">{book.publisher}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-slate-500 font-medium">Tahun Terbit</p>
                      <p className="text-xs font-semibold text-slate-800">{book.year}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Hash className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-slate-500 font-medium">ISBN</p>
                      <p className="text-xs font-semibold text-slate-800 font-mono">{book.isbn}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Layers className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-slate-500 font-medium">Jumlah Halaman</p>
                      <p className="text-xs font-semibold text-slate-800">{book.pages} halaman</p>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="mt-6">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Sinopsis / Deskripsi Buku
                  </h4>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    {book.description}
                  </p>
                </div>
              </div>

              {/* Borrow Form Box */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                {isAvailable ? (
                  <form onSubmit={handleSubmitBorrow} className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-amber-600" />
                        Pilih Durasi Peminjaman:
                      </span>
                      <span className="text-xs text-slate-500">
                        Batas kembali: <strong className="text-slate-800">{formattedReturnDate}</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {[3, 7, 10, 14].map((days) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setDuration(days)}
                          className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            duration === days
                              ? 'bg-blue-900 text-white shadow-sm ring-2 ring-blue-900/30'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          {days} Hari
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Catatan peminjaman (opsional, contoh: untuk keperluan tugas kuliah)"
                      className="w-full px-3.5 py-2 text-xs rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30 text-slate-800 placeholder-slate-400"
                    />

                    <button
                      type="submit"
                      disabled={isBorrowing}
                      className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-900 via-blue-950 to-slate-900 hover:from-blue-800 hover:to-slate-800 text-amber-300 shadow-lg shadow-blue-950/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isBorrowing ? (
                        <span className="inline-block w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <Bookmark className="w-4 h-4" />
                          <span>Pinjam Buku Ini Sekarang</span>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-center">
                    <p className="text-sm font-semibold text-rose-800">
                      Seluruh eksemplar buku ini sedang dipinjam oleh anggota lain.
                    </p>
                    <p className="text-xs text-rose-600 mt-1">
                      Silakan periksa kembali beberapa hari ke depan setelah ada pengembalian ke rak perpustakaan.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
