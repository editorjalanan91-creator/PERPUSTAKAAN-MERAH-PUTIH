import React, { useState } from 'react';
import { Book } from '../types';
import { BookOpen, Calendar, Tag, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { getBookCoverUrl } from '../services/supabaseClient';

interface BookCardProps {
  book: Book;
  onSelect: (book: Book) => void;
  onQuickBorrow?: (book: Book) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onSelect, onQuickBorrow }) => {
  const availableCopies = book.available_copies ?? book.stock ?? 0;
  const isAvailable = availableCopies > 0;
  const [imageError, setImageError] = useState(false);

  const coverUrl = getBookCoverUrl(book.cover_path || book.coverUrl);
  const categoryName = book.category_name || (typeof book.category === 'object' ? book.category?.name : book.category) || 'Umum';
  const pubYear = book.publication_year || book.year || '-';

  return (
    <div className="group flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-xl hover:border-amber-400/40 transition-all duration-300 overflow-hidden">
      {/* Cover Image Container */}
      <div className="relative aspect-[3/4] bg-slate-900 overflow-hidden cursor-pointer" onClick={() => onSelect(book)}>
        {!imageError && coverUrl ? (
          <img
            src={coverUrl}
            alt={`Sampul buku ${book.title}`}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-blue-950 via-slate-900 to-slate-950 text-white">
            <BookOpen className="w-12 h-12 text-amber-400 mb-2 opacity-80" />
            <p className="text-xs font-semibold text-slate-300 line-clamp-2">{book.title}</p>
            <p className="text-[10px] text-slate-400 mt-1">{book.author}</p>
          </div>
        )}

        {/* Gradient shadow overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

        {/* Availability Badge */}
        <div className="absolute top-3 right-3">
          {isAvailable ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white shadow-md">
              <CheckCircle2 className="w-3 h-3" />
              <span>Tersedia ({availableCopies})</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-600 text-white shadow-md">
              <AlertTriangle className="w-3 h-3" />
              <span>Habis</span>
            </span>
          )}
        </div>

        {/* Category Badge */}
        <div className="absolute bottom-3 left-3">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-900/90 text-amber-300 border border-amber-400/20 backdrop-blur-sm shadow">
            <Tag className="w-3 h-3 text-amber-400" />
            <span>{categoryName}</span>
          </span>
        </div>
      </div>

      {/* Content Container */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h3
            onClick={() => onSelect(book)}
            className="font-bold text-slate-900 text-base leading-snug line-clamp-2 hover:text-blue-900 cursor-pointer transition-colors"
            title={book.title}
          >
            {book.title}
          </h3>
          <p className="text-xs font-medium text-slate-600 mt-1 line-clamp-1">
            Penulis: <span className="text-slate-800 font-semibold">{book.author}</span>
          </p>

          <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
            {book.description || 'Tidak ada deskripsi sinopsis.'}
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
          {/* Metadata badges */}
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
              <FileText className="w-3 h-3 text-blue-900 shrink-0" />
              <span className="truncate max-w-[130px]">{book.file_type ? book.file_type.toUpperCase() : 'Buku Fisik'}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
              <span>{pubYear}</span>
            </span>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => onSelect(book)}
              className="w-full py-2 px-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer text-center"
            >
              Detail Buku
            </button>
            <button
              type="button"
              disabled={!isAvailable}
              onClick={() => (onQuickBorrow ? onQuickBorrow(book) : onSelect(book))}
              className={`w-full py-2 px-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-center ${
                isAvailable
                  ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-sm hover:shadow-md'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isAvailable ? 'Ajukan Pinjam' : 'Kosong'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
