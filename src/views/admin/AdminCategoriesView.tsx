import React, { useState } from 'react';
import { Category } from '../../types';
import { Layers, Plus, Edit2, Trash2, X, BookOpen } from 'lucide-react';

interface AdminCategoriesViewProps {
  categories: Category[];
  onAddCategory: (data: { name: string; description?: string }) => Promise<void>;
  onUpdateCategory: (id: string, data: { name: string; description?: string }) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
}

export const AdminCategoriesView: React.FC<AdminCategoriesViewProps> = ({
  categories,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openCreateModal = () => {
    setEditingCategory(null);
    setName('');
    setDescription('');
    setIsModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setName(cat.name);
    setDescription(cat.description || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingCategory) {
        await onUpdateCategory(editingCategory.id, { name, description });
      } else {
        await onAddCategory({ name, description });
      }
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCategory) return;
    setIsSubmitting(true);
    try {
      await onDeleteCategory(deletingCategory.id);
      setDeletingCategory(null);
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
            Manajemen Kategori Buku
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola klasifikasi tema dan kategori buku untuk memudahkan pencarian oleh pengunjung.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 py-2.5 px-4 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs shadow-md transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Kategori Baru</span>
        </button>
      </div>

      {/* Categories Grid Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Nama Kategori</th>
                <th className="py-3 px-4 font-semibold">Deskripsi</th>
                <th className="py-3 px-4 font-semibold text-center">Jumlah Buku</th>
                <th className="py-3 px-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-bold text-slate-900 text-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <span>{cat.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 max-w-sm">
                    {cat.description || '-'}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-block px-2.5 py-0.5 rounded-full font-bold text-xs bg-slate-100 text-slate-800">
                      {cat.bookCount || 0} buku
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditModal(cat)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                        title="Ubah Kategori"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingCategory(cat)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Hapus Kategori"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm">
                  {editingCategory ? 'Ubah Kategori' : 'Tambah Kategori Baru'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Kategori *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Sains & Teknologi"
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Deskripsi Kategori
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Penjelasan singkat mengenai kategori ini..."
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : 'Simpan Kategori'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingCategory && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-base text-slate-900">Konfirmasi Hapus Kategori</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Apakah Anda yakin ingin menghapus kategori{' '}
                <strong className="text-slate-900">"{deletingCategory.name}"</strong>?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleDelete}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
