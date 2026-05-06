import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import { encrypt, decrypt } from '../utils/crypto';
import type { TellerEnrollment } from '../types';

interface TellerEnrollmentRow {
  id: string;
  enrollment_id: string;
  institution_name: string;
  access_token: string; // encrypted
  last_synced_at: string | null;
  created_at: string;
}

function toTellerEnrollment(row: TellerEnrollmentRow): TellerEnrollment {
  return {
    id: row.id,
    enrollment_id: row.enrollment_id,
    institution_name: row.institution_name,
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
  };
}

let _listAll: ReturnType<typeof db.prepare> | null = null;
let _getById: ReturnType<typeof db.prepare> | null = null;
let _getAccessToken: ReturnType<typeof db.prepare> | null = null;
let _insert: ReturnType<typeof db.prepare> | null = null;
let _updateLastSynced: ReturnType<typeof db.prepare> | null = null;
let _delete: ReturnType<typeof db.prepare> | null = null;

function listAllStmt()        { return _listAll        ??= db.prepare(`SELECT * FROM teller_enrollments ORDER BY institution_name`); }
function getByIdStmt()        { return _getById        ??= db.prepare(`SELECT * FROM teller_enrollments WHERE id = ?`); }
function getAccessTokenStmt() { return _getAccessToken ??= db.prepare(`SELECT access_token FROM teller_enrollments WHERE id = ?`); }
function insertStmt()         { return _insert         ??= db.prepare(`INSERT INTO teller_enrollments (id, enrollment_id, institution_name, access_token) VALUES ($id, $enrollment_id, $institution_name, $access_token)`); }
function updateLastSyncedStmt() { return _updateLastSynced ??= db.prepare(`UPDATE teller_enrollments SET last_synced_at = $last_synced_at WHERE id = $id`); }
function deleteStmt()         { return _delete         ??= db.prepare(`DELETE FROM teller_enrollments WHERE id = ?`); }

export const tellerRepository = {
  listAll(): TellerEnrollment[] {
    return (listAllStmt().all() as unknown as TellerEnrollmentRow[]).map(toTellerEnrollment);
  },

  getById(id: string): TellerEnrollment | null {
    const row = getByIdStmt().get(id) as TellerEnrollmentRow | undefined;
    return row ? toTellerEnrollment(row) : null;
  },

  /** Returns the decrypted access_token for a given enrollment id. */
  getAccessToken(id: string): string | null {
    const row = getAccessTokenStmt().get(id) as { access_token: string } | undefined;
    if (!row) return null;
    try {
      return decrypt(row.access_token);
    } catch {
      return null;
    }
  },

  create(data: {
    enrollment_id: string;
    institution_name: string;
    access_token: string;
  }): TellerEnrollment {
    const id = uuidv4();
    insertStmt().run({
      $id: id,
      $enrollment_id: data.enrollment_id,
      $institution_name: data.institution_name,
      $access_token: encrypt(data.access_token),
    });
    return {
      id,
      enrollment_id: data.enrollment_id,
      institution_name: data.institution_name,
      last_synced_at: null,
      created_at: new Date().toISOString(),
    };
  },

  updateLastSynced(id: string, timestamp: string): void {
    updateLastSyncedStmt().run({ $id: id, $last_synced_at: timestamp });
  },

  delete(id: string): void {
    deleteStmt().run(id);
  },
};
