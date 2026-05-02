import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import { encrypt, decrypt } from '../utils/crypto';
import type { Account } from '../types';

interface AccountRow {
  id: string;
  name: string;
  plaid_item_id: string;
  plaid_account_id: string;
  actual_id: string;
  actual_server_url: string;
  actual_sync_id: string;
  actual_password: string; // stored encrypted
  created_at: string;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    plaid_item_id: row.plaid_item_id,
    plaid_account_id: row.plaid_account_id,
    actual_id: row.actual_id,
    actual_server_url: row.actual_server_url,
    actual_sync_id: row.actual_sync_id,
    created_at: row.created_at,
  };
}

let _listAll: ReturnType<typeof db.prepare> | null = null;
let _listByItem: ReturnType<typeof db.prepare> | null = null;
let _insert:  ReturnType<typeof db.prepare> | null = null;
let _update:  ReturnType<typeof db.prepare> | null = null;
let _updateNoPwd: ReturnType<typeof db.prepare> | null = null;
let _delete:  ReturnType<typeof db.prepare> | null = null;
let _getByActualId: ReturnType<typeof db.prepare> | null = null;

function listAllStmt()       { return _listAll       ??= db.prepare(`SELECT * FROM accounts ORDER BY name`); }
function listByItemStmt()    { return _listByItem    ??= db.prepare(`SELECT * FROM accounts WHERE plaid_item_id = ? ORDER BY name`); }
function insertStmt()        { return _insert        ??= db.prepare(`INSERT INTO accounts (id, name, plaid_item_id, plaid_account_id, actual_id, actual_server_url, actual_sync_id, actual_password) VALUES ($id, $name, $plaid_item_id, $plaid_account_id, $actual_id, $actual_server_url, $actual_sync_id, $actual_password)`); }
function updateStmt()        { return _update        ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id, actual_server_url=$actual_server_url, actual_sync_id=$actual_sync_id, actual_password=$actual_password WHERE id=$id`); }
function updateNoPwdStmt()   { return _updateNoPwd   ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id, actual_server_url=$actual_server_url, actual_sync_id=$actual_sync_id WHERE id=$id`); }
function deleteStmt()        { return _delete        ??= db.prepare(`DELETE FROM accounts WHERE id=?`); }
function getByActualIdStmt() { return _getByActualId ??= db.prepare(`SELECT * FROM accounts WHERE actual_id = ?`); }

export const accountRepository = {
  listAll(): Account[] {
    return (listAllStmt().all() as unknown as AccountRow[]).map(toAccount);
  },

  listByItem(plaidItemId: string): Account[] {
    return (listByItemStmt().all(plaidItemId) as unknown as AccountRow[]).map(toAccount);
  },

  create(data: {
    name: string;
    plaid_item_id: string;
    plaid_account_id: string;
    actual_id: string;
    actual_server_url?: string;
    actual_sync_id?: string;
    actual_password?: string;
  }): Account {
    const id = uuidv4();
    const encPwd = data.actual_password ? encrypt(data.actual_password) : '';
    insertStmt().run({
      $id: id,
      $name: data.name,
      $plaid_item_id: data.plaid_item_id,
      $plaid_account_id: data.plaid_account_id,
      $actual_id: data.actual_id,
      $actual_server_url: data.actual_server_url ?? '',
      $actual_sync_id: data.actual_sync_id ?? '',
      $actual_password: encPwd,
    });
    return {
      id,
      name: data.name,
      plaid_item_id: data.plaid_item_id,
      plaid_account_id: data.plaid_account_id,
      actual_id: data.actual_id,
      actual_server_url: data.actual_server_url ?? '',
      actual_sync_id: data.actual_sync_id ?? '',
      created_at: new Date().toISOString(),
    };
  },

  /** Only updates password when a non-empty value is supplied; omitting it preserves the stored value. */
  update(id: string, data: {
    name: string;
    actual_id: string;
    actual_server_url?: string;
    actual_sync_id?: string;
    actual_password?: string;
  }): void {
    if (data.actual_password) {
      updateStmt().run({
        $id: id,
        $name: data.name,
        $actual_id: data.actual_id,
        $actual_server_url: data.actual_server_url ?? '',
        $actual_sync_id: data.actual_sync_id ?? '',
        $actual_password: encrypt(data.actual_password),
      });
    } else {
      updateNoPwdStmt().run({
        $id: id,
        $name: data.name,
        $actual_id: data.actual_id,
        $actual_server_url: data.actual_server_url ?? '',
        $actual_sync_id: data.actual_sync_id ?? '',
      });
    }
  },

  delete(id: string): void {
    deleteStmt().run(id);
  },

  /** Returns decrypted Actual Budget credentials for the account mapped to a given Actual account UUID. */
  getCredentials(actualId: string): { actual_server_url: string; actual_sync_id: string; actual_password: string } | null {
    const row = getByActualIdStmt().get(actualId) as AccountRow | undefined;
    if (!row) return null;
    let password = '';
    if (row.actual_password) {
      try { password = decrypt(row.actual_password); } catch { password = ''; }
    }
    return {
      actual_server_url: row.actual_server_url,
      actual_sync_id: row.actual_sync_id,
      actual_password: password,
    };
  },
};
