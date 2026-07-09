import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import { encrypt, decrypt } from '../utils/crypto';
import type { PlaidItem } from '../types';

interface PlaidItemRow {
  id: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  access_token: string; // encrypted
  cursor: string;
  status: string;
  created_at: string;
}

function toPlaidItem(row: PlaidItemRow): PlaidItem {
  return {
    id: row.id,
    item_id: row.item_id,
    institution_id: row.institution_id,
    institution_name: row.institution_name,
    cursor: row.cursor,
    status: (row.status ?? 'good') as 'good' | 'login_required',
    created_at: row.created_at,
  };
}

let _listAll: ReturnType<typeof db.prepare> | null = null;
let _getById: ReturnType<typeof db.prepare> | null = null;
let _getAccessToken: ReturnType<typeof db.prepare> | null = null;
let _getByInstitutionId: ReturnType<typeof db.prepare> | null = null;
let _insert: ReturnType<typeof db.prepare> | null = null;
let _updateCursor: ReturnType<typeof db.prepare> | null = null;
let _updateStatus: ReturnType<typeof db.prepare> | null = null;
let _delete: ReturnType<typeof db.prepare> | null = null;

function listAllStmt()           { return _listAll            ??= db.prepare(`SELECT * FROM plaid_items ORDER BY institution_name`); }
function getByIdStmt()           { return _getById            ??= db.prepare(`SELECT * FROM plaid_items WHERE id = ?`); }
function getAccessTokenStmt()    { return _getAccessToken     ??= db.prepare(`SELECT access_token FROM plaid_items WHERE id = ?`); }
function getByInstitutionIdStmt(){ return _getByInstitutionId ??= db.prepare(`SELECT * FROM plaid_items WHERE institution_id = ? LIMIT 1`); }
function insertStmt()            { return _insert             ??= db.prepare(`INSERT INTO plaid_items (id, item_id, institution_id, institution_name, access_token, cursor) VALUES ($id, $item_id, $institution_id, $institution_name, $access_token, $cursor)`); }
function updateCursorStmt()      { return _updateCursor       ??= db.prepare(`UPDATE plaid_items SET cursor = $cursor WHERE id = $id`); }
function updateStatusStmt()      { return _updateStatus       ??= db.prepare(`UPDATE plaid_items SET status = $status WHERE id = $id`); }
function deleteStmt()            { return _delete             ??= db.prepare(`DELETE FROM plaid_items WHERE id = ?`); }

export const plaidRepository = {
  listAll(): PlaidItem[] {
    return (listAllStmt().all() as unknown as PlaidItemRow[]).map(toPlaidItem);
  },

  getById(id: string): PlaidItem | null {
    const row = getByIdStmt().get(id) as PlaidItemRow | undefined;
    return row ? toPlaidItem(row) : null;
  },

  /** Returns the decrypted access_token for a given item id. */
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
    item_id: string;
    institution_id: string;
    institution_name: string;
    access_token: string;
  }): PlaidItem {
    const id = uuidv4();
    insertStmt().run({
      $id: id,
      $item_id: data.item_id,
      $institution_id: data.institution_id,
      $institution_name: data.institution_name,
      $access_token: encrypt(data.access_token),
      $cursor: '',
    });
    return {
      id,
      item_id: data.item_id,
      institution_id: data.institution_id,
      institution_name: data.institution_name,
      cursor: '',
      status: 'good',
      created_at: new Date().toISOString(),
    };
  },

  /**
   * Returns the first Plaid item with the given institution_id, or null.
   * Guards against empty strings to avoid false matches on legacy rows.
   */
  getByInstitutionId(institutionId: string): PlaidItem | null {
    if (!institutionId) return null;
    const row = getByInstitutionIdStmt().get(institutionId) as PlaidItemRow | undefined;
    return row ? toPlaidItem(row) : null;
  },

  updateCursor(id: string, cursor: string): void {
    updateCursorStmt().run({ $id: id, $cursor: cursor });
  },

  updateStatus(id: string, status: 'good' | 'login_required'): void {
    updateStatusStmt().run({ $id: id, $status: status });
  },

  delete(id: string): void {
    deleteStmt().run(id);
  },
};
