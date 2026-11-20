import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createApp,
  defaultCreateSupabaseAdminClient,
  inspectServerSupabaseEnv,
  inspectVercelEnvChecklist,
  probeAdminProfilesAccess,
  probeAdminReturnTablesAccess,
} from './app';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_2_ID = '22222222-2222-4222-8222-222222222222';
const SUPER_ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const ENV_SUPER_ADMIN_ID = '66666666-6666-4666-8666-666666666666';
const VISITOR_NO_LOANS_ID = '33333333-3333-4333-8333-333333333333';
const VISITOR_WITH_LOANS_ID = '44444444-4444-4444-8444-444444444444';
const VISITOR_ACTIVE_LOAN_ID = '77777777-7777-4777-8777-777777777777';
const VISITOR_ARCHIVED_ID = '88888888-8888-4888-8888-888888888888';

function makeFakeJwt(payloadObj: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

function createMockSupabaseAuthClient() {
  const verifiedTokens: string[] = [];
  const client: any = {
    auth: {
      async getUser(token: string) {
        verifiedTokens.push(token);
        if (token === 'admin-token') {
          return { data: { user: { id: ADMIN_ID, email: 'admin@perpustakaan.go.id' } }, error: null };
        }
        if (token === 'admin-2-token') {
          return { data: { user: { id: ADMIN_2_ID, email: 'admin2@perpustakaan.go.id' } }, error: null };
        }
        if (token === 'super-admin-token') {
          return {
            data: { user: { id: SUPER_ADMIN_ID, email: 'superadmin@perpustakaan.go.id' } },
            error: null,
          };
        }
        if (token === 'env-super-admin-token') {
          return {
            data: { user: { id: ENV_SUPER_ADMIN_ID, email: 'superadmin2@perpustakaan.go.id' } },
            error: null,
          };
        }
        if (token === 'visitor-token') {
          return {
            data: { user: { id: VISITOR_NO_LOANS_ID, email: 'budi@example.com' } },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
      },
    },
    from() {
      throw new Error('Auth client must NEVER be used to query database tables directly');
    },
  };
  return { client, verifiedTokens };
}

const LOAN_ACTIVE_VISITOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LOAN_ACTIVE_SECOND_SAME_BOOK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const LOAN_PENDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const LOAN_RETURNED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const LOAN_OTHER_VISITOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const BOOK_MAIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

function createMockSupabaseAdmin(options?: {
  simulateMissingArchiveCols?: boolean;
  simulateProfilesPermissionDenied?: boolean;
  simulateCategoriesPermissionDenied?: boolean;
  simulateActivityLogsSnapshotError?: boolean;
  simulateBooksSnapshotError?: boolean;
  simulateLoansCountPermissionDenied?: boolean;
  simulateAuthGetUserError?: boolean;
  simulateProfileUpdateFailure?: boolean;
  simulateProfileInsertFailure?: boolean;
  simulateProfileDeleteFailure?: boolean | 'super_admin' | 'fk_conflict';
  simulateActivityLogsActorNotNull?: boolean;
  simulateAuthAlreadyDeleted?: boolean;
  simulateAuthDeleteFailure?: boolean;
  simulateAuthRollbackFailure?: boolean;
  enforceAuthTriggerProtection?: boolean;
  simulateReturnStockTrigger?: boolean;
  simulateApproveStockTrigger?: boolean;
  simulateDuplicateLoanPk?: boolean;
  simulateDuplicateBookRecord?: boolean;
  simulateDuplicateProfileRecord?: boolean;
  simulateDuplicateLoanUpdate?: boolean;
  simulateLoanUpdateZeroRowsBecauseReturned?: boolean;
  simulateLoansPermissionDenied?: boolean | 'update';
  simulateBookStockUpdateFailure?: boolean | 'zero_rows';
  simulateLoanUpdateDelayMs?: number;
  rpcHandler?: (fnName: string, params?: Record<string, any>) => Promise<{ data: any; error: any }>;
  simulateRollbackFailures?: {
    profile?: boolean | 'throw';
    books?: boolean;
    categories?: boolean;
    activityLogs?: boolean;
  };
}) {
  const deletedAuthUsers: string[] = [];
  const deletedProfiles: string[] = [];
  const updatedAuthUsers: Array<{ id: string; payload: any }> = [];
  const createdAuthUsers: Array<{ id: string; email: string; user_metadata: any }> = [];
  const activityLogs: any[] = [];
  const categoriesTouches: string[] = [];
  const books: Array<{
    id: string;
    title: string;
    author: string;
    cover_path: string | null;
    file_path?: string | null;
    file_type?: string | null;
    category_id?: string | null;
    is_published?: boolean;
    is_archived?: boolean;
    total_copies: number;
    available_copies: number;
    created_by: string | null;
    created_at?: string;
    updated_at?: string;
  }> = [
    {
      id: 'book-1',
      title: 'Buku Referensi Umum',
      author: 'Penulis Satu',
      cover_path: null,
      file_path: null,
      file_type: null,
      category_id: 'cat-1',
      is_published: true,
      is_archived: false,
      total_copies: 4,
      available_copies: 4,
      created_by: VISITOR_NO_LOANS_ID,
      created_at: '2026-11-01T08:00:00.000Z',
    },
    {
      id: BOOK_MAIN_ID,
      title: 'Arsitektur Web Modern',
      author: 'Dewi Lestari',
      cover_path: 'covers/arsitektur.jpg',
      file_path: 'documents/arsitektur.pdf',
      file_type: 'pdf',
      category_id: 'cat-1',
      is_published: true,
      is_archived: false,
      total_copies: 5,
      available_copies: 2,
      created_by: ADMIN_ID,
      created_at: '2026-11-02T08:00:00.000Z',
    },
  ];
  const loans: Array<{
    id: string;
    user_id: string;
    book_id: string;
    status: string;
    requested_at: string;
    approved_at: string | null;
    due_at: string | null;
    returned_at: string | null;
    admin_note: string | null;
    created_at: string;
    updated_at: string;
  }> = [
    {
      id: LOAN_ACTIVE_VISITOR_ID,
      user_id: VISITOR_NO_LOANS_ID,
      book_id: BOOK_MAIN_ID,
      status: 'approved',
      requested_at: '2026-11-10T08:00:00.000Z',
      approved_at: '2026-11-10T09:00:00.000Z',
      due_at: '2026-11-17T09:00:00.000Z',
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-10T08:00:00.000Z',
      updated_at: '2026-11-10T09:00:00.000Z',
    },
    {
      id: LOAN_ACTIVE_SECOND_SAME_BOOK_ID,
      user_id: VISITOR_NO_LOANS_ID,
      book_id: BOOK_MAIN_ID,
      status: 'borrowed',
      requested_at: '2026-11-11T08:00:00.000Z',
      approved_at: '2026-11-11T09:00:00.000Z',
      due_at: '2026-11-18T09:00:00.000Z',
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-11T08:00:00.000Z',
      updated_at: '2026-11-11T09:00:00.000Z',
    },
    {
      id: LOAN_PENDING_ID,
      user_id: VISITOR_NO_LOANS_ID,
      book_id: BOOK_MAIN_ID,
      status: 'pending',
      requested_at: '2026-11-12T08:00:00.000Z',
      approved_at: null,
      due_at: null,
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-12T08:00:00.000Z',
      updated_at: '2026-11-12T08:00:00.000Z',
    },
    {
      id: LOAN_RETURNED_ID,
      user_id: VISITOR_NO_LOANS_ID,
      book_id: BOOK_MAIN_ID,
      status: 'returned',
      requested_at: '2026-11-01T08:00:00.000Z',
      approved_at: '2026-11-01T09:00:00.000Z',
      due_at: '2026-11-08T09:00:00.000Z',
      returned_at: '2026-11-05T10:00:00.000Z',
      admin_note: null,
      created_at: '2026-11-01T08:00:00.000Z',
      updated_at: '2026-11-05T10:00:00.000Z',
    },
    {
      id: LOAN_OTHER_VISITOR_ID,
      user_id: VISITOR_ACTIVE_LOAN_ID,
      book_id: BOOK_MAIN_ID,
      status: 'approved',
      requested_at: '2026-11-09T08:00:00.000Z',
      approved_at: '2026-11-09T09:00:00.000Z',
      due_at: '2026-11-16T09:00:00.000Z',
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-09T08:00:00.000Z',
      updated_at: '2026-11-09T09:00:00.000Z',
    },
  ];
  const categories: Array<{ id: string; name: string; slug: string; created_by: string | null }> = [
    { id: 'cat-1', name: 'Teknologi', slug: 'teknologi', created_by: VISITOR_NO_LOANS_ID },
  ];
  const loansMutations: string[] = [];
  let authUpdateAttempt = 0;
  let generatedSeq = 10;

  const profiles: Record<string, any> = {
    [ADMIN_ID]: { id: ADMIN_ID, full_name: 'Admin Utama', username: 'Admin', role: 'admin' },
    [ADMIN_2_ID]: { id: ADMIN_2_ID, full_name: 'Admin Dua', username: 'admin2', role: 'admin' },
    [SUPER_ADMIN_ID]: {
      id: SUPER_ADMIN_ID,
      full_name: 'Super Admin Sistem',
      username: 'superadmin',
      role: 'super_admin',
      is_super_admin: true,
    },
    [ENV_SUPER_ADMIN_ID]: {
      id: ENV_SUPER_ADMIN_ID,
      full_name: 'Super Admin Cadangan',
      username: 'superadmin2',
      role: 'admin',
      is_super_admin: false,
    },
    [VISITOR_NO_LOANS_ID]: {
      id: VISITOR_NO_LOANS_ID,
      full_name: 'Budi Santoso',
      username: 'budisantoso',
      role: 'visitor',
      is_active: true,
      archived_at: null,
    },
    [VISITOR_WITH_LOANS_ID]: {
      id: VISITOR_WITH_LOANS_ID,
      full_name: 'Siti Aminah',
      username: 'sitiaminah',
      role: 'visitor',
      is_active: true,
      archived_at: null,
    },
    [VISITOR_ACTIVE_LOAN_ID]: {
      id: VISITOR_ACTIVE_LOAN_ID,
      full_name: 'Rina Wijaya',
      username: 'rinawijaya',
      role: 'visitor',
      is_active: true,
      archived_at: null,
    },
    [VISITOR_ARCHIVED_ID]: {
      id: VISITOR_ARCHIVED_ID,
      full_name: 'Andi Arsip',
      username: 'andiarsip',
      role: 'visitor',
      is_active: false,
      archived_at: '2026-10-01T10:00:00.000Z',
    },
  };

  const authUsersState: Record<string, { banned_until: string | null; user_metadata: Record<string, any>; app_metadata?: Record<string, any> }> = {};
  for (const p of Object.values(profiles)) {
    authUsersState[p.id] = {
      banned_until: p.is_active === false ? '2099-01-01T00:00:00.000Z' : null,
      user_metadata: {
        role: p.role,
        full_name: p.full_name,
        username: p.username,
        is_active: p.is_active ?? true,
        archived_at: p.archived_at ?? null,
      },
      app_metadata: p.id === SUPER_ADMIN_ID ? { is_super_admin: true, role: 'super_admin' } : {},
    };
  }

  const totalLoansCountByUser: Record<string, number> = {
    [VISITOR_NO_LOANS_ID]: 0,
    [VISITOR_WITH_LOANS_ID]: 2,
    [VISITOR_ACTIVE_LOAN_ID]: 2,
    [VISITOR_ARCHIVED_ID]: 1,
  };

  const activeLoansCountByUser: Record<string, number> = {
    [VISITOR_NO_LOANS_ID]: 0,
    [VISITOR_WITH_LOANS_ID]: 0,
    [VISITOR_ACTIVE_LOAN_ID]: 1,
    [VISITOR_ARCHIVED_ID]: 0,
  };

  const client: any = {
    auth: {
      async getUser() {
        throw new Error('Admin client must NEVER verify end-user tokens via auth.getUser()');
      },
      admin: {
        async listUsers() {
          return {
            data: {
              users: Object.values(profiles).map((p: any) => ({
                id: p.id,
                email: `${p.username.toLowerCase()}@example.com`,
                banned_until: authUsersState[p.id]?.banned_until ?? null,
                user_metadata: authUsersState[p.id]?.user_metadata ?? {},
                app_metadata: authUsersState[p.id]?.app_metadata ?? {},
              })),
            },
            error: null,
          };
        },
        async getUserById(id: string) {
          if (options?.simulateAuthGetUserError) {
            return {
              data: { user: null },
              error: { status: 500, message: 'Auth Admin service unavailable' },
            };
          }
          const p = profiles[id];
          if (!p) return { data: { user: null }, error: { message: 'User not found' } };
          return {
            data: {
              user: {
                id: p.id,
                email: `${p.username.toLowerCase()}@example.com`,
                banned_until: authUsersState[id]?.banned_until ?? null,
                user_metadata: authUsersState[id]?.user_metadata ?? {
                  role: p.role,
                  full_name: p.full_name,
                  username: p.username,
                },
                app_metadata: authUsersState[id]?.app_metadata ?? {},
              },
            },
            error: null,
          };
        },
        async deleteUser(id: string) {
          if (options?.enforceAuthTriggerProtection) {
            const p = profiles[id];
            const appMeta = authUsersState[id]?.app_metadata ?? {};
            const isSuper =
              p?.role === 'super_admin' ||
              p?.is_super_admin === true ||
              appMeta.is_super_admin === true ||
              appMeta.role === 'super_admin' ||
              id === ENV_SUPER_ADMIN_ID;
            if (isSuper) {
              return {
                data: { user: null },
                error: {
                  code: 'P0001',
                  message:
                    'Akun Super Admin dilindungi di Supabase Authentication dan tidak boleh dihapus.',
                },
              };
            }
          }
          if (options?.simulateAuthDeleteFailure) {
            return { data: { user: null }, error: { message: 'Simulated Auth deletion failure' } };
          }
          if (options?.simulateAuthAlreadyDeleted) {
            return { data: { user: null }, error: { message: 'User not found' } };
          }
          deletedAuthUsers.push(id);
          return { data: { user: null }, error: null };
        },
        async updateUserById(id: string, payload: any) {
          if (options?.enforceAuthTriggerProtection && payload?.ban_duration && payload.ban_duration !== 'none') {
            const p = profiles[id];
            const appMeta = authUsersState[id]?.app_metadata ?? {};
            const isSuper =
              p?.role === 'super_admin' ||
              p?.is_super_admin === true ||
              appMeta.is_super_admin === true ||
              appMeta.role === 'super_admin' ||
              id === ENV_SUPER_ADMIN_ID;
            if (isSuper) {
              return {
                data: { user: null },
                error: {
                  code: 'P0001',
                  message:
                    'Akun Super Admin dilindungi di Supabase Authentication dan tidak boleh diblokir/diarsipkan.',
                },
              };
            }
          }
          authUpdateAttempt += 1;
          updatedAuthUsers.push({ id, payload });
          if (options?.simulateAuthRollbackFailure && authUpdateAttempt % 2 === 0) {
            return {
              data: { user: null },
              error: { message: 'Simulated Auth rollback failure' },
            };
          }
          if (authUsersState[id]) {
            authUsersState[id] = {
              ...authUsersState[id],
              banned_until:
                payload.ban_duration === 'none'
                  ? null
                  : payload.ban_duration
                    ? '2099-01-01T00:00:00.000Z'
                    : authUsersState[id].banned_until,
              user_metadata: payload.user_metadata ?? authUsersState[id].user_metadata,
            };
          }
          return { data: { user: { id, ...payload } }, error: null };
        },
        async createUser(payload: {
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: Record<string, any>;
        }) {
          const emailLower = String(payload.email || '').toLowerCase();
          const duplicateEmail = Object.entries(profiles).some(
            ([, p]: [string, any]) => `${String(p.username || '').toLowerCase()}@example.com` === emailLower
          ) || createdAuthUsers.some((u) => u.email.toLowerCase() === emailLower);
          if (duplicateEmail) {
            return {
              data: { user: null },
              error: { message: 'A user with this email address has already been registered' },
            };
          }
          generatedSeq += 1;
          const newId = `99999999-9999-4999-8999-0000000000${String(generatedSeq).padStart(2, '0')}`;
          authUsersState[newId] = {
            banned_until: null,
            user_metadata: { ...(payload.user_metadata || {}) },
            app_metadata: {},
          };
          const created = {
            id: newId,
            email: emailLower,
            user_metadata: authUsersState[newId].user_metadata,
          };
          createdAuthUsers.push(created);
          return { data: { user: created }, error: null };
        },
      },
    },
    from(table: string) {
      let filterCol = '';
      let filterVal: any = null;
      const eqFilters: Array<{ col: string; val: any }> = [];
      const ilikeFilters: Array<{ col: string; val: string }> = [];
      const inFilters: Array<{ col: string; vals: any[] }> = [];
      const neqFilters: Array<{ col: string; val: any }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let isDelete = false;
      let isUpdate = false;
      let updatePayload: any = null;
      let isInsert = false;
      let insertPayload: any = null;

      const matchesRow = (row: Record<string, any>) =>
        eqFilters.every((f) => row?.[f.col] === f.val) &&
        ilikeFilters.every(
          (f) => String(row?.[f.col] ?? '').toLowerCase() === String(f.val ?? '').toLowerCase()
        ) &&
        inFilters.every((f) => f.vals.includes(row?.[f.col])) &&
        neqFilters.every((f) => row?.[f.col] !== f.val);

      const executeQuery = () => {
        if (isInsert) {
          if (table === 'loans') {
            loansMutations.push('insert');
            if (options?.simulateLoansPermissionDenied) {
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for table loans' },
              });
            }
            generatedSeq += 1;
            const newLoan = {
              id: insertPayload?.id || `aaaaaaaa-aaaa-4aaa-8aaa-0000000000${String(generatedSeq).padStart(2, '0')}`,
              created_at: insertPayload?.requested_at || new Date().toISOString(),
              updated_at: insertPayload?.requested_at || new Date().toISOString(),
              ...insertPayload,
            };
            loans.push(newLoan);
            return Promise.resolve({ data: [{ ...newLoan }], error: null });
          }
          if (table === 'books') {
            generatedSeq += 1;
            const newBook = {
              id: insertPayload?.id || `bbbbbbbb-bbbb-4bbb-8bbb-0000000000${String(generatedSeq).padStart(2, '0')}`,
              ...insertPayload,
            };
            books.push(newBook);
            return Promise.resolve({ data: [{ ...newBook }], error: null });
          }
          if (table === 'activity_logs') {
            activityLogs.push(insertPayload);
            return Promise.resolve({ data: [insertPayload], error: null });
          }
          if (table === 'profiles' && insertPayload?.id) {
            if (options?.simulateProfileInsertFailure) {
              return Promise.resolve({
                data: null,
                error: { code: '23505', message: 'Simulated profile insert failure' },
              });
            }
            if (options?.simulateRollbackFailures?.profile === 'throw') {
              return Promise.reject(new Error('Simulated thrown error restoring profile'));
            }
            if (options?.simulateRollbackFailures?.profile) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated profile insert rollback failure' },
              });
            }
            profiles[insertPayload.id] = insertPayload;
            return Promise.resolve({ data: [insertPayload], error: null });
          }
          if (table === 'categories') {
            categoriesTouches.push('insert');
          }
          return Promise.resolve({ data: [insertPayload], error: null });
        }

        if (isDelete) {
          if (table === 'profiles') {
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (options?.simulateProfileDeleteFailure === 'super_admin') {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Akun Super Admin dilindungi dan tidak dapat dihapus' },
              });
            }
            if (options?.simulateProfileDeleteFailure === 'fk_conflict') {
              return Promise.resolve({
                error: {
                  code: '23503',
                  message: 'update or delete on table "profiles" violates foreign key constraint',
                },
              });
            }
            if (options?.simulateProfileDeleteFailure) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated profile delete failure' },
              });
            }
            if (idFilter) {
              delete profiles[idFilter];
              deletedProfiles.push(idFilter);
            }
          } else if (table === 'books') {
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (idFilter) {
              const idx = books.findIndex((b) => b.id === idFilter);
              if (idx !== -1) books.splice(idx, 1);
            }
          } else if (table === 'categories') {
            categoriesTouches.push('delete');
          } else if (table === 'activity_logs') {
            const actorFilter = eqFilters.find((f) => f.col === 'actor_id')?.val;
            if (actorFilter) {
              for (let i = activityLogs.length - 1; i >= 0; i--) {
                if (activityLogs[i]?.actor_id === actorFilter) activityLogs.splice(i, 1);
              }
            }
          }
          return Promise.resolve({ error: null });
        }

        if (isUpdate) {
          if (table === 'profiles' && options?.simulateProfileUpdateFailure) {
            return Promise.resolve({
              error: { code: 'P0001', message: 'unexpected profile update failure' },
            });
          }
          if (
            table === 'profiles' &&
            options?.simulateMissingArchiveCols &&
            (updatePayload?.is_active !== undefined || updatePayload?.archived_by !== undefined)
          ) {
            return Promise.resolve({
              error: { code: '42703', message: 'column "is_active" does not exist' },
            });
          }
          if (table === 'profiles') {
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (idFilter && profiles[idFilter]) {
              profiles[idFilter] = { ...profiles[idFilter], ...updatePayload };
            }
            return Promise.resolve({ error: null });
          }
          if (table === 'books') {
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (idFilter && updatePayload?.created_by != null && options?.simulateRollbackFailures?.books) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated books rollback error' },
              });
            }
            if (
              updatePayload &&
              Object.prototype.hasOwnProperty.call(updatePayload, 'available_copies')
            ) {
              if (options?.simulateBookStockUpdateFailure === true) {
                return Promise.resolve({
                  data: null,
                  error: { code: 'P0001', message: 'Simulated book stock update failure' },
                });
              }
              if (options?.simulateBookStockUpdateFailure === 'zero_rows') {
                return Promise.resolve({ data: [], error: null });
              }
            }
            const updatedBooks: any[] = [];
            for (const b of books) {
              if (matchesRow(b)) {
                Object.assign(b, updatePayload);
                updatedBooks.push({ ...b });
              }
            }
            return Promise.resolve({ data: updatedBooks, error: null });
          }
          if (table === 'loans') {
            if (options?.simulateLoansPermissionDenied) {
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for table loans' },
              });
            }
            if (options?.simulateLoanUpdateZeroRowsBecauseReturned) {
              const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
              const target = loans.find((l) => l.id === idFilter);
              if (target) {
                target.status = 'returned';
                target.returned_at = target.returned_at || '2026-11-17T00:00:00.000Z';
              }
              return Promise.resolve({ data: [], error: null });
            }
            const updatedLoans: any[] = [];
            for (const l of loans) {
              if (matchesRow(l)) {
                const prevStatus = l.status;
                Object.assign(l, updatePayload);
                updatedLoans.push({ ...l });
                if (
                  options?.simulateReturnStockTrigger &&
                  (prevStatus === 'approved' || prevStatus === 'borrowed') &&
                  l.status === 'returned'
                ) {
                  const bk = books.find((b) => b.id === l.book_id);
                  if (bk) {
                    bk.available_copies += 1;
                  }
                }
                if (
                  options?.simulateApproveStockTrigger &&
                  prevStatus === 'pending' &&
                  l.status === 'approved'
                ) {
                  const bk = books.find((b) => b.id === l.book_id);
                  if (bk && bk.available_copies > 0) {
                    bk.available_copies -= 1;
                  }
                }
              }
            }
            if (options?.simulateDuplicateLoanUpdate && updatedLoans.length === 1) {
              updatedLoans.push({ ...updatedLoans[0] });
            }
            if (options?.simulateLoanUpdateDelayMs && options.simulateLoanUpdateDelayMs > 0) {
              return new Promise((resolve) =>
                setTimeout(
                  () => resolve({ data: updatedLoans, error: null }),
                  options.simulateLoanUpdateDelayMs
                )
              );
            }
            return Promise.resolve({ data: updatedLoans, error: null });
          }
          if (table === 'categories') {
            categoriesTouches.push('update');
            if (options?.simulateCategoriesPermissionDenied) {
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for table categories' },
              });
            }
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (
              idFilter &&
              updatePayload?.created_by != null &&
              options?.simulateRollbackFailures?.categories
            ) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated categories rollback error' },
              });
            }
            for (const c of categories) {
              if (matchesRow(c)) {
                c.created_by = updatePayload.created_by;
              }
            }
            return Promise.resolve({ error: null });
          }
          if (table === 'activity_logs') {
            if (
              options?.simulateActivityLogsActorNotNull &&
              updatePayload &&
              Object.prototype.hasOwnProperty.call(updatePayload, 'actor_id') &&
              updatePayload.actor_id === null
            ) {
              return Promise.resolve({
                error: {
                  code: '23502',
                  message: 'null value in column "actor_id" of relation "activity_logs" violates not-null constraint',
                },
              });
            }
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (
              idFilter &&
              updatePayload?.actor_id != null &&
              options?.simulateRollbackFailures?.activityLogs
            ) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated activity_logs rollback error' },
              });
            }
            for (const log of activityLogs) {
              if (matchesRow(log)) {
                log.actor_id = updatePayload.actor_id;
              }
            }
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: null });
        }

        let rows: any[] = [];
        if (table === 'books') {
          if (options?.simulateBooksSnapshotError) {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied for table books' },
            });
          }
          rows = books.filter((b) => matchesRow(b));
          if (options?.simulateDuplicateBookRecord && rows.length === 1) {
            rows = [rows[0], { ...rows[0] }];
          }
        } else if (table === 'categories') {
          categoriesTouches.push('select');
          if (options?.simulateCategoriesPermissionDenied) {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied for table categories' },
            });
          }
          rows = categories.filter((c) => matchesRow(c));
        } else if (table === 'activity_logs') {
          if (options?.simulateActivityLogsSnapshotError) {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied for table activity_logs' },
            });
          }
          rows = activityLogs.filter((l) => matchesRow(l));
        } else if (table === 'loans') {
          if (options?.simulateLoansPermissionDenied === true) {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied for table loans' },
            });
          }
          rows = loans.filter((l) => matchesRow(l));
          if (options?.simulateDuplicateLoanPk && rows.length === 1) {
            rows = [rows[0], { ...rows[0] }];
          }
        } else if (table === 'profiles') {
          rows = Object.values(profiles).filter((p: any) => matchesRow(p));
          if (options?.simulateDuplicateProfileRecord && rows.length === 1) {
            rows = [rows[0], { ...rows[0] }];
          }
        }

        if (orderCol) {
          const col = orderCol;
          const dir = orderAsc ? 1 : -1;
          rows = [...rows].sort((a, b) => {
            const av = String(a?.[col] ?? '');
            const bv = String(b?.[col] ?? '');
            return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
          });
        }
        return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
      };

      const chain: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count === 'exact' && opts?.head) {
            let countFilterVal: any = null;
            const countChain: any = {
              eq(col: string, val: any) {
                if (table === 'loans' && col === 'user_id') {
                  countFilterVal = val;
                }
                return countChain;
              },
              in(_col: string, _vals: any[]) {
                if (table === 'loans' && options?.simulateLoansCountPermissionDenied) {
                  return Promise.resolve({
                    count: null,
                    error: { code: '42501', message: 'permission denied for table loans' },
                  });
                }
                return Promise.resolve({
                  count: activeLoansCountByUser[countFilterVal] ?? 0,
                  error: null,
                });
              },
              then(resolve: any, reject?: any) {
                if (table === 'loans' && options?.simulateLoansCountPermissionDenied) {
                  return Promise.resolve({
                    count: null,
                    error: { code: '42501', message: 'permission denied for table loans' },
                  }).then(resolve, reject);
                }
                const count =
                  table === 'loans' ? (totalLoansCountByUser[countFilterVal] ?? 0) : 0;
                return Promise.resolve({ count, error: null }).then(resolve, reject);
              },
            };
            return countChain;
          }
          return chain;
        },
        eq(col: string, val: any) {
          filterCol = col;
          filterVal = val;
          eqFilters.push({ col, val });
          return chain;
        },
        ilike(col: string, val: string) {
          ilikeFilters.push({ col, val });
          return chain;
        },
        in(col: string, vals: any[]) {
          inFilters.push({ col, vals });
          return chain;
        },
        then(resolve: any, reject?: any) {
          return executeQuery().then(resolve, reject);
        },
        neq(col: string, val: any) {
          neqFilters.push({ col, val });
          return chain;
        },
        order(col?: string, opts?: { ascending?: boolean }) {
          orderCol = col || null;
          orderAsc = opts?.ascending !== false;
          return chain;
        },
        limit(maxRows: number) {
          return executeQuery().then((res: any) => ({
            data: Array.isArray(res?.data) ? res.data.slice(0, maxRows) : [],
            error: res?.error ?? null,
          }));
        },
        maybeSingle() {
          if (table === 'profiles' && options?.simulateProfilesPermissionDenied) {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied for table profiles' },
            });
          }
          if (table === 'profiles' && filterCol === 'id') {
            return Promise.resolve({ data: profiles[filterVal] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          if (table === 'loans') {
            loansMutations.push('delete');
          }
          isDelete = true;
          return chain;
        },
        update(payload: any) {
          if (table === 'loans') {
            loansMutations.push('update');
          }
          isUpdate = true;
          updatePayload = payload;
          return chain;
        },
        insert(payload: any) {
          isInsert = true;
          insertPayload = payload;
          return chain;
        },
      };
      return chain;
    },
    storage: {
      async listBuckets() {
        return {
          data: [
            { id: 'book-covers', name: 'book-covers', public: true },
            { id: 'book-files', name: 'book-files', public: false },
          ],
          error: null,
        };
      },
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            return {
              data: {
                signedUrl: `https://signed.example.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock&exp=${expiresIn}`,
              },
              error: null,
            };
          },
        };
      },
    },
    ...(options?.rpcHandler ? { rpc: options.rpcHandler } : {}),
  };

  return {
    client,
    deletedAuthUsers,
    deletedProfiles,
    updatedAuthUsers,
    createdAuthUsers,
    activityLogs,
    books,
    loans,
    categories,
    categoriesTouches,
    loansMutations,
    profiles,
    authUsersState,
  };
}

