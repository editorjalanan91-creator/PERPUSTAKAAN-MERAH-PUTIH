import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  flattenTocItems,
  hasPdfMagicBytes,
  hasZipMagicBytes,
  inspectAndValidateEpubArchive,
  resolveDocumentFileType,
  sanitizeDownloadFilename,
} from './epubUtils';

export async function buildValidSampleEpubBuffer(options?: {
  title?: string;
  creator?: string;
  chapterText?: string;
}): Promise<Uint8Array> {
  const title = options?.title || 'Contoh Buku Digital';
  const creator = options?.creator || 'Penulis Nusantara';
  const chapterText = options?.chapterText || 'Bab 1: Pengantar Literasi Digital';

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${creator}</dc:creator>
    <dc:language>id</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
  </spine>
</package>`
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Daftar Isi</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter1.xhtml">Bab 1: Pendahuluan</a></li>
        <li><a href="chapter2.xhtml">Bab 2: Pembahasan</a></li>
      </ol>
    </nav>
  </body>
</html>`
  );
  zip.file(
    'OEBPS/chapter1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Bab 1</title></head>
  <body><h1>${chapterText}</h1><p>Isi paragraf pertama.</p></body>
</html>`
  );
  zip.file(
    'OEBPS/chapter2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Bab 2</title></head>
  <body><h1>Bab 2: Pembahasan</h1><p>Isi paragraf kedua.</p></body>
</html>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}

test('inspectAndValidateEpubArchive validates complete EPUB structure, metadata, and spine chapters', async () => {
  const bytes = await buildValidSampleEpubBuffer({
    title: 'Sejarah Literasi',
    creator: 'R.A. Kartini',
  });

  assert.equal(hasZipMagicBytes(bytes), true);
  assert.equal(hasPdfMagicBytes(bytes), false);

  const inspection = await inspectAndValidateEpubArchive(bytes);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.rootfilePath, 'OEBPS/content.opf');
  assert.equal(inspection.title, 'Sejarah Literasi');
  assert.equal(inspection.creator, 'R.A. Kartini');
  assert.equal(inspection.spineCount, 2);
  assert.equal(inspection.manifestCount, 3);
});

test('inspectAndValidateEpubArchive rejects empty, corrupted, non-ZIP, and missing-container/OPF EPUB files', async () => {
  const emptyRes = await inspectAndValidateEpubArchive(new Uint8Array(0));
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.code, 'EMPTY_FILE');

  const htmlPayload = new TextEncoder().encode('<html><body>Not an EPUB</body></html>');
  const htmlRes = await inspectAndValidateEpubArchive(htmlPayload);
  assert.equal(htmlRes.valid, false);
  assert.equal(htmlRes.code, 'INVALID_ARCHIVE');

  const corruptedZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xde, 0xad]);
  const corruptRes = await inspectAndValidateEpubArchive(corruptedZip);
  assert.equal(corruptRes.valid, false);
  assert.equal(corruptRes.code, 'INVALID_ARCHIVE');

  const noContainerZip = new JSZip();
  noContainerZip.file('hello.txt', 'plain zip without container');
  const noContainerRes = await inspectAndValidateEpubArchive(
    await noContainerZip.generateAsync({ type: 'uint8array' })
  );
  assert.equal(noContainerRes.valid, false);
  assert.equal(noContainerRes.code, 'MISSING_CONTAINER');

  const missingOpfZip = new JSZip();
  missingOpfZip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/missing.opf"/></rootfiles></container>'
  );
  const missingOpfRes = await inspectAndValidateEpubArchive(
    await missingOpfZip.generateAsync({ type: 'uint8array' })
  );
  assert.equal(missingOpfRes.valid, false);
  assert.equal(missingOpfRes.code, 'MISSING_OPF');
});

test('resolveDocumentFileType detects epub/pdf accurately from metadata, file_path, and magic bytes', () => {
  assert.equal(resolveDocumentFileType('epub', 'documents/abc.bin'), 'epub');
  assert.equal(resolveDocumentFileType(null, 'documents/novel.epub'), 'epub');
  assert.equal(resolveDocumentFileType('pdf', 'documents/buku.pdf'), 'pdf');

  // Legacy row where file_type was defaulted to pdf even though payload is EPUB ZIP
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  assert.equal(resolveDocumentFileType('pdf', 'documents/legacy.epub', zipBytes), 'epub');

  const pdfBytes = new TextEncoder().encode('%PDF-1.7\n...');
  assert.equal(hasPdfMagicBytes(pdfBytes), true);
  assert.equal(resolveDocumentFileType(null, 'documents/unknown', pdfBytes), 'pdf');
});

test('flattenTocItems and sanitizeDownloadFilename handle nested chapters and unsafe titles', () => {
  const flat = flattenTocItems([
    {
      id: 'c1',
      href: 'chap1.xhtml',
      label: 'Bab 1:   Pendahuluan',
      subitems: [{ id: 'c1-1', href: 'chap1.xhtml#sec1', label: 'Subbab 1.1' }],
    },
    { id: 'c2', href: 'chap2.xhtml', label: 'Bab 2' },
  ]);

  assert.equal(flat.length, 3);
  assert.deepEqual(
    flat.map((item) => ({ label: item.label, depth: item.depth })),
    [
      { label: 'Bab 1: Pendahuluan', depth: 0 },
      { label: 'Subbab 1.1', depth: 1 },
      { label: 'Bab 2', depth: 0 },
    ]
  );

  assert.equal(
    sanitizeDownloadFilename('Bumi Manusia\r\n<script>!', 'epub'),
    'bumi-manusia-script.epub'
  );
  assert.equal(sanitizeDownloadFilename('', 'pdf'), 'dokumen-perpustakaan.pdf');
});
