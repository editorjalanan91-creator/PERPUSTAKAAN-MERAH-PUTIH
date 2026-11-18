import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createApp,
  defaultCreateSupabaseAdminClient,
  inspectServerSupabaseEnv,
  probeAdminProfilesAccess,
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
  simulateProfileUpdateFailure?: boolean;
  simulateProfileDeleteFailure?: boolean | 'super_admin';
  simulateAuthAlreadyDeleted?: boolean;
  simulateAuthDeleteFailure?: boolean;
  simulateAuthRollbackFailure?: boolean;
  enforceAuthTriggerProtection?: boolean;
  simulateReturnStockTrigger?: boolean;
  simulateDuplicateLoanPk?: boolean;
  simulateDuplicateBookRecord?: boolean;
  simulateDuplicateProfileRecord?: boolean;
  simulateDuplicateLoanUpdate?: boolean;
  simulateLoanUpdateZeroRowsBecauseReturned?: boolean;
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
  const activityLogs: any[] = [];
  const books: Array<{
    id: string;
    title: string;
    author: string;
    cover_path: string | null;
    total_copies: number;
    available_copies: number;
    created_by: string | null;
    updated_at?: string;
  }> = [
    {
      id: 'book-1',
      title: 'Buku Referensi Umum',
      author: 'Penulis Satu',
      cover_path: null,
      total_copies: 4,
      available_copies: 4,
      created_by: VISITOR_NO_LOANS_ID,
    },
    {
      id: BOOK_MAIN_ID,
      title: 'Arsitektur Web Modern',
      author: 'Dewi Lestari',
      cover_path: 'covers/arsitektur.jpg',
      total_copies: 5,
      available_copies: 2,
      created_by: ADMIN_ID,
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
  const categories: Array<{ id: string; created_by: string | null }> = [
    { id: 'cat-1', created_by: VISITOR_NO_LOANS_ID },
  ];
  const loansMutations: string[] = [];
  let authUpdateAttempt = 0;

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
      },
    },
    from(table: string) {
      let filterCol = '';
      let filterVal: any = null;
      const eqFilters: Array<{ col: string; val: any }> = [];
      const inFilters: Array<{ col: string; vals: any[] }> = [];
      const neqFilters: Array<{ col: string; val: any }> = [];
      let isDelete = false;
      let isUpdate = false;
      let updatePayload: any = null;

      const matchesRow = (row: Record<string, any>) =>
        eqFilters.every((f) => row?.[f.col] === f.val) &&
        inFilters.every((f) => f.vals.includes(row?.[f.col])) &&
        neqFilters.every((f) => row?.[f.col] !== f.val);

      const executeQuery = () => {
        if (isDelete) {
          if (table === 'profiles') {
            const idFilter = eqFilters.find((f) => f.col === 'id')?.val;
            if (options?.simulateProfileDeleteFailure === 'super_admin') {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Akun Super Admin dilindungi dan tidak dapat dihapus' },
              });
            }
            if (options?.simulateProfileDeleteFailure) {
              return Promise.resolve({
                error: { code: '23503', message: 'Simulated profile delete failure' },
              });
            }
            if (idFilter) {
              delete profiles[idFilter];
              deletedProfiles.push(idFilter);
            }
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
              }
            }
            if (options?.simulateDuplicateLoanUpdate && updatedLoans.length === 1) {
              updatedLoans.push({ ...updatedLoans[0] });
            }
            return Promise.resolve({ data: updatedLoans, error: null });
          }
          if (table === 'categories') {
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
          rows = books.filter((b) => matchesRow(b));
          if (options?.simulateDuplicateBookRecord && rows.length === 1) {
            rows = [rows[0], { ...rows[0] }];
          }
        } else if (table === 'categories') {
          rows = categories.filter((c) => matchesRow(c));
        } else if (table === 'activity_logs') {
          rows = activityLogs.filter((l) => matchesRow(l));
        } else if (table === 'loans') {
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
        return Promise.resolve({ data: rows, error: null });
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
                return Promise.resolve({
                  count: activeLoansCountByUser[countFilterVal] ?? 0,
                  error: null,
                });
              },
              then(resolve: any, reject?: any) {
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
        order() {
          const rows = Object.values(profiles).filter((p: any) => matchesRow(p));
          return Promise.resolve({ data: rows, error: null });
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
          if (table === 'loans') {
            loansMutations.push('insert');
          }
          if (table === 'activity_logs') {
            activityLogs.push(payload);
          }
          if (table === 'profiles' && payload?.id) {
            if (options?.simulateRollbackFailures?.profile === 'throw') {
              return Promise.reject(new Error('Simulated thrown error restoring profile'));
            }
            if (options?.simulateRollbackFailures?.profile) {
              return Promise.resolve({
                error: { code: 'P0001', message: 'Simulated profile insert rollback failure' },
              });
            }
            profiles[payload.id] = payload;
          }
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };

  return {
    client,
    deletedAuthUsers,
    deletedProfiles,
    updatedAuthUsers,
    activityLogs,
    books,
    loans,
    categories,
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

test('permanently deletes Auth user and public.profiles row when visitor has zero loan history while preserving activity_logs', async () => {
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
    assert.equal(mock.categories[0].created_by, null);
    assert.deepEqual(mock.loansMutations, []);
    // Histori activity_logs lama tetap ada (actor_id dilepas ke null) + log delete_visitor baru ditambahkan
    assert.equal(mock.activityLogs.length, 2);
    const preservedOldLog = mock.activityLogs.find((l) => l.id === 'log-existing-1');
    assert.ok(preservedOldLog);
    assert.equal(preservedOldLog.actor_id, null);
    assert.equal(mock.activityLogs[1].action, 'delete_visitor');
  });
});

test('rolls back public.profiles, books, categories, and activity_logs.actor_id when Auth deletion fails so no half-deleted state remains', async () => {
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
    // Profile, book created_by, category created_by, dan actor_id pada log aktivitas telah dipulihkan kembali
    assert.ok(mock.profiles[VISITOR_NO_LOANS_ID]);
    assert.equal(mock.books[0].created_by, VISITOR_NO_LOANS_ID);
    assert.equal(mock.categories[0].created_by, VISITOR_NO_LOANS_ID);
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
    assert.equal(mockDbFail.categories[0].created_by, VISITOR_NO_LOANS_ID);
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
    assert.equal(mockTriggerProtect.categories[0].created_by, VISITOR_NO_LOANS_ID);
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
      // Meski restore_profile gagal, langkah rollback lainnya (books, categories, activity_logs) tetap dijalankan & berhasil dipulihkan
      assert.equal(mock.profiles[VISITOR_NO_LOANS_ID], undefined);
      assert.equal(mock.books[0].created_by, VISITOR_NO_LOANS_ID);
      assert.equal(mock.categories[0].created_by, VISITOR_NO_LOANS_ID);
      assert.equal(mock.activityLogs[0].actor_id, VISITOR_NO_LOANS_ID);
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
      // categories tidak gagal -> harus tetap terpulihkan meskipun profiles, books, dan activity_logs gagal
      assert.equal(mock.categories[0].created_by, VISITOR_NO_LOANS_ID);
      assert.equal(mock.books[0].created_by, null);
      assert.equal(mock.activityLogs[0].actor_id, null);
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
    simulateRollbackFailures: { books: true, categories: true },
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
      assert.equal(body.rollbackFailures.length, 2);
      // activity_logs tetap berhasil dipulihkan walau books & categories gagal
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

