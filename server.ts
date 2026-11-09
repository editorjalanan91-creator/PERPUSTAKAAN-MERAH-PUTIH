import express, { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { Book, Category, Loan, User, MonthlyReportSummary } from './src/types';
import { aggregateMonthlyReport, evaluateLoanStatus, validateRegistration } from './src/utils/libraryRules';

const PORT = 3000;
const DB_FILE = path.resolve('data/library_db.json');

// Ensure data folder exists
if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

interface UserRecord extends User {
  passwordHash: string; // "salt:hash"
}

interface DatabaseSchema {
  users: UserRecord[];
  categories: Category[];
  books: Book[];
  loans: Loan[];
  tokens: Record<string, { userId: string; expiresAt: number }>;
}

// Password hashing helper using standard node:crypto PBKDF2
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
}

// Initial default seed
function getInitialDb(): DatabaseSchema {
  // Admin password Admin123
  const adminPasswordHash = hashPassword('Admin123');

  const defaultAdmin: UserRecord = {
    id: 'user_admin_01',
    username: 'Admin',
    fullName: 'Administrator Utama',
    email: 'admin@perpustakaan.go.id',
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    passwordHash: adminPasswordHash,
  };

  const defaultCategories: Category[] = [
    { id: 'cat_1', name: 'Fiksi & Sastra', description: 'Novel, cerpen, puisi, dan karya sastra klasik maupun modern.' },
    { id: 'cat_2', name: 'Sains & Teknologi', description: 'Ilmu pengetahuan alam, teknologi informasi, dan komputasi.' },
    { id: 'cat_3', name: 'Sejarah & Budaya', description: 'Kisah peradaban, biografi tokoh, dan kebudayaan nusantara.' },
    { id: 'cat_4', name: 'Pengembangan Diri', description: 'Motivasi, psikologi populer, dan panduan produktivitas.' },
    { id: 'cat_5', name: 'Bisnis & Ekonomi', description: 'Kewirausahaan, manajemen keuangan, dan investasi.' },
    { id: 'cat_6', name: 'Filsafat & Agama', description: 'Pemikiran mendalam, etika, dan spiritualitas.' },
  ];

  const defaultBooks: Book[] = [];

  return {
    users: [defaultAdmin],
    categories: defaultCategories,
    books: defaultBooks,
    loans: [],
    tokens: {},
  };
}

