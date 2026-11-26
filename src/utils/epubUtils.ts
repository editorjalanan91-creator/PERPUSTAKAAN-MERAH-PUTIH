import JSZip from 'jszip';

export interface EpubArchiveInspection {
  valid: boolean;
  code?:
    | 'EMPTY_FILE'
    | 'INVALID_ARCHIVE'
    | 'MISSING_CONTAINER'
    | 'INVALID_CONTAINER'
    | 'MISSING_OPF'
    | 'INVALID_OPF'
    | 'EMPTY_SPINE';
  error?: string;
  rootfilePath?: string;
  title?: string;
  creator?: string;
  spineCount?: number;
  manifestCount?: number;
}

export interface TocSourceItem {
  id?: string;
  href?: string;
  label?: string;
  subitems?: TocSourceItem[];
}

export interface FlattenedTocItem {
  id: string;
  href: string;
  label: string;
  depth: number;
}

export function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

/**
 * Memeriksa header magic bytes arsip ZIP/EPUB (PK\x03\x04 atau PK\x05\x06).
 */
export function hasZipMagicBytes(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = toUint8Array(input);
  if (bytes.length < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/**
 * Memeriksa header magic bytes dokumen PDF (%PDF-).
 */
export function hasPdfMagicBytes(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = toUint8Array(input);
  if (bytes.length < 5) return false;
  const searchLimit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= searchLimit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Menentukan format dokumen ('epub' | 'pdf') dari metadata DB, ekstensi path, atau magic bytes.
 */
export function resolveDocumentFileType(
  fileType?: string | null,
  filePath?: string | null,
  bytes?: ArrayBuffer | Uint8Array | null
): 'epub' | 'pdf' {
  const normalizedType = String(fileType || '')
    .trim()
    .toLowerCase();
  if (normalizedType === 'epub' || normalizedType === 'application/epub+zip') {
    return 'epub';
  }
  if (normalizedType === 'pdf' || normalizedType === 'application/pdf') {
    if (bytes && hasZipMagicBytes(bytes) && !hasPdfMagicBytes(bytes)) {
      return 'epub';
    }
    return 'pdf';
  }

  const cleanPath = String(filePath || '')
    .split('?')[0]
    .trim()
    .toLowerCase();
  if (cleanPath.endsWith('.epub')) return 'epub';
  if (cleanPath.endsWith('.pdf')) return 'pdf';

  if (bytes) {
    if (hasZipMagicBytes(bytes) && !hasPdfMagicBytes(bytes)) return 'epub';
    if (hasPdfMagicBytes(bytes)) return 'pdf';
  }

  return 'pdf';
}

function findZipEntryCaseInsensitive(zip: JSZip, targetPath: string): JSZip.JSZipObject | null {
  const normalized = targetPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  const direct = zip.file(normalized);
  if (direct) return direct;

  const lowerTarget = normalized.toLowerCase();
  for (const [key, entry] of Object.entries(zip.files)) {
    if (!entry.dir && key.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() === lowerTarget) {
      return entry;
    }
  }
  return null;
}

function resolveArchiveRelativePath(baseFilePath: string, relativeHref: string): string {
  const cleanHref = relativeHref.split('#')[0].split('?')[0].replace(/\\/g, '/').trim();
  if (!cleanHref) return '';
  if (cleanHref.startsWith('/')) {
    return cleanHref.replace(/^\/+/, '');
  }

  const baseDirParts = baseFilePath.replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean);
  const relParts = cleanHref.split('/');
  const resolved: string[] = [...baseDirParts];

  for (const part of relParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function parseAttributes(tagAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tagAttrs)) !== null) {
    attrs[match[1].toLowerCase()] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Validasi struktur arsip EPUB (ZIP, META-INF/container.xml, OPF manifest & spine)
 * sebelum diserahkan ke epubjs agar berkas rusak menghasilkan pesan error jelas.
 */
export async function inspectAndValidateEpubArchive(
  input: ArrayBuffer | Uint8Array
): Promise<EpubArchiveInspection> {
  const bytes = toUint8Array(input);
  if (bytes.length === 0) {
    return {
      valid: false,
      code: 'EMPTY_FILE',
      error: 'Berkas EPUB kosong (0 byte) atau gagal diunduh dari server.',
    };
  }

  if (!hasZipMagicBytes(bytes)) {
    return {
      valid: false,
      code: 'INVALID_ARCHIVE',
      error: 'Format berkas EPUB tidak valid atau rusak (bukan arsip EPUB/ZIP yang sah).',
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return {
      valid: false,
      code: 'INVALID_ARCHIVE',
      error: 'Berkas EPUB rusak dan tidak dapat diekstrak oleh pembaca.',
    };
  }

  const containerEntry = findZipEntryCaseInsensitive(zip, 'META-INF/container.xml');
  if (!containerEntry) {
    return {
      valid: false,
      code: 'MISSING_CONTAINER',
      error: 'Struktur EPUB tidak valid: berkas META-INF/container.xml tidak ditemukan.',
    };
  }

  const containerXml = await containerEntry.async('string').catch(() => '');
  const rootfileMatch = containerXml.match(/<rootfile\b([^>]*)>/i);
  const rootfileAttrs = rootfileMatch ? parseAttributes(rootfileMatch[1]) : {};
  const rootfilePath = (rootfileAttrs['full-path'] || '').replace(/\\/g, '/').replace(/^\/+/, '');

  if (!rootfilePath) {
    return {
      valid: false,
      code: 'INVALID_CONTAINER',
      error: 'Struktur EPUB tidak valid: lokasi berkas OPF (rootfile) tidak tercantum di container.xml.',
    };
  }

  const opfEntry = findZipEntryCaseInsensitive(zip, rootfilePath);
  if (!opfEntry) {
    return {
      valid: false,
      code: 'MISSING_OPF',
      error: `Struktur EPUB rusak: berkas paket "${rootfilePath}" tidak ditemukan di dalam arsip.`,
    };
  }

  const opfXml = await opfEntry.async('string').catch(() => '');
  if (!opfXml || !/<package\b/i.test(opfXml)) {
    return {
      valid: false,
      code: 'INVALID_OPF',
      error: 'Berkas metadata OPF di dalam EPUB rusak atau tidak terbaca.',
    };
  }

  const titleMatch = opfXml.match(/<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i);
  const creatorMatch = opfXml.match(/<(?:dc:)?creator\b[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/i);

  const manifestMap = new Map<string, string>();
  const itemRegex = /<item\b([^>]*)\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(opfXml)) !== null) {
    const attrs = parseAttributes(itemMatch[1]);
    if (attrs.id && attrs.href) {
      manifestMap.set(attrs.id, attrs.href);
    }
  }

  const spineIds: string[] = [];
  const itemrefRegex = /<itemref\b([^>]*)\/?>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRegex.exec(opfXml)) !== null) {
    const attrs = parseAttributes(refMatch[1]);
    if (attrs.idref) {
      spineIds.push(attrs.idref);
    }
  }

  if (spineIds.length === 0) {
    return {
      valid: false,
      code: 'EMPTY_SPINE',
      error: 'Buku EPUB ini tidak memiliki daftar bab/halaman (spine) yang dapat ditampilkan.',
    };
  }

  let readableChapters = 0;
  for (const idref of spineIds) {
    const href = manifestMap.get(idref);
    if (!href) continue;
    let decodedHref = href;
    try {
      decodedHref = decodeURIComponent(href);
    } catch {
      decodedHref = href;
    }
    const chapterPath = resolveArchiveRelativePath(rootfilePath, decodedHref);
    if (chapterPath && findZipEntryCaseInsensitive(zip, chapterPath)) {
      readableChapters++;
    }
  }

  if (readableChapters === 0) {
    return {
      valid: false,
      code: 'EMPTY_SPINE',
      error: 'Berkas bab konten di dalam EPUB hilang atau rusak.',
    };
  }

  return {
    valid: true,
    rootfilePath,
    title: titleMatch ? decodeXmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')) : undefined,
    creator: creatorMatch ? decodeXmlEntities(creatorMatch[1].replace(/<[^>]+>/g, '')) : undefined,
    spineCount: spineIds.length,
    manifestCount: manifestMap.size,
  };
}

/**
 * Meratakan pohon Daftar Isi (TOC) EPUB menjadi daftar datar berlevel agar mudah dinavigasi.
 */
export function flattenTocItems(items: TocSourceItem[] = [], depth = 0): FlattenedTocItem[] {
  const result: FlattenedTocItem[] = [];
  items.forEach((item, index) => {
    const href = String(item?.href || '').trim();
    const label = String(item?.label || '').replace(/\s+/g, ' ').trim() || `Bab ${index + 1}`;
    const id = String(item?.id || `${depth}-${index}-${href || label}`);
    if (href) {
      result.push({ id, href, label, depth });
    }
    if (Array.isArray(item?.subitems) && item.subitems.length > 0) {
      result.push(...flattenTocItems(item.subitems, depth + 1));
    }
  });
  return result;
}

/**
 * Memastikan nama berkas unduhan aman dari karakter kontrol atau header injection.
 */
export function sanitizeDownloadFilename(title: string | null | undefined, ext: 'epub' | 'pdf'): string {
  const ascii = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const stem = ascii.slice(0, 80) || 'dokumen-perpustakaan';
  return `${stem}.${ext}`;
}
