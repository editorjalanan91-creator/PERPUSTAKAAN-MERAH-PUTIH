import type { Profile, UserRole } from '../types';

export type VisitorRemovalAction =
  | 'permanent_delete'
  | 'archive_required'
  | 'active_loans_block'
  | 'restore'
  | 'forbidden'
  | 'self_delete_forbidden'
  | 'super_admin_protected'
  | 'admin_delete_forbidden';

export interface VisitorRemovalEvaluation {
  allowed: boolean;
  action: VisitorRemovalAction;
  statusCode: number;
  code?: string;
  error?: string;
}

export interface EvaluateRemovalInput {
  actorId: string;
  actorRole: UserRole | string | null | undefined;
  targetId: string;
  targetRole: UserRole | string | null | undefined;
  targetIsSuperAdmin?: boolean;
  superAdminUids?: string[];
  totalLoansCount: number;
  activeLoansCount?: number;
}

export function isAdminOrSuperAdminRole(role: UserRole | string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isProtectedSuperAdmin(input: {
  targetId?: string;
  targetRole?: UserRole | string | null | undefined;
  targetIsSuperAdmin?: boolean;
  superAdminUids?: string[];
}): boolean {
  if (input.targetRole === 'super_admin') return true;
  if (input.targetIsSuperAdmin === true) return true;
  if (input.targetId && Array.isArray(input.superAdminUids)) {
    return input.superAdminUids.includes(input.targetId);
  }
  return false;
}

export function evaluateVisitorRemovalEligibility(
  input: EvaluateRemovalInput
): VisitorRemovalEvaluation {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
    return {
      allowed: false,
      action: 'forbidden',
      statusCode: 403,
      code: 'ADMIN_ONLY',
      error:
        'Akses ditolak. Hanya administrator perpustakaan yang berhak menghapus akun pengunjung.',
    };
  }

  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: 'self_delete_forbidden',
      statusCode: 400,
      code: 'SELF_DELETE_FORBIDDEN',
      error: 'Administrator tidak diperbolehkan menghapus akunnya sendiri.',
    };
  }

  if (isProtectedSuperAdmin(input)) {
    return {
      allowed: false,
      action: 'super_admin_protected',
      statusCode: 403,
      code: 'SUPER_ADMIN_PROTECTED',
      error:
        'Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.',
    };
  }

  if (input.targetRole === 'admin') {
    return {
      allowed: false,
      action: 'admin_delete_forbidden',
      statusCode: 403,
      code: 'ADMIN_DELETE_FORBIDDEN',
      error:
        'Akun dengan role administrator tidak dapat dihapus melalui menu daftar pengunjung.',
    };
  }

  const activeLoansCount = input.activeLoansCount ?? 0;
  if (activeLoansCount > 0) {
    return {
      allowed: false,
      action: 'active_loans_block',
      statusCode: 409,
      code: 'HAS_ACTIVE_LOANS',
      error: `Akun pengunjung ini masih memiliki ${activeLoansCount} peminjaman aktif atau menunggu persetujuan. Selesaikan seluruh transaksi peminjaman terlebih dahulu sebelum menghapus atau mengarsipkan akun.`,
    };
  }

  if (input.totalLoansCount > 0) {
    return {
      allowed: false,
      action: 'archive_required',
      statusCode: 409,
      code: 'HAS_LOAN_HISTORY',
      error: `Akun pengunjung ini memiliki ${input.totalLoansCount} riwayat peminjaman sehingga tidak dapat dihapus permanen. Gunakan opsi Arsipkan Pengunjung untuk menjaga keutuhan data laporan dan transaksi.`,
    };
  }

  return {
    allowed: true,
    action: 'permanent_delete',
    statusCode: 200,
  };
}

export function evaluateVisitorArchiveEligibility(input: {
  actorId: string;
  actorRole: UserRole | string | null | undefined;
  targetId: string;
  targetRole: UserRole | string | null | undefined;
  targetIsSuperAdmin?: boolean;
  superAdminUids?: string[];
  activeLoansCount?: number;
}): VisitorRemovalEvaluation {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
    return {
      allowed: false,
      action: 'forbidden',
      statusCode: 403,
      code: 'ADMIN_ONLY',
      error:
        'Akses ditolak. Hanya administrator perpustakaan yang berhak mengarsipkan akun pengunjung.',
    };
  }

  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: 'self_delete_forbidden',
      statusCode: 400,
      code: 'SELF_DELETE_FORBIDDEN',
      error: 'Administrator tidak diperbolehkan menonaktifkan akunnya sendiri.',
    };
  }

  if (isProtectedSuperAdmin(input)) {
    return {
      allowed: false,
      action: 'super_admin_protected',
      statusCode: 403,
      code: 'SUPER_ADMIN_PROTECTED',
      error:
        'Akun Super Admin dilindungi oleh sistem dan tidak dapat dihapus atau diarsipkan.',
    };
  }

  if (input.targetRole === 'admin') {
    return {
      allowed: false,
      action: 'admin_delete_forbidden',
      statusCode: 403,
      code: 'ADMIN_DELETE_FORBIDDEN',
      error: 'Akun administrator tidak dapat diarsipkan melalui menu daftar pengunjung.',
    };
  }

  const activeLoansCount = input.activeLoansCount ?? 0;
  if (activeLoansCount > 0) {
    return {
      allowed: false,
      action: 'active_loans_block',
      statusCode: 409,
      code: 'HAS_ACTIVE_LOANS',
      error: `Pengarsipan ditolak: akun pengunjung masih memiliki ${activeLoansCount} transaksi peminjaman yang masih aktif atau belum selesai. Selesaikan peminjaman terlebih dahulu.`,
    };
  }

  return {
    allowed: true,
    action: 'archive_required',
    statusCode: 200,
  };
}

export function evaluateVisitorRestoreEligibility(input: {
  actorId: string;
  actorRole: UserRole | string | null | undefined;
  targetId: string;
  targetRole: UserRole | string | null | undefined;
  targetIsSuperAdmin?: boolean;
  superAdminUids?: string[];
}): VisitorRemovalEvaluation {
  if (!isAdminOrSuperAdminRole(input.actorRole)) {
    return {
      allowed: false,
      action: 'forbidden',
      statusCode: 403,
      code: 'ADMIN_ONLY',
      error:
        'Akses ditolak. Hanya administrator perpustakaan yang berhak mengaktifkan kembali akun pengunjung.',
    };
  }

  if (!input.targetId || input.actorId === input.targetId) {
    return {
      allowed: false,
      action: 'self_delete_forbidden',
      statusCode: 400,
      code: 'SELF_ACTION_FORBIDDEN',
      error: 'Operasi ini tidak berlaku untuk akun Anda sendiri.',
    };
  }

  if (isProtectedSuperAdmin(input) || input.targetRole === 'admin') {
    return {
      allowed: false,
      action: isProtectedSuperAdmin(input) ? 'super_admin_protected' : 'admin_delete_forbidden',
      statusCode: 403,
      code: isProtectedSuperAdmin(input) ? 'SUPER_ADMIN_PROTECTED' : 'ADMIN_PROTECTED',
      error: 'Akun administrator / Super Admin tidak dikelola melalui menu pengunjung.',
    };
  }

  return {
    allowed: true,
    action: 'restore',
    statusCode: 200,
  };
}

export function isVisitorArchived(
  profile: Pick<Profile, 'is_active' | 'archived_at'> | null | undefined
): boolean {
  if (!profile) return false;
  return profile.is_active === false || Boolean(profile.archived_at);
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || '').trim()
  );
}