// Persistent Database Handler with atomic file writing
class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // Ensure initial admin always exists with username Admin
        const adminIndex = parsed.users?.findIndex((u: UserRecord) => u.username.toLowerCase() === 'admin');
        if (adminIndex === -1 || !parsed.users) {
          const initial = getInitialDb();
          parsed.users = [initial.users[0], ...(parsed.users || [])];
        }
        return {
          users: parsed.users || [],
          categories: parsed.categories || [],
          books: parsed.books || [],
          loans: parsed.loans || [],
          tokens: parsed.tokens || {},
        };
      }
    } catch (err) {
      console.error('Error loading DB file, fallback to initial:', err);
    }
    const initial = getInitialDb();
    this.save(initial);
    return initial;
  }

  public save(dataToSave?: DatabaseSchema) {
    if (dataToSave) {
      this.data = dataToSave;
    }
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  public getUsers(): UserRecord[] {
    return this.data.users;
  }

  public findUserById(id: string): UserRecord | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  public findUserByUsername(username: string): UserRecord | undefined {
    return this.data.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase().trim()
    );
  }

  public findUserByEmail(email: string): UserRecord | undefined {
    return this.data.users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase().trim()
    );
  }

  public addUser(user: UserRecord) {
    this.data.users.push(user);
    this.save();
  }

  public updateUser(id: string, updates: Partial<UserRecord>) {
    const idx = this.data.users.findIndex((u) => u.id === id);
    if (idx !== -1) {
      this.data.users[idx] = { ...this.data.users[idx], ...updates };
      this.save();
      return this.data.users[idx];
    }
    return undefined;
  }

  public deleteUser(id: string): boolean {
    const user = this.findUserById(id);
    if (!user || user.role === 'admin') return false; // Never delete admin
    this.data.users = this.data.users.filter((u) => u.id !== id);
    // Remove related tokens
    for (const token of Object.keys(this.data.tokens)) {
      if (this.data.tokens[token].userId === id) {
        delete this.data.tokens[token];
      }
    }
    this.save();
    return true;
  }

  // Token management
  public createToken(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    this.data.tokens[token] = { userId, expiresAt };
    this.save();
    return token;
  }

  public verifyToken(token?: string): UserRecord | null {
    if (!token) return null;
    const session = this.data.tokens[token];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      delete this.data.tokens[token];
      this.save();
      return null;
    }
    const user = this.findUserById(session.userId);
    return user || null;
  }

  public revokeToken(token: string) {
    if (this.data.tokens[token]) {
      delete this.data.tokens[token];
      this.save();
    }
  }

  // Books
  public getBooks(): Book[] {
    return this.data.books;
  }

  public findBookById(id: string): Book | undefined {
    return this.data.books.find((b) => b.id === id);
  }

  public addBook(book: Book) {
    this.data.books.unshift(book);
    this.save();
  }

  public updateBook(id: string, updates: Partial<Book>): Book | undefined {
    const idx = this.data.books.findIndex((b) => b.id === id);
    if (idx !== -1) {
      this.data.books[idx] = { ...this.data.books[idx], ...updates };
      this.save();
      return this.data.books[idx];
    }
    return undefined;
  }

  public deleteBook(id: string): boolean {
    const prevLen = this.data.books.length;
    this.data.books = this.data.books.filter((b) => b.id !== id);
    if (this.data.books.length !== prevLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Categories
  public getCategories(): Category[] {
    // Add book count to categories
    return this.data.categories.map((c) => ({
      ...c,
      bookCount: this.data.books.filter(
        (b) => b.category.toLowerCase() === c.name.toLowerCase()
      ).length,
    }));
  }

  public addCategory(cat: Category) {
    this.data.categories.push(cat);
    this.save();
  }

  public updateCategory(id: string, updates: Partial<Category>): Category | undefined {
    const idx = this.data.categories.findIndex((c) => c.id === id);
    if (idx !== -1) {
      const oldName = this.data.categories[idx].name;
      this.data.categories[idx] = { ...this.data.categories[idx], ...updates };
      // Update books with old category name if changed
      if (updates.name && updates.name !== oldName) {
        for (const book of this.data.books) {
          if (book.category === oldName) {
            book.category = updates.name;
          }
        }
      }
      this.save();
      return this.data.categories[idx];
    }
    return undefined;
  }

  public deleteCategory(id: string): boolean {
    const cat = this.data.categories.find((c) => c.id === id);
    if (!cat) return false;
    this.data.categories = this.data.categories.filter((c) => c.id !== id);
    this.save();
    return true;
  }

  // Loans
  public getLoans(): Loan[] {
    // Auto-update loan status if overdue
    let changed = false;
    const nowIso = new Date().toISOString().split('T')[0];
    for (const loan of this.data.loans) {
      const newStatus = evaluateLoanStatus(loan.dueDate, loan.returnDate, nowIso);
      if (loan.status !== newStatus) {
        loan.status = newStatus;
        changed = true;
      }
    }
    if (changed) this.save();
    return this.data.loans;
  }

  public addLoan(loan: Loan) {
    this.data.loans.unshift(loan);
    this.save();
  }

  public returnLoan(loanId: string, returnDate: string): Loan | undefined {
    const loan = this.data.loans.find((l) => l.id === loanId);
    if (!loan || loan.status === 'returned') return undefined;

    loan.returnDate = returnDate;
    loan.status = 'returned';

    // Increment book stock
    const book = this.findBookById(loan.bookId);
    if (book) {
      book.stock += 1;
    }

    this.save();
    return loan;
  }
}

const db = new Database();

// Express app setup
async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Helper middleware to sanitize user output (no passwordHash)
  function sanitizeUser(u: UserRecord): User {
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      avatarUrl: u.avatarUrl,
    };
  }

  // Auth Middleware
  interface AuthenticatedRequest extends Request {
    user?: UserRecord;
  }

  function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' });
    }
    const token = authHeader.split(' ')[1];
    const user = db.verifyToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Sesi login telah kedaluwarsa atau tidak valid.' });
    }
    req.user = user;
    next();
  }

  function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya administrator yang diizinkan mengakses fitur ini.' });
    }
    next();
  }

  // --- AUTH ROUTES ---

  // POST /api/auth/login
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    }

    const user = db.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Username atau password tidak sesuai.' });
    }

    const passwordMatch = verifyPassword(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Username atau password tidak sesuai.' });
    }

    const token = db.createToken(user.id);
    return res.json({
      token,
      user: sanitizeUser(user),
    });
  });

  // POST /api/auth/register (Pengunjung baru)
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { fullName, username, email, password, confirmPassword } = req.body;

    const validation = validateRegistration({
      fullName,
      username,
      email,
      password,
      confirmPassword,
    });

    if (!validation.valid) {
      return res.status(400).json({
        error: Object.values(validation.errors)[0] || 'Data registrasi tidak valid.',
        details: validation.errors,
      });
    }

    // Check duplicate username
    if (db.findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username sudah digunakan oleh akun lain.' });
    }

    // Check duplicate email
    if (db.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }

    // Restrict registering as "admin" username
    if (username.toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Username "admin" tidak dapat didaftarkan kembali.' });
    }

    const newUser: UserRecord = {
      id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      username: username.trim(),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      role: 'user', // Pengunjung biasa
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };

    db.addUser(newUser);
    const token = db.createToken(newUser.id);

    return res.status(201).json({
      token,
      user: sanitizeUser(newUser),
    });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    return res.json({ user: sanitizeUser(req.user!) });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      db.revokeToken(token);
    }
    return res.json({ success: true, message: 'Berhasil keluar.' });
  });

  // PUT /api/auth/profile
  app.put('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { fullName, email } = req.body;
    if (!fullName || fullName.trim().length < 3) {
      return res.status(400).json({ error: 'Nama lengkap minimal 3 karakter.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }

    // If email changed, check uniqueness
    const existingWithEmail = db.findUserByEmail(email);
    if (existingWithEmail && existingWithEmail.id !== req.user!.id) {
      return res.status(409).json({ error: 'Email sudah digunakan akun lain.' });
    }

    const updated = db.updateUser(req.user!.id, {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
    });

    return res.json({ user: sanitizeUser(updated!) });
  });

  // PUT /api/auth/change-password
  app.put('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Password lama dan baru wajib diisi.' });
    }

    if (!verifyPassword(oldPassword, req.user!.passwordHash)) {
      return res.status(400).json({ error: 'Password saat ini salah.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Konfirmasi password baru tidak cocok.' });
    }

    db.updateUser(req.user!.id, {
      passwordHash: hashPassword(newPassword),
    });

    return res.json({ success: true, message: 'Password berhasil diperbarui.' });
  });

  // --- BOOK ROUTES ---

  // GET /api/books (authenticated)
  app.get('/api/books', requireAuth, (req: Request, res: Response) => {
    const books = db.getBooks();
    return res.json({ books });
  });

  // POST /api/books (admin only)
  app.post('/api/books', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const {
      title,
      author,
      publisher,
      year,
      isbn,
      category,
      pages,
      description,
      coverUrl,
      stock,
      shelfLocation,
    } = req.body;

    if (!title || !author || !category) {
      return res.status(400).json({ error: 'Judul, penulis, dan kategori wajib diisi.' });
    }

    const newBook: Book = {
      id: `book_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      title: title.trim(),
      author: author.trim(),
      publisher: (publisher || 'Penerbit Mandiri').trim(),
      year: parseInt(year, 10) || new Date().getFullYear(),
      isbn: (isbn || 'ISBN-978-000-000').trim(),
      category: category.trim(),
      pages: parseInt(pages, 10) || 100,
      description: (description || 'Belum ada deskripsi untuk buku ini.').trim(),
      coverUrl: coverUrl || 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80',
      stock: Math.max(0, parseInt(stock, 10) || 1),
      shelfLocation: (shelfLocation || 'Rak Umum').trim(),
      createdAt: new Date().toISOString(),
    };

    db.addBook(newBook);
    return res.status(201).json({ book: newBook, message: 'Buku berhasil ditambahkan!' });
  });

  // PUT /api/books/:id (admin only)
  app.put('/api/books/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      title,
      author,
      publisher,
      year,
      isbn,
      category,
      pages,
      description,
      coverUrl,
      stock,
      shelfLocation,
    } = req.body;

    const existing = db.findBookById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Buku tidak ditemukan.' });
    }

    const updated = db.updateBook(id, {
      title: title !== undefined ? title.trim() : existing.title,
      author: author !== undefined ? author.trim() : existing.author,
      publisher: publisher !== undefined ? publisher.trim() : existing.publisher,
      year: year !== undefined ? parseInt(year, 10) : existing.year,
      isbn: isbn !== undefined ? isbn.trim() : existing.isbn,
      category: category !== undefined ? category.trim() : existing.category,
      pages: pages !== undefined ? parseInt(pages, 10) : existing.pages,
      description: description !== undefined ? description.trim() : existing.description,
      coverUrl: coverUrl !== undefined ? coverUrl.trim() : existing.coverUrl,
      stock: stock !== undefined ? Math.max(0, parseInt(stock, 10)) : existing.stock,
      shelfLocation: shelfLocation !== undefined ? shelfLocation.trim() : existing.shelfLocation,
    });

    return res.json({ book: updated, message: 'Informasi buku berhasil diperbarui!' });
  });

  // DELETE /api/books/:id (admin only)
  app.delete('/api/books/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const deleted = db.deleteBook(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Buku tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Buku berhasil dihapus dari sistem!' });
  });

  // --- CATEGORY ROUTES ---

  // GET /api/categories (authenticated)
  app.get('/api/categories', requireAuth, (req: Request, res: Response) => {
    return res.json({ categories: db.getCategories() });
  });

  // POST /api/categories (admin only)
  app.post('/api/categories', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { name, description } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Nama kategori minimal 2 karakter.' });
    }

    const existing = db.getCategories().find(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) {
      return res.status(409).json({ error: 'Kategori dengan nama tersebut sudah ada.' });
    }

    const newCat: Category = {
      id: `cat_${Date.now()}`,
      name: name.trim(),
      description: description ? description.trim() : '',
    };
    db.addCategory(newCat);

    return res.status(201).json({ category: newCat, message: 'Kategori berhasil ditambahkan!' });
  });

  // PUT /api/categories/:id (admin only)
  app.put('/api/categories/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Nama kategori minimal 2 karakter.' });
    }

    const updated = db.updateCategory(id, {
      name: name.trim(),
      description: description ? description.trim() : '',
    });

    if (!updated) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    }

    return res.json({ category: updated, message: 'Kategori berhasil diperbarui!' });
  });

  // DELETE /api/categories/:id (admin only)
  app.delete('/api/categories/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const cat = db.getCategories().find((c) => c.id === id);
    if (!cat) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    }

    const booksInCat = db.getBooks().filter((b) => b.category.toLowerCase() === cat.name.toLowerCase());
    if (booksInCat.length > 0) {
      return res.status(400).json({
        error: `Kategori "${cat.name}" masih digunakan oleh ${booksInCat.length} buku. Harap ubah kategori buku terkait terlebih dahulu.`,
      });
    }

    const deleted = db.deleteCategory(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    }
    return res.json({ success: true, message: `Kategori "${cat.name}" berhasil dihapus!` });
  });

  // --- USER MANAGEMENT ROUTES (Admin only) ---

  // GET /api/users (admin only)
  app.get('/api/users', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const allUsers = db.getUsers().filter((u) => u.role !== 'admin');
    const allLoans = db.getLoans();

    // Map user with their active and total loans
    const visitorsWithStats = allUsers.map((u) => {
      const userLoans = allLoans.filter((l) => l.userId === u.id);
      const activeCount = userLoans.filter((l) => l.status === 'active' || l.status === 'overdue').length;
      return {
        ...sanitizeUser(u),
        totalLoans: userLoans.length,
        activeLoans: activeCount,
      };
    });

    return res.json({ users: visitorsWithStats });
  });

  // DELETE /api/users/:id (admin only)
  app.delete('/api/users/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const target = db.findUserById(id);
    if (!target) {
      return res.status(404).json({ error: 'Pengunjung tidak ditemukan.' });
    }
    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Akun admin tidak dapat dihapus.' });
    }

    db.deleteUser(id);
    return res.json({ success: true, message: `Akun pengunjung "${target.fullName}" berhasil dihapus.` });
  });

  // --- LOAN ROUTES ---

  // GET /api/loans (authenticated: user gets their own, admin gets all)
  app.get('/api/loans', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const allLoans = db.getLoans();
    if (req.user!.role === 'admin') {
      return res.json({ loans: allLoans });
    }
    const myLoans = allLoans.filter((l) => l.userId === req.user!.id);
    return res.json({ loans: myLoans });
  });

  // POST /api/loans (Borrow book)
  app.post('/api/loans', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { bookId, durationDays = 7, notes } = req.body;
    if (!bookId) {
      return res.status(400).json({ error: 'ID buku wajib disertakan.' });
    }

    const book = db.findBookById(bookId);
    if (!book) {
      return res.status(404).json({ error: 'Buku tidak ditemukan.' });
    }

    if (book.stock <= 0) {
      return res.status(400).json({ error: 'Maaf, stok eksemplar buku ini sedang habis.' });
    }

    // Check if user already has an active loan of this exact book
    const existingActive = db.getLoans().find(
      (l) => l.userId === req.user!.id && l.bookId === bookId && l.status !== 'returned'
    );
    if (existingActive) {
      return res.status(400).json({ error: 'Anda sedang meminjam buku ini. Harap kembalikan terlebih dahulu.' });
    }

    const now = new Date();
    const borrowDate = now.toISOString().split('T')[0];

    const days = Math.min(14, Math.max(3, parseInt(durationDays, 10) || 7));
    const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const dueDate = due.toISOString().split('T')[0];

    // Decrement stock
    book.stock -= 1;
    db.save();

    const newLoan: Loan = {
      id: `loan_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      bookId: book.id,
      bookTitle: book.title,
      bookAuthor: book.author,
      bookCover: book.coverUrl,
      userId: req.user!.id,
      userName: req.user!.fullName,
      userEmail: req.user!.email,
      borrowDate,
      dueDate,
      status: 'active',
      notes: notes ? String(notes).trim() : undefined,
    };

    db.addLoan(newLoan);
    return res.status(201).json({
      loan: newLoan,
      message: `Berhasil meminjam buku "${book.title}". Harap kembalikan sebelum ${dueDate}.`,
    });
  });

  // POST /api/loans/:id/return
  app.post('/api/loans/:id/return', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const loan = db.getLoans().find((l) => l.id === id);

    if (!loan) {
      return res.status(404).json({ error: 'Transaksi peminjaman tidak ditemukan.' });
    }

    // User can only return their own loan, unless admin
    if (req.user!.role !== 'admin' && loan.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Anda tidak memiliki hak untuk mengembalikan peminjaman ini.' });
    }

    if (loan.status === 'returned') {
      return res.status(400).json({ error: 'Buku ini sudah berstatus dikembalikan.' });
    }

    const returnDate = new Date().toISOString().split('T')[0];
    const updated = db.returnLoan(id, returnDate);

    return res.json({
      loan: updated,
      message: `Buku "${loan.bookTitle}" telah berhasil dikembalikan. Terima kasih!`,
    });
  });

  // GET /api/reports/monthly (admin only)
  app.get('/api/reports/monthly', requireAuth, requireAdmin, (req: Request, res: Response) => {
    const periodParam = (req.query.period as string) || new Date().toISOString().slice(0, 7); // e.g. "2026-11"
    const allLoans = db.getLoans();
    const report = aggregateMonthlyReport(allLoans, periodParam);

    // Also attach category breakdown
    const categories = db.getCategories();
    const categoryCountMap: Record<string, number> = {};
    const monthLoans = allLoans.filter((l) => l.borrowDate.startsWith(periodParam));

    for (const l of monthLoans) {
      const book = db.findBookById(l.bookId);
      const cat = book ? book.category : 'Lainnya';
      categoryCountMap[cat] = (categoryCountMap[cat] || 0) + 1;
    }

    report.categoryDistribution = Object.entries(categoryCountMap).map(([category, count]) => ({
      category,
      count,
    }));

    return res.json({ report });
  });

  // Mount Vite or static serving
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve('dist'))) {
    app.use(express.static(path.resolve('dist')));
    app.use('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PERPUSTAKAAN ONLINE] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