async function withServer(
  mockAdmin: ReturnType<typeof createMockSupabaseAdmin>,
  fn: (baseUrl: string, mockAuth: ReturnType<typeof createMockSupabaseAuthClient>) => Promise<void>
) {
  const mockAuth = createMockSupabaseAuthClient();
  const app = createApp({
    getAuthClient: () => ({ client: mockAuth.client }),
    getAdminClient: () => ({ client: mockAdmin.client }),
    superAdminUids: [ENV_SUPER_ADMIN_ID],
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl, mockAuth);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('inspectServerSupabaseEnv validates SUPABASE_URL and distinguishes service_role vs anon/publishable keys without leaking secrets', () => {
  const validJwt = makeFakeJwt({ role: 'service_role', iss: 'supabase' });
  const anonJwt = makeFakeJwt({ role: 'anon', iss: 'supabase' });

  const okJwt = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: validJwt,
  });
  assert.equal(okJwt.hasSupabaseUrl, true);
  assert.equal(okJwt.hasServiceRoleKey, true);
  assert.equal(okJwt.isServiceRoleKeyValid, true);
  assert.equal(okJwt.keyStatus, 'valid_service_role_jwt');

  const okSecret = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fake_key_value_for_testing',
  });
  assert.equal(okSecret.isServiceRoleKeyValid, true);
  assert.equal(okSecret.keyStatus, 'valid_secret_key');

  const badAnon = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: anonJwt,
  });
  assert.equal(badAnon.isServiceRoleKeyValid, false);
  assert.equal(badAnon.keyStatus, 'invalid_anon_jwt');
  assert.ok(!badAnon.error?.includes(anonJwt));

  const badPub = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_wrong_key',
  });
  assert.equal(badPub.isServiceRoleKeyValid, false);
  assert.equal(badPub.keyStatus, 'invalid_publishable_key');
  assert.ok(!badPub.error?.includes('sb_publishable_wrong_key'));

  const missingKey = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://demo.supabase.co',
  });
  assert.equal(missingKey.isServiceRoleKeyValid, false);
  assert.equal(missingKey.keyStatus, 'missing');
});

