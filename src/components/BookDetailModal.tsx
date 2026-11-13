import React, { useState, useEffect } from 'react';
import { Book, Loan } from '../types';
import { getBookCoverUrl, getBookFileSignedUrl } from '../services/supabaseClient';
import {
  X,
  BookOpen,
  Calendar,
  Building2,
  Bookmark,
  Layers,
  CheckCircle2,
  AlertCircle,
  Hash,
  Clock,
  FileText,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';

interface BookDetailModalProps {
  book: Book | null;
  onClose: () => void;
  onBorrow: (bookId: string, durationDays: number, notes?: string) => Promise<void>;
  isBorrowing?: boolean;
  userLoan?: Loan | null;
}

export const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  onClose,
  onBorrow,
  isBorrowing = false,
  userLoan,
}) => {
  if (!book) return null;

  const [notes, setNotes] = useState<string>('');
  const [durationDays, setDurationDays] = useState<number>(7);
  const [imageError, setImageError] = useState<boolean>(false);
  const [readingUrl, setReadingUrl] = useState<string | null>(null);
  const [isLoadingReader, setIsLoadingReader] = useState<boolean>(false);

  const isAvailable = (book.available_copies ?? 0) > 0;
  const coverUrl = getBookCoverUrl(book.cover_path);

  // Periksa apakah pengunjung memiliki hak akses membaca (peminjaman approved / borrowed dan belum expired)
  const isApprovedToRead =
    userLoan &&
    (userLoan.status === 'approved' || userLoan.status === 'borrowed') &&
    (!userLoan.due_at || new Date(userLoan.due_at).getTime() >= new Date().getTime());

  const isPending = userLoan && userLoan.status === 'pending';

  // Ambil signed URL jika disetujui membaca
  const handleOpenReader = async () => {
    if (!book.file_path) {
      alert('File dokumen digital (PDF/EPUB) belum diunggah untuk buku ini.');
      return;
    }
    setIsLoadingReader(true);
    try {
      const signedUrl = await getBookFileSignedUrl(book.file_path, 7200); // 2 jam masa berlaku
      if (signedUrl) {
        setReadingUrl(signedUrl);
        window.open(signedUrl, '_blank', 'noopener,noreferrer');
      } else {
        alert('Gagal membuat tautan akses buku privat. Hubungi administrator.');
      }
    } catch (err: any) {
      alert(`Terjadi kesalahan: ${err.message}`);
    } finally {
      setIsLoadingReader(false);
    }
  };

  const handleSubmitBorrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAvailable || isBorrowing || isPending || isApprovedToRead) return;
    await onBorrow(book.id, durationDays, notes);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <h2 className="font-bold text-base sm:text-lg">Detail Informasi Koleksi Buku</h2>
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
                {!imageError && coverUrl ? (
                  <img
                    src={coverUrl}
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
                      Tersedia ({book.available_copies}/{book.total_copies})
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-lg flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Stok Habis (0/{book.total_copies})
                    </span>
                  )}
                </div>
              </div>

              {/* Status Peminjaman User Badge */}
              {isApprovedToRead && (
                <div className="mt-4 w-full p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Peminjaman Aktif Disetujui</span>
                  </div>
                  {userLoan?.due_at && (
                    <p className="text-[11px] text-emerald-700 mt-1">
                      Batas Akses: {new Date(userLoan.due_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )}

              {isPending && (
                <div className="mt-4 w-full p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-800">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span>Menunggu Persetujuan Admin</span>
                  </div>
                  <p className="text-[11px] text-amber-700 mt-1">
                    Permintaan Anda sedang dalam antrean verifikasi administrator.
                  </p>
                </div>
              )}
            </div>

            {/* Right: Detailed Metadata & Action */}
            <div className="md:col-span-7 flex flex-col justify-between">
              <div>
                <div className="inline-block px-3 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-900 border border-blue-200 mb-3">
                  {book.category_name || book.category?.name || 'Umum'}
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
                  {book.title}
                </h1>
                <p className="text-sm font-semibold text-slate-600 mt-2">
                  Penulis: <span className="text-slate-900 underline decoration-amber-400 decoration-2">{book.author}</span>
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
                      <p className="text-xs font-semibold text-slate-800">{book.publication_year}</p>
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
                    <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] text-slate-500 font-medium">Format Dokumen</p>
                      <p className="text-xs font-semibold text-slate-800 uppercase">
                        {book.file_type || (book.file_path ? 'PDF' : 'Fisik')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="mt-6">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Deskripsi / Sinopsis Buku
                  </h4>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    {book.description || 'Tidak ada keterangan tambahan untuk buku ini.'}
                  </p>
                </div>
              </div>

              {/* Action Area */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                {isApprovedToRead ? (
                  /* User has approved loan -> can read book */
                  <div className="space-y-3">
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-900 mb-2">
                        🎉 Peminjaman Anda telah disetujui oleh admin. Anda dapat membaca file buku digital ini melalui tautan privat resmi:
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenReader}
                        disabled={isLoadingReader}
                        className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white shadow-lg shadow-emerald-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {isLoadingReader ? (
                          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <BookOpen className="w-4 h-4" />
                            <span>Buka &amp; Baca Dokumen Buku ({book.file_type?.toUpperCase() || 'PDF'})</span>
                            <ExternalLink className="w-3.5 h-3.5 ml-1" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : isPending ? (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center">
                    <p className="text-sm font-bold text-amber-900">
                      Permintaan Peminjaman Telah Diajukan
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Status permintaan Anda saat ini adalah <span className="font-semibold uppercase">Pending</span>. Tombol baca buku digital akan aktif secara otomatis setelah disetujui oleh administrator.
                    </p>
                  </div>
                ) : isAvailable ? (
                  <form onSubmit={handleSubmitBorrow} className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wide text-slate-700 mb-1.5">
                        Ajukan Permintaan Peminjaman:
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Catatan peminjaman (opsional, contoh: untuk keperluan skripsi/riset)"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30 text-slate-800 placeholder-slate-400"
                      />
                    </div>

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
                          <span>Ajukan Peminjaman Buku</span>
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
                      Silakan periksa kembali beberapa hari ke depan setelah ada pengembalian ke perpustakaan.
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
