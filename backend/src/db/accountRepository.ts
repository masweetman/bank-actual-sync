import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import type { Account } from '../types';

interface AccountRow {
  id: string;
  name: string;
  provider: string;
  plaid_item_id: string | null;
  plaid_account_id: string | null;
  teller_enrollment_id: string | null;
  teller_account_id: string | null;
  actual_id: string;
  actual_server_url: string;
  actual_sync_id: string;
  created_at: string;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    provider: (row.provider ?? 'plaid') as 'plaid' | 'teller',
    plaid_item_id: row.plaid_item_id ?? null,
    plaid_account_id: row.plaid_account_id ?? null,
    teller_enrollment_id: row.teller_enrollment_id ?? null,
    teller_account_id: row.teller_account_id ?? null,
    actual_id: row.actual_id,
    actual_server_url: row.actual_server_url ?? '',
    actual_sync_id: row.actual_sync_id,
    created_at: row.created_at,
  };
}

let _listAll: ReturnType<typeof db.prepare> | null = null;
let _listByItem: ReturnType<typeof db.prepare> | null = null;
let _listByEnrollment: ReturnType<typeof db.prepare> | null = null;
let _insertPlaid: ReturnType<typeof db.prepare> | null = null;
let _insertTeller: ReturnType<typeof db.prepare> | null = null;
let _update:  ReturnType<typeof db.prepare> | null = null;
let _updateNoSync: ReturnType<typeof db.prepare> | null = null;
let _updateNameOnly: ReturnType<typeof db.prepare> | null = null;
let _delete:  ReturnType<typeof db.prepare> | null = null;
let _getByActualId: ReturnType<typeof db.prepare> | null = null;

function listAllStmt()          { return _listAll          ??= db.prepare(`SELECT * FROM accounts ORDER BY name`); }
function listByItemStmt()       { return _listByItem       ??= db.prepare(`SELECT * FROM accounts WHERE plaid_item_id = ? ORDER BY name`); }
function listByEnrollmentStmt() { return _listByEnrollment ??= db.prepare(`SELECT * FROM accounts WHERE teller_enrollment_id = ? ORDER BY name`); }
function insertPlaidStmt()      { return _insertPlaid      ??= db.prepare(`INSERT INTO accounts (id, name, provider, plaid_item_id, plaid_account_id, actual_id, actual_sync_id) VALUES ($id, $name, 'plaid', $plaid_item_id, $plaid_account_id, $actual_id, $actual_sync_id)`); }
function insertTellerStmt()     { return _insertTeller     ??= db.prepare(`INSERT INTO accounts (id, name, provider, teller_enrollment_id, teller_account_id, actual_id, actual_sync_id) VALUES ($id, $name, 'teller', $teller_enrollment_id, $teller_account_id, $actual_id, $actual_sync_id)`); }
function updateStmt()           { return _update           ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id, actual_sync_id=$actual_sync_id WHERE id=$id`); }
function updateNoSyncStmt()     { return _updateNoSync     ??= db.prepare(`UPDATE accounts SET name=$name, actual_id=$actual_id WHERE id=$id`); }
function updateNameOnlyStmt()   { return _updateNameOnly   ??= db.prepare(`UPDATE accounts SET name=$name WHERE id=$id`); }
function deleteStmt()           { return _delete           ??= db.prepare(`DELETE FROM accounts WHERE id=?`); }
function getByActualIdStmt()    { return _getByActualId    ??= db.prepare(`SELECT * FROM accounts WHERE actual_id = ?`); }

export const accountRepository = {
  listAll(): Account[] {
    return (listAllStmt().all() as unknown as AccountRow[]).map(toAccount);
  },

  listByItem(plaidItemId: string): Account[] {
    return (listByItemStmt().all(plaidItemId) as unknown as AccountRow[]).map(toAccount);
  },

  listByEnrollment(tellerEnrollmentId: string): Account[] {
    return (listByEnrollmentStmt().all(tellerEnrollmentId) as unknown as AccountRow[]).map(toAccount);
  },

  createPlaid(data: {
    name: string;
    plaid_item_id: string;
    plaid_account_id: string;
    actual_id: string;
    actual_sync_id?: string;
  }): Account {
    const id = uuidv4();
    insertPlaidStmt().run({
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
      provider: 'plaid',
      plaid_item_id: data.plaid_item_id,
      plaid_account_id: data.plaid_account_id,
      teller_enrollment_id: null,
      teller_account_id: null,
      actual_id: data.actual_id,
      actual_server_url: '',
      actual_sync_id: data.actual_sync_id ?? '',
      created_at: new Date().toISOString(),
    };
  },

  createTeller(data: {
    name: string;
    teller_enrollment_id: string;
    teller_account_id: string;
    actual_id: string;
    actual_sync_id?: string;
  }): Account {
    const id = uuidv4();
    insertTellerStmt().run({
      $id: id,
      $name: data.name,
      $teller_enrollment_id: data.teller_enrollment_id,
      $teller_account_id: data.teller_account_id,
      $actual_id: data.actual_id,
      $actual_sync_id: data.actual_sync_id ?? '',
    });
    return {
      id,
      name: data.name,
      provider: 'teller',
      plaid_item_id: null,
      plaid_account_id: null,
      teller_enrollment_id: data.teller_enrollment_id,
      teller_account_id: data.teller_account_id,
      actual_id: data.actual_id,
      actual_server_url: '',
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
