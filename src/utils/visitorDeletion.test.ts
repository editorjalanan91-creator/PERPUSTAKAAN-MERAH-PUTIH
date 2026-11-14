import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateVisitorRemovalEligibility,
  evaluateVisitorArchiveEligibility,
  isVisitorArchived,
  isValidUuid,
} from './visitorDeletion';

test('admin can permanently delete a visitor with zero loan history', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-1',
    targetRole: 'visitor',
    totalLoansCount: 0,
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

test('visitor with loan history cannot be permanently deleted and requires archiving', () => {
  const result = evaluateVisitorRemovalEligibility({
    actorId: 'admin-1',
    actorRole: 'admin',
    targetId: 'visitor-with-loans',
    targetRole: 'visitor',
    totalLoansCount: 3,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'archive_required');
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'HAS_LOAN_HISTORY');
  assert.match(result.error || '', /3 riwayat peminjaman/);
});

test('archive eligibility enforces admin role, non-self, and non-admin target', () => {
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
      actorRole: 'admin',
      targetId: 'visitor-with-loans',
      targetRole: 'visitor',
    }).allowed,
    true
  );
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
