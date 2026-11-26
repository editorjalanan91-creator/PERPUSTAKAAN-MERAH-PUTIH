import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ePub, { Book as EpubJsBook, Contents, Rendition } from 'epubjs';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  List,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sun,
  Moon,
  BookText,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Book } from '../types';
import { useAuth } from '../context/AuthContext';
import { libraryService } from '../services/libraryService';
import {
  FlattenedTocItem,
  flattenTocItems,
  hasPdfMagicBytes,
  inspectAndValidateEpubArchive,
} from '../utils/epubUtils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ReaderTheme = 'light' | 'sepia' | 'dark';
type EpubFlowMode = 'paginated' | 'scrolled-doc';

interface PdfOutlineTocItem {
  id: string;
  label: string;
  pageNumber: number | null;
  depth: number;
}

interface BookReaderViewProps {
  bookId: string;
  initialBook?: Book | null;
  onBack: () => void;
}

const MIN_ZOOM = 60;
const MAX_ZOOM = 200;
const ZOOM_STEP = 15;

const THEME_CONFIG: Record<
  ReaderTheme,
  {
    label: string;
    containerBg: string;
    surfaceBg: string;
    textClass: string;
    epubBodyCss: Record<string, string>;
  }
> = {
  light: {
    label: 'Terang',
    containerBg: 'bg-slate-100',
    surfaceBg: 'bg-white border-slate-200 text-slate-900',
    textClass: 'text-slate-900',
    epubBodyCss: {
      background: '#ffffff',
      color: '#0f172a',
    },
  },
  sepia: {
    label: 'Sepia',
    containerBg: 'bg-amber-50/70',
    surfaceBg: 'bg-[#fbf4e4] border-amber-200 text-[#433422]',
    textClass: 'text-[#433422]',
    epubBodyCss: {
      background: '#fbf4e4',
      color: '#433422',
    },
  },
  dark: {
    label: 'Gelap',
    containerBg: 'bg-slate-950',
    surfaceBg: 'bg-slate-900 border-slate-800 text-slate-100',
    textClass: 'text-slate-100',
    epubBodyCss: {
      background: '#0f172a',
      color: '#e2e8f0',
    },
  },
};

async function flattenPdfOutline(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  items: any[] | null | undefined,
  depth = 0
): Promise<PdfOutlineTocItem[]> {
  if (!Array.isArray(items) || items.length === 0) return [];
  const result: PdfOutlineTocItem[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    const label = String(entry?.title || '').trim();
    let pageNumber: number | null = null;

    try {
      let dest = entry?.dest;
      if (typeof dest === 'string') {
        dest = await pdfDoc.getDestination(dest);
      }
      if (Array.isArray(dest) && dest[0]) {
        const pageIndex = await pdfDoc.getPageIndex(dest[0]);
        if (typeof pageIndex === 'number' && pageIndex >= 0) {
          pageNumber = pageIndex + 1;
        }
      }
    } catch {
      pageNumber = null;
    }

    if (label) {
      result.push({
        id: `pdf-toc-${depth}-${i}-${pageNumber ?? 'none'}`,
        label,
        pageNumber,
        depth,
      });
    }

    if (Array.isArray(entry?.items) && entry.items.length > 0) {
      const children = await flattenPdfOutline(pdfDoc, entry.items, depth + 1);
      result.push(...children);
    }
  }

  return result;
}

