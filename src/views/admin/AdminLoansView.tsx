import React, { useState, useMemo } from 'react';
import { Loan, LoanStatus } from '../../types';
import { getBookCoverUrl } from '../../services/supabaseClient';
import { formatDateIndo } from '../../utils/libraryRules';
import {
  Bookmark,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Search,
  User,
  Calendar,
  AlertCircle,
  Check,
  X,
  FileText,
} from 'lucide-react';

interface AdminLoansViewProps {
  loans: Loan[];
  onApproveLoan: (loanId: string, durationDays: number, note?: string) => Promise<void>;
  onRejectLoan: (loanId: string, reason: string) => Promise<void>;
  onReturnLoan: (loanId: string) => Promise<void>;
}

export const AdminLoansView: React.FC<AdminLoansViewProps> = ({
  loans,
  onApproveLoan,
  onRejectLoan,
  onReturnLoan,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LoanStatus>('all');

  // Modals state
  const [approvingLoan, setApprovingLoan] = useState<Loan | null>(null);
  const [approvalDays, setApprovalDays] = useState<number>(7);
  const [approvalNote, setApprovalNote] = useState<string>('');

  const [rejectingLoan, setRejectingLoan] = useState<Loan | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredLoans = useMemo(() => {
    return loans.filter((l) => {
      const matchStatus = statusFilter === 'all' || l.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        (l.book?.title || '').toLowerCase().includes(q) ||
        (l.book?.author || '').toLowerCase().includes(q) ||
        (l.profile?.full_name || '').toLowerCase().includes(q) ||
        (l.profile?.username || '').toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [loans, statusFilter, searchQuery]);

  const handleConfirmApprove = async () => {
    if (!approvingLoan) return;
    setIsSubmitting(true);
    try {
      await onApproveLoan(approvingLoan.id, approvalDays, approvalNote);
      setApprovingLoan(null);
      setApprovalNote('');
    } catch (err: any) {
      alert(`Gagal menyetujui peminjaman: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingLoan) return;
    setIsSubmitting(true);
    try {
      await onRejectLoan(rejectingLoan.id, rejectReason);
      setRejectingLoan(null);
      setRejectReason('');
    } catch (err: any) {
      alert(`Gagal menolak peminjaman: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReturn = async (loanId: string) => {
    if (!confirm('Konfirmasi bahwa buku ini telah diterima kembali dalam kondisi baik?')) return;
    try {
      await onReturnLoan(loanId);
    } catch (err: any) {
      alert(`Gagal mengonfirmasi pengembalian: ${err.message}`);
    }
  };

  const pendingCount = loans.filter((l) => l.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-brand">
            Persetujuan &amp; Sirkulasi Peminjaman
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Tinjau pengajuan peminjaman dari pengunjung, atur batas waktu pengembalian, dan konfirmasi buku yang telah kembali.
          </p>
        </div>

        {pendingCount > 0 && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-900 font-bold text-xs self-start sm:self-auto">
            <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
            <span>{pendingCount} Permintaan Menunggu Persetujuan</span>
          </div>
        )}
      </div>

      {/* Filter & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul buku, nama peminjam, atau ID transaksi..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
          />
        </div>

        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {[
            { id: 'all', label: 'Semua' },
            { id: 'pending', label: 'Menunggu (Pending)' },
            { id: 'approved', label: 'Disetujui' },
            { id: 'returned', label: 'Dikembalikan' },
            { id: 'rejected', label: 'Ditolak' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-blue-900 text-amber-300 shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table of Loans */}
      {filteredLoans.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
          <Bookmark className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-sm">Tidak Ada Transaksi Peminjaman</p>
          <p className="text-xs text-slate-400 mt-1">
            Belum ada data peminjaman yang sesuai dengan filter yang dipilih.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200 text-[11px]">
                <tr>
                  <th className="py-3 px-4">Buku Yang Dipinjam</th>
                  <th className="py-3 px-4">Peminjam (Anggota)</th>
                  <th className="py-3 px-4">Tanggal Pengajuan</th>
                  <th className="py-3 px-4">Jatuh Tempo</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi Administrator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLoans.map((loan) => {
                  const cover = getBookCoverUrl(loan.book?.cover_path);
                  return (
                    <tr key={loan.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={cover}
                            alt={loan.book?.title}
                            className="w-10 h-14 object-cover rounded-lg shadow-sm border border-slate-200 shrink-0 bg-slate-900"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate max-w-[200px]" title={loan.book?.title}>
                              {loan.book?.title || 'Judul Buku'}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                              {loan.book?.author || 'Penulis'}
                            </p>
                            <span className="font-mono text-[9px] text-slate-400">
                              ID: {loan.id.substring(0, 8)}...
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                            <User className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{loan.profile?.full_name || 'Pengunjung'}</p>
                            <p className="text-[10px] text-slate-500">@{loan.profile?.username || 'user'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <p className="font-medium">{formatDateIndo(loan.requested_at)}</p>
                      </td>
                      <td className="py-3 px-4">
                        {loan.due_at ? (
                          <div>
                            <p className="font-bold text-blue-900">{formatDateIndo(loan.due_at)}</p>
                            {new Date(loan.due_at).getTime() < new Date().getTime() && loan.status !== 'returned' && (
                              <span className="text-[10px] font-bold text-rose-600">Terlewat Batas</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Belum ditentukan</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {loan.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" />
                            Menunggu Persetujuan
                          </span>
                        )}
                        {(loan.status === 'approved' || loan.status === 'borrowed') && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3" />
                            Disetujui
                          </span>
                        )}
                        {loan.status === 'returned' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                            <RotateCcw className="w-3 h-3" />
                            Telah Kembali
                          </span>
                        )}
                        {loan.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            <XCircle className="w-3 h-3" />
                            Ditolak
                          </span>
                        )}
                        {loan.status === 'expired' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            <AlertCircle className="w-3 h-3" />
                            Kedaluwarsa
                          </span>
                        )}
                        {loan.admin_note && (
                          <p className="text-[10px] text-slate-500 mt-1 italic max-w-xs truncate" title={loan.admin_note}>
                            Catatan: {loan.admin_note}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {loan.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setApprovingLoan(loan);
                                setApprovalDays(7);
                                setApprovalNote('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Setujui</span>
                            </button>
                            <button
                              onClick={() => {
                                setRejectingLoan(loan);
                                setRejectReason('');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700 font-semibold text-xs transition-colors cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Tolak</span>
                            </button>
                          </div>
                        )}

                        {(loan.status === 'approved' || loan.status === 'borrowed') && (
                          <button
                            onClick={() => handleConfirmReturn(loan.id)}
                            className="px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs flex items-center gap-1.5 ml-auto cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Konfirmasi Kembali</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Setujui Peminjaman */}
      {approvingLoan && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 font-brand">
                Setujui Peminjaman Buku
              </h3>
              <button onClick={() => setApprovingLoan(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <p className="font-bold text-slate-900">{approvingLoan.book?.title}</p>
              <p className="text-slate-500">Peminjam: {approvingLoan.profile?.full_name}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tentukan Durasi Pinjaman:
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 7, 10, 14].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setApprovalDays(d)}
                    className={`py-2 text-xs font-bold rounded-xl border cursor-pointer ${
                      approvalDays === d
                        ? 'bg-blue-900 text-white border-blue-900 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {d} Hari
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Catatan Administrator (opsional):
              </label>
              <input
                type="text"
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder="Peminjaman disetujui, harap menjaga buku..."
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setApprovingLoan(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmApprove}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'Memproses...' : 'Setujui Peminjaman'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tolak Peminjaman */}
      {rejectingLoan && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 font-brand">
                Tolak Peminjaman Buku
              </h3>
              <button onClick={() => setRejectingLoan(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <p className="font-bold text-slate-900">{rejectingLoan.book?.title}</p>
              <p className="text-slate-500">Peminjam: {rejectingLoan.profile?.full_name}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Alasan Penolakan:
              </label>
              <textarea
                rows={3}
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Contoh: Eksemplar buku sedang dalam masa pemeliharaan..."
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setRejectingLoan(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmReject}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'Memproses...' : 'Tolak Permintaan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
