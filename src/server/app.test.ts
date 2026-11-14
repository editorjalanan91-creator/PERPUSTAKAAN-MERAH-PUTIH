import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from './app';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_2_ID = '22222222-2222-4222-8222-222222222222';
const VISITOR_NO_LOANS_ID = '33333333-3333-4333-8333-333333333333';
const VISITOR_WITH_LOANS_ID = '44444444-4444-4444-8444-444444444444';

function createMockSupabaseAdmin(options?: { simulateMissingArchiveCols?: boolean }) {
  const deletedAuthUsers: string[] = [];
  const deletedProfiles: string[] = [];
  const updatedAuthUsers: Array<{ id: string; payload: any }> = [];
  const activityLogs: any[] = [];

  const profiles: Record<string, any> = {
    [ADMIN_ID]: { id: ADMIN_ID, full_name: 'Admin Utama', username: 'Admin', role: 'admin' },
    [ADMIN_2_ID]: { id: ADMIN_2_ID, full_name: 'Admin Dua', username: 'admin2', role: 'admin' },
    [VISITOR_NO_LOANS_ID]: {
      id: VISITOR_NO_LOANS_ID,
      full_name: 'Budi Santoso',
      username: 'budisantoso',
      role: 'visitor',
    },
    [VISITOR_WITH_LOANS_ID]: {
      id: VISITOR_WITH_LOANS_ID,
      full_name: 'Siti Aminah',
      username: 'sitiaminah',
      role: 'visitor',
    },
  };

  const loansCountByUser: Record<string, number> = {
    [VISITOR_NO_LOANS_ID]: 0,
    [VISITOR_WITH_LOANS_ID]: 2,
  };

  const client: any = {
    auth: {
      async getUser(token: string) {
        if (token === 'admin-token') {
          return { data: { user: { id: ADMIN_ID, email: 'admin@perpustakaan.go.id' } }, error: null };
        }
        if (token === 'visitor-token') {
          return {
            data: { user: { id: VISITOR_NO_LOANS_ID, email: 'budi@example.com' } },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
      },
      admin: {
        async listUsers() {
          return {
            data: {
              users: Object.values(profiles).map((p: any) => ({
                id: p.id,
                email: `${p.username.toLowerCase()}@example.com`,
                user_metadata: {},
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
                user_metadata: { role: p.role, full_name: p.full_name, username: p.username },
              },
            },
            error: null,
          };
        },
        async deleteUser(id: string) {
          deletedAuthUsers.push(id);
          return { data: { user: null }, error: null };
        },
        async updateUserById(id: string, payload: any) {
          updatedAuthUsers.push({ id, payload });
          return { data: { user: { id, ...payload } }, error: null };
        },
      },
    },
    from(table: string) {
      let filterCol = '';
      let filterVal: any = null;
      let neqCol = '';
      let neqVal: any = null;
      let isDelete = false;
      let isUpdate = false;
      let updatePayload: any = null;

      const chain: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.count === 'exact' && opts?.head) {
            return {
              eq(col: string, val: any) {
                if (table === 'loans' && col === 'user_id') {
                  return Promise.resolve({ count: loansCountByUser[val] ?? 0, error: null });
                }
                return Promise.resolve({ count: 0, error: null });
              },
            };
          }
          return chain;
        },
        eq(col: string, val: any) {
          filterCol = col;
          filterVal = val;
          if (isDelete) {
            if (table === 'profiles' && col === 'id') {
              delete profiles[val];
              deletedProfiles.push(val);
            }
            return Promise.resolve({ error: null });
          }
          if (isUpdate) {
            if (
              table === 'profiles' &&
              options?.simulateMissingArchiveCols &&
              updatePayload?.is_active !== undefined
            ) {
              return Promise.resolve({
                error: { code: '42703', message: 'column "is_active" does not exist' },
              });
            }
            if (table === 'profiles' && profiles[val]) {
              profiles[val] = { ...profiles[val], ...updatePayload };
            }
            return Promise.resolve({ error: null });
          }
          return chain;
        },
        neq(col: string, val: any) {
          neqCol = col;
          neqVal = val;
          return chain;
        },
        order() {
          const rows = Object.values(profiles).filter((p: any) =>
            neqCol ? p[neqCol] !== neqVal : true
          );
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle() {
          if (table === 'profiles' && filterCol === 'id') {
            return Promise.resolve({ data: profiles[filterVal] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          isDelete = true;
          return chain;
        },
        update(payload: any) {
          isUpdate = true;
          updatePayload = payload;
          return chain;
        },
        insert(payload: any) {
          if (table === 'activity_logs') {
            activityLogs.push(payload);
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
    profiles,
  };
}

async function withServer(
  mockAdmin: ReturnType<typeof createMockSupabaseAdmin>,
  fn: (baseUrl: string) => Promise<void>
) {
  const app = createApp({
    getAdminClient: () => ({ client: mockAdmin.client }),
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('rejects unauthenticated delete/archive requests with 401', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_NO_LOANS_ID}/delete`, {
      method: 'POST',
    });
    assert.equal(res.status, 401);
  });
});

test('rejects non-admin visitor attempting to delete another visitor with 403', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors/${VISITOR_WITH_LOANS_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer visitor-token' },
    });
    assert.equal(res.status, 403);
    assert.equal(mock.deletedAuthUsers.length, 0);
  });
});

test('prevents admin from deleting self (400) or another admin account (403)', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl) => {
    const selfRes = await fetch(`${baseUrl}/api/admin/visitors/${ADMIN_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(selfRes.status, 400);

    const admin2Res = await fetch(`${baseUrl}/api/admin/visitors/${ADMIN_2_ID}/delete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
    });
    assert.equal(admin2Res.status, 403);
    assert.equal(mock.deletedAuthUsers.length, 0);
  });
});

test('blocks permanent deletion when visitor has loan history and returns HAS_LOAN_HISTORY (409)', async () => {
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
    assert.equal(mock.deletedAuthUsers.length, 0);
  });
});

test('permanently deletes Auth user and public.profiles row when visitor has zero loan history', async () => {
  const mock = createMockSupabaseAdmin();
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
    assert.equal(mock.activityLogs.length, 1);
    assert.equal(mock.activityLogs[0].action, 'delete_visitor');
  });
});

test('archives and bans visitor with loan history cleanly even without optional profiles columns', async () => {
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
    assert.equal(mock.activityLogs[0].action, 'archive_visitor');
  });
});