export const BookReaderView: React.FC<BookReaderViewProps> = ({
  bookId,
  initialBook,
  onBack,
}) => {
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  const [docFormat, setDocFormat] = useState<'epub' | 'pdf' | null>(null);
  const [bookMeta, setBookMeta] = useState<Partial<Book> | null>(initialBook ?? null);

  // Shared reader presentation state
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const [theme, setTheme] = useState<ReaderTheme>('light');
  const [isTocOpen, setIsTocOpen] = useState<boolean>(false);
  const [isRenderingPage, setIsRenderingPage] = useState<boolean>(false);

  // EPUB reader state
  const [tocItems, setTocItems] = useState<FlattenedTocItem[]>([]);
  const [activeHref, setActiveHref] = useState<string>('');
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>(0);
  const [totalChapters, setTotalChapters] = useState<number>(0);
  const [currentPageLabel, setCurrentPageLabel] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [flowMode, setFlowMode] = useState<EpubFlowMode>('paginated');

  // PDF.js reader state
  const [pdfPageNumber, setPdfPageNumber] = useState<number>(1);
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0);
  const [pdfPageInput, setPdfPageInput] = useState<string>('1');
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineTocItem[]>([]);
  const [pdfViewportTick, setPdfViewportTick] = useState<number>(0);

  const epubContainerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<EpubJsBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const pdfViewportRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfLoadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const pdfRenderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const themeRef = useRef<ReaderTheme>(theme);
  const zoomRef = useRef<number>(zoomPercent);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    zoomRef.current = zoomPercent;
  }, [zoomPercent]);

  useEffect(() => {
    setPdfPageInput(String(pdfPageNumber));
  }, [pdfPageNumber]);

  const watermarkText = useMemo(() => {
    const identity = user?.full_name || user?.username || 'Pengunjung Terverifikasi';
    const emailPart = user?.email ? ` • ${user.email}` : '';
    return `${identity}${emailPart} • PERPUSTAKAAN MERAH PUTIH`;
  }, [user]);

  // Cegah pintasan simpan/cetak dan dukung navigasi panah keyboard untuk EPUB maupun PDF
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isInput) return;

      if (docFormat === 'epub' && renditionRef.current) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          void renditionRef.current.next();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          void renditionRef.current.prev();
        }
      } else if (docFormat === 'pdf' && pdfTotalPages > 0) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPdfPageNumber((prev) => Math.min(pdfTotalPages, prev + 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPdfPageNumber((prev) => Math.max(1, prev - 1));
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [docFormat, pdfTotalPages]);

  // Helper untuk menerapkan tema & zoom pada instance epubjs aktif
  const applyEpubPresentation = useCallback(
    (rendition: Rendition, targetTheme: ReaderTheme, targetZoom: number) => {
      const palette = THEME_CONFIG[targetTheme].epubBodyCss;
      rendition.themes.default({
        'html, body': {
          background: `${palette.background} !important`,
          color: `${palette.color} !important`,
          'font-family': "'Plus Jakarta Sans', Georgia, serif !important",
          'line-height': '1.75 !important',
          'user-select': 'none !important',
          '-webkit-user-select': 'none !important',
          '-webkit-touch-callout': 'none !important',
          'overflow-wrap': 'break-word !important',
          'word-wrap': 'break-word !important',
        },
        'img, svg, video, table': {
          'max-width': '100% !important',
          height: 'auto !important',
        },
        a: {
          color: targetTheme === 'dark' ? '#fbbf24 !important' : '#1e3a8a !important',
        },
        '@media print': {
          'html, body': {
            display: 'none !important',
          },
        },
      });
      rendition.themes.fontSize(`${targetZoom}%`);
    },
    []
  );

  useEffect(() => {
    if (renditionRef.current) {
      applyEpubPresentation(renditionRef.current, theme, zoomPercent);
    }
  }, [theme, zoomPercent, applyEpubPresentation]);

  // Sinkronkan mode aliran EPUB (paginated vs scrolled-doc)
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || docFormat !== 'epub') return;
    try {
      rendition.flow(flowMode);
      const container = epubContainerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        rendition.resize(container.clientWidth, container.clientHeight);
      }
    } catch {
      // Abaikan jika rendition sedang dibersihkan
    }
  }, [flowMode, docFormat]);

  // ResizeObserver agar layout EPUB dan PDF selalu menyesuaikan HP, tablet, desktop, & drawer TOC
  useEffect(() => {
    const targetEl = docFormat === 'epub' ? epubContainerRef.current : pdfViewportRef.current;
    if (!targetEl || !docFormat) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (docFormat === 'epub') {
          const rendition = renditionRef.current;
          const el = epubContainerRef.current;
          if (!rendition || !el) return;
          if (el.clientWidth > 0 && el.clientHeight > 0) {
            try {
              rendition.resize(el.clientWidth, el.clientHeight);
            } catch {
              // ignore
            }
          }
        } else if (docFormat === 'pdf') {
          setPdfViewportTick((t) => t + 1);
        }
      }, 120);
    };

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    observer?.observe(targetEl);
    window.addEventListener('resize', handleResize);

    return () => {
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [docFormat, isTocOpen]);

  // Muat dokumen terverifikasi dari backend proxy /api/books/:id/content
  useEffect(() => {
    let cancelled = false;

    const cleanupEpub = () => {
      if (renditionRef.current) {
        try {
          renditionRef.current.destroy();
        } catch {
          // ignore
        }
        renditionRef.current = null;
      }
      if (epubBookRef.current) {
        try {
          epubBookRef.current.destroy();
        } catch {
          // ignore
        }
        epubBookRef.current = null;
      }
      if (epubContainerRef.current) {
        epubContainerRef.current.innerHTML = '';
      }
    };

    const cleanupPdf = async () => {
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        pdfRenderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        try {
          await pdfDocRef.current.cleanup();
        } catch {
          // ignore
        }
        pdfDocRef.current = null;
      }
      if (pdfLoadingTaskRef.current) {
        try {
          await pdfLoadingTaskRef.current.destroy();
        } catch {
          // ignore
        }
        pdfLoadingTaskRef.current = null;
      }
    };

    const loadDocument = async () => {
      cleanupEpub();
      await cleanupPdf();
      setIsLoading(true);
      setErrorMessage(null);
      setErrorCode(null);
      setTocItems([]);
      setPdfOutline([]);
      setActiveHref('');
      setCurrentChapterIndex(0);
      setTotalChapters(0);
      setCurrentPageLabel('');
      setProgressPercent(0);
      setPdfPageNumber(1);
      setPdfTotalPages(0);
      setDocFormat(null);

      try {
        const result = await libraryService.fetchBookDocumentContent(bookId);
        if (cancelled) return;

        if (result.book) {
          setBookMeta((prev) => ({
            ...prev,
            ...result.book,
          }));
        }

        if (result.fileType === 'pdf') {
          if (!hasPdfMagicBytes(result.arrayBuffer)) {
            setErrorCode('INVALID_PDF_FILE');
            setErrorMessage('Berkas PDF rusak atau tidak valid untuk ditampilkan.');
            setIsLoading(false);
            return;
          }

          const loadingTask = pdfjsLib.getDocument({
            data: new Uint8Array(result.arrayBuffer),
          });
          pdfLoadingTaskRef.current = loadingTask;
          const pdfDoc = await Promise.race([
            loadingTask.promise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Waktu muat dokumen PDF habis. Berkas mungkin terlalu besar atau rusak.')),
                25000
              )
            ),
          ]);

          if (cancelled) {
            await pdfDoc.cleanup().catch(() => undefined);
            await loadingTask.destroy().catch(() => undefined);
            return;
          }

          pdfDocRef.current = pdfDoc;
          setPdfTotalPages(pdfDoc.numPages || 1);
          setPdfPageNumber(1);

          try {
            const rawOutline = await pdfDoc.getOutline();
            if (!cancelled && rawOutline) {
              const parsedOutline = await flattenPdfOutline(pdfDoc, rawOutline);
              if (!cancelled) setPdfOutline(parsedOutline);
            }
          } catch {
            // PDF tanpa daftar isi/bookmark tetap bisa dibaca per halaman
          }

          setDocFormat('pdf');
          setIsLoading(false);
          return;
        }

        // Validasi pre-flight arsip EPUB sebelum diserahkan ke epubjs
        const inspection = await inspectAndValidateEpubArchive(result.arrayBuffer);
        if (cancelled) return;

        if (!inspection.valid) {
          setErrorCode(inspection.code || 'INVALID_EPUB_FILE');
          setErrorMessage(
            inspection.error || 'Berkas EPUB rusak atau strukturnya tidak valid.'
          );
          setIsLoading(false);
          return;
        }

        setBookMeta((prev) => ({
          ...prev,
          title: prev?.title || inspection.title || 'Buku Digital EPUB',
          author: prev?.author || inspection.creator || 'Penulis',
        }));

        setDocFormat('epub');

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (cancelled) return;

        const mountEl = epubContainerRef.current;
        if (!mountEl) {
          throw new Error('Wadah pembaca EPUB belum siap di halaman.');
        }

        mountEl.innerHTML = '';
        const epubBook = ePub(result.arrayBuffer);
        epubBookRef.current = epubBook;

        await Promise.race([
          epubBook.ready,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Waktu muat struktur EPUB habis. Berkas mungkin rusak.')),
              20000
            )
          ),
        ]);
        if (cancelled) {
          cleanupEpub();
          return;
        }

        const spineItems = (epubBook.spine as any)?.spineItems || [];
        const spineCount = Array.isArray(spineItems)
          ? spineItems.length
          : inspection.spineCount || 0;
        setTotalChapters(spineCount);

        try {
          const navigation = await epubBook.loaded.navigation;
          if (!cancelled && navigation?.toc) {
            setTocItems(flattenTocItems(navigation.toc));
          }
        } catch {
          // Navigasi spine tetap tersedia walau TOC kosong
        }

        const rendition = epubBook.renderTo(mountEl, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: flowMode,
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents: Contents) => {
          const doc = contents?.document;
          if (!doc) return;
          doc.addEventListener('contextmenu', (ev) => ev.preventDefault());
          doc.addEventListener('copy', (ev) => ev.preventDefault());
          doc.addEventListener('keydown', (ev) => {
            if ((ev.ctrlKey || ev.metaKey) && ['p', 's', 'u', 'c'].includes(ev.key.toLowerCase())) {
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
            if (ev.key === 'ArrowRight') {
              ev.preventDefault();
              void rendition.next();
            } else if (ev.key === 'ArrowLeft') {
              ev.preventDefault();
              void rendition.prev();
            }
          });
        });

        rendition.on('relocated', (location: any) => {
          if (cancelled) return;
          const startLoc = location?.start;
          if (!startLoc) return;

          const idx = typeof startLoc.index === 'number' ? startLoc.index : 0;
          setCurrentChapterIndex(idx);
          if (startLoc.href) {
            setActiveHref(String(startLoc.href));
          }

          const displayedPage = startLoc.displayed?.page;
          const displayedTotal = startLoc.displayed?.total;
          if (
            typeof displayedPage === 'number' &&
            typeof displayedTotal === 'number' &&
            displayedTotal > 0
          ) {
            setCurrentPageLabel(`Hal. ${displayedPage} / ${displayedTotal}`);
          } else {
            setCurrentPageLabel('');
          }

          if (typeof startLoc.percentage === 'number' && startLoc.percentage >= 0) {
            setProgressPercent(Math.min(100, Math.max(0, Math.round(startLoc.percentage * 100))));
          } else if (spineCount > 0) {
            setProgressPercent(Math.min(100, Math.round(((idx + 1) / spineCount) * 100)));
          }
        });

        applyEpubPresentation(rendition, themeRef.current, zoomRef.current);

        await rendition.display();
        if (cancelled) {
          cleanupEpub();
          return;
        }

        void epubBook.locations?.generate?.(1200).catch(() => undefined);
        setIsLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        cleanupEpub();
        await cleanupPdf();
        setErrorCode(err?.code || 'READER_LOAD_ERROR');
        setErrorMessage(
          err?.message ||
            'Gagal memuat buku digital. Periksa koneksi Anda atau hubungi administrator perpustakaan.'
        );
        setIsLoading(false);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
      cleanupEpub();
      void cleanupPdf();
    };
  }, [bookId, retryCount, applyEpubPresentation]);

  // Render halaman PDF aktif ke canvas internal menggunakan PDF.js
  useEffect(() => {
    if (docFormat !== 'pdf' || isLoading || errorMessage) return;
    const pdfDoc = pdfDocRef.current;
    const canvas = pdfCanvasRef.current;
    const viewportContainer = pdfViewportRef.current;
    if (!pdfDoc || !canvas || !viewportContainer) return;

    let cancelled = false;

    const renderPdfPage = async () => {
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        pdfRenderTaskRef.current = null;
      }

      setIsRenderingPage(true);
      try {
        const safePage = Math.min(Math.max(1, pdfPageNumber), pdfDoc.numPages || 1);
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(240, (viewportContainer.clientWidth || 720) - 32);
        const baseFitScale = Math.min(1.65, availableWidth / unscaledViewport.width);
        const targetScale = Math.max(0.35, baseFitScale * (zoomPercent / 100));
        const viewport = page.getViewport({ scale: targetScale });

        // Batasi rasio piksel untuk stabilitas memori canvas pada iPhone / Android
        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const renderTask = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          background: '#ffffff',
        });
        pdfRenderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!cancelled && pdfViewportRef.current) {
          pdfViewportRef.current.scrollTop = 0;
        }
      } catch (err: any) {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        setErrorCode('INVALID_PDF_FILE');
        setErrorMessage('Halaman PDF gagal dirender. Berkas mungkin rusak atau tidak didukung.');
      } finally {
        if (!cancelled) {
          setIsRenderingPage(false);
        }
      }
    };

    void renderPdfPage();

    return () => {
      cancelled = true;
      if (pdfRenderTaskRef.current) {
        try {
          pdfRenderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        pdfRenderTaskRef.current = null;
      }
    };
  }, [docFormat, isLoading, errorMessage, pdfPageNumber, zoomPercent, pdfViewportTick]);

  const handleNavigatePrevPage = async () => {
    if (docFormat === 'pdf') {
      setPdfPageNumber((p) => Math.max(1, p - 1));
      return;
    }
    const rendition = renditionRef.current;
    if (!rendition || isRenderingPage) return;
    setIsRenderingPage(true);
    try {
      await rendition.prev();
    } catch {
      // ignore
    } finally {
      setIsRenderingPage(false);
    }
  };

  const handleNavigateNextPage = async () => {
    if (docFormat === 'pdf') {
      setPdfPageNumber((p) => Math.min(Math.max(1, pdfTotalPages), p + 1));
      return;
    }
    const rendition = renditionRef.current;
    if (!rendition || isRenderingPage) return;
    setIsRenderingPage(true);
    try {
      await rendition.next();
    } catch {
      // ignore
    } finally {
      setIsRenderingPage(false);
    }
  };

  const handleNavigateChapterOffset = async (offset: -1 | 1) => {
    const rendition = renditionRef.current;
    const epubBook = epubBookRef.current;
    if (!rendition || !epubBook || isRenderingPage) return;

    const spineItems = ((epubBook.spine as any)?.spineItems || []) as Array<{ href?: string }>;
    const targetIdx = currentChapterIndex + offset;
    if (targetIdx < 0 || targetIdx >= spineItems.length) return;

    const targetHref = spineItems[targetIdx]?.href;
    if (!targetHref) return;

    setIsRenderingPage(true);
    try {
      await rendition.display(targetHref);
    } catch {
      // ignore
    } finally {
      setIsRenderingPage(false);
    }
  };

  const handleSelectTocItem = async (href: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    setIsRenderingPage(true);
    try {
      await rendition.display(href);
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setIsTocOpen(false);
      }
    } catch {
      // ignore
    } finally {
      setIsRenderingPage(false);
    }
  };

  const handleSelectPdfOutline = (pageNumber: number | null) => {
    if (!pageNumber || pageNumber < 1) return;
    setPdfPageNumber(Math.min(Math.max(1, pdfTotalPages), pageNumber));
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsTocOpen(false);
    }
  };

  const handleCommitPdfPageInput = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(pdfPageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPdfPageInput(String(pdfPageNumber));
      return;
    }
    const clamped = Math.min(Math.max(1, pdfTotalPages || 1), Math.max(1, parsed));
    setPdfPageNumber(clamped);
    setPdfPageInput(String(clamped));
  };

  const activeThemeStyle = THEME_CONFIG[theme];
  const displayTitle = bookMeta?.title || 'Pembaca Buku Digital';
  const displayAuthor = bookMeta?.author || 'Perpustakaan Merah Putih';
  const pdfProgressPercent =
    pdfTotalPages > 0 ? Math.round((pdfPageNumber / pdfTotalPages) * 100) : 0;
  const showTocButton =
    docFormat === 'epub' || (docFormat === 'pdf' && pdfOutline.length > 0);

  return (
    <div
      className={`min-h-screen h-screen flex flex-col overflow-hidden select-none print:hidden ${activeThemeStyle.containerBg}`}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="book-reader-root"
    >
      {/* Top Reader Toolbar */}
      <header className="shrink-0 bg-slate-900 text-white border-b border-slate-800 px-3 sm:px-5 py-2.5 z-30">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Back & Book Info */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              aria-label="Kembali ke perpustakaan"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Kembali</span>
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm font-bold text-white truncate max-w-[160px] sm:max-w-md">
                  {displayTitle}
                </h1>
                {docFormat && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-400/30 shrink-0">
                    {docFormat}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[190px] sm:max-w-md">
                {displayAuthor}
                {bookMeta?.publication_year ? ` • ${bookMeta.publication_year}` : ''}
              </p>
            </div>
          </div>

          {/* Right: Reader Controls (NO Download / NO Print buttons) */}
          {!isLoading && !errorMessage && docFormat && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
              {showTocButton && (
                <button
                  type="button"
                  onClick={() => setIsTocOpen((prev) => !prev)}
                  aria-expanded={isTocOpen}
                  aria-label="Buka atau tutup daftar isi"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    isTocOpen
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-100'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Daftar Isi</span>
                </button>
              )}

              {/* Shared Zoom Controls (EPUB & PDF.js) */}
              <div className="inline-flex items-center rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setZoomPercent((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
                  disabled={zoomPercent <= MIN_ZOOM}
                  aria-label="Perkecil tampilan dokumen"
                  className="px-2 py-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomPercent(100)}
                  aria-label="Reset zoom ke 100 persen"
                  className="px-2 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-slate-700 cursor-pointer min-w-[44px] text-center"
                >
                  {zoomPercent}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoomPercent((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
                  disabled={zoomPercent >= MAX_ZOOM}
                  aria-label="Perbesar tampilan dokumen"
                  className="px-2 py-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Theme Controls */}
              <div className="inline-flex items-center rounded-xl bg-slate-800 border border-slate-700 p-0.5">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  aria-label="Tema Terang"
                  title="Tema Terang"
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    theme === 'light' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('sepia')}
                  aria-label="Tema Sepia"
                  title="Tema Sepia"
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    theme === 'sepia'
                      ? 'bg-amber-200 text-amber-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <BookText className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  aria-label="Tema Gelap"
                  title="Tema Gelap"
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    theme === 'dark'
                      ? 'bg-slate-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* EPUB Flow Mode Switch */}
              {docFormat === 'epub' && (
                <button
                  type="button"
                  onClick={() =>
                    setFlowMode((prev) =>
                      prev === 'paginated' ? 'scrolled-doc' : 'paginated'
                    )
                  }
                  className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span>{flowMode === 'paginated' ? 'Mode Halaman' : 'Mode Gulir'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Reader Body */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden">
        {/* TOC Drawer / Sidebar for EPUB & PDF Outline */}
        {showTocButton && isTocOpen && !isLoading && !errorMessage && (
          <aside
            aria-label="Daftar isi buku"
            className="absolute lg:static inset-y-0 left-0 z-20 w-72 sm:w-80 bg-white border-r border-slate-200 shadow-2xl lg:shadow-none flex flex-col"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <List className="w-4 h-4 text-blue-900" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Daftar Isi ({docFormat === 'epub' ? tocItems.length : pdfOutline.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsTocOpen(false)}
                aria-label="Tutup daftar isi"
                className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {docFormat === 'epub' ? (
                tocItems.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 text-center">
                    Buku EPUB ini tidak menyertakan daftar isi terpisah. Gunakan tombol bab/halaman di bawah untuk bernavigasi.
                  </div>
                ) : (
                  tocItems.map((item) => {
                    const normalizedActive = activeHref.split('#')[0];
                    const normalizedItem = item.href.split('#')[0];
                    const isActive =
                      Boolean(normalizedActive) &&
                      (normalizedActive === normalizedItem ||
                        normalizedActive.endsWith(normalizedItem) ||
                        normalizedItem.endsWith(normalizedActive));

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleSelectTocItem(item.href)}
                        style={{ paddingLeft: `${12 + Math.min(item.depth, 3) * 14}px` }}
                        className={`w-full text-left pr-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-blue-900 text-white font-bold shadow-sm'
                            : 'text-slate-700 hover:bg-slate-100 font-medium'
                        }`}
                      >
                        <span className="line-clamp-2">{item.label}</span>
                      </button>
                    );
                  })
                )
              ) : (
                pdfOutline.map((item) => {
                  const isActive = item.pageNumber === pdfPageNumber;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!item.pageNumber}
                      onClick={() => handleSelectPdfOutline(item.pageNumber)}
                      style={{ paddingLeft: `${12 + Math.min(item.depth, 3) * 14}px` }}
                      className={`w-full text-left pr-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer disabled:opacity-50 ${
                        isActive
                          ? 'bg-blue-900 text-white font-bold shadow-sm'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <span className="line-clamp-2">{item.label}</span>
                      {item.pageNumber && (
                        <span
                          className={`text-[10px] shrink-0 ${
                            isActive ? 'text-amber-300' : 'text-slate-400'
                          }`}
                        >
                          Hal. {item.pageNumber}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Document Viewport */}
        <main className="flex-1 min-w-0 min-h-0 relative flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden">
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 text-white px-6 text-center">
              <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-4" />
              <h2 className="text-sm sm:text-base font-bold">Menyiapkan Pembaca Buku Digital</h2>
              <p className="text-xs text-slate-300 mt-1 max-w-md">
                Memverifikasi hak akses peminjaman dan memuat konten buku dari penyimpanan privat secara aman...
              </p>
            </div>
          )}

          {/* Error State */}
          {!isLoading && errorMessage && (
            <div className="w-full max-w-lg bg-white rounded-3xl border border-rose-200 shadow-xl p-6 sm:p-8 text-center space-y-4 z-10">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                  {errorCode === 'FORBIDDEN' ||
                  errorCode === 'LOAN_EXPIRED' ||
                  errorCode === 'LOAN_DUE_DATE_REQUIRED' ||
                  errorCode === 'LOAN_DUE_DATE_INVALID'
                    ? 'Akses Baca Buku Ditolak'
                    : 'Dokumen Tidak Dapat Dibuka'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
                  {errorMessage}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Daftar</span>
                </button>
                {errorCode !== 'FORBIDDEN' &&
                  errorCode !== 'LOAN_EXPIRED' &&
                  errorCode !== 'LOAN_DUE_DATE_REQUIRED' &&
                  errorCode !== 'LOAN_DUE_DATE_INVALID' && (
                    <button
                      type="button"
                      onClick={() => setRetryCount((c) => c + 1)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Coba Muat Ulang</span>
                    </button>
                  )}
              </div>
            </div>
          )}

          {/* EPUB Surface (EPUB.js) */}
          <div
            className={`relative w-full max-w-5xl flex-1 min-h-0 rounded-2xl border shadow-lg overflow-hidden ${
              docFormat === 'epub' && !errorMessage ? 'flex flex-col' : 'hidden'
            } ${activeThemeStyle.surfaceBg}`}
          >
            <div
              ref={epubContainerRef}
              data-testid="epub-canvas-container"
              className="w-full flex-1 min-h-0 overflow-hidden"
            />

            {/* Subtle Non-blocking Watermark Overlay */}
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-0 z-10 overflow-hidden flex flex-col justify-between p-4 opacity-20"
            >
              <div className="flex justify-between items-center text-[10px] font-mono tracking-wide text-slate-500">
                <span>{watermarkText}</span>
                <span>BACA INTERNAL</span>
              </div>
              <div className="text-center -rotate-12 text-xs sm:text-sm font-bold tracking-widest text-slate-400/70">
                {watermarkText}
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono tracking-wide text-slate-500">
                <span>KOLEKSI TERPROTEKSI</span>
                <span>{watermarkText}</span>
              </div>
            </div>
          </div>

          {/* PDF Surface (PDF.js Canvas — NO browser native PDF viewer / NO iframe / NO download toolbar) */}
          <div
            className={`relative w-full max-w-5xl flex-1 min-h-0 rounded-2xl border shadow-lg overflow-hidden ${
              docFormat === 'pdf' && !errorMessage ? 'flex flex-col' : 'hidden'
            } ${activeThemeStyle.surfaceBg}`}
          >
            <div
              ref={pdfViewportRef}
              data-testid="pdf-canvas-viewport"
              className="w-full flex-1 min-h-0 overflow-auto p-3 sm:p-5 flex items-start justify-center"
            >
              <div className="relative inline-block shadow-md bg-white rounded-sm overflow-hidden">
                <canvas
                  ref={pdfCanvasRef}
                  data-testid="pdf-canvas"
                  className="block max-w-none"
                  onContextMenu={(e) => e.preventDefault()}
                  onDragStart={(e) => e.preventDefault()}
                />

                {/* Watermark Overlay directly on rendered PDF page */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none absolute inset-0 z-10 overflow-hidden flex flex-col justify-between p-3 sm:p-5 opacity-25"
                >
                  <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-mono tracking-wide text-slate-700">
                    <span>{watermarkText}</span>
                    <span>BACA INTERNAL</span>
                  </div>
                  <div className="text-center -rotate-12 text-xs sm:text-base font-extrabold tracking-widest text-slate-600/70">
                    {watermarkText}
                  </div>
                  <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-mono tracking-wide text-slate-700">
                    <span>KOLEKSI TERPROTEKSI</span>
                    <span>{watermarkText}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Bottom Navigation Bar for EPUB & PDF */}
      {!isLoading && !errorMessage && docFormat && (
        <footer className="shrink-0 bg-slate-900 text-white border-t border-slate-800 px-3 sm:px-5 py-2.5 z-30">
          {docFormat === 'epub' ? (
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleNavigateChapterOffset(-1)}
                  disabled={isRenderingPage || currentChapterIndex <= 0}
                  aria-label="Bab sebelumnya"
                  title="Bab sebelumnya"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Bab Sebelumnya</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleNavigatePrevPage()}
                  disabled={isRenderingPage}
                  aria-label="Halaman sebelumnya"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Sebelumnya</span>
                </button>
              </div>

              <div className="text-center text-[11px] sm:text-xs text-slate-300 px-2 truncate">
                <span className="font-bold text-amber-300">
                  {totalChapters > 0
                    ? `Bab ${Math.min(totalChapters, currentChapterIndex + 1)} / ${totalChapters}`
                    : 'Membaca EPUB'}
                </span>
                {currentPageLabel && (
                  <span className="hidden sm:inline text-slate-400"> • {currentPageLabel}</span>
                )}
                <span className="text-slate-400"> • {progressPercent}%</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleNavigateNextPage()}
                  disabled={isRenderingPage}
                  aria-label="Halaman berikutnya"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                >
                  <span>Berikutnya</span>
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => void handleNavigateChapterOffset(1)}
                  disabled={
                    isRenderingPage ||
                    totalChapters === 0 ||
                    currentChapterIndex >= totalChapters - 1
                  }
                  aria-label="Bab berikutnya"
                  title="Bab berikutnya"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <span className="hidden md:inline">Bab Berikutnya</span>
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setPdfPageNumber(1)}
                  disabled={pdfPageNumber <= 1}
                  aria-label="Halaman pertama"
                  title="Halaman pertama"
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Pertama</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleNavigatePrevPage()}
                  disabled={pdfPageNumber <= 1}
                  aria-label="Halaman sebelumnya"
                  className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-xs font-bold text-white disabled:opacity-40 cursor-pointer whitespace-nowrap"
                >
                  <ChevronLeft className="w-4 h-4 shrink-0" />
                  <span>Sebelumnya</span>
                </button>
              </div>

              <form
                onSubmit={handleCommitPdfPageInput}
                className="flex items-center justify-center gap-1 text-[11px] sm:text-xs text-slate-300 whitespace-nowrap shrink-0"
              >
                <span className="text-slate-400">Hal.</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, pdfTotalPages)}
                  value={pdfPageInput}
                  onChange={(e) => setPdfPageInput(e.target.value)}
                  onBlur={handleCommitPdfPageInput}
                  aria-label="Nomor halaman PDF"
                  className="w-11 sm:w-12 px-1 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-center text-xs font-bold text-amber-300 focus:outline-none focus:border-amber-400"
                />
                <span className="text-slate-400 whitespace-nowrap">
                  / {pdfTotalPages || 1}
                </span>
                <span className="hidden sm:inline text-slate-500 whitespace-nowrap">
                  • {pdfProgressPercent}%
                </span>
              </form>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleNavigateNextPage()}
                  disabled={pdfTotalPages === 0 || pdfPageNumber >= pdfTotalPages}
                  aria-label="Halaman berikutnya"
                  className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-xs font-bold text-white disabled:opacity-40 cursor-pointer whitespace-nowrap"
                >
                  <span>Berikutnya</span>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setPdfPageNumber(Math.max(1, pdfTotalPages))}
                  disabled={pdfTotalPages === 0 || pdfPageNumber >= pdfTotalPages}
                  aria-label="Halaman terakhir"
                  title="Halaman terakhir"
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <span className="hidden md:inline">Terakhir</span>
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="max-w-5xl mx-auto mt-1.5 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Dokumen dibaca langsung di pembaca internal • {watermarkText}</span>
          </div>
        </footer>
      )}
    </div>
  );
};
