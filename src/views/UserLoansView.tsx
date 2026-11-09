import React, { useState } from 'react';
import { Loan } from '../types';
import { formatDateIndo } from '../utils/libraryRules';
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
  User,
} from 'lucide-react';

interface UserLoansViewProps {
  loans: Loan[];
  onReturnBook: (loanId: string) => Promise<void>;
  onNavigateToCatalog: () => void;
  isReturning?: boolean;
}

export const UserLoansView: React.FC<UserLoansViewProps> = ({
  loans,
  onReturnBook,
  onNavigateToCatalog,
  isReturning = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'returned'>('all');
  const [selectedReceiptLoan, setSelectedReceiptLoan] = useState<Loan | null>(null);

  const filteredLoans = loans.filter((l) => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return l.status === 'active' || l.status === 'overdue';
    if (filterStatus === 'returned') return l.status === 'returned';
    return true;
  });

  const activeLoansCount = loans.filter((l) => l.status === 'active' || l.status === 'overdue').length;

  return (
    <div className="space-y-8 pb-16">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-serif-title">
            Daftar Peminjaman Saya
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Pantau status peminjaman buku aktif, batas waktu pengembalian, dan riwayat peminjaman Anda.
          </p>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Semua ({loans.length})
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'active' ? 'bg-blue-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Aktif ({activeLoansCount})
          </button>
          <button
            onClick={() => setFilterStatus('returned')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterStatus === 'returned' ? 'bg-emerald-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Selesai
          </button>
        </div>
      </div>

      {/* Loans List */}
      {filteredLoans.length > 0 ? (
        <div className="space-y-4">
          {filteredLoans.map((loan) => {
            const isActive = loan.status === 'active';
            const isOverdue = loan.status === 'overdue';
            const isReturned = loan.status === 'returned';

            // Calculate days remaining or days late
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dueDate = new Date(loan.dueDate);
            dueDate.setHours(0, 0, 0, 0);
            const diffTime = dueDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            return (
              <div
                key={loan.id}
                className={`bg-white rounded-2xl p-5 border shadow-sm transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-5 ${
                  isOverdue
                    ? 'border-rose-300 ring-1 ring-rose-200'
                    : isActive
                    ? 'border-blue-200'
                    : 'border-slate-200 opacity-90'
                }`}
              >
                {/* Book & Info */}
                <div className="flex items-start gap-4">
                  <img
                    src={loan.bookCover || 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=300&q=80'}
                    alt={loan.bookTitle}
                    className="w-16 h-22 object-cover rounded-xl shadow shrink-0 bg-slate-900"
                  />

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900">
                          <Clock className="w-3 h-3" />
                          Sedang Dipinjam
                        </span>
                      )}
                      {isOverdue && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 animate-pulse">
                          <AlertTriangle className="w-3 h-3" />
                          Terlambat ({Math.abs(diffDays)} Hari)
                        </span>
                      )}
                      {isReturned && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Sudah Dikembalikan
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400">ID: {loan.id.slice(-6)}</span>
                    </div>

                    <h3 className="font-bold text-slate-900 text-base">{loan.bookTitle}</h3>
                    <p className="text-xs text-slate-600 mt-0.5">Penulis: {loan.bookAuthor}</p>

                    {/* Dates */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 mt-2.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Tgl Pinjam: <strong className="text-slate-700">{formatDateIndo(loan.borrowDate)}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        Jatuh Tempo: <strong className="text-slate-700">{formatDateIndo(loan.dueDate)}</strong>
                      </span>
                      {loan.returnDate && (
                        <span className="flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Dikembalikan: {formatDateIndo(loan.returnDate)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions & Days Countdown */}
                <div className="flex sm:flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    {isActive && (
                      <p className="text-xs font-semibold text-blue-900">
                        {diffDays >= 0 ? `Sisa ${diffDays} hari lagi` : 'Batas waktu telah lewat'}
                      </p>
                    )}
                    {isOverdue && (
                      <p className="text-xs font-bold text-rose-700">
                        Harap segera kembalikan ke perpustakaan!
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedReceiptLoan(loan)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Bukti Pinjam</span>
                    </button>

                    {(isActive || isOverdue) && (
                      <button
                        type="button"
                        disabled={isReturning}
                        onClick={() => onReturnBook(loan.id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Kembalikan Buku</span>
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
            Anda belum memiliki buku yang sedang dipinjam. Jelajahi katalog perpustakaan dan temukan buku yang Anda minati.
          </p>
          <button
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
                <span className="font-bold text-sm">Bukti Peminjaman Resmi</span>
              </div>
              <button
                onClick={() => setSelectedReceiptLoan(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slip Content */}
            <div className="p-6 space-y-5 text-slate-800 text-xs">
              <div className="text-center border-b border-slate-200 pb-4">
                <h4 className="font-brand font-bold text-base text-slate-950">PERPUSTAKAAN MERAH PUTIH</h4>
                <p className="text-[11px] text-slate-500">Sistem Informasi Perpustakaan Digital</p>
                <div className="mt-2 inline-block px-2.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-600">
                  NO RESI: {selectedReceiptLoan.id.toUpperCase()}
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Peminjam:</span>
                  <span className="font-bold text-slate-900">{selectedReceiptLoan.userName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Email:</span>
                  <span className="font-medium text-slate-700">{selectedReceiptLoan.userEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Judul Buku:</span>
                  <span className="font-bold text-slate-900 text-right max-w-[200px] truncate">
                    {selectedReceiptLoan.bookTitle}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Penulis:</span>
                  <span className="font-medium text-slate-700">{selectedReceiptLoan.bookAuthor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tanggal Pinjam:</span>
                  <span className="font-semibold text-slate-800">{formatDateIndo(selectedReceiptLoan.borrowDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Batas Pengembalian:</span>
                  <span className="font-bold text-blue-900">{formatDateIndo(selectedReceiptLoan.dueDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status Saat Ini:</span>
                  <span className="font-bold text-slate-900 uppercase">
                    {selectedReceiptLoan.status === 'returned'
                      ? 'SUDAH DIKEMBALIKAN'
                      : selectedReceiptLoan.status === 'overdue'
                      ? 'TERLAMBAT'
                      : 'AKTIF DIPINJAM'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                ℹ️ Simpan bukti ini sebagai tanda terima peminjaman buku yang sah di Perpustakaan Merah Putih. Harap mengembalikan buku tepat waktu dalam kondisi baik.
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
    </div>
  );
};
