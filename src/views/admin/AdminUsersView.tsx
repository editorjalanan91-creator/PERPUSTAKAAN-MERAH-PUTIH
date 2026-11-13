import React, { useState } from 'react';
import { Profile } from '../../types';
import { formatDateIndo } from '../../utils/libraryRules';
import { Users, Trash2, Shield, Calendar, Bookmark, Search, AlertTriangle, UserCheck } from 'lucide-react';

export interface VisitorWithStats extends Profile {
  email?: string;
  totalLoans?: number;
  activeLoans?: number;
}

interface AdminUsersViewProps {
  users: VisitorWithStats[];
  onDeleteUser?: (id: string) => Promise<void>;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({ users, onDeleteUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingUser, setDeletingUser] = useState<VisitorWithStats | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredUsers = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  });

  const handleDeleteConfirm = async () => {
    if (!deletingUser || !onDeleteUser) return;
    setIsSubmitting(true);
    try {
      await onDeleteUser(deletingUser.id);
      setDeletingUser(null);
    } catch (err: any) {
      alert(`Gagal menghapus akun pengunjung: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-brand">
            Manajemen Akun Pengunjung (Anggota)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Daftar seluruh pengunjung yang telah mendaftar mandiri dan terdaftar pada tabel Supabase profiles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 text-xs font-bold">
            Total {users.length} Pengunjung Terdaftar
          </span>
        </div>
      </div>

      {/* Search Input */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari berdasarkan nama atau username pengunjung..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200 text-[11px]">
                <tr>
                  <th className="py-3 px-4 font-semibold">Profil Pengunjung</th>
                  <th className="py-3 px-4 font-semibold">Username Anggota</th>
                  <th className="py-3 px-4 font-semibold">Tanggal Registrasi</th>
                  <th className="py-3 px-4 font-semibold text-center">Pinjaman Aktif</th>
                  <th className="py-3 px-4 font-semibold text-center">Total Riwayat</th>
                  {onDeleteUser && <th className="py-3 px-4 font-semibold text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-700 to-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow-sm">
                          {(u.full_name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{u.full_name}</p>
                          <span className="text-[10px] text-amber-700 font-medium">
                            UUID: {u.id.substring(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700 font-medium">
                      @{u.username}
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
                    {onDeleteUser && (
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setDeletingUser(u)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Hapus Akun Pengunjung"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-sm text-slate-700">Belum Ada Pengunjung Terdaftar</p>
            <p className="text-xs text-slate-400 mt-1">
              Pengunjung yang mendaftar mandiri akan muncul di tabel ini setelah akun berhasil diverifikasi.
            </p>
          </div>
        )}
      </div>

      {/* Modal Konfirmasi Hapus */}
      {deletingUser && onDeleteUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 font-brand">Hapus Akun Pengunjung?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Apakah Anda yakin ingin menghapus akun profil pengunjung <strong>"{deletingUser.full_name}"</strong>?
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs"
              >
                Batal
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
              >
                {isSubmitting ? 'Menghapus...' : 'Ya, Hapus Akun'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
