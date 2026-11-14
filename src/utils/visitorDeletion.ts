import type { Profile, UserRole } from '../types';

export type VisitorRemovalAction =
  | 'permanent_delete'
  | 'archive_required'
  | 'forbidden'
  | 'self_delete_forbidden'
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
  totalLoansCount: number;
}

export function evaluateVisitorRemovalEligibility(
  input: EvaluateRemovalInput
): VisitorRemovalEvaluation {
  if (input.actorRole !== 'admin') {
    return {
      allowed: false,
      action: 'forbidden',
      statusCode: 403,
      code: 'ADMIN_ONLY',
      error: 'Akses ditolak. Hanya administrator perpustakaan yang berhak menghapus akun pengunjung.',
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

  if (input.targetRole === 'admin') {
    return {
      allowed: false,
      action: 'admin_delete_forbidden',
      statusCode: 403,
      code: 'ADMIN_DELETE_FORBIDDEN',
      error: 'Akun dengan role administrator tidak dapat dihapus melalui menu daftar pengunjung.',
    };
  }

  if (input.totalLoansCount > 0) {
    return {
      allowed: false,
      action: 'archive_required',
      statusCode: 409,
      code: 'HAS_LOAN_HISTORY',
      error: `Akun pengunjung ini memiliki ${input.totalLoansCount} riwayat peminjaman sehingga tidak dapat dihapus permanen. Gunakan opsi Arsipkan / Nonaktifkan Akun untuk menjaga keutuhan data laporan dan transaksi.`,
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
}): VisitorRemovalEvaluation {
  if (input.actorRole !== 'admin') {
    return {
      allowed: false,
      action: 'forbidden',
      statusCode: 403,
      code: 'ADMIN_ONLY',
      error: 'Akses ditolak. Hanya administrator perpustakaan yang berhak mengarsipkan akun pengunjung.',
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

  if (input.targetRole === 'admin') {
    return {
      allowed: false,
      action: 'admin_delete_forbidden',
      statusCode: 403,
      code: 'ADMIN_DELETE_FORBIDDEN',
      error: 'Akun administrator tidak dapat diarsipkan melalui menu daftar pengunjung.',
    };
  }

  return {
    allowed: true,
    action: 'permanent_delete',
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