test('separates Auth client (token verification) from Admin client (profiles query) and excludes admin/super_admin from visitors list', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl, mockAuth) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(mockAuth.verifiedTokens.includes('admin-token'), true);
    assert.equal(Array.isArray(body.visitors), true);
    assert.equal(body.visitors.length, 4);
    assert.equal(
      body.visitors.some((v: any) => v.role === 'admin' || v.role === 'super_admin' || v.id === ENV_SUPER_ADMIN_ID),
      false
    );
  });
});

test('returns diagnostic guidance on permission denied for table profiles without exposing secrets', async () => {
  const mock = createMockSupabaseAdmin({ simulateProfilesPermissionDenied: true });
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.match(body.error, /permission denied for table profiles/i);
    assert.match(body.error, /SUPABASE_SERVICE_ROLE_KEY/);
  });
});

test('rejects unauthenticated delete/archive/restore/list requests with 401', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const listRes = await fetch(`${baseUrl}/api/admin/visitors`);
    assert.equal(listRes.status, 401);

    const postDeleteRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
    });
    assert.equal(postDeleteRes.status, 401);

    const deleteRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'DELETE',
    });
    assert.equal(deleteRes.status, 401);

    const archiveRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`, {
      method: 'POST',
    });
    assert.equal(archiveRes.status, 401);

    const restoreRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_ARCHIVED_ID}/restore`, {
      method: 'POST',
    });
    assert.equal(restoreRes.status, 401);
  });
});

test('supports DELETE /api/admin/visitors/:id for admin deleting visitor with zero loans', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, 'deleted');
    assert.deepEqual(mock.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
    assert.deepEqual(mock.deletedProfiles, [VISITOR_NO_LOANS_ID]);
  });
});

test('remains idempotent when Auth user was already deleted and cleans up leftover profile row', async () => {
  const mock = createMockSupabaseAdmin({ simulateAuthAlreadyDeleted: true });
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(mock.deletedProfiles, [VISITOR_NO_LOANS_ID]);
  });
});

test('rejects non-admin visitor attempting to delete, archive, or restore another visitor with 403', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    for (const path of [
      `/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/delete`,
      `/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`,
      `/api/admin/visitors/${VISITOR_ARCHIVED_ID}/restore`,
    ]) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer visitor-token' },
      });
      assert.equal(res.status, 403);
    }
    assert.equal(mock.deletedAuthUsers.length, 0);
    assert.equal(mock.updatedAuthUsers.length, 0);
  });
});

