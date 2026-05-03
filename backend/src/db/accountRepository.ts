import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import type { Account } from '../types';

interface AccountRow {
  id: string;
  name: string;
  plaid_item_id: string;
  plaid_account_id: string;
  actual_id: string;
  actual_sync_id: string;
  created_at: string;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    plaid_item_id: row.plaid_item_id,
    plaid_account_id: row.plaid_account_id,
    actual_id: row.actual_id,
    actual_sync_id: row.actual_sync_id,
    created_at: row.created_at,
  };
}

let _listAll: ReturnType<typeof db.prepare> | null = null;
let _listByItem: ReturnType<typeof db.prepare> | null = null;
let _insert:  ReturnType<typeof db.prepare> | null = null;
let _update:  ReturnType<typeof db.prepare> | null = null;
let _updateNoSync: ReturnType<typeof db.prepare> | null = null;
let _updateNameOnly: ReturnType<typeof db.prepare> | null = null;
let _delete:  ReturnType<typeof db.prepare> | null = null;
let _getByActualId: ReturnType<typeof db.prepare> | null = null;

function listAllStmt()        { return _listAll        ??= db.prepare(`SELECT * FROM accounts ORDER BY name`); }
function listByItemStmt()     { return _listByItem     ??= db.prepare(`SELECT * FROM accounts WHERE plaid_item_id = ? ORDER BY name`); }
function insertStmt()         { return _insert         ??= db.prepare(`INSERT INTO accounts (id, name, plaid_item_id, plaid_account_id, actual_id, actual_sync_id) VALUES ($id, $name, $plaid_item_id, $plaid_account_id, $actual_id, $actual_sync_id)`); }
function updateStmt()         { return _update         ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id, actual_sync_id=$actual_sync_id WHERE id=$id`); }
function updateNoSyncStmt()   { return _updateNoSync   ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id WHERE id=$id`); }
function updateNameOnlyStmt() { return _updateNameOnly ??= db.prepare(`UPDATE accounts SET name=$name WHERE id=$id`); }
function deleteStmt()         { return _delete         ??= db.prepare(`DELETE FROM accounts WHERE id=?`); }
function getByActualIdStmt()  { return _getByActualId  ??= db.prepare(`SELECT * FROM accounts WHERE actual_id = ?`); }

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
    actual_sync_id?: string;
  }): Account {
    const id = uuidv4();
    insertStmt().run({
      $id: id,
      $name: data.name,
      $plaid_item_id: data.plaid_item_id,
      $plaid_account_id: data.plaid_account_id,
      $actual_id: data.actual_id,
      $actual_sync_id: data.actual_sync_id ?? '',
    });
    return {
      id,
      name: data.name,
      plaid_item_id: data.plaid_item_id,
      plaid_account_id: data.plaid_account_id,
      actual_id: data.actual_id,
      actual_sync_id: data.actual_sync_id ?? '',
      created_at: new Date().toISOString(),
    };
  },

  /** Updates name always; only writes actual_id and actual_sync_id when explicitly provided
   * so that inline name edits on the Banks page never clear the stored link info. */
  update(id: string, data: {
    name: string;
    actual_id?: string;
    actual_sync_id?: string;
  }): void {
    if (data.actual_id !== undefined && data.actual_sync_id !== undefined) {
      updateStmt().run({
        $id: id,
        $name: data.name,
        $actual_id: data.actual_id,
        $actual_sync_id: data.actual_sync_id,
      });
    } else if (data.actual_id !== undefined) {
      updateNoSyncStmt().run({
        $id: id,
        $name: data.name,
        $actual_id: data.actual_id,
      });
    } else {
      updateNameOnlyStmt().run({
        $id: id,
        $name: data.name,
      });
    }
  },

  delete(id: string): void {
    deleteStmt().run(id);
  },

  /** Returns the Actual Budget sync info for the account mapped to a given Actual account UUID. */
  getSyncInfo(actualId: string): { name: string; actual_sync_id: string } | null {
    const row = getByActualIdStmt().get(actualId) as AccountRow | undefined;
    if (!row) return null;
    return { name: row.name, actual_sync_id: row.actual_sync_id };
  },
};
