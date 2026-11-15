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
const VISITOR_NO_LOANS_ID = '33333333-3333-4333-8333-333333333333';
const VISITOR_WITH_LOANS_ID = '44444444-4444-4444-8444-444444444444';

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

function createMockSupabaseAdmin(options?: {
  simulateMissingArchiveCols?: boolean;
  simulateProfilesPermissionDenied?: boolean;
}) {
  const deletedAuthUsers: string[] = [];
  const deletedProfiles: string[] = [];
  const updatedAuthUsers: Array<{ id: string; payload: any }> = [];
  const activityLogs: any[] = [];
  const loansMutations: string[] = [];

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
        limit(maxRows: number) {
          const rows = Object.values(profiles)
            .filter((p: any) => (neqCol ? p[neqCol] !== neqVal : true))
            .slice(0, maxRows);
          return Promise.resolve({ data: rows, error: null });
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
    loansMutations,
    profiles,
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

test('separates Auth client (token verification) from Admin client (profiles query) and returns visitors for admin', async () => {
  const mock = createMockSupabaseAdmin();
  await withServer(mock, async (baseUrl, mockAuth) => {
    const res = await fetch(`${baseUrl}/api/admin/visitors`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(mockAuth.verifiedTokens.includes('admin-token'), true);
    assert.equal(Array.isArray(body.visitors), true);
    assert.equal(body.visitors.length, 2);
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

test('rejects unauthenticated delete/archive/list requests with 401', async () => {
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
    assert.deepEqual(mock.loansMutations, []);
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
    assert.deepEqual(mock.loansMutations, []);
    assert.equal(mock.activityLogs[0].action, 'archive_visitor');
  });
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