test('prevents admin from deleting or archiving self (400), another unverified admin (403 ADMIN_DELETE_FORBIDDEN), and verified Super Admin (403 SUPER_ADMIN_PROTECTED)', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const selfRes = await fetch(`${baseUrl}/api/admin/visitors/${ADMIN_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(selfRes.status, 400);

    // ADMIN_2_ID ber-role 'admin' tetapi tidak ada di SUPABASE_SUPER_ADMIN_UIDS dan is_super_admin=false:
    // sistem TIDAK mengasumsikannya sebagai Super Admin, tetap ditolak sebagai ADMIN_DELETE_FORBIDDEN
    const admin2Res = await fetch(`${baseUrl}/api/admin/visitors/${ADMIN_2_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const admin2Body = await admin2Res.json();
    assert.equal(admin2Res.status, 403);
    assert.equal(admin2Body.code, 'ADMIN_DELETE_FORBIDDEN');

    for (const saId of [SUPER_ADMIN_ID, ENV_SUPER_ADMIN_ID]) {
      for (const action of ['delete', 'archive', 'restore']) {
        const res = await fetch(`${baseUrl}/api/admin/visitors/${saId}/${action}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-token' },
        });
        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.code, 'SUPER_ADMIN_PROTECTED');
      }
    }

    assert.equal(mock.deletedAuthUsers.length, 0);
    assert.equal(mock.updatedAuthUsers.length, 0);
  });
});

test('rejects archived/inactive admin accounts in verifyAdminRequest with 403', async () => {
  const mock = createMockSupabaseAdmin();
  mock.profiles[ADMIN_2_ID].is_active = false;
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: { Authorization: 'Bearer admin-2-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.match(body.error, /dinonaktifkan|diarsipkan/i);
  });
});

test('blocks BOTH permanent deletion and archiving when visitor has active/unfinished loans (409 HAS_ACTIVE_LOANS)', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const delRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_ACTIVE_LOAN_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const delBody = await delRes.json();
    assert.equal(delRes.status, 409);
    assert.equal(delBody.code, 'HAS_ACTIVE_LOANS');
    assert.equal(delBody.activeLoans, 1);

    const arcRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_ACTIVE_LOAN_ID}/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const arcBody = await arcRes.json();
    assert.equal(arcRes.status, 409);
    assert.equal(arcBody.code, 'HAS_ACTIVE_LOANS');
    assert.equal(arcBody.activeLoans, 1);

    assert.equal(mock.deletedAuthUsers.length, 0);
    assert.equal(mock.updatedAuthUsers.length, 0);
    assert.deepEqual(mock.loansMutations, []);
  });
});

test('blocks permanent deletion when visitor has completed loan history and returns HAS_LOAN_HISTORY (409)', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, 'HAS_LOAN_HISTORY');
    assert.equal(body.totalLoans, 2);
    assert.equal(body.activeLoans, 0);
    assert.equal(mock.deletedAuthUsers.length, 0);
  });
});

test('permanently deletes Auth user and public.profiles row when visitor has zero loan history while preserving activity_logs and never touching categories', async () => {
  const mock = createMockSupabaseAdmin();
  mock.activityLogs.push({ id: 'log-existing-1', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, 'deleted');
    assert.deepEqual(mock.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
    assert.deepEqual(mock.deletedProfiles, [VISITOR_NO_LOANS_ID]);
    assert.equal(mock.books[0].created_by, null);
    assert.equal(mock.categories[0].created_by, VISITOR_NO_LOANS_ID);
    assert.deepEqual(mock.categoriesTouches, []);
    assert.deepEqual(mock.loansMutations, []);
    // Histori activity_logs lama tetap ada (actor_id dilepas ke null) + log delete_visitor baru ditambahkan
    assert.equal(mock.activityLogs.length, 2);
    const preservedOldLog = mock.activityLogs.find((l) => l.id === 'log-existing-1');
    assert.ok(preservedOldLog);
    assert.equal(preservedOldLog.actor_id, null);
    assert.equal(mock.activityLogs[1].action, 'delete_visitor');
  });
});

test('permanently deletes visitor cleanly even when public.categories returns 42501 permission denied', async () => {
  const mock = createMockSupabaseAdmin({ simulateCategoriesPermissionDenied: true });
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, 'deleted');
    assert.deepEqual(mock.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
    assert.deepEqual(mock.deletedProfiles, [VISITOR_NO_LOANS_ID]);
    assert.deepEqual(mock.categoriesTouches, []);
  });
});

test('rolls back public.profiles, books, and activity_logs.actor_id when Auth deletion fails so no half-deleted state remains', async () => {
  const mock = createMockSupabaseAdmin({ simulateAuthDeleteFailure: true });
  mock.activityLogs.push({ id: 'log-rollback-1', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.rollbackComplete, true);
    assert.match(body.error, /dibatalkan/i);
    // Profile, book created_by, dan actor_id pada log aktivitas telah dipulihkan kembali
    assert.ok(mock.profiles[VISITOR_NO_LOANS_ID]);
    assert.equal(mock.books[0].created_by, VISITOR_NO_LOANS_ID);
    assert.deepEqual(mock.categoriesTouches, []);
    assert.equal(
      mock.activityLogs.some((l) => l.id === 'log-rollback-1' && l.actor_id === VISITOR_NO_LOANS_ID),
      true
    );
    assert.deepEqual(mock.loansMutations, []);
  });
});

test('handles public.profiles deletion failure cleanly without touching Auth and rolls back all references', async () => {
  const mockDbFail = createMockSupabaseAdmin({ simulateProfileDeleteFailure: true });
  mockDbFail.activityLogs.push({ id: 'log-prof-fail', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  await withServer(mockDbFail, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.rollbackComplete, true);
    assert.equal(mockDbFail.deletedAuthUsers.length, 0);
    assert.equal(mockDbFail.deletedProfiles.length, 0);
    assert.ok(mockDbFail.profiles[VISITOR_NO_LOANS_ID]);
    assert.equal(mockDbFail.books[0].created_by, VISITOR_NO_LOANS_ID);
    assert.deepEqual(mockDbFail.categoriesTouches, []);
    assert.equal(mockDbFail.activityLogs[0].actor_id, VISITOR_NO_LOANS_ID);
    assert.deepEqual(mockDbFail.loansMutations, []);
  });

  const mockTriggerProtect = createMockSupabaseAdmin({ simulateProfileDeleteFailure: 'super_admin' });
  await withServer(mockTriggerProtect, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.code, 'SUPER_ADMIN_PROTECTED');
    assert.equal(body.rollbackComplete, true);
    assert.equal(mockTriggerProtect.deletedAuthUsers.length, 0);
    assert.equal(mockTriggerProtect.books[0].created_by, VISITOR_NO_LOANS_ID);
    assert.deepEqual(mockTriggerProtect.categoriesTouches, []);
  });
});

test('returns HTTP 500 ROLLBACK_INCOMPLETE when a single rollback operation returns Supabase { error } and still recovers remaining steps', async () => {
  const mock = createMockSupabaseAdmin({
    simulateAuthDeleteFailure: true,
    simulateRollbackFailures: { profile: true },
  });
  mock.activityLogs.push({ id: 'log-partial-rb', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  const loggedErrors: any[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => {
    loggedErrors.push(args);
  };

  try {
    await withServer(mock, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-token' },
      });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.code, 'ROLLBACK_INCOMPLETE');
      assert.equal(body.rollbackComplete, false);
      assert.equal(Array.isArray(body.rollbackFailures), true);
      assert.equal(body.rollbackFailures.length, 1);
      assert.equal(body.rollbackFailures[0].step, 'restore_profile');
      assert.equal(body.rollbackFailures[0].table, 'profiles');
      // Meski restore_profile gagal, langkah rollback lainnya (books, activity_logs) tetap dijalankan & berhasil dipulihkan
      assert.equal(mock.profiles[VISITOR_NO_LOANS_ID], undefined);
      assert.equal(mock.books[0].created_by, VISITOR_NO_LOANS_ID);
      assert.equal(mock.activityLogs[0].actor_id, VISITOR_NO_LOANS_ID);
      assert.deepEqual(mock.categoriesTouches, []);
      assert.deepEqual(mock.loansMutations, []);
    });
  } finally {
    console.error = origError;
  }

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][0], '[VISITOR_DELETE_ROLLBACK_INCOMPLETE]');
  assert.equal(loggedErrors[0][1].failureCount, 1);
});

test('collects ALL failures and logs them when multiple rollback operations fail simultaneously while continuing recovery of remaining steps', async () => {
  const mock = createMockSupabaseAdmin({
    simulateAuthDeleteFailure: true,
    simulateRollbackFailures: {
      profile: 'throw',
      books: true,
      activityLogs: true,
    },
  });
  mock.activityLogs.push({ id: 'log-multi-rb', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  const loggedErrors: any[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => {
    loggedErrors.push(args);
  };

  try {
    await withServer(mock, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-token' },
      });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.code, 'ROLLBACK_INCOMPLETE');
      assert.equal(body.rollbackComplete, false);
      assert.equal(body.rollbackFailures.length, 3);
      assert.deepEqual(
        body.rollbackFailures.map((f: any) => f.table),
        ['profiles', 'books', 'activity_logs']
      );
      assert.equal(mock.books[0].created_by, null);
      assert.equal(mock.activityLogs[0].actor_id, null);
      assert.deepEqual(mock.categoriesTouches, []);
      assert.deepEqual(mock.loansMutations, []);
    });
  } finally {
    console.error = origError;
  }

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][0], '[VISITOR_DELETE_ROLLBACK_INCOMPLETE]');
  assert.equal(loggedErrors[0][1].failureCount, 3);
});

test('never returns 403 or success when profile deletion fails AND reference rollback also fails (reports HTTP 500 ROLLBACK_INCOMPLETE)', async () => {
  const mock = createMockSupabaseAdmin({
    simulateProfileDeleteFailure: 'super_admin',
    simulateRollbackFailures: { books: true },
  });
  mock.activityLogs.push({ id: 'log-prof-rb-fail', actor_id: VISITOR_NO_LOANS_ID, action: 'login' });

  const origError = console.error;
  console.error = () => {};
  try {
    await withServer(mock, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-token' },
      });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.code, 'ROLLBACK_INCOMPLETE');
      assert.equal(body.rollbackComplete, false);
      assert.equal(body.rollbackFailures.length, 1);
      // activity_logs tetap berhasil dipulihkan walau books gagal
      assert.equal(mock.activityLogs[0].actor_id, VISITOR_NO_LOANS_ID);
    });
  } finally {
    console.error = origError;
  }
});

test('archives and bans visitor with completed loan history cleanly even without optional profiles columns', async () => {
  const mock = createMockSupabaseAdmin({ simulateMissingArchiveCols: true });
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, 'archived');
    assert.equal(mock.updatedAuthUsers.length, 1);
    assert.equal(mock.updatedAuthUsers[0].id, VISITOR_WITH_LOANS_ID);
    assert.equal(mock.updatedAuthUsers[0].payload.ban_duration, '876000h');
    assert.equal(mock.updatedAuthUsers[0].payload.user_metadata.is_active, false);
    assert.deepEqual(mock.loansMutations, []);
    assert.equal(mock.activityLogs[0].action, 'archive_visitor');
  });
});

test('restores archived visitor in Supabase Auth and public.profiles while preserving loan history', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_ARCHIVED_ID}/restore`, {
      method: 'POST',
      headers: { Authorization: 'Bearer super-admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.mode, 'restored');
    assert.equal(mock.updatedAuthUsers.length, 1);
    assert.equal(mock.updatedAuthUsers[0].payload.ban_duration, 'none');
    assert.equal(mock.updatedAuthUsers[0].payload.user_metadata.is_active, true);
    assert.equal(mock.profiles[VISITOR_ARCHIVED_ID].is_active, true);
    assert.equal(mock.profiles[VISITOR_ARCHIVED_ID].archived_at, null);
    assert.deepEqual(mock.loansMutations, []);
    assert.equal(mock.activityLogs[0].action, 'restore_visitor');
  });
});

test('rolls back Supabase Auth update when public.profiles archive or restore update fails unexpectedly, and reports ROLLBACK_INCOMPLETE if Auth rollback also fails', async () => {
  const mock = createMockSupabaseAdmin({ simulateProfileUpdateFailure: true });
  await withServer(mock, async (baseUrl) => {
    const archiveRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const archiveBody = await archiveRes.json();
    assert.equal(archiveRes.status, 500);
    assert.equal(archiveBody.rollbackComplete, true);
    assert.equal(mock.updatedAuthUsers.length, 2);
    assert.equal(mock.updatedAuthUsers[0].payload.ban_duration, '876000h');
    assert.equal(mock.updatedAuthUsers[1].payload.ban_duration, 'none');
    assert.equal(mock.authUsersState[VISITOR_WITH_LOANS_ID].banned_until, null);

    const restoreRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_ARCHIVED_ID}/restore`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    const restoreBody = await restoreRes.json();
    assert.equal(restoreRes.status, 500);
    assert.equal(restoreBody.rollbackComplete, true);
    assert.equal(mock.updatedAuthUsers.length, 4);
    assert.equal(mock.updatedAuthUsers[2].payload.ban_duration, 'none');
    assert.equal(mock.updatedAuthUsers[3].payload.ban_duration, '876000h');
  });

  const mockAuthRollbackFail = createMockSupabaseAdmin({
    simulateProfileUpdateFailure: true,
    simulateAuthRollbackFailure: true,
  });
  const logged: any[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => logged.push(args);
  try {
    await withServer(mockAuthRollbackFail, async (baseUrl) => {
      const archiveFailRes = await fetch(
        `${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-token' },
        }
      );
      const archiveFailBody = await archiveFailRes.json();
      assert.equal(archiveFailRes.status, 500);
      assert.equal(archiveFailBody.code, 'ROLLBACK_INCOMPLETE');
      assert.equal(archiveFailBody.rollbackComplete, false);
    });
  } finally {
    console.error = origError;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], '[VISITOR_ARCHIVE_ROLLBACK_INCOMPLETE]');
});

test('Admin Client sends sb_secret_ ONLY in apikey header (never as Authorization Bearer) for REST and Auth Admin', async () => {
  const capturedRequests: Array<{ url: string; apikey: string | null; authorization: string | null }> = [];
  const fakeSecret = 'sb_secret_test_only_never_bearer_12345';

  const { client, error } = defaultCreateSupabaseAdminClient({
    env: {
      SUPABASE_URL: 'https://demo-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: fakeSecret,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_client_key_should_not_be_used',
    },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedRequests.push({
        url,
        apikey: headers.get('apikey'),
        authorization: headers.get('Authorization'),
      });
      const body = url.includes('/auth/v1/admin/') ? JSON.stringify({ users: [] }) : JSON.stringify([]);
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  assert.equal(error, undefined);
  assert.ok(client);

  await client.from('profiles').select('id').limit(1);
  await client.auth.admin.listUsers({ page: 1, perPage: 1 });

  assert.equal(capturedRequests.length, 2);
  for (const req of capturedRequests) {
    assert.equal(req.apikey, fakeSecret);
    assert.equal(req.authorization, null);
  }
});

test('Admin Client forces service_role JWT on both apikey and Authorization headers for legacy keys', async () => {
  const capturedRequests: Array<{ apikey: string | null; authorization: string | null }> = [];
  const legacyServiceJwt = makeFakeJwt({ role: 'service_role', iss: 'supabase' });

  const { client, error } = defaultCreateSupabaseAdminClient({
    env: {
      SUPABASE_URL: 'https://demo-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: legacyServiceJwt,
    },
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      capturedRequests.push({
        apikey: headers.get('apikey'),
        authorization: headers.get('Authorization'),
      });
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  assert.equal(error, undefined);
  assert.ok(client);

  await client.from('profiles').select('id').limit(1);

  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0].apikey, legacyServiceJwt);
  assert.equal(capturedRequests[0].authorization, `Bearer ${legacyServiceJwt}`);
});

test('probeAdminProfilesAccess reports status/error code cleanly without returning personal profile data', async () => {
  const okMock = createMockSupabaseAdmin();
  const okProbe = await probeAdminProfilesAccess(() => ({ client: okMock.client }));
  assert.deepEqual(okProbe, {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    authAdminOk: true,
  });

  const deniedMock: any = {
    from() {
      return {
        select() {
          return {
            limit() {
              return Promise.resolve({
                error: { code: '42501', message: 'permission denied for table profiles' },
              });
            },
          };
        },
      };
    },
  };
  const deniedProbe = await probeAdminProfilesAccess(() => ({ client: deniedMock }));
  assert.equal(deniedProbe.ok, false);
  assert.equal(deniedProbe.statusCode, 500);
  assert.equal(deniedProbe.profilesOk, false);
  assert.equal(deniedProbe.authAdminOk, false);
  assert.equal(deniedProbe.errorCode, '42501');
  assert.match(deniedProbe.errorMessage || '', /permission denied/i);
});

test('rejects Super Admin deletion and banning even when invoked directly through Supabase Auth Admin API trigger protection', async () => {
  const mock = createMockSupabaseAdmin({ enforceAuthTriggerProtection: true });
  mock.profiles[ENV_SUPER_ADMIN_ID].is_super_admin = true;

  for (const saId of [SUPER_ADMIN_ID, ENV_SUPER_ADMIN_ID]) {
    const deleteRes = await mock.client.auth.admin.deleteUser(saId);
    assert.ok(deleteRes.error);
    assert.match(deleteRes.error.message, /Super Admin dilindungi/i);

    const banRes = await mock.client.auth.admin.updateUserById(saId, { ban_duration: '876000h' });
    assert.ok(banRes.error);
    assert.match(banRes.error.message, /Super Admin dilindungi/i);
    assert.equal(mock.authUsersState[saId].banned_until, null);
    assert.ok(mock.profiles[saId]);
  }

  assert.deepEqual(mock.deletedAuthUsers, []);
  assert.deepEqual(mock.deletedProfiles, []);
});

test('allows verified Super Admin accounts (both role=admin + is_super_admin and role=super_admin) to authenticate and execute full administrator operations', async () => {
  const mock = createMockSupabaseAdmin();
  mock.profiles[ENV_SUPER_ADMIN_ID].is_super_admin = true;

  await withServer(mock, async (baseUrl) => {
    for (const token of ['super-admin-token', 'env-super-admin-token']) {
      const listRes = await fetch(`${baseUrl}/api/admin/visitors`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(listRes.status, 200);
      const listBody = await listRes.json();
      assert.equal(Array.isArray(listBody.visitors), true);
    }

    const archiveRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/archive`, {
      method: 'POST',
      headers: { Authorization: 'Bearer env-super-admin-token' },
    });
    assert.equal(archiveRes.status, 200);

    const restoreRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/restore`, {
      method: 'POST',
      headers: { Authorization: 'Bearer super-admin-token' },
    });
    assert.equal(restoreRes.status, 200);

    const deleteRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer env-super-admin-token' },
    });
    assert.equal(deleteRes.status, 200);
  });
});

