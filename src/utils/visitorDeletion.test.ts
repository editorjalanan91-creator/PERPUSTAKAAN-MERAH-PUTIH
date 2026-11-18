import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateVisitorRemovalEligibility,
  evaluateVisitorArchiveEligibility,
  evaluateVisitorRestoreEligibility,
  isAdminOrSuperAdminRole,
  isProtectedSuperAdmin,
  isVisitorArchived,
  isValidUuid,
} from './visitorDeletion';

test('admin and super_admin are both recognized as privileged admin roles', () => {
  assert.equal(isAdminOrSuperAdminRole('admin'), true);
  assert.equal(isAdminOrSuperAdminRole('super_admin'), true);
  assert.equal(isAdminOrSuperAdminRole('visitor'), false);
  assert.equal(isAdminOrSuperAdminRole('user'), false);
  assert.equal(isAdminOrSuperAdminRole(null), false);
});

test('admin can permanently delete a visitor with zero loan history', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-1',
    targetRole: 'visitor',
    totalLoansCount: 0,
    activeLoansCount: 0,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'permanent_delete');
  assert.equal(result.statusCode, 200);
});

test('admin cannot delete another admin account', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'admin-2',
    targetRole: 'admin',
    totalLoansCount: 0,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'admin_delete_forbidden');
  assert.equal(result.statusCode, 403);
  assert.equal(result.code, 'ADMIN_DELETE_FORBIDDEN');
});

test('Super Admin cannot be deleted, archived, or restored via visitor endpoints (by role, flag, or UID)', () => {
  const cases = [
    { targetId: 'sa-1', targetRole: 'super_admin', targetIsSuperAdmin: false, superAdminUids: [] },
    { targetId: 'sa-2', targetRole: 'admin', targetIsSuperAdmin: true, superAdminUids: [] },
    { targetId: 'sa-3', targetRole: 'visitor', targetIsSuperAdmin: false, superAdminUids: ['sa-3'] },
  ];

  for (const c of cases) {
    assert.equal(isProtectedSuperAdmin(c), true);

    const del = evaluateVisitorRemovalEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      ...c,
      totalLoansCount: 0,
      activeLoansCount: 0,
    });
    assert.equal(del.allowed, false);
    assert.equal(del.statusCode, 403);
    assert.equal(del.code, 'SUPER_ADMIN_PROTECTED');

    const arc = evaluateVisitorArchiveEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      ...c,
      activeLoansCount: 0,
    });
    assert.equal(arc.allowed, false);
    assert.equal(arc.statusCode, 403);
    assert.equal(arc.code, 'SUPER_ADMIN_PROTECTED');

    const res = evaluateVisitorRestoreEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      ...c,
    });
    assert.equal(res.allowed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.code, 'SUPER_ADMIN_PROTECTED');
  }
});

test('admin cannot delete their own account', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'admin-1',
    targetRole: 'admin',
    totalLoansCount: 0,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'self_delete_forbidden');
  assert.equal(result.statusCode, 400);
  assert.equal(result.code, 'SELF_DELETE_FORBIDDEN');
});

test('non-admin visitor cannot delete other accounts', () => {
  for (const role of ['visitor', 'user', '', undefined, null]) {
    const result = evaluateVisitorRemovalEligibility({
      actorId: 'visitor-1',
      actorRole: role,
      targetId: 'visitor-2',
      targetRole: 'visitor',
      totalLoansCount: 0,
    });

    assert.equal(result.allowed, false);
    assert.equal(result.action, 'forbidden');
    assert.equal(result.statusCode, 403);
    assert.equal(result.code, 'ADMIN_ONLY');
  }
});

test('visitor with active/unfinished loans is blocked from BOTH permanent deletion and archiving', () => {
  const del = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-active-loan',
    targetRole: 'visitor',
    totalLoansCount: 2,
    activeLoansCount: 1,
  });
  assert.equal(del.allowed, false);
  assert.equal(del.action, 'active_loans_block');
  assert.equal(del.statusCode, 409);
  assert.equal(del.code, 'HAS_ACTIVE_LOANS');

  const arc = evaluateVisitorArchiveEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-active-loan',
    targetRole: 'visitor',
    activeLoansCount: 1,
  });
  assert.equal(arc.allowed, false);
  assert.equal(arc.action, 'active_loans_block');
  assert.equal(arc.statusCode, 409);
  assert.equal(arc.code, 'HAS_ACTIVE_LOANS');
});

test('visitor with historical loans and 0 active loans requires archiving instead of permanent deletion', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-with-loans',
    targetRole: 'visitor',
    totalLoansCount: 3,
    activeLoansCount: 0,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'archive_required');
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'HAS_LOAN_HISTORY');
  assert.match(result.error || '', /3 riwayat peminjaman/);
});

test('archive eligibility enforces admin role, non-self, non-admin target, and no active loans', () => {
  assert.equal(
    evaluateVisitorArchiveEligibility({
      actorId: 'visitor-1',
      actorRole: 'visitor',
      targetId: 'visitor-2',
      targetRole: 'visitor',
    }).statusCode,
    403
  );

  assert.equal(
    evaluateVisitorArchiveEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      targetId: 'admin-1',
      targetRole: 'admin',
    }).statusCode,
    400
  );

  assert.equal(
    evaluateVisitorArchiveEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      targetId: 'admin-2',
      targetRole: 'admin',
    }).statusCode,
    403
  );

  assert.equal(
    evaluateVisitorArchiveEligibility({
      actorId: 'admin-1',
      actorRole: 'super_admin',
      targetId: 'visitor-with-loans',
      targetRole: 'visitor',
      activeLoansCount: 0,
    }).allowed,
    true
  );
});

test('restore eligibility allows admin/super_admin on visitors and blocks non-admins/self/admins', () => {
  assert.equal(
    evaluateVisitorRestoreEligibility({
      actorId: 'visitor-1',
      actorRole: 'visitor',
      targetId: 'visitor-2',
      targetRole: 'visitor',
    }).statusCode,
    403
  );

  assert.equal(
    evaluateVisitorRestoreEligibility({
      actorId: 'admin-1',
      actorRole: 'admin',
      targetId: 'admin-1',
      targetRole: 'admin',
    }).statusCode,
    400
  );

  const ok = evaluateVisitorRestoreEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-archived',
    targetRole: 'visitor',
  });
  assert.equal(ok.allowed, true);
  assert.equal(ok.action, 'restore');
  assert.equal(ok.statusCode, 200);
});

test('isVisitorArchived detects inactive or archived_at profiles', () => {
  assert.equal(isVisitorArchived({ is_active: true, archived_at: null }), false);
  assert.equal(isVisitorArchived({ is_active: false, archived_at: null }), true);
  assert.equal(isVisitorArchived({ is_active: true, archived_at: '2026-01-01T00:00:00Z' }), true);
  assert.equal(isVisitorArchived(undefined), false);
});

test('isValidUuid validates UUIDs strictly', () => {
  assert.equal(isValidUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid(''), false);
});

