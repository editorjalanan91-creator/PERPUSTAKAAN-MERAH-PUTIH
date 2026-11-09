import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen,
  LayoutDashboard,
  Layers,
  Users,
  FileBarChart,
  LogOut,
  Menu,
  X,
  Compass,
  Shield,
  Plus,
} from 'lucide-react';

export type AdminTab = 'dashboard' | 'books' | 'categories' | 'users' | 'reports';

interface AdminLayoutProps {
  currentTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  onPreviewVisitorCatalog?: () => void;
  onOpenAddBookModal: () => void;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentTab,
  onSelectTab,
  onPreviewVisitorCatalog,
  onOpenAddBookModal,
  children,
}) => {
  const { user, logout } = useAuth();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const menuItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'books' as const, label: 'Manajemen Buku', icon: BookOpen },
    { id: 'categories' as const, label: 'Kategori Buku', icon: Layers },
    { id: 'users' as const, label: 'Daftar Pengunjung', icon: Users },
    { id: 'reports' as const, label: 'Laporan Peminjaman', icon: FileBarChart },
  ];

  const handleTabClick = (tab: AdminTab) => {
    onSelectTab(tab);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Desktop Sidebar (Navy & Gold Accent) */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-950 text-white border-r border-slate-800 shrink-0 select-none">
        {/* Brand */}
        <div className="p-6 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-900 to-amber-500 p-0.5 shadow-lg shadow-blue-950">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <div>
              <h2 className="font-brand font-bold text-sm tracking-wide text-white leading-tight">
                PERPUSTAKAAN MERAH PUTIH
              </h2>
              <p className="text-[10px] font-semibold text-amber-400 tracking-wider uppercase">
                Panel Administrator
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Menu Utama
          </div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-900 text-amber-300 border border-amber-400/20 shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="pt-6 px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Pintasan Cepat
          </div>
          <button
            onClick={onOpenAddBookModal}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-amber-400" />
            <span>Tambah Buku Baru</span>
          </button>
        </div>

        {/* User Card & Logout */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/40">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-blue-900 text-amber-400 flex items-center justify-center font-bold text-xs border border-amber-400/30">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{user?.fullName || 'Admin'}</p>
              <p className="text-[10px] text-amber-400 font-medium truncate">Super Admin</p>
            </div>
          </div>

          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800 text-xs font-semibold transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Sistem</span>
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <div className="md:hidden bg-slate-950 text-white p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-900 text-amber-400 flex items-center justify-center">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-brand font-bold text-xs text-white">PERPUSTAKAAN MERAH PUTIH</h2>
            <p className="text-[9px] text-amber-400 uppercase font-semibold">Panel Admin</p>
          </div>
        </div>

        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
        >
          {mobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div className="md:hidden bg-slate-950 text-white p-4 space-y-2 border-b border-slate-800">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold ${
                  isActive
                    ? 'bg-blue-900 text-amber-300 border border-amber-400/20'
                    : 'text-slate-400 hover:bg-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 text-amber-400" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="pt-3 border-t border-slate-800">
            <button
              onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-950/40 text-rose-300 border border-rose-800/60 text-xs font-semibold"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar dari Admin</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Perpustakaan Merah Putih</span>
            <span>/</span>
            <span className="font-semibold text-slate-900 capitalize">
              {menuItems.find((m) => m.id === currentTab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {onPreviewVisitorCatalog && (
              <button
                onClick={onPreviewVisitorCatalog}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5 text-blue-900" />
                <span>Lihat Tampilan Pengunjung</span>
              </button>
            )}

            <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
              <div className="w-7 h-7 rounded-full bg-blue-900 text-amber-400 font-bold flex items-center justify-center text-xs">
                A
              </div>
              <span className="text-xs font-bold text-slate-800 hidden sm:inline">
                {user?.fullName || 'Admin'}
              </span>
            </div>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 p-6 sm:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
