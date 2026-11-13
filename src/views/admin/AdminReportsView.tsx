import React, { useState, useMemo } from 'react';
import { Loan } from '../../types';
import { formatDateIndo, aggregateMonthlyReport } from '../../utils/libraryRules';
import { getBookCoverUrl } from '../../services/supabaseClient';
import {
  FileText,
  Printer,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Award,
  Layers,
  HelpCircle,
} from 'lucide-react';

interface AdminReportsViewProps {
  loans: Loan[];
}

export const AdminReportsView: React.FC<AdminReportsViewProps> = ({ loans }) => {
  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonthYear);

  // Month options: current and past 6 months
  const monthOptions = useMemo(() => {
    const list = [];
    const date = new Date();
    const monthsIndo = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    for (let i = 0; i < 7; i++) {
      const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
      const val = d.toISOString().slice(0, 7);
      const label = `${monthsIndo[d.getMonth()]} ${d.getFullYear()}`;
      list.push({ value: val, label });
    }
    return list;
  }, []);

  const report = useMemo(() => {
    const base = aggregateMonthlyReport(loans, selectedPeriod);
    const monthLoans = loans.filter((loan) => (loan.requested_at || loan.created_at || '').startsWith(selectedPeriod));
    
    const catCountMap: Record<string, number> = {};
    for (const l of monthLoans) {
      const catName = l.book?.category_name || l.book?.category?.name || 'Umum';
      catCountMap[catName] = (catCountMap[catName] || 0) + 1;
    }
    
    base.categoryDistribution = Object.entries(catCountMap).map(([category, count]) => ({
      category,
      count,
    }));

    return base;
  }, [loans, selectedPeriod]);

  const monthLoans = useMemo(() => {
    return loans.filter((l) => (l.requested_at || l.created_at || '').startsWith(selectedPeriod));
  }, [loans, selectedPeriod]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8 pb-16 print:p-0">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Laporan Peminjaman Bulanan
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Rekapitulasi sirkulasi buku, status peminjaman, dan statistik buku terpopuler langsung dari database.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-blue-900" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handlePrint}
            className="flex items-center gap-2 py-2 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-sm transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Cetak Laporan</span>
          </button>
        </div>
      </div>

      {/* Official Header for Print Mode */}
      <div className="hidden print:block text-center border-b-2 border-slate-900 pb-4 mb-6">
        <h2 className="text-xl font-bold uppercase tracking-wider text-slate-900">
          PERPUSTAKAAN MERAH PUTIH • LAPORAN SIRKULASI PEMINJAMAN
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          Periode: {report.periodLabel} • Dicetak Secara Otomatis oleh Sistem Perpustakaan
        </p>
      </div>

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Transaksi */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Total Pengajuan</span>
            <FileText className="w-4 h-4 text-blue-900" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {report.totalLoans}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Transaksi</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Seluruh transaksi pada {report.periodLabel}
          </p>
        </div>

        {/* Pengembalian Selesai */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Sudah Dikembalikan</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-emerald-700">
              {report.returnedLoans}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Buku</span>
          </div>
          <p className="text-[11px] text-emerald-600 mt-2 font-medium">
            Telah kembali ke inventaris
          </p>
        </div>

        {/* Sedang Berjalan (Aktif / Disetujui) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Disetujui / Aktif</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-blue-900">
              {report.activeLoans}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Buku</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Sedang dipinjam atau dapat dibaca anggota
          </p>
        </div>

        {/* Menunggu Persetujuan */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Menunggu Persetujuan</span>
            <HelpCircle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-amber-700">
              {report.pendingLoans}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Permintaan</span>
          </div>
          <p className="text-[11px] text-amber-600 mt-2 font-medium">
            Memerlukan tinjauan admin
          </p>
        </div>
      </div>

      {/* Grid: Top Books Ranking & Category Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Top Most Borrowed Books */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Award className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-sm text-slate-900">
              Buku Paling Sering Diajukan ({report.periodLabel})
            </h3>
          </div>

          {report.topBooks.length > 0 ? (
            <div className="space-y-3">
              {report.topBooks.map((item, idx) => (
                <div
                  key={item.bookId}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-150"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <img
                      src={getBookCoverUrl(item.coverUrl)}
                      alt={item.title}
                      className="w-8 h-11 object-cover rounded shadow-sm bg-slate-900 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-xs truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-500 truncate">{item.author}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-blue-900 text-white">
                      {item.borrowCount} kali diajukan
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-xl text-slate-500 text-xs">
              Belum ada riwayat peminjaman buku pada periode {report.periodLabel}.
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Layers className="w-5 h-5 text-blue-900" />
            <h3 className="font-bold text-sm text-slate-900">
              Distribusi Kategori
            </h3>
          </div>

          {report.categoryDistribution.length > 0 ? (
            <div className="space-y-2.5">
              {report.categoryDistribution.map((cat) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span>{cat.category}</span>
                    <span className="text-slate-900 font-bold">{cat.count} transaksi</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-blue-900 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((cat.count / (report.totalLoans || 1)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-xl text-slate-500 text-xs">
              Belum ada data distribusi kategori untuk periode ini.
            </div>
          )}
        </div>
      </div>

      {/* Complete Monthly Transaction Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900">
            Daftar Lengkap Transaksi ({report.periodLabel})
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            {monthLoans.length} Transaksi Tercatat
          </span>
        </div>

        {monthLoans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">ID Resi</th>
                  <th className="py-2.5 px-4 font-semibold">Peminjam</th>
                  <th className="py-2.5 px-4 font-semibold">Buku</th>
                  <th className="py-2.5 px-4 font-semibold">Tgl Pengajuan</th>
                  <th className="py-2.5 px-4 font-semibold">Batas Kembali</th>
                  <th className="py-2.5 px-4 font-semibold">Tgl Dikembalikan</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthLoans.map((loan) => (
                  <tr key={loan.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 font-medium">
                      {loan.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {loan.profile?.full_name || loan.user_id.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 text-slate-800 font-medium max-w-xs truncate">
                      {loan.book?.title || 'Buku'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDateIndo(loan.requested_at || loan.created_at)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {loan.due_at ? formatDateIndo(loan.due_at) : '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {loan.returned_at ? formatDateIndo(loan.returned_at) : '-'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {loan.status === 'returned' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Selesai
                        </span>
                      ) : loan.status === 'expired' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                          Kedaluwarsa
                        </span>
                      ) : loan.status === 'approved' || loan.status === 'borrowed' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900">
                          Disetujui
                        </span>
                      ) : loan.status === 'pending' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                          Menunggu
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          Ditolak
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs">
            Tidak ada transaksi peminjaman pada periode {report.periodLabel}.
          </div>
        )}
      </div>
    </div>
  );
};
