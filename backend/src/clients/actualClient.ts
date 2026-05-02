import * as actualApi from '@actual-app/api';
import path from 'path';
import fs from 'fs';
import { accountRepository } from '../db/accountRepository';
import type { Transaction, SyncResult, ActualAccount } from '../types';

const ACTUAL_CACHE = path.resolve(process.cwd(), '../data/actual-cache');

if (!fs.existsSync(ACTUAL_CACHE)) {
  fs.mkdirSync(ACTUAL_CACHE, { recursive: true });
}

export async function importStagedTransactions(
  transactions: Transaction[]
): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, skipped: 0, errors: [], failedIds: [] };

  // Group by Actual account UUID
  const byAccount = groupByAccount(transactions);

  // Look up per-account credentials and re-group by budget (serverUrl+syncId)
  type BudgetGroup = {
    serverURL: string;
    syncId: string;
    password: string;
    accounts: Record<string, Transaction[]>;
  };
  const budgets = new Map<string, BudgetGroup>();

  for (const [actualAccountId, txns] of Object.entries(byAccount)) {
    const creds = accountRepository.getCredentials(actualAccountId);
    if (!creds || !creds.actual_server_url || !creds.actual_sync_id || !creds.actual_password) {
      result.errors.push(
        `Account ${actualAccountId}: Actual Budget credentials not configured — link this account on the Banks page.`
      );
      for (const t of txns) result.failedIds.push(t.id);
      continue;
    }
    const key = `${creds.actual_server_url}|${creds.actual_sync_id}`;
    if (!budgets.has(key)) {
      budgets.set(key, { serverURL: creds.actual_server_url, syncId: creds.actual_sync_id, password: creds.actual_password, accounts: {} });
    }
    budgets.get(key)!.accounts[actualAccountId] = txns;
  }

  // Process each unique Actual Budget
  for (const { serverURL, syncId, password, accounts } of budgets.values()) {
    try {
      await actualApi.init({ serverURL, password, dataDir: ACTUAL_CACHE });
      await actualApi.downloadBudget(syncId);

      for (const [actualAccountId, txns] of Object.entries(accounts)) {
        try {
          const actualTxns = txns.map(t => ({
            account: actualAccountId,
            date: t.date,
            amount: t.amount,
            imported_id: t.id,
            payee_name: t.payee,
            notes: t.memo,
            cleared: t.cleared,
          }));
          await actualApi.importTransactions(actualAccountId, actualTxns);
          result.imported += txns.length;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Account ${actualAccountId}: ${msg}`);
          for (const t of txns) result.failedIds.push(t.id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const [actualAccountId, txns] of Object.entries(accounts)) {
        result.errors.push(`Account ${actualAccountId}: ${msg}`);
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

export async function fetchActualAccounts(
  serverURL: string,
  syncId: string,
  password: string,
): Promise<ActualAccount[]> {
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
