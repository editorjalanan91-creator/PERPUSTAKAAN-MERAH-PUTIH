import React, { useState, useMemo, useEffect } from 'react';
import { Book, Category } from '../../types';
import { getBookCoverUrl, uploadBookCover, uploadBookFile } from '../../services/supabaseClient';
import {
  validateBookFormInput,
  validateCoverFile,
  validateBookDocumentFile,
  recalculateBookStockOnEdit,
} from '../../utils/libraryRules';
import {
  BookOpen,
  Plus,
  Search,
  Edit2,
  Trash2,
  Archive,
  ArchiveRestore,
  FileText,
  Upload,
  X,
  AlertTriangle,
  FileUp,
} from 'lucide-react';

interface AdminBooksViewProps {
  books: Book[];
  categories: Category[];
  onAddBook: (bookData: any) => Promise<void>;
  onUpdateBook: (id: string, bookData: any) => Promise<void>;
  onDeleteBook: (id: string) => Promise<void>;
  onToggleArchive?: (id: string, isArchived: boolean) => Promise<void>;
  isAddModalOpen?: boolean;
  setIsAddModalOpen?: (open: boolean) => void;
}

export const AdminBooksView: React.FC<AdminBooksViewProps> = ({
  books,
  categories,
  onAddBook,
  onUpdateBook,
  onDeleteBook,
  onToggleArchive,
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
    publication_year: new Date().getFullYear(),
    isbn: '',
    category_id: categories[0]?.id || '',
    description: '',
    cover_path: '',
    file_path: '',
    file_type: 'pdf',
    total_copies: 5,
    is_published: true,
  };

  const [formData, setFormData] = useState(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [archivingBookId, setArchivingBookId] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null);

  // Reset state modal saat ditutup dari luar atau saat dibuka melalui pintasan sidebar/dashboard
  useEffect(() => {
    if (!isAddModalOpen) {
      setEditingBook(null);
      setFormError(null);
    } else if (!editingBook) {
      setFormData((prev) => ({
        ...prev,
        category_id: prev.category_id || categories[0]?.id || '',
      }));
    }
  }, [isAddModalOpen, editingBook, categories]);

  const filteredBooks = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return books.filter((b) => {
      const matchCat =
        selectedCategory === 'Semua' ||
        (b.category_name || '').toLowerCase() === selectedCategory.toLowerCase() ||
        b.category_id === selectedCategory;
      const matchQuery =
        !q ||
        (b.title || '').toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.isbn || '').toLowerCase().includes(q) ||
        (b.publisher || '').toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [books, searchQuery, selectedCategory]);

  const openCreateModal = () => {
    setFormData({
      ...initialFormState,
      category_id: categories[0]?.id || '',
    });
    setEditingBook(null);
    setFormError(null);
    setAddModalOpen(true);
  };

  const openEditModal = (book: Book) => {
    setEditingBook(book);
    setFormData({
      title: book.title || '',
      author: book.author || '',
      publisher: book.publisher || '',
      publication_year: book.publication_year || new Date().getFullYear(),
      isbn: book.isbn || '',
      category_id: book.category_id || categories[0]?.id || '',
      description: book.description || '',
      cover_path: book.cover_path || '',
      file_path: book.file_path || '',
      file_type: book.file_type || 'pdf',
      total_copies: book.total_copies || 1,
      is_published: book.is_published !== false,
    });
    setFormError(null);
    setAddModalOpen(true);
  };

  // Upload cover ke bucket 'book-covers'
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateCoverFile(file);
    if (!validation.valid) {
      setFormError(validation.error || 'Format gambar sampul tidak valid.');
      return;
    }

    setUploadingCover(true);
    setFormError(null);
    try {
      const coverPath = await uploadBookCover(file);
      setFormData((prev) => ({ ...prev, cover_path: coverPath }));
    } catch (err: any) {
      setFormError(`Gagal mengunggah sampul: ${err?.message || 'Terjadi kesalahan unggahan.'}`);
    } finally {
      setUploadingCover(false);
    }
  };

  // Upload PDF / EPUB ke bucket 'book-files'
  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateBookDocumentFile(file);
    if (!validation.valid) {
      setFormError(validation.error || 'Format dokumen buku tidak valid.');
      return;
    }

    setUploadingDoc(true);
    setFormError(null);
    try {
      const { filePath, fileType } = await uploadBookFile(file);
      setFormData((prev) => ({ ...prev, file_path: filePath, file_type: fileType }));
    } catch (err: any) {
      setFormError(`Gagal mengunggah dokumen buku: ${err?.message || 'Terjadi kesalahan unggahan.'}`);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const formValidation = validateBookFormInput(formData);
    if (!formValidation.valid) {
      setFormError(formValidation.error || 'Periksa kembali data formulir buku.');
      return;
    }

    let payload: Partial<Book> & typeof formData = { ...formData };
    if (editingBook) {
      const stockResult = recalculateBookStockOnEdit(
        editingBook.total_copies,
        editingBook.available_copies,
        Number(formData.total_copies)
      );
      if (!stockResult.valid) {
        setFormError(stockResult.error);
        return;
      }
      payload = {
        ...formData,
        total_copies: stockResult.totalCopies,
        available_copies: stockResult.availableCopies,
      };
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      if (editingBook) {
        await onUpdateBook(editingBook.id, payload);
      } else {
        await onAddBook(payload);
      }
      setAddModalOpen(false);
      setEditingBook(null);
      setFormData({
        ...initialFormState,
        category_id: categories[0]?.id || '',
      });
    } catch (err: any) {
      setFormError(err?.message || 'Gagal menyimpan data buku ke database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleArchiveClick = async (book: Book) => {
    if (!onToggleArchive || archivingBookId === book.id) return;
    setArchivingBookId(book.id);
    try {
      await onToggleArchive(book.id, !book.is_archived);
    } catch {
      // Toast error sudah ditangani oleh parent handler
    } finally {
      setArchivingBookId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingBook || isSubmitting) return;
    setIsSubmitting(true);
    setDeleteError(null);
    setDeleteErrorCode(null);
    try {
      await onDeleteBook(deletingBook.id);
      setDeletingBook(null);
    } catch (err: any) {
      setDeleteErrorCode(err?.code || null);
      setDeleteError(
        err?.message ||
          'Gagal menghapus buku. Jika buku memiliki riwayat peminjaman, gunakan fitur Arsipkan Buku.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveFromDeleteModal = async () => {
    if (!deletingBook || !onToggleArchive || isSubmitting) return;
    setIsSubmitting(true);
    setDeleteError(null);
    try {
      await onToggleArchive(deletingBook.id, true);
      setDeleteErrorCode(null);
      setDeletingBook(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Gagal mengarsipkan buku.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-brand">
            Manajemen Koleksi Buku
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola data buku, nomor ISBN, stok eksemplar, foto sampul (bucket public), dan dokumen PDF/EPUB (bucket private).
          </p>
        </div>

        <button
          type="button"
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
            placeholder="Cari judul, penulis, ISBN, atau penerbit..."
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

      {/* Books Table / Grid */}
      {filteredBooks.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">
            Belum Ada Koleksi Buku
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
            Katalog buku masih kosong di database Supabase. Klik tombol di bawah untuk menambahkan buku pertama beserta sampul dan file digitalnya.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Buku Pertama</span>
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Buku &amp; Penulis</th>
                  <th className="py-3 px-4">Kategori</th>
                  <th className="py-3 px-4">Penerbit &amp; Tahun</th>
                  <th className="py-3 px-4">Ketersediaan</th>
                  <th className="py-3 px-4">File Dokumen</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBooks.map((book) => {
                  const cover = getBookCoverUrl(book.cover_path);
                  return (
                    <tr key={book.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={cover}
                            alt={book.title}
                            className="w-10 h-14 object-cover rounded-lg shadow-sm border border-slate-200 bg-slate-900 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate max-w-[200px]" title={book.title}>
                              {book.title}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                              {book.author}
                            </p>
                            <span className="font-mono text-[10px] text-slate-400">
                              ISBN: {book.isbn}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                          {book.category_name || 'Umum'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <p className="font-medium">{book.publisher}</p>
                        <p className="text-[11px] text-slate-400">{book.publication_year}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            book.available_copies > 0
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {book.available_copies} / {book.total_copies} Eksemplar
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {book.file_path ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 px-2 py-0.5 rounded bg-slate-100 uppercase">
                            <FileText className="w-3 h-3 text-blue-600" />
                            {book.file_type || 'PDF'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Belum ada</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {book.is_archived ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                            Diarsipkan
                          </span>
                        ) : book.is_published === false ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                            Disembunyikan
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            Aktif
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(book)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Ubah Buku"
                          aria-label={`Ubah buku ${book.title}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {onToggleArchive && (
                          <button
                            type="button"
                            disabled={archivingBookId === book.id}
                            onClick={() => handleToggleArchiveClick(book)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-amber-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                            title={book.is_archived ? 'Pulihkan dari Arsip' : 'Arsipkan Buku'}
                            aria-label={book.is_archived ? `Pulihkan ${book.title} dari arsip` : `Arsipkan buku ${book.title}`}
                          >
                            {book.is_archived ? (
                              <ArchiveRestore className="w-3.5 h-3.5 text-amber-600" />
                            ) : (
                              <Archive className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteErrorCode(null);
                            setDeletingBook(book);
                          }}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Hapus Buku"
                          aria-label={`Hapus buku ${book.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Buku */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm sm:text-base">
                  {editingBook ? 'Ubah Data Buku' : 'Tambah Buku Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label="Tutup modal buku"
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="overflow-y-auto p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Judul Buku *</label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Contoh: Laskar Pelangi"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nama Penulis *</label>
                  <input
                    type="text"
                    required
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                    placeholder="Contoh: Andrea Hirata"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Penerbit</label>
                  <input
                    type="text"
                    value={formData.publisher}
                    onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                    placeholder="Contoh: Bentang Pustaka"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tahun Terbit</label>
                  <input
                    type="number"
                    min="1800"
                    max="2100"
                    value={formData.publication_year}
                    onChange={(e) => setFormData({ ...formData, publication_year: parseInt(e.target.value, 10) || 2026 })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor ISBN</label>
                  <input
                    type="text"
                    value={formData.isbn}
                    onChange={(e) => setFormData({ ...formData, isbn: e.target.value })}
                    placeholder="978-602-..."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori Buku *</label>
                  <select
                    required
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30 bg-white"
                  >
                    <option value="">-- Pilih Kategori --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {categories.length === 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      Belum ada kategori buku. Tambahkan kategori terlebih dahulu di menu Kategori Buku.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Total Eksemplar / Stok *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.total_copies}
                    onChange={(e) => setFormData({ ...formData, total_copies: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Sinopsis / Deskripsi Buku</label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Sinopsis singkat mengenai isi buku..."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900/30"
                  />
                </div>

                {/* File Upload Section: Storage Buckets */}
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 sm:col-span-2 space-y-3">
                  <p className="font-bold text-slate-800 uppercase tracking-wide text-[10px]">
                    Berkas Supabase Storage
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Cover Upload (Public) */}
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Foto Sampul (Bucket: book-covers)
                      </label>
                      <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl bg-white hover:bg-slate-50 cursor-pointer">
                        <Upload className="w-4 h-4 text-amber-600" />
                        <span className="truncate">
                          {uploadingCover
                            ? 'Mengunggah sampul...'
                            : formData.cover_path
                            ? 'Sampul Terunggah ✓'
                            : 'Pilih File Gambar'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCoverUpload}
                          disabled={uploadingCover}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Book Document Upload (Private) */}
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Dokumen Buku (Bucket: book-files [PDF/EPUB])
                      </label>
                      <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-xl bg-white hover:bg-slate-50 cursor-pointer">
                        <FileUp className="w-4 h-4 text-blue-600" />
                        <span className="truncate">
                          {uploadingDoc
                            ? 'Mengunggah dokumen...'
                            : formData.file_path
                            ? 'Dokumen Terunggah ✓'
                            : 'Pilih File PDF/EPUB'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.epub"
                          onChange={handleDocUpload}
                          disabled={uploadingDoc}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2 flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <input
                    id="book-is-published"
                    type="checkbox"
                    checked={formData.is_published !== false}
                    onChange={(e) => setFormData({ ...formData, is_published: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900 focus:ring-blue-900/30 cursor-pointer"
                  />
                  <label htmlFor="book-is-published" className="text-xs font-medium text-slate-700 cursor-pointer">
                    Publikasikan di Katalog Pengunjung (jika tidak dicentang, buku hanya terlihat oleh Admin)
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || uploadingCover || uploadingDoc}
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : editingBook ? 'Simpan Perubahan' : 'Tambah Buku'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {deletingBook && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Hapus Koleksi Buku?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Apakah Anda yakin ingin menghapus permanen buku <strong>"{deletingBook.title}"</strong> dari database? Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs text-left flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteErrorCode(null);
                  setDeletingBook(null);
                }}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              {deleteError &&
                (deleteErrorCode === 'BOOK_HAS_LOAN_HISTORY' || deleteErrorCode === 'BOOK_HAS_ACTIVE_LOANS') &&
                !deletingBook.is_archived &&
                onToggleArchive && (
                  <button
                    type="button"
                    onClick={handleArchiveFromDeleteModal}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Mengarsipkan...' : 'Arsipkan Buku'}</span>
                  </button>
                )}
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Menghapus...' : 'Ya, Hapus Buku'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
