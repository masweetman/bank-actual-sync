import { plaidRepository } from '../db/plaidRepository';
import { accountRepository } from '../db/accountRepository';
import { repository } from '../db/repository';
import { syncTransactions, toInternalTransaction } from '../clients/plaidClient';
import { importStagedTransactions } from '../clients/actualClient';
import type { SyncResult } from '../types';

export interface PlaidSyncResult {
  totalAdded: number;
  errors: string[];
}

export interface FullSyncResult {
  plaid: PlaidSyncResult;
  actual: SyncResult;
}

/**
 * Fetches new/modified transactions from all connected Plaid items and
 * upserts them into the local DB as 'staged'. Returns totals and any errors.
 */
export async function runPlaidSync(): Promise<PlaidSyncResult> {
  const items = plaidRepository.listAll();
  let totalAdded = 0;
  const errors: string[] = [];

  if (items.length === 0) {
    return { totalAdded: 0, errors: ['No connected banks. Connect a bank in Settings first.'] };
  }

  for (const item of items) {
    const accessToken = plaidRepository.getAccessToken(item.id);
    if (!accessToken) {
      errors.push(`Missing access token for ${item.institution_name}`);
      continue;
    }

    try {
      const syncResult = await syncTransactions(accessToken, item.cursor);

      const pendingFromPlaid = syncResult.added.filter(t => t.pending);
      console.log(`[syncJob] ${item.institution_name}: ${syncResult.added.length} added, ${syncResult.modified.length} modified, ${syncResult.removed.length} removed, ${pendingFromPlaid.length} pending`);
      if (pendingFromPlaid.length > 0) {
        console.log('[syncJob] pending tx ids:', pendingFromPlaid.map(t => t.transaction_id));
      }

      const accounts = accountRepository.listByItem(item.id);
      const accountMap = new Map(accounts.map(a => [a.plaid_account_id, a]));

      const txsToUpsert = [
        ...syncResult.added,
        ...syncResult.modified,
      ]
        .filter(t => accountMap.has(t.account_id))
        .map(t => {
          const acct = accountMap.get(t.account_id)!;
          return toInternalTransaction(t, acct.name, acct.actual_id);
        });

      const pendingToUpsert = txsToUpsert.filter(t => !t.cleared);
      console.log(`[syncJob] ${item.institution_name}: upserting ${txsToUpsert.length} txs (${pendingToUpsert.length} pending/uncleared)`);

      if (txsToUpsert.length > 0) {
        repository.upsertMany(txsToUpsert);
        totalAdded += txsToUpsert.length;
      }

      for (const txId of syncResult.removed) {
        try { repository.deleteStaged(txId); } catch { /* not found or already synced */ }
      }

      plaidRepository.updateCursor(item.id, syncResult.nextCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[syncJob] error for ${item.institution_name}:`, err);
      errors.push(`${item.institution_name}: ${msg}`);
    }
  }

  return { totalAdded, errors };
}

/**
 * Runs a complete sync: fetches from Plaid, then imports all staged
 * transactions into Actual Budget and marks them synced.
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const plaid = await runPlaidSync();

  const staged = repository.listStaged();
  let actual: SyncResult = { imported: 0, skipped: 0, errors: [], failedIds: [] };

  if (staged.length > 0) {
    actual = await importStagedTransactions(staged);
    for (const t of staged) {
      if (!actual.failedIds.includes(t.id)) {
        repository.markSynced(t.id);
      }
    }
  }

  return { plaid, actual };
}