test('does NOT trust user-writable user_metadata.is_super_admin when evaluating target visitor protection', async () => {
  const mock = createMockSupabaseAdmin();
  mock.authUsersState[VISITOR_NO_LOANS_ID].user_metadata.is_super_admin = true;

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(mock.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
  });
});

test('POST /api/loans/return-error-log requires auth, logs technical book-return error to server console, and makes zero database mutations', async () => {
  const mock = createMockSupabaseAdmin();
  const capturedLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    capturedLogs.push(args);
  };

  try {
    await withServer(mock, async (baseUrl) => {
      const unauthRes = await fetch(`${baseUrl}/api/loans/return-error-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId: '99999999-9999-4999-8999-999999999999',
          code: 'PGRST116',
          message: 'Cannot coerce the result to a single JSON object',
        }),
      });
      assert.equal(unauthRes.status, 401);

      const authRes = await fetch(`${baseUrl}/api/loans/return-error-log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer visitor-token',
        },
        body: JSON.stringify({
          loanId: '99999999-9999-4999-8999-999999999999',
          code: 'PGRST116',
          message: 'Cannot coerce the result to a single JSON object',
          details: 'The result contains 0 rows',
        }),
      });
      assert.equal(authRes.status, 200);
      const body = await authRes.json();
      assert.deepEqual(body, { logged: true });
    });
  } finally {
    console.error = originalConsoleError;
  }

  const returnErrorLog = capturedLogs.find((entry) => entry[0] === '[RETURN_BOOK_SERVER_LOG]');
  assert.ok(returnErrorLog);
  const payload = returnErrorLog[1] as Record<string, unknown>;
  assert.equal(payload.actorId, VISITOR_NO_LOANS_ID);
  assert.equal(payload.loanId, '99999999-9999-4999-8999-999999999999');
  assert.equal(payload.code, 'PGRST116');
  assert.equal(payload.message, 'Cannot coerce the result to a single JSON object');
  assert.equal(payload.details, 'The result contains 0 rows');
  assert.deepEqual(mock.loansMutations, []);
});

test('POST /api/loans/:id/return updates only target loan by primary key, sets status=returned and returned_at, increments stock once, and preserves loan history', async () => {
  const mock = createMockSupabaseAdmin();
  const initialLoansCount = mock.loans.length;

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.alreadyReturned, false);
    assert.equal(body.stockAdjusted, true);
    assert.equal(body.stockSource, 'application');
    assert.equal(body.loan.id, LOAN_ACTIVE_VISITOR_ID);
    assert.equal(body.loan.status, 'returned');
    assert.ok(body.loan.returned_at);
    assert.equal(body.loan.book?.available_copies, 3);
  });

  // Pastikan jumlah riwayat loans tidak pernah berkurang (riwayat tetap tersimpan)
  assert.equal(mock.loans.length, initialLoansCount);
  assert.equal(mock.loansMutations.includes('delete'), false);

  // Pastikan hanya 1 transaksi yang berubah dan transaksi lain milik user/buku yang sama tetap tidak tersentuh
  const returnedLoan = mock.loans.find((l) => l.id === LOAN_ACTIVE_VISITOR_ID);
  const secondSameBookLoan = mock.loans.find((l) => l.id === LOAN_ACTIVE_SECOND_SAME_BOOK_ID);
  const otherVisitorLoan = mock.loans.find((l) => l.id === LOAN_OTHER_VISITOR_ID);
  assert.equal(returnedLoan?.status, 'returned');
  assert.ok(returnedLoan?.returned_at);
  assert.equal(secondSameBookLoan?.status, 'borrowed');
  assert.equal(secondSameBookLoan?.returned_at, null);
  assert.equal(otherVisitorLoan?.status, 'approved');

  // Pastikan stok bertambah tepat +1 (dari 2 ke 3) dan tercatat di activity_logs
  const book = mock.books.find((b) => b.id === BOOK_MAIN_ID);
  assert.equal(book?.available_copies, 3);
  assert.ok(mock.activityLogs.some((log) => log.action === 'return_loan' && log.entity_id === LOAN_ACTIVE_VISITOR_ID));
});

test('POST /api/loans/:id/return does NOT double-increment stock when a database trigger already incremented available_copies', async () => {
  const mock = createMockSupabaseAdmin({ simulateReturnStockTrigger: true });

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.stockSource, 'trigger');
    assert.equal(body.loan.book?.available_copies, 3);
  });

  const book = mock.books.find((b) => b.id === BOOK_MAIN_ID);
  assert.equal(book?.available_copies, 3);
});

test('POST /api/loans/:id/return is idempotent for already-returned loans and handles validation/authorization/missing/duplicate cases cleanly without PGRST116', async () => {
  const mock = createMockSupabaseAdmin();

  await withServer(mock, async (baseUrl) => {
    // 1. Sudah returned => 200 idempoten, stok TIDAK bertambah lagi, returned_at tidak berubah
    const alreadyRes = await fetch(`${baseUrl}/api/loans/${LOAN_RETURNED_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(alreadyRes.status, 200);
    const alreadyBody = await alreadyRes.json();
    assert.equal(alreadyBody.alreadyReturned, true);
    assert.equal(alreadyBody.stockAdjusted, false);
    assert.equal(alreadyBody.loan.returned_at, '2026-11-05T10:00:00.000Z');
    assert.equal(mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 2);

    // 2. ID bukan UUID => 400
    const badIdRes = await fetch(`${baseUrl}/api/loans/not-a-uuid/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(badIdRes.status, 400);

    // 3. Data tidak ditemukan => 404 LOAN_NOT_FOUND
    const notFoundRes = await fetch(
      `${baseUrl}/api/loans/99999999-9999-4999-8999-999999999999/return`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer visitor-token' },
      }
    );
    assert.equal(notFoundRes.status, 404);
    const notFoundBody = await notFoundRes.json();
    assert.equal(notFoundBody.code, 'LOAN_NOT_FOUND');

    // 4. Transaksi milik pengguna lain ditolak untuk visitor => 403 FORBIDDEN
    const forbiddenRes = await fetch(`${baseUrl}/api/loans/${LOAN_OTHER_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(forbiddenRes.status, 403);
    const forbiddenBody = await forbiddenRes.json();
    assert.equal(forbiddenBody.code, 'FORBIDDEN');

    // 5. Transaksi status pending ditolak => 409 INVALID_LOAN_STATUS
    const pendingRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(pendingRes.status, 409);
    const pendingBody = await pendingRes.json();
    assert.equal(pendingBody.code, 'INVALID_LOAN_STATUS');

    // 6. Admin tetap berwenang mengonfirmasi pengembalian milik anggota lain
    const adminReturnRes = await fetch(`${baseUrl}/api/loans/${LOAN_OTHER_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminReturnRes.status, 200);
    const adminReturnBody = await adminReturnRes.json();
    assert.equal(adminReturnBody.loan.status, 'returned');
    assert.equal(mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 3);
  });

  // 7. Duplikasi transaksi saat lookup => 409 DUPLICATE_LOAN_TRANSACTION
  const dupMock = createMockSupabaseAdmin({ simulateDuplicateLoanPk: true });
  await withServer(dupMock, async (baseUrl) => {
    const dupRes = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.equal(dupBody.code, 'DUPLICATE_LOAN_TRANSACTION');
  });

  // 8. Race condition (0 baris terupdate karena permintaan paralel baru saja menyimpan returned) => 200 alreadyReturned
  const raceMock = createMockSupabaseAdmin({ simulateLoanUpdateZeroRowsBecauseReturned: true });
  await withServer(raceMock, async (baseUrl) => {
    const raceRes = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(raceRes.status, 200);
    const raceBody = await raceRes.json();
    assert.equal(raceBody.success, true);
    assert.equal(raceBody.alreadyReturned, true);
    assert.equal(raceBody.loan.status, 'returned');
  });
});

test('POST /api/loans/:id/return succeeds for approved loan before due_at (e.g. due_at 2026-11-21) even when other user loans are already returned', async () => {
  const mock = createMockSupabaseAdmin();
  const targetLoan = mock.loans.find((l) => l.id === LOAN_ACTIVE_VISITOR_ID)!;
  targetLoan.status = 'approved';
  targetLoan.due_at = '2026-11-21T23:59:59.000Z';

  // Tambahkan satu lagi transaksi returned sehingga user memiliki 2 transaksi returned + 1 transaksi approved
  mock.loans.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
    user_id: VISITOR_NO_LOANS_ID,
    book_id: BOOK_MAIN_ID,
    status: 'returned',
    requested_at: '2026-10-20T08:00:00.000Z',
    approved_at: '2026-10-20T09:00:00.000Z',
    due_at: '2026-10-27T09:00:00.000Z',
    returned_at: '2026-10-25T11:00:00.000Z',
    admin_note: null,
    created_at: '2026-10-20T08:00:00.000Z',
    updated_at: '2026-10-25T11:00:00.000Z',
  });

  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.alreadyReturned, false);
    assert.equal(body.loan.id, LOAN_ACTIVE_VISITOR_ID);
    assert.equal(body.loan.status, 'returned');
    assert.ok(body.loan.returned_at);
    assert.equal(body.loan.book?.available_copies, 3);
  });
});

test('POST /api/loans/:id/return detects and logs exact query name when >1 record is returned without masking duplication', async () => {
  const scenarios = [
    {
      name: 'verifyAuthenticatedUser.profiles_by_id',
      options: { simulateDuplicateProfileRecord: true },
      expectedStatus: 409,
    },
    {
      name: 'beforeBook.books_by_id',
      options: { simulateDuplicateBookRecord: true },
      expectedStatus: 409,
    },
    {
      name: 'loans_update_by_pk',
      options: { simulateDuplicateLoanUpdate: true },
      expectedStatus: 409,
    },
  ];

  for (const scenario of scenarios) {
    const logs: unknown[][] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const mock = createMockSupabaseAdmin(scenario.options);
      await withServer(mock, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
          method: 'POST',
          headers: { Authorization: 'Bearer visitor-token' },
        });
        assert.equal(res.status, scenario.expectedStatus);
      });
    } finally {
      console.error = origErr;
    }

    const anomalyLog = logs.find(
      (entry) =>
        entry[0] === '[RETURN_BOOK_MULTIPLE_RECORDS]' &&
        (entry[1] as Record<string, unknown>)?.query === scenario.name
    );
    assert.ok(anomalyLog, `Expected [RETURN_BOOK_MULTIPLE_RECORDS] log for ${scenario.name}`);
  }
});

test('inspectServerSupabaseEnv rejects unrecognized_format SUPABASE_SERVICE_ROLE_KEY as invalid', () => {
  const result = inspectServerSupabaseEnv({
    SUPABASE_URL: 'https://projref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'not-a-valid-key-format',
  });

  assert.equal(result.hasSupabaseUrl, true);
  assert.equal(result.hasServiceRoleKey, true);
  assert.equal(result.keyStatus, 'unrecognized_format');
  assert.equal(result.isServiceRoleKeyValid, false);
  assert.equal(result.serviceRoleKey, '');
  assert.ok(result.error);
});

