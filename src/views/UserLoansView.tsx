import React, { useState } from 'react';
import { Loan } from '../types';
import {
  evaluateDigitalBookReadAccess,
  formatDateIndo,
  formatLoanStatusIndo,
} from '../utils/libraryRules';
import { resolveDocumentFileType } from '../utils/epubUtils';
import { getBookCoverUrl } from '../services/supabaseClient';
import { libraryService } from '../services/libraryService';
import {
  BookMarked,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  FileText,
  Printer,
  X,
  Compass,
  Calendar,
  BookOpen,
  HelpCircle,
  XCircle,
} from 'lucide-react';

interface UserLoansViewProps {
  loans: Loan[];
  onReturnBook: (loanId: string) => Promise<void>;
  onNavigateToCatalog: () => void;
  onOpenBookReader?: (bookId: string) => void;
  isReturning?: boolean;
}

export const UserLoansView: React.FC<UserLoansViewProps> = ({
  loans,
  onReturnBook,
  onNavigateToCatalog,
  onOpenBookReader,
  isReturning = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'returned'>('all');
  const [selectedReceiptLoan, setSelectedReceiptLoan] = useState<Loan | null>(null);
  const [readingLoanId, setReadingLoanId] = useState<string | null>(null);
  const [returningLoanId, setReturningLoanId] = useState<string | null>(null);
  const [confirmingReturnLoan, setConfirmingReturnLoan] = useState<Loan | null>(null);
  const [returnModalError, setReturnModalError] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);

  const handleOpenReturnConfirm = (loan: Loan) => {
    if (isReturning || returningLoanId) return;
    setReturnModalError(null);
    setConfirmingReturnLoan(loan);
  };

  const handleConfirmReturn = async () => {
    if (!confirmingReturnLoan || isReturning || returningLoanId) return;
    const loanId = confirmingReturnLoan.id;
    setReturningLoanId(loanId);
    setReturnModalError(null);
    try {
      await onReturnBook(loanId);
      setConfirmingReturnLoan(null);
    } catch (err: any) {
      setReturnModalError(err?.message || 'Gagal mengonfirmasi pengembalian buku.');
    } finally {
      setReturningLoanId(null);
    }
  };

  const filteredLoans = loans.filter((l) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'pending') return l.status === 'pending';
    if (filterStatus === 'approved') return l.status === 'approved' || l.status === 'borrowed';
    if (filterStatus === 'returned') return l.status === 'returned';
    return true;
  });

  const pendingCount = loans.filter((l) => l.status === 'pending').length;
  const approvedCount = loans.filter((l) => l.status === 'approved' || l.status === 'borrowed').length;
  const returnedCount = loans.filter((l) => l.status === 'returned').length;

  const handleOpenDigitalReader = async (loan: Loan) => {
    setReaderError(null);
    if (!loan.book?.file_path) {
      setReaderError('Buku ini tidak memiliki lampiran berkas digital (koleksi fisik).');
      return;
    }
    const readAccess = evaluateDigitalBookReadAccess(loan);
    if (!readAccess.allowed) {
      setReaderError(readAccess.message);
      return;
    }
    setReadingLoanId(loan.id);
    try {
      await libraryService.getBookDigitalReadUrl(loan.book_id);
      if (onOpenBookReader) {
        onOpenBookReader(loan.book_id);
      } else if (typeof window !== 'undefined') {
        window.history.pushState({}, '', `/read/${encodeURIComponent(loan.book_id)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (err: any) {
      setReaderError(err?.message || 'Terjadi kesalahan saat membuka pembaca buku digital.');
    } finally {
      setReadingLoanId(null);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-serif-title">
            Daftar Peminjaman Saya
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Pantau status pengajuan peminjaman, akses baca buku digital yang disetujui, dan riwayat pengembalian.
          </p>
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Semua ({loans.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'pending' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Menunggu ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'approved' ? 'bg-blue-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Disetujui ({approvedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('returned')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'returned' ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Selesai ({returnedCount})
          </button>
        </div>
      </div>

      {readerError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{readerError}</span>
          </div>
          <button
            type="button"
            onClick={() => setReaderError(null)}
            className="text-rose-700 hover:text-rose-900 font-bold"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Loans List */}
      {filteredLoans.length > 0 ? (
        <div className="space-y-4">
          {filteredLoans.map((loan) => {
            const isPending = loan.status === 'pending';
            const isApproved = loan.status === 'approved' || loan.status === 'borrowed';
            const isReturned = loan.status === 'returned';
            const isRejected = loan.status === 'rejected';
            const isExpired = loan.status === 'expired';
            const readAccess = evaluateDigitalBookReadAccess(loan);
            const canReadDigital = isApproved && readAccess.allowed && Boolean(loan.book?.file_path);

            const coverUrl = getBookCoverUrl(loan.book?.cover_path);
            const bookTitle = loan.book?.title || 'Judul Buku';
            const bookAuthor = loan.book?.author || 'Penulis';

            return (
              <div
                key={loan.id}
                className={`bg-white rounded-2xl p-5 border shadow-sm transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-5 ${
                  isRejected || isExpired
                    ? 'border-rose-200 bg-rose-50/20'
                    : isPending
                    ? 'border-amber-300 bg-amber-50/30 ring-1 ring-amber-200'
                    : isApproved
                    ? 'border-blue-200'
                    : 'border-slate-200 opacity-90'
                }`}
              >
                {/* Book & Info */}
                <div className="flex items-start gap-4">
                  <img
                    src={coverUrl}
                    alt={bookTitle}
                    className="w-16 h-22 object-cover rounded-xl shadow shrink-0 bg-slate-900"
                  />

                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                          <HelpCircle className="w-3 h-3 text-amber-600" />
                          Menunggu Persetujuan Admin
                        </span>
                      )}
                      {isApproved && readAccess.allowed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900">
                          <CheckCircle2 className="w-3 h-3 text-blue-900" />
                          Disetujui (Dapat Dibaca)
                        </span>
                      )}
                      {isApproved && !readAccess.allowed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          {readAccess.code === 'LOAN_EXPIRED'
                            ? 'Jatuh Tempo Terlewati'
                            : 'Akses Baca Terkunci'}
                        </span>
                      )}
                      {isReturned && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Sudah Dikembalikan
                        </span>
                      )}
                      {isRejected && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                          <XCircle className="w-3 h-3" />
                          Permintaan Ditolak
                        </span>
                      )}
                      {isExpired && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                          <AlertTriangle className="w-3 h-3" />
                          Masa Pinjam Berakhir
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400">ID: {loan.id.slice(-6).toUpperCase()}</span>
                    </div>

                    <h3 className="font-bold text-slate-900 text-base">{bookTitle}</h3>
                    <p className="text-xs text-slate-600 mt-0.5">Penulis: {bookAuthor}</p>

                    {/* Dates */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 mt-2.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Tgl Pengajuan: <strong className="text-slate-700">{formatDateIndo(loan.requested_at || loan.created_at)}</strong>
                      </span>
                      {loan.approved_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Disetujui: <strong className="text-slate-700">{formatDateIndo(loan.approved_at)}</strong>
                        </span>
                      )}
                      {loan.due_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Jatuh Tempo: <strong className="text-slate-700">{formatDateIndo(loan.due_at)}</strong>
                        </span>
                      )}
                      {loan.returned_at && (
                        <span className="flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Dikembalikan: {formatDateIndo(loan.returned_at)}
                        </span>
                      )}
                    </div>

                    {/* Admin Note if available */}
                    {loan.admin_note && (
                      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2">
                        <strong className="text-slate-800">Catatan Admin:</strong> {loan.admin_note}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex sm:flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    {isApproved && readAccess.allowed && (
                      <p className="text-xs font-semibold text-blue-900">
                        Aktif &amp; Dapat Dibaca
                      </p>
                    )}
                    {isApproved && !readAccess.allowed && (
                      <p className="text-xs font-semibold text-rose-700 max-w-xs">
                        {readAccess.message}
                      </p>
                    )}
                    {isPending && (
                      <p className="text-xs text-amber-700 font-medium">
                        Menunggu verifikasi admin perpustakaan
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Read Digital Book Button if approved and due_at valid & unexpired */}
                    {canReadDigital && loan.book?.file_path && (
                      <button
                        type="button"
                        disabled={readingLoanId === loan.id}
                        onClick={() => handleOpenDigitalReader(loan)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-900 hover:bg-blue-950 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {readingLoanId === loan.id
                            ? 'Menyiapkan...'
                            : `Baca ${resolveDocumentFileType(loan.book.file_type, loan.book.file_path).toUpperCase()}`}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedReceiptLoan(loan)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Resi</span>
                    </button>

                    {isApproved && (
                      <button
                        type="button"
                        disabled={isReturning || returningLoanId !== null}
                        onClick={() => handleOpenReturnConfirm(loan)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${returningLoanId === loan.id ? 'animate-spin' : ''}`} />
                        <span>{returningLoanId === loan.id ? 'Memproses...' : 'Kembalikan Buku'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-900 flex items-center justify-center mx-auto mb-4">
            <BookMarked className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-lg text-slate-900 mb-1">
            Belum Ada Peminjaman Buku
          </h3>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Anda belum memiliki pengajuan atau peminjaman buku. Jelajahi katalog perpustakaan dan ajukan peminjaman buku yang Anda minati.
          </p>
          <button
            type="button"
            onClick={onNavigateToCatalog}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            <Compass className="w-4 h-4" />
            <span>Jelajahi Katalog Buku</span>
          </button>
        </div>
      )}

      {/* Digital Receipt Modal */}
      {selectedReceiptLoan && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <span className="font-bold text-sm">Resi Peminjaman Resmi</span>
              </div>
              <button
                type="button"
                aria-label="Tutup resi peminjaman"
                onClick={() => setSelectedReceiptLoan(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slip Content */}
            <div className="p-6 space-y-5 text-slate-800 text-xs">
              <div className="text-center border-b border-slate-200 pb-4">
                <h4 className="font-bold text-base text-slate-950 uppercase tracking-wide">PERPUSTAKAAN MERAH PUTIH</h4>
                <p className="text-[11px] text-slate-500">Sistem Informasi Perpustakaan Digital &amp; Terintegrasi</p>
                <div className="mt-2 inline-block px-2.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-600">
                  NO RESI: {selectedReceiptLoan.id.slice(-8).toUpperCase()}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Peminjam:</span>
                  <span className="font-bold text-slate-900">
                    {selectedReceiptLoan.profile?.full_name || selectedReceiptLoan.userName || 'Pengunjung'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Judul Buku:</span>
                  <span className="font-bold text-slate-900 text-right max-w-[200px] truncate">
                    {selectedReceiptLoan.book?.title || selectedReceiptLoan.bookTitle}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Penulis:</span>
                  <span className="font-medium text-slate-700">
                    {selectedReceiptLoan.book?.author || selectedReceiptLoan.bookAuthor}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tanggal Pengajuan:</span>
                  <span className="font-semibold text-slate-800">
                    {formatDateIndo(selectedReceiptLoan.requested_at || selectedReceiptLoan.created_at)}
                  </span>
                </div>
                {selectedReceiptLoan.approved_at && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tanggal Disetujui:</span>
                    <span className="font-bold text-blue-900">{formatDateIndo(selectedReceiptLoan.approved_at)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Status Transaksi:</span>
                  <span className="font-bold text-slate-900">
                    {formatLoanStatusIndo(selectedReceiptLoan.status)}
                  </span>
                </div>
                {selectedReceiptLoan.admin_note && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Catatan Admin:</span>
                    <span className="font-medium text-slate-700 text-right max-w-[180px]">
                      {selectedReceiptLoan.admin_note}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                ℹ️ Simpan bukti ini sebagai tanda terima peminjaman buku yang sah di Perpustakaan Merah Putih. Harap mengembalikan buku dalam kondisi baik setelah selesai dibaca.
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-800 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  <span>Cetak Tanda Terima</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedReceiptLoan(null)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Pengembalian Buku */}
      {confirmingReturnLoan && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-return-title"
        >
          <div className="w-full max-w-md bg-white rounded-3xl p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-emerald-600" />
                <h3 id="confirm-return-title" className="font-bold text-sm text-slate-900 font-brand">
                  Konfirmasi Pengembalian Buku
                </h3>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog pengembalian"
                disabled={isReturning || returningLoanId !== null}
                onClick={() => {
                  setReturnModalError(null);
                  setConfirmingReturnLoan(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {returnModalError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{returnModalError}</span>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <p className="font-bold text-slate-900">
                {confirmingReturnLoan.book?.title || 'Koleksi Buku'}
              </p>
              <p className="text-slate-500">
                Penulis: {confirmingReturnLoan.book?.author || 'Penulis'}
              </p>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Apakah Anda yakin ingin mengembalikan buku{' '}
              <strong className="text-slate-900">
                &ldquo;{confirmingReturnLoan.book?.title || 'ini'}&rdquo;
              </strong>
              ? Status peminjaman akan diperbarui menjadi selesai dan stok buku akan ditambahkan kembali secara otomatis.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isReturning || returningLoanId !== null}
                onClick={() => {
                  setReturnModalError(null);
                  setConfirmingReturnLoan(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isReturning || returningLoanId !== null}
                onClick={handleConfirmReturn}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <RotateCcw
                  className={`w-3.5 h-3.5 ${
                    returningLoanId === confirmingReturnLoan.id ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {returningLoanId === confirmingReturnLoan.id
                    ? 'Memproses...'
                    : 'Ya, Kembalikan Buku'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
