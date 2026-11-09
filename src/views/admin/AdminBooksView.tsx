import React, { useState, useMemo } from 'react';
import { Book, Category } from '../../types';
import {
  BookOpen,
  Plus,
  Search,
  Edit2,
  Trash2,
  Eye,
  MapPin,
  Calendar,
  Layers,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

interface AdminBooksViewProps {
  books: Book[];
  categories: Category[];
  onAddBook: (bookData: Partial<Book>) => Promise<void>;
  onUpdateBook: (id: string, bookData: Partial<Book>) => Promise<void>;
  onDeleteBook: (id: string) => Promise<void>;
  isAddModalOpen?: boolean;
  setIsAddModalOpen?: (open: boolean) => void;
}

export const AdminBooksView: React.FC<AdminBooksViewProps> = ({
  books,
  categories,
  onAddBook,
  onUpdateBook,
  onDeleteBook,
  isAddModalOpen: controlledAddModalOpen,
  setIsAddModalOpen: setControlledAddModalOpen,
}) => {
  const [internalAddModalOpen, setInternalAddModalOpen] = useState(false);
  const isAddModalOpen = controlledAddModalOpen !== undefined ? controlledAddModalOpen : internalAddModalOpen;
  const setAddModalOpen = setControlledAddModalOpen || setInternalAddModalOpen;

  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [deletingBook, setDeletingBook] = useState<Book | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');

  // Form State
  const initialFormState = {
    title: '',
    author: '',
    publisher: '',
    year: new Date().getFullYear(),
    isbn: '',
    category: categories[0]?.name || 'Fiksi & Sastra',
    pages: 200,
    description: '',
    coverUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80',
    stock: 5,
    shelfLocation: 'Rak A-01',
  };

  const [formData, setFormData] = useState(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  const filteredBooks = useMemo(() => {
    return books.filter((b) => {
      const matchCat = selectedCategory === 'Semua' || b.category.toLowerCase() === selectedCategory.toLowerCase();
      const matchQuery =
        !searchQuery ||
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.isbn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.shelfLocation.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [books, searchQuery, selectedCategory]);

  const openCreateModal = () => {
    setFormData({
      ...initialFormState,
      category: categories[0]?.name || 'Fiksi & Sastra',
    });
    setEditingBook(null);
    setPreviewError(false);
    setAddModalOpen(true);
  };

  const openEditModal = (book: Book) => {
    setEditingBook(book);
    setFormData({
      title: book.title,
      author: book.author,
      publisher: book.publisher,
      year: book.year,
      isbn: book.isbn,
      category: book.category,
      pages: book.pages,
      description: book.description,
      coverUrl: book.coverUrl,
      stock: book.stock,
      shelfLocation: book.shelfLocation,
    });
    setPreviewError(false);
    setAddModalOpen(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, coverUrl: reader.result as string }));
        setPreviewError(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingBook) {
        await onUpdateBook(editingBook.id, formData);
      } else {
        await onAddBook(formData);
      }
      setAddModalOpen(false);
      setEditingBook(null);
    } catch {
      // Notification is handled in parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingBook) return;
    setIsSubmitting(true);
    try {
      await onDeleteBook(deletingBook.id);
      setDeletingBook(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Manajemen Koleksi Buku
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola data buku, nomor ISBN, stok eksemplar, foto sampul, dan penempatan rak perpustakaan.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 py-2.5 px-4 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs shadow-md transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Buku Baru</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul, penulis, ISBN, atau rak..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900/20"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span className="text-xs text-slate-500 shrink-0 font-medium">Kategori:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none cursor-pointer"
          >
            <option value="Semua">Semua Kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Books Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Sampul &amp; Judul Buku</th>
                <th className="py-3 px-4 font-semibold">Kategori</th>
                <th className="py-3 px-4 font-semibold">ISBN</th>
                <th className="py-3 px-4 font-semibold">Lokasi Rak</th>
                <th className="py-3 px-4 font-semibold text-center">Stok</th>
                <th className="py-3 px-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBooks.map((book) => (
                <tr key={book.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-10 h-14 object-cover rounded-lg shadow-sm bg-slate-900 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate max-w-xs">{book.title}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {book.author} • {book.publisher} ({book.year})
                        </p>
                        <p className="text-[11px] text-slate-400">{book.pages} halaman</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-900 border border-blue-200">
                      {book.category}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                    {book.isbn}
                  </td>
                  <td className="py-3.5 px-4 font-medium text-slate-700">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                      {book.shelfLocation}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full font-bold text-xs ${
                        book.stock > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {book.stock} eks
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditModal(book)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                        title="Ubah Buku"
                        aria-label="Edit buku"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingBook(book)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Hapus Buku"
                        aria-label="Hapus buku"
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

        {filteredBooks.length === 0 && (
          <div className="p-12 text-center text-slate-500 text-xs">
            {books.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 max-w-sm mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-900 flex items-center justify-center">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-800">Daftar Buku Masih Kosong</h4>
                  <p className="text-slate-500 text-xs mt-1">
                    Belum ada data buku di sistem. Administrator dapat menambahkan koleksi buku baru sekarang.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs shadow-sm cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Buku Pertama</span>
                </button>
              </div>
            ) : (
              <div>Tidak ada buku yang sesuai dengan pencarian atau filter.</div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Book Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base">
                  {editingBook ? 'Ubah Informasi Buku' : 'Tambah Buku Baru ke Katalog'}
                </h3>
              </div>
              <button
                onClick={() => setAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Title & Author */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Judul Buku *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Contoh: Laskar Pelangi"
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nama Penulis *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                    placeholder="Contoh: Andrea Hirata"
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>
              </div>

              {/* Publisher & Year */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Penerbit
                  </label>
                  <input
                    type="text"
                    value={formData.publisher}
                    onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                    placeholder="Contoh: Bentang Pustaka"
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Tahun Terbit
                  </label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value, 10) || 2026 })}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>
              </div>

              {/* ISBN, Category, Pages */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    ISBN
                  </label>
                  <input
                    type="text"
                    value={formData.isbn}
                    onChange={(e) => setFormData({ ...formData, isbn: e.target.value })}
                    placeholder="978-602-..."
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-mono focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Kategori Buku *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20 cursor-pointer"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Jumlah Halaman
                  </label>
                  <input
                    type="number"
                    value={formData.pages}
                    onChange={(e) => setFormData({ ...formData, pages: parseInt(e.target.value, 10) || 100 })}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>
              </div>

              {/* Stock & Shelf Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Stok / Jumlah Eksemplar *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value, 10) || 0 })}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Lokasi Rak Buku *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.shelfLocation}
                    onChange={(e) => setFormData({ ...formData, shelfLocation: e.target.value })}
                    placeholder="Contoh: Rak Sastra A-01"
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                  />
                </div>
              </div>

              {/* Cover Image Upload / URL & Preview */}
              <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <label className="block font-bold text-slate-700 uppercase tracking-wider">
                  Foto Sampul Buku (URL atau Unggah File)
                </label>
                <div className="flex gap-4 items-center">
                  <div className="w-16 h-22 rounded-xl bg-slate-900 overflow-hidden shadow shrink-0 border border-slate-200">
                    <img
                      src={formData.coverUrl}
                      alt="Preview Sampul"
                      onError={() => setPreviewError(true)}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      type="url"
                      value={formData.coverUrl}
                      onChange={(e) => {
                        setFormData({ ...formData, coverUrl: e.target.value });
                        setPreviewError(false);
                      }}
                      placeholder="Masukkan URL foto sampul (https://...)"
                      className="w-full p-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800"
                    />

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer">
                        <Upload className="w-3.5 h-3.5 text-blue-900" />
                        <span>Unggah File dari Komputer</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                      <span className="text-[10px] text-slate-400">JPG, PNG, atau WebP</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Deskripsi / Sinopsis Buku
                </label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Ringkasan sinopsis atau isi buku..."
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs focus:ring-2 focus:ring-blue-900/20"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting
                    ? 'Menyimpan...'
                    : editingBook
                    ? 'Simpan Perubahan Buku'
                    : 'Tambah Buku ke Koleksi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingBook && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-base text-slate-900">Konfirmasi Hapus Buku</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Apakah Anda yakin ingin menghapus buku{' '}
                <strong className="text-slate-900">"{deletingBook.title}"</strong>? Tindakan ini akan menghapus buku secara permanen dari sistem dan katalog pengunjung.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingBook(null)}
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
                {isSubmitting ? 'Menghapus...' : 'Ya, Hapus Buku Ini'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
