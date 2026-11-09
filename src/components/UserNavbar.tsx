import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BookOpen, Compass, BookMarked, User as UserIcon, LogOut, Menu, X, Shield } from 'lucide-react';

interface UserNavbarProps {
  activeTab: 'home' | 'catalog' | 'loans' | 'profile';
  setActiveTab: (tab: 'home' | 'catalog' | 'loans' | 'profile') => void;
  activeLoanCount?: number;
}

export const UserNavbar: React.FC<UserNavbarProps> = ({
  activeTab,
  setActiveTab,
  activeLoanCount = 0,
}) => {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'home' as const, label: 'Beranda', icon: BookOpen },
    { id: 'catalog' as const, label: 'Katalog Buku', icon: Compass },
    {
      id: 'loans' as const,
      label: 'Peminjaman Saya',
      icon: BookMarked,
      badge: activeLoanCount > 0 ? activeLoanCount : undefined,
    },
    { id: 'profile' as const, label: 'Profil Saya', icon: UserIcon },
  ];

  const handleNavClick = (tab: 'home' | 'catalog' | 'loans' | 'profile') => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand */}
        <button
          onClick={() => handleNavClick('home')}
          className="flex items-center gap-3 group text-left cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-900 to-amber-500 p-0.5 shadow-md shadow-blue-950">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5 text-amber-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-brand font-bold text-base sm:text-lg tracking-wide text-white">
                PERPUSTAKAAN MERAH PUTIH
              </span>
            </div>
            <p className="text-[11px] text-amber-400/90 font-medium tracking-wider uppercase">
              Koleksi &amp; Layanan Digital
            </p>
          </div>
        </button>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 relative cursor-pointer ${
                  isActive
                    ? 'bg-blue-900/60 text-amber-300 shadow-sm border border-amber-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-slate-950">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Status & Actions */}
        <div className="hidden md:flex items-center gap-3">
          <div className="flex items-center gap-3 pl-3 pr-1 py-1 rounded-full bg-slate-950/70 border border-slate-800">
            <div className="text-right">
              <p className="text-xs font-semibold text-white leading-tight">
                {user?.fullName || 'Pengunjung'}
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Anggota Aktif
              </span>
            </div>

            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-blue-600 flex items-center justify-center text-xs font-bold text-slate-950 shadow-inner">
              {user?.fullName?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>

          <button
            onClick={() => logout()}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800 transition-all cursor-pointer"
            title="Keluar dari Akun"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile menu trigger */}
        <div className="flex md:hidden items-center gap-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-950 border-b border-slate-800 px-4 pt-3 pb-5 space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 mb-2">
            <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center text-sm font-bold text-slate-950">
              {user?.fullName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user?.fullName}</p>
              <p className="text-xs text-slate-400 truncate">@{user?.username}</p>
            </div>
          </div>

          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-900/60 text-amber-300 border border-amber-500/30'
                      : 'text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-amber-400" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-slate-950">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-rose-950/40 text-rose-300 border border-rose-800/60 hover:bg-rose-900/40 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Keluar dari Akun</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
