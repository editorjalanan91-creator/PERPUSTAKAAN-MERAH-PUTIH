import React, { useState } from 'react';
import { Profile } from '../../types';
import { formatDateIndo } from '../../utils/libraryRules';
import { isVisitorArchived } from '../../utils/visitorDeletion';
import {
  Users,
  Trash2,
  Search,
  AlertTriangle,
  Archive,
  X,
  Mail,
  AtSign,
  BookOpen,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

export interface VisitorWithStats extends Profile {
  email?: string;
  totalLoans?: number;
  activeLoans?: number;
}

interface AdminUsersViewProps {
  users: VisitorWithStats[];
  currentUserId?: string;
  onDeleteUser?: (id: string) => Promise<void>;
  onArchiveUser?: (id: string) => Promise<void>;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({
  users,
  currentUserId,
  onDeleteUser,
  onArchiveUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [targetUser, setTargetUser] = useState<VisitorWithStats | null>(null);
  const [requiresArchiveFallback, setRequiresArchiveFallback] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeVisitorsCount = users.filter((u) => !isVisitorArchived(u)).length;
  const archivedVisitorsCount = users.length - activeVisitorsCount;

  const filteredUsers = users.filter((u) => {
    const archived = isVisitorArchived(u);
    if (statusFilter === 'active' && archived) return false;
    if (statusFilter === 'archived' && !archived) return false;

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  });

  const openDeleteModal = (visitor: VisitorWithStats) => {
    setTargetUser(visitor);
    setRequiresArchiveFallback((visitor.totalLoans ?? 0) > 0);
    setModalError(null);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setTargetUser(null);
    setRequiresArchiveFallback(false);
    setModalError(null);
  };

  const handleConfirmDelete = async () => {
    if (!targetUser || !onDeleteUser || isSubmitting) return;
    setIsSubmitting(true);
    setModalError(null);
    try {
      await onDeleteUser(targetUser.id);
      setTargetUser(null);
      setRequiresArchiveFallback(false);
    } catch (err: any) {
      if (err?.code === 'HAS_LOAN_HISTORY') {
        setRequiresArchiveFallback(true);
      }
      setModalError(err?.message || 'Gagal menghapus akun pengunjung.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!targetUser || !onArchiveUser || isSubmitting) return;
    setIsSubmitting(true);
    setModalError(null);
    try {
      await onArchiveUser(targetUser.id);
      setTargetUser(null);
      setRequiresArchiveFallback(false);
    } catch (err: any) {
      setModalError(err?.message || 'Gagal mengarsipkan akun pengunjung.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const targetTotalLoans = targetUser?.totalLoans ?? 0;
  const targetActiveLoans = targetUser?.activeLoans ?? 0;
  const targetIsArchived = targetUser ? isVisitorArchived(targetUser) : false;
  const isArchiveMode = Boolean(targetUser && (targetTotalLoans > 0 || requiresArchiveFallback));

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-brand">
            Manajemen Akun Pengunjung (Anggota)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola daftar pengunjung yang terdaftar pada Supabase Authentication dan tabel profiles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="active-visitors-count"
            className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 text-xs font-bold"
          >
            Total {activeVisitorsCount} Pengunjung Aktif
          </span>
          {archivedVisitorsCount > 0 && (
            <span
              data-testid="archived-visitors-count"
              className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold"
            >
              {archivedVisitorsCount} Diarsipkan
            </span>
          )}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama, email, atau username pengunjung..."
            aria-label="Cari pengunjung"
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
          {(
            [
              { key: 'all', label: `Semua (${users.length})` },
              { key: 'active', label: `Aktif (${activeVisitorsCount})` },
              { key: 'archived', label: `Diarsipkan (${archivedVisitorsCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                statusFilter === item.key
                  ? 'bg-slate-900 text-amber-300 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200 text-[11px]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Profil Pengunjung</th>
                  <th className="py-3 px-4 font-semibold">Username Anggota</th>
                  <th className="py-3 px-4 font-semibold">Status Akun</th>
                  <th className="py-3 px-4 font-semibold">Tanggal Registrasi</th>
                  <th className="py-3 px-4 font-semibold text-center">Pinjaman Aktif</th>
                  <th className="py-3 px-4 font-semibold text-center">Total Riwayat</th>
                  {(onDeleteUser || onArchiveUser) && (
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const archived = isVisitorArchived(u);
                  const isSelfOrAdmin = u.role === 'admin' || (currentUserId && u.id === currentUserId);
                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors ${
                        archived ? 'bg-slate-50/60 hover:bg-slate-100/70' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full font-bold flex items-center justify-center text-xs shrink-0 shadow-sm ${
                              archived
                                ? 'bg-slate-200 text-slate-600'
                                : 'bg-gradient-to-br from-blue-800 to-amber-500 text-white'
                            }`}
                          >
                            {(u.full_name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 text-sm truncate">
                              {u.full_name}
                            </p>
                            <span className="text-[11px] text-slate-500 font-medium block truncate">
                              {u.email ? u.email : `ID: ${u.id.substring(0, 8)}...`}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 font-medium">
                        @{u.username}
                      </td>
                      <td className="py-3.5 px-4">
                        {archived ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-bold text-[10px]">
                            <Archive className="w-3 h-3" />
                            <span>Diarsipkan</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Aktif</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {formatDateIndo(u.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                            (u.activeLoans ?? 0) > 0
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {u.activeLoans ?? 0} buku
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-semibold text-slate-700">
                        {u.totalLoans ?? 0} transaksi
                      </td>
                      {(onDeleteUser || onArchiveUser) && (
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openDeleteModal(u)}
                            disabled={Boolean(isSelfOrAdmin)}
                            aria-label={`Hapus akun ${u.full_name}`}
                            title={
                              isSelfOrAdmin
                                ? 'Akun administrator tidak dapat dihapus'
                                : (u.totalLoans ?? 0) > 0
                                  ? 'Arsipkan / Kelola Penghapusan Akun Pengunjung'
                                  : 'Hapus Akun Pengunjung'
                            }
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-sm text-slate-700">
              {users.length === 0
                ? 'Belum Ada Pengunjung Terdaftar'
                : 'Tidak Ada Pengunjung yang Cocok'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {users.length === 0
                ? 'Pengunjung yang mendaftar mandiri akan muncul di tabel ini setelah akun berhasil diverifikasi.'
                : 'Coba ubah kata kunci pencarian atau filter status akun.'}
            </p>
          </div>
        )}
      </div>

      {/* Modal Konfirmasi Penghapusan / Pengarsipan Pengunjung */}
      {targetUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="visitor-delete-modal-title"
            className="w-full max-w-lg max-h-[90vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden text-left my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Navy Header */}
            <div className="bg-slate-950 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isArchiveMode
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-400/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-400/30'
                  }`}
                >
                  {isArchiveMode ? (
                    <Archive className="w-5 h-5" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3
                    id="visitor-delete-modal-title"
                    className="text-base font-bold text-white font-brand"
                  >
                    {isArchiveMode
                      ? 'Nonaktifkan & Arsipkan Akun Pengunjung'
                      : 'Konfirmasi Hapus Akun Pengunjung'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isArchiveMode
                      ? 'Akun memiliki riwayat peminjaman yang wajib dijaga'
                      : 'Penghapusan permanen dari Supabase Auth & database'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                aria-label="Tutup modal konfirmasi"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Target Account Summary Card */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Nama Pengunjung
                    </span>
                    <p className="text-sm font-bold text-slate-900">{targetUser.full_name}</p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      targetIsArchived
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-blue-900 text-amber-300'
                    }`}
                  >
                    {targetIsArchived ? 'Sudah Diarsipkan' : 'Anggota Aktif'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200 text-xs">
                  <div className="flex items-center gap-2 text-slate-700 min-w-0">
                    <Mail className="w-3.5 h-3.5 text-blue-900 shrink-0" />
                    <span className="truncate font-medium">
                      {targetUser.email || 'Email tersedia di Auth'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-700 min-w-0">
                    <AtSign className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate font-mono font-semibold">
                      @{targetUser.username}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <BookOpen className="w-3.5 h-3.5 text-blue-900 shrink-0" />
                    <span>
                      Pinjaman aktif: <strong className="text-slate-900">{targetActiveLoans}</strong>
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    Total riwayat peminjaman:{' '}
                    <strong className="text-slate-900">{targetTotalLoans} transaksi</strong>
                  </span>
                </div>
              </div>

              {/* Warning Box */}
              {isArchiveMode ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-950 space-y-1">
                    <p className="font-bold">
                      Penghapusan permanen dinonaktifkan untuk akun ini
                    </p>
                    <p className="leading-relaxed text-amber-900">
                      Pengunjung ini tercatat memiliki{' '}
                      <strong>{targetTotalLoans} riwayat peminjaman</strong>. Untuk menjaga
                      integritas data transaksi dan laporan bulanan perpustakaan, akun tidak
                      dihapus secara permanen, melainkan dapat{' '}
                      <strong>diarsipkan / dinonaktifkan</strong> agar tidak bisa login kembali.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-950 space-y-1">
                    <p className="font-bold">
                      Peringatan: Tindakan ini akan memengaruhi akun secara permanen
                    </p>
                    <p className="leading-relaxed text-rose-900">
                      Akun autentikasi di <strong>Supabase Auth</strong> dan data profil pada{' '}
                      <strong>public.profiles</strong> untuk pengunjung ini akan dihapus secara
                      permanen dan tidak dapat dipulihkan.
                    </p>
                  </div>
                </div>
              )}

              {/* Inline Error Message */}
              {modalError && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-100 border border-rose-300 px-3.5 py-2.5 text-xs text-rose-900 font-medium"
                >
                  {modalError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs disabled:opacity-50 transition-colors cursor-pointer"
                >
                  Batal
                </button>

                {isArchiveMode ? (
                  onArchiveUser && (
                    <button
                      type="button"
                      onClick={handleConfirmArchive}
                      disabled={isSubmitting || targetIsArchived}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Mengarsipkan...</span>
                        </>
                      ) : targetIsArchived ? (
                        <span>Akun Sudah Diarsipkan</span>
                      ) : (
                        <>
                          <Archive className="w-3.5 h-3.5" />
                          <span>Arsipkan / Nonaktifkan Akun</span>
                        </>
                      )}
                    </button>
                  )
                ) : (
                  onDeleteUser && (
                    <button
                      type="button"
                      onClick={handleConfirmDelete}
                      disabled={isSubmitting}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Menghapus...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus Pengunjung</span>
                        </>
                      )}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
