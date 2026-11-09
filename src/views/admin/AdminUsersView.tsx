import React, { useState } from 'react';
import { User } from '../../types';
import { formatDateIndo } from '../../utils/libraryRules';
import { Users, Trash2, Shield, Calendar, BookMarked, Search, AlertTriangle, UserCheck } from 'lucide-react';

interface AdminUsersViewProps {
  users: Array<User & { totalLoans: number; activeLoans: number }>;
  onDeleteUser: (id: string) => Promise<void>;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({ users, onDeleteUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingUser, setDeletingUser] = useState<(User & { totalLoans: number; activeLoans: number }) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredUsers = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  const handleDeleteConfirm = async () => {
    if (!deletingUser) return;
    setIsSubmitting(true);
    try {
      await onDeleteUser(deletingUser.id);
      setDeletingUser(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Manajemen Akun Pengunjung (Anggota)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Daftar seluruh pengunjung yang telah melakukan registrasi mandiri untuk meminjam koleksi buku perpustakaan.
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
            placeholder="Cari berdasarkan nama, username, atau email pengunjung..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Profil Pengunjung</th>
                  <th className="py-3 px-4 font-semibold">Username</th>
                  <th className="py-3 px-4 font-semibold">Alamat Email</th>
                  <th className="py-3 px-4 font-semibold">Tanggal Registrasi</th>
                  <th className="py-3 px-4 font-semibold text-center">Pinjaman Aktif</th>
                  <th className="py-3 px-4 font-semibold text-center">Total Riwayat</th>
                  <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-700 to-amber-500 text-slate-950 font-bold flex items-center justify-center text-xs shrink-0 shadow-sm">
                          {u.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{u.fullName}</p>
                          <span className="text-[10px] text-amber-700 font-medium">
                            ID: {u.id.slice(-8)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-700 font-medium">
                      @{u.username}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{u.email}</td>
                    <td className="py-3.5 px-4 text-slate-500">
                      {formatDateIndo(u.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full font-bold text-[11px] ${
                          u.activeLoans > 0
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {u.activeLoans} buku
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center font-semibold text-slate-700">
                      {u.totalLoans} transaksi
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setDeletingUser(u)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Hapus Akun Pengunjung"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Notice for zero dummy accounts */
          <div className="p-12 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-base text-slate-900 mb-1">
              Belum Ada Akun Pengunjung yang Mendaftar
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Sesuai dengan ketentuan sistem, tidak disediakan akun pengunjung bawaan atau contoh. Pengunjung baru yang melakukan registrasi melalui halaman pendaftaran akan otomatis tercatat dan dapat dikelola di sini.
            </p>
          </div>
        )}
      </div>

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-base text-slate-900">Konfirmasi Hapus Akun Pengunjung</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Apakah Anda yakin ingin menghapus akun pengunjung{' '}
                <strong className="text-slate-900">"{deletingUser.fullName}" (@{deletingUser.username})</strong>?
                Tindakan ini akan mencabut seluruh akses pengunjung ke perpustakaan.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm cursor-pointer disabled:opacity-50"
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
