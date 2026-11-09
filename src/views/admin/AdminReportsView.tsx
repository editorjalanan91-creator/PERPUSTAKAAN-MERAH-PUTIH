import React, { useState, useEffect } from 'react';
import { MonthlyReportSummary, Loan } from '../../types';
import { api } from '../../services/api';
import { formatDateIndo } from '../../utils/libraryRules';
import {
  FileText,
  Printer,
  Calendar,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  BookOpen,
  Award,
  Layers,
  Filter,
} from 'lucide-react';

interface AdminReportsViewProps {
  loans: Loan[];
}

export const AdminReportsView: React.FC<AdminReportsViewProps> = ({ loans }) => {
  // Current month default in YYYY-MM
  const currentMonthYear = new Date().toISOString().slice(0, 7);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonthYear);
  const [report, setReport] = useState<MonthlyReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Month options for selector
  const monthOptions = [
    { value: '2026-11', label: 'November 2026' },
    { value: '2026-10', label: 'Oktober 2026' },
    { value: '2026-09', label: 'September 2026' },
    { value: '2026-08', label: 'Agustus 2026' },
    { value: '2026-07', label: 'Juli 2026' },
    { value: '2026-06', label: 'Juni 2026' },
  ];

  const fetchReport = async (period: string) => {
    setIsLoading(true);
    try {
      const res = await api.getMonthlyReport(period);
      setReport(res.report);
    } catch (err) {
      console.error('Failed to load monthly report:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport(selectedPeriod);
  }, [selectedPeriod, loans]);

  const monthLoans = loans.filter((l) => l.borrowDate.startsWith(selectedPeriod));

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8 pb-16 print:p-0">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Laporan Peminjaman Bulanan Otomatis
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Rekapitulasi sirkulasi buku, tingkat kepatuhan pengembalian, dan statistik buku terpopuler.
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
          Periode: {report?.periodLabel || selectedPeriod} • Dicetak Secara Otomatis oleh Sistem
        </p>
      </div>

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Peminjaman */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Total Peminjaman</span>
            <FileText className="w-4 h-4 text-blue-900" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {report?.totalLoans || 0}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Transaksi</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Seluruh peminjaman pada {report?.periodLabel}
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
              {report?.returnedLoans || 0}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Buku</span>
          </div>
          <p className="text-[11px] text-emerald-600 mt-2 font-medium">
            Telah kembali ke rak perpustakaan
          </p>
        </div>

        {/* Sedang Dipinjam */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Sedang Berjalan (Aktif)</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-blue-900">
              {report?.activeLoans || 0}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Buku</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Masih dalam masa pinjam anggota
          </p>
        </div>

        {/* Terlambat & Rasio */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>Terlambat / Jatuh Tempo</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-rose-700">
              {report?.overdueLoans || 0}
            </span>
            <span className="text-xs text-slate-500 ml-1.5">Buku</span>
          </div>
          <p className="text-[11px] text-rose-600 mt-2 font-medium">
            Rasio Tepat Waktu: {report?.onTimeReturnRate || 100}%
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
              Buku Paling Sering Dipinjam ({report?.periodLabel})
            </h3>
          </div>

          {report && report.topBooks.length > 0 ? (
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
                      src={item.coverUrl}
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
                      {item.borrowCount} kali dipinjam
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50 rounded-xl text-slate-500 text-xs">
              Belum ada riwayat peminjaman buku pada periode {report?.periodLabel}.
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Layers className="w-5 h-5 text-blue-900" />
            <h3 className="font-bold text-sm text-slate-900">
              Distribusi Kategori yang Diminati
            </h3>
          </div>

          {report && report.categoryDistribution.length > 0 ? (
            <div className="space-y-2.5">
              {report.categoryDistribution.map((cat) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                    <span>{cat.category}</span>
                    <span className="text-slate-900 font-bold">{cat.count} peminjaman</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-blue-900 rounded-full"
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
            Daftar Lengkap Transaksi Peminjaman ({report?.periodLabel})
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
                  <th className="py-2.5 px-4 font-semibold">Tgl Pinjam</th>
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
                      {loan.userName}
                    </td>
                    <td className="py-3 px-4 text-slate-800 font-medium max-w-xs truncate">
                      {loan.bookTitle}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDateIndo(loan.borrowDate)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDateIndo(loan.dueDate)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {loan.returnDate ? formatDateIndo(loan.returnDate) : '-'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {loan.status === 'returned' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Selesai
                        </span>
                      ) : loan.status === 'overdue' ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                          Terlambat
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900">
                          Aktif
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
            Tidak ada transaksi peminjaman pada periode {report?.periodLabel}.
          </div>
        )}
      </div>
    </div>
  );
};