test('probeAdminReturnTablesAccess and GET /api/health?probe=return detect 42501 on loans without leaking secrets', async () => {
  const okMock = createMockSupabaseAdmin();
  const okProbe = await probeAdminReturnTablesAccess(
    () => ({ client: okMock.client }),
    {
      url: 'https://projref.supabase.co',
      authApiKey: '',
      serviceRoleKey: '',
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      isServiceRoleKeyValid: true,
      keyStatus: 'valid_secret_key',
      hasUrlMismatch: false,
    }
  );
  assert.deepEqual(okProbe, {
    ok: true,
    statusCode: 200,
    profilesOk: true,
    loansOk: true,
    booksOk: true,
    keyStatus: 'valid_secret_key',
  });

  const deniedMock = createMockSupabaseAdmin({ simulateLoansPermissionDenied: true });
  await withServer(deniedMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health?probe=return`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.returnTablesProbe?.ok, false);
    assert.equal(body.returnTablesProbe?.statusCode, 500);
    assert.equal(body.returnTablesProbe?.profilesOk, true);
    assert.equal(body.returnTablesProbe?.booksOk, true);
    assert.equal(body.returnTablesProbe?.loansOk, false);
    assert.equal(body.returnTablesProbe?.errorCode, '42501');
    assert.match(body.returnTablesProbe?.errorMessage || '', /permission denied for table loans/i);
  });
});

test('POST /api/loans/:id/return reports DB_PERMISSION_DENIED and logs [RETURN_BOOK_PERMISSION_DENIED] cleanly on 42501 SELECT or UPDATE', async () => {
  const scenarios: Array<{
    option: true | 'update';
    expectedOperation: 'select' | 'update';
  }> = [
    { option: true, expectedOperation: 'select' },
    { option: 'update', expectedOperation: 'update' },
  ];

  for (const scenario of scenarios) {
    const logs: unknown[][] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };

    const mock = createMockSupabaseAdmin({
      simulateLoansPermissionDenied: scenario.option,
    });
    const beforeCopies = mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies;

    try {
      await withServer(mock, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
          method: 'POST',
          headers: { Authorization: 'Bearer visitor-token' },
        });
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.code, 'DB_PERMISSION_DENIED');
        assert.match(body.error, /42501/);
      });
    } finally {
      console.error = origErr;
    }

    assert.equal(
      mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies,
      beforeCopies,
      'Book stock must remain unchanged when loans returns 42501'
    );

    const permissionLog = logs.find(
      (entry) =>
        entry[0] === '[RETURN_BOOK_PERMISSION_DENIED]' &&
        (entry[1] as Record<string, unknown>)?.operation === scenario.expectedOperation
    );
    assert.ok(
      permissionLog,
      `Expected [RETURN_BOOK_PERMISSION_DENIED] log for operation=${scenario.expectedOperation}`
    );
    const logMeta = permissionLog[1] as Record<string, unknown>;
    assert.equal(logMeta.table, 'loans');
    assert.equal(logMeta.code, '42501');
    assert.ok('keyStatus' in logMeta);
    assert.equal('serviceRoleKey' in logMeta, false);
  }
});

test('POST /api/loans/:id/approve and /reject enforce Admin role and pending-only state transitions without due_at via backend admin client', async () => {
  const mock = createMockSupabaseAdmin();

  await withServer(mock, async (baseUrl) => {
    // 1. Visitor tidak boleh menyetujui maupun menolak peminjaman
    const visitorApproveRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ adminNote: 'Coba setujui sendiri' }),
    });
    assert.equal(visitorApproveRes.status, 403);
    const visitorApproveBody = await visitorApproveRes.json();
    assert.equal(visitorApproveBody.code, 'FORBIDDEN');

    const visitorRejectRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ reason: 'Coba tolak' }),
    });
    assert.equal(visitorRejectRes.status, 403);

    // 2. Admin dapat menyetujui pinjaman berstatus pending tanpa menentukan durasi / due_at
    const adminApproveRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ adminNote: 'Disetujui oleh admin perpustakaan' }),
    });
    assert.equal(adminApproveRes.status, 200);
    const approveBody = await adminApproveRes.json();
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.loan.status, 'approved');
    assert.ok(approveBody.loan.approved_at);
    assert.equal(approveBody.loan.due_at, null);

    // 3. Pinjaman yang sudah diproses tidak dapat disetujui atau ditolak ulang
    const reapproveRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({}),
    });
    assert.equal(reapproveRes.status, 409);

    const rejectAfterApproveRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ reason: 'Terlambat' }),
    });
    assert.equal(rejectAfterApproveRes.status, 409);
  });

  // 4. Admin dapat menolak pinjaman pending lain
  const rejectMock = createMockSupabaseAdmin();
  await withServer(rejectMock, async (baseUrl) => {
    const adminRejectRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ reason: 'Sedang dalam inventarisasi' }),
    });
    assert.equal(adminRejectRes.status, 200);
    const rejectBody = await adminRejectRes.json();
    assert.equal(rejectBody.success, true);
    assert.equal(rejectBody.loan.status, 'rejected');
    assert.equal(rejectBody.loan.admin_note, 'Sedang dalam inventarisasi');
  });
});

test('POST /api/loans/:id/approve decrements available_copies once without double-decrement when DB trigger is present', async () => {
  // Without DB trigger: 2 -> 1
  const noTriggerMock = createMockSupabaseAdmin();
  await withServer(noTriggerMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stockSource, 'application');
    assert.equal(body.stockAdjusted, true);
    assert.equal(body.loan.book?.available_copies, 1);
    assert.equal(body.loan.due_at, null);
  });
  assert.equal(noTriggerMock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 1);

  // With DB trigger: 2 -> 1 (not 0)
  const triggerMock = createMockSupabaseAdmin({ simulateApproveStockTrigger: true });
  await withServer(triggerMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stockSource, 'trigger');
    assert.equal(body.loan.book?.available_copies, 1);
  });
  assert.equal(triggerMock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 1);
});

test('POST /api/books/:id/read-url enforces active approved loan or admin role before issuing signed URL', async () => {
  const mock = createMockSupabaseAdmin();
  // Set active loan due_at strictly in the future so it is valid
  const futureDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  mock.loans[0].due_at = futureDue;
  mock.loans[1].due_at = futureDue;

  await withServer(mock, async (baseUrl) => {
    // 1. Visitor with active unexpired loan gets signed URL
    const okRes = await fetch(`${baseUrl}/api/books/${BOOK_MAIN_ID}/read-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.success, true);
    assert.match(okBody.url, /book-files\/documents\/arsitektur\.pdf/);

    // 2. Admin can always read digital books with file_path
    const adminRes = await fetch(`${baseUrl}/api/books/${BOOK_MAIN_ID}/read-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminRes.status, 200);

    // 3. Expire visitor's active loans -> 403 LOAN_EXPIRED
    const pastDue = '2020-01-01T00:00:00.000Z';
    mock.loans[0].due_at = pastDue;
    mock.loans[1].due_at = pastDue;
    const expiredRes = await fetch(`${baseUrl}/api/books/${BOOK_MAIN_ID}/read-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(expiredRes.status, 403);
    const expiredBody = await expiredRes.json();
    assert.equal(expiredBody.code, 'LOAN_EXPIRED');

    // 4. Visitor with zero loans for BOOK_MAIN_ID -> 403 FORBIDDEN
    mock.loans[0].status = 'returned';
    mock.loans[1].status = 'returned';
    const forbiddenRes = await fetch(`${baseUrl}/api/books/${BOOK_MAIN_ID}/read-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(forbiddenRes.status, 403);
    const forbiddenBody = await forbiddenRes.json();
    assert.equal(forbiddenBody.code, 'FORBIDDEN');
  });
});

test('GET /api/health?probe=all reports database tables and Supabase storage bucket visibility without secrets', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health?probe=all`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.returnTablesProbe?.ok, true);
    assert.equal(body.catalogAndStorageProbe?.ok, true);
    assert.equal(body.catalogAndStorageProbe?.categoriesOk, true);
    assert.equal(body.catalogAndStorageProbe?.activityLogsOk, true);
    assert.equal(body.catalogAndStorageProbe?.storageOk, true);
    assert.equal(body.catalogAndStorageProbe?.bookCoversBucketExists, true);
    assert.equal(body.catalogAndStorageProbe?.bookCoversPublic, true);
    assert.equal(body.catalogAndStorageProbe?.bookFilesBucketExists, true);
    assert.equal(body.catalogAndStorageProbe?.bookFilesPublic, false);
    assert.ok(body.migrationProbe);
    assert.equal(body.migrationProbe?.profilesArchiveColumnsOk, true);
    assert.ok(body.envAudit);
  });
});

test('inspectVercelEnvChecklist audits all Vercel env vars and never leaks secret key values', () => {
  const secretValue = 'sb_secret_top_secret_do_not_leak_value';
  const pubValue = 'sb_publishable_abcdefghijklmnopqrstuvwxyz_12345';
  const validAudit = inspectVercelEnvChecklist({
    VITE_SUPABASE_URL: 'https://ntecwovfkvijxordpvma.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: pubValue,
    VITE_APP_URL: 'https://perpustakaan-merah-putih.vercel.app/',
    VITE_ADMIN_EMAIL: 'admin@perpustakaan.go.id',
    SUPABASE_URL: 'https://ntecwovfkvijxordpvma.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: secretValue,
    SUPABASE_SUPER_ADMIN_UIDS: '00000000-0000-4000-8000-000000000001',
  });

  assert.equal(validAudit.hasServerSupabaseUrl, true);
  assert.equal(validAudit.hasViteSupabaseUrl, true);
  assert.equal(validAudit.supabaseUrlHost, 'ntecwovfkvijxordpvma.supabase.co');
  assert.equal(validAudit.hasUrlMismatch, false);
  assert.equal(validAudit.hasVitePublishableKey, true);
  assert.equal(validAudit.isVitePublishableKeySafe, true);
  assert.equal(validAudit.vitePublishableKeyStatus, 'valid_publishable_or_anon');
  assert.equal(validAudit.hasViteAppUrl, true);
  assert.equal(validAudit.viteAppUrlValid, true);
  assert.equal(validAudit.viteAppUrl, 'https://perpustakaan-merah-putih.vercel.app');
  assert.equal(validAudit.hasViteAdminEmail, true);
  assert.equal(validAudit.hasServiceRoleKey, true);
  assert.equal(validAudit.serviceRoleKeyValid, true);
  assert.equal(validAudit.serviceRoleKeyStatus, 'valid_secret_key');
  assert.equal(validAudit.hasSuperAdminUids, true);
  assert.equal(validAudit.superAdminUidsCount, 1);
  assert.equal(validAudit.allRequiredPresentAndValid, true);

  const serialized = JSON.stringify(validAudit);
  assert.equal(serialized.includes(secretValue), false);
  assert.equal(serialized.includes(pubValue), false);

  const exposedFrontendSecretAudit = inspectVercelEnvChecklist({
    VITE_SUPABASE_URL: 'https://projref.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: secretValue,
    VITE_APP_URL: 'https://perpustakaan-merah-putih.vercel.app',
    SUPABASE_URL: 'https://projref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: secretValue,
  });
  assert.equal(exposedFrontendSecretAudit.isVitePublishableKeySafe, false);
  assert.equal(exposedFrontendSecretAudit.vitePublishableKeyStatus, 'invalid_secret_key_exposed');
  assert.equal(exposedFrontendSecretAudit.allRequiredPresentAndValid, false);
  assert.equal(JSON.stringify(exposedFrontendSecretAudit).includes(secretValue), false);
});

test('GET /api/loans enforces authentication, scopes visitor to own loans, and shows all loans to admin with DB 42501 guard', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const unauthRes = await fetch(`${baseUrl}/api/loans`);
    assert.equal(unauthRes.status, 401);

    const visitorRes = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(visitorRes.status, 200);
    const visitorBody = await visitorRes.json();
    assert.equal(Array.isArray(visitorBody.loans), true);
    assert.equal(visitorBody.loans.every((l: any) => l.user_id === VISITOR_NO_LOANS_ID), true);
    assert.equal(visitorBody.loans.some((l: any) => l.id === LOAN_OTHER_VISITOR_ID), false);
    assert.ok(visitorBody.loans[0].book);

    const adminRes = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminRes.status, 200);
    const adminBody = await adminRes.json();
    assert.equal(adminBody.loans.length, mock.loans.length);
    assert.equal(adminBody.loans.some((l: any) => l.id === LOAN_OTHER_VISITOR_ID), true);
  });

  const deniedMock = createMockSupabaseAdmin({ simulateLoansPermissionDenied: true });
  await withServer(deniedMock, async (baseUrl) => {
    const deniedRes = await fetch(`${baseUrl}/api/loans`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(deniedRes.status, 500);
    const deniedBody = await deniedRes.json();
    assert.equal(deniedBody.code, 'DB_PERMISSION_DENIED');
  });
});

