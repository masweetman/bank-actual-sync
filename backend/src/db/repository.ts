import { db } from './schema';
import type { Transaction, TransactionStatus } from '../types';

interface RawRow {
  id: string;
  bank_account: string;
  actual_account_id: string;
  date: string;
  amount: number;
  payee: string;
  memo: string;
  cleared: number | bigint;
  pending_transaction_id: string | null;
  status: TransactionStatus;
  fetched_at: string;
}

function toTransaction(row: RawRow): Transaction {
  return { ...row, cleared: Number(row.cleared) === 1, pending_transaction_id: row.pending_transaction_id ?? null };
}

// Lazy statement cache — prepared after initDb() has created the tables
let _upsert: ReturnType<typeof db.prepare> | null = null;
let _listStaged: ReturnType<typeof db.prepare> | null = null;
let _listSynced: ReturnType<typeof db.prepare> | null = null;
let _deleteStaged: ReturnType<typeof db.prepare> | null = null;
let _markSynced: ReturnType<typeof db.prepare> | null = null;
let _markExcluded: ReturnType<typeof db.prepare> | null = null;
let _markStaged: ReturnType<typeof db.prepare> | null = null;

function upsertStmt()      { return _upsert      ??= db.prepare(`INSERT INTO transactions (id, bank_account, actual_account_id, date, amount, payee, memo, cleared, pending_transaction_id, status, fetched_at) VALUES ($id, $bank_account, $actual_account_id, $date, $amount, $payee, $memo, $cleared, $pending_transaction_id, 'staged', $fetched_at) ON CONFLICT(id) DO UPDATE SET date=excluded.date,amount=excluded.amount,payee=excluded.payee,memo=excluded.memo,cleared=excluded.cleared,actual_account_id=excluded.actual_account_id,fetched_at=excluded.fetched_at,status=CASE WHEN transactions.status='synced' AND transactions.cleared=0 AND excluded.cleared=1 THEN 'staged' ELSE transactions.status END,pending_transaction_id=CASE WHEN transactions.status='synced' AND transactions.cleared=0 AND excluded.cleared=1 THEN transactions.id ELSE excluded.pending_transaction_id END WHERE transactions.status='staged' OR (transactions.status='synced' AND transactions.cleared=0 AND excluded.cleared=1)`); }
function listStagedStmt()  { return _listStaged  ??= db.prepare(`SELECT * FROM transactions WHERE status='staged' ORDER BY date DESC, fetched_at DESC`); }
function listSyncedStmt()  { return _listSynced  ??= db.prepare(`SELECT * FROM transactions WHERE status='synced' ORDER BY date DESC, fetched_at DESC`); }
function deleteStagedStmt(){ return _deleteStaged ??= db.prepare(`DELETE FROM transactions WHERE id=? AND status='staged'`); }
function markSyncedStmt()  { return _markSynced  ??= db.prepare(`UPDATE transactions SET status='synced'   WHERE id=?`); }
function markExcludedStmt(){ return _markExcluded ??= db.prepare(`UPDATE transactions SET status='excluded' WHERE id=?`); }
function markStagedStmt()  { return _markStaged   ??= db.prepare(`UPDATE transactions SET status='staged'   WHERE id=?`); }

export const repository = {
  upsertMany(transactions: Omit<Transaction, 'status'>[]): void {
    const stmt = upsertStmt();
    for (const t of transactions) {
      stmt.run({
        $id: t.id,
        $bank_account: t.bank_account,
        $actual_account_id: t.actual_account_id,
        $date: t.date,
        $amount: t.amount,
        $payee: t.payee,
        $memo: t.memo,
        $cleared: t.cleared ? 1 : 0,
        $pending_transaction_id: t.pending_transaction_id ?? null,
        $fetched_at: t.fetched_at,
      });
    }
  },

  listStaged(): Transaction[] {
    return (listStagedStmt().all() as unknown as RawRow[]).map(toTransaction);
  },

  listSynced(): Transaction[] {
    return (listSyncedStmt().all() as unknown as RawRow[]).map(toTransaction);
  },

  /** Removes a transaction only if it is still in 'staged' status (safe to delete removed Plaid txs). */
  deleteStaged(id: string): void {
    deleteStagedStmt().run(id);
  },

  markSynced(id: string): void {
    markSyncedStmt().run(id);
  },

  markExcluded(id: string): void {
    markExcludedStmt().run(id);
  },

  markStaged(id: string): void {
    markStagedStmt().run(id);
  },
};
