import * as actualApi from '@actual-app/api';
import path from 'path';
import fs from 'fs';
import { accountRepository } from '../db/accountRepository';
import { settingsRepo } from '../db/settingsRepository';
import type { Transaction, SyncResult, ActualAccount } from '../types';

const ACTUAL_CACHE = path.resolve(process.cwd(), '../data/actual-cache');

if (!fs.existsSync(ACTUAL_CACHE)) {
  fs.mkdirSync(ACTUAL_CACHE, { recursive: true });
}

export async function importStagedTransactions(
  transactions: Transaction[]
): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, skipped: 0, errors: [], failedIds: [] };

  // Read global Actual Budget credentials
  const serverURL = settingsRepo.get('actual_server_url') ?? '';
  const password  = settingsRepo.get('actual_password')   ?? '';
  if (!serverURL || !password) {
    for (const t of transactions) result.failedIds.push(t.id);
    result.errors.push(
      'Actual Budget credentials not configured — set server URL and password in Settings.'
    );
    return result;
  }

  // Transactions without an Actual account mapping can't be imported — keep them staged for retry
  for (const t of transactions) {
    if (!t.actual_account_id) {
      result.failedIds.push(t.id);
    }
  }
  const linked = transactions.filter(t => t.actual_account_id);

  // Group by Actual account UUID
  const byAccount = groupByAccount(linked);

  // Look up per-account sync info and group by syncId (one budget open per unique syncId)
  type BudgetGroup = {
    syncId: string;
    accounts: Record<string, { txns: Transaction[]; name: string }>;
  };
  const budgets = new Map<string, BudgetGroup>();

  for (const [actualAccountId, txns] of Object.entries(byAccount)) {
    const info = accountRepository.getSyncInfo(actualAccountId);
    if (!info || !info.actual_sync_id) {
      const label = info?.name ?? actualAccountId;
      result.errors.push(
        `Account ${label}: not linked to Actual Budget — link it on the Banks page.`
      );
      for (const t of txns) result.failedIds.push(t.id);
      continue;
    }
    if (!budgets.has(info.actual_sync_id)) {
      budgets.set(info.actual_sync_id, { syncId: info.actual_sync_id, accounts: {} });
    }
    budgets.get(info.actual_sync_id)!.accounts[actualAccountId] = { txns, name: info.name };
  }

  // Process each unique Actual Budget (open once per syncId)
  for (const { syncId, accounts } of budgets.values()) {
    try {
      await actualApi.init({ serverURL, password, dataDir: ACTUAL_CACHE });
      await actualApi.downloadBudget(syncId);

      for (const [actualAccountId, { txns, name }] of Object.entries(accounts)) {
        try {
          // Split into pending (uncleared) and cleared transactions
          const pendingTxns  = txns.filter(t => !t.cleared);
          const clearedTxns  = txns.filter(t => t.cleared);

          // Pass A — import pending transactions as uncleared
          if (pendingTxns.length > 0) {
            const actualPending = pendingTxns.map(t => ({
              account: actualAccountId,
              date: t.date,
              amount: t.amount,
              imported_id: t.id,
              payee_name: t.payee,
              notes: t.memo,
              cleared: false,
            }));
            await actualApi.addTransactions(actualAccountId, actualPending);
            result.imported += pendingTxns.length;
          }

          // Pass B — handle cleared transactions
          if (clearedTxns.length > 0) {
            const withPendingId    = clearedTxns.filter(t => t.pending_transaction_id !== null);
            const withoutPendingId = clearedTxns.filter(t => t.pending_transaction_id === null);
            const toImport: typeof clearedTxns = [...withoutPendingId];

            // Attempt to match cleared txs back to their pending counterparts in Actual
            if (withPendingId.length > 0) {
              const dates = withPendingId.map(t => t.date).sort();
              const startDate = subtractDays(dates[0], 7);
              const today = new Date().toISOString().slice(0, 10);

              const existingTxns = await (actualApi as any).getTransactions(actualAccountId, startDate, today) as Array<{ id: string; cleared: boolean; imported_id?: string }>;

              // Build lookup: pending Plaid transaction_id → Actual transaction UUID
              const unclearedById = new Map<string, string>();
              for (const tx of existingTxns) {
                if (!tx.cleared && tx.imported_id) {
                  unclearedById.set(tx.imported_id, tx.id);
                }
              }

              for (const t of withPendingId) {
                const actualId = unclearedById.get(t.pending_transaction_id!);
                if (actualId) {
                  // Mark the existing pending transaction as cleared
                  await (actualApi as any).updateTransaction(actualId, { cleared: true });
                  result.imported += 1;
                } else {
                  // Pending was never imported (or already cleared) — import as new
                  toImport.push(t);
                }
              }
            }

            if (toImport.length > 0) {
              const actualCleared = toImport.map(t => ({
                account: actualAccountId,
                date: t.date,
                amount: t.amount,
                imported_id: t.id,
                payee_name: t.payee,
                notes: t.memo,
                cleared: true,
              }));
              await actualApi.addTransactions(actualAccountId, actualCleared);
              result.imported += toImport.length;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Account ${name}: ${msg}`);
          for (const t of txns) result.failedIds.push(t.id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const { txns, name } of Object.values(accounts)) {
        result.errors.push(`Account ${name}: ${msg}`);
        for (const t of txns) result.failedIds.push(t.id);
      }
    } finally {
      try {
        await actualApi.shutdown();
      } catch {
        // shutdown errors are non-fatal
      }
    }
  }

  return result;
}

function groupByAccount(transactions: Transaction[]): Record<string, Transaction[]> {
  const grouped: Record<string, Transaction[]> = {};
  for (const t of transactions) {
    const id = t.actual_account_id;
    if (!id) continue;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(t);
  }
  return grouped;
}

/** Returns a YYYY-MM-DD date string that is `days` days before `dateStr`. */
function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function fetchActualAccounts(syncId: string): Promise<ActualAccount[]> {
  // Read global credentials — must be configured in Settings before linking
  const serverURL = settingsRepo.get('actual_server_url') ?? '';
  const password  = settingsRepo.get('actual_password')   ?? '';
  if (!serverURL || !password) {
    throw new Error(
      'Actual Budget server URL and password must be configured in Settings before linking accounts.'
    );
  }

  // Always start with a clean cache to avoid stale/corrupt SQLite state
  if (fs.existsSync(ACTUAL_CACHE)) {
    fs.rmSync(ACTUAL_CACHE, { recursive: true, force: true });
  }
  fs.mkdirSync(ACTUAL_CACHE, { recursive: true });

  try {
    await actualApi.init({ serverURL, password, dataDir: ACTUAL_CACHE });
    await actualApi.downloadBudget(syncId);
    const accounts = await actualApi.getAccounts() as Array<{ id: string; name: string }>;
    return accounts.map(a => ({ id: a.id, name: a.name }));
  } finally {
    try {
      await actualApi.shutdown();
    } catch {
      // shutdown errors are non-fatal
    }
  }
}