test('POST /api/loans creates pending loan with due_at=null, prevents duplicates and out-of-stock requests, and leaves book stock unchanged until approval', async () => {
  const SECOND_BOOK_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const EMPTY_STOCK_BOOK_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const mock = createMockSupabaseAdmin();
  mock.books.push(
    {
      id: SECOND_BOOK_UUID,
      title: 'Sejarah Nusantara',
      author: 'Moh. Hatta',
      cover_path: null,
      category_id: 'cat-1',
      is_published: true,
      is_archived: false,
      total_copies: 3,
      available_copies: 3,
      created_by: ADMIN_ID,
      created_at: '2026-11-03T08:00:00.000Z',
    },
    {
      id: EMPTY_STOCK_BOOK_UUID,
      title: 'Buku Stok Kosong',
      author: 'Anonim',
      cover_path: null,
      category_id: 'cat-1',
      is_published: true,
      is_archived: false,
      total_copies: 1,
      available_copies: 0,
      created_by: ADMIN_ID,
      created_at: '2026-11-04T08:00:00.000Z',
    }
  );

  await withServer(mock, async (baseUrl) => {
    const unauthRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: SECOND_BOOK_UUID }),
    });
    assert.equal(unauthRes.status, 401);

    const outOfStockRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ bookId: EMPTY_STOCK_BOOK_UUID }),
    });
    assert.equal(outOfStockRes.status, 409);
    const outOfStockBody = await outOfStockRes.json();
    assert.equal(outOfStockBody.code, 'BOOK_OUT_OF_STOCK');

    // BOOK_MAIN_ID sudah memiliki pending/approved loan milik VISITOR_NO_LOANS_ID -> harus ditolak 409
    const dupRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ bookId: BOOK_MAIN_ID }),
    });
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.equal(dupBody.code, 'DUPLICATE_ACTIVE_LOAN');

    const createRes = await fetch(`${baseUrl}/api/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ bookId: SECOND_BOOK_UUID, notes: 'Untuk riset' }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.loan.status, 'pending');
    assert.equal(createBody.loan.due_at, null);
    assert.equal(createBody.loan.book_id, SECOND_BOOK_UUID);
    assert.equal(createBody.loan.admin_note, 'Catatan peminjam: Untuk riset');
    assert.equal(
      mock.books.find((b) => b.id === SECOND_BOOK_UUID)?.available_copies,
      3,
      'Book available_copies must not decrement until Admin approves'
    );
  });
});

test('GET /api/books, POST/PATCH/DELETE /api/admin/books, and GET /api/admin/activity-logs enforce roles and tolerate categories 42501', async () => {
  const ARCHIVED_BOOK_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  const mock = createMockSupabaseAdmin({ simulateCategoriesPermissionDenied: true });
  mock.books.push({
    id: ARCHIVED_BOOK_UUID,
    title: 'Arsip Lama',
    author: 'Penulis Arsip',
    cover_path: null,
    category_id: 'cat-1',
    is_published: true,
    is_archived: true,
    total_copies: 1,
    available_copies: 1,
    created_by: ADMIN_ID,
    created_at: '2026-11-05T08:00:00.000Z',
  });
  mock.activityLogs.push({ id: 'log-1', actor_id: ADMIN_ID, action: 'login', entity_type: 'auth' });

  await withServer(mock, async (baseUrl) => {
    const visitorBooksRes = await fetch(`${baseUrl}/api/books`, {
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(visitorBooksRes.status, 200);
    const visitorBooksBody = await visitorBooksRes.json();
    assert.equal(visitorBooksBody.books.some((b: any) => b.id === ARCHIVED_BOOK_UUID), false);

    const adminBooksRes = await fetch(`${baseUrl}/api/books`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminBooksRes.status, 200);
    const adminBooksBody = await adminBooksRes.json();
    assert.equal(adminBooksBody.books.some((b: any) => b.id === ARCHIVED_BOOK_UUID), true);

    const visitorAddRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({ title: 'Buku Ilegal', category_id: 'cat-1' }),
    });
    assert.equal(visitorAddRes.status, 403);

    const adminAddRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ title: 'Buku Konstitusi RI', category_id: 'cat-1', total_copies: 3 }),
    });
    assert.equal(adminAddRes.status, 201);
    const addedBody = await adminAddRes.json();
    const newBookId = addedBody.book.id;

    const patchRes = await fetch(`${baseUrl}/api/admin/books/${newBookId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ title: 'Buku Konstitusi RI Edisi Revisi' }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.book.title, 'Buku Konstitusi RI Edisi Revisi');

    // BOOK_MAIN_ID masih punya pinjaman aktif -> harus ditolak 409
    const delBusyRes = await fetch(`${baseUrl}/api/admin/books/${BOOK_MAIN_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(delBusyRes.status, 409);

    const delOkRes = await fetch(`${baseUrl}/api/admin/books/${newBookId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(delOkRes.status, 200);

    const visitorLogsRes = await fetch(`${baseUrl}/api/admin/activity-logs`, {
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(visitorLogsRes.status, 403);

    const adminLogsRes = await fetch(`${baseUrl}/api/admin/activity-logs?limit=10`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(adminLogsRes.status, 200);
    const logsBody = await adminLogsRes.json();
    assert.equal(Array.isArray(logsBody.logs), true);
    assert.ok(logsBody.logs.length >= 1);
  });
});

test('GET /api/admin/visitors disables ETag and sends Cache-Control: no-store so responses never return HTTP 304', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res1 = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res1.status, 200);
    assert.match(res1.headers.get('cache-control') || '', /no-store/i);
    assert.equal(res1.headers.get('pragma'), 'no-cache');
    assert.equal(res1.headers.get('etag'), null);

    const res2 = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'If-None-Match': 'W/"1234-weak-etag"',
      },
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.headers.get('etag'), null);
    const body2 = await res2.json();
    assert.equal(Array.isArray(body2.visitors), true);
  });
});

test('POST /api/admin/visitors/:id safely handles direct delete, archive/restore/update action dispatch, invalid action (400), and invalid JSON (400)', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    // 1. Invalid JSON body returns 400 INVALID_JSON instead of HTTP 500
    const badJsonRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: '{"broken": ',
    });
    assert.equal(badJsonRes.status, 400);
    const badJsonBody = await badJsonRes.json();
    assert.equal(badJsonBody.code, 'INVALID_JSON');

    // 2. Unrecognized action returns 400 INVALID_VISITOR_ACTION instead of HTTP 500
    const badActionRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ action: 'unknown_action' }),
    });
    assert.equal(badActionRes.status, 400);
    const badActionBody = await badActionRes.json();
    assert.equal(badActionBody.code, 'INVALID_VISITOR_ACTION');

    // 3. POST /api/admin/visitors/:id with action='update'
    const updateRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ action: 'update', full_name: 'Budi Pembaruan', username: 'budi_baru' }),
    });
    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json();
    assert.equal(updateBody.visitor.full_name, 'Budi Pembaruan');

    // 4. POST /api/admin/visitors/:id with action='archive' and action='restore'
    const arcRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ action: 'archive' }),
    });
    assert.equal(arcRes.status, 200);
    assert.equal((await arcRes.json()).mode, 'archived');

    const resRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ action: 'restore' }),
    });
    assert.equal(resRes.status, 200);
    assert.equal((await resRes.json()).mode, 'restored');

    // 5. Direct POST /api/admin/visitors/:id (empty body) performs safe permanent delete
    const delRes = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.mode, 'deleted');
    assert.deepEqual(mock.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
  });
});

test('POST /api/admin/visitors/:id/delete handles NOT NULL activity_logs.actor_id (23502) and rolls back deleted log rows if Auth deletion fails, and maps 23503 FK violation to 409', async () => {
  // 1. Happy path when activity_logs.actor_id is still NOT NULL (23502)
  const mockSuccess = createMockSupabaseAdmin({ simulateActivityLogsActorNotNull: true });
  mockSuccess.activityLogs.push({
    id: 'log-not-null-1',
    actor_id: VISITOR_NO_LOANS_ID,
    action: 'login',
  });
  await withServer(mockSuccess, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'deleted');
    assert.deepEqual(mockSuccess.deletedAuthUsers, [VISITOR_NO_LOANS_ID]);
    assert.deepEqual(mockSuccess.deletedProfiles, [VISITOR_NO_LOANS_ID]);
    assert.equal(
      mockSuccess.activityLogs.some((l) => l.id === 'log-not-null-1'),
      false
    );
  });

  // 2. Rollback re-inserts deleted activity_logs row if subsequent Auth delete fails
  const mockFailRollback = createMockSupabaseAdmin({
    simulateActivityLogsActorNotNull: true,
    simulateAuthDeleteFailure: true,
  });
  mockFailRollback.activityLogs.push({
    id: 'log-not-null-rb',
    actor_id: VISITOR_NO_LOANS_ID,
    action: 'login',
  });
  await withServer(mockFailRollback, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.rollbackComplete, true);
    assert.ok(mockFailRollback.profiles[VISITOR_NO_LOANS_ID]);
    assert.equal(
      mockFailRollback.activityLogs.some(
        (l) => l.id === 'log-not-null-rb' && l.actor_id === VISITOR_NO_LOANS_ID
      ),
      true
    );
  });

  // 3. 23503 FK conflict on profiles delete maps cleanly to 409 VISITOR_DELETE_CONFLICT
  const mockFkConflict = createMockSupabaseAdmin({ simulateProfileDeleteFailure: 'fk_conflict' });
  await withServer(mockFkConflict, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'VISITOR_DELETE_CONFLICT');
    assert.equal(body.rollbackComplete, true);
  });
});

test('POST /api/admin/visitors and PATCH /api/admin/visitors/:id enforce validation, uniqueness, role protection, and rollback on partial failure', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    // 1. Visitor role forbidden
    const forbiddenCreate = await fetch(`${baseUrl}/api/admin/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer visitor-token',
      },
      body: JSON.stringify({
        full_name: 'Anggota Uji',
        username: 'anggotauji',
        email: 'anggota@example.com',
        password: 'password123',
      }),
    });
    assert.equal(forbiddenCreate.status, 403);

    // 2. Duplicate username rejected with 409 USERNAME_TAKEN
    const dupUsernameCreate = await fetch(`${baseUrl}/api/admin/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        full_name: 'Duplikat Budi',
        username: 'BUDISANTOSO',
        email: 'newbudi@example.com',
        password: 'password123',
      }),
    });
    assert.equal(dupUsernameCreate.status, 409);
    assert.equal((await dupUsernameCreate.json()).code, 'USERNAME_TAKEN');

    // 3. Valid create succeeds (201)
    const createOk = await fetch(`${baseUrl}/api/admin/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        full_name: 'Dewi Kartika',
        username: 'dewikartika',
        email: 'dewi@example.com',
        password: 'password123',
      }),
    });
    assert.equal(createOk.status, 201);
    const createdBody = await createOk.json();
    assert.equal(createdBody.success, true);
    assert.equal(createdBody.visitor.full_name, 'Dewi Kartika');
    assert.equal(createdBody.visitor.username, 'dewikartika');
    assert.equal(createdBody.visitor.email, 'dewi@example.com');
    const createdId = createdBody.visitor.id;

    // 4. PATCH edit created visitor succeeds (200) and duplicate username rejected (409)
    const dupEdit = await fetch(`${baseUrl}/api/admin/visitors/${createdId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        full_name: 'Dewi Kartika Update',
        username: 'sitiaminah',
      }),
    });
    assert.equal(dupEdit.status, 409);
    assert.equal((await dupEdit.json()).code, 'USERNAME_TAKEN');

    const editOk = await fetch(`${baseUrl}/api/admin/visitors/${createdId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        full_name: 'Dewi Kartika Sari',
        username: 'dewisari',
      }),
    });
    assert.equal(editOk.status, 200);
    const editedBody = await editOk.json();
    assert.equal(editedBody.visitor.full_name, 'Dewi Kartika Sari');
    assert.equal(editedBody.visitor.username, 'dewisari');
    assert.equal(mock.profiles[createdId].full_name, 'Dewi Kartika Sari');

    // 5. Cannot edit admin or super_admin via visitor endpoint
    const editAdminRes = await fetch(`${baseUrl}/api/admin/visitors/${ADMIN_2_ID}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ full_name: 'Ubah Admin', username: 'ubahadmin' }),
    });
    assert.equal(editAdminRes.status, 403);
    assert.equal((await editAdminRes.json()).code, 'ADMIN_EDIT_FORBIDDEN');

    const editSuperAdminRes = await fetch(`${baseUrl}/api/admin/visitors/${SUPER_ADMIN_ID}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ full_name: 'Ubah SA', username: 'ubahsa' }),
    });
    assert.equal(editSuperAdminRes.status, 403);
    assert.equal((await editSuperAdminRes.json()).code, 'SUPER_ADMIN_PROTECTED');
  });

  // 6. When profile insert fails after Auth createUser, Auth user is rolled back cleanly
  const rollbackMock = createMockSupabaseAdmin({ simulateProfileInsertFailure: true });
  await withServer(rollbackMock, async (baseUrl) => {
    const failedCreate = await fetch(`${baseUrl}/api/admin/visitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        full_name: 'Gagal Profil',
        username: 'gagalprofil',
        email: 'gagal@example.com',
        password: 'password123',
      }),
    });
    assert.equal(failedCreate.status, 500);
    const failedBody = await failedCreate.json();
    assert.equal(failedBody.rollbackComplete, true);
    assert.equal(rollbackMock.deletedAuthUsers.length, 1);
  });
});

