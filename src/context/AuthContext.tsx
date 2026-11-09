import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types';
import { api, tokenStorage } from '../services/api';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  isUser: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
  // Notifications
  toasts: ToastMessage[];
  showToast: (message: string, type?: 'success' | 'error' | 'info', title?: string) => void;
  dismissToast: (id: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(tokenStorage.get());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success', title?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { id, message, type, title };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      dismissToast(id);
    }, 4500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Bootstrap check on mount
  useEffect(() => {
    const bootstrap = async () => {
      const storedToken = tokenStorage.get();
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const { user: currentUser } = await api.getMe();
        setUser(currentUser);
        setToken(storedToken);
      } catch (err) {
        console.warn('Sesi login kedaluwarsa atau tidak valid:', err);
        tokenStorage.remove();
        setUser(null);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, []);

  const login = async (username: string, password: string): Promise<User> => {
    const res = await api.login(username, password);
    setUser(res.user);
    setToken(res.token);
    showToast(
      res.user.role === 'admin'
        ? 'Selamat datang di Panel Admin Perpustakaan!'
        : `Selamat datang kembali, ${res.user.fullName}!`,
      'success',
      'Login Berhasil'
    );
    return res.user;
  };

  const register = async (payload: {
    fullName: string;
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<User> => {
    const res = await api.register(payload);
    setUser(res.user);
    setToken(res.token);
    showToast(
      `Pendaftaran berhasil! Selamat datang di Perpustakaan Merah Putih, ${res.user.fullName}.`,
      'success',
      'Akun Berhasil Dibuat'
    );
    return res.user;
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setToken(null);
    showToast('Anda telah keluar dari akun.', 'info', 'Logout Berhasil');
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const isAdmin = user?.role === 'admin';
  const isUser = user?.role === 'user';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin,
        isUser,
        login,
        register,
        logout,
        updateUser,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
