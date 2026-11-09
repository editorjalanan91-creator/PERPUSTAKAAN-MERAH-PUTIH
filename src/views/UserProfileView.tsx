import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { formatDateIndo } from '../utils/libraryRules';
import {
  User,
  Mail,
  Shield,
  Key,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Save,
  LogOut,
  Lock,
} from 'lucide-react';

export const UserProfileView: React.FC = () => {
  const { user, updateUser, logout, showToast } = useAuth();

  // Profile Edit State
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Password Change State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    try {
      const res = await api.updateProfile({ fullName, email });
      updateUser(res.user);
      showToast('Profil Anda berhasil diperbarui!', 'success', 'Perubahan Tersimpan');
    } catch (err: any) {
      showToast(err.message || 'Gagal memperbarui profil.', 'error', 'Pembaruan Gagal');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('Konfirmasi password baru tidak cocok.', 'error', 'Validasi Gagal');
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.changePassword({ oldPassword, newPassword, confirmPassword });
      showToast('Password Anda berhasil diubah! Gunakan password baru untuk login berikutnya.', 'success', 'Password Diperbarui');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      showToast(err.message || 'Gagal mengubah password.', 'error', 'Perubahan Gagal');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-serif-title">
          Pengaturan Akun &amp; Profil
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Kelola informasi identitas akun anggota perpustakaan dan keamanan kata sandi Anda.
        </p>
      </div>

      {/* Account Info Card */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-950 text-white p-6 sm:p-8 rounded-3xl border border-slate-800 shadow-xl flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-3xl font-extrabold text-slate-950 shadow-lg ring-4 ring-amber-400/20 shrink-0">
          {user?.fullName?.charAt(0).toUpperCase() || 'U'}
        </div>

        <div className="flex-1 text-center sm:text-left space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-900/60 text-amber-300 border border-amber-400/30">
            <Shield className="w-3.5 h-3.5" />
            <span>Anggota Pengunjung Resmi</span>
          </div>

          <h2 className="text-2xl font-bold">{user?.fullName}</h2>
          <p className="text-xs text-slate-400 flex flex-wrap items-center justify-center sm:justify-start gap-4">
            <span>Username: <strong className="text-slate-200 font-mono">@{user?.username}</strong></span>
            <span>•</span>
            <span>Terdaftar: <strong className="text-slate-200">{formatDateIndo(user?.createdAt || '')}</strong></span>
          </p>
        </div>

        <button
          onClick={() => logout()}
          className="px-4 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>Keluar Akun</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Form Ubah Profil */}
        <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-900">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Informasi Pribadi</h3>
              <p className="text-xs text-slate-500">Perbarui nama lengkap dan alamat email Anda</p>
            </div>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Nama Lengkap
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Alamat Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/20 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Username (Permanen)
              </label>
              <input
                type="text"
                disabled
                value={user?.username || ''}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 text-sm cursor-not-allowed"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Username digunakan untuk proses login dan identifikasi keanggotaan.
              </p>
            </div>

            <button
              type="submit"
              disabled={isUpdatingProfile}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-amber-400" />
              <span>{isUpdatingProfile ? 'Menyimpan Perubahan...' : 'Simpan Perubahan Profil'}</span>
            </button>
          </form>
        </div>

        {/* Form Ganti Password */}
        <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Keamanan &amp; Password</h3>
              <p className="text-xs text-slate-500">Ganti password secara berkala untuk menjaga akun</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Password Saat Ini
              </label>
              <input
                type="password"
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Masukkan password lama"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Password Baru (Min. 6 Karakter)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Masukkan password baru"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Konfirmasi Password Baru
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ulangi password baru"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:bg-white transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isChangingPassword}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-950 text-amber-400 font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Lock className="w-4 h-4" />
              <span>{isChangingPassword ? 'Memperbarui Password...' : 'Perbarui Password'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