test('POST /api/admin/visitors/:id/delete fails closed on snapshot 42501, loans count 42501, and non-404 auth lookup errors without mutating profiles or auth.users', async () => {
  // 1. activity_logs snapshot 42501 aborts deletion before touching profiles or Auth
  const logsDeniedMock = createMockSupabaseAdmin({ simulateActivityLogsSnapshotError: true });
  await withServer(logsDeniedMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'DB_PERMISSION_DENIED');
    assert.match(body.error, /snapshot activity_logs/i);
    assert.equal(logsDeniedMock.deletedProfiles.length, 0);
    assert.equal(logsDeniedMock.deletedAuthUsers.length, 0);
    assert.ok(logsDeniedMock.profiles[VISITOR_NO_LOANS_ID]);
  });

  // 2. books snapshot 42501 aborts deletion before touching profiles or Auth
  const booksDeniedMock = createMockSupabaseAdmin({ simulateBooksSnapshotError: true });
  await withServer(booksDeniedMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'DB_PERMISSION_DENIED');
    assert.match(body.error, /snapshot books/i);
    assert.equal(booksDeniedMock.deletedProfiles.length, 0);
    assert.equal(booksDeniedMock.deletedAuthUsers.length, 0);
    assert.ok(booksDeniedMock.profiles[VISITOR_NO_LOANS_ID]);
  });

  // 3. loans count 42501 aborts deletion with DB_PERMISSION_DENIED before snapshot or deletion
  const loansCountDeniedMock = createMockSupabaseAdmin({ simulateLoansCountPermissionDenied: true });
  await withServer(loansCountDeniedMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'DB_PERMISSION_DENIED');
    assert.match(body.error, /42501/);
    assert.equal(loansCountDeniedMock.deletedProfiles.length, 0);
    assert.equal(loansCountDeniedMock.deletedAuthUsers.length, 0);
  });

  // 4. Unexpected non-404 auth.admin.getUserById failure aborts with 500 AUTH_LOOKUP_FAILED
  const authErrMock = createMockSupabaseAdmin({ simulateAuthGetUserError: true });
  await withServer(authErrMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'AUTH_LOOKUP_FAILED');
    assert.equal(authErrMock.deletedProfiles.length, 0);
    assert.equal(authErrMock.deletedAuthUsers.length, 0);
  });
});

test('POST /api/loans/:id/approve and /reject return DB_PERMISSION_DENIED and safe diagnostic logs on 42501', async () => {
  for (const endpoint of ['approve', 'reject'] as const) {
    for (const deniedMode of [true, 'update'] as const) {
      const logs: unknown[][] = [];
      const origErr = console.error;
      console.error = (...args: unknown[]) => {
        logs.push(args);
      };

      const mock = createMockSupabaseAdmin({ simulateLoansPermissionDenied: deniedMode });
      const beforeCopies = mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies;

      try {
        await withServer(mock, async (baseUrl) => {
          const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer admin-token',
            },
            body: JSON.stringify({}),
          });
          assert.equal(res.status, 500);
          const body = await res.json();
          assert.equal(body.code, 'DB_PERMISSION_DENIED');
          assert.match(body.error, /42501/);
        });
      } finally {
        console.error = origErr;
      }

      assert.equal(mock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, beforeCopies);
      const expectedTag =
        endpoint === 'approve' ? '[LOAN_APPROVE_PERMISSION_DENIED]' : '[LOAN_REJECT_PERMISSION_DENIED]';
      const permLog = logs.find((entry) => entry[0] === expectedTag);
      assert.ok(permLog, `Expected ${expectedTag} log entry`);
      const meta = permLog[1] as Record<string, unknown>;
      assert.equal(meta.table, 'loans');
      assert.equal(meta.operation, deniedMode === 'update' ? 'update' : 'select');
      assert.equal('serviceRoleKey' in meta, false);
    }
  }
});

test('GET /api/health?probe=all reports categoriesErrorCode 42501 when public.categories is denied without breaking health status', async () => {
  const deniedCatMock = createMockSupabaseAdmin({ simulateCategoriesPermissionDenied: true });
  await withServer(deniedCatMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health?probe=all`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.returnTablesProbe?.ok, true);
    assert.equal(body.catalogAndStorageProbe?.ok, false);
    assert.equal(body.catalogAndStorageProbe?.categoriesOk, false);
    assert.equal(body.catalogAndStorageProbe?.categoriesErrorCode, '42501');
  });
});

test('POST /api/loans/:id/approve ignores any legacy durationDays and enforces due_at=null', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ durationDays: 7, adminNote: 'Disetujui tanpa batas waktu otomatis' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.loan.status, 'approved');
    assert.equal(body.loan.due_at, null, 'Expected due_at to remain null without automatic loan duration');
  });
});

test('POST /api/loans/:id/approve serializes concurrent approvals on last available copy so stock never goes negative', async () => {
  const LAST_COPY_BOOK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
  const PENDING_LOAN_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';
  const PENDING_LOAN_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12';

  const mock = createMockSupabaseAdmin({ simulateLoanUpdateDelayMs: 25 });
  mock.books.push({
    id: LAST_COPY_BOOK_ID,
    title: 'Buku Stok Terakhir',
    author: 'Penulis Uji',
    cover_path: null,
    category_id: 'cat-1',
    is_published: true,
    is_archived: false,
    total_copies: 1,
    available_copies: 1,
    created_by: ADMIN_ID,
    created_at: '2026-11-18T08:00:00.000Z',
  });
  mock.loans.push(
    {
      id: PENDING_LOAN_1,
      user_id: VISITOR_NO_LOANS_ID,
      book_id: LAST_COPY_BOOK_ID,
      status: 'pending',
      requested_at: '2026-11-18T08:00:00.000Z',
      approved_at: null,
      due_at: null,
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-18T08:00:00.000Z',
      updated_at: '2026-11-18T08:00:00.000Z',
    },
    {
      id: PENDING_LOAN_2,
      user_id: VISITOR_ACTIVE_LOAN_ID,
      book_id: LAST_COPY_BOOK_ID,
      status: 'pending',
      requested_at: '2026-11-18T08:01:00.000Z',
      approved_at: null,
      due_at: null,
      returned_at: null,
      admin_note: null,
      created_at: '2026-11-18T08:01:00.000Z',
      updated_at: '2026-11-18T08:01:00.000Z',
    }
  );

  await withServer(mock, async (baseUrl) => {
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/loans/${PENDING_LOAN_1}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-token',
        },
        body: JSON.stringify({}),
      }),
      fetch(`${baseUrl}/api/loans/${PENDING_LOAN_2}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-token',
        },
        body: JSON.stringify({}),
      }),
    ]);

    const body1 = await res1.json();
    const body2 = await res2.json();
    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const failedBody = res1.status === 409 ? body1 : body2;
    assert.equal(failedBody.code, 'BOOK_UNAVAILABLE');

    const book = mock.books.find((b) => b.id === LAST_COPY_BOOK_ID)!;
    assert.equal(book.available_copies, 0, 'Book stock must be 0 and never negative');

    const loanStatuses = [
      mock.loans.find((l) => l.id === PENDING_LOAN_1)?.status,
      mock.loans.find((l) => l.id === PENDING_LOAN_2)?.status,
    ].sort();
    assert.deepEqual(loanStatuses, ['approved', 'pending']);
  });
});

test('POST /api/loans/:id/approve and /return roll back loan status completely when book stock update fails or hits concurrency conflict', async () => {
  // 1. Approve failure -> rollback loan back to pending
  for (const mode of [true, 'zero_rows'] as const) {
    const mockApproveFail = createMockSupabaseAdmin({ simulateBookStockUpdateFailure: mode });
    const initialCopies = mockApproveFail.books.find((b) => b.id === BOOK_MAIN_ID)!.available_copies;
    await withServer(mockApproveFail, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-token',
        },
        body: JSON.stringify({ adminNote: 'Harus rollback' }),
      });
      assert.equal(res.status, mode === true ? 500 : 409);
      const body = await res.json();
      assert.equal(body.rolledBack, true);
    });
    const loanAfter = mockApproveFail.loans.find((l) => l.id === LOAN_PENDING_ID)!;
    assert.equal(loanAfter.status, 'pending');
    assert.equal(loanAfter.approved_at, null);
    assert.equal(loanAfter.due_at, null);
    assert.equal(mockApproveFail.books.find((b) => b.id === BOOK_MAIN_ID)!.available_copies, initialCopies);
  }

  // 2. Return failure -> rollback loan back to approved
  for (const mode of [true, 'zero_rows'] as const) {
    const mockReturnFail = createMockSupabaseAdmin({ simulateBookStockUpdateFailure: mode });
    const initialCopies = mockReturnFail.books.find((b) => b.id === BOOK_MAIN_ID)!.available_copies;
    await withServer(mockReturnFail, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/loans/${LOAN_ACTIVE_VISITOR_ID}/return`, {
        method: 'POST',
        headers: { Authorization: 'Bearer visitor-token' },
      });
      assert.equal(res.status, mode === true ? 500 : 409);
      const body = await res.json();
      assert.equal(body.rolledBack, true);
    });
    const loanAfter = mockReturnFail.loans.find((l) => l.id === LOAN_ACTIVE_VISITOR_ID)!;
    assert.equal(loanAfter.status, 'approved');
    assert.equal(loanAfter.returned_at, null);
    assert.equal(mockReturnFail.books.find((b) => b.id === BOOK_MAIN_ID)!.available_copies, initialCopies);
  }
});

test('POST /api/loans/:id/approve and /return use atomic PostgreSQL RPCs when available and fall back cleanly on PGRST202', async () => {
  const rpcCalls: Array<{ fnName: string; params: Record<string, any> | undefined }> = [];
  const mockAtomic = createMockSupabaseAdmin({
    rpcHandler: async (fnName, params) => {
      rpcCalls.push({ fnName, params });
      if (fnName === 'approve_loan_atomic') {
        const loan = mockAtomic.loans.find((l) => l.id === params?.p_loan_id)!;
        const book = mockAtomic.books.find((b) => b.id === loan.book_id)!;
        if (loan.status !== 'pending') {
          return {
            data: {
              ok: false,
              http_status: 409,
              code: 'INVALID_LOAN_STATUS',
              error: 'Sudah diproses.',
            },
            error: null,
          };
        }
        loan.status = 'approved';
        loan.approved_at = '2026-11-20T10:00:00.000Z';
        loan.due_at = null;
        book.available_copies -= 1;
        return {
          data: {
            ok: true,
            http_status: 200,
            stock_adjusted: true,
            stock_source: 'application',
            loan: { ...loan },
          },
          error: null,
        };
      }
      if (fnName === 'return_loan_atomic') {
        const loan = mockAtomic.loans.find((l) => l.id === params?.p_loan_id)!;
        const book = mockAtomic.books.find((b) => b.id === loan.book_id)!;
        if (loan.status === 'returned') {
          return {
            data: {
              ok: true,
              http_status: 200,
              already_returned: true,
              stock_adjusted: false,
              stock_source: 'none',
              loan: { ...loan },
            },
            error: null,
          };
        }
        loan.status = 'returned';
        loan.returned_at = '2026-11-20T11:00:00.000Z';
        book.available_copies += 1;
        return {
          data: {
            ok: true,
            http_status: 200,
            already_returned: false,
            stock_adjusted: true,
            stock_source: 'application',
            loan: { ...loan },
          },
          error: null,
        };
      }
      return { data: null, error: { code: 'PGRST202', message: 'not found' } };
    },
  });

  await withServer(mockAtomic, async (baseUrl) => {
    const approveRes = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({ adminNote: 'Via RPC atomik' }),
    });
    assert.equal(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.equal(approveBody.atomicRpc, true);
    assert.equal(approveBody.loan.due_at, null);
    assert.equal(approveBody.loan.book.available_copies, 1);

    const returnRes1 = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(returnRes1.status, 200);
    const returnBody1 = await returnRes1.json();
    assert.equal(returnBody1.atomicRpc, true);
    assert.equal(returnBody1.alreadyReturned, false);
    assert.equal(returnBody1.loan.book.available_copies, 2);

    // Idempotent second return call -> no double increment
    const returnRes2 = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/return`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(returnRes2.status, 200);
    const returnBody2 = await returnRes2.json();
    assert.equal(returnBody2.atomicRpc, true);
    assert.equal(returnBody2.alreadyReturned, true);
    assert.equal(returnBody2.stockAdjusted, false);
    assert.equal(mockAtomic.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 2);
  });

  assert.equal(rpcCalls[0].fnName, 'approve_loan_atomic');
  assert.equal(rpcCalls[1].fnName, 'return_loan_atomic');

  // Fallback when RPC returns PGRST202 (schema cache missing before SQL migration is run)
  const fallbackMock = createMockSupabaseAdmin({
    rpcHandler: async (fnName) => ({
      data: null,
      error: { code: 'PGRST202', message: `Could not find the function public.${fnName}` },
    }),
  });
  await withServer(fallbackMock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/loans/${LOAN_PENDING_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stockAdjusted, true);
    assert.equal(body.loan.due_at, null);
    assert.equal(fallbackMock.books.find((b) => b.id === BOOK_MAIN_ID)?.available_copies, 1);
  });
});
